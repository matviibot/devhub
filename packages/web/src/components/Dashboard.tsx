import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Reorder, useDragControls, type DragControls } from "framer-motion";
import type { DiscoveredProject, ProjectMeta, ServerSnapshot, UiState } from "@devhub/shared";
import { Button, EmptyState, Icon, IconButton, MenuButton, StatusDot, ToastStack, type MenuButtonItem, type ToastData } from "../ds";
import { dur } from "../lib/format";
import { tildify } from "../lib/paths";

interface Props {
  projects: ProjectMeta[];
  servers: ServerSnapshot[];
  discovered: DiscoveredProject[];
  openServerId: string | null;
  pendingServerActions: Set<string>;
  now: number;
  compact: boolean;
  medium: boolean;
  uiState: UiState;
  onSetUiState: (state: UiState) => void;
  onOpen: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onStartProject: (projectId: string) => void;
  onStopProject: (projectId: string) => void;
  onAddProject: () => void;
  onEditProject: (projectId: string) => void;
  onAddServer: (projectId: string) => void;
  onEditServer: (serverId: string) => void;
  onDeleteServer: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onRevealInFinder: (path: string) => void;
  onTrack: (id: string) => void;
  onKillChild: (pid: number, ownerServerId?: string) => void;
  /** "New project" branch of the promote menu. */
  onQuickAdd: (item: DiscoveredProject) => void;
  /** "<existing project>" branch of the promote menu. */
  onQuickAddToProject: (item: DiscoveredProject, projectId: string) => void;
  onReorderProjects: (ids: string[]) => void;
  onReorderServers: (projectId: string, ids: string[]) => void;
  onMoveServer: (id: string, toProjectId: string, fromProjectId: string) => void;
  toasts: ToastData[];
  onDismissToast: (id: string) => void;
}

const UNASSIGNED_ID = "unassigned";

/** Material's "standard" easing/duration — used for every drag-reorder
 *  animation (both the layout shuffle via `transition` and the dragged
 *  item's snap back to its slot via `dragTransition`) instead of
 *  framer-motion's default reorder spring/inertia, which read as too
 *  loose/floaty against the rest of this UI's snappy, duration-based
 *  motion. `dragTransition` is typed as `InertiaOptions` only, even
 *  though the runtime happily takes a tween — the `as any` at its call
 *  sites is that type gap, not a real unknown. */
const REORDER_TRANSITION = { type: "tween" as const, duration: 0.2, ease: [0.4, 0, 0.2, 1] as const };

/** Discovery identity key — cwd for a host process, container ref for
 *  docker (discoveries have no cwd). Used as the React key and for the
 *  ignore set. */
function discoveryKey(d: DiscoveredProject): string {
  return d.kind === "docker" ? d.container : d.cwd;
}

/** Human meta line for a configured server: what's running it and for how
 *  long, or why it isn't. */
function metaLineFor(s: ServerSnapshot, now: number): string {
  const { state } = s;
  const plural = (n: number) => (n === 1 ? "restart" : "restarts");
  if (s.detected) return `running externally · pid ${s.detected.pid}`;
  if (state.status === "running" || state.status === "starting") return `up ${dur(now - (state.startedAt ?? now))}`;
  if (state.status === "crashed") return `exited ${state.exitCode ?? "—"} · ${state.restartCount} ${plural(state.restartCount)}`;
  return s.kind === "docker" ? s.container : s.command;
}

/** Mirrors the mockup's `metaOf`: running -> secondary grey, starting ->
 *  amber, crashed -> red, stopped -> muted grey. */
function metaColorFor(s: ServerSnapshot): string {
  if (s.state.status === "crashed") return "var(--dh-status-crashed)";
  if (s.state.status === "starting") return "var(--dh-status-starting)";
  if (s.state.status === "running") return "var(--dh-text-secondary)";
  return "var(--dh-text-muted)";
}

function discoveredMeta(d: DiscoveredProject): string {
  return d.kind === "docker" ? d.image : `${tildify(d.cwd)} · pid ${d.pid}`;
}

function discoveredStatus(d: DiscoveredProject): "running" | "stopped" {
  return d.kind === "docker" ? (d.running ? "running" : "stopped") : "running";
}

/** "New project" plus one row per existing project — used for a discovered
 *  item's promote menu. */
function addMenuItems(
  item: DiscoveredProject,
  projects: ProjectMeta[],
  onQuickAdd: (item: DiscoveredProject) => void,
  onQuickAddToProject: (item: DiscoveredProject, projectId: string) => void,
): MenuButtonItem[] {
  const items: MenuButtonItem[] = [{ key: "__new__", label: "new project…", icon: "create_new_folder", onSelect: () => onQuickAdd(item) }];
  for (const p of projects) items.push({ key: p.id, label: `promote to ${p.name}…`, icon: "arrow_outward", onSelect: () => onQuickAddToProject(item, p.id) });
  return items;
}

interface Aggregate {
  color: string;
  label: string;
  running: number;
  total: number;
}

/** Aggregate dot color + summary label for a project's rail row / header —
 *  mirrors the mockup's `projStats`/`dotOf` state machine. */
function projectAggregate(items: ServerSnapshot[]): Aggregate {
  const total = items.length;
  const running = items.filter((s) => s.state.status === "running" || s.state.status === "starting").length;
  const crashed = items.some((s) => s.state.status === "crashed");
  if (total === 0) return { color: "var(--dh-status-stopped)", label: "no servers tracked", running, total };
  if (running === total) return { color: "var(--dh-status-running)", label: "all running", running, total };
  if (running > 0) return { color: "var(--dh-status-starting)", label: `${running} of ${total} running`, running, total };
  if (crashed) return { color: "var(--dh-status-crashed)", label: "crashed", running, total };
  return { color: "var(--dh-status-stopped)", label: "all stopped", running, total };
}

