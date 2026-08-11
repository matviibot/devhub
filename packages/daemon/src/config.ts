import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import type { ProjectConfig } from "@devhub/shared";

const here = dirname(fileURLToPath(import.meta.url));

export const CONFIG_PATH =
  process.env.DEVHUB_CONFIG ?? resolve(here, "../../../devhub.config.json");

interface RawConfigFile {
  projects: Array<{
    id?: string;
    name: string;
    cwd: string;
    command: string;
    group?: string;
    port?: number;
  }>;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseConfig(raw: string): ProjectConfig[] {
  const data = JSON.parse(raw) as RawConfigFile;
  if (!Array.isArray(data.projects)) {
    throw new Error('Config must have a top-level "projects" array');
  }

  const seen = new Set<string>();
  return data.projects.map((p) => {
    if (!p.name || !p.cwd || !p.command) {
      throw new Error(
        `Project entry missing required field(s) (name/cwd/command): ${JSON.stringify(p)}`,
      );
    }
    const id = p.id ?? slugify(p.name);
    if (seen.has(id)) {
      throw new Error(`Duplicate project id "${id}" — give it an explicit unique "id" field`);
    }
    seen.add(id);
    return {
      id,
      name: p.name,
      cwd: p.cwd,
      command: p.command,
      group: p.group,
      port: p.port,
    };
  });
}

export function loadConfig(path: string = CONFIG_PATH): ProjectConfig[] {
  const raw = readFileSync(path, "utf-8");
  return parseConfig(raw);
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
