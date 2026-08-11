import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import type { DetectedScript, ProjectConfig, ServerConfig } from "@devhub/shared";

const here = dirname(fileURLToPath(import.meta.url));

export const CONFIG_PATH =
  process.env.DEVHUB_CONFIG ?? resolve(here, "../../../devhub.config.json");

interface RawServer {
  id?: string;
  name: string;
  kind?: "process" | "docker";
  command?: string;
  cwd?: string;
  container?: string;
  /** @deprecated legacy field, relative to the owning project's `root` */
  dir?: string;
  port?: number;
}
interface RawProject {
  id?: string;
  name: string;
  /** @deprecated legacy field — projects no longer have a shared root */
  root?: string;
  servers?: RawServer[];
}
interface RawConfigFile {
  projects: RawProject[];
}

/** Joins a legacy project `root` with a server's legacy relative `dir`. */
function legacyJoin(root: string, dir: string): string {
  if (!dir || dir === ".") return root;
  return `${root.replace(/\/$/, "")}/${dir.replace(/^\.?\//, "")}`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Expands a leading "~" to the user's home directory. */
export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/** Resolves a server's stored working directory to an absolute path. */
export function resolveCwd(cwd: string): string {
  return expandHome(cwd);
}

export function parseConfig(raw: string): ProjectConfig[] {
  const data = JSON.parse(raw) as RawConfigFile;
  if (!Array.isArray(data.projects)) {
    throw new Error('Config must have a top-level "projects" array');
  }

  const seenProjectIds = new Set<string>();
  const seenServerIds = new Set<string>();
  let migrated = false;

  const projects = data.projects.map((p) => {
    if (!p.name) {
      throw new Error(`Project entry missing required field "name": ${JSON.stringify(p)}`);
    }
    const projectId = p.id ?? slugify(p.name);
    if (seenProjectIds.has(projectId)) {
      throw new Error(`Duplicate project id "${projectId}" — give it an explicit unique "id" field`);
    }
    seenProjectIds.add(projectId);

    const servers: ServerConfig[] = (p.servers ?? []).map((s) => {
      if (!s.name) {
        throw new Error(`Server entry missing required field "name" in project "${p.name}": ${JSON.stringify(s)}`);
      }
      const serverId = s.id ?? slugify(`${p.name}-${s.name}`);
      if (seenServerIds.has(serverId)) {
        throw new Error(`Duplicate server id "${serverId}" — give it an explicit unique "id" field`);
      }
      seenServerIds.add(serverId);

      let kind = s.kind;
      if (!kind) {
        kind = "process";
        migrated = true;
      }

      if (kind === "docker") {
        if (!s.container) {
          throw new Error(`Docker server entry missing required field "container" in project "${p.name}": ${JSON.stringify(s)}`);
        }
        return { id: serverId, name: s.name, kind: "docker" as const, container: s.container, port: s.port };
      }

      if (!s.command) {
        throw new Error(`Server entry missing required field "command" in project "${p.name}": ${JSON.stringify(s)}`);
      }
      let cwd = s.cwd;
      if (!cwd && p.root) {
        cwd = legacyJoin(p.root, s.dir ?? ".");
        migrated = true;
      }
      if (!cwd) {
        throw new Error(`Server entry missing required field "cwd" in project "${p.name}": ${JSON.stringify(s)}`);
      }
      return { id: serverId, name: s.name, kind: "process" as const, command: s.command, cwd, port: s.port };
    });

    return { id: projectId, name: p.name, servers };
  });

  if (migrated) console.log("[devhub] migrated legacy config shape (root/dir fields, kind-less servers) — will be rewritten on next save");
  return projects;
}

export function loadConfig(path: string = CONFIG_PATH): ProjectConfig[] {
  const raw = readFileSync(path, "utf-8");
  return parseConfig(raw);
}

/** Pretty-serializes and writes the config back to disk (used by CRUD ops). */
export function writeConfig(projects: ProjectConfig[], path: string = CONFIG_PATH): void {
  const data = {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      servers: p.servers.map((s) => {
        const port = s.port ? { port: s.port } : {};
        return s.kind === "docker"
          ? { id: s.id, name: s.name, kind: s.kind, container: s.container, ...port }
          : { id: s.id, name: s.name, kind: s.kind, command: s.command, cwd: s.cwd, ...port };
      }),
    })),
  };
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export function watchConfig(
  path: string,
  onChange: (projects: ProjectConfig[]) => void,
  onError: (err: Error) => void,
): () => void {
  const watcher = chokidar.watch(path, { ignoreInitial: true });
  watcher.on("change", () => {
    try {
      onChange(loadConfig(path));
    } catch (err) {
      onError(err as Error);
    }
  });
  return () => void watcher.close();
}

const SCRIPT_IGNORE = new Set(["pretest", "postinstall", "preinstall", "postpublish"]);

/** Scans a resolved directory's package.json for scripts, prefixed by the detected package manager. */
export function detectScripts(absoluteDir: string): { scripts: DetectedScript[]; hasPackageJson: boolean } {
  const pkgPath = join(absoluteDir, "package.json");
  if (!existsSync(pkgPath)) return { scripts: [], hasPackageJson: false };

  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return { scripts: [], hasPackageJson: true };
  }

  const runner = existsSync(join(absoluteDir, "pnpm-lock.yaml"))
    ? "pnpm run"
    : existsSync(join(absoluteDir, "yarn.lock"))
      ? "yarn"
      : "npm run";

  const scripts = Object.keys(pkg.scripts ?? {})
    .filter((name) => !SCRIPT_IGNORE.has(name))
    .map((name) => ({ name, command: `${runner} ${name}` }));

  return { scripts, hasPackageJson: true };
}
