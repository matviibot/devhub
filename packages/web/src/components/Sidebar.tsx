import { useState } from "react";
import type { ProjectSnapshot } from "@devhub/shared";
import { GroupHeader, Icon, IconButton, SidebarRow } from "../ds";
import { commonAncestor, tildify } from "../lib/paths";

interface Props {
  projects: ProjectSnapshot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStartGroup: (group: string) => void;
  onStopGroup: (group: string) => void;
}

export function Sidebar({ projects, selectedId, onSelect, onStartGroup, onStopGroup }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = new Map<string, ProjectSnapshot[]>();
  const ungrouped: ProjectSnapshot[] = [];
  for (const p of projects) {
    if (!p.group) {
      ungrouped.push(p);
      continue;
    }
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group)!.push(p);
  }

  const rootLabel = projects.length ? tildify(commonAncestor(projects.map((p) => p.cwd))) : "no projects";
  const running = projects.filter((p) => p.state.status === "running").length;

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
          padding: "0 10px",
          boxShadow: "inset 0 -1px 0 var(--material-hairline)",
        }}
      >
        <Icon name="folder-tree" size={14} />
        <span
          style={{
            font: "400 11px/1 var(--font-mono)",
            color: "var(--color-on-surface-variant)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {rootLabel}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 6px 8px" }}>
        {[...groups.entries()].map(([group, items]) => (
          <div style={{ marginBottom: 6 }} key={group}>
            <GroupHeader
              label={group}
              count={items.length}
              sticky
              collapsed={collapsed[group]}
              onToggle={() => setCollapsed((c) => ({ ...c, [group]: !c[group] }))}
              actions={
                <>
                  <IconButton
                    icon="play"
                    label={`Start all in ${group}`}
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartGroup(group);
                    }}
                  />
                  <IconButton
                    icon="square"
                    label={`Stop all in ${group}`}
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStopGroup(group);
                    }}
                  />
                </>
              }
            />
            {!collapsed[group] &&
              items.map((p) => (
                <SidebarRow
                  key={p.id}
                  label={p.name}
                  status={p.state.status}
                  meta={p.state.port ? `:${p.state.port}` : "—"}
                  selected={p.id === selectedId}
                  density="compact"
                  onClick={() => onSelect(p.id)}
                />
              ))}
          </div>
        ))}
        {ungrouped.map((p) => (
          <SidebarRow
            key={p.id}
            label={p.name}
            status={p.state.status}
            meta={p.state.port ? `:${p.state.port}` : "—"}
            selected={p.id === selectedId}
            density="compact"
            onClick={() => onSelect(p.id)}
          />
        ))}
        {projects.length === 0 && (
          <p style={{ color: "var(--color-on-surface-variant)", font: "400 12px/1.5 var(--font-ui)", padding: 8 }}>
            No projects configured. Edit <code>devhub.config.json</code> at the repo root.
          </p>
        )}
      </div>

      <div
        style={{
          flex: "0 0 auto",
          height: 28,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          background: "var(--material-regular)",
          backdropFilter: "saturate(180%) blur(var(--material-blur))",
          boxShadow: "inset 0 1px 0 var(--material-hairline)",
          font: "400 11px/1 var(--font-mono)",
          color: "var(--color-outline)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>
          {projects.length} processes · {running} up
        </span>
      </div>
    </div>
  );
}
