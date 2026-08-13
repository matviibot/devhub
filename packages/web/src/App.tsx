import { useEffect, useState } from "react";
import { useDevhub, type ServerInput } from "./hooks/useDevhub";
import { useNow } from "./hooks/useNow";
import { useBreakpoint } from "./hooks/useBreakpoint";
import { Dashboard } from "./components/Dashboard";
import { LogDrawer } from "./components/LogDrawer";
import { Dialogs, type DeletedServerSnapshot, type DeletedSnapshot, type DialogState } from "./components/Dialogs";
import type { ToastData } from "./ds";

function toServerInput(s: DeletedServerSnapshot): ServerInput {
  return s.kind === "docker"
    ? { kind: "docker", name: s.name, container: s.container, port: s.port }
    : { kind: "process", name: s.name, command: s.command, cwd: s.cwd, port: s.port };
}

export function App() {
  const devhub = useDevhub();
  const {
    connected,
    reconnectAttempt,
    projects,
    servers,
    discovered,
    uiState,
    setUiState,
    error,
    clearError,
    addLogListener,
    pendingServerActions,
    start,
    stop,
    restart,
    startProject,
    stopProject,
    track,
    killChild,
    reorderProjects,
    reorderServers,
    createProject,
    createServer,
  } = devhub;
  const [openServerId, setOpenServerId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingProjectForServer, setPendingProjectForServer] = useState<{
    name: string;
    kind?: "process" | "docker";
    cwd?: string;
    container?: string;
    port?: number;
  } | null>(null);
  const [pendingUndo, setPendingUndo] = useState<{ name: string; servers: DeletedServerSnapshot[] } | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const now = useNow();
  const { ref: rootRef, compact, medium } = useBreakpoint<HTMLDivElement>();

  useEffect(() => {
    if (openServerId && !servers.some((s) => s.id === openServerId)) setOpenServerId(null);
  }, [servers, openServerId]);

  // Clicking a server's already-open log stream closes it; clicking a
  // different one switches to it.
  const toggleOpen = (id: string) => setOpenServerId((cur) => (cur === id ? null : id));

  // After creating a project, open Add Server for it as soon as it shows up
  // in the snapshot — saves a click and nudges toward "project needs a server".
  useEffect(() => {
    if (!pendingProjectForServer) return;
    const match = projects.find((p) => p.name === pendingProjectForServer.name);
    if (match) {
      setDialog({
        kind: "server",
        mode: "add",
        projectId: match.id,
        prefillServerKind: pendingProjectForServer.kind,
        prefillCwd: pendingProjectForServer.cwd,
        prefillContainer: pendingProjectForServer.container,
        prefillPort: pendingProjectForServer.port,
      });
      setPendingProjectForServer(null);
    }
  }, [projects, pendingProjectForServer]);

  // Undo-recreate for a deleted project: once the recreated project shows up
  // in the snapshot (matched by name), recreate every server it had.
  useEffect(() => {
    if (!pendingUndo) return;
    const match = projects.find((p) => p.name === pendingUndo.name);
    if (match) {
      for (const s of pendingUndo.servers) createServer(match.id, toServerInput(s));
      setPendingUndo(null);
    }
  }, [projects, pendingUndo]);

  function pushToast(t: Omit<ToastData, "id">) {
    setToasts((ts) => [...ts, { ...t, id: crypto.randomUUID() }]);
  }
  function dismissToast(id: string) {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }
  function handleDeleted(snapshot: DeletedSnapshot) {
    if (snapshot.target === "project") {
      pushToast({
        message: `Deleted "${snapshot.name}"`,
        actionLabel: "Undo",
        onAction: () => {
          createProject(snapshot.name);
          setPendingUndo({ name: snapshot.name, servers: snapshot.servers });
        },
      });
    } else {
      pushToast({
        message: `Deleted "${snapshot.name}"`,
        actionLabel: "Undo",
        onAction: () => createServer(snapshot.projectId, toServerInput(snapshot)),
      });
    }
  }

  function handleMoveServer(id: string, toProjectId: string, fromProjectId: string) {
    if (toProjectId === fromProjectId) return;
    const server = servers.find((s) => s.id === id);
    const toName = projects.find((p) => p.id === toProjectId)?.name ?? "project";
    devhub.moveServer(id, toProjectId);
    pushToast({
      message: `Moved "${server?.name ?? "server"}" to "${toName}"`,
      actionLabel: "Undo",
      onAction: () => devhub.moveServer(id, fromProjectId),
    });
  }

  const openServer = servers.find((s) => s.id === openServerId) ?? null;

  return (
    <div
      ref={rootRef}
      data-theme="dark"
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-surface)",
        color: "var(--color-on-surface)",
        fontFamily: "var(--font-ui)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {!connected && (
        <div
          style={{
            flex: "0 0 auto",
            margin: "12px 12px 0",
            padding: "11px 18px",
            background: "rgba(223,179,92,0.08)",
            border: "1px solid rgba(223,179,92,0.22)",
            borderRadius: 9,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: "1.5px solid rgba(223,179,92,0.3)",
              borderTopColor: "var(--dh-status-starting)",
              animation: "ds-spin 700ms linear infinite",
              flex: "0 0 auto",
            }}
          />
          <span style={{ font: "400 11.5px/1 var(--font-mono)", color: "#e5cd9c" }}>
            reconnecting to devhub daemon…{reconnectAttempt > 0 && <span style={{ color: "rgba(229,205,156,0.6)" }}> attempt {reconnectAttempt}</span>}
          </span>
        </div>
      )}
      {error && (
        <div
          style={{
            flex: "0 0 auto",
            margin: "12px 12px 0",
            padding: "11px 18px",
            background: "rgba(238,139,120,0.08)",
            border: "1px solid rgba(238,139,120,0.22)",
            borderRadius: 9,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--dh-status-crashed)", flex: "0 0 auto", marginTop: 6 }} />
          <span style={{ flex: 1, minWidth: 0, font: "400 11.5px/1.4 var(--font-mono)", color: "var(--dh-alert-text)", wordBreak: "break-word" }}>{error}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={clearError}
            style={{
              width: 26,
              height: 26,
              border: "1px solid rgba(238,139,120,0.3)",
              background: "transparent",
              borderRadius: 6,
              color: "var(--dh-alert-text)",
              cursor: "pointer",
              font: "400 12px/1 var(--font-mono)",
              padding: 0,
              flex: "0 0 auto",
            }}
          >
            ×
          </button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Dashboard
          projects={projects}
          servers={servers}
          discovered={discovered}
          openServerId={openServerId}
          pendingServerActions={pendingServerActions}
          now={now}
          compact={compact}
          medium={medium}
          uiState={uiState}
          onSetUiState={setUiState}
          onOpen={toggleOpen}
          onStart={start}
          onStop={stop}
          onRestart={restart}
          onStartProject={startProject}
          onStopProject={stopProject}
          onAddProject={() => setDialog({ kind: "project", mode: "add" })}
          onEditProject={(projectId) => setDialog({ kind: "project", mode: "edit", projectId })}
          onAddServer={(projectId) => setDialog({ kind: "server", mode: "add", projectId })}
          onEditServer={(serverId) => setDialog({ kind: "server", mode: "edit", serverId })}
          onDeleteServer={(id) => setDialog({ kind: "delete", target: "server", id })}
          onDeleteProject={(id) => setDialog({ kind: "delete", target: "project", id })}
          onRevealInFinder={devhub.revealPath}
          onTrack={track}
          onKillChild={killChild}
          onQuickAdd={(item) =>
            setDialog(
              item.kind === "docker"
                ? { kind: "project", mode: "add", prefillName: item.suggestedName, prefillServerKind: "docker", prefillContainer: item.container }
                : { kind: "project", mode: "add", prefillName: item.suggestedName, prefillServerKind: "process", prefillCwd: item.cwd, prefillPort: item.port },
            )
          }
          onQuickAddToProject={(item, projectId) =>
            setDialog(
              item.kind === "docker"
                ? { kind: "server", mode: "add", projectId, prefillName: item.suggestedName, prefillServerKind: "docker", prefillContainer: item.container }
                : { kind: "server", mode: "add", projectId, prefillName: item.suggestedName, prefillServerKind: "process", prefillCwd: item.cwd, prefillPort: item.port },
            )
          }
          onReorderProjects={reorderProjects}
          onReorderServers={reorderServers}
          onMoveServer={handleMoveServer}
          toasts={toasts}
          onDismissToast={dismissToast}
        />
      </div>
      {openServer && (
        <LogDrawer
          server={openServer}
          addLogListener={addLogListener}
          onClose={() => setOpenServerId(null)}
          onStop={stop}
          onRestart={restart}
          now={now}
          compact={compact}
          medium={medium}
        />
      )}

      <Dialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        devhub={devhub}
        onChainToAddServer={(name, prefill) => setPendingProjectForServer({ name, ...prefill })}
        onDeleted={handleDeleted}
        onDeleteProject={(id) => setDialog({ kind: "delete", target: "project", id })}
        onDeleteServer={(id) => setDialog({ kind: "delete", target: "server", id })}
      />
    </div>
  );
}
