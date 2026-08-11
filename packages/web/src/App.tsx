import { useEffect, useState } from "react";
import { useDevhub } from "./hooks/useDevhub";
import { useNow } from "./hooks/useNow";
import { Sidebar } from "./components/Sidebar";
import { LogPanel } from "./components/LogPanel";
import { Button } from "./ds";
import { stamp } from "./lib/format";

export function App() {
  const { connected, projects, addLogListener, start, stop, restart, startGroup, stopGroup } =
    useDevhub();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const now = useNow();

  useEffect(() => {
    if (!selectedId && projects.length > 0) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const count = (status: string) => projects.filter((p) => p.state.status === status).length;
  const stopAll = () => projects.forEach((p) => stop(p.id));

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
      }}
    >
      {!connected && <div className="app__disconnected">Reconnecting to devhub daemon…</div>}

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
        <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--color-outline)" }}>console</span>
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
        <Sidebar
          projects={projects}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onStartGroup={startGroup}
          onStopGroup={stopGroup}
        />
        <LogPanel
          project={selected}
          addLogListener={addLogListener}
          onStart={start}
          onStop={stop}
          onRestart={restart}
          now={now}
        />
      </div>
    </div>
  );
}