interface ConflictEntry {
  projectId: string;
  label: string;
  serverId?: string;
}
interface ConflictInfo {
  kind: "collision" | "squatted";
  port: number;
  others: string[];
}
interface Alert {
  id: string;
  title: string;
  projectId: string;
}

/** Mirrors the mockup's `conflicts()`: two configured servers bound to the
 *  same port ("collision"), or a discovered stranger process sitting on a
 *  port a configured server also claims ("squatted"). Docker discoveries
 *  carry no port, so they can't be checked here. */
function computeConflicts(
  projects: ProjectMeta[],
  servers: ServerSnapshot[],
  discovered: DiscoveredProject[],
  ignored: Set<string>,
): { bySid: Map<string, ConflictInfo>; alerts: Alert[] } {
  const byPort = new Map<number, ConflictEntry[]>();
  const push = (port: number | null | undefined, entry: ConflictEntry) => {
    if (port == null) return;
    const list = byPort.get(port) ?? [];
    list.push(entry);
    byPort.set(port, list);
  };
  for (const s of servers) {
    if (s.state.status !== "running" && s.state.status !== "starting") continue;
    const proj = projects.find((p) => p.id === s.projectId);
    push(s.state.port, { projectId: s.projectId, label: `${proj?.name ?? "?"}/${s.name}`, serverId: s.id });
  }
  for (const d of discovered) {
    if (d.kind !== "process" || ignored.has(discoveryKey(d))) continue;
    push(d.port, { projectId: UNASSIGNED_ID, label: `unknown ${d.suggestedName}` });
  }

  const bySid = new Map<string, ConflictInfo>();
  const alerts: Alert[] = [];
  for (const [port, entries] of byPort) {
    if (entries.length < 2) continue;
    const kind: ConflictInfo["kind"] = entries.some((e) => e.projectId === UNASSIGNED_ID) ? "squatted" : "collision";
    for (const e of entries) {
      if (!e.serverId) continue;
      bySid.set(e.serverId, { kind, port, others: entries.filter((o) => o !== e).map((o) => o.label) });
    }
    const owner = entries.find((e) => e.projectId !== UNASSIGNED_ID);
    alerts.push({
      id: `port:${port}`,
      title: `:${port} ${kind === "collision" ? "claimed by" : "squatted —"} ${entries.map((e) => e.label).join(kind === "collision" ? " + " : " vs ")}`,
      projectId: owner ? owner.projectId : UNASSIGNED_ID,
    });
  }
  return { bySid, alerts };
}

/** Bordered ring spinner — the mockup's one loading indicator, in three
 *  sizes with a semantic head color: violet for neutral background work,
 *  amber for an in-flight start/stop, grey for an unconfirmed record. */
function RingSpinner({ size = 14, head = "var(--dh-accent)" }: { size?: 12 | 14 | 16; head?: string }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: `${size === 16 ? 2 : 1.5}px solid var(--dh-border-button)`,
        borderTopColor: head,
        animation: "ds-spin 700ms linear infinite",
        flex: "0 0 auto",
        display: "block",
      }}
    />
  );
}

/** Mono-text action pill with a leading icon — restart/stop/start/logs/track. */
function TextButton({
  label,
  icon,
  onClick,
  active,
  minWidth,
  tapH,
}: {
  label: string;
  icon?: string;
  onClick: () => void;
  active?: boolean;
  minWidth?: number;
  tapH?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const lit = hover || active;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        minWidth,
        minHeight: tapH ? 44 : undefined,
        padding: "5px 10px",
        borderRadius: 6,
        border: `1px solid ${active ? "var(--dh-text-secondary)" : "var(--dh-border-control)"}`,
        background: lit ? "var(--dh-bg-hover)" : "transparent",
        color: lit ? "var(--dh-text-bright)" : "var(--dh-text-action)",
        font: "400 11px/1 var(--font-mono)",
        cursor: "pointer",
        flex: "0 0 auto",
        transition: "var(--transition-state)",
      }}
    >
      {icon && <Icon name={icon} size={13} />}
      {label}
    </button>
  );
}

/** Small bordered chrome button — mono label with a leading icon, hover
 *  swaps to the bright text color. Used for the mobile "back" affordance. */
function ChromeButton({
  label,
  icon,
  title,
  onClick,
  tapH,
  style,
}: {
  label: string;
  icon?: string;
  title?: string;
  onClick: () => void;
  tapH?: boolean;
  style?: CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: tapH ? 44 : undefined,
        padding: "9px 13px",
        background: hover ? "var(--dh-bg-hover)" : "transparent",
        border: "1px solid var(--dh-border-button)",
        borderRadius: 8,
        color: hover ? "var(--dh-text-bright)" : "var(--dh-text-action)",
        font: "400 12px/1 var(--font-mono)",
        cursor: "pointer",
        flex: "0 0 auto",
        transition: "var(--transition-state)",
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={14} />}
      {label}
    </button>
  );
}

/** "start all"/"stop all" — the mockup's one filled-accent button, with its
 *  own literal hover swap rather than a generic Button tint. */
function AllToggleButton({ running, onClick, tapH }: { running: boolean; onClick: () => void; tapH: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        font: "500 11.5px/1 var(--font-mono)",
        color: "var(--dh-on-accent)",
        background: hover ? "var(--dh-accent-hover)" : "var(--dh-accent)",
        border: "none",
        borderRadius: 8,
        padding: "9px 15px",
        minHeight: tapH ? 44 : undefined,
        cursor: "pointer",
        flex: "0 0 auto",
        transition: "var(--transition-state)",
      }}
    >
      {running ? "stop all" : "start all"}
    </button>
  );
}

