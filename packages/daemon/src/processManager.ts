import { EventEmitter } from "node:events";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { processGroupId, processStartedAt, type DockerInspectState } from "./externalScan.js";

/** Runtime status of one service. Deliberately daemon-local: the wire-facing
 *  `ServiceStatus` in @devhub/shared is assembled by RepoStore, which merges
 *  this with what the observer actually saw listening. */
export type ProcessStatus = "stopped" | "starting" | "running" | "crashed";

export interface DetectedExternal {
  pid: number;
  port: number;
}

/** What ProcessManager knows about a service it is driving. Everything
 *  observation-derived (real listening ports, ownership, mode) is merged in
 *  by RepoStore — this is only "what devhub itself did". */
export interface RuntimeSnapshot {
  id: string;
  status: ProcessStatus;
  pid: number | null;
  /** Sniffed from the process's own output; ground truth still comes from
   *  the socket scan, this just fills the gap before the next tick. */
  port: number | null;
  startedAt: number | null;
  exitCode: number | null;
  restartCount: number;
  /** Running, but adopted rather than spawned — no captured output until
   *  it is restarted through devhub. */
  external: boolean;
}

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
  /** Empty for an observed-only service: devhub found it running but has no
   *  launcher for it, so it can be stopped but never started. */
  command: string;
  /** Already-resolved absolute working directory. */
  cwd: string;
  /** Set for every worktree's copy of a `fixed`-policy role, so starting one
   *  stops the others first. Derived per-repo by RepoStore, never hand-set. */
  singletonGroup?: string;
  /** Extra env for the spawned shell — carries an `alloc` policy's assigned
   *  port, e.g. `{ PORT: "3117" }`. */
  env?: Record<string, string>;
  killPatterns?: string[];
}

export interface DockerRuntimeConfig extends RuntimeServerConfigBase {
  kind: "docker";
  container: string;
}

/** One service, flattened for the runtime. Daemon-internal — RepoStore
 *  rebuilds this list from launchers x worktrees on every tick. */
export type RuntimeServerConfig = ProcessRuntimeConfig | DockerRuntimeConfig;

