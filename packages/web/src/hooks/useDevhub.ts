import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, DetectedScript, DirectoryEntry, DiscoveredProject, ProjectMeta, ProjectRoot, ServerMessage, ServerSnapshot, UiState } from "@devhub/shared";

const RECONNECT_DELAY_MS = 1500;
const EMPTY_UI_STATE: UiState = { ignoredDiscovered: [], collapsedGroups: [] };
// How long an optimistic project or a start/stop/restart is allowed to sit
// unconfirmed before we give up on it, roll the UI back, and surface an
// error — guards against a dropped WS message leaving the UI stuck showing
// something that never actually happened.
const PENDING_TIMEOUT_MS = 10000;

export interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
  error?: string;
}

type LogListener = (lines: string[], isBacklog: boolean) => void;

interface Detected {
  cwd: string;
  scripts: DetectedScript[];
  hasPackageJson: boolean;
}

export type ServerInput =
  | { kind: "process"; name: string; command: string; cwd: string; port?: number }
  | { kind: "docker"; name: string; container: string; port?: number };

export function useDevhub() {
  const [connected, setConnected] = useState(false);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [servers, setServers] = useState<ServerSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredProject[]>([]);
  const [uiState, setUiStateLocal] = useState<UiState>(EMPTY_UI_STATE);
  const [directoryListing, setDirectoryListing] = useState<DirectoryListing | null>(null);
  const [pendingServerActions, setPendingServerActions] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());
  // Optimistic-create bookkeeping: a project created client-side gets a
  // temp-id placeholder in `projects` immediately, so the "create project ->
  // chain into add-server" flow doesn't have to sit and wait for a full WS
  // round trip before it can proceed. `pendingProjectNames` holds temp ids
  // still awaiting the daemon's confirming snapshot; `resolvedTempIds` keeps
  // the temp-id -> real-id mapping around afterward so any in-flight
  // createServer call aimed at the temp id still lands on the right project.
  const pendingProjectNames = useRef<Map<string, string>>(new Map());
  const resolvedTempIds = useRef<Map<string, string>>(new Map());
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Log lines are pushed straight to xterm.js by listeners rather than kept
  // in React state — they're append-only and React re-renders would need to
  // diff trimmed arrays, which is exactly the kind of bookkeeping this avoids.
  const logListenersRef = useRef<Map<string, Set<LogListener>>>(new Map());

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      if (cancelled) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        for (const id of subscribedRef.current) send({ type: "subscribeLogs", id });
      };

      ws.onmessage = (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "snapshot": {
            // Reconcile any still-pending optimistic project inserts against
            // the daemon's authoritative list, matched by name (same trick
            // the undo/chain-to-add-server flows already use elsewhere).
            // Anything not yet confirmed stays appended so it doesn't
            // flicker out of the list if this snapshot was triggered by an
            // unrelated mutation.
            const stillPending: ProjectMeta[] = [];
            for (const [tempId, name] of pendingProjectNames.current) {
              const real = msg.projects.find((p) => p.name === name);
              if (real) {
                resolvedTempIds.current.set(tempId, real.id);
                pendingProjectNames.current.delete(tempId);
                clearTimeout(pendingTimers.current.get(tempId));
                pendingTimers.current.delete(tempId);
              } else {
                stillPending.push({ id: tempId, name, roots: [] });
              }
            }
            setProjects(stillPending.length ? [...msg.projects, ...stillPending] : msg.projects);
            setServers(msg.servers);
            setUiStateLocal(msg.uiState);
            break;
          }
          case "serverUpdated":
            setServers((prev) => {
              const idx = prev.findIndex((s) => s.id === msg.server.id);
              if (idx === -1) return [...prev, msg.server];
              const next = [...prev];
              next[idx] = msg.server;
              return next;
            });
            setPendingServerActions((prev) => {
              if (!prev.has(msg.server.id)) return prev;
              const next = new Set(prev);
              next.delete(msg.server.id);
              return next;
            });
            break;
          case "serverRemoved":
            setServers((prev) => prev.filter((s) => s.id !== msg.id));
            setPendingServerActions((prev) => {
              if (!prev.has(msg.id)) return prev;
              const next = new Set(prev);
              next.delete(msg.id);
              return next;
            });
            break;
          case "logBacklog":
            for (const listener of logListenersRef.current.get(msg.id) ?? []) {
              listener(msg.lines, true);
            }
            break;
          case "log":
            for (const listener of logListenersRef.current.get(msg.id) ?? []) {
              listener(msg.lines, false);
            }
            break;
          case "scriptsDetected":
            setDetected({ cwd: msg.cwd, scripts: msg.scripts, hasPackageJson: msg.hasPackageJson });
            break;
          case "commandError":
            setError(msg.message);
            // We don't get a correlation id back for which action failed, so
            // roll back every still-unconfirmed optimistic project — this is
            // a single local daemon, in practice there's at most one create
            // in flight at a time.
            if (pendingProjectNames.current.size) {
              const staleIds = new Set(pendingProjectNames.current.keys());
              for (const id of staleIds) {
                clearTimeout(pendingTimers.current.get(id));
                pendingTimers.current.delete(id);
              }
              pendingProjectNames.current.clear();
              setProjects((prev) => prev.filter((p) => !staleIds.has(p.id)));
            }
            setPendingServerActions(new Set());
            break;
          case "discovered":
            setDiscovered(msg.items);
            break;
          case "uiState":
            setUiStateLocal(msg.state);
            break;
          case "directoryListing":
            setDirectoryListing(msg);
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const subscribeLogs = useCallback(
    (id: string) => {
      if (subscribedRef.current.has(id)) return;
      subscribedRef.current.add(id);
      send({ type: "subscribeLogs", id });
    },
    [send],
  );

  /** Registers a listener for a server's log lines; returns an unsubscribe fn. */
  const addLogListener = useCallback(
    (id: string, listener: LogListener) => {
      if (!logListenersRef.current.has(id)) logListenersRef.current.set(id, new Set());
      logListenersRef.current.get(id)!.add(listener);
      subscribeLogs(id);
      return () => {
        logListenersRef.current.get(id)?.delete(listener);
      };
    },
    [subscribeLogs],
  );

  /** Resolves a possibly-optimistic temp project id to its real daemon id,
   *  once known — passes real ids straight through unchanged. */
  const resolveProjectId = useCallback((id: string) => resolvedTempIds.current.get(id) ?? id, []);

  /** Fires `id`-scoped WS messages that flip a server's status (start/stop/
   *  restart) with an immediate local "pending" flag, so the button shows a
   *  spinner right away instead of sitting inert until a status update
   *  comes back — Docker actions in particular can take a couple seconds. */
  const withPendingAction = useCallback(
    (id: string, msg: ClientMessage) => {
      setPendingServerActions((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      send(msg);
      clearTimeout(pendingTimers.current.get(id));
      pendingTimers.current.set(
        id,
        setTimeout(() => {
          pendingTimers.current.delete(id);
          setPendingServerActions((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, PENDING_TIMEOUT_MS),
      );
    },
    [send],
  );

  const createProject = useCallback(
    (name: string) => {
      const tempId = `temp-${crypto.randomUUID()}`;
      pendingProjectNames.current.set(tempId, name);
      setProjects((prev) => [...prev, { id: tempId, name, roots: [] }]);
      send({ type: "createProject", name });
      pendingTimers.current.set(
        tempId,
        setTimeout(() => {
          if (!pendingProjectNames.current.has(tempId)) return;
          pendingProjectNames.current.delete(tempId);
          pendingTimers.current.delete(tempId);
          setProjects((prev) => prev.filter((p) => p.id !== tempId));
          setError(`Couldn't create "${name}" — no response from the daemon`);
        }, PENDING_TIMEOUT_MS),
      );
      return tempId;
    },
    [send],
  );

  return {
    connected,
    projects,
    servers,
    error,
    clearError: () => setError(null),
    detected,
    discovered,
    uiState,
    directoryListing,
    setUiState: (state: UiState) => send({ type: "setUiState", state }),
    addLogListener,
    pendingServerActions,
    start: (id: string) => withPendingAction(id, { type: "start", id }),
    stop: (id: string) => withPendingAction(id, { type: "stop", id }),
    restart: (id: string) => withPendingAction(id, { type: "restart", id }),
    startProject: (projectId: string) => send({ type: "startProject", projectId }),
    stopProject: (projectId: string) => send({ type: "stopProject", projectId }),
    createProject,
    updateProject: (id: string, name: string, roots: ProjectRoot[]) => send({ type: "updateProject", id, name, roots }),
    deleteProject: (id: string) => send({ type: "deleteProject", id }),
    createServer: (projectId: string, input: ServerInput) => {
      const id = resolveProjectId(projectId);
      send(
        input.kind === "docker"
          ? { type: "createServer", projectId: id, kind: "docker", name: input.name, container: input.container, port: input.port }
          : { type: "createServer", projectId: id, kind: "process", name: input.name, command: input.command, cwd: input.cwd, port: input.port },
      );
    },
    updateServer: (id: string, input: ServerInput) =>
      send(
        input.kind === "docker"
          ? { type: "updateServer", id, kind: "docker", name: input.name, container: input.container, port: input.port }
          : { type: "updateServer", id, kind: "process", name: input.name, command: input.command, cwd: input.cwd, port: input.port },
      ),
    deleteServer: (id: string) => send({ type: "deleteServer", id }),
    detectScripts: (cwd: string) => send({ type: "detectScripts", cwd }),
    track: (id: string) => send({ type: "track", id }),
    killChild: (pid: number, ownerServerId?: string) => withPendingAction(`child:${pid}`, { type: "killChild", pid, ownerServerId }),
    reorderProjects: (ids: string[]) => send({ type: "reorderProjects", ids }),
    listDirectory: (path?: string) => send({ type: "listDirectory", path }),
  };
}
