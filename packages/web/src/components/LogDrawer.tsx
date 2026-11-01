import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { ServiceView } from "@devhub/shared";
import { Button, EmptyState, Icon, IconButton, useOverlayEntry } from "../ds";
import { dur, stamp } from "../lib/format";
import { tildify } from "../lib/paths";

const NO_WRAP_COLS = 500;
const MAX_BUFFERED_LINES = 2000;
const DIM = "\x1b[90m";
const RESET = "\x1b[0m";

function emptyStateProps(service: ServiceView) {
  if (service.external) {
    return {
      title: "running outside devhub",
      description: service.launchable
        ? "Devhub adopted this process rather than starting it, so there is no captured output. Restart it here to begin streaming."
        : "Devhub adopted this process and has no launcher for it, so it cannot be restarted to capture output. Save a launcher first.",
    };
  }
  if (service.status === "running") {
    return { title: "no output yet", description: "New lines appear as the process writes them." };
  }
  return {
    title: service.startedAt ? "output cleared" : "no output yet",
    description: "Start the process to stream its output.",
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
  service: ServiceView;
  addLogListener: (id: string, listener: (lines: string[], isBacklog: boolean) => void) => () => void;
  onClose: () => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  now: number;
  compact: boolean;
  medium: boolean;
  /** Ids with an action in flight. The row buttons already honoured this;
   *  the drawer's Stop/Restart did not, so they stayed live mid-action in the
   *  one place you go when something is already misbehaving. */
  pending: Set<string>;
}

/** Slide-over drawer showing one service's live output via xterm.js.
 *
 *  A service adopted rather than spawned by devhub has no captured output —
 *  the banner below says so instead of showing an empty terminal that looks
 *  broken. */
export function LogDrawer({ service: server, addLogListener, onClose, onStop, onRestart, now, compact, medium, pending }: Props) {
  const busy = pending.has(server.id);
  // Joins the shared overlay stack: one scrim, and Escape closes whichever
  // surface is on top.
  useOverlayEntry(onClose);
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
  // Surfaced so a paused stream is distinguishable from a hung process — the
  // backlog was tracked and never shown, so the terminal simply stopped.
  const [queuedCount, setQueuedCount] = useState(0);

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
    const tokens = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => tokens.getPropertyValue(name).trim() || fallback;
    const term = new Terminal({
      convertEol: true,
      fontFamily: token("--font-mono", '"IBM Plex Mono", "SFMono-Regular", "Cascadia Mono", Consolas, monospace'),
      fontSize: 13,
      lineHeight: 1.5,
      // xterm requires resolved color values, so bridge it to the shared CSS
      // tokens when the terminal is created.
      theme: {
        background: token("--dh-bg-rail-footer", "#0c0e12"),
        foreground: token("--dh-text-log-msg", "#b7bdc6"),
        brightBlack: token("--dh-text-faint", "#5d6570"),
      },
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
        setQueuedCount(state.queued.length);
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
    setQueuedCount(state.paused ? state.queued.length : 0);
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

  const stopDisabled = server.status === "stopped";

  return (
    <>
      <div
        data-dh-drawer="1"
        role="dialog"
        aria-modal="true"
        aria-label={`${server.displayName} output`}
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
          // Chrome floats above the page; only the terminal canvas remains at
          // the darkest surface level.
          background: "var(--dh-surface-overlay)",
          boxShadow: "var(--dh-shadow-dialog)",
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
              font: "var(--type-section-title)",
              color: "var(--dh-text)",
            }}
          >
            {server.displayName}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", font: "400 var(--type-meta)/1 var(--font-mono)", color: "var(--dh-text-host)" }}>
            {server.ports.length ? `localhost:${server.ports[0]}` : server.kind === "docker" ? server.container : tildify(server.cwd)}
          </span>
        </div>
        <IconButton icon="close" label="Close log stream" size="md" onClick={onClose} />
      </div>

      <div
        style={{
          flex: "0 0 auto",
          minHeight: 44,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px 0 12px",
          background: "var(--dh-surface-overlay)",
          borderBottom: "1px solid var(--dh-border-hairline)",
        }}
      >
        <Button
          variant="secondary"
          size="sm"
          icon="restart_alt"
          loading={busy}
          disabled={stopDisabled || !server.launchable}
          onClick={() => onRestart(server.id)}
        >
          Restart
        </Button>
        <Button variant="secondary" size="sm" icon="stop" loading={busy} disabled={stopDisabled} onClick={() => onStop(server.id)}>
          Stop
        </Button>
        <span style={{ flex: 1 }} />
        <IconButton icon="schedule" label="Toggle timestamps" size="sm" selected={timestamps} onClick={() => setTimestamps((t) => !t)} />
        <IconButton icon="wrap_text" label="Toggle soft wrap" size="sm" selected={wrap} onClick={() => setWrap((w) => !w)} />
        <IconButton
          icon={paused ? "play_arrow" : "pause"}
          label={paused ? "Resume stream" : "Pause stream"}
          size="sm"
          selected={paused}
          onClick={togglePaused}
        />
        <IconButton icon="ink_eraser" label="Clear output" size="sm" onClick={clearLog} />
      </div>

      <div
        style={{
          flex: "0 0 auto",
          height: 26,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          background: "var(--dh-surface-overlay)",
          borderBottom: "1px solid var(--dh-border-hairline)",
          font: "400 var(--type-meta)/1 var(--font-mono)",
          color: "var(--dh-text-secondary)",
          fontVariantNumeric: "tabular-nums",
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <Icon name={server.kind === "docker" ? "inventory_2" : "folder"} size={11} color="var(--dh-text-muted)" style={{ flex: "0 0 auto", marginRight: 6 }} />
        <span style={{ color: "var(--dh-text)", overflow: "hidden", textOverflow: "ellipsis" }}>
          {server.kind === "docker" ? server.container : (server.command ?? tildify(server.cwd))}
        </span>
        <span style={{ color: "var(--dh-text-muted)", padding: "0 8px" }}>·</span>
        <span>{server.pid ? `pid ${server.pid}` : "pid —"}</span>
        <span style={{ color: "var(--dh-text-muted)", padding: "0 8px" }}>·</span>
        <span>{server.status === "running" && server.startedAt ? `up ${dur(now - server.startedAt)}` : "not running"}</span>
      </div>

      {/* Its own wrapped line, not a fifth segment in a 26px nowrap strip that
          hard-cut it mid-word with no ellipsis — this is the sentence that
          explains why the terminal below is empty, so it has to survive. */}
      {server.external && (
        <div
          style={{
            flex: "0 0 auto",
            padding: "7px 12px",
            background: "var(--dh-surface-overlay)",
            borderBottom: "1px solid var(--dh-border-hairline)",
            font: "var(--type-meta-text)",
            color: "var(--dh-status-starting)",
          }}
        >
          {server.launchable
            ? "DevHub adopted this process, so earlier output is unavailable. Restart it here to begin capturing logs."
            : "DevHub adopted this process and has no launcher, so it cannot restart it to capture logs. Save a launcher first."}
        </div>
      )}

      {paused && (
        <button
          type="button"
          onClick={togglePaused}
          style={{
            flex: "0 0 auto",
            textAlign: "left",
            padding: "7px 12px",
            border: "none",
            borderBottom: "1px solid var(--dh-border-hairline)",
            background: "var(--dh-flag-bg)",
            color: "var(--dh-status-starting)",
            font: "var(--type-meta-text)",
            cursor: "pointer",
          }}
        >
          Paused{queuedCount > 0 ? ` · ${queuedCount} line${queuedCount === 1 ? "" : "s"} waiting` : ""}. Click to resume.
        </button>
      )}

      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--dh-bg-rail)" }}>
        <div style={{ position: "absolute", inset: 0, padding: "8px 0" }} ref={containerRef} />
        {lineCount === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <EmptyState {...emptyStateProps(server)} />
          </div>
        )}
      </div>

      <div style={{ flex: "0 0 auto", padding: "12px 22px", borderTop: "1px solid var(--dh-border-hairline)", font: "400 var(--type-micro)/1 var(--font-mono)", color: "var(--dh-text-secondary)", letterSpacing: "0.04em" }}>
        tail -f · last {MAX_BUFFERED_LINES} lines
      </div>
      </div>
    </>
  );
}
