# Design prompt: project-centric architecture

## Problem

Devhub's data model today treats **servers as primary** and projects as a flat
label:

```ts
ProjectConfig = { id, name, servers: ServerConfig[] }
```

Each `ServerConfig` (process or docker) carries its own independent `cwd`,
with no relationship to any project path. Discovery (`externalScan.ts`) scans
every listening TCP socket via `lsof`, resolves its cwd, and — if that cwd
doesn't exactly match an already-configured server — dumps it into a flat,
unassociated "Discovered" list. There is no grouping concept anywhere: not by
project root, not by process tree.

Concretely: `notqa` is a turborepo monorepo (`~/dev/notqa`) whose `dev`
scripts fan out via `turbo run dev --filter=...` into independent sibling
processes — `apps/api`, `apps/web`, `services/service-telegram`,
`services/service-search`, `services/service-streaming`,
`workers/worker-telegram-tdlib` — each its own pid, own port, own
subdirectory cwd. Running one of these multi-filter dev scripts makes
several unrelated-looking entries pile up in Discovered, because nothing
knows they all belong under the same project root.

Goal: make **Project** the primary entity, with one or more **roots**, and
have discovery fold anything under a known root directly into that project
instead of the flat Discovered pile.

## Decisions (from design discussion, resolved with the user)

1. **Root matching is subtree-based.** A root like `~/dev/notqa` folds in
   anything nested under it (`~/dev/notqa/apps/web`,
   `~/dev/notqa/services/service-search`, etc.), not just exact-path matches.
   This is required for monorepos to work at all.
2. **Folded servers stay separate rows**, not merged into one multi-port
   logical entity. Each process/port keeps its own server identity (own
   start/stop/logs); folding only changes *where it's grouped in the UI and
   config*, not how many `ServerConfig` entries exist. (A true multi-port
   "logical server" grouping was considered and explicitly deferred — out of
   scope for this pass.)
3. **Root assignment is manual only** (v1). Users attach a root to a project
   explicitly via the existing daemon-backed folder picker, same flow as
   adding a server today. No auto-suggestion of "this folder looks like it
   belongs to project X" for now.
4. **Docker containers fold too**, matched via docker-compose metadata
   (`com.docker.compose.project` label / service `working_dir`) against the
   same root-subtree rule used for processes — not just container name/id
   identity as today.
5. **Docker gets its own subsection** within a project card, one level below
   the project — i.e. a project's card shows a "Servers" group and a
   separate "Docker" group, not one flat mixed list.
6. **Matching is silent, not confirm-first.** When a discovered process or
   container's cwd/working_dir matches a project root, it is folded straight
   into that project as a real, configured entry — no manual "confirm to
   add" click. (This is a deliberate reversal of the more cautious
   confirm-first default; the user chose silent auto-add.)

## Data model changes

```ts
export interface ProjectRoot {
  id: string;
  path: string;
  label?: string;
}

export interface ProjectConfig {
  id: string;
  name: string;
  roots: ProjectRoot[];       // NEW — empty array is valid (label-only project, today's behavior)
  servers: ServerConfig[];    // unchanged shape; cwd stays independent per-server
}
```

`ServerConfig`/`ServerSnapshot` are otherwise unchanged — a server's own
`cwd`/`container` remains authoritative for run behavior. Roots are a
*matching aid* for discovery, not a constraint on where a server's process
actually lives (a manually-added server can still point anywhere).

## Matching algorithm

For each project, compute `roots[]`. For a discovered process with cwd `C`:

```
match(C, root) := C === root.path || C.startsWith(root.path + '/')
```

If multiple projects' roots match, the **longest matching root path wins**
(most specific root beats a shallower ancestor root in another project) —
needs an explicit tie-break rule since nested roots across projects are
possible.

For docker: same subtree rule applied to the compose `working_dir` (or, if
unavailable, fall back to today's container-identity check). Containers with
no compose metadata at all remain in the flat Docker-discovered fallback,
same as unmatched processes today.

Anything matching **no** project root falls back to today's existing flat,
unassociated Discovered section — that path is unchanged.

## Open items for the implementer

- **Ignore interaction**: today's `UiState.collapsedGroups` implies an
  existing "ignored discovered item" concept. Decide whether an
  explicitly-ignored item should stay ignored even after a matching root is
  added later, or whether a new root re-surfaces it. Recommend: respect
  existing ignore state (don't silently resurrect something the user
  dismissed).
- **Lifecycle after auto-fold**: once silently added, a folded server/
  container behaves exactly like a manually-added one (persists in config,
  can be stopped/removed by the user like any other). It should not be
  auto-removed just because the process disappears — same as current
  behavior for configured-but-stopped servers.
- **Overlapping/duplicate roots**: decide whether to warn or block when a
  user attaches a root that's already covered by another project's root
  (either identical or nested).
- **Migration**: fully additive — existing `ProjectConfig` values get
  `roots: []` on load; nothing changes in behavior until a user attaches a
  root to a project.

## Non-goals (this pass)

- Multi-port "logical server" merging (decision 2).
- Auto-suggested project creation/root assignment from discovery (decision 3).
- Confirm-before-fold UX (decision 6).
