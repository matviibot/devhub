import type { ProjectSnapshot } from "@devhub/shared";
import { StatusDot } from "./StatusDot";

interface Props {
  projects: ProjectSnapshot[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStartGroup: (group: string) => void;
  onStopGroup: (group: string) => void;
}

export function Sidebar({ projects, selectedId, onSelect, onStartGroup, onStopGroup }: Props) {
  const groups = new Map<string | undefined, ProjectSnapshot[]>();
  for (const p of projects) {
    const key = p.group;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  return (
    <nav className="sidebar">
      {[...groups.entries()].map(([group, items]) => (
        <div className="sidebar__group" key={group ?? "__ungrouped"}>
          {group && (
            <div className="sidebar__group-header">
              <span>{group}</span>
              <div className="sidebar__group-actions">
                <button onClick={() => onStartGroup(group)} title={`Start all in ${group}`}>
                  ▶
                </button>
                <button onClick={() => onStopGroup(group)} title={`Stop all in ${group}`}>
                  ■
                </button>
              </div>
            </div>
          )}
          {items.map((p) => (
            <button
              key={p.id}
              className={`sidebar__row ${p.id === selectedId ? "sidebar__row--active" : ""}`}
              onClick={() => onSelect(p.id)}
            >
              <StatusDot status={p.state.status} />
              <span className="sidebar__row-name">{p.name}</span>
              {p.state.port && <span className="sidebar__row-port">:{p.state.port}</span>}
            </button>
          ))}
        </div>
      ))}
      {projects.length === 0 && (
        <p className="sidebar__empty">
          No projects configured. Edit <code>devhub.config.json</code> at the repo root.
        </p>
      )}
    </nav>
  );
}
