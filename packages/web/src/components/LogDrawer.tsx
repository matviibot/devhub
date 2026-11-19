import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LogLine, ServiceView } from "@devhub/shared";
import { Button, EmptyState, Icon, IconButton, StatusDot, useOverlayEntry } from "../ds";
import { parseAnsi, stripAnsi } from "../lib/ansi";
import { dur, stamp } from "../lib/format";
import { tildify } from "../lib/paths";

const MAX_BUFFERED_LINES = 2000;
const ERROR_RE = /\b(error|fatal|panic|exception|uncaught|failed)\b|ERR!/i;
const WARN_RE = /\b(warn|warning|deprecated)\b/i;

interface Entry {
  key: number;
  t: number;
  text: string;
  plain: string;
  level: "error" | "warn" | "info";
}

function emptyStateProps(service: ServiceView) {
  if (service.external) {
    return {
      title: "running outside devhub",
      description: service.launchable
        ? "Devhub adopted this process rather than starting it, so there is no captured output. Restart it here to begin streaming."
        : "Devhub adopted this process and has no launcher for it, so it cannot be restarted to capture output. Save a launcher first.",
    };
  }
  if (service.status === "running") return { title: "no output yet", description: "New lines appear as the process writes them." };
  return { title: service.startedAt ? "output cleared" : "no output yet", description: "Start the process to stream its output." };
}

const LogRow = memo(function LogRow({ entry }: { entry: Entry }) {
  const spans = useMemo(() => parseAnsi(entry.text), [entry.text]);
  const at = new Date(entry.t);
  return (
    <div className={`log-line is-${entry.level}`}>
      <time dateTime={at.toISOString()} title={`${at.toLocaleDateString()} ${stamp(at)}`}>{stamp(at).slice(0, 8)}</time>
      <span>{spans.length ? spans.map((s, i) => <span key={i} style={s.style}>{s.text}</span>) : " "}</span>
    </div>
  );
});

interface Props {
  service: ServiceView;
  /** Every service of the same project, for the switcher. */
  services: ServiceView[];
  onSelect: (id: string) => void;
  addLogListener: (id: string, listener: (lines: LogLine[], isBacklog: boolean) => void) => () => void;
  onClose: () => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  now: number;
  compact: boolean;
  /** Ids with an action in flight. */
  pending: Set<string>;
}

/** Slide-over showing one service's live output, with a switcher across the
 *  project's services. Scrolling up stops following; new lines then count up
 *  on the "jump to latest" button instead of yanking the view. */
