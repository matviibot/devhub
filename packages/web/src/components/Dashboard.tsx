import { useState } from "react";
import type { DiscoveredProject, ProjectMeta, ServerSnapshot, UiState } from "@devhub/shared";
import { Button, EmptyState, Icon, IconButton, MenuButton, StatusDot, type MenuButtonItem } from "../ds";
import { dur, stamp } from "../lib/format";
import { tildify } from "../lib/paths";

interface Props {
  projects: ProjectMeta[];
  servers: ServerSnapshot[];
  discovered: DiscoveredProject[];
  openServerId: string | null;
  pendingServerActions: Set<string>;
  now: number;
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
  onTrack: (id: string) => void;
  onKillChild: (pid: number, ownerServerId?: string) => void;
  /** "New project" branch of the promote menu. */
  onQuickAdd: (item: DiscoveredProject) => void;
  /** "<existing project>" branch of the promote menu. */
  onQuickAddToProject: (item: DiscoveredProject, projectId: string) => void;
  onReorderProjects: (ids: string[]) => void;
}

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
  const items: MenuButtonItem[] = [{ key: "__new__", label: "New project", icon: "folder-plus", onSelect: () => onQuickAdd(item) }];
  if (projects.length) {
    items.push({ key: "__div__", divider: true });
    for (const p of projects) items.push({ key: p.id, label: p.name, icon: "folder", onSelect: () => onQuickAddToProject(item, p.id) });
  }
  return items;
}

interface Aggregate {
  color: string;
  label: string;
  running: number;
  total: number;
}

/** Aggregate dot color + summary label for a project's card header — mirrors
 *  the state machine of the individual server dots one level up. */
function projectAggregate(items: ServerSnapshot[]): Aggregate {
  const total = items.length;
  const running = items.filter((s) => s.state.status === "running" || s.state.status === "starting").length;
  const crashed = items.some((s) => s.state.status === "crashed");
  if (total === 0) return { color: "var(--status-stopped)", label: "no servers tracked", running, total };
  if (running === total) return { color: "var(--status-running)", label: "all running", running, total };
  if (running > 0) return { color: "var(--status-starting)", label: `${running} of ${total} running`, running, total };
  if (crashed) return { color: "var(--status-crashed)", label: "crashed", running, total };
  return { color: "var(--status-stopped)", label: "all stopped", running, total };
}

