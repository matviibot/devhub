import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { DiscoveredDocker, DiscoveredProcess } from "@devhub/shared";

const execFileAsync = promisify(execFile);
const EXEC_OPTS = { timeout: 3000 };

export interface ListeningSocket {
  pid: number;
  port: number;
  command: string;
}

export interface ExternalMatch {
  pid: number;
  port: number;
}

let lsofWarned = false;

/** Runs lsof, tolerating its exit-code-1-means-"no matches" convention. */
async function runLsof(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("lsof", args, EXEC_OPTS);
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string };
    if (typeof e.stdout === "string") return e.stdout;
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

export interface ScanResult {
  /** Listeners whose cwd matches a stopped, already-configured server. */
  matches: Map<string, ExternalMatch>;
  /** Listeners under $HOME with a package.json that match no configured server at all. */
  discovered: DiscoveredProcess[];
}

/** One combined lsof pass: matches already-listening processes against stopped
 *  configured servers (by cwd) and, separately, surfaces listeners that don't
 *  belong to any configured server as candidates for a brand-new project. */
export async function scanExternalProcesses(
  candidates: { id: string; cwd: string }[],
  configuredCwds: Set<string>,
  excludeRoot: string,
): Promise<ScanResult> {
  const empty: ScanResult = { matches: new Map(), discovered: [] };
  const sockets = await scanListeningSockets();
  if (sockets.length === 0) return empty;

  const cwds = await cwdsForPids([...new Set(sockets.map((s) => s.pid))]);

  const matches = new Map<string, ExternalMatch>();
  for (const c of candidates) {
    const hit = sockets.find((s) => cwds.get(s.pid) === c.cwd);
    if (hit) matches.set(c.id, { pid: hit.pid, port: hit.port });
  }

  const home = homedir();
  const seenCwds = new Set<string>();
  const discovered: DiscoveredProcess[] = [];
  for (const s of sockets) {
    const cwd = cwds.get(s.pid);
    if (!cwd || seenCwds.has(cwd) || configuredCwds.has(cwd)) continue;
    if (cwd !== home && !cwd.startsWith(`${home}/`)) continue;
    // Never suggest devhub's own checkout as a project to manage.
    if (cwd === excludeRoot || cwd.startsWith(`${excludeRoot}/`)) continue;
    // MVP heuristic: only suggest directories that look like a JS/Node project.
    // Misses Python/Go/Rust/etc. dev servers — worth widening later.
    if (!existsSync(join(cwd, "package.json"))) continue;
    seenCwds.add(cwd);
    discovered.push({ kind: "process", cwd, port: s.port, pid: s.pid, suggestedName: basename(cwd) });
  }

  return { matches, discovered };
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

export interface DockerContainerInfo {
  id: string;
  names: string[];
  image: string;
  running: boolean;
}

export interface DockerInspectState {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
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
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (!dockerWarned) {
      dockerWarned = true;
      console.warn("[devhub] docker detection disabled (docker unavailable):", e.message);
    }
    return null;
  }
}

/** All containers, running or not, via `docker ps -a` — stopped containers
 *  (e.g. after `docker compose down`) are still worth surfacing so the user
 *  can configure and later start them from devhub. */
export async function scanDockerContainers(): Promise<DockerContainerInfo[]> {
  const stdout = await runDocker(["ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}"]);
  if (!stdout) return [];
  const results: DockerContainerInfo[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const [id, names, image, state] = line.split("\t");
    if (!id) continue;
    results.push({ id, names: names ? names.split(",") : [], image: image ?? "", running: state === "running" });
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
