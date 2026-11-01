// Shared types between the daemon and the web UI — single source of truth
// for the config schema and the WebSocket wire protocol.
//
// The model is observation-first (see docs/design-observation-first.md):
// everything under "Config" is written by the user and persisted; everything
// under "Views" is recomputed by the daemon every tick and never survives a
// restart. Nothing observed is ever promoted into config.

// ---------------------------------------------------------------- config

/** How a launcher gets its port.
 *
 *  `fixed` — the repo hardcodes its ports and forbids a second instance, so
 *  starting this role in one worktree stops it in every other worktree of
 *  the same repo first.
 *
 *  `alloc` — the command takes a port via env var (`env`, default `PORT`)
 *  and devhub assigns one per worktree from `range`, deterministically, so a
 *  worktree keeps its port across restarts. */
export type PortPolicy = { ports: "fixed" } | { ports: "alloc"; range: [number, number]; env?: string };

/** One service a repo knows how to run. Declared once on the repo and
 *  inherited by every one of its worktrees — that inheritance is what keeps
 *  adding a worktree free, and is the whole reason config stops growing. */
export interface Launcher {
  /** Stable identity of a service within a repo. Prefs key on this, never
   *  on a generated id. See `deriveRole` in the daemon. */
  role: string;
  /** Shell command, run from `<worktree>/<dir>`. */
  cmd: string;
  /** Subdirectory relative to the worktree root; omitted means its root. */
  dir?: string;
  policy: PortPolicy;
  /** Extra `pkill -f` patterns run once this service is fully stopped, for
   *  processes that aren't pid descendants of the spawned command (e.g. a
   *  Tauri app's native binary, launched by the dev CLI as a sibling). Keep
   *  them as specific as possible — this is a broad match. */
  killPatterns?: string[];
}

export interface Repo {
  /** Tilde-form path to the primary checkout. Also this repo's identity:
   *  there are no synthetic repo ids, and prefs key on this string. */
  path: string;
  label?: string;
  launchers: Launcher[];
  /** Port policy for this repo's docker-compose stack, when it has one. */
  compose?: PortPolicy;
}

export interface Project {
  id: string;
  name: string;
  /** Project-owned artwork. Absolute/tilde paths are accepted; relative
   * paths resolve from the first repository. The daemon serves the file to
   * the local UI without exposing filesystem paths to the browser. */
  icon?: string;
  repos: Repo[];
  /** Escape hatch for a one-off that lives outside every checkout. Roots
   *  and worktrees are a matching aid, not a constraint. */
  looseLaunchers?: Launcher[];
}

export interface DevhubConfig {
  projects: Project[];
}

/** UI-only preferences, persisted daemon-side so they survive across
 *  browsers hitting the same daemon. Keyed on `(projectId, repoPath, role)`
 *  rather than a generated id — ids are rebuilt every tick now, roles are
 *  stable. Build keys with `prefKey` / `repoKey` below. */
export interface Prefs {
  /** `<projectId>\0<repoPath>\0<role>` -> display name. */
  renames: Record<string, string>;
  /** `<projectId>\0<repoPath>` -> ordered role list. */
  roleOrder: Record<string, string[]>;
  projectOrder: string[];
  /** Collapsed group keys: `project:<id>`, `wt:<path>`, `section:ports`. */
  collapsed: string[];
}

export const prefKey = (projectId: string, repoPath: string, role: string) => `${projectId}\0${repoPath}\0${role}`;
export const repoKey = (projectId: string, repoPath: string) => `${projectId}\0${repoPath}`;

// ----------------------------------------------------------------- views

export type ServiceStatus = "running" | "starting" | "stopped" | "crashed";

/** How a running thing was built. A dev server and a standalone production
 *  build of the same app are one row in two modes, not two rows. */
export type ServiceMode = "dev" | "built";

/** One service row: a `(repo, worktree, role)` triple. Present when a
 *  launcher declares the role, when something is observed running under it,
 *  or both. */
export interface ServiceView {
  /** Stable across ticks — built by `serviceId()` in the daemon. */
  id: string;
  role: string;
  /** `prefs.renames` applied, falling back to `role`. */
  displayName: string;
  kind: "process" | "docker";
  /** False for an observed-only service: devhub can stop it but has no
   *  command to start it again. Offer "save as launcher" instead. */
  launchable: boolean;
  command: string | null;
  /** Absolute working directory this service runs in. */
  cwd: string;
  container: string | null;
  policy: PortPolicy | null;
  /** Under an `alloc` policy, the port this worktree is assigned. */
  assignedPort: number | null;
  mode: ServiceMode | null;
  status: ServiceStatus;
  pid: number | null;
  /** Every port this service is actually listening on, from observation —
   *  never a remembered or configured value. */
  ports: number[];
  startedAt: number | null;
  exitCode: number | null;
  /** Running, but devhub didn't spawn it, so there's no captured output
   *  until it's restarted through devhub. */
  external: boolean;
}

export interface WorktreeView {
  path: string;
  /** Null at a detached HEAD — display as `detached @<head>`. */
  branch: string | null;
  head: string;
  isMain: boolean;
  services: ServiceView[];
}

