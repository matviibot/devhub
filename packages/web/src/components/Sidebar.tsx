import type { MouseEvent } from "react";
import type { DiscoveredProject, ProjectMeta, ServerSnapshot } from "@devhub/shared";
import { Button, EmptyState, GroupHeader, Icon, IconButton, SidebarRow } from "../ds";
import { tildify } from "../lib/paths";

interface Props {
  projects: ProjectMeta[];
  servers: ServerSnapshot[];
  discovered: DiscoveredProject[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStartProject: (projectId: string) => void;
  onStopProject: (projectId: string) => void;
  onAddProject: () => void;
  onEditProject: (projectId: string) => void;
  onDeleteProject: (id: string) => void;
  onAddServer: (projectId: string) => void;
  onEditServer: (serverId: string) => void;
  onDeleteServer: (id: string) => void;
  onTrack: (id: string) => void;
  onQuickAdd: (item: DiscoveredProject) => void;
}

export function Sidebar({
  projects,
  servers,
  discovered,
  selectedId,
  onSelect,
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
}: Props) {
  const running = servers.filter((s) => s.state.status === "running").length;
  const workspaceLabel = projects.length
    ? `${projects.length} ${projects.length === 1 ? "project" : "projects"} · ${servers.length} servers`
    : "no projects";

  const stop = (e: MouseEvent, fn: () => void) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      style={{
        flex: "0 0 264px",
        width: 264,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "var(--color-surface-container-low)",
        boxShadow: "inset -1px 0 0 var(--material-hairline)",
      }}
    >
      <div
        style={{
          flex: "0 0 auto",
          height: 30,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 6px 0 10px",
          boxShadow: "inset 0 -1px 0 var(--material-hairline)",
        }}
      >
        <Icon name="folder-tree" size={14} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            font: "400 11px/1 var(--font-mono)",
            color: "var(--color-on-surface-variant)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {workspaceLabel}
        </span>
        <IconButton icon="plus" label="Add project" size="sm" onClick={onAddProject} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 6px 8px" }}>
        {projects.map((p) => {
          const items = servers.filter((s) => s.projectId === p.id);
          return (
            <div style={{ marginBottom: 8 }} key={p.id}>
              <GroupHeader
                label={p.name}
                count={items.length}
                sticky
                actions={
                  <>
                    <IconButton icon="play" label={`Start all in ${p.name}`} size="sm" onClick={(e) => stop(e, () => onStartProject(p.id))} />
                    <IconButton icon="square" label={`Stop all in ${p.name}`} size="sm" onClick={(e) => stop(e, () => onStopProject(p.id))} />
                    <IconButton icon="plus" label={`Add server to ${p.name}`} size="sm" onClick={(e) => stop(e, () => onAddServer(p.id))} />
                    <IconButton icon="pencil" label={`Edit ${p.name}`} size="sm" onClick={(e) => stop(e, () => onEditProject(p.id))} />
                    <IconButton icon="trash-2" label={`Delete ${p.name}`} size="sm" onClick={(e) => stop(e, () => onDeleteProject(p.id))} />
                  </>
                }
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  height: 16,
                  padding: "0 8px 0 20px",
                  font: "400 11px/1 var(--font-mono)",
                  color: "var(--color-outline)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {tildify(p.root)}
              </div>
              {items.map((s) => (
                <SidebarRow
                  key={s.id}
                  label={s.name}
                  status={s.state.status}
                  meta={s.state.port ? `:${s.state.port}` : s.detected ? `:${s.detected.port}` : "—"}
                  selected={s.id === selectedId}
                  density="compact"
                  onClick={() => onSelect(s.id)}
                  badge={
                    s.detected ? (
                      <IconButton
                        icon="plug"
                        label={`Track ${s.name} — already running externally`}
                        size="sm"
                        style={{ color: "var(--color-primary)" }}
                        onClick={(e) => stop(e, () => onTrack(s.id))}
                      />
                    ) : undefined
                  }
                  actions={
                    <>
                      <IconButton icon="pencil" label={`Edit ${s.name}`} size="sm" onClick={(e) => stop(e, () => onEditServer(s.id))} />
                      <IconButton icon="trash-2" label={`Delete ${s.name}`} size="sm" onClick={(e) => stop(e, () => onDeleteServer(s.id))} />
                    </>
                  }
                />
              ))}
              {items.length === 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, height: 26, padding: "0 8px 0 30px", font: "400 12px/1 var(--font-ui)", color: "var(--color-outline)" }}>
                  No servers yet
                </div>
              )}
            </div>
          );
        })}

        {projects.length === 0 && discovered.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "40px 12px 0" }}>
            <EmptyState icon="folder-plus" size="sm" title="No projects" description="Add a repo folder to start managing its dev servers." />
            <Button variant="primary" size="sm" icon="plus" onClick={onAddProject}>
              Add project
            </Button>
          </div>
        )}

        {discovered.length > 0 && (
          <div style={{ marginTop: projects.length ? 12 : 0 }}>
            <GroupHeader label="Discovered" count={discovered.length} sticky />
            {discovered.map((item) => (
              <SidebarRow
                key={item.cwd}
                label={item.suggestedName}
                icon="sparkles"
                meta={`:${item.port}`}
                density="compact"
                badge={
                  <IconButton
                    icon="plus"
                    label={`Add ${item.suggestedName} as a project`}
                    size="sm"
                    style={{ color: "var(--color-primary)" }}
                    onClick={(e) => stop(e, () => onQuickAdd(item))}
                  />
                }
              />
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          flex: "0 0 auto",
          height: 30,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 6px 0 8px",
          background: "var(--material-regular)",
          backdropFilter: "saturate(180%) blur(var(--material-blur))",
          boxShadow: "inset 0 1px 0 var(--material-hairline)",
        }}
      >
        <Button variant="ghost" size="sm" icon="plus" onClick={onAddProject}>
          Add project
        </Button>
        <span style={{ flex: 1 }} />
        <span style={{ font: "400 11px/1 var(--font-mono)", color: "var(--color-outline)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {running} up · {servers.length} servers
        </span>
      </div>
    </div>
  );
}
