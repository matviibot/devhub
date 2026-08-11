import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@devhub/shared";
import type { ProcessManager } from "./processManager.js";
import { serveStatic } from "./staticServer.js";

interface ClientConn {
  ws: WebSocket;
  subscribed: Set<string>;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function createServer(pm: ProcessManager, webDistPath: string) {
  const httpServer = createHttpServer((req, res) => serveStatic(webDistPath, req, res));
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientConn>();

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
    send(ws, { type: "snapshot", projects: pm.allSnapshots() });

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
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
        case "startGroup":
          pm.startGroup(msg.group);
          break;
        case "stopGroup":
          pm.stopGroup(msg.group);
          break;
        case "subscribeLogs":
          client.subscribed.add(msg.id);
          send(ws, { type: "logBacklog", id: msg.id, lines: pm.logBacklog(msg.id) });
          break;
        case "unsubscribeLogs":
          client.subscribed.delete(msg.id);
          break;
      }
    });

    ws.on("close", () => clients.delete(client));
  });

  pm.on("update", (project) => {
    for (const c of clients) send(c.ws, { type: "projectUpdated", project });
  });
  pm.on("removed", (id) => {
    for (const c of clients) send(c.ws, { type: "projectRemoved", id });
  });
  pm.on("log", (id, lines) => {
    for (const c of clients) if (c.subscribed.has(id)) send(c.ws, { type: "log", id, lines });
  });

  return httpServer;
}