export interface RepoView {
  /** Tilde-form, as stored in config — the identity used by prefs and by
   *  every launcher-mutating message. */
  path: string;
  /** ~-expanded, for display and for path matching in the UI. */
  absPath: string;
  label: string;
  isGit: boolean;
  /** Missing from disk entirely — surfaced rather than silently empty. */
  missing: boolean;
  worktrees: WorktreeView[];
  orphans: Orphan[];
}

export interface ProjectView {
  id: string;
  name: string;
  /** Local daemon URL when the project has configured artwork. */
  iconUrl?: string | null;
  repos: RepoView[];
  /** Launchers not tied to any repo, plus anything observed under them. */
  looseServices: ServiceView[];
  runningCount: number;
  alertCount: number;
}

/** A developer agent currently attached to one project workspace.
 *
 * Runs are leased daemon state, not configuration. Agents renew the lease
 * while they work; if one crashes or vanishes, DevHub drops the run instead
 * of preserving another stale row forever. `done` and `failed` runs use a
 * short handoff lease so the outcome remains visible briefly. */
export interface AgentRun {
  id: string;
  agent: string;
  task: string;
  projectId: string;
  /** One logical workspace can span worktrees from several repositories. */
  workspacePaths: string[];
  status: "working" | "waiting" | "done" | "failed";
  detail: string | null;
  checks: AgentCheck[];
  startedAt: number;
  updatedAt: number;
  expiresAt: number;
}

/** A structured, agent-maintained readiness fact for one workspace. Checks
 * share the run lease, so abandoned setup state disappears automatically. */
export interface AgentCheck {
  key: string;
  label: string;
  status: "pending" | "ready" | "blocked";
  detail: string | null;
  updatedAt: number;
}

/** A temporary claim on a local port by an agent run. Reservations are
 * coordination state, never proof that a service is actually listening. */
export interface PortReservation {
  id: string;
  runId: string;
  projectId: string;
  role: string;
  port: number;
  createdAt: number;
}

/** An agent's declared preview or service endpoint. `running` is computed by
 * the daemon from its socket scan; agents cannot assert it themselves. */
export interface ServiceAnnouncement {
  id: string;
  runId: string;
  projectId: string;
  role: string;
  url: string;
  port: number;
  status: "declared" | "running";
  updatedAt: number;
}

/** A listening process or container whose owning worktree devhub can still
 *  attribute to a repo, but which git no longer knows about — or whose cwd
 *  is gone from disk entirely. The highest-value thing devhub shows, and
 *  the thing plain `lsof` can't tell you. */
export interface Orphan {
  id: string;
  kind: "process" | "docker";
  pid: number | null;
  container: string | null;
  /** The path that no longer exists or is no longer tracked. */
  cwd: string;
  ports: number[];
  /** `worktree-gone` — git no longer knows this path, but the
   *  `<repo>--<slug>` sibling convention still attributes it to a repo.
   *  `cwd-deleted` — the directory is gone from disk entirely.
   *  `unattributed` — alive and checkout-shaped, but under no known repo. */
  reason: "worktree-gone" | "cwd-deleted" | "unattributed";
  /** e.g. `notqa--artwork-fallback / web`. */
  label: string;
  status: "running" | "created" | "exited";
  exitCode: number | null;
}

export type AlertKind = "orphan" | "collision" | "failed-start";

/** Derived purely from observation — never from config rows. That
 *  distinction is the entire reason the old alert panel was 100% false
 *  positives. */
export interface Alert {
  id: string;
  kind: AlertKind;
  message: string;
  projectId: string | null;
  /** A service id or orphan id the UI can act on. */
  targetId: string | null;
  port?: number;
}

/** One row of the ports view. Ports are the scarce resource on this
 *  machine, so they get a first-class table rather than being buried in
 *  each service row. */
export interface PortRow {
  port: number;
  pid: number | null;
  /** Null for a foreign listener devhub doesn't attribute to any project. */
  serviceId: string | null;
  label: string;
  kind: "process" | "docker" | "foreign";
  /** Every distinct process observed holding this port. One entry is the
   *  normal case; two or more is a genuine collision, which is what the
   *  `collision` alert reports. Deduping the table by port alone — as it
   *  originally did — made contention structurally unrepresentable, so the
   *  alert kind could never fire. */
  holders: PortHolder[];
}

export interface PortHolder {
  pid: number | null;
  label: string;
  serviceId: string | null;
  kind: "process" | "docker" | "foreign";
}

/** A command recovered from the pre-rewrite config shape. Nothing from the
 *  old `projects[].servers[]` is kept, but throwing away commands the user
 *  once typed would be rude — these are offered in the "save as launcher"
 *  flow and discarded once dismissed. */
export interface MigrationCandidate {
  projectId: string;
  repoPath: string;
  role: string;
  command: string;
  dir: string | null;
}

// ------------------------------------------------------------- utilities

export interface DetectedScript {
  name: string;
  command: string;
}

/** A subdirectory entry from the daemon's folder browser — the daemon has
 *  real filesystem access, the browser sandbox doesn't. */
