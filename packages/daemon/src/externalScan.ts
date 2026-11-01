import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EXEC_OPTS = { timeout: 3000 };

export interface ListeningSocket {
  pid: number;
  port: number;
  command: string;
}

let lsofWarned = false;

/** Whether each observation probe last succeeded. An empty result from a probe
 *  that couldn't run is not the same fact as an empty result from one that ran
 *  and found nothing — rendering the first as the second is how devhub would
 *  show a confident, wrong "everything is fine" with Docker stopped. The UI
 *  reads this to say "hidden, not gone". */
const probes = { lsof: true, docker: true };
export const probeStatus = () => ({ ...probes });

/** Runs lsof, tolerating its exit-code-1-means-"no matches" convention. */
async function runLsof(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("lsof", args, EXEC_OPTS);
    probes.lsof = true;
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string };
    // Exit code 1 with output is lsof's "no matches" — the probe did run.
    if (typeof e.stdout === "string") {
      probes.lsof = true;
      return e.stdout;
    }
    probes.lsof = false;
    if (!lsofWarned) {
      lsofWarned = true;
      console.warn("[devhub] external-process detection disabled (lsof unavailable):", e.message);
    }
    return "";
  }
}

/** All processes with an open listening TCP socket, via `lsof -Fpcn` field output. */
export async function scanListeningSockets(): Promise<ListeningSocket[]> {
  const stdout = await runLsof(["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]);
  const results: ListeningSocket[] = [];
  let pid: number | null = null;
  let command = "";
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const tag = line[0];
    const val = line.slice(1);
    if (tag === "p") {
      pid = Number(val);
      command = "";
    } else if (tag === "c") {
      command = val;
    } else if (tag === "n" && pid != null) {
      const m = /:(\d+)$/.exec(val);
      if (m) results.push({ pid, port: Number(m[1]), command });
    }
  }
  return results;
}

/** Working directory for each pid, batched into a single lsof call. */
export async function cwdsForPids(pids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (pids.length === 0) return map;
  const stdout = await runLsof(["-a", "-d", "cwd", "-p", pids.join(","), "-Fpn"]);
  let pid: number | null = null;
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const tag = line[0];
    const val = line.slice(1);
    if (tag === "p") pid = Number(val);
    else if (tag === "n" && pid != null) map.set(pid, val);
  }
  return map;
}

/** Every listening socket, grouped by the process that owns it, with that
 *  process's working directory resolved. This is the raw observation the
 *  whole model is built on — nothing here is matched against config yet. */
export interface ObservedProcess {
  pid: number;
  command: string;
  cwd: string;
  ports: number[];
}

export async function observeProcesses(sockets: ListeningSocket[]): Promise<ObservedProcess[]> {
  if (sockets.length === 0) return [];
  const pids = [...new Set(sockets.map((s) => s.pid))];
  const cwds = await cwdsForPids(pids);

  const byPid = new Map<number, ObservedProcess>();
  for (const s of sockets) {
    const cwd = cwds.get(s.pid);
    if (!cwd) continue;
    const existing = byPid.get(s.pid);
    if (existing) {
      if (!existing.ports.includes(s.port)) existing.ports.push(s.port);
    } else {
      byPid.set(s.pid, { pid: s.pid, command: s.command, cwd, ports: [s.port] });
    }
  }
  for (const p of byPid.values()) p.ports.sort((a, b) => a - b);
  return [...byPid.values()];
}

function parseEtimeMs(etime: string): number | null {
  const trimmed = etime.trim();
  const dashIdx = trimmed.indexOf("-");
  let days = 0;
  let rest = trimmed;
  if (dashIdx !== -1) {
    days = Number(trimmed.slice(0, dashIdx));
    rest = trimmed.slice(dashIdx + 1);
  }
  const parts = rest.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) [h, m, s] = parts;
  else if (parts.length === 2) [m, s] = parts;
  else return null;
  return (((days * 24 + h) * 60 + m) * 60 + s) * 1000;
}

/** The process's implied start time (now - elapsed), or null if it isn't running.
 *  Re-deriving this on every check (rather than trusting a cached value) is what
 *  lets callers detect PID reuse: if a different process now holds this pid, its
 *  elapsed time won't line up with what was recorded when it was first tracked. */
export async function processStartedAt(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "etime="], EXEC_OPTS);
    const ms = parseEtimeMs(stdout);
    return ms == null ? null : Date.now() - ms;
  } catch {
    return null;
  }
}

export async function processGroupId(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "pgid="], EXEC_OPTS);
    const pgid = Number(stdout.trim());
    return Number.isFinite(pgid) ? pgid : null;
  } catch {
    return null;
  }
}

export interface DockerInspectState {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
}

