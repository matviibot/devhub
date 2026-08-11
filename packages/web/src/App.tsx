import { useEffect, useState } from "react";
import { useDevhub } from "./hooks/useDevhub";
import { useNow } from "./hooks/useNow";
import { Dashboard } from "./components/Dashboard";
import { LogDrawer } from "./components/LogDrawer";
import { Dialogs, type DialogState } from "./components/Dialogs";
import { Button } from "./ds";
import { stamp } from "./lib/format";

export function App() {
  const devhub = useDevhub();
  const { connected, projects, servers, discovered, uiState, setUiState, error, clearError, addLogListener, start, stop, restart, startProject, stopProject, track } =
    devhub;
  const [openServerId, setOpenServerId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingProjectForServer, setPendingProjectForServer] = useState<{ name: string; cwd?: string; port?: number } | null>(null);
  const now = useNow();

  useEffect(() => {
    if (openServerId && !servers.some((s) => s.id === openServerId)) setOpenServerId(null);
  }, [servers, openServerId]);

  // After creating a project, open Add Server for it as soon as it shows up
  // in the snapshot — saves a click and nudges toward "project needs a server".
  useEffect(() => {
    if (!pendingProjectForServer) return;
    const match = projects.find((p) => p.name === pendingProjectForServer.name);
    if (match) {
      setDialog({ kind: "server", mode: "add", projectId: match.id, prefillCwd: pendingProjectForServer.cwd, prefillPort: pendingProjectForServer.port });
      setPendingProjectForServer(null);
    }
  }, [projects, pendingProjectForServer]);

  const openServer = servers.find((s) => s.id === openServerId) ?? null;
  const count = (status: string) => servers.filter((s) => s.state.status === status).length;
  const stopAll = () => servers.forEach((s) => stop(s.id));

  return (
    <div
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
      {!connected && <div className="app__disconnected">Reconnecting to devhub daemon…</div>}
      {error && (
        <div className="app__error">
          {error}
          <button onClick={clearError} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div
        style={{
          flex: "0 0 auto",
          height: 38,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 10px 0 14px",
          background: "var(--material-thick)",
          backdropFilter: "saturate(180%) blur(var(--material-blur-thick))",
          boxShadow: "inset 0 -1px 0 var(--material-hairline)",
        }}
      >
        <span style={{ font: "600 13px/1 var(--font-ui)", letterSpacing: "-0.5px", color: "var(--color-on-surface)" }}>
          DevHub
        </span>
        <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--color-outline)" }}>dashboard</span>
        <span style={{ width: 1, height: 14, background: "var(--material-hairline)" }} />
        <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--color-on-surface-variant)", fontVariantNumeric: "tabular-nums" }}>
          {count("running")} running · {count("crashed")} crashed · {count("stopped")} stopped
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--color-outline)" }}>{stamp(new Date(now)).slice(0, 8)}</span>
        <Button variant="ghost" size="sm" icon="square" onClick={stopAll}>
          Stop all
        </Button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Dashboard
          projects={projects}
          servers={servers}
          discovered={discovered}
          openServerId={openServerId}
          now={now}
          uiState={uiState}
          onSetUiState={setUiState}
          onOpen={setOpenServerId}
          onStart={start}
          onStop={stop}
          onRestart={restart}
          onStartProject={startProject}
          onStopProject={stopProject}
          onAddProject={() => setDialog({ kind: "project", mode: "add" })}
          onEditProject={(projectId) => setDialog({ kind: "project", mode: "edit", projectId })}
          onDeleteProject={(id) => setDialog({ kind: "delete", target: "project", id })}
          onAddServer={(projectId) => setDialog({ kind: "server", mode: "add", projectId })}
          onEditServer={(serverId) => setDialog({ kind: "server", mode: "edit", serverId })}
          onDeleteServer={(id) => setDialog({ kind: "delete", target: "server", id })}
          onTrack={track}
          onQuickAdd={(item) => setDialog({ kind: "project", mode: "add", prefillName: item.suggestedName, prefillCwd: item.cwd, prefillPort: item.port })}
          onQuickAddToProject={(item, projectId) =>
            setDialog({ kind: "server", mode: "add", projectId, prefillName: item.suggestedName, prefillCwd: item.cwd, prefillPort: item.port })
          }
        />
        {openServer && (
          <LogDrawer server={openServer} addLogListener={addLogListener} onClose={() => setOpenServerId(null)} onStop={stop} onRestart={restart} now={now} />
        )}
      </div>

      <Dialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        devhub={devhub}
        onChainToAddServer={(name, prefill) => setPendingProjectForServer({ name, ...prefill })}
      />
    </div>
  );
}
