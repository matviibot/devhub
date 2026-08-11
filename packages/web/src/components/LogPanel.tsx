import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { ProjectSnapshot } from "@devhub/shared";
import { StatusDot } from "./StatusDot";

interface Props {
  project: ProjectSnapshot | null;
  addLogListener: (id: string, listener: (lines: string[], isBacklog: boolean) => void) => () => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
}

export function LogPanel({ project, addLogListener, onStart, onStop, onRestart }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Terminal instance lives for the component's lifetime; content is reset
  // whenever the selected project changes (handled in the effect below).
  useEffect(() => {
    const term = new Terminal({
      convertEol: true,
      fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      fontSize: 13,
      theme: { background: "#0d0f12" },
      disableStdin: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    if (containerRef.current) term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      term.dispose();
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !project) return;
    term.clear();
    fitRef.current?.fit();

    return addLogListener(project.id, (lines, isBacklog) => {
      if (isBacklog) term.clear();
      for (const line of lines) term.writeln(line);
    });
  }, [project?.id, addLogListener]);

  const state = project?.state;
  const canStart = !state || state.status === "stopped" || state.status === "crashed";

  return (
    <div className="log-panel">
      <header className="log-panel__header">
        {project && state ? (
          <>
            <StatusDot status={state.status} />
            <h2>{project.name}</h2>
            <span className="log-panel__meta">{project.cwd}</span>
            <div className="log-panel__controls">
              {state.port && (
                <a href={`http://localhost:${state.port}`} target="_blank" rel="noreferrer">
                  :{state.port} ↗
                </a>
              )}
              <button disabled={!canStart} onClick={() => onStart(project.id)}>
                Start
              </button>
              <button disabled={canStart} onClick={() => onRestart(project.id)}>
                Restart
              </button>
              <button disabled={canStart} onClick={() => onStop(project.id)}>
                Stop
              </button>
            </div>
          </>
        ) : (
          <span className="log-panel__meta">Select a project to view its logs</span>
        )}
      </header>
      {/* Always mounted (even with no project selected) so the terminal-creation
          effect above has a real DOM node to attach to on first render. */}
      <div className="log-panel__terminal" ref={containerRef} />
    </div>
  );
}
