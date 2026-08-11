import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { ServerSnapshot, ServerState } from "@devhub/shared";
import { Button, EmptyState, Icon, IconButton, StatusDot } from "../ds";
import { dur, stamp } from "../lib/format";
import { tildify } from "../lib/paths";

const NO_WRAP_COLS = 500;
const MAX_BUFFERED_LINES = 2000;
const DIM = "\x1b[90m";
const RESET = "\x1b[0m";

function emptyStateProps(state: ServerState | undefined) {
  if (!state) return { icon: "terminal", title: "Output cleared", description: "Start the process to stream its output." };
  if (state.external) {
    return { icon: "plug", title: "Running outside devhub", description: "No output captured yet — Restart to begin streaming its output." };
  }
  return {
    icon: "terminal",
    title: "Output cleared",
    description: state.status === "running" ? "New lines appear as the process writes them." : "Start the process to stream its output.",
  };
}

interface LineEntry {
  text: string;
  ts: number | null; // null = arrived before we subscribed (backlog) — real time unknown
}
interface ServerLogState {
  lines: LineEntry[];
  paused: boolean;
  queued: LineEntry[];
}

interface Props {
  server: ServerSnapshot;
  addLogListener: (id: string, listener: (lines: string[], isBacklog: boolean) => void) => () => void;
  onClose: () => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  now: number;
}

/** Slide-over drawer showing one server's live output via xterm.js. */
export function LogDrawer({ server, addLogListener, onClose, onStop, onRestart, now }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wrapRef = useRef(false);
  const timestampsRef = useRef(true);
  const perServerRef = useRef<Map<string, ServerLogState>>(new Map());

  const [timestamps, setTimestamps] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lineCount, setLineCount] = useState(0);

  function getState(id: string): ServerLogState {
    let s = perServerRef.current.get(id);
    if (!s) {
      s = { lines: [], paused: false, queued: [] };
      perServerRef.current.set(id, s);
    }
    return s;
  }

  function formatLine(l: LineEntry, showTs: boolean): string {
    if (!showTs) return l.text;
    const gutter = l.ts != null ? stamp(new Date(l.ts)) : "--:--:--.---";
    return `${DIM}${gutter}${RESET}  ${l.text}`;
  }

  function renderState(state: ServerLogState) {
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
  // per-server (see the subscribe effect below).
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
    renderState(getState(server.id));
  }, [timestamps]);

  // Subscribe to the selected server's log stream; each server keeps its own
  // buffer (capped) so switching back and forth doesn't lose scrollback.
  useEffect(() => {
    const state = getState(server.id);
    setPaused(state.paused);
    renderState(state);

    return addLogListener(server.id, (rawLines, isBacklog) => {
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
  }, [server.id, addLogListener]);

  function togglePaused() {
    const state = getState(server.id);
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
    const state = getState(server.id);
    state.lines = [];
    state.queued = [];
    renderState(state);
  }

  const { state } = server;
  const stopDisabled = state.status === "stopped";

  return (
    <div
      data-dh-drawer="1"
      role="complementary"
      style={{
        flex: "0 0 480px",
        width: 480,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--color-surface-container-low)",
        boxShadow: "inset 1px 0 0 var(--material-hairline), var(--elevation-3)",
        animation: "dh-drawer-in var(--duration-normal) var(--ease-out)",
      }}
    >
      <div
        style={{
          flex: "0 0 auto",
          height: "var(--toolbar-height)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 8px 0 12px",
          background: "var(--material-regular)",
          backdropFilter: "saturate(180%) blur(var(--material-blur))",
          boxShadow: "inset 0 -1px 0 var(--material-hairline)",
        }}
      >
        <StatusDot status={state.status} size={9} ring />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            font: "600 14px/1 var(--font-ui)",
            letterSpacing: "-0.1px",
            color: "var(--color-on-surface)",
          }}
        >
          {server.name}
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
              flex: "0 0 auto",
              borderRadius: "var(--radius-sm)",
              font: "400 12px/1 var(--font-mono)",
              boxShadow: "var(--inset-hairline)",
              color: "var(--link-color)",
              textDecoration: "none",
            }}
          >
            <span>localhost:{state.port}</span>
            <Icon name="external-link" size={13} />
          </a>
        )}
        <IconButton icon="x" label="Close log stream" size="sm" onClick={onClose} />
      </div>

      <div
        style={{
          flex: "0 0 auto",
          height: 34,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px 0 12px",
          background: "var(--color-surface-container)",
          boxShadow: "inset 0 -1px 0 var(--material-hairline)",
        }}
      >
        <Button variant="secondary" size="sm" icon="rotate-cw" disabled={stopDisabled} onClick={() => onRestart(server.id)}>
          Restart
        </Button>
        <Button variant="secondary" size="sm" icon="square" disabled={stopDisabled} onClick={() => onStop(server.id)}>
          Stop
        </Button>
        <span style={{ flex: 1 }} />
        <IconButton icon="clock" label="Toggle timestamps" size="sm" selected={timestamps} onClick={() => setTimestamps((t) => !t)} />
        <IconButton icon="wrap-text" label="Toggle soft wrap" size="sm" selected={wrap} onClick={() => setWrap((w) => !w)} />
        <IconButton icon="pause" label="Pause stream" size="sm" selected={paused} onClick={togglePaused} />
        <IconButton icon="eraser" label="Clear output" size="sm" onClick={clearLog} />
      </div>

      <div
        style={{
          flex: "0 0 auto",
          height: 22,
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "0 12px",
          background: "var(--color-surface-container-low)",
          boxShadow: "inset 0 -1px 0 var(--material-hairline)",
          font: "400 11px/1 var(--font-mono)",
          color: "var(--color-outline)",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <Icon name="folder" size={11} color="var(--color-outline)" style={{ flex: "0 0 auto" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{tildify(server.cwd)}</span>
      </div>

      <div
        style={{
          flex: "0 0 auto",
          height: 26,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          background: "var(--color-surface-container-low)",
          boxShadow: "inset 0 -1px 0 var(--material-hairline)",
          font: "400 11px/1 var(--font-mono)",
          color: "var(--color-on-surface-variant)",
          fontVariantNumeric: "tabular-nums",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: "var(--color-on-surface)", overflow: "hidden", textOverflow: "ellipsis" }}>{server.command}</span>
        <span style={{ color: "var(--color-outline)", padding: "0 8px" }}>·</span>
        <span>{state.pid ? `pid ${state.pid}` : "pid —"}</span>
        <span style={{ color: "var(--color-outline)", padding: "0 8px" }}>·</span>
        <span>up {state.startedAt ? dur(now - state.startedAt) : "—"}</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--color-surface-container-lowest)" }}>
        <div style={{ position: "absolute", inset: 0, padding: "8px 0" }} ref={containerRef} />
        {lineCount === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <EmptyState {...emptyStateProps(state)} />
          </div>
        )}
      </div>
    </div>
  );
}