/** Filter text box in the rail header. */
function SearchInput({ value, onChange, compact }: { value: string; onChange: (v: string) => void; compact: boolean }) {
  const [focus, setFocus] = useState(false);
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="filter projects or :port"
      spellCheck={false}
      style={{
        minHeight: compact ? 44 : undefined,
        padding: "9px 11px",
        borderRadius: 8,
        border: `1px solid ${focus ? "var(--dh-accent-focus)" : "var(--dh-border-control)"}`,
        background: "var(--dh-bg-input)",
        color: "var(--dh-text)",
        font: `400 ${compact ? 13 : 11.5}px/1 var(--font-mono)`,
        outline: "none",
        width: "100%",
      }}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
    />
  );
}

interface RailRowProps {
  name: string;
  subtitle: string;
  dot: string;
  count: string;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
  /** Optimistic project row still awaiting the daemon's confirmation. */
  pending?: boolean;
}

/** One rail entry: status dot, name/subtitle, running/total count. */
function RailRow({ name, subtitle, dot, count, selected, compact, onSelect, pending }: RailRowProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "12px 12px",
        minHeight: compact ? 44 : undefined,
        borderRadius: 9,
        cursor: "pointer",
        background: selected ? "var(--dh-bg-row-selected)" : hover ? "var(--dh-bg-row-hover)" : "transparent",
        opacity: pending ? 0.55 : 1,
      }}
    >
      {pending ? <RingSpinner size={12} /> : <span style={{ width: 7, height: 7, borderRadius: "50%", flex: "0 0 auto", background: dot }} />}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span
          style={{
            font: "500 14px/1 var(--font-ui)",
            color: "var(--dh-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        <span
          style={{
            font: "400 10px/1 var(--font-mono)",
            color: "var(--dh-text-host)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {pending ? "creating…" : subtitle}
        </span>
      </div>
      <span style={{ font: "400 10.5px/1 var(--font-mono)", color: "var(--dh-text-secondary)", flex: "0 0 auto" }}>{count}</span>
    </div>
  );
}

/** Rail-footer alerts: collapsible port-conflict list. */
function AlertsSection({ alerts, collapsed, onToggle, onSelect }: { alerts: Alert[]; collapsed: boolean; onToggle: () => void; onSelect: (projectId: string) => void }) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--dh-border-hairline)",
        padding: "16px 16px 18px",
        flex: "0 0 auto",
        maxHeight: "42%",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "var(--dh-bg-rail-footer)",
      }}
    >
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", minHeight: 22 }}>
        <span style={{ font: "400 9.5px/1 var(--font-mono)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--dh-text-tertiary)" }}>
          alerts · {alerts.length}
        </span>
        {collapsed && alerts.length > 0 && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 17,
              height: 17,
              borderRadius: "50%",
              background: "var(--dh-alert-badge-bg)",
              border: "1px solid var(--dh-alert-badge-border)",
              color: "var(--dh-alert-badge-text)",
              font: "600 10.5px/1 var(--font-mono)",
              lineHeight: 1,
              flex: "0 0 auto",
            }}
          >
            !
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Icon
          name="chevron_right"
          size={14}
          color="var(--dh-text-secondary)"
          style={{ transform: collapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform var(--duration-fast) var(--ease-standard)" }}
        />
      </div>
      {!collapsed && alerts.map((a) => <AlertRow key={a.id} alert={a} onSelect={onSelect} />)}
    </div>
  );
}

function AlertRow({ alert, onSelect }: { alert: Alert; onSelect: (projectId: string) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={() => onSelect(alert.projectId)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "9px 11px",
        borderRadius: 8,
        background: hover ? "var(--dh-alert-bg-hover)" : "var(--dh-alert-bg)",
        border: "1px solid var(--dh-alert-border)",
        cursor: "pointer",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--dh-status-crashed)", marginTop: 5, flex: "0 0 auto" }} />
      <span style={{ font: "400 11px/1.45 var(--font-mono)", color: "var(--dh-alert-text)", minWidth: 0, wordBreak: "break-word" }}>{alert.title}</span>
    </div>
  );
}

interface ServiceCardProps {
  s: ServerSnapshot;
  now: number;
  pending: boolean;
  active: boolean;
  compact: boolean;
  conflict?: ConflictInfo;
  onOpen: () => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onTrack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveTo: () => void;
  onKillChild: (pid: number) => void;
  childPending: (pid: number) => boolean;
  /** Present when this card sits in a reorderable list — renders a grip
   *  handle that starts the drag, so grabbing the card body doesn't fight
   *  with its buttons/links. */
  dragControls?: DragControls;
}

/** One server as a bordered card: name/address/docker-badge up top, meta +
 *  controls below, a conflict banner when it's fighting over its port, and
 *  auto-detected child processes nested underneath (read-only) while up. */