/** One container as observed on the host. The three compose labels are what
 *  make a container attributable: `workingDir` is an exact worktree path
 *  (compose always runs from the checkout root), `project` survives even
 *  when that directory is gone, and `service` is the role. */
export interface ObservedContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  running: boolean;
  exitCode: number | null;
  composeWorkingDir: string | null;
  composeProject: string | null;
  composeService: string | null;
  /** Host-side published ports, parsed from `docker ps --format {{.Ports}}`.
   *  Without these a container's real port is observed by lsof as belonging to
   *  `com.docker.backend` and reported as foreign — devhub calling its own
   *  containers somebody else's. */
  ports: number[];
}

/** Parses the host ports out of a `docker ps` port string, e.g.
 *  `0.0.0.0:8108->8108/tcp, [::]:8108->8108/tcp, 9000/tcp` -> [8108].
 *  Entries with no `->` are container-internal and publish nothing. */
export function parseDockerPorts(spec: string | undefined): number[] {
  if (!spec) return [];
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const mapping = part.trim();
    if (!mapping.includes("->")) continue;
    const host = mapping.slice(0, mapping.indexOf("->"));
    // host is `0.0.0.0:8108`, `[::]:8108` or bare `8108` on some daemons.
    const port = Number(host.slice(host.lastIndexOf(":") + 1));
    if (Number.isInteger(port) && port > 0 && port < 65536) out.add(port);
  }
  return [...out];
}

let dockerWarned = false;

/** Runs a read-only docker CLI command, tolerating docker not being
 *  installed/running — same graceful-degradation shape as runLsof, but
 *  returns null (rather than "") on failure so callers can distinguish "no
 *  results" from "couldn't ask", which reconcileDocker relies on to avoid
 *  flapping a container's status on a transient docker CLI hiccup. */
async function runDocker(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("docker", args, EXEC_OPTS);
    probes.docker = true;
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    probes.docker = false;
    if (!dockerWarned) {
      dockerWarned = true;
      console.warn("[devhub] docker detection disabled (docker unavailable):", e.message);
    }
    return null;
  }
}

/** All containers, running or not, via `docker ps -a`. Stopped and
 *  never-started (`Created`) containers matter as much as running ones —
 *  eight of them on this machine are failed compose starts from deleted
 *  worktrees, which is exactly what the failed-start alert reports. */
export async function scanDockerContainers(): Promise<ObservedContainer[]> {
  const stdout = await runDocker([
    "ps",
    "-a",
    "--format",
    [
      "{{.ID}}",
      "{{.Names}}",
      "{{.Image}}",
      "{{.State}}",
      // Supabase CLI containers carry no compose working_dir, only their own workdir label.
      '{{or (.Label "com.docker.compose.project.working_dir") (.Label "com.supabase.cli.workdir")}}',
      '{{.Label "com.docker.compose.project"}}',
      '{{.Label "com.docker.compose.service"}}',
      "{{.Ports}}",
    ].join("\t"),
  ]);
  if (!stdout) return [];
  const results: ObservedContainer[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const [id, names, image, state, workingDir, project, service, ports] = line.split("\t");
    if (!id) continue;
    const trim = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
    results.push({
      id,
      name: (names ?? "").split(",")[0] ?? id,
      image: image ?? "",
      state: state ?? "",
      running: state === "running",
      exitCode: null,
      composeWorkingDir: trim(workingDir),
      composeProject: trim(project),
      composeService: trim(service),
      ports: parseDockerPorts(ports),
    });
  }
  return results;
}

/** A single container's live state via `docker inspect`. Deliberately one
 *  call per container (not batched like cwdsForPids) — `docker inspect`'s
 *  multi-ref output silently omits the line for any ref that doesn't exist,
 *  which would break positional alignment between the refs array and the
 *  output for every ref after the missing one. Returns null on any failure
 *  (container removed, docker CLI unavailable) — callers should treat that
 *  as "couldn't tell", not "not running". */
export async function inspectDockerContainer(ref: string): Promise<DockerInspectState | null> {
  const stdout = await runDocker(["inspect", "--format", "{{.State.Running}}\t{{.State.Pid}}\t{{.State.StartedAt}}\t{{.State.ExitCode}}", ref]);
  if (!stdout) return null;
  const [running, pid, startedAt, exitCode] = stdout.trim().split("\t");
  const pidNum = Number(pid);
  const startedMs = Date.parse(startedAt);
  return {
    running: running === "true",
    pid: pidNum > 0 ? pidNum : null,
    startedAt: Number.isFinite(startedMs) && startedMs > 0 ? startedMs : null,
    exitCode: exitCode ? Number(exitCode) : null,
  };
}
