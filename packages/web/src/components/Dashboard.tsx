import { useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import type { DiscoveredProject, ProjectMeta, ServerSnapshot, UiState } from "@devhub/shared";
import { Button, EmptyState, GroupHeader, Icon, IconButton, ServerCard, type MenuButtonItem, type ServerCardData } from "../ds";
import { dur } from "../lib/format";
import { tildify } from "../lib/paths";

interface Props {
  projects: ProjectMeta[];
  servers: ServerSnapshot[];
  discovered: DiscoveredProject[];
  openServerId: string | null;
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
  onDeleteProject: (id: string) => void;
  onAddServer: (projectId: string) => void;
  onEditServer: (serverId: string) => void;
  onDeleteServer: (id: string) => void;
  onTrack: (id: string) => void;
  /** "New project" branch of the Add ▾ menu. */
  onQuickAdd: (item: DiscoveredProject) => void;
  /** "<existing project>" branch of the Add ▾ menu. */
  onQuickAddToProject: (item: DiscoveredProject, projectId: string) => void;
  onReorderProjects: (ids: string[]) => void;
  onReorderServers: (projectId: string, ids: string[]) => void;
}

/** Moves `draggedId` to sit immediately before `targetId`, preserving the
 *  relative order of everything else. */
function reorderIds(ids: string[], draggedId: string, targetId: string): string[] {
  if (draggedId === targetId) return ids;
  const rest = ids.filter((id) => id !== draggedId);
  const targetIdx = rest.indexOf(targetId);
  return [...rest.slice(0, targetIdx), draggedId, ...rest.slice(targetIdx)];
}

function serverCard(s: ServerSnapshot, now: number, active: boolean): ServerCardData {
  const { state } = s;
  const port = state.port ?? s.detected?.port;
  const plural = (n: number) => (n === 1 ? "restart" : "restarts");

  let metaLine: string;
  if (s.detected) metaLine = `running externally · pid ${s.detected.pid}`;
  else if (state.status === "running" || state.status === "starting") metaLine = `pid ${state.pid ?? "—"} · up ${dur(now - (state.startedAt ?? now))}`;
  else if (state.status === "crashed") metaLine = `exited ${state.exitCode ?? "—"} · ${state.restartCount} ${plural(state.restartCount)}`;
  else metaLine = s.command;

  return {
    id: s.id,
    name: s.name,
    status: state.status,
    pathLine: tildify(s.cwd),
    metaLine,
    portLabel: port ? `:${port}` : undefined,
    url: port ? `http://localhost:${port}` : undefined,
    active,
    editable: true,
    showTrack: !!s.detected,
    showStart: !s.detected && state.status !== "running" && state.status !== "starting",
    showRestart: !s.detected && (state.status === "running" || state.status === "starting"),
    showStop: !s.detected && (state.status === "running" || state.status === "starting"),
  };
}

function discoveredCard(d: DiscoveredProject, opts: { ghost?: boolean; showAddMenu?: boolean; showIgnore?: boolean; showUnignore?: boolean } = {}): ServerCardData {
  return {
    id: d.cwd,
    name: d.suggestedName,
    status: "running",
    pathLine: tildify(d.cwd),
    metaLine: `pid ${d.pid}`,
    portLabel: `:${d.port}`,
    url: `http://localhost:${d.port}`,
    ghost: opts.ghost ?? true,
    static: true,
    showAddMenu: opts.showAddMenu,
    showIgnore: opts.showIgnore,
    showUnignore: opts.showUnignore,
  };
}

/** "New project" plus one row per existing project, for a discovered item's Add ▾ menu. */
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

/** Dashed affordance tile. As a CardGrid item it stretches to match the row
 *  (grid blockifies inline-flex, so it fills the cell like a real card); as
 *  a standalone `compact` tile it shrinks to fit its label instead of
 *  stretching across the whole content width. */
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
        minHeight: compact ? undefined : 40,
        height: compact ? 32 : undefined,
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

function CardGrid({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(252px, 1fr))", gap: 10, ...style }}>{children}</div>;
}

function matches(query: string, ...fields: (string | number | undefined | null)[]): boolean {
  if (!query) return true;
  return fields.some((f) => f != null && String(f).toLowerCase().includes(query));
}

function serverMatches(s: ServerSnapshot, query: string): boolean {
  return matches(query, s.name, s.command, s.cwd, s.state.port, s.detected?.port);
}

function discoveredMatches(d: DiscoveredProject, query: string): boolean {
  return matches(query, d.suggestedName, d.cwd, d.port);
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: 220,
        height: 24,
        padding: "0 6px 0 8px",
        borderRadius: "var(--radius-sm)",
        background: "var(--color-surface-container-lowest)",
        boxShadow: "var(--inset-hairline)",
      }}
    >
      <Icon name="search" size={12} color="var(--color-outline)" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter…"
        style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--color-on-surface)",
          font: "400 12px/1 var(--font-ui)",
        }}
      />
      {value && <IconButton icon="x" label="Clear filter" size="sm" onClick={() => onChange("")} />}
    </div>
  );
}

