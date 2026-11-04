import { useEffect, useId, useMemo, useState } from "react";
import type { AgentRun, ProjectView, ServiceView } from "@devhub/shared";
import type { Devhub } from "../hooks/useDevhub";
import { Icon, Overlay } from "../ds";
import { pageUrl } from "../lib/pageUrl";

interface Props {
  devhub: Devhub;
  projects: ProjectView[];
  agentRuns: AgentRun[];
  compact: boolean;
  onClose: () => void;
  onNow: () => void;
  onRunning: () => void;
  onAttention: () => void;
  onPorts: () => void;
  onUnowned: () => void;
  onAddProject: () => void;
  onOpenProject: (id: string) => void;
  onOpenLogs: (id: string) => void;
}

interface CommandResult {
  id: string;
  label: string;
  meta: string;
  icon: string;
  keywords: string;
  tone?: "intent" | "danger";
  action: () => void;
}

const servicesOf = (project: ProjectView): ServiceView[] => [
  ...project.repos.flatMap((repo) => repo.worktrees.flatMap((worktree) => worktree.services)),
  ...project.looseServices,
];

function previewOf(project: ProjectView, runs: AgentRun[], announcements: Devhub["serviceAnnouncements"]): string | null {
  const runningAnnouncement = announcements.find((item) => item.projectId === project.id && item.status === "running");
  if (runningAnnouncement) return runningAnnouncement.url;
  const activeRunIds = new Set(runs.filter((run) => run.projectId === project.id && (run.status === "working" || run.status === "waiting")).map((run) => run.id));
  const announced = announcements.find((item) => item.projectId === project.id && activeRunIds.has(item.runId));
  if (announced?.status === "running") return announced.url;
  return pageUrl(servicesOf(project)) ?? null;
}

