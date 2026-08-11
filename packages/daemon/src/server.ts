import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, DiscoveredProject, ServerMessage, UiState } from "@devhub/shared";
import { detectScripts, resolveCwd } from "./config.js";
import type { ProcessManager } from "./processManager.js";
import type { ProjectStore } from "./projectStore.js";
import { serveStatic } from "./staticServer.js";
import { writeUiState } from "./uiState.js";

interface ClientConn {
  ws: WebSocket;
  subscribed: Set<string>;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function createServer(pm: ProcessManager, store: ProjectStore, initialUiState: UiState, webDistPath: string) {
  const httpServer = createHttpServer((req, res) => serveStatic(webDistPath, req, res));
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientConn>();
  let uiState = initialUiState;

  function snapshotMsg(): ServerMessage {
    return { type: "snapshot", projects: store.metas(), servers: pm.allSnapshots(), uiState };
  }

  function broadcastSnapshot() {
    for (const c of clients) send(c.ws, snapshotMsg());
  }

  let lastDiscovered: DiscoveredProject[] = [];
  function broadcastDiscovered(items: DiscoveredProject[]) {
    lastDiscovered = items;
    for (const c of clients) send(c.ws, { type: "discovered", items });
  }

  /** Re-syncs ProcessManager from the store after a config-mutating op. */
  function resync() {
    pm.applyConfig(store.flatten());
    broadcastSnapshot();
  }

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    const client: ClientConn = { ws, subscribed: new Set() };
    clients.add(client);
    send(ws, snapshotMsg());
    if (lastDiscovered.length) send(ws, { type: "discovered", items: lastDiscovered });

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        switch (msg.type) {
          case "start":
            pm.start(msg.id);
            break;
          case "stop":
            pm.stop(msg.id);
            break;
          case "restart":
            pm.restart(msg.id);
            break;
          case "startProject":
            pm.startProject(msg.projectId);
            break;
          case "stopProject":
            pm.stopProject(msg.projectId);
            break;
          case "subscribeLogs":
            client.subscribed.add(msg.id);
            send(ws, { type: "logBacklog", id: msg.id, lines: pm.logBacklog(msg.id) });
            break;
          case "unsubscribeLogs":
            client.subscribed.delete(msg.id);
            break;
          case "createProject":
            store.createProject(msg.name);
            resync();
            break;
          case "updateProject":
            store.updateProject(msg.id, msg.name);
            resync();
            break;
          case "deleteProject":
            for (const s of pm.allSnapshots()) if (s.projectId === msg.id) pm.stop(s.id);
            store.deleteProject(msg.id);
            resync();
            break;
          case "createServer":
            store.createServer(
              msg.projectId,
              msg.kind === "docker"
                ? { kind: "docker", name: msg.name, container: msg.container, port: msg.port }
                : { kind: "process", name: msg.name, command: msg.command, cwd: msg.cwd, port: msg.port },
            );
            resync();
            break;
          case "updateServer": {
            const wasRunning = pm.snapshot(msg.id)?.state.status !== "stopped";
            store.updateServer(
              msg.id,
              msg.kind === "docker"
                ? { kind: "docker", name: msg.name, container: msg.container, port: msg.port }
                : { kind: "process", name: msg.name, command: msg.command, cwd: msg.cwd, port: msg.port },
            );
            resync();
            if (wasRunning) pm.logNote(msg.id, "[devhub] config changed — restart to apply");
            break;
          }
          case "deleteServer":
            pm.stop(msg.id);
            store.deleteServer(msg.id);
            resync();
            break;
          case "detectScripts": {
            const abs = resolveCwd(msg.cwd);
            const { scripts, hasPackageJson } = detectScripts(abs);
            send(ws, { type: "scriptsDetected", cwd: msg.cwd, scripts, hasPackageJson });
            break;
          }
          case "track":
            pm.track(msg.id).catch((err) => send(ws, { type: "commandError", message: (err as Error).message }));
            break;
          case "setUiState":
            uiState = msg.state;
            writeUiState(uiState);
            for (const c of clients) send(c.ws, { type: "uiState", state: uiState });
            break;
          case "reorderProjects":
            store.reorderProjects(msg.ids);
            resync();
            break;
          case "reorderServers":
            store.reorderServers(msg.projectId, msg.ids);
            resync();
            break;
        }
      } catch (err) {
        send(ws, { type: "commandError", message: (err as Error).message });
      }
    });

    ws.on("close", () => clients.delete(client));
  });

  pm.on("update", (server) => {
    for (const c of clients) send(c.ws, { type: "serverUpdated", server });
  });
  pm.on("removed", (id) => {
    for (const c of clients) send(c.ws, { type: "serverRemoved", id });
  });
  pm.on("log", (id, lines) => {
    for (const c of clients) if (c.subscribed.has(id)) send(c.ws, { type: "log", id, lines });
  });

  return { httpServer, broadcastSnapshot, broadcastDiscovered };
}
