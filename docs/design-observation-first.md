# Design prompt: observation-first model (repos, worktrees, launchers)

Supersedes the data-model halves of
`docs/design-project-centric-architecture.md` and
`docs/design-worktree-nesting.md`. Their *grouping* instincts were right;
their *persistence* model is what produced the current state.

## Problem

Devhub's config has rotted into noise, and the UI faithfully renders the
noise. Measured on this machine on 2026-09-16, against `lsof`,
`docker ps -a` and `git worktree list`:

**Ground truth — what is actually listening:**

| Port | cwd | |
|---|---|---|
| 43100 / 43101 / 43102 | `notqa--danger-tweaks/{apps/api,apps/web,workers/telegram-tdlib}` | real, configured |
| 43151 | `notqa--artwork-fallback/apps/web/.next/standalone/apps/web` | **worktree deleted from disk** |
| 43153 | `notqa--polish-batch/apps/web/.next/standalone/apps/web` | **worktree deleted from disk** |
| 5180 / 8787 | `toolboy`, `toolboy/backend` | real, configured |

Docker: 5 containers up (`notqa-{typesense,postgres,redis}`,
`pridbuy-{laravel,mysql}`), 8 stuck in `Created`.

**What devhub displays instead:**

- The `notqa` project carries **27 `ServerConfig` entries**. Fifteen of them
  name worktree directories that no longer exist (`--glass-ink`,
  `--press-hitbox`, `--keyboard-model`, `--text-selection`,
  `--auth-restyle`, `--danger-hue`, `--library-add-refresh`). The rail
  reads `18/27`; six things under notqa are genuinely up.
- Rows render `up 10h 28m` against `:43122`, `:43123`, `:43124`, `:43125`.
  Nothing is listening on any of those ports.
- All five entries in the alerts panel are false. `:43101 claimed by
  notqa/web + notqa/web + notqa/web` is three stale config rows describing
  one process.
- The two genuinely leaked processes — `:43151` and `:43153`, orphaned
  Next.js standalone builds whose source worktrees are gone — appear
  nowhere in the UI.
- `pridbuy` carries three `pnpm run dev` servers all configured on port
  **3100** (`--direction-icon-unification`,
  `--m3-component-consolidation`, `--bottom-nav-import-split-button`); none
  of those worktrees still exists. `sbnotes` carries three servers all on
  **1420**.
- The `unassigned` project is six `Created` containers from deleted
  worktrees. Not unassigned — dead.

Net: devhub currently reports five alarms that are all fake and zero alarms
for the two real orphans. It is less informative than `lsof`.

### Why — three decisions that compound

1. **Silent auto-fold writes to permanent config.** `index.ts:98-107` turns
   every discovered process under a root into a real `ServerConfig` and
   persists it to `devhub.config.json`. Nothing ever removes one. Worktrees
   live for days; the config is forever. Growth is monotonic by
   construction. (This is decision 6 of the project-centric doc working
   exactly as specified — the specification is the bug.)
2. **Server identity is `cwd`.** A cwd is an accident of how something was
   launched. `apps/web` and `apps/web/.next/standalone/apps/web` are the
   same service built two ways, but become two permanently distinct
   servers. Hence seven rows all named `web` in the `OTHER` bucket.
3. **`ServerConfig` means two different things** — "a thing I declared I can
   run" and "a thing that happens to be running". An observation is
   promoted to a declaration with no path back, and `18/27` is a ratio of
   two incompatible units.

The worktree pass then layered structure on top of the rot rather than
draining it: the always-render-worktree rule produces four `no servers here
yet` groups, `CLIP-EXPORT` and `FEATURE/CLIP-EXPORT` read as duplicates,
`NOTQA / ↳ MAIN` is a double header for one thing, and the `OTHER` fallback
bucket is larger than every real group combined.

## Decisions (from design discussion, resolved with the user)

1. **Observation is primary; config is a thin overlay.** Discovery persists
   nothing, ever. The config file holds repos, launchers and preferences —
   never a record of something that was once seen running.
2. **Devhub keeps start/stop, via per-repo launchers.** It is not reduced to
   a pure monitor. A launcher is declared once on a *repo* and inherited by
   every worktree of that repo, so adding a worktree costs zero config.
   This is the mechanism that actually stops the growth.
3. **Stale entries are dropped, not migrated.** The 15 dead notqa rows and
   the 8 dead containers simply stop existing on first load under the new
   model — no review prompt, no graveyard tier. A row exists only if the
   thing is running or a launcher declares it.