export interface DirectoryEntry {
  name: string;
  hasPackageJson: boolean;
  isGitRepo: boolean;
}

// ------------------------------------------------------- client -> daemon

export interface RepoInput {
  path: string;
  label?: string;
}

export type ClientMessage =
  | { type: "start"; id: string }
  | { type: "stop"; id: string }
  | { type: "restart"; id: string }
  | { type: "startWorktree"; worktreePath: string }
  | { type: "stopWorktree"; worktreePath: string }
  | { type: "startProject"; projectId: string }
  | { type: "stopProject"; projectId: string }
  | { type: "subscribeLogs"; id: string }
  | { type: "unsubscribeLogs"; id: string }
  | { type: "killOrphan"; id: string }
  /** `docker rm` for a container that never ran and whose worktree is gone.
   *  Irreversible, so the UI asks first. Devhub previously offered no way at
   *  all to clear these, which left a list that could only ever grow. */
  | { type: "removeContainer"; container: string }
  | { type: "createProject"; name: string; repos?: RepoInput[] }
  | { type: "updateProject"; id: string; name: string; repos: RepoInput[] }
  | { type: "deleteProject"; id: string }
  | { type: "saveLauncher"; projectId: string; repoPath: string; launcher: Launcher; replacingRole?: string }
  | { type: "deleteLauncher"; projectId: string; repoPath: string; role: string }
  | { type: "setComposePolicy"; projectId: string; repoPath: string; policy: PortPolicy | null }
  | { type: "dismissMigration" }
  | { type: "detectScripts"; cwd: string }
  | { type: "setPrefs"; prefs: Prefs }
  | { type: "reorderProjects"; ids: string[] }
  | { type: "listDirectory"; path?: string }
  | { type: "revealPath"; path: string };

// ------------------------------------------------------- daemon -> client

export interface Snapshot {
  projects: ProjectView[];
  /** Immutable historical observations. These survive daemon restarts but
   * never describe current state; `observedAt` is part of every claim. */
  activity: ActivityEvent[];
  /** Ephemeral declarations from agents, kept separate from observed
   * runtimes so neither can accidentally masquerade as the other. */
  agentRuns: AgentRun[];
  portReservations: PortReservation[];
  serviceAnnouncements: ServiceAnnouncement[];
  /** Listeners devhub can't attribute to any project at all. */
  unowned: Orphan[];
  alerts: Alert[];
  ports: PortRow[];
  prefs: Prefs;
  migration: MigrationCandidate[];
  /** Whether each observation probe could run. False means the rows it feeds
   *  are hidden, not absent — the UI must say so rather than render an empty
   *  dashboard as "everything is fine". */
  probes: ProbeStatus;
  /** Every container that has never run, from any worktree, alive or deleted.
   *  One list, one count. */
  neverStarted: NeverStarted[];
}

export interface ActivityEvent {
  id: string;
  projectId: string;
  workspacePath: string | null;
  serviceId: string | null;
  kind: "service-started" | "service-stopped" | "service-crashed" | "agent-waiting" | "agent-finished" | "agent-failed" | "blocker";
  message: string;
  observedAt: number;
}

export interface ProbeStatus {
  lsof: boolean;
  docker: boolean;
}

/** A container that exists but has never run, or ran and exited.
 *
 *  These used to be split across two surfaces by one invisible criterion —
 *  whether the worktree still existed. A live worktree made it a red alert
 *  ("was created but never started"); a deleted one made it grey debris
 *  ("never started") in a section named after its cause. Same predicate, two
 *  names, two visual weights, two counts, and no surface showed the total.
 *  They are one fact, so they are now one list with the state inside it. */
export interface NeverStarted {
  /** The service id when the worktree is alive (so the UI can reveal the row
   *  that already carries `start`), or the orphan id when it is gone. */
  targetId: string;
  container: string;
  composeProject: string | null;
  composeService: string | null;
  projectId: string | null;
  /** Null when the worktree this came from no longer exists. */
  worktreePath: string | null;
  worktreeLabel: string | null;
  /** `start` — the worktree is alive, the service row exists, it can be run.
   *  `remove` — the worktree is gone; this is debris and `docker rm` is the
   *  only thing left to do with it. */
  action: "start" | "remove";
  state: "created" | "exited";
  exitCode: number | null;
}

export type ServerMessage =
  | ({ type: "snapshot" } & Snapshot)
  | { type: "log"; id: string; lines: string[] }
  | { type: "logBacklog"; id: string; lines: string[] }
  | { type: "scriptsDetected"; cwd: string; scripts: DetectedScript[]; hasPackageJson: boolean }
  | { type: "directoryListing"; path: string; parent: string | null; entries: DirectoryEntry[]; error?: string }
  | { type: "commandError"; message: string }
  /** The ids whose start/stop/restart has now been applied. The UI clears a
   *  row's spinner on this, not on the next snapshot: the daemon rebroadcasts
   *  on a 5s tick whenever the observed port table changes, so "any snapshot
   *  confirms any action" cleared spinners on unrelated churn — the spinner
   *  vanished while the row was still grey and the button re-enabled into a
   *  double-submit. */
  | { type: "actionDone"; ids: string[] };