interface Runtime {
  config: RuntimeServerConfig;
  state: RuntimeSnapshot;
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
  on(event: "update", listener: (id: string) => void): this;
  on(event: "log", listener: (id: string, lines: string[]) => void): this;
  /** Deliberately not called "error": EventEmitter throws on an emitted
   *  "error" with no listener, which would turn a failed `docker start` into
   *  a dead daemon. */
  on(event: "actionFailed", listener: (message: string) => void): this;
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
      stderrBuffer: "",
      pty: null,
      externalPid: null,
      detected: null,
      explicitStop: false,
      killTimer: null,
      dockerLogProc: null,
    };
  }

  snapshot(id: string): RuntimeSnapshot | null {
    return this.runtimes.get(id)?.state ?? null;
  }

  /** Every runtime's state, for RepoStore to merge into the view tree. */
  states(): Map<string, RuntimeSnapshot> {
    const out = new Map<string, RuntimeSnapshot>();
    for (const rt of this.runtimes.values()) out.set(rt.config.id, rt.state);
    return out;
  }

  has(id: string): boolean {
    return this.runtimes.has(id);
  }

  configFor(id: string): RuntimeServerConfig | null {
    return this.runtimes.get(id)?.config ?? null;
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

  /** A failed start/stop/restart, reported to the user rather than only to a
   *  log buffer nobody has open. Previously every one of these went into the
   *  service's ring buffer and nowhere else, so the row simply flipped back to
   *  stopped and the reason was invisible unless the drawer happened to be
   *  open — which sent you to the terminal to find out why, the thing devhub
   *  exists to replace. */
  private failure(id: string, verb: "start" | "stop" | "restart", err: unknown) {
    const message = (err as Error).message;
    this.logNote(id, `[devhub] failed to ${verb}: ${message}`);
    const name = this.runtimes.get(id)?.config.name ?? id;
    this.emit("actionFailed", `Couldn't ${verb} ${name}: ${message}`);
  }

  /** Reconciles running state with a freshly rebuilt service list.
   *
   *  `stopRemoved` defaults to FALSE and that matters: this list is now
   *  recomputed from observation every tick, so an id can disappear simply
   *  because a process exited or a role was re-derived. Killing on removal
   *  would turn a momentary blip into devhub shooting a live dev server.
   *  Only an explicit user action (deleting a launcher) passes true. */
  applyConfig(servers: RuntimeServerConfig[], { stopRemoved = false }: { stopRemoved?: boolean } = {}) {
    const nextIds = new Set(servers.map((s) => s.id));

    for (const id of [...this.runtimes.keys()]) {
      if (!nextIds.has(id)) {
        if (stopRemoved) this.stop(id);
        this.runtimes.delete(id);
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
    // Deliberately emits nothing. This runs on every tick and changes no
    // runtime state; announcing an "update" per service made each tick
    // request another rebuild, which called applyConfig again — a self-
    // sustaining loop that also starved the 5s worktree refresh, because the
    // interval always arrived while a rebuild was already in flight. The
    // "update" event is for real transitions (spawn, exit, docker reconcile).
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

  /** Starting a `singletonGroup` server stops every other running server in
   *  that group first (fully — including its `killPatterns`) and waits for
   *  them to actually exit before spawning, so two mutually-exclusive
   *  instances (e.g. two worktrees of an app that can only bind one fixed
   *  dev-server port system-wide) never race for the same port. */
  async start(id: string) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    if (rt.config.kind === "process" && rt.config.singletonGroup) {
      await this.stopOtherSingletons(rt.config.singletonGroup, id);
    }
    this.startNow(id);
  }

  private async stopOtherSingletons(group: string, exceptId: string) {
    const others = [...this.runtimes.values()].filter(
      (r) => r.config.id !== exceptId && r.config.kind === "process" && r.config.singletonGroup === group && r.state.status !== "stopped",
    );
    await Promise.all(others.map((r) => this.fullyStop(r.config.id)));
  }

  /** Stops a server and waits for it to actually finish exiting — unlike
   *  the public `stop()`, which fires the kill and returns immediately.
   *  Used by singleton-group preemption, where the next server must not
   *  start spawning until the one it's replacing has fully released
   *  whatever they both contend for (typically a fixed port). */
  private async fullyStop(id: string): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    if (rt.config.kind === "docker") {
      await this.stopDocker(rt, rt.config.container);
      return;
    }
    if (rt.pty) {
      const exited = new Promise<void>((resolve) => this.once(`exited:${id}`, () => resolve()));
      this.stop(id);
      await exited;
      return;
    }
    if (rt.externalPid) await this.stopExternal(rt);
  }

  private startNow(id: string) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    if (rt.config.kind === "docker") {
      this.startDocker(rt, rt.config.container);
      return;
    }
    if (rt.pty || rt.externalPid) return;
    if (!rt.config.command.trim()) {
      this.logNote(id, "[devhub] nothing to start — devhub observed this service but has no launcher for it. Save one to take control.");
      return;
    }

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
        // An `alloc` policy's assigned port arrives here as e.g. PORT=3117,
        // which is the whole mechanism that stops sibling worktrees from
        // fighting over one hardcoded port.
        env: { ...(process.env as Record<string, string>), ...(rt.config.env ?? {}) },
      });
    } catch (err) {
      rt.state.status = "crashed";
      this.failure(id, "start", err);
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
      this.stopExternal(rt).catch((err) => this.failure(id, "stop", err));
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
        .catch((err) => this.failure(id, "restart", err));
      return;
    }
    this.start(id);
  }

  async startMany(ids: string[]) {
    for (const id of ids) await this.start(id);
  }

  stopMany(ids: string[]) {
    for (const id of ids) this.stop(id);
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
      this.failure(id, "start", err);
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
      this.failure(id, "stop", err);
    }
    this.detachDockerLogFollower(rt);
    rt.state.status = "stopped";
    rt.state.pid = null;
    if (rt.config.port === undefined) rt.state.port = null;
    this.emitUpdate(id);
    await this.runKillPatterns(rt);
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
      this.failure(id, "restart", err);
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
    if (rt.config.port === undefined) rt.state.port = null;
    this.emitUpdate(rt.config.id);
    void this.runKillPatterns(rt);
  }

  /** Runs each configured `killPatterns` entry as `pkill -f` once a server
   *  is fully stopped — catches processes that aren't a pid descendant of
   *  this server's own spawned command (e.g. a Tauri app's compiled native
   *  binary, launched by the dev CLI as a sibling process rather than a
   *  child, so it never opens a socket devhub's own child-tree scan would
   *  find). Best-effort: `pkill` exits 1 when nothing matched, which is the
   *  common case, not a failure. */
  private async runKillPatterns(rt: Runtime) {
    if (rt.config.kind !== "process" || !rt.config.killPatterns?.length) return;
    for (const pattern of rt.config.killPatterns) {
      try {
        await execFileAsync("pkill", ["-f", pattern]);
      } catch {
        // No matching process — expected most of the time.
      }
    }
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
    this.emitUpdate(id);
    this.emit(`exited:${id}`);
    // Regardless of whether this was a clean stop or a crash — either way
    // the logical server isn't running anymore, so any configured sibling
    // pattern shouldn't be left dangling for a subsequent start to collide
    // with.
    void this.runKillPatterns(rt);
  }

  private emitUpdate(id: string) {
    if (this.runtimes.has(id)) this.emit("update", id);
  }

  /** Called on daemon shutdown. Stops ONLY processes devhub itself spawned —
   *  those would be orphaned otherwise.
   *
   *  It must never touch an adopted process. Devhub now adopts every service
   *  it observes running, so that they are controllable without anyone
   *  clicking anything; those processes existed before the daemon started and
   *  have to outlive it. Killing them here turns "restart devhub" into "lose
   *  every dev server on the machine". Docker containers are left alone for
   *  the same reason. */
  shutdown() {
    for (const rt of this.runtimes.values()) {
      if (rt.config.kind === "docker") this.detachDockerLogFollower(rt);
      else if (rt.pty) this.stop(rt.config.id);
    }
  }
}