function ServiceCard({ s, now, pending, active, compact, conflict, onOpen, onStart, onStop, onRestart, onTrack, onEdit, onDelete, onMoveTo, onKillChild, childPending, dragControls }: ServiceCardProps) {
  const [hover, setHover] = useState(false);
  const { state } = s;
  const port = state.port ?? s.detected?.port;
  const running = state.status === "running";
  const up = state.status === "running" || state.status === "starting";
  const busy = state.status === "starting";
  const children = s.kind === "process" ? state.children : [];

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "var(--dh-bg-card)",
        border: `1px solid ${hover ? "var(--dh-border-card-hover)" : "var(--dh-border-card)"}`,
        borderRadius: 10,
        padding: compact ? "14px 14px" : "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        transition: "border-color var(--duration-fast) var(--ease-standard)",
      }}
    >
      <div style={{ display: "flex", alignItems: compact ? "flex-start" : "center", gap: 14, flexWrap: compact ? "wrap" : "nowrap" }}>
        {dragControls && (
          <span
            onPointerDown={(e) => dragControls.start(e)}
            title="Drag to reorder"
            style={{ display: "flex", alignItems: "center", flex: "0 0 auto", cursor: "grab", touchAction: "none", color: "var(--dh-text-muted)" }}
          >
            <Icon name="drag_indicator" size={16} />
          </span>
        )}
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            flex: "0 0 auto",
            background: state.status === "crashed" ? "var(--dh-status-crashed)" : state.status === "starting" ? "var(--dh-status-starting)" : state.status === "running" ? "var(--dh-status-running)" : "var(--dh-status-stopped)",
            animation: busy ? "dhpulse 0.9s ease-in-out infinite" : undefined,
          }}
        />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span
              style={{
                font: "500 15px/1 var(--font-ui)",
                color: "var(--dh-text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {s.name}
            </span>
            <span style={{ font: "400 10px/1 var(--font-mono)", color: "var(--dh-text-muted)" }}>{s.kind === "docker" ? s.container : s.command}</span>
            {s.kind === "docker" && (
              <span
                style={{
                  font: "400 9px/1 var(--font-mono)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--dh-text-action)",
                  border: "1px solid var(--dh-docker-badge-border)",
                  borderRadius: 3,
                  padding: "1px 5px",
                }}
              >
                docker
              </span>
            )}
          </div>
          {port != null && (
            <a href={`http://localhost:${port}`} target="_blank" rel="noreferrer" style={{ font: "400 12px/1 var(--font-mono)" }}>
              localhost:{port}
            </a>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flex: compact ? "1 1 100%" : "0 0 auto", justifyContent: compact ? "space-between" : "flex-end", minWidth: 0 }}>
          <span style={{ font: "400 11.5px/1 var(--font-mono)", color: metaColorFor(s), flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {metaLineFor(s, now)}
          </span>
          <div style={{ display: "flex", gap: 7, flex: "0 0 auto" }}>
            {pending ? (
              <RingSpinner size={14} head="var(--dh-status-starting)" />
            ) : s.detected ? (
              <TextButton label="track" icon="radar" onClick={onTrack} tapH={compact} />
            ) : (
              <>
                {running && <TextButton label="restart" icon="restart_alt" onClick={onRestart} tapH={compact} />}
                <TextButton label={up ? "stop" : "start"} icon={up ? "stop" : "play_arrow"} onClick={up ? onStop : onStart} minWidth={52} tapH={compact} />
              </>
            )}
            <TextButton label="logs" icon="terminal" onClick={onOpen} active={active} tapH={compact} />
            <MenuButton
              label={`${s.name} actions`}
              compact={compact}
              items={[
                { key: "edit", label: "edit server…", icon: "edit", onSelect: onEdit },
                ...(port != null
                  ? [{ key: "copy", label: "copy address", icon: "content_copy", hint: "⌘C", onSelect: () => navigator.clipboard.writeText(`localhost:${port}`) }]
                  : []),
                { key: "move", label: "move to project…", icon: "drive_file_move", onSelect: onMoveTo },
                { key: "delete-div", divider: true },
                { key: "delete", label: "delete server…", icon: "delete", danger: true, onSelect: onDelete },
              ]}
            />
          </div>
        </div>
      </div>

      {conflict && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "8px 11px",
            borderRadius: 7,
            background: "var(--dh-flag-bg)",
            border: "1px solid var(--dh-flag-border)",
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--dh-status-crashed)", flex: "0 0 auto" }} />
          <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--dh-alert-text)" }}>
            :{conflict.port} {conflict.kind === "collision" ? "also bound by" : "held by"} {conflict.others.join(", ")}
          </span>
        </div>
      )}

      {children.length > 0 && up && (
        <div style={{ marginLeft: 22, paddingLeft: 16, borderLeft: "1px solid var(--dh-border-control)", display: "flex", flexDirection: "column", gap: 7 }}>
          {children.map((c) => (
            <div key={c.pid} style={{ display: "flex", alignItems: "center", gap: 10, font: "400 11px/1 var(--font-mono)", color: "var(--dh-text-host)" }}>
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--dh-accent)", flex: "0 0 auto" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "0 1 auto", minWidth: 0 }}>{c.name}</span>
              <span style={{ flex: 1, minWidth: 8 }} />
              <span style={{ flex: "0 0 auto" }}>:{c.port}</span>
              {childPending(c.pid) ? (
                <RingSpinner size={12} head="var(--dh-text-host)" />
              ) : (
                <IconButton icon="stop" label="Stop this process" size="sm" onClick={() => onKillChild(c.pid)} />
              )}
            </div>
          ))}
          <span style={{ font: "400 9.5px/1 var(--font-mono)", color: "var(--dh-text-muted)", letterSpacing: "0.04em" }}>child processes · read-only</span>
        </div>
      )}
    </div>
  );
}

/** Wraps a ServiceCard as a `Reorder.Item` — owns the drag controls so the
 *  card only starts dragging from its handle, not from anywhere in the
 *  body (buttons/links inside would otherwise fight the drag gesture). */
function SortableServiceCard({ layoutDependency, ...props }: ServiceCardProps & { layoutDependency: string }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={props.s.id}
      dragControls={controls}
      dragListener={false}
      as="div"
      layoutDependency={layoutDependency}
      transition={REORDER_TRANSITION}
      dragTransition={REORDER_TRANSITION as any}
      style={{ listStyle: "none" }}
      whileDrag={{ boxShadow: "0 10px 28px rgba(8,7,12,0.45)", zIndex: 1, position: "relative" }}
    >
      <ServiceCard {...props} dragControls={controls} />
    </Reorder.Item>
  );
}

interface DiscoveredCardProps {
  d: DiscoveredProject;
  compact: boolean;
  projects: ProjectMeta[];
  onIgnore: (key: string) => void;
  onQuickAdd: (item: DiscoveredProject) => void;
  onQuickAddToProject: (item: DiscoveredProject, projectId: string) => void;
}

