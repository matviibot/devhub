import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage, Snapshot } from "@devhub/shared";
import type { AgentRegistry } from "./agentRegistry.js";
import { detectScripts, expandHome, listDirectory } from "./config.js";
import type { ProcessManager } from "./processManager.js";
import { writePrefs } from "./prefs.js";
import type { RepoStore } from "./repoStore.js";
import type { ResourceRegistry } from "./resourceRegistry.js";
import { serveStatic } from "./staticServer.js";

interface ClientConn {
  ws: WebSocket;
  subscribed: Set<string>;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export interface ServerDeps {
  pm: ProcessManager;
  store: RepoStore;
  webDistPath: string;
  /** Latest built view — the tick loop keeps this current. */
  getSnapshot: () => Snapshot | null;
  /** Ask the tick loop to rebuild and rebroadcast right now, rather than
   *  waiting out the poll interval, after a mutation that changes the tree. */
  requestRebuild: () => void;
  /** Kill an orphaned process or stop an orphaned container. */
  killOrphan: (id: string) => Promise<void>;
  removeContainer: (container: string) => Promise<void>;
  agents: AgentRegistry;
  resources: ResourceRegistry;
  /** Agent/resource changes don't require a process/docker rescan. */
  ephemeralStateChanged: () => void;
}

export function createServer({ pm, store, webDistPath, getSnapshot, requestRebuild, killOrphan, removeContainer, agents, resources, ephemeralStateChanged }: ServerDeps) {
  const httpServer = createHttpServer((req, res) => {
    if ((req.url ?? "").startsWith("/api/")) {
      void handleAgentApi(req, res, store, agents, resources, getSnapshot, ephemeralStateChanged, requestRebuild);
      return;
    }
    serveStatic(webDistPath, req, res);
  });
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<ClientConn>();

  function broadcastSnapshot() {
    const snap = getSnapshot();
    if (!snap) return;
    const msg: ServerMessage = { type: "snapshot", ...snap };
    for (const c of clients) send(c.ws, msg);
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
    const snap = getSnapshot();
    if (snap) send(ws, { type: "snapshot", ...snap });

    const done = (ids: string[]) => send(ws, { type: "actionDone", ids });

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        switch (msg.type) {
          // Every action acknowledges the ids it touched, so the UI can clear
          // exactly those spinners instead of clearing all of them on the next
          // unrelated snapshot. `done` fires on failure too — the row should
          // stop spinning whether or not the command worked, and the reason
          // arrives separately as a commandError.
          case "start":
            void pm.start(msg.id).finally(() => done([msg.id]));
            break;
          case "stop":
            pm.stop(msg.id);
            done([msg.id]);
            break;
          case "restart":
            pm.restart(msg.id);
            done([msg.id]);
            break;
          case "startWorktree": {
            const cur = getSnapshot();
            const ids = cur ? store.serviceIdsForWorktree(cur, msg.worktreePath) : [];
            void pm.startMany(ids).finally(() => done([...ids, `wt:${msg.worktreePath}`]));
            break;
          }
          case "stopWorktree": {
            const cur = getSnapshot();
            const ids = cur ? store.serviceIdsForWorktree(cur, msg.worktreePath) : [];
            pm.stopMany(ids);
            done([...ids, `wt:${msg.worktreePath}`]);
            break;
          }
          case "startProject": {
            const cur = getSnapshot();
            const ids = cur ? store.serviceIdsForProject(cur, msg.projectId, "start") : [];
            void pm.startMany(ids).finally(() => done([...ids, `project:${msg.projectId}`]));
            break;
          }
          case "stopProject": {
            const cur = getSnapshot();
            const ids = cur ? store.serviceIdsForProject(cur, msg.projectId, "stop") : [];
            pm.stopMany(ids);
            done([...ids, `project:${msg.projectId}`]);
            break;
          }
          case "subscribeLogs":
            client.subscribed.add(msg.id);
            send(ws, { type: "logBacklog", id: msg.id, lines: pm.logBacklog(msg.id) });
            break;
          case "unsubscribeLogs":
            client.subscribed.delete(msg.id);
            break;
          case "removeContainer":
            removeContainer(msg.container)
              .then(() => {
                requestRebuild();
                send(ws, { type: "actionDone", ids: [`orphan:docker:${msg.container}`] });
              })
              .catch((err) => {
                send(ws, { type: "commandError", message: `Couldn't remove ${msg.container}: ${(err as Error).message}` });
                send(ws, { type: "actionDone", ids: [`orphan:docker:${msg.container}`] });
              });
            break;
          case "killOrphan":
            killOrphan(msg.id)
              .then(requestRebuild)
              .catch((err) => send(ws, { type: "commandError", message: (err as Error).message }));
            break;
          case "createProject":
            store.createProject(msg.name, msg.repos ?? []);
            requestRebuild();
            break;
          case "updateProject":
            store.updateProject(msg.id, msg.name, msg.repos);
            requestRebuild();
            break;
          case "deleteProject":
            // Deliberately kills nothing. A project is now purely a grouping
            // over repos; the processes under it were not created by devhub
            // and removing the grouping is not a reason to stop them.
            store.deleteProject(msg.id);
            requestRebuild();
            break;
          case "saveLauncher":
            store.saveLauncher(msg.projectId, msg.repoPath, msg.launcher, msg.replacingRole);
            requestRebuild();
            break;
          case "deleteLauncher":
            store.deleteLauncher(msg.projectId, msg.repoPath, msg.role);
            requestRebuild();
            break;
          case "setComposePolicy":
            store.setComposePolicy(msg.projectId, msg.repoPath, msg.policy);
            requestRebuild();
            break;
          case "dismissMigration":
            store.dismissMigration();
            requestRebuild();
            break;
          case "detectScripts": {
            const abs = expandHome(msg.cwd);
            const { scripts, hasPackageJson } = detectScripts(abs);
            send(ws, { type: "scriptsDetected", cwd: msg.cwd, scripts, hasPackageJson });
            break;
          }
          case "setPrefs":
            store.setPrefs(msg.prefs);
            writePrefs(msg.prefs);
            requestRebuild();
            break;
          case "reorderProjects":
            store.reorderProjects(msg.ids);
            writePrefs(store.getPrefs());
            requestRebuild();
            break;
          case "listDirectory":
            send(ws, { type: "directoryListing", ...listDirectory(msg.path) });
            break;
          case "revealPath":
            execFile("open", [expandHome(msg.path)], (err) => {
              if (err) send(ws, { type: "commandError", message: `Couldn't open "${msg.path}": ${err.message}` });
            });
            break;
        }
      } catch (err) {
        send(ws, { type: "commandError", message: (err as Error).message });
      }
    });

    ws.on("close", () => clients.delete(client));
  });

  // Any runtime transition means the view is stale — rebuild rather than
  // patching a single row, since status now depends on observation too.
  pm.on("update", () => requestRebuild());
  pm.on("log", (id, lines) => {
    for (const c of clients) if (c.subscribed.has(id)) send(c.ws, { type: "log", id, lines });
  });
  // A failed start/stop/restart reaches every client, not just the one that
  // asked: the row it concerns is on all of their screens.
  pm.on("actionFailed", (message: string) => {
    for (const c of clients) send(c.ws, { type: "commandError", message });
  });

  return { httpServer, broadcastSnapshot };
}

