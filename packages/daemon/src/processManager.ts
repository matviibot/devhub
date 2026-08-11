import { EventEmitter } from "node:events";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import type { DetectedExternal, ServerSnapshot, ServerState } from "@devhub/shared";
import { processGroupId, processStartedAt } from "./externalScan.js";

const LOG_BUFFER_LINES = 2000;
const KILL_GRACE_MS = 5000;
// ps -o etime= has 1s resolution and our own polling adds jitter — allow
// some slack before concluding a pid's start time no longer matches (i.e.
// the OS recycled it to an unrelated process) and refusing to signal it.
const PID_REUSE_TOLERANCE_MS = 5000;

// Matches the first "host:port" pair a dev server typically prints, e.g.
// "Local: http://localhost:5173/" or "listening on 127.0.0.1:3000".
const PORT_RE = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/;
// Many CLIs (Vite included) wrap the port digits in a bold/color SGR code,
// e.g. "localhost:\x1b[1m1420\x1b[22m" — strip those before matching, or
// the escape sequence breaks the ":digits" adjacency PORT_RE relies on.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
// Strip ALL escape sequences (not just SGR color codes) to detect lines that
// are visually blank — spinners/progress bars often clear-and-redraw using
// cursor-position/erase codes (e.g. "\x1b[1G\x1b[0K"), which split() turns
// into dozens of "blank" lines that a real terminal would have erased.
const ANY_ESCAPE_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const isVisuallyBlank = (line: string) => line.replace(ANY_ESCAPE_RE, "").trim() === "";

/** Collapses runs of visually-blank lines to at most one, preserving
 *  intentional single-blank-line spacing while dropping spinner noise. */
function collapseBlankRuns(newLines: string[], lastStored: string | undefined): string[] {
  const out: string[] = [];
  let prevBlank = lastStored !== undefined && isVisuallyBlank(lastStored);
  for (const line of newLines) {
    const blank = isVisuallyBlank(line);
    if (blank && prevBlank) continue;
    out.push(line);
    prevBlank = blank;
  }
  return out;
}

/** A server config flattened out of its parent project, with an
 *  already-resolved absolute working directory. Daemon-internal — the
 *  wire-facing shape is @devhub/shared's ServerSnapshot. */
export interface RuntimeServerConfig {
  id: string;
  projectId: string;
  name: string;
  command: string;
  dir: string;
  cwd: string;
  port?: number;
}

interface Runtime {
  config: RuntimeServerConfig;
  state: ServerState;
  logs: string[];
  lineBuffer: string;
  pty: IPty | null;
  /** Set instead of `pty` when "running" backs onto an adopted foreign
   *  process — there's no pty handle, just a pid we've promised to signal
   *  responsibly. */
  externalPid: number | null;
  detected: DetectedExternal | null;
  explicitStop: boolean;
  killTimer: NodeJS.Timeout | null;
}

export declare interface ProcessManager {
  on(event: "update", listener: (snapshot: ServerSnapshot) => void): this;
  on(event: "removed", listener: (id: string) => void): this;
  on(event: "log", listener: (id: string, lines: string[]) => void): this;
}

export class ProcessManager extends EventEmitter {
  private runtimes = new Map<string, Runtime>();

  constructor(servers: RuntimeServerConfig[]) {
    super();
    for (const config of servers) this.runtimes.set(config.id, this.freshRuntime(config));
  }

  private freshRuntime(config: RuntimeServerConfig): Runtime {
    return {
      config,
      state: {
        id: config.id,
        status: "stopped",
        port: config.port ?? null,
        pid: null,
        startedAt: null,
        exitCode: null,
        restartCount: 0,
        external: false,
      },
      logs: [],
      lineBuffer: "",
      pty: null,
      externalPid: null,
      detected: null,
      explicitStop: false,
      killTimer: null,
    };
  }

  snapshot(id: string): ServerSnapshot | null {
    const rt = this.runtimes.get(id);
    return rt ? { ...rt.config, state: rt.state, detected: rt.detected } : null;
  }

  allSnapshots(): ServerSnapshot[] {
    return [...this.runtimes.values()].map((rt) => ({ ...rt.config, state: rt.state, detected: rt.detected }));
  }

  logBacklog(id: string): string[] {
    return this.runtimes.get(id)?.logs ?? [];
  }

