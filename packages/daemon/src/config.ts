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
  command: string;
  dir?: string;
  port?: number;
}
interface RawProject {
  id?: string;
  name: string;
  root: string;
  servers?: RawServer[];
}
interface RawConfigFile {
  projects: RawProject[];
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

/** Resolves a server's absolute working directory from its project's root + its own relative dir. */
export function resolveCwd(root: string, dir: string): string {
  const absRoot = expandHome(root);
  if (!dir || dir === ".") return absRoot;
  return join(absRoot, dir);
}

export function parseConfig(raw: string): ProjectConfig[] {
  const data = JSON.parse(raw) as RawConfigFile;
  if (!Array.isArray(data.projects)) {
    throw new Error('Config must have a top-level "projects" array');
  }

  const seenProjectIds = new Set<string>();
  const seenServerIds = new Set<string>();

  return data.projects.map((p) => {
    if (!p.name || !p.root) {
      throw new Error(`Project entry missing required field(s) (name/root): ${JSON.stringify(p)}`);
    }
    const projectId = p.id ?? slugify(p.name);
    if (seenProjectIds.has(projectId)) {
      throw new Error(`Duplicate project id "${projectId}" — give it an explicit unique "id" field`);
    }
    seenProjectIds.add(projectId);

    const servers: ServerConfig[] = (p.servers ?? []).map((s) => {
      if (!s.name || !s.command) {
        throw new Error(`Server entry missing required field(s) (name/command) in project "${p.name}": ${JSON.stringify(s)}`);
      }
      const serverId = s.id ?? slugify(`${p.name}-${s.name}`);
      if (seenServerIds.has(serverId)) {
        throw new Error(`Duplicate server id "${serverId}" — give it an explicit unique "id" field`);
      }
      seenServerIds.add(serverId);
      return { id: serverId, name: s.name, command: s.command, dir: s.dir ?? ".", port: s.port };
    });

    return { id: projectId, name: p.name, root: p.root, servers };
  });
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
      root: p.root,
      servers: p.servers.map((s) => ({ id: s.id, name: s.name, command: s.command, dir: s.dir, ...(s.port ? { port: s.port } : {}) })),
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
