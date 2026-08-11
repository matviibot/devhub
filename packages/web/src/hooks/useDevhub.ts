import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, DetectedScript, DiscoveredProject, ProjectMeta, ServerMessage, ServerSnapshot, UiState } from "@devhub/shared";

const RECONNECT_DELAY_MS = 1500;
const EMPTY_UI_STATE: UiState = { ignoredDiscovered: [], collapsedGroups: [] };

type LogListener = (lines: string[], isBacklog: boolean) => void;

interface Detected {
  cwd: string;
  scripts: DetectedScript[];
  hasPackageJson: boolean;
}

export function useDevhub() {
  const [connected, setConnected] = useState(false);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [servers, setServers] = useState<ServerSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredProject[]>([]);
  const [uiState, setUiStateLocal] = useState<UiState>(EMPTY_UI_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());
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
          case "snapshot":
            setProjects(msg.projects);
            setServers(msg.servers);
            setUiStateLocal(msg.uiState);
            break;
          case "serverUpdated":
            setServers((prev) => {
              const idx = prev.findIndex((s) => s.id === msg.server.id);
              if (idx === -1) return [...prev, msg.server];
              const next = [...prev];
              next[idx] = msg.server;
              return next;
            });
            break;
          case "serverRemoved":
            setServers((prev) => prev.filter((s) => s.id !== msg.id));
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
            break;
          case "discovered":
            setDiscovered(msg.items);
            break;
          case "uiState":
            setUiStateLocal(msg.state);
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

  return {
    connected,
    projects,
    servers,
    error,
    clearError: () => setError(null),
    detected,
    discovered,
    uiState,
    setUiState: (state: UiState) => send({ type: "setUiState", state }),
    addLogListener,
    start: (id: string) => send({ type: "start", id }),
    stop: (id: string) => send({ type: "stop", id }),
    restart: (id: string) => send({ type: "restart", id }),
    startProject: (projectId: string) => send({ type: "startProject", projectId }),
    stopProject: (projectId: string) => send({ type: "stopProject", projectId }),
    createProject: (name: string) => send({ type: "createProject", name }),
    updateProject: (id: string, name: string) => send({ type: "updateProject", id, name }),
    deleteProject: (id: string) => send({ type: "deleteProject", id }),
    createServer: (projectId: string, name: string, command: string, cwd: string, port?: number) =>
      send({ type: "createServer", projectId, name, command, cwd, port }),
    updateServer: (id: string, name: string, command: string, cwd: string, port?: number) =>
      send({ type: "updateServer", id, name, command, cwd, port }),
    deleteServer: (id: string) => send({ type: "deleteServer", id }),
    detectScripts: (cwd: string) => send({ type: "detectScripts", cwd }),
    track: (id: string) => send({ type: "track", id }),
    reorderProjects: (ids: string[]) => send({ type: "reorderProjects", ids }),
    reorderServers: (projectId: string, ids: string[]) => send({ type: "reorderServers", projectId, ids }),
  };
}
