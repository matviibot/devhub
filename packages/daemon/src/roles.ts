import { basename } from "node:path";
import type { PortPolicy, ServiceMode } from "@devhub/shared";

/** Path segments that mean "this is build output, not source". Stripping
 *  them is what collapses `apps/web/.next/standalone/apps/web` back onto the
 *  same row as `apps/web` — without it, one app built two ways became two
 *  permanently distinct servers, which is where seven duplicate `web` rows
 *  came from. Longest-first so `target/debug` wins over a bare `build`. */
const BUILD_SEGMENTS = [".next/standalone", "target/release", "target/debug", ".output/server", "dist", "build", "out"];

export interface DerivedRole {
  role: string;
  /** Source-relative directory the launcher should run in, or null for the
   *  worktree root. Always the *stripped* path — the dev directory, never
   *  the build-output one. */
  dir: string | null;
  mode: ServiceMode;
}

/** Strips a build-output segment and everything after it. `apps/web/.next/
 *  standalone/apps/web` -> `apps/web`. */
function stripBuildOutput(rel: string): string | null {
  for (const seg of BUILD_SEGMENTS) {
    const at = rel === seg ? 0 : rel.startsWith(`${seg}/`) ? 0 : rel.indexOf(`/${seg}/`) !== -1 ? rel.indexOf(`/${seg}/`) : rel.endsWith(`/${seg}`) ? rel.length - seg.length - 1 : -1;
    if (at !== -1) return rel.slice(0, at);
  }
  return null;
}

/** Role of a working directory within the worktree that owns it.
 *
 *  `deriveRole("/r/apps/web", "/r", "/r")`                         -> web, dir apps/web, dev
 *  `deriveRole("/r/apps/web/.next/standalone/apps/web","/r","/r")`  -> web, dir apps/web, built
 *  `deriveRole("/r--feat", "/r--feat", "/r")`                      -> r,   dir null,     dev
 *
 *  That last case is load-bearing. A role has to name the same service in
 *  every worktree of a repo, because launchers are declared once per repo
 *  and inherited. Naming a worktree-root service after its own directory
 *  would give `sbnotes`, `sbnotes--docs-collapse-by-date-idea` and
 *  `sbnotes--feat-pomodoro-compact-redesign` three different roles for one
 *  app — which is exactly the per-worktree duplication the rewrite exists to
 *  remove — so the REPO's basename names it instead.
 *
 *  A deep path whose build segment we don't recognise falls back to its own
 *  basename: one extra row, which is harmless, rather than collapsing onto
 *  the worktree root, which would put it in the wrong row. */
export function deriveRole(cwd: string, worktreePath: string, repoPath: string = worktreePath): DerivedRole {
  const base = worktreePath.replace(/\/$/, "");
  let rel = cwd === base ? "" : cwd.startsWith(`${base}/`) ? cwd.slice(base.length + 1) : "";
  const stripped = stripBuildOutput(rel);
  const mode: ServiceMode = stripped === null ? "dev" : "built";
  if (stripped !== null) rel = stripped;
  if (!rel) return { role: basename(repoPath.replace(/\/$/, "")), dir: null, mode };
  return { role: basename(rel), dir: rel, mode };
}

/** Stable id for a service row. Worktree path plus role is enough to be
 *  globally unique — a worktree belongs to exactly one repo, which belongs
 *  to exactly one project. */
export function serviceId(worktreePath: string, role: string): string {
  return `svc:${worktreePath}::${role}`;
}

export function looseServiceId(projectId: string, role: string): string {
  return `loose:${projectId}::${role}`;
}

export function orphanId(kind: "process" | "docker", key: string | number): string {
  return `orphan:${kind}:${key}`;
}

/** Deterministic per-worktree port for an `alloc` launcher, so a worktree
 *  keeps the same port across daemon restarts (nothing about assignment is
 *  persisted). Hash the worktree path into the range, then probe upward
 *  past ports already claimed this tick — probing only moves the colliding
 *  worktree, never the ones that hashed cleanly. */
export function allocatePort(policy: Extract<PortPolicy, { ports: "alloc" }>, worktreePath: string, role: string, taken: Set<number>): number | null {
  const [from, to] = policy.range;
  const span = to - from + 1;
  if (span <= 0) return null;

  let hash = 2166136261;
  for (const ch of `${worktreePath}::${role}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const start = Math.abs(hash) % span;
  for (let i = 0; i < span; i++) {
    const port = from + ((start + i) % span);
    if (!taken.has(port)) return port;
  }
  return null;
}

/** Launchers with a `fixed` policy may only run one instance of a role per
 *  repo, so every worktree's copy shares this group and starting one stops
 *  the others. Derived from the repo rather than hand-set per server, which
 *  is what makes it cover notqa and toolboy and not just sbnotes. */
export function singletonGroupFor(repoPath: string, role: string): string {
  return `${repoPath}::${role}`;
}
