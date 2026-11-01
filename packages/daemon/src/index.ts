import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Snapshot } from "@devhub/shared";
import { AgentRegistry } from "./agentRegistry.js";
import { ActivityStore } from "./activityStore.js";
import { CONFIG_PATH, loadConfig, watchConfig, writeConfig } from "./config.js";
import { inspectDockerContainer, observeProcesses, scanDockerContainers, scanListeningSockets } from "./externalScan.js";
import { loadPrefs } from "./prefs.js";
import { ProcessManager } from "./processManager.js";
import { RepoStore } from "./repoStore.js";
import { ResourceRegistry } from "./resourceRegistry.js";
import { createServer } from "./server.js";

const execFileAsync = promisify(execFile);

const TICK_MS = 5000;
const KILL_GRACE_MS = 5000;

process.on("uncaughtException", (err) => console.error("[devhub] uncaught exception (daemon stays up):", err));
process.on("unhandledRejection", (err) => console.error("[devhub] unhandled rejection (daemon stays up):", err));

const here = dirname(fileURLToPath(import.meta.url));
const webDistPath = resolve(here, "../../web/dist");
const PORT = Number(process.env.DEVHUB_PORT ?? 4317);

if (!existsSync(CONFIG_PATH)) {
  console.log(`[devhub] No config at ${CONFIG_PATH} — starting with an empty workspace.`);
  writeConfig([], CONFIG_PATH);
}

let parsed;
try {
  parsed = loadConfig();
} catch (err) {
  console.error(`[devhub] Failed to load config at ${CONFIG_PATH}:`, (err as Error).message);
  process.exit(1);
}

const store = new RepoStore(parsed.projects, loadPrefs(), parsed.migration);
const pm = new ProcessManager([]);
const agents = new AgentRegistry();
const resources = new ResourceRegistry(agents);
const activity = new ActivityStore();

let snapshot: Snapshot | null = null;
let lastJson = "";
/** Last container start times, so a docker row keeps its uptime between the
 *  cheap `docker ps` tick and the more expensive per-container inspect. */
const dockerStarted = new Map<string, number | null>();
/** Every orphan the last build saw, so a kill request can be resolved to a
 *  real pid/container without the client sending one. */
let orphanIndex = new Map<string, { kind: "process" | "docker"; pid: number | null; container: string | null }>();

/** Coalesces the burst of runtime events a single start/stop produces into
 *  one rebuild, instead of one per event. */
let rebuildDebounce: ReturnType<typeof setTimeout> | null = null;
function requestRebuild() {
  if (rebuildDebounce) return;
  rebuildDebounce = setTimeout(() => {
    rebuildDebounce = null;
    void rebuild();
  }, 120);
}

function withEphemeralState(base: Snapshot): Snapshot {
  const agentRuns = agents.list();
  return { ...base, agentRuns, ...resources.snapshot(base.ports, agentRuns) };
}

let broadcastEphemeralSnapshot = () => {};
const { httpServer, broadcastSnapshot } = createServer({
  pm,
  store,
  agents,
  resources,
  webDistPath,
  getSnapshot: () => snapshot,
  requestRebuild,
  killOrphan,
  removeContainer,
  ephemeralStateChanged: () => {
    if (!snapshot) return;
    const next = withEphemeralState(snapshot);
    activity.record(snapshot, next);
    snapshot = { ...next, activity: activity.list() };
    lastJson = JSON.stringify(snapshot);
    broadcastEphemeralSnapshot();
  },
});
broadcastEphemeralSnapshot = broadcastSnapshot;

watchConfig(
  CONFIG_PATH,
  (next) => {
    console.log(`[devhub] Config changed, reloading ${next.projects.length} project(s)`);
    store.replaceAll(next.projects, next.migration);
    void rebuild({ worktrees: true });
  },
  (err) => console.error("[devhub] Config reload failed, keeping previous config:", err.message),
);

httpServer.listen(PORT, () => console.log(`[devhub] listening on http://localhost:${PORT}`));

// ------------------------------------------------------------------ tick

let building = false;
let rebuildQueued = false;
/** Sticky until a build actually consumes it. A queued rebuild used to drop
 *  the caller's `worktrees` flag, so the 5s refresh was silently lost every
 *  time it landed mid-build and devhub kept showing worktrees git had already
 *  pruned. */