4. **Repo grouping is kept.** `Project` stays a real tier above `Repo`, so
   `~/dev/pridbuy` (Laravel/Sail) and `~/dev/pridbuy-web-m3` (pnpm) show as
   one unit. The repo tier is **rendered only when a project has two or
   more repos** — `notqa`, `sbnotes` and `toolboy` collapse it away, which
   is what removes the `NOTQA / ↳ MAIN` double header.
5. **Launchers carry a port policy, `fixed` or `alloc`.** Inheriting a
   launcher across worktrees forces the question the prior two docs
   deferred. `fixed` means the repo hardcodes its ports and forbids a
   second instance; `alloc` means devhub assigns a per-worktree port from a
   range. See "Port policy" below. This generalises and replaces the
   `singletonGroup` primitive proposed in the worktree doc.
6. **Bootstrapping is explicit, and is the exact inverse of today's silent
   fold.** Devhub observes a running process and offers **"save as
   launcher"**; it never writes config on its own. notqa's three launchers
   become three clicks instead of hand-written JSON.

## Data model

`devhub.config.json` becomes, in full:

```ts
export interface DevhubConfig {
  projects: Project[];
}

export interface Project {
  id: string;
  name: string;
  repos: Repo[];
  /** Escape hatch: a launcher not tied to any repo, for a one-off that
   *  lives outside every checkout. Roots/worktrees are a matching aid, not
   *  a constraint — that principle survives. */
  looseLaunchers?: Launcher[];
}

export interface Repo {
  /** Tilde-form absolute path to the primary checkout. */
  path: string;
  label?: string;
  launchers?: Launcher[];
  /** Policy for this repo's docker-compose stack, if it has one. */
  compose?: PortPolicy;
}

export interface Launcher {
  /** Stable identity of a service within a repo — see "Role derivation".
   *  Preferences (order, renames) key on this, never on a generated id. */
  role: string;
  /** Shell command, run from `<worktree>/<dir>`. */
  cmd: string;
  /** Subdirectory relative to the worktree root. Omitted = worktree root. */
  dir?: string;
  policy: PortPolicy;
}

export type PortPolicy =
  | { ports: "fixed" }
  | { ports: "alloc"; range: [number, number]; env?: string };
```

Everything else is **computed each poll tick and never written**:

```ts
/** A live view, rebuilt every tick. Nothing here survives a daemon restart. */
export interface RepoView {
  path: string;
  worktrees: WorktreeView[];
  /** Listening processes and containers attributable to this repo whose
   *  owning worktree no longer exists. The highest-value thing devhub
   *  shows. */
  orphans: Orphan[];
}

export interface WorktreeView {
  path: string;
  branch: string | null;   // null at detached HEAD
  head: string;
  isMain: boolean;
  services: ServiceView[];
}

export interface ServiceView {
  role: string;
  /** Present when a launcher declares this role — enables start/stop. */
  launcher: Launcher | null;
  /** Present when something is actually running under this role. */
  observed: Observed | null;
  /** How the running thing was built. A dev server and a standalone build
   *  of the same app are one row in two modes, not two rows. */
  mode: "dev" | "built" | null;
}

export interface Observed {
  kind: "process" | "docker";
  pid?: number;
  container?: string;
  cwd: string;
  ports: number[];        // every port this thing is actually listening on
  startedAt: number;
  status: "running" | "created" | "exited";
  exitCode?: number;
}

export interface Orphan {
  kind: "process" | "docker";
  pid?: number;
  container?: string;
  cwd: string;             // the path that no longer exists / is untracked
  ports: number[];
  reason: "worktree-gone" | "cwd-deleted";
}
```

Note what is gone: `ServerConfig`, `ServerSnapshot`, `ProjectRoot`,
`DiscoveredProject`, `ignoredDiscovered`, and the `rootId`/`worktreeId`
fields the worktree doc added. Server ids are gone too — they were
regenerated on every fold and nothing could key on them stably.

### Example: this machine, after the change

