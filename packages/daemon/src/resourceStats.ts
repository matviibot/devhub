import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitState, ResourceStats, ServiceView, Snapshot } from "@devhub/shared";

const run = promisify(execFile);
// C locale so `%cpu` never comes back with a decimal comma.
const OPTS = { timeout: 5000, maxBuffer: 16 << 20, env: { ...process.env, LC_ALL: "C" } };

interface Proc {
  ppid: number;
  cpu: number;
  rss: number;
}

/** One `ps` pass over every process. macOS `%cpu` is a decaying average, which
 *  suits a dashboard better than a jumpy per-tick delta. */
async function sampleProcesses(): Promise<Map<number, Proc>> {
  const procs = new Map<number, Proc>();
  try {
    const { stdout } = await run("ps", ["-A", "-o", "pid=,ppid=,%cpu=,rss="], OPTS);
    for (const line of stdout.split("\n")) {
      const [pid, ppid, cpu, rss] = line.trim().split(/\s+/).map(Number);
      if (pid > 0) procs.set(pid, { ppid, cpu: cpu || 0, rss: (rss || 0) * 1024 });
    }
  } catch {
    // ps unavailable: no stats this tick, everything else still renders.
  }
  return procs;
}

/** The root pid and all its descendants. The listener alone undercounts:
 *  `npm run dev` does its work in node/esbuild children. */
function subtree(root: number, children: Map<number, number[]>): number[] {
  const out: number[] = [];
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop()!;
    out.push(pid);
    stack.push(...(children.get(pid) ?? []));
  }
  return out;
}

const UNITS: Record<string, number> = { B: 1, KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1024 ** 2, GB: 1e9, GIB: 1024 ** 3 };
export function parseBytes(s: string): number {
  const m = /^([\d.]+)\s*([a-z]+)$/i.exec(s.trim());
  return m ? Math.round(Number(m[1]) * (UNITS[m[2].toUpperCase()] ?? 0)) : 0;
}

/** `docker stats` blocks ~1–2s, so it refreshes in the background every few
 *  ticks and rows read the last result. */
let dockerStats = new Map<string, ResourceStats>();
let dockerInflight = false;
function refreshDockerStats() {
  if (dockerInflight) return;
  dockerInflight = true;
  run("docker", ["stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}"], OPTS)
    .then(({ stdout }) => {
      const next = new Map<string, ResourceStats>();
      for (const line of stdout.split("\n")) {
        const [name, cpu, mem, pids] = line.split("\t");
        if (!name || mem == null) continue;
        next.set(name, { cpu: parseFloat(cpu) || 0, rssBytes: parseBytes(mem.split("/")[0]), procs: Number(pids) || 0 });
      }
      dockerStats = next;
    })
    .catch(() => {})
    .finally(() => (dockerInflight = false));
}

/** Per-worktree git state, refreshed in the background — `git status` on a
 *  large repo can take seconds and must never stall the tick. */
const gitStates = new Map<string, GitState>();
let gitInflight = false;
export function parseGitStatus(stdout: string): GitState {
  let changed = 0;
  let ahead: number | null = null;
  let behind: number | null = null;
  for (const line of stdout.split("\n")) {
    const ab = /^# branch\.ab \+(\d+) -(\d+)/.exec(line);
    if (ab) [ahead, behind] = [Number(ab[1]), Number(ab[2])];
    else if (line && !line.startsWith("#")) changed++;
  }
  return { changed, ahead, behind };
}
function refreshGit(paths: string[]) {
  if (gitInflight) return;
  gitInflight = true;
  Promise.all(
    paths.map(async (path) => {
      try {
        // --no-optional-locks: never contend with an agent's own git commands.
        const { stdout } = await run("git", ["--no-optional-locks", "-C", path, "status", "--porcelain=v2", "--branch"], OPTS);
        gitStates.set(path, parseGitStatus(stdout));
      } catch {
        gitStates.delete(path);
      }
    }),
  ).finally(() => (gitInflight = false));
  for (const path of gitStates.keys()) if (!paths.includes(path)) gitStates.delete(path);
}

const DOCKER_EVERY = 3;
const GIT_EVERY = 6;
let tick = 0;

const round = (s: ResourceStats): ResourceStats => ({ cpu: Math.round(s.cpu * 10) / 10, rssBytes: s.rssBytes, procs: s.procs });

/** Attaches live CPU/memory to every running service and its project, and git
 *  state to every worktree. Mutates the freshly built snapshot in place. */
export async function annotateStats(snapshot: Snapshot): Promise<void> {
  if (tick % DOCKER_EVERY === 0) refreshDockerStats();
  if (tick % GIT_EVERY === 0) refreshGit(snapshot.projects.flatMap((p) => p.repos.flatMap((r) => (r.isGit ? r.worktrees.map((w) => w.path) : []))));
  tick++;

  const procs = await sampleProcesses();
  const children = new Map<number, number[]>();
  for (const [pid, p] of procs) {
    const list = children.get(p.ppid);
    if (list) list.push(pid);
    else children.set(p.ppid, [pid]);
  }
  const sum = (pids: Iterable<number>): ResourceStats => {
    const s = { cpu: 0, rssBytes: 0, procs: 0 };
    for (const pid of pids) {
      const p = procs.get(pid);
      if (!p) continue;
      s.cpu += p.cpu;
      s.rssBytes += p.rss;
      s.procs++;
    }
    return s;
  };

  for (const project of snapshot.projects) {
    // A set, so two rows observing the same process tree count it once.
    const projectPids = new Set<number>();
    const projectDocker = new Set<string>();
    const visit = (s: ServiceView) => {
      if (s.status !== "running" && s.status !== "starting") return;
      if (s.kind === "docker") {
        const d = s.container ? dockerStats.get(s.container) : undefined;
        if (d && s.container) {
          s.stats = round(d);
          projectDocker.add(s.container);
        }
      } else if (s.pid != null && procs.has(s.pid)) {
        const pids = subtree(s.pid, children);
        pids.forEach((pid) => projectPids.add(pid));
        s.stats = round(sum(pids));
      }
    };
    for (const repo of project.repos) {
      for (const wt of repo.worktrees) {
        const git = gitStates.get(wt.path);
        if (git) wt.git = git;
        wt.services.forEach(visit);
      }
    }
    project.looseServices.forEach(visit);
    if (projectPids.size || projectDocker.size) {
      const total = sum(projectPids);
      for (const name of projectDocker) {
        const d = dockerStats.get(name)!;
        total.cpu += d.cpu;
        total.rssBytes += d.rssBytes;
        total.procs += d.procs;
      }
      project.stats = round(total);
    }
  }
}
