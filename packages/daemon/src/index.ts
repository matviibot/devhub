import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_PATH, loadConfig, watchConfig } from "./config.js";
import { ProcessManager } from "./processManager.js";
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

let projects;
try {
  projects = loadConfig();
} catch (err) {
  console.error(`[devhub] Failed to load config at ${CONFIG_PATH}:`, (err as Error).message);
  console.error(`[devhub] Copy devhub.config.example.json to devhub.config.json to get started.`);
  process.exit(1);
}

const pm = new ProcessManager(projects);
watchConfig(
  CONFIG_PATH,
  (next) => {
    console.log(`[devhub] Config changed, reloading ${next.length} project(s)`);
    pm.applyConfig(next);
  },
  (err) => console.error(`[devhub] Config reload failed, keeping previous config:`, err.message),
);

const httpServer = createServer(pm, webDistPath);
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