/** Small localhost API for coding agents. It is intentionally HTTP rather
 * than tied to the browser WebSocket so any agent or shell can participate
 * without importing DevHub's UI client. */
async function handleAgentApi(
  req: IncomingMessage,
  res: ServerResponse,
  store: RepoStore,
  agents: AgentRegistry,
  resources: ResourceRegistry,
  getSnapshot: () => Snapshot | null,
  changed: () => void,
  rebuild: () => void,
) {
  if (!isLoopback(req.socket.remoteAddress)) {
    json(res, 403, { error: "The agent API only accepts connections from this machine" });
    return;
  }

  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  try {
    const iconMatch = path.match(/^\/api\/projects\/([^/]+)\/icon$/);
    if (req.method === "GET" && iconMatch) {
      const iconPath = store.projectIconPath(decodeURIComponent(iconMatch[1]));
      if (!iconPath) {
        json(res, 404, { error: "Project icon not found" });
        return;
      }
      const type = ({ ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" } as Record<string, string>)[extname(iconPath).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
      createReadStream(iconPath).on("error", () => res.destroy()).pipe(res);
      return;
    }

    if (req.method === "GET" && path === "/api/agent-runs") {
      json(res, 200, { runs: agents.list() });
      return;
    }

    if (req.method === "GET" && path === "/api/resources") {
      const snapshot = getSnapshot();
      const view = resources.snapshot(snapshot?.ports ?? [], agents.list());
      json(res, 200, view);
      return;
    }

    if (req.method === "POST" && path === "/api/ports/reserve") {
      const body = await readJson(req);
      const range = portRange(body.range);
      const reservation = resources.reserve({
        runId: requiredString(body.runId, "runId"),
        role: requiredString(body.role, "role"),
        range,
        preferred: typeof body.preferred === "number" ? body.preferred : undefined,
      }, getSnapshot()?.ports ?? []);
      changed();
      json(res, 201, { reservation });
      return;
    }

    if (req.method === "POST" && path === "/api/services/announce") {
      const body = await readJson(req);
      const announcement = resources.announce({
        runId: requiredString(body.runId, "runId"),
        role: requiredString(body.role, "role"),
        port: typeof body.port === "number" ? body.port : undefined,
        url: typeof body.url === "string" ? body.url : undefined,
      });
      const observedAnnouncement = resources
        .snapshot(getSnapshot()?.ports ?? [], agents.list())
        .serviceAnnouncements.find((item) => item.id === announcement.id) ?? announcement;
      changed();
      json(res, 201, { announcement: observedAnnouncement });
      return;
    }

    const reservationMatch = path.match(/^\/api\/ports\/reservations\/([^/]+)$/);
    if (reservationMatch && req.method === "DELETE") {
      const removed = resources.releaseReservation(decodeURIComponent(reservationMatch[1]));
      changed();
      json(res, removed ? 200 : 404, removed ? { released: true } : { error: "Port reservation not found" });
      return;
    }

    const announcementMatch = path.match(/^\/api\/services\/announcements\/([^/]+)$/);
    if (announcementMatch && req.method === "DELETE") {
      const removed = resources.releaseAnnouncement(decodeURIComponent(announcementMatch[1]));
      changed();
      json(res, removed ? 200 : 404, removed ? { released: true } : { error: "Service announcement not found" });
      return;
    }

    if (req.method === "POST" && path === "/api/projects/ensure") {
      const body = await readJson(req);
      if (typeof body.cwd !== "string" || !body.cwd.trim()) throw new Error('"cwd" is required');
      const context = await store.ensureProjectForPath(body.cwd, {
        projectName: typeof body.projectName === "string" ? body.projectName : undefined,
        sourcePath: typeof body.sourcePath === "string" ? body.sourcePath : undefined,
      });
      rebuild();
      json(res, context.created ? 201 : 200, context);
      return;
    }

    if (req.method === "POST" && path === "/api/agent-runs") {
      const body = await readJson(req);
      let projectId = typeof body.projectId === "string" ? body.projectId : "";
      let workspacePaths = stringArray(body.workspacePaths);
      let createdProject = false;
      if (typeof body.cwd === "string" && body.cwd.trim()) {
        const context = await store.ensureProjectForPath(body.cwd, {
          projectName: typeof body.projectName === "string" ? body.projectName : undefined,
          sourcePath: typeof body.sourcePath === "string" ? body.sourcePath : undefined,
        });
        projectId ||= context.projectId;
        if (!workspacePaths.length) workspacePaths = [context.workspacePath];
        createdProject = context.created;
      }
      if (!store.project(projectId)) throw new Error(`Project "${projectId}" was not found`);
      const run = agents.register({
        id: typeof body.id === "string" ? body.id : undefined,
        agent: typeof body.agent === "string" ? body.agent : "",
        task: typeof body.task === "string" ? body.task : undefined,
        projectId,
        workspacePaths,
        status: agentStatus(body.status),
        detail: typeof body.detail === "string" || body.detail === null ? body.detail : undefined,
        ttlMs: typeof body.ttlMs === "number" ? body.ttlMs : undefined,
      });
      if (createdProject) rebuild();
      else changed();
      json(res, 201, { run, createdProject });
      return;
    }

    const runMatch = path.match(/^\/api\/agent-runs\/([^/]+)$/);
    const checkMatch = path.match(/^\/api\/agent-runs\/([^/]+)\/checks\/([^/]+)$/);
    if (checkMatch && req.method === "PUT") {
      const body = await readJson(req);
      const status = checkStatus(body.status);
      if (!status) throw new Error('"status" must be pending, ready, or blocked');
      const run = agents.setCheck(decodeURIComponent(checkMatch[1]), decodeURIComponent(checkMatch[2]), {
        label: typeof body.label === "string" ? body.label : undefined,
        status,
        detail: typeof body.detail === "string" || body.detail === null ? body.detail : undefined,
      });
      changed();
      json(res, 200, { run, check: run.checks.find((item) => item.key === decodeURIComponent(checkMatch[2])) });
      return;
    }

    if (checkMatch && req.method === "DELETE") {
      const run = agents.removeCheck(decodeURIComponent(checkMatch[1]), decodeURIComponent(checkMatch[2]));
      changed();
      json(res, 200, { run, removed: true });
      return;
    }

    if (runMatch && req.method === "PATCH") {
      const body = await readJson(req);
      if (typeof body.projectId === "string" && !store.project(body.projectId)) throw new Error(`Project "${body.projectId}" was not found`);
      const run = agents.update(decodeURIComponent(runMatch[1]), {
        agent: typeof body.agent === "string" ? body.agent : undefined,
        task: typeof body.task === "string" ? body.task : undefined,
        projectId: typeof body.projectId === "string" ? body.projectId : undefined,
        workspacePaths: Array.isArray(body.workspacePaths) ? stringArray(body.workspacePaths) : undefined,
        status: agentStatus(body.status),
        detail: typeof body.detail === "string" || body.detail === null ? body.detail : undefined,
        ttlMs: typeof body.ttlMs === "number" ? body.ttlMs : undefined,
      });
      if (run.status === "done" || run.status === "failed") resources.releaseRun(run.id);
      changed();
      json(res, 200, { run });
      return;
    }

    if (runMatch && req.method === "DELETE") {
      const id = decodeURIComponent(runMatch[1]);
      const removed = agents.release(id);
      if (removed) resources.releaseRun(id);
      changed();
      json(res, removed ? 200 : 404, removed ? { released: true } : { error: "Agent run not found" });
      return;
    }

    json(res, 404, { error: "API route not found" });
  } catch (err) {
    json(res, 400, { error: (err as Error).message });
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 64 * 1024) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object");
  return value as Record<string, unknown>;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`${JSON.stringify(body)}\n`);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function agentStatus(value: unknown): "working" | "waiting" | "done" | "failed" | undefined {
  return value === "working" || value === "waiting" || value === "done" || value === "failed" ? value : undefined;
}

function checkStatus(value: unknown): "pending" | "ready" | "blocked" | undefined {
  return value === "pending" || value === "ready" || value === "blocked" ? value : undefined;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`"${name}" is required`);
  return value;
}

function portRange(value: unknown): [number, number] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "number" || typeof value[1] !== "number") {
    throw new Error('"range" must be [from, to]');
  }
  return [value[0], value[1]];
}

function isLoopback(address: string | undefined): boolean {
  return address === "::1" || address === "127.0.0.1" || address?.startsWith("::ffff:127.") === true;
}
