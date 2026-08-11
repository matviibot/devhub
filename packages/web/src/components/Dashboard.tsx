import { useState, type CSSProperties, type ReactNode } from "react";
import type { DiscoveredProject, ProjectMeta, ServerSnapshot } from "@devhub/shared";
import { Button, EmptyState, GroupHeader, Icon, IconButton, ServerCard, type MenuButtonItem, type ServerCardData } from "../ds";
import { dur } from "../lib/format";
import { tildify } from "../lib/paths";

interface Props {
  projects: ProjectMeta[];
  servers: ServerSnapshot[];
  discovered: DiscoveredProject[];
  openServerId: string | null;
  now: number;
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

export function Dashboard({
  projects,
  servers,
  discovered,
  openServerId,
  now,
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
}: Props) {
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  // "ignored" starts pre-collapsed — it's a rarely-visited bin, not something
  // that should compete for attention with active projects on every load.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["section:ignored"]));
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const workspaceLabel = projects.length
    ? `${projects.length} ${projects.length === 1 ? "project" : "projects"} · ${servers.length} servers`
    : "no projects";
  const visibleDiscovered = discovered.filter((d) => !ignored.has(d.cwd));
  const ignoredList = discovered.filter((d) => ignored.has(d.cwd));

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", padding: "0 16px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 24, padding: "12px 2px 0", marginBottom: 6, boxSizing: "content-box" }}>
        <Icon name="folder-tree" size={14} />
        <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--color-on-surface-variant)", fontVariantNumeric: "tabular-nums" }}>
          {workspaceLabel}
        </span>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" icon="folder-plus" onClick={onAddProject}>
          Add project
        </Button>
      </div>

      {projects.map((p) => {
        const items = servers.filter((s) => s.projectId === p.id);
        const key = `project:${p.id}`;
        const isCollapsed = collapsed.has(key);
        return (
          <div key={p.id} style={{ marginBottom: 18 }}>
            <GroupHeader
              label={p.name}
              count={items.length}
              sticky
              collapsed={isCollapsed}
              onToggle={() => toggle(key)}
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
            collapsed={collapsed.has("section:discovered")}
            onToggle={() => toggle("section:discovered")}
          />
          {!collapsed.has("section:discovered") && (
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
                    onIgnore={() => setIgnored((prev) => new Set(prev).add(d.cwd))}
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
            collapsed={collapsed.has("section:ignored")}
            onToggle={() => toggle("section:ignored")}
          />
          {!collapsed.has("section:ignored") && (
            <CardGrid style={{ marginTop: 6 }}>
              {ignoredList.map((d) => (
                <ServerCard
                  key={d.cwd}
                  card={discoveredCard(d, { showUnignore: true })}
                  onUnignore={() =>
                    setIgnored((prev) => {
                      const next = new Set(prev);
                      next.delete(d.cwd);
                      return next;
                    })
                  }
                />
              ))}
            </CardGrid>
          )}
        </div>
      )}

      {projects.length === 0 && discovered.length === 0 && (
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
