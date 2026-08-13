import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { ServerSnapshot, ServerState } from "@devhub/shared";
import { Button, EmptyState, Icon, IconButton } from "../ds";
import { dur, stamp } from "../lib/format";
import { tildify } from "../lib/paths";

const NO_WRAP_COLS = 500;
const MAX_BUFFERED_LINES = 2000;
const DIM = "\x1b[90m";
const RESET = "\x1b[0m";

function emptyStateProps(state: ServerState | undefined) {
  if (!state) return { title: "Output cleared", description: "Start the process to stream its output." };
  if (state.external) {
    return { title: "Running outside devhub", description: "No output captured yet — Restart to begin streaming its output." };
  }
  return {
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
  compact: boolean;
  medium: boolean;
}

/** Slide-over drawer showing one server's live output via xterm.js. */
export function LogDrawer({ server, addLogListener, onClose, onStop, onRestart, now, compact, medium }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wrapRef = useRef(true);
  const timestampsRef = useRef(true);
  const perServerRef = useRef<Map<string, ServerLogState>>(new Map());

  const [timestamps, setTimestamps] = useState(true);
  // Wrapping to the drawer's actual width is the default — the fixed-cols
  // unwrapped mode below reads as "clipped" at that width, since most lines
  // never reach the edge that would justify a scrollbar.
  const [wrap, setWrap] = useState(true);
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
    const el = containerRef.current;
    if (!term || !fit || !el) return;
    // The container can transiently report zero size mid-transition (the
    // drawer's own open/close slide animation) — fitting against that sends
    // xterm's renderer into a state where its next scroll sync throws. Skip
    // until real dimensions land, and don't let a stray resize (e.g. racing
    // a disposed terminal) throw past this component either way.
    if (el.clientWidth === 0 || el.clientHeight === 0) return;
    try {
      if (wrapRef.current) fit.fit();
      else term.resize(NO_WRAP_COLS, term.rows);
    } catch (err) {
      console.warn("[devhub] terminal resize skipped:", err);
    }
  }

  // Terminal instance lives for the component's lifetime; content is swapped
  // per-server (see the subscribe effect below).
  useEffect(() => {
    const term = new Terminal({
      convertEol: true,
      fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.5,
      // brightBlack backs the DIM-wrapped timestamp gutter (ANSI 90);
      // foreground is the mockup's exact log-message color.
      theme: { background: "#100f17", foreground: "#b5b0c8", brightBlack: "#565169" },
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
      // xterm sets up its own internal ResizeObserver on the container;
      // disconnecting it (inside dispose) doesn't cancel a callback that's
      // already queued for this frame, so disposing synchronously here can
      // have it fire against a half-torn-down terminal right after. Give
      // that one frame to run first, against a still-live terminal.
      requestAnimationFrame(() => term.dispose());
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
    <>
      <div
        data-dh-scrim="1"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--color-scrim)",
          opacity: "var(--scrim-alpha)",
          zIndex: 40,
          animation: "dh-scrim-in var(--duration-normal) var(--ease-out)",
        }}
      />
      <div
        data-dh-drawer="1"
        role="complementary"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          left: compact ? 0 : "auto",
          width: compact ? "100%" : medium ? 440 : 540,
          maxWidth: "100%",
          minHeight: 0,
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
          background: "var(--dh-bg-rail)",
          borderLeft: "1px solid var(--dh-border-control)",
          animation: "dh-drawer-in var(--duration-normal) var(--ease-out)",
        }}
      >
      <div
        style={{
          flex: "0 0 auto",
          padding: "20px 22px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderBottom: "1px solid var(--dh-border-hairline)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              font: "500 15px/1 var(--font-ui)",
              color: "var(--dh-text)",
            }}
          >
            {server.name}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", font: "400 11px/1 var(--font-mono)", color: "var(--dh-text-host)" }}>
            {state.port ? `localhost:${state.port}` : server.kind === "docker" ? server.container : tildify(server.cwd)}
          </span>
        </div>
        <button
          type="button"
          aria-label="Close log stream"
          title="Close log stream"
          onClick={onClose}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--dh-bg-hover)";
            e.currentTarget.style.color = "var(--dh-text-bright)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--dh-text-action)";
          }}
          style={{
            width: 28,
            height: 28,
            border: "1px solid var(--dh-border-control)",
            background: "transparent",
            borderRadius: 6,
            color: "var(--dh-text-action)",
            cursor: "pointer",
            font: "400 13px/1 var(--font-mono)",
            padding: 0,
            flex: "0 0 auto",
            transition: "var(--transition-state)",
          }}
        >
          ×
        </button>
      </div>

      <div
        style={{
          flex: "0 0 auto",
          height: 34,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px 0 12px",
          background: "var(--dh-bg-card)",
          borderBottom: "1px solid var(--dh-border-hairline)",
        }}
      >
        <Button variant="secondary" size="sm" icon="restart_alt" disabled={stopDisabled} onClick={() => onRestart(server.id)}>
          Restart
        </Button>
        <Button variant="secondary" size="sm" icon="stop" disabled={stopDisabled} onClick={() => onStop(server.id)}>
          Stop
        </Button>
        <span style={{ flex: 1 }} />
        <IconButton icon="schedule" label="Toggle timestamps" size="sm" selected={timestamps} onClick={() => setTimestamps((t) => !t)} />
        <IconButton icon="wrap_text" label="Toggle soft wrap" size="sm" selected={wrap} onClick={() => setWrap((w) => !w)} />
        <IconButton icon="pause" label="Pause stream" size="sm" selected={paused} onClick={togglePaused} />
        <IconButton icon="ink_eraser" label="Clear output" size="sm" onClick={clearLog} />
      </div>

      <div
        style={{
          flex: "0 0 auto",
          height: 26,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          background: "var(--dh-bg-card)",
          borderBottom: "1px solid var(--dh-border-hairline)",
          font: "400 11px/1 var(--font-mono)",
          color: "var(--dh-text-secondary)",
          fontVariantNumeric: "tabular-nums",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <Icon name={server.kind === "docker" ? "inventory_2" : "folder"} size={11} color="var(--dh-text-muted)" style={{ flex: "0 0 auto", marginRight: 6 }} />
        <span style={{ color: "var(--dh-text)", overflow: "hidden", textOverflow: "ellipsis" }}>
          {server.kind === "docker" ? server.container : server.command}
        </span>
        <span style={{ color: "var(--dh-text-muted)", padding: "0 8px" }}>·</span>
        <span>{state.pid ? `pid ${state.pid}` : "pid —"}</span>
        <span style={{ color: "var(--dh-text-muted)", padding: "0 8px" }}>·</span>
        <span>up {state.startedAt ? dur(now - state.startedAt) : "—"}</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--dh-bg-rail)" }}>
        <div style={{ position: "absolute", inset: 0, padding: "8px 0" }} ref={containerRef} />
        {lineCount === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <EmptyState {...emptyStateProps(state)} />
          </div>
        )}
      </div>

      <div style={{ flex: "0 0 auto", padding: "12px 22px", borderTop: "1px solid var(--dh-border-hairline)", font: "400 10px/1 var(--font-mono)", color: "var(--dh-text-faint)", letterSpacing: "0.04em" }}>
        tail -f · last {MAX_BUFFERED_LINES} lines
      </div>
      </div>
    </>
  );
}

