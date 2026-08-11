import type { ProjectConfig, ProjectMeta, ServerConfig } from "@devhub/shared";
import { resolveCwd, slugify, writeConfig } from "./config.js";
import type { RuntimeServerConfig } from "./processManager.js";

interface ServerInput {
  name: string;
  command: string;
  cwd: string;
  port?: number;
}

/** Owns the in-memory, authoritative project/server list — CRUD mutates it,
 *  persists to devhub.config.json, and the caller re-syncs ProcessManager
 *  from `flatten()` afterward. */
export class ProjectStore {
  private projects: ProjectConfig[];

  constructor(initial: ProjectConfig[]) {
    this.projects = initial;
  }

  /** Called when the config file changes on disk (hand-edits, or our own writes). */
  replaceAll(projects: ProjectConfig[]) {
    this.projects = projects;
  }

  metas(): ProjectMeta[] {
    return this.projects.map((p) => ({ id: p.id, name: p.name }));
  }

  project(id: string): ProjectConfig | undefined {
    return this.projects.find((p) => p.id === id);
  }

  flatten(): RuntimeServerConfig[] {
    return this.projects.flatMap((p) =>
      p.servers.map((s) => ({
        id: s.id,
        projectId: p.id,
        name: s.name,
        command: s.command,
        cwd: resolveCwd(s.cwd),
        port: s.port,
      })),
    );
  }

  private persist() {
    writeConfig(this.projects);
  }

  private allServerIds(): Set<string> {
    return new Set(this.projects.flatMap((p) => p.servers.map((s) => s.id)));
  }

  private uniqueId(base: string, taken: Set<string>): string {
    const root = slugify(base) || "item";
    if (!taken.has(root)) return root;
    let n = 2;
    while (taken.has(`${root}-${n}`)) n++;
    return `${root}-${n}`;
  }

  createProject(name: string): ProjectConfig {
    name = name.trim();
    if (!name) throw new Error("Project name is required");
    const id = this.uniqueId(name, new Set(this.projects.map((p) => p.id)));
    const project: ProjectConfig = { id, name, servers: [] };
    this.projects.push(project);
    this.persist();
    return project;
  }

  updateProject(id: string, name: string): ProjectConfig {
    const p = this.project(id);
    if (!p) throw new Error("Project not found");
    name = name.trim();
    if (!name) throw new Error("Project name is required");
    p.name = name;
    this.persist();
    return p;
  }

  deleteProject(id: string) {
    this.projects = this.projects.filter((p) => p.id !== id);
    this.persist();
  }

  createServer(projectId: string, input: ServerInput): ServerConfig {
    const p = this.project(projectId);
    if (!p) throw new Error("Project not found");
    const name = input.name.trim();
    const command = input.command.trim();
    const cwd = input.cwd.trim();
    if (!name) throw new Error("Server name is required");
    if (!command) throw new Error("Command is required");
    if (!cwd) throw new Error("Working directory is required");
    const id = this.uniqueId(`${p.name}-${name}`, this.allServerIds());
    const server: ServerConfig = { id, name, command, cwd, port: input.port };
    p.servers.push(server);
    this.persist();
    return server;
  }

  updateServer(id: string, input: ServerInput): ServerConfig {
    for (const p of this.projects) {
      const s = p.servers.find((x) => x.id === id);
      if (!s) continue;
      const name = input.name.trim();
      const command = input.command.trim();
      const cwd = input.cwd.trim();
      if (!name) throw new Error("Server name is required");
      if (!command) throw new Error("Command is required");
      if (!cwd) throw new Error("Working directory is required");
      s.name = name;
      s.command = command;
      s.cwd = cwd;
      s.port = input.port;
      this.persist();
      return s;
    }
    throw new Error("Server not found");
  }

  /** Returns the owning project's id, or null if the server didn't exist. */
  deleteServer(id: string): string | null {
    for (const p of this.projects) {
      const idx = p.servers.findIndex((x) => x.id === id);
      if (idx === -1) continue;
      p.servers.splice(idx, 1);
      this.persist();
      return p.id;
    }
    return null;
  }

  reorderProjects(ids: string[]) {
    const byId = new Map(this.projects.map((p) => [p.id, p]));
    if (ids.length !== byId.size || ids.some((id) => !byId.has(id))) {
      throw new Error("reorderProjects: ids must be exactly the current project ids");
    }
    this.projects = ids.map((id) => byId.get(id)!);
    this.persist();
  }

  reorderServers(projectId: string, ids: string[]) {
    const p = this.project(projectId);
    if (!p) throw new Error("Project not found");
    const byId = new Map(p.servers.map((s) => [s.id, s]));
    if (ids.length !== byId.size || ids.some((id) => !byId.has(id))) {
      throw new Error("reorderServers: ids must be exactly the project's current server ids");
    }
    p.servers = ids.map((id) => byId.get(id)!);
    this.persist();
  }
}
