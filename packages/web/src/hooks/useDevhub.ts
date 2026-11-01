import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  DetectedScript,
  DirectoryEntry,
  Launcher,
  PortPolicy,
  Prefs,
  RepoInput,
  ServerMessage,
  Snapshot,
} from "@devhub/shared";

const RECONNECT_DELAY_MS = 1500;
// How long a start/stop/restart may sit unconfirmed before the spinner is
// rolled back — guards against a dropped frame leaving a button stuck.
const PENDING_TIMEOUT_MS = 15000;

const EMPTY_PREFS: Prefs = { renames: {}, roleOrder: {}, projectOrder: [], collapsed: [] };
const EMPTY: Snapshot = {
  projects: [],
  activity: [],
  agentRuns: [],
  portReservations: [],
  serviceAnnouncements: [],
  unowned: [],
  alerts: [],
  ports: [],
  prefs: EMPTY_PREFS,
  migration: [],
  probes: { lsof: true, docker: true },
  neverStarted: [],
};

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

export function useDevhub() {
  const [connected, setConnected] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [directoryListing, setDirectoryListing] = useState<DirectoryListing | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Log lines go straight to xterm via listeners rather than through React
  // state — they're append-only and high-volume.
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
        setReconnectAttempt(0);
        for (const id of subscribedRef.current) ws.send(JSON.stringify({ type: "subscribeLogs", id }));
      };

      ws.onmessage = (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "snapshot": {
            const { type, ...snap } = msg;
            // Tolerate a daemon older than this bundle. The daemon serves the
            // web build from disk, so a long-running daemon process can be
            // serving a newer UI than itself until it is restarted — and a
            // snapshot missing `probes`/`neverStarted` would otherwise blank
            // the page on the first message.
            setSnapshot({
              ...EMPTY,
              ...snap,
              probes: snap.probes ?? EMPTY.probes,
              neverStarted: snap.neverStarted ?? EMPTY.neverStarted,
              agentRuns: (snap.agentRuns ?? []).map((run) => ({ ...run, checks: run.checks ?? [] })),
              ports: (snap.ports ?? []).map((p) => ({ ...p, holders: p.holders ?? [] })),
            });
            // Deliberately does NOT clear pending. The daemon rebroadcasts on
            // its 5s tick whenever the observed port table changes, which on a
            // real machine is most ticks — so treating any snapshot as the
            // confirmation cleared the spinner on unrelated churn, seconds
            // before the row it belonged to actually changed. Spinners are
            // cleared by `actionDone`, which names the ids it resolved.
            break;
          }
          case "logBacklog":
            for (const l of logListenersRef.current.get(msg.id) ?? []) l(msg.lines, true);
            break;
          case "log":
            for (const l of logListenersRef.current.get(msg.id) ?? []) l(msg.lines, false);
            break;
          case "scriptsDetected":
            setDetected({ cwd: msg.cwd, scripts: msg.scripts, hasPackageJson: msg.hasPackageJson });
            break;
          case "directoryListing":
            setDirectoryListing(msg);
            break;
          case "actionDone":
            resolvePending(msg.ids);
            break;
          case "commandError":
            setError(msg.message);
            setPending(new Set());
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) {
          setReconnectAttempt((n) => n + 1);
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
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

  /** Returns false when the socket is not open, so callers can refuse rather
   *  than pretend. Previously this dropped the message silently while `act`
   *  still set a spinner, producing fifteen convincing seconds of nothing. */
  const send = useCallback((msg: ClientMessage): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  const addLogListener = useCallback(
    (id: string, listener: LogListener) => {
      if (!logListenersRef.current.has(id)) logListenersRef.current.set(id, new Set());
      logListenersRef.current.get(id)!.add(listener);
      if (!subscribedRef.current.has(id)) {
        subscribedRef.current.add(id);
        send({ type: "subscribeLogs", id });
      }
      return () => {
        logListenersRef.current.get(id)?.delete(listener);
      };
    },
    [send],
  );

  /** Clears the spinner for exactly the ids the daemon says it finished. */
  const resolvePending = useCallback((ids: string[]) => {
    for (const id of ids) {
      const t = pendingTimers.current.get(id);
      if (t) {
        clearTimeout(t);
        pendingTimers.current.delete(id);
      }
    }
    setPending((prev) => {
      if (!prev.size) return prev;
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) changed = next.delete(id) || changed;
      return changed ? next : prev;
    });
  }, []);

  /** Fires an action and shows a spinner on those rows immediately — docker
   *  in particular can take seconds to respond. Refuses outright when the
   *  socket is closed: a spinner for a message that was never sent is worse
   *  than a disabled button, because you believe the action happened.
   *  `ids` covers bulk actions, where every member row should spin, not just
   *  the synthetic `wt:` key nothing renders. */
  const act = useCallback(
    (ids: string | string[], msg: ClientMessage) => {
      const list = typeof ids === "string" ? [ids] : ids;
      if (!send(msg)) {
        setError("Not connected to the devhub daemon — nothing was sent.");
        return;
      }
      setPending((prev) => {
        const next = new Set(prev);
        for (const id of list) next.add(id);
        return next;
      });
      for (const id of list) {
        clearTimeout(pendingTimers.current.get(id));
        pendingTimers.current.set(
          id,
          setTimeout(() => {
            pendingTimers.current.delete(id);
            setPending((prev) => {
              if (!prev.has(id)) return prev;
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }, PENDING_TIMEOUT_MS),
        );
      }
    },
    [send],
  );

  const setPrefs = useCallback(
    (update: (prev: Prefs) => Prefs) => {
      setSnapshot((s) => {
        const prefs = update(s.prefs);
        send({ type: "setPrefs", prefs });
        return { ...s, prefs };
      });
    },
    [send],
  );

  return {
    connected,
    reconnectAttempt,
    ...snapshot,
    error,
    clearError: () => setError(null),
    detected,
    directoryListing,
    pending,
    addLogListener,

    start: (id: string) => act(id, { type: "start", id }),
    stop: (id: string) => act(id, { type: "stop", id }),
    restart: (id: string) => act(id, { type: "restart", id }),
    startWorktree: (worktreePath: string, memberIds: string[] = []) =>
      act([`wt:${worktreePath}`, ...memberIds], { type: "startWorktree", worktreePath }),
    stopWorktree: (worktreePath: string, memberIds: string[] = []) =>
      act([`wt:${worktreePath}`, ...memberIds], { type: "stopWorktree", worktreePath }),
    startProject: (projectId: string, memberIds: string[] = []) =>
      act([`project:${projectId}`, ...memberIds], { type: "startProject", projectId }),
    stopProject: (projectId: string, memberIds: string[] = []) =>
      act([`project:${projectId}`, ...memberIds], { type: "stopProject", projectId }),
    killOrphan: (id: string) => act(id, { type: "killOrphan", id }),
    removeContainer: (targetId: string, container: string) => act(targetId, { type: "removeContainer", container }),

    createProject: (name: string, repos: RepoInput[] = []) => send({ type: "createProject", name, repos }),
    updateProject: (id: string, name: string, repos: RepoInput[]) => send({ type: "updateProject", id, name, repos }),
    deleteProject: (id: string) => send({ type: "deleteProject", id }),

    saveLauncher: (projectId: string, repoPath: string, launcher: Launcher, replacingRole?: string) =>
      send({ type: "saveLauncher", projectId, repoPath, launcher, replacingRole }),
    deleteLauncher: (projectId: string, repoPath: string, role: string) => send({ type: "deleteLauncher", projectId, repoPath, role }),
    setComposePolicy: (projectId: string, repoPath: string, policy: PortPolicy | null) => send({ type: "setComposePolicy", projectId, repoPath, policy }),
    dismissMigration: () => send({ type: "dismissMigration" }),

    detectScripts: (cwd: string) => send({ type: "detectScripts", cwd }),
    setPrefs,
    reorderProjects: (ids: string[]) => send({ type: "reorderProjects", ids }),
    listDirectory: (path?: string) => send({ type: "listDirectory", path }),
    revealPath: (path: string) => send({ type: "revealPath", path }),
  };
}

export type Devhub = ReturnType<typeof useDevhub>;
