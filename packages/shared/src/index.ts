// Shared types between the daemon and the web UI — single source of truth
// for the config schema and the WebSocket wire protocol.

export type ProcessStatus = "stopped" | "starting" | "running" | "crashed";

// ---- Config file schema (devhub.config.json) ----

interface ServerConfigBase {
  id: string;
  name: string;
  port?: number;
}

export interface ProcessServerConfig extends ServerConfigBase {
  kind: "process";
  command: string;
  /** Absolute or ~-relative path to this server's own working directory —
   *  independent of its project, which is just a label to group it under. */
  cwd: string;
}

/** Devhub controls an already-existing container's lifecycle (start/stop/
 *  restart, log streaming) — it never runs `docker create`/`docker run`. */
export interface DockerServerConfig extends ServerConfigBase {
  kind: "docker";
  /** Container name or id, whatever the docker CLI accepts as a ref. */
  container: string;
}

export type ServerConfig = ProcessServerConfig | DockerServerConfig;

/** A filesystem location that belongs to a project — a matching aid for
 *  discovery (fold anything found under here into this project), not a
 *  constraint on where any particular server actually runs. */
export interface ProjectRoot {
  id: string;
  /** Absolute or ~-relative path. */
  path: string;
  label?: string;
}

export interface ProjectConfig {
  id: string;
  name: string;
  roots: ProjectRoot[];
  servers: ServerConfig[];
}

// ---- Runtime / wire-facing shapes ----

export interface ProjectMeta {
  id: string;
  name: string;
  roots: ProjectRoot[];
}

export interface ServerState {
  id: string;
  status: ProcessStatus;
  port: number | null;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
  restartCount: number;
  /** True while "running" backs onto a process devhub adopted rather than
   *  spawned itself — no log capture until it's restarted under devhub. */
  external: boolean;
  /** Descendants of this server's own pid that have opened their own
   *  listening socket — e.g. a single `pnpm dev` fanning out into several
   *  per-workspace dev servers. Detected by process ancestry, not
   *  configured, so there's nothing to start/stop/persist per child. */
  children: ChildProcess[];
}

/** A descendant process of a running server that's opened its own listening
 *  socket, surfaced read-only under the parent server row. */
export interface ChildProcess {
  pid: number;
  port: number;
  cwd: string;
  name: string;
}

export interface DetectedExternal {
  pid: number;
  port: number;
}

/** A running process under $HOME that looks like a dev server (has a
 *  package.json) but matches no configured server at all. */
export interface DiscoveredProcess {
  kind: "process";
  cwd: string;
  port: number;
  pid: number;
  suggestedName: string;
}

/** A docker container (running or not) that matches no configured server's
 *  `container` ref. */
export interface DiscoveredDocker {
  kind: "docker";
  container: string;
  image: string;
  running: boolean;
  suggestedName: string;
}

export type DiscoveredProject = DiscoveredProcess | DiscoveredDocker;

interface ServerSnapshotBase {
  id: string;
  projectId: string;
  name: string;
  port?: number;
  state: ServerState;
  /** Set when stopped and something matching this server's cwd is already
   *  listening on a port — offer to Track it rather than starting a duplicate.
   *  Always null for docker-kind: attaching to a container's logs doesn't
   *  require devhub to have spawned it, so there's nothing to "adopt". */
  detected: DetectedExternal | null;
}

export interface ProcessServerSnapshot extends ServerSnapshotBase {
  kind: "process";
  command: string;
  /** Resolved absolute working directory (~-expanded). */
  cwd: string;
}

export interface DockerServerSnapshot extends ServerSnapshotBase {
  kind: "docker";
  container: string;
}

export type ServerSnapshot = ProcessServerSnapshot | DockerServerSnapshot;

export interface DetectedScript {
  name: string;
  command: string;
}

/** UI-only preferences (which discovered items are dismissed, which groups
 *  are collapsed) — persisted daemon-side, separate from devhub.config.json,
 *  so they survive across browsers/devices hitting the same daemon. */
export interface UiState {
  /** Discovery identity keys (cwd for a process, container name for docker). */
  ignoredDiscovered: string[];
  /** Group keys: "project:<id>" | "section:discovered" | "section:ignored". */
  collapsedGroups: string[];
}

/** A subdirectory entry surfaced by the daemon's folder browser — the
 *  daemon has real filesystem access, the browser sandbox doesn't. */
export interface DirectoryEntry {
  name: string;
}

// ---- Client -> Daemon ----

export type ClientMessage =
  | { type: "start"; id: string }
  | { type: "stop"; id: string }
  | { type: "restart"; id: string }
  | { type: "startProject"; projectId: string }
  | { type: "stopProject"; projectId: string }
  | { type: "subscribeLogs"; id: string }
  | { type: "unsubscribeLogs"; id: string }
  | { type: "createProject"; name: string }
  | { type: "updateProject"; id: string; name: string; roots: ProjectRoot[] }
  | { type: "deleteProject"; id: string }
  | { type: "createServer"; projectId: string; name: string; kind: "process"; command: string; cwd: string; port?: number }
  | { type: "createServer"; projectId: string; name: string; kind: "docker"; container: string; port?: number }
  | { type: "updateServer"; id: string; name: string; kind: "process"; command: string; cwd: string; port?: number }
  | { type: "updateServer"; id: string; name: string; kind: "docker"; container: string; port?: number }
  | { type: "deleteServer"; id: string }
  | { type: "detectScripts"; cwd: string }
  | { type: "track"; id: string }
  | { type: "killChild"; pid: number; ownerServerId?: string }
  | { type: "setUiState"; state: UiState }
  | { type: "reorderProjects"; ids: string[] }
  | { type: "listDirectory"; path?: string };

// ---- Daemon -> Client ----

export type ServerMessage =
  | { type: "snapshot"; projects: ProjectMeta[]; servers: ServerSnapshot[]; uiState: UiState }
  | { type: "serverUpdated"; server: ServerSnapshot }
  | { type: "serverRemoved"; id: string }
  | { type: "log"; id: string; lines: string[] }
  | { type: "logBacklog"; id: string; lines: string[] }
  | { type: "scriptsDetected"; cwd: string; scripts: DetectedScript[]; hasPackageJson: boolean }
  | { type: "discovered"; items: DiscoveredProject[] }
  | { type: "uiState"; state: UiState }
  | { type: "commandError"; message: string }
  | { type: "directoryListing"; path: string; parent: string | null; entries: DirectoryEntry[]; error?: string };