  /** Injects a synthetic log line (daemon-originated notices, not process output). */
  logNote(id: string, text: string) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    rt.logs.push(text);
    if (rt.logs.length > LOG_BUFFER_LINES) rt.logs.splice(0, rt.logs.length - LOG_BUFFER_LINES);
    this.emit("log", id, [text]);
  }

  /** Reconciles running state with a freshly reloaded/edited config. */
  applyConfig(servers: RuntimeServerConfig[]) {
    const nextIds = new Set(servers.map((s) => s.id));

    for (const id of [...this.runtimes.keys()]) {
      if (!nextIds.has(id)) {
        this.stop(id);
        this.runtimes.delete(id);
        this.emit("removed", id);
      }
    }

    for (const config of servers) {
      const existing = this.runtimes.get(config.id);
      if (!existing) {
        this.runtimes.set(config.id, this.freshRuntime(config));
      } else {
        existing.config = config;
        if (existing.state.status === "stopped") existing.state.port = config.port ?? null;
      }
      this.emitUpdate(config.id);
    }
  }

  /** Stopped, untracked servers worth checking against already-listening processes. */
  stoppedCandidates(): { id: string; cwd: string }[] {
    return [...this.runtimes.values()]
      .filter((rt) => rt.state.status === "stopped" && !rt.externalPid)
      .map((rt) => ({ id: rt.config.id, cwd: rt.config.cwd }));
  }

  /** Called by the periodic external-process scan with its latest findings. */
  setDetected(matches: Map<string, DetectedExternal>) {
    for (const rt of this.runtimes.values()) {
      if (rt.state.status !== "stopped" || rt.externalPid) continue;
      const match = matches.get(rt.config.id) ?? null;
      const prev = rt.detected;
      const changed = (prev?.pid ?? null) !== (match?.pid ?? null) || (prev?.port ?? null) !== (match?.port ?? null);
      rt.detected = match;
      if (changed) this.emitUpdate(rt.config.id);
    }
  }

  /** Adopts a previously-detected external process — re-verifies it's still
   *  alive right before committing, since the periodic scan can be stale. */
  async track(id: string) {
    const rt = this.runtimes.get(id);
    if (!rt || rt.pty || rt.externalPid || !rt.detected) return;
    const { pid, port } = rt.detected;
    const startedAt = await processStartedAt(pid);
    if (startedAt == null) {
      rt.detected = null;
      this.emitUpdate(id);
      return;
    }
    rt.externalPid = pid;
    rt.detected = null;
    rt.state.status = "running";
    rt.state.pid = pid;
    rt.state.port = port;
    rt.state.startedAt = startedAt;
    rt.state.external = true;
    this.logNote(id, `[devhub] tracking already-running process (pid ${pid}) — restart to begin capturing its output`);
    this.emitUpdate(id);
  }

  start(id: string) {
    const rt = this.runtimes.get(id);
    if (!rt || rt.pty || rt.externalPid) return;

    rt.explicitStop = false;
    rt.state.status = "starting";
    rt.state.exitCode = null;
    rt.state.port = rt.config.port ?? null;
    rt.state.external = false;
    rt.logs = [];
    rt.lineBuffer = "";
    this.emitUpdate(id);

    const shell = process.env.SHELL ?? "/bin/zsh";
    let child: IPty;
    try {
      child = pty.spawn(shell, ["-lc", rt.config.command], {
        name: "xterm-color",
        cols: 120,
        rows: 30,
        cwd: rt.config.cwd,
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      rt.state.status = "crashed";
      rt.logs.push(`[devhub] failed to start: ${(err as Error).message}`);
      this.emit("log", id, [rt.logs[rt.logs.length - 1]]);
      this.emitUpdate(id);
      return;
    }

    rt.pty = child;
    rt.state.pid = child.pid;
    rt.state.startedAt = Date.now();

    child.onData((chunk) => this.handleData(id, chunk));
    child.onExit(({ exitCode }) => this.handleExit(id, exitCode));
  }

  stop(id: string) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    if (rt.pty) {
      rt.explicitStop = true;
      rt.pty.kill();
      rt.killTimer = setTimeout(() => {
        // Some shells swallow SIGTERM while a child is mid-startup; escalate.
        rt.pty?.kill("SIGKILL");
      }, KILL_GRACE_MS);
      return;
    }
    if (rt.externalPid) {
      this.stopExternal(rt).catch((err) => this.logNote(id, `[devhub] failed to stop: ${(err as Error).message}`));
    }
  }

  restart(id: string) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    rt.state.restartCount += 1;
    if (rt.pty) {
      this.once(`exited:${id}`, () => this.start(id));
      this.stop(id);
      return;
    }
    if (rt.externalPid) {
      this.stopExternal(rt)
        .then(() => this.start(id))
        .catch((err) => this.logNote(id, `[devhub] failed to restart: ${(err as Error).message}`));
      return;
    }
    this.start(id);
  }

  startProject(projectId: string) {
    for (const rt of this.runtimes.values()) if (rt.config.projectId === projectId) this.start(rt.config.id);
  }

  stopProject(projectId: string) {
    for (const rt of this.runtimes.values()) if (rt.config.projectId === projectId) this.stop(rt.config.id);
  }

  /** Stops an adopted (non-pty) process: re-verifies it's still the same
   *  instance we tracked (guards against pid reuse), signals its whole
   *  process group so shell-spawned children don't get orphaned, and waits
   *  for it to actually exit before declaring the server stopped. */
  private async stopExternal(rt: Runtime) {
    const pid = rt.externalPid;
    if (!pid) return;

    const startedAt = await processStartedAt(pid);
    if (startedAt == null || Math.abs(startedAt - (rt.state.startedAt ?? 0)) > PID_REUSE_TOLERANCE_MS) {
      this.logNote(rt.config.id, "[devhub] tracked process no longer matches (likely already exited) — clearing");
      this.finalizeExternalExit(rt);
      return;
    }

    const pgid = await processGroupId(pid);
    this.signalExternal(pid, pgid, "SIGTERM");
    if (!(await this.waitForExit(pid, KILL_GRACE_MS))) {
      this.signalExternal(pid, pgid, "SIGKILL");
      await this.waitForExit(pid, 1000);
    }
    this.finalizeExternalExit(rt);
  }

  private signalExternal(pid: number, pgid: number | null, signal: NodeJS.Signals) {
    try {
      process.kill(pgid ? -pgid : pid, signal);
    } catch {
      // Already gone, or we lack permission to signal it — either way,
      // waitForExit below is the actual source of truth.
    }
  }

  private async waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.pidAlive(pid)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return !this.pidAlive(pid);
  }

  private pidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private finalizeExternalExit(rt: Runtime) {
    rt.externalPid = null;
    rt.state.pid = null;
    rt.state.status = "stopped";
    rt.state.external = false;
    if (rt.config.port === undefined) rt.state.port = null;
    this.emitUpdate(rt.config.id);
  }

  private handleData(id: string, chunk: string) {
    const rt = this.runtimes.get(id);
    if (!rt) return;

    // Any output at all means the process is alive — don't gate this on a
    // complete line arriving, which can lag well behind the first chunk.
    if (rt.state.status === "starting") {
      rt.state.status = "running";
      this.emitUpdate(id);
    }

    rt.lineBuffer += chunk;
    const parts = rt.lineBuffer.split(/\r?\n/);
    rt.lineBuffer = parts.pop() ?? "";

    if (!rt.state.port && rt.config.port === undefined) {
      // Check completed lines first, then whatever's still buffered — a
      // chunk boundary can land mid-line and split "localhost:1420" in two,
      // so matching only the raw incoming chunk misses it.
      const match =
        PORT_RE.exec(parts.join("\n").replace(ANSI_RE, "")) ??
        PORT_RE.exec(rt.lineBuffer.replace(ANSI_RE, ""));
      if (match) {
        rt.state.port = Number(match[1]);
        this.emitUpdate(id);
      }
    }

    if (parts.length === 0) return;
    const collapsed = collapseBlankRuns(parts, rt.logs[rt.logs.length - 1]);
    if (collapsed.length === 0) return;
    rt.logs.push(...collapsed);
    if (rt.logs.length > LOG_BUFFER_LINES) rt.logs.splice(0, rt.logs.length - LOG_BUFFER_LINES);
    this.emit("log", id, collapsed);
  }

  private handleExit(id: string, exitCode: number) {
    const rt = this.runtimes.get(id);
    if (!rt) return;

    if (rt.killTimer) clearTimeout(rt.killTimer);
    rt.pty = null;
    rt.state.pid = null;
    rt.state.exitCode = exitCode;
    rt.state.status = rt.explicitStop || exitCode === 0 ? "stopped" : "crashed";
    if (rt.state.status === "stopped" && rt.config.port === undefined) rt.state.port = null;
    this.emitUpdate(id);
    this.emit(`exited:${id}`);
  }

  private emitUpdate(id: string) {
    const snap = this.snapshot(id);
    if (snap) this.emit("update", snap);
  }
}