/** Small bordered mono-text action button — restart/stop/start/logs. */
function TextButton({
  icon,
  label,
  onClick,
  danger,
  active,
}: {
  icon?: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
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
        gap: 4,
        height: 22,
        padding: "0 8px",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${active ? "var(--color-on-surface-variant)" : "var(--color-outline)"}`,
        background: lit ? "var(--color-surface-container-high)" : "transparent",
        color: lit ? "var(--color-on-surface)" : danger ? "var(--color-error)" : "var(--color-on-surface-variant)",
        font: "400 10.5px/1 var(--font-mono)",
        cursor: "default",
        flex: "0 0 auto",
        transition: "var(--transition-state)",
      }}
    >
      {icon && <Icon name={icon} size={11} />}
      {label}
    </button>
  );
}

/** 30px bordered square icon button — project-card play/pause + settings. */
function SquareIconButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 30,
        height: 30,
        display: "grid",
        placeItems: "center",
        border: "1px solid var(--color-outline)",
        background: hover ? "var(--color-surface-container-high)" : "transparent",
        borderRadius: "var(--radius-md)",
        color: hover ? "var(--color-on-surface)" : "var(--color-on-surface-variant)",
        cursor: "default",
        padding: 0,
        flex: "0 0 auto",
      }}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

/** Dashed affordance tile — "Add server" (compact) / "Add project" (fills
 *  its grid cell). */
function DashedTile({ icon, label, compact = false, onClick }: { icon: string; label: string; compact?: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        minHeight: compact ? undefined : 60,
        height: compact ? 30 : undefined,
        padding: compact ? "0 14px" : undefined,
        borderRadius: "var(--radius-lg)",
        border: "1px dashed var(--color-outline-variant)",
        background: hover ? "var(--state-hover)" : "transparent",
        color: hover ? "var(--color-on-surface)" : "var(--color-on-surface-variant)",
        cursor: "default",
        font: "500 12px/1 var(--font-ui)",
        transition: "var(--transition-state)",
      }}
    >
      <Icon name={icon} size={compact ? 13 : 15} />
      <span>{label}</span>
    </div>
  );
}

interface ServerRowProps {
  s: ServerSnapshot;
  now: number;
  pending: boolean;
  active: boolean;
  onOpen: () => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onTrack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onKillChild: (pid: number) => void;
  childPending: (pid: number) => boolean;
}

/** One server's two-line block: name/port up top, meta + controls below,
 *  auto-detected child processes nested underneath (read-only) while up. */
function ServerRow({ s, now, pending, active, onOpen, onStart, onStop, onRestart, onTrack, onEdit, onDelete, onKillChild, childPending }: ServerRowProps) {
  const { state } = s;
  const port = state.port ?? s.detected?.port;
  const crashed = state.status === "crashed";
  const running = state.status === "running";
  const up = state.status === "running" || state.status === "starting";
  const children = s.kind === "process" ? state.children : [];

  return (
    <div style={{ padding: "10px 4px", display: "flex", flexDirection: "column", gap: 8, borderBottom: "1px solid var(--color-outline-variant)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <StatusDot status={state.status} size={7} />
        <span
          style={{
            font: "500 13.5px/1 var(--font-ui)",
            color: "var(--color-on-surface)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: "0 1 auto",
            minWidth: 0,
          }}
        >
          {s.name}
        </span>
        <span style={{ flex: 1, minWidth: 8 }} />
        {port != null && (
          <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--color-on-surface-variant)", flex: "0 0 auto" }}>:{port}</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 17 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            font: "400 10.5px/1 var(--font-mono)",
            color: crashed ? "var(--color-error)" : "var(--color-on-surface-variant)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {metaLineFor(s, now)}
        </span>
        {pending ? (
          <Icon name="loader-circle" size={13} color="var(--color-on-surface-variant)" style={{ animation: "ds-spin 900ms linear infinite" }} />
        ) : s.detected ? (
          <TextButton icon="link" label="track" onClick={onTrack} />
        ) : (
          <>
            {running && <TextButton icon="rotate-cw" label="restart" onClick={onRestart} />}
            <TextButton icon={up ? "square" : "play"} label={up ? "stop" : "start"} onClick={up ? onStop : onStart} />
          </>
        )}
        <TextButton icon="scroll-text" label="logs" onClick={onOpen} active={active} />
        <MenuButton
          label={`${s.name} actions`}
          variant="icon"
          items={[
            { key: "edit", label: "Edit server", icon: "pencil", onSelect: onEdit },
            { key: "delete", label: "Delete server", icon: "trash-2", onSelect: onDelete },
          ]}
        />
      </div>
      {children.length > 0 && up && (
        <div
          style={{
            marginLeft: 17,
            paddingLeft: 12,
            borderLeft: "1px solid var(--color-outline-variant)",
            display: "flex",
            flexDirection: "column",
            gap: 5,
          }}
        >
          {children.map((c) => (
            <div key={c.pid} style={{ display: "flex", alignItems: "center", gap: 8, font: "400 10.5px/1 var(--font-mono)", color: "var(--color-outline)" }}>
              <StatusDot status="running" size={4} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "0 1 auto", minWidth: 0 }}>{c.name}</span>
              <span style={{ flex: 1, minWidth: 8 }} />
              <span style={{ flex: "0 0 auto" }}>:{c.port}</span>
              {childPending(c.pid) ? (
                <Icon name="loader-circle" size={11} color="var(--color-outline)" style={{ animation: "ds-spin 900ms linear infinite" }} />
              ) : (
                <IconButton icon="square" label="Stop this process" size="sm" onClick={() => onKillChild(c.pid)} />
              )}
            </div>
          ))}
          <span style={{ font: "400 9.5px/1 var(--font-mono)", color: "var(--color-outline)", letterSpacing: "0.04em" }}>child processes · read-only</span>
        </div>
      )}
    </div>
  );
}

interface ProjectCardProps {
  p: ProjectMeta;
  items: ServerSnapshot[];
  now: number;
  expanded: boolean;
  onToggleExpand: () => void;
  pendingServerActions: Set<string>;
  dragging: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  openServerId: string | null;
  onOpen: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onTrack: (id: string) => void;
  onEditServer: (id: string) => void;
  onDeleteServer: (id: string) => void;
  onKillChild: (pid: number, ownerServerId?: string) => void;
  onStartProject: (id: string) => void;
  onStopProject: (id: string) => void;
  onAddServer: (id: string) => void;
  onEditProject: (id: string) => void;
}

/** One project's card: collapsed to a status/play-pause/settings row,
 *  expands in place to its servers, docker containers, and root paths. */
function ProjectCard({
  p,
  items,
  now,
  expanded,
  onToggleExpand,
  pendingServerActions,
  dragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  openServerId,
  onOpen,
  onStart,
  onStop,
  onRestart,
  onTrack,
  onEditServer,
  onDeleteServer,
  onKillChild,
  onStartProject,
  onStopProject,
  onAddServer,
  onEditProject,
}: ProjectCardProps) {
  const [hover, setHover] = useState(false);
  const agg = projectAggregate(items);
  const busy = items.some((s) => s.state.status === "starting" || pendingServerActions.has(s.id));
  const processItems = items.filter((s) => s.kind === "process");
  const dockerItems = items.filter((s) => s.kind === "docker");

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "var(--color-surface-container)",
        border: `1px solid ${hover ? "var(--color-outline)" : "var(--color-outline-variant)"}`,
        borderRadius: "var(--radius-lg)",
        opacity: dragging ? 0.4 : 1,
        transition: "border-color var(--duration-fast) var(--ease-standard)",
      }}
    >
      <div onClick={onToggleExpand} style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 16px 16px 18px", cursor: "default" }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "var(--radius-full)",
            flex: "0 0 auto",
            background: agg.color,
            animation: busy ? "ds-pulse 900ms var(--ease-standard) infinite" : undefined,
          }}
        />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              font: "500 15px/1.2 var(--font-ui)",
              color: "var(--color-on-surface)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {p.name}
          </span>
          <span
            style={{
              font: "400 10.5px/1 var(--font-mono)",
              color: "var(--color-on-surface-variant)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agg.label} · {items.length} tracked · {p.roots.length} {p.roots.length === 1 ? "root" : "roots"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }} onClick={(e) => e.stopPropagation()}>
          <SquareIconButton
            icon={agg.running > 0 ? "pause" : "play"}
            label={agg.running > 0 ? `Stop everything in ${p.name}` : `Start everything in ${p.name}`}
            onClick={() => (agg.running > 0 ? onStopProject(p.id) : onStartProject(p.id))}
          />
          <SquareIconButton icon="more-horizontal" label="Project settings" onClick={() => onEditProject(p.id)} />
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--color-outline-variant)", padding: "4px 4px 12px" }}>
          {processItems.map((s) => (
            <ServerRow
              key={s.id}
              s={s}
              now={now}
              pending={pendingServerActions.has(s.id)}
              active={s.id === openServerId}
              onOpen={() => onOpen(s.id)}
              onStart={() => onStart(s.id)}
              onStop={() => onStop(s.id)}
              onRestart={() => onRestart(s.id)}
              onTrack={() => onTrack(s.id)}
              onEdit={() => onEditServer(s.id)}
              onDelete={() => onDeleteServer(s.id)}
              onKillChild={(pid) => onKillChild(pid, s.id)}
              childPending={(pid) => pendingServerActions.has(`child:${pid}`)}
            />
          ))}

          <div style={{ padding: "8px 4px 0" }}>
            <DashedTile icon="plus" label="Add server" compact onClick={() => onAddServer(p.id)} />
          </div>

          {dockerItems.length > 0 && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 4px 4px" }}>
                <span
                  style={{
                    font: "400 9.5px/1 var(--font-mono)",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "var(--color-on-surface-variant)",
                  }}
                >
                  docker
                </span>
                <span style={{ flex: 1, height: 1, background: "var(--color-outline-variant)" }} />
              </div>
              {dockerItems.map((s) => (
                <ServerRow
                  key={s.id}
                  s={s}
                  now={now}
                  pending={pendingServerActions.has(s.id)}
                  active={s.id === openServerId}
                  onOpen={() => onOpen(s.id)}
                  onStart={() => onStart(s.id)}
                  onStop={() => onStop(s.id)}
                  onRestart={() => onRestart(s.id)}
                  onTrack={() => onTrack(s.id)}
                  onEdit={() => onEditServer(s.id)}
                  onDelete={() => onDeleteServer(s.id)}
                  onKillChild={(pid) => onKillChild(pid, s.id)}
                  childPending={(pid) => pendingServerActions.has(`child:${pid}`)}
                />
              ))}
            </>
          )}

          {p.roots.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 4px 0" }}>
              {p.roots.map((r) => (
                <span
                  key={r.id}
                  style={{
                    font: "400 10px/1 var(--font-mono)",
                    color: "var(--color-on-surface-variant)",
                    background: "var(--color-surface-container-low)",
                    borderRadius: "var(--radius-xs)",
                    padding: "3px 7px",
                  }}
                >
                  {r.label || r.path}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface UnassignedCardProps {
  items: DiscoveredProject[];
  expanded: boolean;
  onToggleExpand: () => void;
  projects: ProjectMeta[];
  onIgnore: (key: string) => void;
  onQuickAdd: (item: DiscoveredProject) => void;
  onQuickAddToProject: (item: DiscoveredProject, projectId: string) => void;
}

/** Read-only-looking pseudo-project for processes/containers that don't fall
 *  under any project's root paths — same card shape, no play-pause/settings,
 *  each row carries a promote-to-project + ignore menu instead. */
function UnassignedCard({ items, expanded, onToggleExpand, projects, onIgnore, onQuickAdd, onQuickAddToProject }: UnassignedCardProps) {
  return (
    <div style={{ background: "var(--color-surface-container)", border: "1px solid var(--color-outline-variant)", borderRadius: "var(--radius-lg)" }}>
      <div onClick={onToggleExpand} style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 16px 16px 18px", cursor: "default" }}>
        <span style={{ width: 8, height: 8, borderRadius: "var(--radius-full)", flex: "0 0 auto", background: "var(--status-running)" }} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ font: "500 15px/1.2 var(--font-ui)", color: "var(--color-on-surface)" }}>unassigned</span>
          <span style={{ font: "400 10.5px/1 var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
            {items.length} {items.length === 1 ? "process" : "processes"} outside every root path
          </span>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop: "1px solid var(--color-outline-variant)", padding: "4px 4px 12px" }}>
          {items.map((d) => {
            const key = discoveryKey(d);
            return (
              <div key={key} style={{ padding: "10px 4px", display: "flex", flexDirection: "column", gap: 8, borderBottom: "1px solid var(--color-outline-variant)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <StatusDot status={discoveredStatus(d)} size={7} />
                  <span
                    style={{
                      font: "500 13.5px/1 var(--font-ui)",
                      color: "var(--color-on-surface)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: "0 1 auto",
                      minWidth: 0,
                    }}
                  >
                    {d.suggestedName}
                  </span>
                  <span style={{ flex: 1, minWidth: 8 }} />
                  {d.kind === "process" && (
                    <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--color-on-surface-variant)", flex: "0 0 auto" }}>:{d.port}</span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 17 }}>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      font: "400 10.5px/1 var(--font-mono)",
                      color: "var(--color-on-surface-variant)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {discoveredMeta(d)}
                  </span>
                  <MenuButton
                    label={`${d.suggestedName} actions`}
                    variant="icon"
                    items={[
                      ...addMenuItems(d, projects, onQuickAdd, onQuickAddToProject),
                      { key: "__div2__", divider: true },
                      { key: "ignore", label: "Ignore", icon: "eye-off", onSelect: () => onIgnore(key) },
                    ]}
                  />
                </div>
              </div>
            );
          })}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 4px 0" }}>
            <span
              style={{
                font: "400 10px/1 var(--font-mono)",
                color: "var(--color-outline)",
                background: "var(--color-surface-container-low)",
                borderRadius: "var(--radius-xs)",
                padding: "3px 7px",
              }}
            >
              no root path match
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function Dashboard({
  projects,
  servers,
  discovered,
  openServerId,
  pendingServerActions,
  now,
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
  onTrack,
  onKillChild,
  onQuickAdd,
  onQuickAddToProject,
  onReorderProjects,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Local optimistic override for card order while dragging — reindexed on
  // every dragOver so the grid updates instantly, reconciled against
  // `projects` (the source of truth) so ids added/removed elsewhere still
  // show up. Order itself isn't a persisted field (see reorderProjects) —
  // it's implicit in `projects`' array position, echoed back by the daemon.
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const liveIds = projects.map((p) => p.id);
  const order = orderOverride ? [...orderOverride.filter((id) => liveIds.includes(id)), ...liveIds.filter((id) => !orderOverride.includes(id))] : liveIds;
  const orderedProjects = order.map((id) => projects.find((p) => p.id === id)).filter((p): p is ProjectMeta => !!p);

  function handleDragOver(overId: string) {
    if (!dragId || dragId === overId) return;
    const next = order.filter((id) => id !== dragId);
    next.splice(order.indexOf(overId), 0, dragId);
    setOrderOverride(next);
    onReorderProjects(next);
  }

  const ignored = new Set(uiState.ignoredDiscovered);
  const ignore = (key: string) => onSetUiState({ ...uiState, ignoredDiscovered: [...new Set(uiState.ignoredDiscovered).add(key)] });
  const visibleDiscovered = discovered.filter((d) => !ignored.has(discoveryKey(d)));

  const totalRoots = projects.reduce((n, p) => n + p.roots.length, 0);
  let totalRunning = 0;
  let totalStopped = 0;
  for (const s of servers) {
    if (s.state.status === "running" || s.state.status === "starting") totalRunning++;
    else totalStopped++;
  }

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid var(--color-outline-variant)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ font: "600 19px/1 var(--font-ui)", letterSpacing: "-0.01em", color: "var(--color-on-surface)" }}>devhub</span>
          <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--color-on-surface-variant)", letterSpacing: "0.02em" }}>
            watching {totalRoots} {totalRoots === 1 ? "root path" : "root paths"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, font: "400 11px/1 var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "var(--radius-full)", background: "var(--status-running)" }} />
            {totalRunning} running
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, font: "400 11px/1 var(--font-mono)", color: "var(--color-on-surface-variant)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "var(--radius-full)", background: "var(--status-stopped)" }} />
            {totalStopped} stopped
          </span>
          <span style={{ color: "var(--color-outline)" }}>|</span>
          <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--color-on-surface-variant)" }}>{stamp(new Date(now)).slice(0, 8)}</span>
          <Button variant="ghost" size="sm" icon="folder-plus" onClick={onAddProject}>
            Add project
          </Button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 20 }}>
        {orderedProjects.length === 0 && visibleDiscovered.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "60px 12px 0" }}>
            <EmptyState icon="folder-plus" title="No projects" description="Add a repo folder to start tracking its dev servers." />
            <Button variant="primary" size="sm" icon="plus" onClick={onAddProject}>
              Add project
            </Button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16, alignItems: "start" }}>
            {orderedProjects.map((p) => {
              const items = servers.filter((s) => s.projectId === p.id);
              return (
                <ProjectCard
                  key={p.id}
                  p={p}
                  items={items}
                  now={now}
                  expanded={expanded.has(p.id)}
                  onToggleExpand={() => toggleExpand(p.id)}
                  pendingServerActions={pendingServerActions}
                  dragging={dragId === p.id}
                  onDragStart={() => setDragId(p.id)}
                  onDragOver={() => handleDragOver(p.id)}
                  onDragEnd={() => setDragId(null)}
                  openServerId={openServerId}
                  onOpen={onOpen}
                  onStart={onStart}
                  onStop={onStop}
                  onRestart={onRestart}
                  onTrack={onTrack}
                  onEditServer={onEditServer}
                  onDeleteServer={onDeleteServer}
                  onKillChild={onKillChild}
                  onStartProject={onStartProject}
                  onStopProject={onStopProject}
                  onAddServer={onAddServer}
                  onEditProject={onEditProject}
                />
              );
            })}

            <DashedTile icon="folder-plus" label="Add project" onClick={onAddProject} />

            {visibleDiscovered.length > 0 && (
              <UnassignedCard
                items={visibleDiscovered}
                expanded={expanded.has("unassigned")}
                onToggleExpand={() => toggleExpand("unassigned")}
                projects={projects}
                onIgnore={ignore}
                onQuickAdd={onQuickAdd}
                onQuickAddToProject={onQuickAddToProject}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
