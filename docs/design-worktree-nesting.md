# Design prompt: worktree nesting, docker compose auto-match, singleton servers

## Problem

Devhub's project model (see `docs/design-project-centric-architecture.md`) has
`Project → roots[] → servers[]`, all flat. Roots are a discovery-matching aid,
not a real hierarchy — every root in a project is a peer, and every server in
a project is a peer, with no notion that one root might be a git checkout
with several `git worktree`s, each running its own dev server and docker
stack.

This falls short for three real projects on this machine:

- **ninepigs** (`~/dev/pridbuy`, `~/dev/pridbuy-web-m3`, dormant
  `~/dev/pridbuy-web`) — already configured in devhub as one project
  (`pridbuy-web-m3` id) with two roots. Both active repos already use git
  worktrees for parallel feature branches (`pridbuy--remediation`,
  `pridbuy-web-m3--schedules-preview-icon`), living as sibling directories
  (`<repo>--<branch-slug>`), each with its own dev server and, for `pridbuy`,
  its own docker-compose stack (Laravel + MySQL via Sail). None of this is
  visible in devhub today — servers from a worktree just show up in the same
  flat list as the main checkout's servers, indistinguishable. Concretely,
  `pridbuy`'s and `pridbuy--remediation`'s compose stacks currently collide
  on `FORWARD_DB_PORT`/`REDIS_PORT`/`MAIL_PORT` (only `APP_PORT` was bumped
  for the worktree) — a bug that's invisible without worktree-aware grouping.
- **notqa** (`~/dev/notqa`, pnpm+turborepo monorepo) — already configured as
  one project with `pnpm run dev:web` as a single server. Ports are hardcoded
  constants in the monorepo's own scripts (`43100`/`43101`/`43102`); the repo
  explicitly forbids running a second instance. This project needs no new
  devhub feature — see "notqa: no change needed" below.
- **sbnotes** (`~/dev/sbnotes`, Tauri v2 app) — a `vite`+native-binary pair
  hard-pinned to port 1420 (`strictPort: true`), with no `--port`/profile
  flag and no PID/lockfile. The app's own convention (`AGENTS.md`) is
  single-instance-only: kill everything matching port 1420 or one of three
  binary-path patterns before starting again — including across worktrees.
  Devhub has no concept of "these servers are mutually exclusive, stop the
  other one first" today.

Goal: introduce a **root → worktree** tier under `Project`, computed live
(not persisted, same philosophy as roots today: "a matching aid for
discovery, not a constraint"), fold servers *and* docker containers into the
worktree that owns them, and add a narrow **singleton-group** primitive to
`ProcessServerConfig` for services like sbnotes where only one instance may
run system-wide.

## Decisions (from design discussion, resolved with the user)

1. **Worktrees are auto-discovered, silently nested** — same silent-fold
   philosophy as root-matching today (decision 6 in the prior design doc).
   No confirm-first step for a newly-appeared `git worktree`.
2. **Grouping is `Root → Worktree`, always** — every root shows its worktree
   tier even when it only has one worktree (its own primary checkout). This
   keeps the tree shape consistent regardless of whether a repo has grown
   feature worktrees yet, rather than collapsing single-worktree roots to
   look like today's flat list.
3. **Worktree identity comes from `git worktree list`, not path-prefix
   matching.** Worktrees for these repos are *siblings* on disk
   (`~/dev/pridbuy--remediation` next to `~/dev/pridbuy`), not nested inside
   the root directory — so the existing root subtree-match rule
   (`cwd.startsWith(root.path)`) cannot discover them. `git worktree list
   --porcelain`, run against each git-repo root, is ground truth for which
   paths belong to which root, regardless of where they sit on disk.
4. **Docker containers auto-fold too, via compose `working_dir`.** This
   closes the gap the prior design doc flagged but never implemented
   (decision 4 there). `docker inspect`'s
   `com.docker.compose.project.working_dir` label gives an exact path —
   compose's working_dir is always the checkout root, so this is an exact
   match against a worktree path, no prefix ambiguity.
5. **notqa needs no new feature.** Its `dev:web` fan-out already surfaces as
   nested children via devhub's existing process-ancestry `ChildProcess`
   detection (`findChildServers` in `externalScan.ts`) — that mechanism
   already works today given the current config (one `ServerConfig` running
   `pnpm run dev:web`, cwd `~/dev/notqa`). No monorepo has worktrees in play
   here, so the root→worktree tier is a no-op for this project (one root,
   one implicit "main" worktree, nothing to nest under it).
6. **sbnotes gets a singleton-group primitive**, not a bespoke sbnotes
   feature: `ProcessServerConfig` gains an optional `singletonGroup` string
   and optional `killPatterns` string array. Starting a server with a
   `singletonGroup` set stops any other *running* server in the same group
   first (across worktrees/projects); stopping a singleton-group server also
   runs `pkill -f` for each of its `killPatterns`, to catch processes that
   aren't a pid-ancestry descendant of the spawned command (sbnotes' compiled
   native binary is launched by the Tauri CLI as a sibling process, not
   something devhub's own child-tree walk would find since it never opens a
   listening socket itself).
