import { EventEmitter } from "node:events";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import type { ProjectConfig, ProjectSnapshot, ProjectState } from "@devhub/shared";

const LOG_BUFFER_LINES = 2000;
const KILL_GRACE_MS = 5000;

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

interface Runtime {
  config: ProjectConfig;
  state: ProjectState;
  logs: string[];
  lineBuffer: string;
  pty: IPty | null;
  explicitStop: boolean;
  killTimer: NodeJS.Timeout | null;
}

export declare interface ProcessManager {
  on(event: "update", listener: (snapshot: ProjectSnapshot) => void): this;
  on(event: "removed", listener: (id: string) => void): this;
  on(event: "log", listener: (id: string, lines: string[]) => void): this;
}

export class ProcessManager extends EventEmitter {
  private runtimes = new Map<string, Runtime>();

  constructor(projects: ProjectConfig[]) {
    super();
    for (const config of projects) this.runtimes.set(config.id, this.freshRuntime(config));
  }

  private freshRuntime(config: ProjectConfig): Runtime {
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
      },
      logs: [],
      lineBuffer: "",
      pty: null,
      explicitStop: false,
      killTimer: null,
    };
  }

  snapshot(id: string): ProjectSnapshot | null {
    const rt = this.runtimes.get(id);
    return rt ? { ...rt.config, state: rt.state } : null;
  }

  allSnapshots(): ProjectSnapshot[] {
    return [...this.runtimes.values()].map((rt) => ({ ...rt.config, state: rt.state }));
  }

  logBacklog(id: string): string[] {
    return this.runtimes.get(id)?.logs ?? [];
  }

  /** Reconciles running state with a freshly reloaded config file. */
  applyConfig(projects: ProjectConfig[]) {
    const nextIds = new Set(projects.map((p) => p.id));

    for (const id of [...this.runtimes.keys()]) {
      if (!nextIds.has(id)) {
        this.stop(id);
        this.runtimes.delete(id);
        this.emit("removed", id);
      }
    }

    for (const config of projects) {
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

  start(id: string) {
    const rt = this.runtimes.get(id);
    if (!rt || rt.pty) return;

    rt.explicitStop = false;
    rt.state.status = "starting";
    rt.state.exitCode = null;
    rt.state.port = rt.config.port ?? null;
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
    if (!rt?.pty) return;
    rt.explicitStop = true;
    rt.pty.kill();
    rt.killTimer = setTimeout(() => {
      // Some shells swallow SIGTERM while a child is mid-startup; escalate.
      rt.pty?.kill("SIGKILL");
    }, KILL_GRACE_MS);
  }

  restart(id: string) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    rt.state.restartCount += 1;
    if (!rt.pty) {
      this.start(id);
      return;
    }
    const restart = () => this.start(id);
    this.once(`exited:${id}`, restart);
    this.stop(id);
  }

  startGroup(group: string) {
    for (const rt of this.runtimes.values()) if (rt.config.group === group) this.start(rt.config.id);
  }

  stopGroup(group: string) {
    for (const rt of this.runtimes.values()) if (rt.config.group === group) this.stop(rt.config.id);
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
