// Shared types between the daemon and the web UI — single source of truth
// for the config schema and the WebSocket wire protocol.

export type ProcessStatus = "stopped" | "starting" | "running" | "crashed";

// ---- Config file schema (devhub.config.json) ----

export interface ServerConfig {
  id: string;
  name: string;
  command: string;
  /** Relative to the owning project's `root`. "." means the root itself. */
  dir: string;
  port?: number;
}

export interface ProjectConfig {
  id: string;
  name: string;
  /** Absolute or ~-relative path to the project's repo folder. */
  root: string;
  servers: ServerConfig[];
}

// ---- Runtime / wire-facing shapes ----

export interface ProjectMeta {
  id: string;
  name: string;
  root: string;
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
}

export interface DetectedExternal {
  pid: number;
  port: number;
}

/** A running process under $HOME that looks like a dev server (has a
 *  package.json) but matches no configured server at all. */
export interface DiscoveredProject {
  cwd: string;
  port: number;
  pid: number;
  suggestedName: string;
}

export interface ServerSnapshot {
  id: string;
  projectId: string;
  name: string;
  command: string;
  dir: string;
  /** Resolved absolute working directory (root + dir, ~-expanded). */
  cwd: string;
  port?: number;
  state: ServerState;
  /** Set when stopped and something matching this server's cwd is already
   *  listening on a port — offer to Track it rather than starting a duplicate. */
  detected: DetectedExternal | null;
}

export interface DetectedScript {
  name: string;
  command: string;
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
  | { type: "createProject"; name: string; root: string }
  | { type: "updateProject"; id: string; name: string; root: string }
  | { type: "deleteProject"; id: string }
  | { type: "createServer"; projectId: string; name: string; command: string; dir: string; port?: number }
  | { type: "updateServer"; id: string; name: string; command: string; dir: string; port?: number }
  | { type: "deleteServer"; id: string }
  | { type: "detectScripts"; projectId: string; dir: string }
  | { type: "track"; id: string };

// ---- Daemon -> Client ----

export type ServerMessage =
  | { type: "snapshot"; projects: ProjectMeta[]; servers: ServerSnapshot[] }
  | { type: "serverUpdated"; server: ServerSnapshot }
  | { type: "serverRemoved"; id: string }
  | { type: "log"; id: string; lines: string[] }
  | { type: "logBacklog"; id: string; lines: string[] }
  | { type: "scriptsDetected"; projectId: string; dir: string; scripts: DetectedScript[]; hasPackageJson: boolean }
  | { type: "discovered"; items: DiscoveredProject[] }
  | { type: "commandError"; message: string };