export function Dashboard({
  projects,
  servers,
  discovered,
  openServerId,
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
  onDeleteProject,
  onAddServer,
  onEditServer,
  onDeleteServer,
  onTrack,
  onQuickAdd,
  onQuickAddToProject,
  onReorderProjects,
  onReorderServers,
}: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  // Drag-and-drop is disabled while a filter is active — the visible list is
  // a subset of the real order, so "drop before this card" would be
  // ambiguous relative to whatever's currently hidden.
  const [drag, setDrag] = useState<{ scope: string; id: string } | null>(null);
  function dragProps(scope: string, id: string, orderedIds: () => string[], onReorder: (ids: string[]) => void) {
    if (q) return { dragging: false };
    return {
      onDragStart: (e: DragEvent) => {
        e.dataTransfer.effectAllowed = "move";
        setDrag({ scope, id });
      },
      onDragOver: (e: DragEvent) => {
        if (drag?.scope === scope) e.preventDefault();
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (!drag || drag.scope !== scope || drag.id === id) return;
        onReorder(reorderIds(orderedIds(), drag.id, id));
        setDrag(null);
      },
      onDragEnd: () => setDrag(null),
      dragging: drag?.scope === scope && drag.id === id,
    };
  }

  const ignored = new Set(uiState.ignoredDiscovered);
  const collapsed = new Set(uiState.collapsedGroups);

  const toggle = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSetUiState({ ...uiState, collapsedGroups: [...next] });
  };
  // While a filter is active, every rendered group necessarily has a match
  // (non-matching groups are filtered out entirely below) — force it open
  // without touching the persisted collapse state, so clearing the filter
  // restores exactly what was collapsed before.
  const isGroupCollapsed = (key: string) => (q ? false : collapsed.has(key));
  const ignore = (key: string) => onSetUiState({ ...uiState, ignoredDiscovered: [...new Set(uiState.ignoredDiscovered).add(key)] });
  const unignore = (key: string) => onSetUiState({ ...uiState, ignoredDiscovered: uiState.ignoredDiscovered.filter((k) => k !== key) });

  const workspaceLabel = projects.length
    ? `${projects.length} ${projects.length === 1 ? "project" : "projects"} · ${servers.length} servers`
    : "no projects";
  const visibleDiscovered = discovered.filter((d) => !ignored.has(d.cwd) && discoveredMatches(d, q));
  const ignoredList = discovered.filter((d) => ignored.has(d.cwd) && discoveredMatches(d, q));
  const anyProjectMatches = projects.some(
    (p) => matches(q, p.name) || servers.some((s) => s.projectId === p.id && serverMatches(s, q)),
  );
  const noMatches = !!q && !anyProjectMatches && visibleDiscovered.length === 0 && ignoredList.length === 0;

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", padding: "0 16px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 24, padding: "12px 2px 0", marginBottom: 6, boxSizing: "content-box" }}>
        <Icon name="folder-tree" size={14} />
        <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--color-on-surface-variant)", fontVariantNumeric: "tabular-nums" }}>
          {workspaceLabel}
        </span>
        <span style={{ flex: 1 }} />
        <SearchField value={query} onChange={setQuery} />
        <Button variant="ghost" size="sm" icon="folder-plus" onClick={onAddProject}>
          Add project
        </Button>
      </div>

      {projects.map((p) => {
        const projectItems = servers.filter((s) => s.projectId === p.id);
        const nameMatches = matches(q, p.name);
        const items = !q || nameMatches ? projectItems : projectItems.filter((s) => serverMatches(s, q));
        if (q && !nameMatches && items.length === 0) return null;
        const key = `project:${p.id}`;
        const isCollapsed = isGroupCollapsed(key);
        return (
          <div key={p.id} style={{ marginBottom: 18 }}>
            <GroupHeader
              label={p.name}
              count={items.length}
              sticky
              collapsed={isCollapsed}
              onToggle={() => toggle(key)}
              {...dragProps("projects", p.id, () => projects.map((x) => x.id), onReorderProjects)}
              actions={
                <>
                  <IconButton icon="play" label={`Start all in ${p.name}`} size="sm" onClick={() => onStartProject(p.id)} />
                  <IconButton icon="square" label={`Stop all in ${p.name}`} size="sm" onClick={() => onStopProject(p.id)} />
                  <IconButton icon="plus" label={`Add server to ${p.name}`} size="sm" onClick={() => onAddServer(p.id)} />
                  <IconButton icon="pencil" label={`Edit ${p.name}`} size="sm" onClick={() => onEditProject(p.id)} />
                  <IconButton icon="trash-2" label={`Delete ${p.name}`} size="sm" onClick={() => onDeleteProject(p.id)} />
                </>
              }
            />
            {!isCollapsed && (
              <CardGrid style={{ marginTop: 6 }}>
                {items.map((s) => (
                  <ServerCard
                    key={s.id}
                    card={serverCard(s, now, s.id === openServerId)}
                    onOpen={() => onOpen(s.id)}
                    onEdit={() => onEditServer(s.id)}
                    onDelete={() => onDeleteServer(s.id)}
                    onStart={() => onStart(s.id)}
                    onStop={() => onStop(s.id)}
                    onRestart={() => onRestart(s.id)}
                    onTrack={() => onTrack(s.id)}
                    {...dragProps(`servers:${p.id}`, s.id, () => projectItems.map((x) => x.id), (ids) => onReorderServers(p.id, ids))}
                  />
                ))}
                <DashedTile icon="plus" label="Add server" onClick={() => onAddServer(p.id)} />
              </CardGrid>
            )}
          </div>
        );
      })}

      {visibleDiscovered.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <GroupHeader
            label="Discovered"
            count={visibleDiscovered.length}
            sticky
            collapsed={isGroupCollapsed("section:discovered")}
            onToggle={() => toggle("section:discovered")}
          />
          {!isGroupCollapsed("section:discovered") && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 18,
                  padding: "0 8px 0 20px",
                  marginBottom: 6,
                  font: "400 11px/1 var(--font-mono)",
                  color: "var(--color-outline)",
                }}
              >
                listening locally · not in your config
              </div>
              <CardGrid>
                {visibleDiscovered.map((d) => (
                  <ServerCard
                    key={d.cwd}
                    card={discoveredCard(d, { showAddMenu: true, showIgnore: true })}
                    addMenuItems={addMenuItems(d, projects, onQuickAdd, onQuickAddToProject)}
                    onIgnore={() => ignore(d.cwd)}
                  />
                ))}
              </CardGrid>
            </>
          )}
        </div>
      )}

      {ignoredList.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <GroupHeader
            label="Ignored"
            count={ignoredList.length}
            sticky
            collapsed={isGroupCollapsed("section:ignored")}
            onToggle={() => toggle("section:ignored")}
          />
          {!isGroupCollapsed("section:ignored") && (
            <CardGrid style={{ marginTop: 6 }}>
              {ignoredList.map((d) => (
                <ServerCard
                  key={d.cwd}
                  card={discoveredCard(d, { showUnignore: true })}
                  onUnignore={() => unignore(d.cwd)}
                />
              ))}
            </CardGrid>
          )}
        </div>
      )}

      {noMatches && <EmptyState icon="search" title="No matches" description={`Nothing matches "${query.trim()}".`} style={{ padding: "60px 12px 0" }} />}

      {!q && projects.length === 0 && discovered.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "60px 12px 0" }}>
          <EmptyState icon="folder-plus" title="No projects" description="Add a repo folder to start managing its dev servers." />
          <Button variant="primary" size="sm" icon="plus" onClick={onAddProject}>
            Add project
          </Button>
        </div>
      )}
    </div>
  );
}
