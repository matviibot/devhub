import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import type { DetectedScript, DirectoryEntry, Launcher, MigrationCandidate, PortPolicy, Project, Repo } from "@devhub/shared";
import { deriveRole } from "./roles.js";

const here = dirname(fileURLToPath(import.meta.url));

export const CONFIG_PATH = process.env.DEVHUB_CONFIG ?? resolve(here, "../../../devhub.config.json");

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

/** Inverse of expandHome — config stores tilde form so the file stays
 *  readable and portable between machines. */
export function tildify(path: string): string {
  const home = homedir();
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}

export const resolveCwd = expandHome;

// --------------------------------------------------------------- parsing

interface RawPolicy {
  ports?: string;
  range?: [number, number];
  env?: string;
}
interface RawLauncher {
  role?: string;
  name?: string;
  cmd?: string;
  command?: string;
  dir?: string;
  policy?: RawPolicy;
  killPatterns?: string[];
}
interface RawRepo {
  path?: string;
  label?: string;
  launchers?: RawLauncher[];
  compose?: RawPolicy;
}
/** The pre-rewrite shape, read once so commands the user typed aren't lost.
 *  Nothing else from it is kept — see docs/design-observation-first.md
 *  decision 3. */
interface LegacyServer {
  name?: string;
  kind?: string;
  command?: string;
  cwd?: string;
}
interface LegacyRoot {
  path?: string;
}
interface RawProject {
  id?: string;
  name?: string;
  icon?: string;
  repos?: RawRepo[];
  looseLaunchers?: RawLauncher[];
  /** @deprecated pre-rewrite */
  roots?: LegacyRoot[];
  /** @deprecated pre-rewrite */
  servers?: LegacyServer[];
}

function parsePolicy(raw: RawPolicy | undefined, what: string): PortPolicy {
  if (!raw || raw.ports === "fixed" || raw.ports === undefined) return { ports: "fixed" };
  if (raw.ports !== "alloc") throw new Error(`${what}: unknown port policy "${raw.ports}" (expected "fixed" or "alloc")`);
  const range = raw.range;
  if (!Array.isArray(range) || range.length !== 2 || !range.every((n) => Number.isInteger(n))) {
    throw new Error(`${what}: an "alloc" policy needs a "range": [from, to] of two integers`);
  }
  if (range[1] < range[0]) throw new Error(`${what}: port range [${range[0]}, ${range[1]}] is inverted`);
  return { ports: "alloc", range: [range[0], range[1]], ...(raw.env ? { env: raw.env } : {}) };
}