```jsonc
{
  "projects": [
    {
      "id": "notqa", "name": "notqa",
      "repos": [{
        "path": "~/dev/notqa",
        "compose": { "ports": "fixed" },
        "launchers": [
          { "role": "web",            "cmd": "npm run dev", "dir": "apps/web",                 "policy": { "ports": "fixed" } },
          { "role": "api",            "cmd": "npm run dev", "dir": "apps/api",                 "policy": { "ports": "fixed" } },
          { "role": "telegram-tdlib", "cmd": "npm run dev", "dir": "workers/telegram-tdlib",   "policy": { "ports": "fixed" } }
        ]
      }]
    },
    {
      "id": "pridbuy", "name": "pridbuy",
      "repos": [
        { "path": "~/dev/pridbuy",
          "compose": { "ports": "alloc", "range": [33060, 33099] } },
        { "path": "~/dev/pridbuy-web-m3",
          "launchers": [{ "role": "web", "cmd": "pnpm run dev", "policy": { "ports": "alloc", "range": [3100, 3199], "env": "PORT" } }] }
      ]
    },
    {
      "id": "sbnotes", "name": "sbnotes",
      "repos": [{ "path": "~/dev/sbnotes",
        "launchers": [{ "role": "app", "cmd": "npm run app", "policy": { "ports": "fixed" } }] }]
    },
    {
      "id": "toolboy", "name": "toolboy",
      "repos": [{ "path": "~/dev/toolboy", "launchers": [
        { "role": "web",   "cmd": "PORT=5180 npm run dev", "policy": { "ports": "fixed" } },
        { "role": "relay", "cmd": "npm run dev", "dir": "backend", "policy": { "ports": "fixed" } }
      ] }]
    }
  ]
}
```

~50 lines replacing 11KB, and hand-editable — which the current file is not.
`toolboy`'s `web` is `fixed` deliberately and must stay on 5180: the port is
pinned with `strictPort` and browser-stored favourites are keyed to it.

## Port policy

A launcher declared once on a repo and inherited by every worktree means
every worktree wants the same port. That is already the live bug in three
places on this machine.

**`fixed`** — the repo hardcodes its ports and forbids a second instance.
- `notqa`: `43100`/`43101`/`43102` are constants in the monorepo's own
  scripts.
- `sbnotes`: `strictPort: true` on 1420, no `--port` flag, no lockfile.
- `toolboy`: 5180 is pinned and load-bearing.

Starting role *R* in worktree *B* must first fully stop role *R* in every
other worktree of the same repo, awaiting exit before spawning — otherwise
both race for the port. This is the `singletonGroup` behaviour from the
worktree doc, derived from the repo instead of hand-set per server, which
means it covers notqa and toolboy too rather than only sbnotes. The
`killPatterns` escape hatch from that doc is still required for sbnotes
(the Tauri CLI launches the native binary as a sibling, not a pid-tree
descendant) and moves onto `Launcher` as an optional field; the safety note
about `pkill -f` scoping carries over unchanged.

**`alloc`** — the launcher takes a port via env var or flag, and devhub
assigns one per worktree from `range`, deterministically (hash the worktree
path into the range, probe upward on collision) so a worktree keeps its
port across restarts. This is the `3100` pattern that was being maintained
by hand, done by devhub so the pridbuy-web-m3 worktrees stop colliding.

Docker compose stacks take the same two policies. For `alloc`, devhub sets
the relevant `*_PORT` env vars when invoking compose. This is what makes the
port-collision detection deferred as decision 7 of the worktree doc nearly
free: the eight `Created` containers are almost certainly compose port
collisions, and an observed port table names the conflict without parsing
`.env` or compose YAML.

## Matching algorithm

### Worktree discovery

Unchanged from `docs/design-worktree-nesting.md`: `git worktree list
--porcelain` per repo, primary checkout included as `isMain`, non-git repos
get one synthetic worktree. Runs on the existing 5s tick.

### Role derivation

For an observed process with cwd `C` under worktree `W`, the role is the
path of `C` relative to `W`, **after stripping build-output segments**:

```
rel(C, W)        := C.slice(W.length + 1)          // "" for the worktree root
strip(rel)       := rel with any of these segments and everything between
                    them removed: ".next/standalone", "dist", "build",
                    "out", "target/debug", "target/release"
role(C, W)       := basename(strip(rel)) || basename(W)
mode(C, W)       := strip(rel) !== rel ? "built" : "dev"
```

Worked: `notqa--keyboard-model/apps/web/.next/standalone/apps/web` →
`strip` → `apps/web` → role `web`, mode `built`. Same row as
`apps/web` running `npm run dev`, which is role `web`, mode `dev`. The seven
duplicate `web` rows collapse to one.

