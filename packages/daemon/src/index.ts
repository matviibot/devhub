import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_PATH, loadConfig, watchConfig, writeConfig } from "./config.js";
import { ProcessManager } from "./processManager.js";
import { ProjectStore } from "./projectStore.js";
import { createServer } from "./server.js";

process.on("uncaughtException", (err) => {
  console.error("[devhub] uncaught exception (daemon stays up):", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[devhub] unhandled rejection (daemon stays up):", err);
});

const here = dirname(fileURLToPath(import.meta.url));
const webDistPath = resolve(here, "../../web/dist");
const PORT = Number(process.env.DEVHUB_PORT ?? 4317);

if (!existsSync(CONFIG_PATH)) {
  console.log(`[devhub] No config at ${CONFIG_PATH} — starting with an empty workspace.`);
  writeConfig([], CONFIG_PATH);
}

let projects;
try {
  projects = loadConfig();
} catch (err) {
  console.error(`[devhub] Failed to load config at ${CONFIG_PATH}:`, (err as Error).message);
  process.exit(1);
}

const store = new ProjectStore(projects);
const pm = new ProcessManager(store.flatten());

const { httpServer, broadcastSnapshot } = createServer(pm, store, webDistPath);

watchConfig(
  CONFIG_PATH,
  (next) => {
    console.log(`[devhub] Config changed, reloading ${next.length} project(s)`);
    store.replaceAll(next);
    pm.applyConfig(store.flatten());
    broadcastSnapshot();
  },
  (err) => console.error(`[devhub] Config reload failed, keeping previous config:`, err.message),
);

httpServer.listen(PORT, () => {
  console.log(`[devhub] listening on http://localhost:${PORT}`);
});

function shutdown() {
  console.log("\n[devhub] shutting down, stopping all projects...");
  for (const { id } of pm.allSnapshots()) pm.stop(id);
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
