import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

/** Matches already-listening processes to stopped servers by exact cwd equality. */
export async function findExternalMatches(candidates: { id: string; cwd: string }[]): Promise<Map<string, ExternalMatch>> {
  const matches = new Map<string, ExternalMatch>();
  if (candidates.length === 0) return matches;
  const sockets = await scanListeningSockets();
  if (sockets.length === 0) return matches;
  const cwds = await cwdsForPids([...new Set(sockets.map((s) => s.pid))]);
  for (const c of candidates) {
    const hit = sockets.find((s) => cwds.get(s.pid) === c.cwd);
    if (hit) matches.set(c.id, { pid: hit.pid, port: hit.port });
  }
  return matches;
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