7. **Port-collision warnings across sibling worktrees are out of scope for
   this pass** — the `FORWARD_DB_PORT` collision in pridbuy is real and
   worth catching, but it needs its own design (parsing `.env`/compose port
   mappings and diffing them) and is deferred to a follow-up.

## Data model changes

All additions are **wire-only** (computed by the daemon each poll tick,
never persisted to `devhub.config.json`) — consistent with roots today being
"a matching aid, not a constraint."

```ts
// packages/shared/src/index.ts

/** One `git worktree` belonging to a project root — computed live from
 *  `git worktree list`, never persisted. The root's own primary checkout is
 *  included as a worktree too (isMain: true) so grouping is uniform. */
export interface Worktree {
  id: string;              // the worktree's absolute path — stable, globally unique
  rootId: string;          // which ProjectRoot (repo) this belongs to
  path: string;
  branch: string | null;   // null when checked out at a detached HEAD
  head: string;            // short commit sha, for display
  isMain: boolean;         // true for the root's own primary checkout
}

export interface ProjectMeta {
  id: string;
  name: string;
  roots: ProjectRoot[];
  worktrees: Worktree[];   // NEW — flattened across all this project's roots
}

interface ServerSnapshotBase {
  id: string;
  projectId: string;
  name: string;
  port?: number;
  state: ServerState;
  detected: DetectedExternal | null;
  rootId: string | null;       // NEW — resolved by longest worktree-path match
  worktreeId: string | null;   // NEW — resolved alongside rootId
}

export interface ProcessServerConfig extends ServerConfigBase {
  kind: "process";
  command: string;
  cwd: string;
  singletonGroup?: string;     // NEW — starting this stops any other running
                                //       server sharing the same group string
  killPatterns?: string[];     // NEW — extra `pkill -f` patterns run on stop,
                                //       for processes not in this server's own
                                //       pid tree (e.g. a sibling native binary)
}
```

`DockerContainerInfo` and the docker branch of `inspectDockerContainer`'s
return shape gain a `composeWorkingDir: string | null` field, used only for
matching — not shown in the UI as its own thing.

## Matching algorithm

### Root/worktree discovery

For each `ProjectRoot` that is a git repository (`git -C <path> rev-parse
--is-inside-work-tree`), run `git worktree list --porcelain` to get every
worktree tied to that repo, including its own primary checkout as the first
entry. Non-git roots (rare) get a single synthetic worktree covering the
whole root path, `isMain: true`, `branch: null` — so decision 2 (always show
the worktree tier) holds uniformly.

This can run on the same 5s poll tick as everything else in `index.ts` — `git
worktree list` is cheap (no working-tree scan, just reads
`.git/worktrees/*`) — or on a slower cadence if it turns out to add
noticeable tick latency; not worth a separate scheduler up front.

### Owning a discovered/configured server

Reuses `ProjectStore.findRootMatch` unchanged to decide *which project* a cwd
belongs to (existing behavior, longest-root-path-wins). Once a project is
known, resolve `rootId`/`worktreeId` by longest-prefix match of the server's
`cwd` against that project's `worktrees[].path` (not `roots[].path]` — a
worktree's path may not be a subdirectory of its root's path, so this must
run against the worktree list, not the raw roots):