function parseLauncher(raw: RawLauncher, what: string): Launcher {
  const role = (raw.role ?? raw.name ?? "").trim();
  if (!role) throw new Error(`${what}: launcher missing "role"`);
  const cmd = (raw.cmd ?? raw.command ?? "").trim();
  if (!cmd) throw new Error(`${what}: launcher "${role}" missing "cmd"`);
  const dir = raw.dir?.trim().replace(/^\.?\/*/, "").replace(/\/+$/, "");
  return {
    role,
    cmd,
    ...(dir ? { dir } : {}),
    policy: parsePolicy(raw.policy, `${what} launcher "${role}"`),
    ...(raw.killPatterns?.length ? { killPatterns: raw.killPatterns } : {}),
  };
}

export interface ParsedConfig {
  projects: Project[];
  /** Commands recovered from a pre-rewrite config, offered once in the UI. */
  migration: MigrationCandidate[];
  /** True when this file was still in the pre-rewrite shape. */
  legacy: boolean;
}

/** Turns a pre-rewrite project (roots[] + servers[]) into the new shape:
 *  its roots become repos with no launchers, and each process server's
 *  command becomes a migration candidate keyed by the role its cwd derives
 *  to. Nothing is silently promoted — the candidates only surface as an
 *  offer in the UI. */
function migrateLegacy(p: RawProject, projectId: string): { repos: Repo[]; candidates: MigrationCandidate[] } {
  const repos: Repo[] = (p.roots ?? [])
    .map((r) => (r.path ?? "").trim())
    .filter(Boolean)
    .map((path) => ({ path, launchers: [] }));

  const candidates: MigrationCandidate[] = [];
  const seen = new Set<string>();
  for (const s of p.servers ?? []) {
    if (s.kind === "docker" || !s.command?.trim() || !s.cwd?.trim()) continue;
    const abs = expandHome(s.cwd.trim());
    // Attribute to the repo whose expanded path is the longest prefix of
    // this cwd. A server under a since-deleted sibling worktree matches
    // nothing and is dropped, which is the intent.
    let best: Repo | null = null;
    for (const repo of repos) {
      const repoAbs = expandHome(repo.path).replace(/\/$/, "");
      const parent = dirname(repoAbs);
      const sibling = `${parent}/${basename(repoAbs)}--`;
      const underRepo = abs === repoAbs || abs.startsWith(`${repoAbs}/`);
      const underSibling = abs.startsWith(sibling);
      if (!underRepo && !underSibling) continue;
      if (!best || expandHome(repo.path).length > expandHome(best.path).length) best = repo;
    }
    if (!best) continue;
    const repoAbs = expandHome(best.path).replace(/\/$/, "");
    const owner = underWorktreeBase(abs, repoAbs);
    const { role, dir } = deriveRole(abs, owner, repoAbs);
    const key = `${best.path}\0${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ projectId, repoPath: best.path, role, command: s.command.trim(), dir });
  }
  return { repos, candidates };
}

/** The worktree-ish base a legacy cwd sits under: either the repo itself or
 *  a `<repo>--<slug>` sibling. Used only to make role derivation relative to
 *  the right checkout during migration. */
function underWorktreeBase(abs: string, repoAbs: string): string {
  const parent = dirname(repoAbs);
  const prefix = `${parent}/${basename(repoAbs)}--`;
  if (abs.startsWith(prefix)) {
    const rest = abs.slice(parent.length + 1);
    return `${parent}/${rest.split("/")[0]}`;
  }
  return repoAbs;
}

export function parseConfig(raw: string): ParsedConfig {
  const data = JSON.parse(raw) as { projects?: RawProject[] };
  if (!Array.isArray(data.projects)) throw new Error('Config must have a top-level "projects" array');

  const seenIds = new Set<string>();
  const migration: MigrationCandidate[] = [];
  let legacy = false;

  const projects = data.projects.map((p) => {
    const name = (p.name ?? "").trim();
    if (!name) throw new Error(`Project entry missing required field "name": ${JSON.stringify(p)}`);
    const id = p.id ?? slugify(name);
    if (seenIds.has(id)) throw new Error(`Duplicate project id "${id}" — give it an explicit unique "id"`);
    seenIds.add(id);

    let repos: Repo[];
    if (p.repos) {
      repos = p.repos
        .map((r) => (r.path ?? "").trim())
        .filter(Boolean)
        .map((path, i) => {
          const r = p.repos![i];
          return {
            path,
            ...(r.label?.trim() ? { label: r.label.trim() } : {}),
            launchers: (r.launchers ?? []).map((l) => parseLauncher(l, `project "${name}" repo "${path}"`)),
            ...(r.compose ? { compose: parsePolicy(r.compose, `project "${name}" repo "${path}" compose`) } : {}),
          };
        });
    } else {
      legacy = true;
      const migrated = migrateLegacy(p, id);
      repos = migrated.repos;
      migration.push(...migrated.candidates);
    }

    const looseLaunchers = (p.looseLaunchers ?? []).map((l) => parseLauncher(l, `project "${name}" loose`));
    const icon = p.icon?.trim();
    return { id, name, ...(icon ? { icon } : {}), repos, ...(looseLaunchers.length ? { looseLaunchers } : {}) };
  });

  if (legacy) {
    console.log(
      `[devhub] read a pre-rewrite config: kept ${projects.reduce((n, p) => n + p.repos.length, 0)} repo path(s), ` +
        `recovered ${migration.length} command(s) as launcher suggestions, discarded every stored server row. ` +
        `Nothing is written back until you save a launcher.`,
    );
  }
  return { projects, migration, legacy };
}

/** Reads the config, and — the first time it finds a pre-rewrite file —
 *  snapshots it next to itself before anything can overwrite it.
 *
 *  The new shape cannot represent the old rows, so the first `saveLauncher`
 *  rewrites the file and the remaining recovered commands are gone for good.
 *  Keeping a copy means a half-finished review is recoverable instead of
 *  being a one-way door the user walked through without being told. */
export function loadConfig(path: string = CONFIG_PATH): ParsedConfig {
  const raw = readFileSync(path, "utf-8");
  const parsed = parseConfig(raw);
  if (parsed.legacy) {
    const backup = path.replace(/\.json$/, "") + ".pre-rewrite.json";
    if (!existsSync(backup)) {
      writeFileSync(backup, raw, "utf-8");
      console.log(`[devhub] kept a copy of your pre-rewrite config at ${backup}`);
    }
  }
  return parsed;
}

function policyOut(p: PortPolicy) {
  return p.ports === "alloc" ? { ports: "alloc", range: p.range, ...(p.env ? { env: p.env } : {}) } : { ports: "fixed" };
}

export function writeConfig(projects: Project[], path: string = CONFIG_PATH): void {
  const data = {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.icon ? { icon: p.icon } : {}),
      repos: p.repos.map((r) => ({
        path: r.path,
        ...(r.label ? { label: r.label } : {}),
        ...(r.compose ? { compose: policyOut(r.compose) } : {}),
        launchers: r.launchers.map((l) => ({
          role: l.role,
          cmd: l.cmd,
          ...(l.dir ? { dir: l.dir } : {}),
          policy: policyOut(l.policy),
          ...(l.killPatterns?.length ? { killPatterns: l.killPatterns } : {}),
        })),
      })),
      ...(p.looseLaunchers?.length
        ? {
            looseLaunchers: p.looseLaunchers.map((l) => ({
              role: l.role,
              cmd: l.cmd,
              ...(l.dir ? { dir: l.dir } : {}),
              policy: policyOut(l.policy),
            })),
          }
        : {}),
    })),
  };
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export function watchConfig(path: string, onChange: (c: ParsedConfig) => void, onError: (err: Error) => void): () => void {
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

// ------------------------------------------------------------- filesystem

/** Lists subdirectories for the web UI's folder browser. Flags git repos so
 *  picking a repo path doesn't need a round trip per row. */
export function listDirectory(rawPath?: string): { path: string; parent: string | null; entries: DirectoryEntry[]; error?: string } {
  const path = rawPath?.trim() ? resolve(expandHome(rawPath.trim())) : homedir();
  let entries: DirectoryEntry[] = [];
  let error: string | undefined;
  try {
    entries = readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({
        name: e.name,
        hasPackageJson: existsSync(join(path, e.name, "package.json")),
        isGitRepo: existsSync(join(path, e.name, ".git")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    error = (err as Error).message;
  }
  const up = dirname(path);
  return { path, parent: up === path ? null : up, entries, error };
}

const SCRIPT_IGNORE = new Set(["pretest", "postinstall", "preinstall", "postpublish"]);

export function detectScripts(absoluteDir: string): { scripts: DetectedScript[]; hasPackageJson: boolean } {
  const pkgPath = join(absoluteDir, "package.json");
  if (!existsSync(pkgPath)) return { scripts: [], hasPackageJson: false };

  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return { scripts: [], hasPackageJson: true };
  }

  const runner = existsSync(join(absoluteDir, "pnpm-lock.yaml")) ? "pnpm run" : existsSync(join(absoluteDir, "yarn.lock")) ? "yarn" : "npm run";
  const scripts = Object.keys(pkg.scripts ?? {})
    .filter((name) => !SCRIPT_IGNORE.has(name))
    .map((name) => ({ name, command: `${runner} ${name}` }));
  return { scripts, hasPackageJson: true };
}