export function CommandPalette({
  devhub,
  projects,
  agentRuns,
  compact,
  onClose,
  onNow,
  onRunning,
  onAttention,
  onPorts,
  onUnowned,
  onAddProject,
  onOpenProject,
  onOpenLogs,
}: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const titleId = useId();
  const listId = useId();

  const results = useMemo(() => {
    const closeThen = (action: () => void) => () => {
      onClose();
      action();
    };
    const items: CommandResult[] = [
      { id: "view:now", label: "Show Now", meta: "Projects that need you, are running, or are ready", icon: "view_list", keywords: "home projects recent", action: closeThen(onNow) },
      { id: "view:running", label: "Show running work", meta: "Agents and projects active on this machine", icon: "bolt", keywords: "active agents services", action: closeThen(onRunning) },
      { id: "view:attention", label: "Show attention queue", meta: "Blockers, collisions, and cleanup", icon: "error", keywords: "alerts blocked failed", tone: "danger", action: closeThen(onAttention) },
      { id: "view:ports", label: "Inspect ports", meta: "See what holds each local port", icon: "lan", keywords: "network listeners collision", action: closeThen(onPorts) },
      { id: "view:unowned", label: "Inspect unowned processes", meta: "Running outside a known project", icon: "folder_off", keywords: "orphan foreign process", action: closeThen(onUnowned) },
      { id: "project:add", label: "Add project", meta: "Register another local project", icon: "add", keywords: "new repository repo", action: closeThen(onAddProject) },
    ];

    for (const project of projects) {
      const services = servicesOf(project);
      const live = services.filter((service) => service.status === "running" || service.status === "starting");
      const launchable = project.repos.flatMap((repo) => repo.worktrees.filter((worktree) => worktree.isMain).slice(0, 1).flatMap((worktree) => worktree.services.filter((service) => service.launchable))).concat(project.looseServices.filter((service) => service.launchable));
      const scope = `${project.name} · ${project.repos.map((repo) => repo.label).join(", ") || "local project"}`;
      items.push({ id: `project:${project.id}:open`, label: `Open ${project.name}`, meta: "Project details and workspaces", icon: "folder_open", keywords: `${scope} details workspace`, action: closeThen(() => onOpenProject(project.id)) });
      if (project.runningCount > 0) {
        items.push({ id: `project:${project.id}:stop`, label: `Stop ${project.name}`, meta: `${project.runningCount} observed running`, icon: "stop", keywords: `${scope} halt shutdown`, tone: "danger", action: closeThen(() => devhub.stopProject(project.id, services.map((service) => service.id))) });
      } else if (launchable.length > 0) {
        items.push({ id: `project:${project.id}:start`, label: `Start ${project.name}`, meta: `${launchable.length} launcher${launchable.length === 1 ? "" : "s"} in the primary workspace`, icon: "play_arrow", keywords: `${scope} run launch`, action: closeThen(() => devhub.startProject(project.id, launchable.map((service) => service.id))) });
      }
      const preview = previewOf(project, agentRuns, devhub.serviceAnnouncements);
      if (preview) items.push({ id: `project:${project.id}:preview`, label: `Open page for ${project.name}`, meta: preview, icon: "open_in_new", keywords: `${scope} preview browser url`, action: closeThen(() => window.open(preview, "_blank")) });
      for (const service of live) {
        items.push({ id: `service:${service.id}:logs`, label: `Show ${service.displayName} logs`, meta: `${project.name} · ${service.ports.map((port) => `:${port}`).join(", ") || "running"}`, icon: "terminal", keywords: `${scope} ${service.displayName} ${service.role} output console`, action: closeThen(() => onOpenLogs(service.id)) });
      }
    }

    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = words.length
      ? items.filter((item) => words.every((word) => `${item.label} ${item.meta} ${item.keywords}`.toLowerCase().includes(word)))
      : items;
    return filtered.slice(0, 24);
  }, [agentRuns, devhub, onAddProject, onAttention, onClose, onNow, onOpenLogs, onOpenProject, onPorts, onRunning, onUnowned, projects, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (active >= results.length) setActive(Math.max(0, results.length - 1));
  }, [active, results.length]);

  const run = (result: CommandResult | undefined) => result?.action();

  return (
    <Overlay
      onClose={onClose}
      zIndex={44}
      sheet={compact}
      panelStyle={{
        width: compact ? "100%" : "min(720px, calc(100vw - 32px))",
        maxHeight: compact ? "88vh" : "min(680px, calc(100vh - 64px))",
        background: "var(--dh-bg-raised)",
        border: "1px solid var(--dh-border-button)",
        borderRadius: compact ? "16px 16px 0 0" : 13,
        boxShadow: "var(--dh-shadow-dialog)",
        overflow: "hidden",
      }}
    >
      <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="sr-only">DevHub commands</h2>
        <div className="command-input-wrap">
          <Icon name="search" size={19} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(results.length - 1, index + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                run(results[active]);
              }
            }}
            placeholder="Search projects, services, and commands"
            aria-label="Search DevHub commands"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
          />
          <kbd>Esc</kbd>
        </div>
        <div id={listId} className="command-results" role="listbox" aria-label="Commands">
          {results.map((result, index) => (
            <button
              id={`${listId}-${index}`}
              key={result.id}
              type="button"
              role="option"
              aria-selected={index === active}
              className={`${index === active ? "is-active" : ""}${result.tone ? ` is-${result.tone}` : ""}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => run(result)}
            >
              <span className="command-result-icon"><Icon name={result.icon} size={17} /></span>
              <span><strong>{result.label}</strong><small>{result.meta}</small></span>
              <kbd>{index === active ? "↵" : ""}</kbd>
            </button>
          ))}
          {results.length === 0 && (
            <div className="command-empty"><strong>No matching command</strong><span>Try a project name, service, action, or port.</span></div>
          )}
        </div>
        <footer><span><kbd>↑↓</kbd> Move</span><span><kbd>↵</kbd> Run</span><span><kbd>Esc</kbd> Close</span></footer>
      </section>
    </Overlay>
  );
}