let wantWorktreeRefresh = false;

/** Rebuilds the whole view from scratch: observe, classify, assemble.
 *
 *  There is no incremental path and that is deliberate. A service's status
 *  now depends on what is actually listening, so patching one row from a
 *  runtime event would leave the rest of the tree describing a world that
 *  moved on. The full build is cheap (one lsof pass, one docker ps, one
 *  `git worktree list` per repo) and always self-consistent. */
async function rebuild({ worktrees = false }: { worktrees?: boolean } = {}) {
  if (worktrees) wantWorktreeRefresh = true;
  if (building) {
    rebuildQueued = true;
    return;
  }
  building = true;
  try {
    if (wantWorktreeRefresh) {
      wantWorktreeRefresh = false;
      await store.refreshWorktrees();
    }

    const sockets = await scanListeningSockets();
    const [procs, containers] = await Promise.all([observeProcesses(sockets), scanDockerContainers()]);
    const built = store.build(procs, containers, sockets, pm.states(), dockerStarted);

    // Never kills on removal — see ProcessManager.applyConfig. An id can
    // vanish simply because a process exited between two ticks.
    pm.applyConfig(built.runtimes);

    // Adopt anything already running so it comes up controllable with no
    // click. This is the inverse of the old silent fold: it takes control of
    // a live process without writing a single line of config.
    for (const [id, { pid, port }] of built.adoptions) await pm.adoptKnown(id, pid, port);

    const next = withEphemeralState(built.snapshot);
    activity.record(snapshot, next);
    snapshot = { ...next, activity: activity.list() };
    orphanIndex = new Map(
      [...built.snapshot.projects.flatMap((p) => p.repos.flatMap((r) => r.orphans)), ...built.snapshot.unowned].map((o) => [
        o.id,
        { kind: o.kind, pid: o.pid, container: o.container },
      ]),
    );

    const json = JSON.stringify(snapshot);
    if (json !== lastJson) {
      lastJson = json;
      broadcastSnapshot();
    }

    // Precise start times for docker rows, one inspect each. Cheap enough at
    // this scale and the only way to get StartedAt.
    if (built.dockerRefs.length) {
      const results = await Promise.all(built.dockerRefs.map(async (r) => [r.id, await inspectDockerContainer(r.container)] as const));
      const states = new Map(results);
      for (const [id, info] of states) if (info) dockerStarted.set(id, info.startedAt);
      pm.reconcileDocker(new Map([...states].map(([id, info]) => [id, info])));
    }
  } catch (err) {
    console.error("[devhub] tick failed:", (err as Error).message);
  } finally {
    building = false;
    if (rebuildQueued) {
      rebuildQueued = false;
      void rebuild();
    }
  }
}

/** Kills a leaked process or stops a stranded container. The one action
 *  devhub offers that plain `lsof` can't: it already knows which repo the
 *  thing belonged to before its worktree was deleted. */
/** `docker rm` for a container that never ran. Destructive and not undoable,
 *  which is why the UI asks before calling it — but leaving no way at all to
 *  clear these produced a list that could only grow, which is the same config
 *  rot the rewrite exists to remove, just expressed as UI. */
async function removeContainer(container: string) {
  await execFileAsync("docker", ["rm", container], { timeout: 15000 });
}

async function killOrphan(id: string) {
  const o = orphanIndex.get(id);
  if (!o) throw new Error("That orphan is no longer listed — it may have exited already");
  if (o.kind === "docker" && o.container) {
    await execFileAsync("docker", ["stop", "--time", "10", o.container], { timeout: 15000 });
    return;
  }
  if (o.pid == null) throw new Error("No pid recorded for that orphan");
  try {
    process.kill(o.pid, "SIGTERM");
  } catch {
    return; // already gone
  }
  const deadline = Date.now() + KILL_GRACE_MS;
  while (Date.now() < deadline) {
    try {
      process.kill(o.pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  try {
    process.kill(o.pid, "SIGKILL");
  } catch {
    // Raced us to exit.
  }
}

void (async () => {
  await store.refreshWorktrees();
  await rebuild();
})();

setInterval(() => void rebuild({ worktrees: true }), TICK_MS);

function shutdown() {
  console.log("\n[devhub] shutting down, stopping what devhub started...");
  pm.shutdown();
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