```
resolveOwner(cwd, project) :=
  best = argmax_{w in project.worktrees} (
    w.path.length such that cwd === w.path || cwd.startsWith(w.path + '/')
  )
  return best ? { rootId: best.rootId, worktreeId: best.id } : { rootId: null, worktreeId: null }
```

A server manually pointed somewhere outside every known worktree (still
valid — roots/worktrees are a matching aid, not a constraint) just gets
`rootId: null, worktreeId: null` and renders in an "other" bucket under its
project, the way today's flat list already handles a server outside every
root.

### Docker

```
resolveDockerOwner(container) :=
  workingDir = compose working_dir label from `docker inspect`
  if workingDir: exact match against worktrees[].path (compose's working_dir
                 is always the checkout root — no prefix walk needed)
  else: no owner resolved — same as a process with no matching root today
```

Auto-fold (creating a real `DockerServerConfig` from a previously-unmatched
container) follows the same silent-fold shape `index.ts`'s scan tick already
uses for processes (`store.findRootMatch` → `store.createServer`): if a
discovered container's compose working_dir falls under some project's
worktree, create the `DockerServerConfig` there instead of leaving it in the
flat "Not in any project" tray.

## UI changes

Today `Dashboard.tsx` renders one flat "Servers" section and one flat
"Docker" section per selected project (`processItems`/`dockerItems`,
`Dashboard.tsx:946-947`) — there's no rendering of `roots` as groups at all,
despite `ProjectRoot[]` existing since the prior design pass. This pass adds
two nesting levels above that existing per-kind split:

```
Project (rail entry, unchanged)
└─ Root group (one per ProjectRoot, header = root.label ?? basename(root.path))
   └─ Worktree group (one per Worktree under that root, header = branch name
      or "main"; always rendered per decision 2)
      ├─ Servers section (existing ServiceCard list/reorder, scoped to this
      │  worktree's servers)
      └─ Docker section (same, scoped to this worktree's containers)
```

Existing drag-reorder (`Reorder.Group`, `processOrderOverride`/
`dockerOrderOverride`) stays scoped the same way it is today — just filtered
down to one worktree's servers instead of the whole project's, so dragging
within a worktree's section doesn't touch another worktree's order.

## Open items for the implementer

- **Worktree id stability across renames/removal**: using the absolute path
  as `Worktree.id` means a removed-then-recreated worktree at the same path
  is indistinguishable from the original — acceptable, matches how server
  ids work today (nothing tracks "history" of a removed entity).
- **`pridbuy` root's checkout is on a detached HEAD** (observed:
  `27e9614 (detached HEAD)`) — `branch: null` for that worktree; confirm the
  UI has a sane label for detached-HEAD main checkouts (e.g. "detached
  @27e9614") rather than blank.
- **Root label vs worktree label collision**: when a root has only its main
  worktree, the root header and the worktree header could look redundant
  ("pridbuy-web" / "main"). Acceptable per decision 2, but worth a compact
  single-line treatment when a root's worktree list has exactly one entry.
- **`killPatterns` safety**: `pkill -f <pattern>` is a broad match — a
  poorly-scoped pattern could kill unrelated processes. Document that
  patterns should be as specific as the sbnotes examples
  (`target/debug/sbnotes`, `sbnotes.app/Contents/MacOS/sbnotes`), not bare
  binary names.
- **Singleton stop ordering**: starting server B in the same
  `singletonGroup` as running server A must fully stop A (and run A's
  `killPatterns`) *before* spawning B, not concurrently — otherwise both
  processes race for the same port. `processManager.ts`'s existing
  start/stop already await process exit; the new logic just needs to await
  the stop of every other same-group server before proceeding with start.
- **notqa**: no daemon/UI change required; flagged here only so the
  implementer doesn't go looking for work that isn't there.

## Non-goals (this pass)

- Port-collision detection across sibling worktrees (decision 7).
- Any change to notqa's config or devhub's daemon for notqa (decision 5).
- True concurrent multi-instance support for sbnotes (would require changing
  sbnotes' own `vite.config.ts`/`tauri.conf.json` to take a per-worktree
  port, mirroring `pridbuy-web-m3`'s pattern) — singleton-group tracking
  (decision 6) is the chosen v1 instead.
