import { EventEmitter } from "node:events";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import type { ChildProcess, DetectedExternal, ProcessStatus, ServerSnapshot, ServerState } from "@devhub/shared";
import { processGroupId, processStartedAt, type DockerInspectState } from "./externalScan.js";

const execFileAsync = promisify(execFile);

const LOG_BUFFER_LINES = 2000;
const KILL_GRACE_MS = 5000;
// ps -o etime= has 1s resolution and our own polling adds jitter — allow
// some slack before concluding a pid's start time no longer matches (i.e.
// the OS recycled it to an unrelated process) and refusing to signal it.
const PID_REUSE_TOLERANCE_MS = 5000;
// docker stop/restart can legitimately take up to their own grace period
// (default 10s) — longer than externalScan.ts's 3s read-only EXEC_OPTS,
// which would prematurely kill our own docker CLI invocation mid-grace.
const DOCKER_MUTATE_OPTS = { timeout: 15000 };

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

interface RuntimeServerConfigBase {
  id: string;
  projectId: string;
  name: string;
  port?: number;
}

export interface ProcessRuntimeConfig extends RuntimeServerConfigBase {
  kind: "process";
  command: string;
  /** Already-resolved absolute working directory. */
  cwd: string;
}

export interface DockerRuntimeConfig extends RuntimeServerConfigBase {
  kind: "docker";
  container: string;
}

/** A server config flattened out of its parent project. Daemon-internal —
 *  the wire-facing shape is @devhub/shared's ServerSnapshot. */
export type RuntimeServerConfig = ProcessRuntimeConfig | DockerRuntimeConfig;

