// Shared types between the daemon and the web UI — single source of truth
// for the config schema and the WebSocket wire protocol.

export type ProcessStatus = "stopped" | "starting" | "running" | "crashed";

export interface ProjectConfig {
  id: string;
  name: string;
  cwd: string;
  command: string;
  group?: string;
  port?: number;
}

export interface ProjectState {
  id: string;
  status: ProcessStatus;
  port: number | null;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
  restartCount: number;
}

export interface ProjectSnapshot extends ProjectConfig {
  state: ProjectState;
}

// ---- Client -> Daemon ----

export type ClientMessage =
  | { type: "start"; id: string }
  | { type: "stop"; id: string }
  | { type: "restart"; id: string }
  | { type: "startGroup"; group: string }
  | { type: "stopGroup"; group: string }
  | { type: "subscribeLogs"; id: string }
  | { type: "unsubscribeLogs"; id: string };

// ---- Daemon -> Client ----

export type ServerMessage =
  | { type: "snapshot"; projects: ProjectSnapshot[] }
  | { type: "projectUpdated"; project: ProjectSnapshot }
  | { type: "projectRemoved"; id: string }
  | { type: "log"; id: string; lines: string[] }
  | { type: "logBacklog"; id: string; lines: string[] };
