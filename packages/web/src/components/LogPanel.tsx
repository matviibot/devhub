import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { ProjectSnapshot } from "@devhub/shared";
import { Button, EmptyState, IconButton, StatusDot } from "../ds";
import { dur, stamp } from "../lib/format";
import { tildify } from "../lib/paths";

const NO_WRAP_COLS = 500;
const MAX_BUFFERED_LINES = 2000;
const DIM = "\x1b[90m";
const RESET = "\x1b[0m";

interface LineEntry {
  text: string;
  ts: number | null; // null = arrived before we subscribed (backlog) — real time unknown
}
interface ProjectLogState {
  lines: LineEntry[];
  paused: boolean;
  queued: LineEntry[];
}

interface Props {
  project: ProjectSnapshot | null;
  addLogListener: (id: string, listener: (lines: string[], isBacklog: boolean) => void) => () => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  now: number;
}

export function LogPanel({ project, addLogListener, onStart, onStop, onRestart, now }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wrapRef = useRef(false);
  const timestampsRef = useRef(true);
  const perProjectRef = useRef<Map<string, ProjectLogState>>(new Map());

  const [timestamps, setTimestamps] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lineCount, setLineCount] = useState(0);

  function getState(id: string): ProjectLogState {
    let s = perProjectRef.current.get(id);
    if (!s) {
      s = { lines: [], paused: false, queued: [] };
      perProjectRef.current.set(id, s);
    }
    return s;
  }

  function formatLine(l: LineEntry, showTs: boolean): string {
    if (!showTs) return l.text;
    const gutter = l.ts != null ? stamp(new Date(l.ts)) : "--:--:--.---";
    return `${DIM}${gutter}${RESET}  ${l.text}`;
  }

  function renderState(state: ProjectLogState) {
    const term = termRef.current;
    if (!term) return;
    term.clear();
    for (const l of state.lines) term.writeln(formatLine(l, timestampsRef.current));
    setLineCount(state.lines.length);
  }

  function applyWrapMode() {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    if (wrapRef.current) fit.fit();
    else term.resize(NO_WRAP_COLS, term.rows);
  }

  // Terminal instance lives for the component's lifetime; content is swapped
  // per-project (see the subscribe effect below). Always mounted (even with
  // no project selected) so this effect has a real DOM node on first render.
  useEffect(() => {
    const term = new Terminal({
      convertEol: true,
      fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.5,
      theme: { background: "#0a0c0e" },
      disableStdin: true,
      scrollback: MAX_BUFFERED_LINES,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    if (containerRef.current) term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;
    applyWrapMode();

    const onResize = () => applyWrapMode();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      term.dispose();
    };
  }, []);

  useEffect(() => {
    wrapRef.current = wrap;
    applyWrapMode();
  }, [wrap]);

  useEffect(() => {
    timestampsRef.current = timestamps;
    if (project) renderState(getState(project.id));
  }, [timestamps]);

  // Subscribe to the selected project's log stream; each project keeps its
  // own buffer (capped) so switching back and forth doesn't lose scrollback.
  useEffect(() => {
    if (!project) return;
    const state = getState(project.id);
    setPaused(state.paused);
    renderState(state);

    return addLogListener(project.id, (rawLines, isBacklog) => {
      const entries: LineEntry[] = rawLines.map((text) => ({ text, ts: isBacklog ? null : Date.now() }));
      if (isBacklog) {
        state.lines = entries.slice(-MAX_BUFFERED_LINES);
        renderState(state);
        return;
      }
      if (state.paused) {
        state.queued.push(...entries);
        return;
      }
      state.lines.push(...entries);
      if (state.lines.length > MAX_BUFFERED_LINES) state.lines.splice(0, state.lines.length - MAX_BUFFERED_LINES);
      setLineCount(state.lines.length);
      const term = termRef.current;
      if (term) for (const e of entries) term.writeln(formatLine(e, timestampsRef.current));
    });
  }, [project?.id, addLogListener]);

  function togglePaused() {
    if (!project) return;
    const state = getState(project.id);
    state.paused = !state.paused;
    setPaused(state.paused);
    if (!state.paused && state.queued.length) {
      state.lines.push(...state.queued);
      if (state.lines.length > MAX_BUFFERED_LINES) state.lines.splice(0, state.lines.length - MAX_BUFFERED_LINES);
      state.queued = [];
      renderState(state);
    }
  }

  function clearLog() {
    if (!project) return;
    const state = getState(project.id);
    state.lines = [];
    state.queued = [];
    renderState(state);
  }

  const state = project?.state;
  const startDisabled = !state || state.status === "running" || state.status === "starting";
  const stopDisabled = !state || state.status === "stopped";

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0, background: "var(--color-surface)" }}>
      <div
        style={{
          flex: "0 0 auto",
          height: "var(--toolbar-height)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 10px 0 14px",
          background: "var(--material-regular)",
          backdropFilter: "saturate(180%) blur(var(--material-blur))",
          boxShadow: "inset 0 -1px 0 var(--material-hairline)",
        }}
      >
        {project && state ? (
          <>
            <StatusDot status={state.status} size={9} ring />
            <span style={{ font: "600 14px/1 var(--font-ui)", color: "var(--color-on-surface)", flex: "0 0 auto" }}>{project.name}</span>
            <span
              style={{
                font: "400 11px/1 var(--font-mono)",
                color: "var(--color-on-surface-variant)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
                flex: 1,
              }}
            >
              {tildify(project.cwd)}
            </span>
            {state.port && (
              <a
                href={`http://localhost:${state.port}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  height: 24,
                  padding: "0 8px",
                  borderRadius: "var(--radius-sm)",
                  font: "400 12px/1 var(--font-mono)",
                  boxShadow: "var(--inset-hairline)",
                  flex: "0 0 auto",
                  color: "var(--link-color)",
                  textDecoration: "none",
                }}
              >
                localhost:{state.port} ↗
              </a>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
              <Button variant="primary" size="sm" icon="play" disabled={startDisabled} onClick={() => onStart(project.id)}>
                Start
              </Button>
              <Button variant="secondary" size="sm" icon="rotate-cw" disabled={stopDisabled} onClick={() => onRestart(project.id)}>
                Restart
              </Button>
              <Button variant="secondary" size="sm" icon="square" disabled={stopDisabled} onClick={() => onStop(project.id)}>
                Stop
              </Button>
            </div>
          </>
        ) : (
          <span style={{ font: "400 12px/1 var(--font-ui)", color: "var(--color-on-surface-variant)" }}>Select a project to view its logs</span>
        )}
      </div>

      {project && state && (
        <div
          style={{
            flex: "0 0 auto",
            height: 28,
            display: "flex",
            alignItems: "center",
            gap: 0,
            padding: "0 8px 0 14px",
            background: "var(--color-surface-container-low)",
            boxShadow: "inset 0 -1px 0 var(--material-hairline)",
            font: "400 11px/1 var(--font-mono)",
            color: "var(--color-on-surface-variant)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span style={{ color: "var(--color-on-surface)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {project.command}
          </span>
          <span style={{ color: "var(--color-outline)", padding: "0 8px" }}>·</span>
          <span>{state.pid ? `pid ${state.pid}` : "pid —"}</span>
          <span style={{ color: "var(--color-outline)", padding: "0 8px" }}>·</span>
          <span>up {state.startedAt ? dur(now - state.startedAt) : "—"}</span>
          <span style={{ color: "var(--color-outline)", padding: "0 8px" }}>·</span>
          <span>{state.restartCount} {state.restartCount === 1 ? "restart" : "restarts"}</span>
          <span style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <IconButton icon="clock" label="Toggle timestamps" size="sm" selected={timestamps} onClick={() => setTimestamps((t) => !t)} />
            <IconButton icon="wrap-text" label="Toggle soft wrap" size="sm" selected={wrap} onClick={() => setWrap((w) => !w)} />
            <IconButton icon="pause" label="Pause stream" size="sm" selected={paused} onClick={togglePaused} />
            <IconButton icon="eraser" label="Clear output" size="sm" onClick={clearLog} />
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--color-surface-container-lowest)" }}>
        <div style={{ position: "absolute", inset: 0, padding: "8px 0" }} ref={containerRef} />
        {project && lineCount === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <EmptyState
              icon="terminal"
              title="Output cleared"
              description={state?.status === "running" ? "New lines appear as the process writes them." : "Start the process to stream its output."}
            />
          </div>
        )}
      </div>

      {project && (
        <div
          style={{
            flex: "0 0 auto",
            height: 26,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 12px",
            background: "var(--color-surface-container-low)",
            boxShadow: "inset 0 1px 0 var(--material-hairline)",
            font: "400 11px/1 var(--font-mono)",
            color: "var(--color-outline)",
          }}
        >
          <span>
            {lineCount} lines · {state?.pid ? `pid ${state.pid}` : "not running"}
            {paused ? " · stream paused" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