interface Runtime {
  config: RuntimeServerConfig;
  state: ServerState;
  logs: string[];
  lineBuffer: string;
  /** Second, independent line-carry buffer for docker's stderr pipe — a pty
   *  merges stdout/stderr itself, but `docker logs -f` gives two pipes that
   *  can interleave mid-line if fed into a single shared buffer. */
  stderrBuffer: string;
  pty: IPty | null;
  /** Set instead of `pty` when "running" backs onto an adopted foreign
   *  process — there's no pty handle, just a pid we've promised to signal
   *  responsibly. */
  externalPid: number | null;
  detected: DetectedExternal | null;
  explicitStop: boolean;
  killTimer: NodeJS.Timeout | null;
  /** The `docker logs -f` follower for a docker-kind runtime; null when not
   *  attached (stopped, or the follower crashed and hasn't self-healed yet). */
  dockerLogProc: ChildProcessWithoutNullStreams | null;
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
        children: [],
      },
      logs: [],
      lineBuffer: "",
      stderrBuffer: "",
      pty: null,
      externalPid: null,
      detected: null,
      explicitStop: false,
      killTimer: null,
      dockerLogProc: null,
    };
  }

  snapshot(id: string): ServerSnapshot | null {
    const rt = this.runtimes.get(id);
    return rt ? ({ ...rt.config, state: rt.state, detected: rt.detected } as ServerSnapshot) : null;
  }

  allSnapshots(): ServerSnapshot[] {
    return [...this.runtimes.values()].map((rt) => ({ ...rt.config, state: rt.state, detected: rt.detected }) as ServerSnapshot);
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

    // Rebuild the map in `servers`' order rather than mutating in place —
    // Map.set on an existing key doesn't move its iteration position, so a
    // reorder-only config change would otherwise never show up in
    // allSnapshots()'s output order.
    const next = new Map<string, Runtime>();
    for (const config of servers) {
      const existing = this.runtimes.get(config.id);
      if (existing) {
        existing.config = config;
        if (existing.state.status === "stopped") existing.state.port = config.port ?? null;
        next.set(config.id, existing);
      } else {
        next.set(config.id, this.freshRuntime(config));
      }
    }
    this.runtimes = next;
    for (const config of servers) this.emitUpdate(config.id);
  }

  /** Stopped, untracked process-kind servers worth checking against
   *  already-listening host processes. Docker containers have no cwd to
   *  match against and use their own reconcile path — see reconcileDocker. */
  stoppedCandidates(): { id: string; cwd: string }[] {
    const out: { id: string; cwd: string }[] = [];
    for (const rt of this.runtimes.values()) {
      if (rt.config.kind !== "process" || rt.state.status !== "stopped" || rt.externalPid) continue;
      out.push({ id: rt.config.id, cwd: rt.config.cwd });
    }
    return out;
  }

  /** Called by the periodic external-process scan with its latest findings.
   *  A match means something's already listening at a stopped configured
   *  server's cwd — auto-adopt it straight away rather than merely flagging
   *  a manual "Track" affordance, so already-running sibling processes (e.g.
   *  everything a single `pnpm dev` fans out) come up green with no click. */
  async setDetected(matches: Map<string, DetectedExternal>) {
    for (const rt of this.runtimes.values()) {
      if (rt.config.kind !== "process" || rt.state.status !== "stopped" || rt.externalPid) continue;
      const match = matches.get(rt.config.id) ?? null;
      if (!match) {
        if (rt.detected) {
          rt.detected = null;
          this.emitUpdate(rt.config.id);
        }
        continue;
      }
      if (await this.adopt(rt.config.id, match.pid, match.port)) {
        this.logNote(rt.config.id, `[devhub] auto-tracking already-running process (pid ${match.pid}) — restart to begin capturing its output`);
      }
    }
  }

  /** Core of adopting an already-running external process as this server's
   *  backing pid — re-verifies it's still alive right before committing,
   *  since scan results (whether `detected` or a discovery-fold match) can
   *  be a few seconds stale. Shared by `track` (user clicked "Track" on a
   *  scan-detected match) and `adoptKnown` (discovery fold already knows the
   *  pid from the same tick, so it skips the detected round-trip). */
  private async adopt(id: string, pid: number, port: number): Promise<boolean> {
    const rt = this.runtimes.get(id);
    if (!rt || rt.pty || rt.externalPid) return false;
    const startedAt = await processStartedAt(pid);
    if (startedAt == null) {
      rt.detected = null;
      this.emitUpdate(id);
      return false;
    }
    rt.externalPid = pid;
    rt.detected = null;
    rt.state.status = "running";
    rt.state.pid = pid;
    rt.state.port = port;
    rt.state.startedAt = startedAt;
    rt.state.external = true;
    this.emitUpdate(id);
    return true;
  }

  /** Adopts a previously-detected external process. */
  async track(id: string) {
    const rt = this.runtimes.get(id);
    if (!rt || !rt.detected) return;
    const { pid, port } = rt.detected;
    if (await this.adopt(id, pid, port)) {
      this.logNote(id, `[devhub] tracking already-running process (pid ${pid}) — restart to begin capturing its output`);
    }
  }

  /** Adopts a server whose backing pid is already known — used right after
   *  a discovery fold creates a brand-new server for a process that was
   *  found already running under a project's root, so it comes up "running"
   *  immediately instead of sitting "stopped" until the next scan tick
   *  re-detects it and someone clicks Track. */
  async adoptKnown(id: string, pid: number, port: number) {
    if (await this.adopt(id, pid, port)) {
      this.logNote(id, `[devhub] auto-tracking already-running process (pid ${pid}) — restart to begin capturing its output`);
    }
  }

  start(id: string) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    if (rt.config.kind === "docker") {
      this.startDocker(rt, rt.config.container);
      return;
    }
    if (rt.pty || rt.externalPid) return;

    rt.explicitStop = false;
    rt.state.status = "starting";
    rt.state.exitCode = null;
    rt.state.port = rt.config.port ?? null;
    rt.state.external = false;
    rt.state.children = [];
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
    if (rt.config.kind === "docker") {
      this.stopDocker(rt, rt.config.container);
      return;
    }
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
    if (rt.config.kind === "docker") {
      this.restartDocker(rt, rt.config.container);
      return;
    }
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

  /** Running process-kind servers with a real backing pid (devhub-spawned
   *  pty, or a previously-adopted external pid) — candidates for the
   *  child-process-tree scan; stopped/docker runtimes have no pid to walk
   *  descendants from. */
  runningRootPids(): { id: string; pid: number }[] {
    const out: { id: string; pid: number }[] = [];
    for (const rt of this.runtimes.values()) {
      if (rt.config.kind !== "process") continue;
      const pid = rt.pty?.pid ?? rt.externalPid;
      if (pid) out.push({ id: rt.config.id, pid });
    }
    return out;
  }

  /** Called by the periodic scan with each running server's freshly
   *  detected descendant listening processes (see externalScan.ts's
   *  findChildServers). */
  setChildren(childMap: Map<string, ChildProcess[]>) {
    for (const rt of this.runtimes.values()) {
      if (rt.config.kind !== "process") continue;
      const next = childMap.get(rt.config.id) ?? [];
      const prev = rt.state.children;
      const changed = prev.length !== next.length || prev.some((c, i) => c.pid !== next[i]?.pid || c.port !== next[i]?.port);
      if (!changed) continue;
      rt.state.children = next;
      this.emitUpdate(rt.config.id);
    }
  }

  /** All docker-kind runtimes, for the periodic reconcile scan. */
  dockerRefs(): { id: string; container: string }[] {
    const out: { id: string; container: string }[] = [];
    for (const rt of this.runtimes.values()) {
      if (rt.config.kind === "docker") out.push({ id: rt.config.id, container: rt.config.container });
    }
    return out;
  }

  /** Reconciles docker-kind runtimes against fresh `docker inspect` results
   *  — unlike a spawned pty child, a container's state can change outside
   *  devhub entirely (docker-compose, Docker Desktop, another terminal), so
   *  status isn't purely driven by devhub's own start/stop/restart calls. */
  reconcileDocker(states: Map<string, DockerInspectState | null>) {
    for (const [id, info] of states) {
      const rt = this.runtimes.get(id);
      if (!rt || rt.config.kind !== "docker") continue;
      // Transient inspect failure (container removed, docker CLI hiccup) —
      // leave the last-known status untouched rather than flapping.
      if (info === null) continue;

      if (info.running && !rt.dockerLogProc) this.attachDockerLogFollower(rt, rt.config.container);
      if (!info.running && rt.dockerLogProc) this.detachDockerLogFollower(rt);

      const status: ProcessStatus = info.running ? "running" : info.exitCode ? "crashed" : "stopped";
      const port = !info.running && rt.config.port === undefined ? null : rt.state.port;
      const changed =
        rt.state.status !== status ||
        rt.state.pid !== info.pid ||
        rt.state.startedAt !== info.startedAt ||
        rt.state.exitCode !== info.exitCode ||
        rt.state.port !== port;
      if (!changed) continue;
      rt.state.status = status;
      rt.state.pid = info.pid;
      rt.state.startedAt = info.startedAt;
      rt.state.exitCode = info.exitCode;
      rt.state.port = port;
      this.emitUpdate(id);
    }
  }

  private async startDocker(rt: Runtime, container: string) {
    if (rt.state.status === "running" || rt.state.status === "starting") return;
    const id = rt.config.id;
    rt.explicitStop = false;
    rt.state.status = "starting";
    rt.state.exitCode = null;
    rt.logs = [];
    rt.lineBuffer = "";
    rt.stderrBuffer = "";
    this.emitUpdate(id);
    try {
      await execFileAsync("docker", ["start", container], DOCKER_MUTATE_OPTS);
    } catch (err) {
      rt.state.status = "crashed";
      this.logNote(id, `[devhub] failed to start: ${(err as Error).message}`);
      this.emitUpdate(id);
      return;
    }
    // Real pid/startedAt arrive on the next reconcile tick (~5s) via
    // `docker inspect` — an accepted latency trade-off versus pty's
    // synchronous onExit, inherent to controlling containers via CLI.
    rt.state.status = "running";
    this.emitUpdate(id);
    this.attachDockerLogFollower(rt, container);
  }

  private async stopDocker(rt: Runtime, container: string) {
    const id = rt.config.id;
    rt.explicitStop = true;
    try {
      await execFileAsync("docker", ["stop", "--time", "10", container], DOCKER_MUTATE_OPTS);
    } catch (err) {
      this.logNote(id, `[devhub] failed to stop: ${(err as Error).message}`);
    }
    this.detachDockerLogFollower(rt);
    rt.state.status = "stopped";
    rt.state.pid = null;
    if (rt.config.port === undefined) rt.state.port = null;
    this.emitUpdate(id);
  }

  private async restartDocker(rt: Runtime, container: string) {
    const id = rt.config.id;
    rt.state.restartCount += 1;
    rt.state.status = "starting";
    this.emitUpdate(id);
    try {
      await execFileAsync("docker", ["restart", container], DOCKER_MUTATE_OPTS);
    } catch (err) {
      rt.state.status = "crashed";
      this.logNote(id, `[devhub] failed to restart: ${(err as Error).message}`);
      this.emitUpdate(id);
      return;
    }
    rt.state.status = "running";
    this.emitUpdate(id);
    this.attachDockerLogFollower(rt, container);
  }

  /** Attaches (or re-attaches, self-healing a crashed follower) a
   *  `docker logs -f` child process feeding the same log-buffer/broadcast
   *  path a pty's stdout does. Re-attaches use `--tail 0` — anything but a
   *  true first attach would otherwise re-emit and duplicate the last N
   *  lines already sitting in rt.logs on every self-heal reconnect. */
  private attachDockerLogFollower(rt: Runtime, container: string) {
    if (rt.dockerLogProc) return;
    const id = rt.config.id;
    const tail = rt.logs.length === 0 ? "200" : "0";
    const proc = spawn("docker", ["logs", "-f", "--tail", tail, container]);
    rt.dockerLogProc = proc;
    proc.stdout.on("data", (buf: Buffer) => this.ingestOutput(id, buf.toString(), "stdout"));
    proc.stderr.on("data", (buf: Buffer) => this.ingestOutput(id, buf.toString(), "stderr"));
    const clear = () => {
      const cur = this.runtimes.get(id);
      if (cur && cur.dockerLogProc === proc) cur.dockerLogProc = null;
    };
    proc.on("exit", clear);
    proc.on("error", clear);
  }

  private detachDockerLogFollower(rt: Runtime) {
    if (!rt.dockerLogProc) return;
    rt.dockerLogProc.kill();
    rt.dockerLogProc = null;
  }

  /** Signals a single descendant pid directly (not its process group) —
   *  stops one detected child of a running server (see findChildServers)
   *  without touching its siblings or the parent that spawned it.
   *  Best-effort: if that child had spawned grandchildren of its own, those
   *  aren't followed, and the parent may notice the exit and respawn it
   *  depending on how it supervises its own children — devhub has no
   *  visibility into that either way. */
  async killChild(pid: number, ownerServerId?: string) {
    this.signalExternal(pid, null, "SIGTERM");
    if (!(await this.waitForExit(pid, KILL_GRACE_MS))) {
      this.signalExternal(pid, null, "SIGKILL");
      await this.waitForExit(pid, 1000);
    }
    if (ownerServerId) this.logNote(ownerServerId, `[devhub] stopped child process (pid ${pid})`);
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
    rt.state.children = [];
    if (rt.config.port === undefined) rt.state.port = null;
    this.emitUpdate(rt.config.id);
  }

  /** Core line-buffer/port-sniff/blank-collapse/emit logic, shared by the
   *  pty path (stdout only) and the docker log-follower (independent
   *  stdout/stderr streams — see the Runtime.stderrBuffer comment). */
  private ingestOutput(id: string, chunk: string, stream: "stdout" | "stderr") {
    const rt = this.runtimes.get(id);
    if (!rt) return;

    const bufKey = stream === "stdout" ? "lineBuffer" : "stderrBuffer";
    rt[bufKey] += chunk;
    const parts = rt[bufKey].split(/\r?\n/);
    rt[bufKey] = parts.pop() ?? "";

    if (!rt.state.port && rt.config.port === undefined) {
      // Check completed lines first, then whatever's still buffered — a
      // chunk boundary can land mid-line and split "localhost:1420" in two,
      // so matching only the raw incoming chunk misses it.
      const match = PORT_RE.exec(parts.join("\n").replace(ANSI_RE, "")) ?? PORT_RE.exec(rt[bufKey].replace(ANSI_RE, ""));
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

  private handleData(id: string, chunk: string) {
    const rt = this.runtimes.get(id);
    if (!rt) return;

    // Any output at all means the process is alive — don't gate this on a
    // complete line arriving, which can lag well behind the first chunk.
    if (rt.state.status === "starting") {
      rt.state.status = "running";
      this.emitUpdate(id);
    }

    this.ingestOutput(id, chunk, "stdout");
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
    rt.state.children = [];
    this.emitUpdate(id);
    this.emit(`exited:${id}`);
  }

  private emitUpdate(id: string) {
    const snap = this.snapshot(id);
    if (snap) this.emit("update", snap);
  }

  /** Called on daemon shutdown — stops pty/adopted-external children (which
   *  would otherwise orphan), but leaves docker containers running: they're
   *  meant to outlive any one controlling process (docker-compose, another
   *  terminal), so devhub only detaches its own local log follower. */
  shutdown() {
    for (const rt of this.runtimes.values()) {
      if (rt.config.kind === "docker") this.detachDockerLogFollower(rt);
      else this.stop(rt.config.id);
    }
  }
}