/** A stranger process/container that matches no project's roots — same
 *  card shape as a real service, minus lifecycle controls, with a
 *  promote-to-project + ignore menu instead. */
function DiscoveredCard({ d, compact, projects, onIgnore, onQuickAdd, onQuickAddToProject }: DiscoveredCardProps) {
  const key = discoveryKey(d);
  return (
    <div style={{ background: "var(--dh-bg-card)", border: "1px solid var(--dh-border-card)", borderRadius: 10, padding: compact ? "14px 14px" : "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <StatusDot status={discoveredStatus(d)} size={8} />
        <span style={{ flex: 1, minWidth: 0, font: "500 15px/1 var(--font-ui)", color: "var(--dh-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {d.suggestedName}
        </span>
        {d.kind === "process" && <span style={{ font: "400 12px/1 var(--font-mono)", color: "var(--dh-text-secondary)" }}>:{d.port}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            font: "400 11.5px/1 var(--font-mono)",
            color: "var(--dh-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {discoveredMeta(d)}
        </span>
        <MenuButton
          label={`${d.suggestedName} actions`}
          compact={compact}
          items={[
            ...addMenuItems(d, projects, onQuickAdd, onQuickAddToProject),
            { key: "__div2__", divider: true },
            { key: "ignore", label: "ignore this port", icon: "visibility_off", danger: true, onSelect: () => onIgnore(key) },
          ]}
        />
      </div>
    </div>
  );
}

/** Menu fallback for drag-and-drop: a small filterable project list opened
 *  from a service card's "move to project…" action. */
function MoveProjectPicker({ server, projects, servers, onPick, onClose }: { server: ServerSnapshot; projects: ProjectMeta[]; servers: ServerSnapshot[]; onPick: (projectId: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const targets = projects
    .filter((p) => p.id !== server.projectId)
    .filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 45, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "var(--dh-scrim)", opacity: 0.58, animation: "dh-scrim-in var(--duration-normal) var(--ease-out)" }} />
      <div style={{ position: "relative", width: 300, background: "var(--dh-bg-card)", border: "1px solid var(--dh-border-button)", borderRadius: 10, padding: 6, boxShadow: "0 14px 34px rgba(8,7,12,0.6)", display: "flex", flexDirection: "column", gap: 2, animation: "dh-menu-in .16s ease-out both" }}>
        <span style={{ font: "400 9px/1 var(--font-mono)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--dh-text-faint)", padding: "9px 9px 6px" }}>move "{server.name}" to</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter projects"
          autoFocus
          spellCheck={false}
          style={{ background: "var(--dh-bg-input)", border: "1px solid var(--dh-border-control)", borderRadius: 8, padding: "8px 10px", margin: "0 4px 4px", color: "var(--dh-text)", font: "400 11.5px/1 var(--font-mono)", outline: "none" }}
        />
        {targets.map((p) => {
          const items = servers.filter((s) => s.projectId === p.id);
          const agg = projectAggregate(items);
          return <MoveTargetRow key={p.id} name={p.name} count={`${agg.running}/${agg.total}`} dot={agg.color} onClick={() => onPick(p.id)} />;
        })}
        {targets.length === 0 && <span style={{ padding: "9px 9px 11px", font: "400 11.5px/1 var(--font-mono)", color: "var(--dh-text-host)" }}>no other projects</span>}
      </div>
    </div>
  );
}

function MoveTargetRow({ name, count, dot, onClick }: { name: string; count: string; dot: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "center", gap: 9, padding: 9, borderRadius: 7, cursor: "pointer", background: hover ? "var(--dh-bg-hover)" : "transparent" }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, flex: "0 0 auto" }} />
      <span style={{ font: "400 12px/1 var(--font-mono)", color: "var(--dh-text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      <span style={{ font: "400 10px/1 var(--font-mono)", color: "var(--dh-text-faint)" }}>{count}</span>
    </div>
  );
}

/** devhub wordmark used at the top of the rail. */
function Wordmark() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", font: "700 18px/1 var(--font-ui)", letterSpacing: "-0.04em" }}>
      <span style={{ color: "var(--dh-text-bright)", paddingRight: 4 }}>dev</span>
      <span style={{ color: "var(--dh-on-accent)", background: "var(--dh-accent)", borderRadius: 7, padding: "1px 4px 2px" }}>hub</span>
    </span>
  );
}

export function Dashboard({
  projects,
  servers,
  discovered,
  openServerId,
  pendingServerActions,
  now,
  compact,
  medium,
  uiState,
  onSetUiState,
  onOpen,
  onStart,
  onStop,
  onRestart,
  onStartProject,
  onStopProject,
  onAddProject,
  onEditProject,
  onAddServer,
  onEditServer,
  onDeleteServer,
  onDeleteProject,
  onRevealInFinder,
  onTrack,
  onKillChild,
  onQuickAdd,
  onQuickAddToProject,
  onReorderProjects,
  onReorderServers,
  onMoveServer,
  toasts,
  onDismissToast,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pane, setPane] = useState<"list" | "detail">("list");
  const [query, setQuery] = useState("");
  const [alertsCollapsed, setAlertsCollapsed] = useState(false);
  const [moveServerFor, setMoveServerFor] = useState<ServerSnapshot | null>(null);
  // Local optimistic override for rail order while dragging — reindexed on
  // every drag-over crossing, reconciled against `projects` (the source of
  // truth) so ids added/removed elsewhere still show up. Order itself isn't
  // a persisted field (see reorderProjects) — it's implicit in `projects`'
  // array position, echoed back by the daemon.
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  // Same trick, scoped to whichever project is currently open — reset
  // whenever the selection changes so a stale override never leaks onto a
  // different project's server list.
  const [processOrderOverride, setProcessOrderOverride] = useState<string[] | null>(null);
  const [dockerOrderOverride, setDockerOrderOverride] = useState<string[] | null>(null);

  const liveIds = projects.map((p) => p.id);
  const order = orderOverride ? [...orderOverride.filter((id) => liveIds.includes(id)), ...liveIds.filter((id) => !orderOverride.includes(id))] : liveIds;
  const orderedProjects = order.map((id) => projects.find((p) => p.id === id)).filter((p): p is ProjectMeta => !!p);
  // `order` is a fresh array every render — Reorder.Item's `layoutDependency`
  // wants a value equal by `===` when nothing actually changed, so a joined
  // string stands in for it. Without this, an unrelated re-render (e.g. a
  // dialog opening) makes every reorderable item re-measure its layout and
  // visibly flash.
  const orderKey = order.join(",");

  function handleReorderProjects(nextOrder: string[]) {
    setOrderOverride(nextOrder);
    onReorderProjects(nextOrder);
  }

  const ignored = new Set(uiState.ignoredDiscovered);
  const ignore = (key: string) => onSetUiState({ ...uiState, ignoredDiscovered: [...new Set(uiState.ignoredDiscovered).add(key)] });
  const visibleDiscovered = discovered.filter((d) => !ignored.has(discoveryKey(d)));
  const hasUnassigned = visibleDiscovered.length > 0;

  const { bySid: conflictsBySid, alerts } = useMemo(
    () => computeConflicts(projects, servers, discovered, ignored),
    [projects, servers, discovered, uiState.ignoredDiscovered],
  );

  // Keep the selection pointed at something real: default to the first
  // project (or "unassigned" if that's all there is), and fall off a
  // project/discovery group that disappeared out from under it.
  useEffect(() => {
    const stillValid = selectedId != null && (liveIds.includes(selectedId) || (selectedId === UNASSIGNED_ID && hasUnassigned));
    if (stillValid) return;
    if (orderedProjects.length > 0) setSelectedId(orderedProjects[0].id);
    else if (hasUnassigned) setSelectedId(UNASSIGNED_ID);
    else setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveIds.join(","), hasUnassigned]);

  // A server-order override belongs to whichever project it was dragged in —
  // drop it the moment the selection moves elsewhere so it can't leak onto
  // a different project's list.
  useEffect(() => {
    setProcessOrderOverride(null);
    setDockerOrderOverride(null);
  }, [selectedId]);

  function select(id: string) {
    setSelectedId(id);
    setPane("detail");
  }

  const q = query.trim().toLowerCase();
  const railProjects = q
    ? orderedProjects.filter((p) => {
        if (p.name.toLowerCase().includes(q)) return true;
        if (p.roots.some((r) => (r.label || r.path).toLowerCase().includes(q))) return true;
        return servers.some((s) => s.projectId === p.id && (s.name.toLowerCase().includes(q) || String(s.state.port ?? "").includes(q.replace(":", ""))));
      })
    : orderedProjects;

  if (orderedProjects.length === 0 && !hasUnassigned) {
    return (
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <EmptyState
          title="No projects yet"
          description="Point devhub at a folder and it will watch every server underneath it."
          markColor="rgba(165,140,245,0.5)"
          action={
            <Button variant="primary" size="sm" onClick={onAddProject}>
              add your first project
            </Button>
          }
        />
      </div>
    );
  }

  const selectedProject = selectedId ? (orderedProjects.find((p) => p.id === selectedId) ?? null) : null;
  const selectedItems = selectedProject ? servers.filter((s) => s.projectId === selectedProject.id) : [];
  const agg = selectedProject ? projectAggregate(selectedItems) : null;
  const processItems = selectedItems.filter((s) => s.kind === "process");
  const dockerItems = selectedItems.filter((s) => s.kind === "docker");
  const primaryRoot = selectedProject?.roots[0];

  const liveProcessIds = processItems.map((s) => s.id);
  const processOrder = processOrderOverride
    ? [...processOrderOverride.filter((id) => liveProcessIds.includes(id)), ...liveProcessIds.filter((id) => !processOrderOverride.includes(id))]
    : liveProcessIds;
  // `processOrder` is always built from `liveProcessIds`, so every id here
  // resolves — non-null assertion instead of a discriminated-union-hostile
  // type predicate.
  const orderedProcessItems = processOrder.map((id) => processItems.find((s) => s.id === id)!);
  const processOrderKey = processOrder.join(",");

  const liveDockerIds = dockerItems.map((s) => s.id);
  const dockerOrder = dockerOrderOverride
    ? [...dockerOrderOverride.filter((id) => liveDockerIds.includes(id)), ...liveDockerIds.filter((id) => !dockerOrderOverride.includes(id))]
    : liveDockerIds;
  const orderedDockerItems = dockerOrder.map((id) => dockerItems.find((s) => s.id === id)!);
  const dockerOrderKey = dockerOrder.join(",");

  /** Reordering within one kind's section leaves the other kind's relative
   *  order untouched — the full ids array sent to the daemon is just the
   *  two sections concatenated in display order. */
  function handleReorderServers(kind: "process" | "docker", nextOrder: string[]) {
    if (!selectedProject) return;
    if (kind === "process") {
      setProcessOrderOverride(nextOrder);
      onReorderServers(selectedProject.id, [...nextOrder, ...dockerOrder]);
    } else {
      setDockerOrderOverride(nextOrder);
      onReorderServers(selectedProject.id, [...processOrder, ...nextOrder]);
    }
  }

  const showRail = !compact || pane === "list";
  const showDetail = !compact || pane === "detail";
  const railWidth = compact ? "100%" : medium ? 256 : 316;
  const bodyPad = compact ? "4px 16px 32px" : medium ? "6px 22px 36px" : "8px 30px 40px";
  const headPad = compact ? "16px 16px 14px" : medium ? "22px 22px 18px" : "26px 30px 22px";

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", position: "relative", overflow: "hidden" }}>
      {showRail && (
        <div
          style={{
            width: railWidth,
            flex: compact ? "1 1 auto" : "0 0 auto",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            borderRight: compact ? "none" : "1px solid var(--dh-border-hairline)",
            background: "var(--dh-bg-rail)",
          }}
        >
          <div style={{ padding: compact ? "18px 16px 14px" : "22px 20px 16px", flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 14, borderBottom: "1px solid var(--dh-border-hairline)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Wordmark />
              <span style={{ flex: 1 }} />
              <span style={{ font: "400 10.5px/1 var(--font-mono)", color: "var(--dh-text-tertiary)" }}>
                {orderedProjects.length} {orderedProjects.length === 1 ? "project" : "projects"}
              </span>
              <IconButton icon="add" label="Add project" size="sm" onClick={onAddProject} />
            </div>
            <SearchInput value={query} onChange={setQuery} compact={compact} />
          </div>

          <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "12px 12px 20px", display: "flex", flexDirection: "column", gap: 4 }}>
            {q ? (
              // Filtered view shows a subset in search-match order, not the
              // persisted order — dragging a partial list would scramble it,
              // so reordering is only live against the unfiltered list.
              railProjects.map((p) => {
                const items = servers.filter((s) => s.projectId === p.id);
                const a = projectAggregate(items);
                return (
                  <RailRow
                    key={p.id}
                    name={p.name}
                    subtitle={primaryRootLabel(p)}
                    dot={a.color}
                    count={`${a.running}/${a.total}`}
                    selected={p.id === selectedId}
                    compact={compact}
                    onSelect={() => select(p.id)}
                    pending={p.id.startsWith("temp-")}
                  />
                );
              })
            ) : (
              <Reorder.Group as="div" axis="y" values={order} onReorder={handleReorderProjects} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {railProjects.map((p) => {
                  const items = servers.filter((s) => s.projectId === p.id);
                  const a = projectAggregate(items);
                  const pending = p.id.startsWith("temp-");
                  return (
                    <Reorder.Item
                      key={p.id}
                      value={p.id}
                      as="div"
                      dragListener={!pending}
                      layoutDependency={orderKey}
                      transition={REORDER_TRANSITION}
                      dragTransition={REORDER_TRANSITION as any}
                      style={{ listStyle: "none" }}
                      whileDrag={{ boxShadow: "0 10px 28px rgba(8,7,12,0.45)", zIndex: 1, position: "relative" }}
                    >
                      <RailRow
                        name={p.name}
                        subtitle={primaryRootLabel(p)}
                        dot={a.color}
                        count={`${a.running}/${a.total}`}
                        selected={p.id === selectedId}
                        compact={compact}
                        onSelect={() => select(p.id)}
                        pending={pending}
                      />
                    </Reorder.Item>
                  );
                })}
              </Reorder.Group>
            )}
            {railProjects.length === 0 && (
              <div style={{ padding: "16px 8px", font: "400 12px/1.5 var(--font-ui)", color: "var(--dh-text-secondary)" }}>No projects match "{query}"</div>
            )}
            {hasUnassigned && (
              <RailRow
                name="unassigned"
                subtitle="no root match"
                dot="var(--dh-status-running)"
                count={String(visibleDiscovered.length)}
                selected={selectedId === UNASSIGNED_ID}
                compact={compact}
                onSelect={() => select(UNASSIGNED_ID)}
              />
            )}
          </div>

          <AlertsSection alerts={alerts} collapsed={alertsCollapsed} onToggle={() => setAlertsCollapsed((c) => !c)} onSelect={select} />
        </div>
      )}

      {showDetail && (
        <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
          {selectedProject && agg ? (
            <>
              <div style={{ padding: headPad, flex: "0 0 auto", borderBottom: "1px solid var(--dh-border-hairline)", display: "flex", alignItems: "flex-start", gap: compact ? 12 : 18, flexWrap: compact ? "wrap" : "nowrap" }}>
                {compact && <ChromeButton label="projects" icon="chevron_left" title="Back to projects" onClick={() => setPane("list")} tapH style={{ color: "var(--dh-text-back)", marginTop: 2 }} />}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ font: `600 ${compact ? 20 : medium ? 22 : 24}px/1.2 var(--font-ui)`, letterSpacing: "-0.015em", color: "var(--dh-text)" }}>{selectedProject.name}</span>
                    <span
                      style={{
                        font: "400 10px/1 var(--font-mono)",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--dh-text-secondary)",
                        border: "1px solid var(--dh-border-tag)",
                        borderRadius: 4,
                        padding: "2px 6px",
                      }}
                    >
                      {selectedProject.roots.length} {selectedProject.roots.length === 1 ? "root" : "roots"}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", font: "400 11.5px/1 var(--font-mono)", color: "var(--dh-text-host)" }}>
                    <span>{primaryRoot ? tildify(primaryRoot.label || primaryRoot.path) : "no root path"}</span>
                    {compact && (
                      <>
                        <span style={{ color: "var(--dh-text-dot)" }}>·</span>
                        <span>
                          {agg.running} of {agg.total} up
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
                  <AllToggleButton running={agg.running > 0} onClick={() => (agg.running > 0 ? onStopProject(selectedProject.id) : onStartProject(selectedProject.id))} tapH={compact} />
                  <MenuButton
                    label={`${selectedProject.name} settings`}
                    size="md"
                    compact={compact}
                    items={[
                      { key: "edit", label: "edit project…", icon: "edit", onSelect: () => onEditProject(selectedProject.id) },
                      { key: "add-server", label: "add server…", icon: "add", onSelect: () => onAddServer(selectedProject.id) },
                      ...(primaryRoot
                        ? ([
                            { key: "reveal", label: "reveal in finder", icon: "folder_open", onSelect: () => onRevealInFinder(primaryRoot.path) },
                            { key: "reveal-div", divider: true },
                          ] satisfies MenuButtonItem[])
                        : []),
                      { key: "delete", label: "delete project…", icon: "delete", danger: true, onSelect: () => onDeleteProject(selectedProject.id) },
                    ]}
                  />
                </div>
              </div>

              <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: bodyPad, display: "flex", flexDirection: "column", gap: 8 }}>
                <Reorder.Group
                  as="div"
                  axis="y"
                  values={processOrder}
                  onReorder={(next) => handleReorderServers("process", next)}
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {orderedProcessItems.map((s) => (
                    <SortableServiceCard
                      key={s.id}
                      layoutDependency={processOrderKey}
                      s={s}
                      now={now}
                      compact={compact}
                      pending={pendingServerActions.has(s.id)}
                      active={s.id === openServerId}
                      conflict={conflictsBySid.get(s.id)}
                      onOpen={() => onOpen(s.id)}
                      onStart={() => onStart(s.id)}
                      onStop={() => onStop(s.id)}
                      onRestart={() => onRestart(s.id)}
                      onTrack={() => onTrack(s.id)}
                      onEdit={() => onEditServer(s.id)}
                      onDelete={() => onDeleteServer(s.id)}
                      onMoveTo={() => setMoveServerFor(s)}
                      onKillChild={(pid) => onKillChild(pid, s.id)}
                      childPending={(pid) => pendingServerActions.has(`child:${pid}`)}
                    />
                  ))}
                </Reorder.Group>

                {orderedDockerItems.length > 0 && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                      <span style={{ font: "400 9.5px/1 var(--font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--dh-text-secondary)" }}>docker</span>
                      <span style={{ flex: 1, height: 1, background: "var(--dh-divider-line)" }} />
                    </div>
                    <Reorder.Group
                      as="div"
                      axis="y"
                      values={dockerOrder}
                      onReorder={(next) => handleReorderServers("docker", next)}
                      style={{ display: "flex", flexDirection: "column", gap: 8 }}
                    >
                      {orderedDockerItems.map((s) => (
                        <SortableServiceCard
                          key={s.id}
                          layoutDependency={dockerOrderKey}
                          s={s}
                          now={now}
                          compact={compact}
                          pending={pendingServerActions.has(s.id)}
                          active={s.id === openServerId}
                          conflict={conflictsBySid.get(s.id)}
                          onOpen={() => onOpen(s.id)}
                          onStart={() => onStart(s.id)}
                          onStop={() => onStop(s.id)}
                          onRestart={() => onRestart(s.id)}
                          onTrack={() => onTrack(s.id)}
                          onEdit={() => onEditServer(s.id)}
                          onDelete={() => onDeleteServer(s.id)}
                          onMoveTo={() => setMoveServerFor(s)}
                          onKillChild={(pid) => onKillChild(pid, s.id)}
                          childPending={(pid) => pendingServerActions.has(`child:${pid}`)}
                        />
                      ))}
                    </Reorder.Group>
                  </>
                )}
              </div>
            </>
          ) : selectedId === UNASSIGNED_ID ? (
            <>
              <div style={{ padding: headPad, flex: "0 0 auto", borderBottom: "1px solid var(--dh-border-hairline)", display: "flex", alignItems: "flex-start", gap: compact ? 12 : 18, flexWrap: compact ? "wrap" : "nowrap" }}>
                {compact && <ChromeButton label="projects" icon="chevron_left" title="Back to projects" onClick={() => setPane("list")} tapH style={{ color: "var(--dh-text-back)", marginTop: 2 }} />}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ font: `600 ${compact ? 20 : medium ? 22 : 24}px/1.2 var(--font-ui)`, letterSpacing: "-0.015em", color: "var(--dh-text)" }}>unassigned</span>
                    <span
                      style={{
                        font: "400 10px/1 var(--font-mono)",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--dh-text-secondary)",
                        border: "1px solid var(--dh-border-tag)",
                        borderRadius: 4,
                        padding: "2px 6px",
                      }}
                    >
                      discovered
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", font: "400 11.5px/1 var(--font-mono)", color: "var(--dh-text-host)" }}>
                    <span>outside every watched root</span>
                    <span style={{ color: "var(--dh-text-dot)" }}>·</span>
                    <span>
                      {visibleDiscovered.length} {visibleDiscovered.length === 1 ? "process" : "processes"}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: bodyPad, display: "flex", flexDirection: "column", gap: 8 }}>
                {visibleDiscovered.map((d) => (
                  <DiscoveredCard key={discoveryKey(d)} d={d} compact={compact} projects={orderedProjects} onIgnore={ignore} onQuickAdd={onQuickAdd} onQuickAddToProject={onQuickAddToProject} />
                ))}
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <EmptyState title="No project selected" description="Pick a project from the list to see its servers." />
            </div>
          )}
          <ToastStack toasts={toasts} onDismiss={onDismissToast} />
        </div>
      )}
      {moveServerFor && (
        <MoveProjectPicker
          server={moveServerFor}
          projects={orderedProjects}
          servers={servers}
          onPick={(pid) => {
            onMoveServer(moveServerFor.id, pid, moveServerFor.projectId);
            setMoveServerFor(null);
          }}
          onClose={() => setMoveServerFor(null)}
        />
      )}
    </div>
  );
}

function primaryRootLabel(p: ProjectMeta): string {
  const root = p.roots[0];
  if (!root) return "no root path";
  return tildify(root.label || root.path);
}