export function LogDrawer({ service, services, onSelect, addLogListener, onClose, onStop, onRestart, now, compact, pending }: Props) {
  useOverlayEntry(onClose);
  const busy = pending.has(service.id);
  const buffer = useRef<Entry[]>([]);
  const nextKey = useRef(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [, setVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [wrap, setWrap] = useState(true);
  const [showTime, setShowTime] = useState(true);
  const [follow, setFollow] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const followRef = useRef(true);

  const toEntry = (line: LogLine): Entry => {
    const plain = stripAnsi(line.text);
    return { key: nextKey.current++, t: line.t, text: line.text, plain, level: ERROR_RE.test(plain) ? "error" : WARN_RE.test(plain) ? "warn" : "info" };
  };

  useEffect(() => {
    buffer.current = [];
    followRef.current = true;
    setFollow(true);
    setUnseen(0);
    setVersion((v) => v + 1);
    return addLogListener(service.id, (lines, isBacklog) => {
      buffer.current = (isBacklog ? [] : buffer.current).concat(lines.map(toEntry)).slice(-MAX_BUFFERED_LINES);
      if (!isBacklog && !followRef.current) setUnseen((n) => n + lines.length);
      setVersion((v) => v + 1);
    });
  }, [service.id, addLogListener]);

  const all = buffer.current;
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((e) => e.plain.toLowerCase().includes(q)) : all;
  const last = shown[shown.length - 1]?.key;

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [last, service.id, wrap, showTime, q]);

  function onScroll() {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom === followRef.current) return;
    followRef.current = atBottom;
    setFollow(atBottom);
    if (atBottom) setUnseen(0);
  }

  function jumpToLatest() {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  function clear() {
    buffer.current = [];
    setVersion((v) => v + 1);
  }

  const live = service.status === "running" || service.status === "starting";
  const where = service.ports.length ? null : service.kind === "docker" ? service.container : (service.command ?? tildify(service.cwd));

  return (
    <div data-dh-drawer="1" className={`log-drawer${compact ? " is-compact" : ""}`} role="dialog" aria-modal="true" aria-label={`${service.displayName} output`}>
      <header className="log-head">
        <div className="log-title">
          <strong><StatusDot status={service.status} size={8} />{service.displayName}</strong>
          <span className="log-meta" data-tabular>
            {service.ports.map((port) => <a key={port} href={`http://localhost:${port}`} target="_blank" rel="noreferrer">localhost:{port}</a>)}
            {where && <code title={where}>{where}</code>}
            {service.pid && <span>pid {service.pid}</span>}
            <span>{live && service.startedAt ? `up ${dur(now - service.startedAt)}` : service.status === "crashed" ? `exited ${service.exitCode ?? "?"}` : service.status}</span>
          </span>
        </div>
        {live ? (
          <>
            {service.launchable && <Button variant="secondary" size="sm" icon="restart_alt" loading={busy} onClick={() => onRestart(service.id)}>Restart</Button>}
            <Button variant="secondary" size="sm" icon="stop" loading={busy} onClick={() => onStop(service.id)}>Stop</Button>
          </>
        ) : service.launchable ? (
          <Button variant="secondary" size="sm" icon="play_arrow" loading={busy} onClick={() => onRestart(service.id)}>Start</Button>
        ) : null}
        <IconButton icon="close" label="Close logs" size="md" onClick={onClose} />
      </header>

      {services.length > 1 && (
        <nav className="log-tabs" aria-label="Services">
          {services.map((s) => (
            <button key={s.id} type="button" aria-current={s.id === service.id ? "true" : undefined} onClick={() => onSelect(s.id)}>
              <StatusDot status={s.status} size={6} />
              {s.displayName}
            </button>
          ))}
        </nav>
      )}

      <div className="log-tools">
        <label className="log-filter">
          <Icon name="filter_list" size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter lines" aria-label="Filter lines" spellCheck={false} />
          {q && <span data-tabular>{shown.length} of {all.length}</span>}
        </label>
        <IconButton icon="schedule" label="Show timestamps" size="sm" selected={showTime} onClick={() => setShowTime((v) => !v)} />
        <IconButton icon="wrap_text" label="Wrap long lines" size="sm" selected={wrap} onClick={() => setWrap((v) => !v)} />
        <IconButton icon="ink_eraser" label="Clear output" size="sm" onClick={clear} />
      </div>

      {service.external && (
        <div className="log-notice">
          {service.launchable
            ? "DevHub adopted this process, so earlier output is unavailable. Restart it here to begin capturing logs."
            : "DevHub adopted this process and has no launcher, so it cannot restart it to capture logs. Save a launcher first."}
        </div>
      )}

      <div className="log-body-wrap">
        <div ref={bodyRef} className={`log-body${wrap ? " is-wrapped" : ""}${showTime ? "" : " no-time"}`} onScroll={onScroll}>
          {shown.map((entry) => <LogRow key={entry.key} entry={entry} />)}
        </div>
        {all.length === 0 && (
          <div className="log-empty"><EmptyState {...emptyStateProps(service)} /></div>
        )}
        {all.length > 0 && q && shown.length === 0 && <div className="log-empty"><EmptyState title="no matching lines" description={`Nothing in the last ${all.length} lines contains “${query.trim()}”.`} /></div>}
        {!follow && (
          <button type="button" className="log-jump" onClick={jumpToLatest}>
            <Icon name="arrow_downward" size={15} />
            {unseen > 0 ? `${unseen} new line${unseen === 1 ? "" : "s"}` : "Jump to latest"}
          </button>
        )}
      </div>
    </div>
  );
}
