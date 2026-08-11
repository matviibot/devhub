import { useEffect, useState } from "react";
import { useDevhub } from "./hooks/useDevhub";
import { Sidebar } from "./components/Sidebar";
import { LogPanel } from "./components/LogPanel";

export function App() {
  const { connected, projects, addLogListener, start, stop, restart, startGroup, stopGroup } =
    useDevhub();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && projects.length > 0) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="app">
      {!connected && <div className="app__disconnected">Reconnecting to devhub daemon…</div>}
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
      />
    </div>
  );
}