A launcher's role wins over a derived one when both are present; the
preferences file may rename a derived role (toolboy's `backend` → `relay`).

### Ownership and orphans

```
owner(C) := the worktree W, across all repos, with the longest path such
            that C === W.path or C.startsWith(W.path + '/')

orphan(C) := owner(C) is null AND either
             (a) C does not exist on disk                → "cwd-deleted"
             (b) C is under <repo-parent>/<repo-basename>--*
                 for some known repo                     → "worktree-gone"
```

Rule (b) is what attributes `:43151` (`notqa--artwork-fallback`) and
`:43153` (`notqa--polish-batch`) to the `notqa` repo even though git has
forgotten those worktrees. It keys on the `<repo>--<branch-slug>` sibling
convention this machine already uses everywhere.

For docker, the same rules run against the compose `working_dir` label,
with the compose **project name** (`notqa--coverage-gaps`) as the fallback
attribution key when `working_dir` points at a deleted directory — that is
what empties the `unassigned` tray.

Anything matching neither a worktree nor an orphan rule stays in a genuine
"not in any repo" tray, which should now be close to empty.

## UI

```
Project              rail entry — "notqa · 6 up · 2 orphans"
└─ Repo              rendered ONLY when the project has ≥2 repos
   ├─ Orphans        first, when non-empty. pid · port · dead path · [kill]
   └─ Worktree       branch · head. Collapsed to one line when idle.
      └─ Service     one row per role. mode badge when "built".
```

Concrete changes from today:

- **Drop `18/27`.** The rail shows a running count and an alert dot.
  Configured-but-stopped is not a number worth a denominator.
- **Idle worktrees collapse to a single line** (`clip-export · 3185bc0 ·
  idle`), running ones expand. Running sorts first. This removes the four
  `no servers here yet` blocks.
- **The `OTHER` bucket is deleted.** Its contents were 15 dead rows and the
  live-but-unowned ones now go to Orphans.
- **A ports view.** Ports are the scarce resource here. A table of port →
  bound process → worktree/branch, computed purely from observation.
- **Alerts, rebuilt.** Exactly three kinds, all derived from observation,
  never from config rows:
  - `orphan` — a listening process whose cwd is gone or untracked.
  - `collision` — two *observed* bindings contend, or a `fixed` launcher
    cannot start because another worktree holds the port. Names both
    branches.
  - `failed-start` — a container in `Created` or `Exited(≠0)`, attributed
    to its worktree via compose project name even when that worktree is
    gone.

  Today's panel would become 2 orphans + 8 failed starts, all actionable,
  instead of 5 fakes.

## Open items for the implementer

- **Preferences file.** Order, renames and per-role hiding need a home now
  that server ids are gone. Key on `(projectId, repoPath, role)`. This
  replaces `devhub.state.json`'s `ignoredDiscovered`/`collapsedGroups`,
  both of which referenced ids that no longer exist.
- **Adopting an already-running process.** A launcher-declared role that is
  already running when devhub starts must be adoptable for stop/restart
  without devhub having spawned it — today's `adoptKnown` path, kept, but
  keyed on `(worktree, role)` instead of a persisted server id.
- **`alloc` port assignment must be stable across daemon restarts.** Hashing
  the worktree path into the range is the proposal; confirm that a
  collision probe does not shuffle every other worktree's port.
- **`strip()` segment list is a heuristic** and will miss some toolchain.
  Decide whether an unmatched deep path falls back to `basename(rel)` (one
  extra row, harmless) or to the worktree root role (wrong row, confusing).
  Recommend the former.
- **Two repos in one project can declare the same role.** `pridbuy` and
  `pridbuy-web-m3` both plausibly have a `web`. Roles are unique per repo,
  not per project — make sure the ports view and alerts disambiguate by
  repo, not just role.
- **Detached HEAD labelling** carries over unresolved from the worktree
  doc: `~/dev/pridbuy` has been observed at a detached HEAD, so
  `branch: null` needs a sane display (`detached @27e9614`).
- **Migration is a one-way read.** The loader should parse the old
  `projects[].servers[]` shape, keep nothing from it, and offer the
  surviving *commands* as candidate launchers in the "save as launcher"
  flow rather than silently discarding what the user once typed.

## Built — and what changed on the way

Implemented across `packages/shared/src/index.ts`, `packages/daemon/src/{config,roles,repoStore,prefs,processManager,externalScan,server,index}.ts`
and the web `Dashboard`/`Dialogs`/`useDevhub`. Six things differ from the
design above, each because building it turned up something the design had
wrong:

1. **A role is named after its REPO at a worktree root, not its own
   directory.** `deriveRole` originally returned `basename(worktree)`, which
   gave `sbnotes`, `sbnotes--docs-collapse-by-date-idea` and
   `sbnotes--feat-pomodoro-compact-redesign` three different roles for one
   app — reintroducing exactly the per-worktree duplication this document
   exists to remove. Roles must be stable across worktrees because launchers
   are inherited. This collapsed the recovered-command list from 13 to 8.
2. **Observations are merged by source directory, not by pid.** One logical
   service routinely spans several processes: toolboy's relay is a
   `wrangler` parent and a `workerd` child sharing a cwd, with the
   interesting port (8787) on the child. Keying a row on one pid showed the
   wrong ports and invented a duplicate row.
3. **`unattributed` joins the orphan reasons.** Something alive and
   checkout-shaped under no known repo is neither an orphan nor invisible;
   it lands in the "not in any repo" tray, and the ports table is the
   general discovery surface. Devhub's own checkout is excluded.
4. **Non-running debris is not an alert.** A `Created` container from a
   deleted worktree is inert. Only a container still *running* from a gone
   worktree earns one. Treating the two alike is how an alert panel fills
   with things you cannot act on — the exact failure this rewrite exists to
   fix. On this machine that is the difference between 10 alerts and 4.
5. **The pre-rewrite config is snapshotted before first write**, to
   `devhub.config.pre-rewrite.json`. The new shape cannot represent the old
   rows, so the first saved launcher rewrites the file and the remaining
   recovered commands are gone — a one-way door the user would otherwise
   walk through unwarned.
6. **Idle means "nothing running", not "nothing declared".** Once a repo
   declares launchers every worktree has rows, so collapsing on row count
   expands all seven feature branches and buries the one being worked in.

### Bugs this design created, found by testing it

- **Adopting every observed service made `shutdown()` lethal.** Devhub now
  takes control of processes it did not start, and the existing shutdown
  stopped everything it was "driving" — turning *restart devhub* into *kill
  every dev server on the machine*. `ProcessManager.shutdown()` now stops
  only pty-backed processes it spawned itself; `deleteProject` stops nothing
  at all.
- **`applyConfig` emitted an update per service per tick**, each of which
  requested another rebuild, which called `applyConfig` again. The loop was
  I/O-bound so it never looked like a hang — but it starved the 5s worktree
  refresh, because the interval always arrived mid-build and the queued
  rebuild dropped its `worktrees` flag. Devhub kept showing worktrees git had
  already pruned.
- **Saving one recovered command wiped the other twelve.** The rewritten
  config reloads as "no legacy section", which cleared the pending offer out
  from under the open dialog. `replaceAll` now never lets an empty migration
  list clear a live one.

### Verified against this machine

- Ghost rows: 27 config entries for notqa (15 pointing at deleted
  worktrees) → 0 stored rows; config 11,944 → 2,370 bytes.
- Alerts: 5, all false → 4, all real (2 leaked processes, 2 never-started
  containers).
- `:43151` and `:43153`, previously invisible, are attributed to the notqa
  repo via the `<repo>--<slug>` sibling rule.
- Launcher inheritance: 4 launchers declared once appear in all 7 notqa
  worktrees.
- `fixed` preemption: starting `srv` in `feat` stopped it in `main`, with a
  single holder of the port throughout the handoff.
- `alloc`: two worktrees took 45943 and 45941 deterministically and ran
  concurrently — the fix for three pridbuy worktrees hand-set to 3100.
- Orphan lifecycle: delete a worktree under a running process → detected as
  `worktree-gone`, alerted with its port, killed on request.
- Daemon restart no longer stops anything it did not start.

### Still open

- Non-compose containers cannot be attributed to a repo (no `working_dir`
  label) and are shown only in the ports table.
- `alloc` sets the env var but does not verify the command honours it; a
  command that ignores `$PORT` will still collide.
- No action for clearing stale `Created` containers — `docker rm` is
  destructive and was left to the user.
- Prefs exist on the wire (renames, role order, collapse) but only collapse
  is wired into the UI.
- **A meta-launcher's fan-out is invisible to the singleton rule.** notqa's
  one launcher is `pnpm run dev:web`, which turbo fans out into six
  processes holding 43100/43101/43102. Those children are observed as their
  own rows, but they belong to roles (`web`, `api`, `telegram-tdlib`) that
  the `dev` role's singleton group does not cover — so starting `dev` while
  the children are already running outside devhub will collide. The rows are
  visible with their own stop buttons, so it is diagnosable, but devhub
  cannot prevent it.
- **Three of notqa's six fan-out services never bind a port**
  (`service-telegram`, `service-search`, `service-streaming`), so devhub
  cannot observe them at all. This is why notqa gets the root meta-launcher
  rather than one launcher per app: per-service launchers would silently
  leave those three not running.

## Non-goals (this pass)

- Parsing `.env` or compose YAML to predict collisions ahead of time.
  Observed collisions plus `alloc` assignment cover the real cases.
- Remembering history of anything that stopped running. Nothing is
  persisted from observation, including "this used to be here".
- Auto-creating projects or repos from discovery. Decision 6 — devhub
  offers, the user confirms.
