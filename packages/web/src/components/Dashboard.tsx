import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ActivityEvent, AgentRun, Alert, NeverStarted, Orphan, PortReservation, PortRow, ProjectView, RepoView, ServiceAnnouncement, ServiceView, WorktreeView } from "@devhub/shared";
import { Button, EmptyState, Icon, IconButton, MenuButton, StatusDot, ToastStack, type MenuButtonItem, type ToastData } from "../ds";
import type { Devhub } from "../hooks/useDevhub";
import { dur } from "../lib/format";
import { tildify } from "../lib/paths";
import { pageUrl } from "../lib/pageUrl";
import { CommandPalette } from "./CommandPalette";

const RAIL_W = 268;

/** The two synthetic rail entries that sit below the project list. Ports are
 *  the scarce resource on this machine, so they get their own view rather
 *  than being buried in each row. */
type Selection = { kind: "project"; id: string } | { kind: "ports" } | { kind: "unowned" };

type DashboardView =
  | { kind: "home" }
  | { kind: "active" }
  | { kind: "project"; id: string }
  | { kind: "attention" }
  | { kind: "ports" }
  | { kind: "unowned" };

interface Props {
  devhub: Devhub;
  now: number;
  compact: boolean;
  openLogId: string | null;
  onOpenLogs: (id: string) => void;
  onEditProject: (id: string) => void;
  onAddProject: () => void;
  onEditLauncher: (a: { projectId: string; repoPath: string; service: ServiceView }) => void;
  onReviewMigration: () => void;
  toasts: ToastData[];
  onDismissToast: (id: string) => void;
  pushToast: (t: Omit<ToastData, "id">) => void;
}

export function Dashboard({
  devhub,
  now,
  compact,
  openLogId,
  onOpenLogs,
  onEditProject,
  onAddProject,
  onEditLauncher,
  onReviewMigration,
  toasts,
  onDismissToast,
  pushToast,
}: Props) {
  const { projects, activity, agentRuns, portReservations, serviceAnnouncements, unowned, alerts, ports, migration, neverStarted, connected } = devhub;
  const blockedRuns = agentRuns.filter((run) => (run.status === "working" || run.status === "waiting") && runChecks(run).some((check) => check.status === "blocked"));
  const [view, setView] = useState<DashboardView>({ kind: "home" });
  const [filter, setFilter] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return projects;
    const portQ = q.startsWith(":") ? Number(q.slice(1)) : null;
    return projects.filter((p) => {
      if (portQ != null) return allServices(p).some((s) => s.ports.includes(portQ));
      return (
        p.name.toLowerCase().includes(q) ||
        p.repos.some((r) => r.label.toLowerCase().includes(q) || r.worktrees.some((w) => workspaceLabel(w).toLowerCase().includes(q))) ||
        allServices(p).some((s) => s.displayName.toLowerCase().includes(q)) ||
        agentRuns.some((run) => run.projectId === p.id && (`${run.agent} ${run.task} ${run.detail ?? ""} ${runChecks(run).map((check) => `${check.label} ${check.detail ?? ""}`).join(" ")}`).toLowerCase().includes(q))
      );
    });
  }, [projects, agentRuns, filter]);

  const selected = view.kind === "project" ? projects.find((p) => p.id === view.id) : undefined;

  /** Every id that should be revealed/flashed after an alert click. */
  const [reveal, setReveal] = useState<string | null>(null);
  const revealTarget = (projectId: string | null, targetId: string | null) => {
    const owner = projectId ?? (targetId ? projects.find((p) => allServices(p).some((s) => s.id === targetId))?.id : null);
    if (owner) setView({ kind: "project", id: owner });
    if (targetId) {
      setReveal(targetId);
      window.setTimeout(() => setReveal((cur) => (cur === targetId ? null : cur)), 2200);
    }
  };

  /** Keyboard-first reordering. The rewrite dropped the drag-and-drop rail
   *  from commit 9e46509 and left `reorderProjects` implemented on the client,
   *  the server and in persisted prefs with no caller at all — so rail order
   *  stopped being the user's to set. Move up/down is the accessible core;
   *  drag can be layered on top later without changing the protocol. */
  const moveProject = (id: string, dir: -1 | 1) => {
    const order = projects.map((p) => p.id);
    const i = order.indexOf(id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    devhub.reorderProjects(order);
  };

  return (
    <div className="launch-shell">
      <LaunchHeader
        view={view}
        project={selected}
        projectCount={projects.length}
        activeCount={projects.filter((p) => p.runningCount > 0 || agentRuns.some((run) => run.projectId === p.id && (run.status === "working" || run.status === "waiting"))).length}
        attentionCount={alerts.length + unowned.length + neverStarted.length + blockedRuns.length}
        filter={filter}
        compact={compact}
        onFilter={setFilter}
        onActive={() => setView({ kind: "active" })}
        onHome={() => {
          setView({ kind: "home" });
        }}
        onAttention={() => setView({ kind: "attention" })}
        onPorts={() => setView({ kind: "ports" })}
        onUnowned={() => setView({ kind: "unowned" })}
        onCommand={() => setPaletteOpen(true)}
        onAddProject={onAddProject}
      />
      <main
        className="launch-main"
        style={{
          // Disconnected, every row below is a stale observation and every
          // button is a no-op. Saying so is the honest thing; leaving it fully
          // live let a click spin for fifteen seconds and silently revert.
          opacity: connected ? 1 : 0.55,
          pointerEvents: connected ? undefined : "none",
        }}
        aria-busy={!connected}
      >
        {migration.length > 0 && <MigrationBanner count={migration.length} onReview={onReviewMigration} onDismiss={devhub.dismissMigration} />}

        {view.kind === "home" ? (
          <ProjectsHome
            projects={filtered}
            devhub={devhub}
            now={now}
            compact={compact}
            agentRuns={agentRuns}
            activity={activity}
            serviceAnnouncements={serviceAnnouncements}
            totalProjects={projects.length}
            query={filter}
            neverStarted={neverStarted}
            onOpen={(id) => setView({ kind: "project", id })}
            onOpenLogs={onOpenLogs}
            onAddProject={onAddProject}
            onEditProject={onEditProject}
            onClear={() => {
              setFilter("");
            }}
          />
        ) : view.kind === "active" ? (
          <ActivePane projects={projects} agentRuns={agentRuns} now={now} onOpenProject={(id) => setView({ kind: "project", id })} />
        ) : view.kind === "ports" ? (
          <PortsPane ports={ports} onReveal={revealTarget} />
        ) : view.kind === "unowned" ? (
          <UnownedPane orphans={unowned} onKill={devhub.killOrphan} pending={devhub.pending} />
        ) : view.kind === "attention" ? (
          <AttentionPane
            alerts={alerts}
            blockedRuns={blockedRuns}
            unowned={unowned}
            neverStarted={neverStarted}
            onReveal={revealTarget}
            onOpenProject={(id) => setView({ kind: "project", id })}
            onOpenUnowned={() => setView({ kind: "unowned" })}
          />
        ) : selected ? (
          <LaunchProject
            key={selected.id}
            project={selected}
            devhub={devhub}
            now={now}
            pushToast={pushToast}
            connected={connected}
            compact={compact}
            canMoveUp={projects.findIndex((p) => p.id === selected.id) > 0}
            canMoveDown={projects.findIndex((p) => p.id === selected.id) < projects.length - 1}
            onMove={(dir) => moveProject(selected.id, dir)}
            reveal={reveal}
            neverStarted={neverStarted.filter((n) => n.projectId === selected.id)}
            openLogId={openLogId}
            onOpenLogs={onOpenLogs}
            onEditProject={onEditProject}
            onEditLauncher={onEditLauncher}
            onBack={() => setView({ kind: "home" })}
            onPorts={() => setView({ kind: "ports" })}
            agentRuns={agentRuns.filter((run) => run.projectId === selected.id)}
            portReservations={portReservations.filter((item) => item.projectId === selected.id)}
            serviceAnnouncements={serviceAnnouncements.filter((item) => item.projectId === selected.id)}
          />
        ) : (
          <ProjectsHome projects={projects} devhub={devhub} now={now} compact={compact} agentRuns={agentRuns} activity={activity} serviceAnnouncements={serviceAnnouncements} totalProjects={projects.length} query="" neverStarted={neverStarted} onOpen={(id) => setView({ kind: "project", id })} onOpenLogs={onOpenLogs} onAddProject={onAddProject} onEditProject={onEditProject} onClear={() => setView({ kind: "home" })} />
        )}
      </main>

      <ToastStack toasts={toasts} onDismiss={onDismissToast} />
      {paletteOpen && (
        <CommandPalette
          devhub={devhub}
          projects={projects}
          agentRuns={agentRuns}
          compact={compact}
          onClose={() => setPaletteOpen(false)}
          onNow={() => setView({ kind: "home" })}
          onRunning={() => setView({ kind: "active" })}
          onAttention={() => setView({ kind: "attention" })}
          onPorts={() => setView({ kind: "ports" })}
          onUnowned={() => setView({ kind: "unowned" })}
          onAddProject={onAddProject}
          onOpenProject={(id) => setView({ kind: "project", id })}
          onOpenLogs={onOpenLogs}
        />
      )}
    </div>
  );
}

const allServices = (p: ProjectView): ServiceView[] => [
  ...p.repos.flatMap((r) => r.worktrees.flatMap((w) => w.services)),
  ...p.looseServices,
];

const runChecks = (run: AgentRun) => run.checks ?? [];
const blockedCheck = (run: AgentRun) => runChecks(run).find((check) => check.status === "blocked");
const readinessLabel = (run: AgentRun) => {
  const checks = runChecks(run);
  if (!checks.length) return null;
  const ready = checks.filter((check) => check.status === "ready").length;
  return `${ready}/${checks.length} ready`;
};
const focusedRun = (runs: AgentRun[]) =>
  runs.find((run) => (run.status === "working" || run.status === "waiting") && blockedCheck(run)) ??
  runs.find((run) => run.status === "waiting") ??
  runs.find((run) => run.status === "working") ??
  runs[0];

const activityIcon = (kind: ActivityEvent["kind"]): string => {
  if (kind === "service-started") return "play_arrow";
  if (kind === "service-stopped") return "stop";
  if (kind === "service-crashed" || kind === "agent-failed") return "error";
  if (kind === "agent-finished") return "check";
  if (kind === "agent-waiting") return "pause";
  return "priority_high";
};

interface WorkspaceEntry {
  repo: RepoView;
  worktree: WorktreeView;
}

interface WorkspaceSummary {
  id: string;
  label: string;
  entries: WorkspaceEntry[];
  services: ServiceView[];
  liveCount: number;
  isPrimary: boolean;
}

function workspaceLabel(worktree: WorktreeView): string {
  if (worktree.branch) return worktree.branch;
  return worktree.head ? `detached @${worktree.head}` : "workspace";
}

/** A workspace may span several repos. Matching branch names are deliberately
 * grouped into one human context instead of exposing one git-worktree row per
 * directory. Primary checkouts also form one shared `main` context. */
function workspaceGroups(project: ProjectView): WorkspaceSummary[] {
  const groups = new Map<string, WorkspaceEntry[]>();
  for (const repo of project.repos) {
    for (const worktree of repo.worktrees) {
      const key = worktree.isMain ? "__primary__" : worktree.branch ?? worktree.path;
      groups.set(key, [...(groups.get(key) ?? []), { repo, worktree }]);
    }
  }
  return [...groups.entries()]
    .map(([key, entries]) => {
      const services = entries.flatMap((entry) => entry.worktree.services);
      return {
        id: key,
        label: key === "__primary__" ? entries[0]?.worktree.branch ?? "main" : workspaceLabel(entries[0].worktree),
        entries,
        services,
        liveCount: services.filter((service) => service.status === "running" || service.status === "starting").length,
        isPrimary: key === "__primary__",
      };
    })
    .sort((a, b) => b.liveCount - a.liveCount || Number(b.isPrimary) - Number(a.isPrimary) || a.label.localeCompare(b.label));
}

function runTouchesWorkspace(run: AgentRun, workspace: WorkspaceSummary): boolean {
  return run.workspacePaths.some((path) =>
    workspace.entries.some(({ worktree }) => path === worktree.path || path.startsWith(`${worktree.path}/`) || worktree.path.startsWith(`${path}/`)),
  );
}

function LaunchHeader({
  view,
  project,
  projectCount,
  activeCount,
  attentionCount,
  filter,
  compact,
  onFilter,
  onActive,
  onHome,
  onAttention,
  onPorts,
  onUnowned,
  onCommand,
  onAddProject,
}: {
  view: DashboardView;
  project?: ProjectView;
  projectCount: number;
  activeCount: number;
  attentionCount: number;
  filter: string;
  compact: boolean;
  onFilter: (value: string) => void;
  onActive: () => void;
  onHome: () => void;
  onAttention: () => void;
  onPorts: () => void;
  onUnowned: () => void;
  onCommand: () => void;
  onAddProject: () => void;
}) {
  const atHome = view.kind === "home";
  const searchRef = useRef<HTMLInputElement>(null);
  const shortcutLabel = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable='true']");
      const commandSearch = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const quickFilter = event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!commandSearch && !quickFilter) return;
      event.preventDefault();
      if (commandSearch) {
        onCommand();
        return;
      }
      if (!atHome) onHome();
      window.requestAnimationFrame(() => searchRef.current?.focus());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [atHome, onCommand, onHome]);

  return (
    <header className="launch-header">
      <button type="button" className="launch-brand" onClick={onHome} aria-label="Now">
        <span className="launch-brand-mark"><Icon name="terminal" size={16} /></span>
        <span>devhub</span>
      </button>

      {view.kind === "project" && project ? (
        <div className="launch-crumb">
          <Icon name="chevron_right" size={16} />
          <ProjectMark project={project} small />
          <span>{project.name}</span>
        </div>
      ) : atHome ? (
        <label className="launch-search">
          <Icon name="search" size={18} />
          <input
            ref={searchRef}
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && onFilter("")}
            placeholder="Search projects, workspaces or :port"
            aria-label="Search projects, workspaces or ports"
          />
          {!filter && <kbd>/</kbd>}
          {filter && <button type="button" onClick={() => onFilter("")} aria-label="Clear search">×</button>}
        </label>
      ) : (
        <span className="launch-crumb launch-crumb-simple">
          {view.kind === "active" ? "Active work" : view.kind === "attention" ? "Attention" : view.kind === "ports" ? "Ports" : "Not in a project"}
        </span>
      )}

      <nav className="launch-nav" aria-label="DevHub views">
        {!compact && (
          <>
            <button type="button" className={atHome ? "is-current" : ""} onClick={onHome}>Now <span>{projectCount}</span></button>
            <button type="button" className={view.kind === "active" ? "is-current" : ""} onClick={onActive}>Running <span>{activeCount}</span></button>
            <button type="button" className={view.kind === "attention" ? "is-current attention" : attentionCount ? "attention" : ""} onClick={onAttention}>
              Attention {attentionCount > 0 && <span>{attentionCount}</span>}
            </button>
          </>
        )}
        <button type="button" className="launch-command" onClick={onCommand} aria-label={`Open commands, ${shortcutLabel}`}>
          <Icon name="search" size={15} /><span>Commands</span><kbd>{shortcutLabel}</kbd>
        </button>
        <MenuButton
          label="DevHub actions"
          icon="more_horiz"
          size="md"
          compact={compact}
          items={[
            { key: "projects", label: `Now · ${projectCount}`, icon: "view_list", onSelect: onHome },
            { key: "active", label: `Running · ${activeCount}`, icon: "bolt", onSelect: onActive },
            { key: "attention", label: `Attention · ${attentionCount}`, icon: "error", onSelect: onAttention },
            { key: "ports", label: "Ports", icon: "lan", divider: true, onSelect: onPorts },
            { key: "unowned", label: "Not in a project", icon: "folder_off", onSelect: onUnowned },
            { key: "add", label: "Add project", icon: "add", divider: true, onSelect: onAddProject },
          ]}
        />
      </nav>
    </header>
  );
}

function ProjectMark({ project, small = false }: { project: ProjectView; small?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [project.iconUrl]);
  const hash = [...project.name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const tone = hash % 5;
  const initials = project.name
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <span className={`project-mark mark-tone-${tone}${project.iconUrl && !imageFailed ? " has-artwork" : ""}${small ? " is-small" : ""}`} aria-hidden="true">
      {project.iconUrl && !imageFailed
        ? <img src={project.iconUrl} alt="" onError={() => setImageFailed(true)} />
        : initials || "•"}
    </span>
  );
}

function ProjectsHome({
  projects,
  devhub,
  now,
  compact,
  agentRuns,
  activity,
  serviceAnnouncements,
  totalProjects,
  query,
  neverStarted,
  onOpen,
  onOpenLogs,
  onAddProject,
  onEditProject,
  onClear,
}: {
  projects: ProjectView[];
  devhub: Devhub;
  now: number;
  compact: boolean;
  agentRuns: AgentRun[];
  activity: ActivityEvent[];
  serviceAnnouncements: ServiceAnnouncement[];
  totalProjects: number;
  query: string;
  neverStarted: NeverStarted[];
  onOpen: (id: string) => void;
  onOpenLogs: (id: string) => void;
  onAddProject: () => void;
  onEditProject: (id: string) => void;
  onClear: () => void;
}) {
  const needsYou = projects.filter((project) => {
    const runs = agentRuns.filter((run) => run.projectId === project.id);
    return project.alertCount > 0 || neverStarted.some((item) => item.projectId === project.id) || runs.some((run) => run.status === "waiting" || blockedCheck(run));
  });
  const needsYouIds = new Set(needsYou.map((project) => project.id));
  const remaining = projects
    .filter((project) => !needsYouIds.has(project.id))
    .sort((a, b) => b.runningCount - a.runningCount || a.name.localeCompare(b.name));
  const projectIds = new Set(projects.map((project) => project.id));
  const recentActivity = activity.filter((event) => projectIds.has(event.projectId));

  const row = (project: ProjectView) => (
    <ProjectTile
      key={project.id}
      project={project}
      devhub={devhub}
      now={now}
      compact={compact}
      agentRuns={agentRuns.filter((run) => run.projectId === project.id)}
      activity={activity.filter((event) => event.projectId === project.id)}
      serviceAnnouncements={serviceAnnouncements.filter((item) => item.projectId === project.id)}
      neverStarted={neverStarted.filter((item) => item.projectId === project.id).length}
      onOpen={() => onOpen(project.id)}
      onOpenLogs={onOpenLogs}
      onEdit={() => onEditProject(project.id)}
    />
  );

  return (
    <div className="projects-home" data-dh-pane="1">
      <div className="projects-intro">
        <div>
          <h1>Now</h1>
          <p>Start work, open a running page, or see what needs your decision.</p>
        </div>
        <Button variant="secondary" icon="add" onClick={onAddProject}>Add project</Button>
      </div>

      {projects.length > 0 ? (
        <div className="project-ledger">
          {query.trim() ? (
            <section className="project-ledger-section">
              <div className="ledger-heading"><h2>Search results</h2><span>{projects.length}</span></div>
              <div className="project-rows">{projects.map(row)}</div>
            </section>
          ) : (
            <>
              {needsYou.length > 0 && (
                <section className="project-ledger-section is-attention">
                  <div className="ledger-heading"><h2>Needs you</h2><span>{needsYou.length}</span></div>
                  <div className="project-rows">{needsYou.map(row)}</div>
                </section>
              )}
              <section className="project-ledger-section">
                <div className="ledger-heading"><h2>{needsYou.length ? "Running and ready" : "Projects"}</h2><span>{remaining.length}</span></div>
                <div className="project-rows">{remaining.map(row)}</div>
              </section>
              {recentActivity.length > 0 && (
                <section className="recent-activity" aria-labelledby="recent-activity-heading">
                  <div className="ledger-heading"><h2 id="recent-activity-heading">Recently changed</h2><span>{Math.min(recentActivity.length, 8)}</span></div>
                  <div className="activity-list">
                    {recentActivity.slice(0, 8).map((event) => {
                      const project = projects.find((item) => item.id === event.projectId);
                      return (
                        <button type="button" key={event.id} onClick={() => onOpen(event.projectId)}>
                          <span className={`activity-kind is-${event.kind}`}><Icon name={activityIcon(event.kind)} size={15} /></span>
                          <span><strong>{event.message}</strong><small>{project?.name ?? event.projectId}{event.workspacePath ? ` · ${tildify(event.workspacePath)}` : ""}</small></span>
                          <time dateTime={new Date(event.observedAt).toISOString()}>{dur(Math.max(0, now - event.observedAt))} ago</time>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      ) : totalProjects === 0 ? (
        <div className="launch-empty">
          <ProjectMark project={{ id: "new", name: "New", repos: [], looseServices: [], runningCount: 0, alertCount: 0 }} />
          <h2>No projects yet</h2>
          <p>When an agent registers a repository, it will appear here. You can also add one yourself.</p>
          <Button variant="primary" icon="add" onClick={onAddProject}>Add first project</Button>
        </div>
      ) : (
        <div className="launch-empty">
          <Icon name="search_off" size={32} />
          <h2>No matching project</h2>
          <p>{`Nothing matches “${query.trim()}”.`}</p>
          <Button variant="secondary" onClick={onClear}>Show all projects</Button>
        </div>
      )}
    </div>
  );
}

function ProjectTile({
  project,
  devhub,
  now,
  compact,
  agentRuns,
  activity,
  serviceAnnouncements,
  neverStarted,
  onOpen,
  onOpenLogs,
  onEdit,
}: {
  project: ProjectView;
  devhub: Devhub;
  now: number;
  compact: boolean;
  agentRuns: AgentRun[];
  activity: ActivityEvent[];
  serviceAnnouncements: ServiceAnnouncement[];
  neverStarted: number;
  onOpen: () => void;
  onOpenLogs: (id: string) => void;
  onEdit: () => void;
}) {
  const groups = workspaceGroups(project);
  const currentRun = focusedRun(agentRuns.filter((run) => run.status === "working" || run.status === "waiting"));
  const blocker = currentRun ? blockedCheck(currentRun) : undefined;
  const focus = (currentRun ? groups.find((group) => runTouchesWorkspace(currentRun, group)) : undefined) ?? groups.find((group) => group.liveCount > 0) ?? groups[0];
  const liveServices = focus?.services.filter((service) => service.status === "running" || service.status === "starting") ?? [];
  const announced = (currentRun ? serviceAnnouncements.filter((item) => item.runId === currentRun.id) : serviceAnnouncements)[0];
  const previewUrl = serviceAnnouncements.find((item) => item.status === "running")?.url ?? pageUrl(focus?.services ?? []);
  const problemCount = project.alertCount + neverStarted;
  const services = allServices(project);
  const primaryLaunchers = project.repos.flatMap((repo) =>
    repo.worktrees.filter((worktree) => worktree.isMain).slice(0, 1).flatMap((worktree) => worktree.services.filter((service) => service.launchable)),
  ).concat(project.looseServices.filter((service) => service.launchable));
  const projectBusy = devhub.pending.has(`project:${project.id}`) || services.some((service) => devhub.pending.has(service.id));
  const state = blocker || currentRun?.status === "waiting" || problemCount > 0 ? "attention" : currentRun?.status === "working" || project.runningCount > 0 ? "live" : "ready";
  const summary =
    blocker
      ? `${blocker.label}: ${blocker.detail || "Blocked"}`
      : currentRun?.task
      ? currentRun.task
      : state === "attention"
      ? `${problemCount} item${problemCount === 1 ? "" : "s"} need a look`
      : liveServices.length > 0
        ? `${liveServices.slice(0, 3).map((service) => service.displayName).join(", ")}${liveServices.length > 3 ? ` +${liveServices.length - 3}` : ""}`
        : groups.length > 0
          ? `${groups.length} workspace${groups.length === 1 ? "" : "s"} ready`
          : "Waiting for a workspace";
  const lastUpdate = currentRun?.updatedAt ?? activity[0]?.observedAt;
  const activityLabel = lastUpdate ? `Updated ${dur(Math.max(0, now - lastUpdate))} ago` : project.runningCount > 0 ? "Observed running now" : "Ready to start";
  const statusLabel = blocker
    ? "Blocked"
    : currentRun?.status === "waiting"
      ? "Waiting for you"
      : currentRun?.status === "working"
        ? "Agent working"
        : state === "live"
          ? "Running"
          : state === "attention"
            ? "Needs attention"
            : "Stopped";

  return (
    <article className={`project-row is-${state}`}>
      <button type="button" className="project-row-main" onClick={onOpen} aria-label={`Open ${project.name}`}>
        <ProjectMark project={project} small />
        <span className="project-row-identity">
          <strong>{project.name}</strong>
          <span><code>{focus?.label ?? "No workspace"}</code>{activityLabel}</span>
        </span>
        <span className="project-row-context">
          <strong>{summary}</strong>
          <span>
            {currentRun ? `Declared by ${currentRun.agent}` : announced ? `${announced.role} declared` : "No active agent declaration"}
            <b aria-hidden="true">/</b>
            {project.runningCount > 0 ? `${project.runningCount} observed running` : "No runtime observed"}
          </span>
        </span>
        <span className={`project-row-state is-${state}`}><i />{statusLabel}</span>
      </button>

      <div className="project-row-actions" aria-label={`Actions for ${project.name}`}>
        {previewUrl && <a className="project-row-action" href={previewUrl} target="_blank" rel="noreferrer"><Icon name="open_in_new" size={15} />Open page</a>}
        {liveServices[0] && <button type="button" className="project-row-action" onClick={() => onOpenLogs(liveServices[0].id)}><Icon name="terminal" size={15} />Logs</button>}
        {project.runningCount > 0 ? (
          <button type="button" className="project-row-action project-lifecycle is-stop" disabled={projectBusy} onClick={() => devhub.stopProject(project.id, services.map((service) => service.id))}>
            <Icon name={projectBusy ? "progress_activity" : "stop"} size={15} />Stop
          </button>
        ) : primaryLaunchers.length > 0 ? (
          <button type="button" className="project-row-action project-lifecycle is-start" disabled={projectBusy} onClick={() => devhub.startProject(project.id, primaryLaunchers.map((service) => service.id))}>
            <Icon name={projectBusy ? "progress_activity" : "play_arrow"} size={16} />Start
          </button>
        ) : (
          <button type="button" className="project-row-action" onClick={onOpen}>Set up</button>
        )}
        <MenuButton
          label={`Actions for ${project.name}`}
          compact={compact}
          items={[
            { key: "open", label: "Open project details", icon: "arrow_forward", onSelect: onOpen },
            { key: "folder", label: "Reveal source", icon: "folder_open", divider: true, onSelect: () => devhub.revealPath(project.repos[0]?.absPath ?? "") },
            { key: "settings", label: "Project settings", icon: "settings", onSelect: onEdit },
          ]}
        />
      </div>
    </article>
  );
}

function ActivePane({
  projects,
  agentRuns,
  now,
  onOpenProject,
}: {
  projects: ProjectView[];
  agentRuns: AgentRun[];
  now: number;
  onOpenProject: (id: string) => void;
}) {
  const present = agentRuns.filter((run) => run.status === "working" || run.status === "waiting");
  const handoffs = agentRuns.filter((run) => run.status === "done" || run.status === "failed");
  const projectsWithAgents = new Set(present.map((run) => run.projectId));
  const runtimeOnly = projects.filter((project) => project.runningCount > 0 && !projectsWithAgents.has(project.id));

  const runContext = (run: AgentRun) => {
    const project = projects.find((candidate) => candidate.id === run.projectId);
    const workspace = project ? workspaceGroups(project).find((group) => runTouchesWorkspace(run, group)) : undefined;
    return { project, workspace };
  };

  return (
    <div className="active-page" data-dh-pane="1">
      <div className="projects-intro active-intro">
        <div><h1>Active work</h1><p>Agent tasks first; software running without an agent follows.</p></div>
        <span className="active-total">{present.length} agent{present.length === 1 ? "" : "s"}</span>
      </div>

      {present.length === 0 && runtimeOnly.length === 0 ? (
        <div className="attention-clear"><span><Icon name="bedtime" size={22} /></span><div><h2>Everything is quiet</h2><p>No agent is working and no project runtime is active.</p></div></div>
      ) : (
        <>
          {present.length > 0 && (
            <section className="active-ledger">
              {present.map((run) => {
                const { project, workspace } = runContext(run);
                const blocker = blockedCheck(run);
                const readiness = readinessLabel(run);
                return (
                  <button type="button" key={run.id} className={`agent-run-row is-${blocker ? "blocked" : run.status}`} onClick={() => onOpenProject(run.projectId)}>
                    {project ? <ProjectMark project={project} /> : <span className="project-mark"><Icon name="smart_toy" size={18} /></span>}
                    <span className="agent-run-copy">
                      <span className="agent-run-context">{project?.name ?? run.projectId}<b>/</b>{workspace?.label ?? "workspace"}</span>
                      <strong>{run.task || "Agent working without a task description"}</strong>
                      <small>{blocker ? `${blocker.label}: ${blocker.detail || "Needs attention"}` : run.detail || `${run.agent} has been ${run.status} for ${dur(now - run.startedAt)}`}{readiness && !blocker ? ` · ${readiness}` : ""}</small>
                    </span>
                    <span className={`agent-run-state is-${blocker ? "blocked" : run.status}`}><i />{blocker ? "Blocked" : run.status === "waiting" ? "Waiting for you" : run.agent}</span>
                    <Icon name="chevron_right" size={18} />
                  </button>
                );
              })}
            </section>
          )}

          {runtimeOnly.length > 0 && (
            <section className="runtime-only">
              <div className="active-section-title"><h2>Running without an agent</h2><span>{runtimeOnly.length}</span></div>
              {runtimeOnly.map((project) => {
                const running = allServices(project).filter((service) => service.status === "running" || service.status === "starting");
                return (
                  <button type="button" key={project.id} onClick={() => onOpenProject(project.id)}>
                    <ProjectMark project={project} small />
                    <span><strong>{project.name}</strong><small>{running.slice(0, 4).map((service) => service.displayName).join(", ")}</small></span>
                    <b>{project.runningCount} running</b>
                    <Icon name="chevron_right" size={18} />
                  </button>
                );
              })}
            </section>
          )}
        </>
      )}

      {handoffs.length > 0 && (
        <section className="recent-handoffs">
          <div className="active-section-title"><h2>Recent handoffs</h2><span>{handoffs.length}</span></div>
          {handoffs.map((run) => {
            const { project, workspace } = runContext(run);
            return (
              <button type="button" key={run.id} onClick={() => onOpenProject(run.projectId)}>
                <Icon name={run.status === "done" ? "check_circle" : "error"} size={18} />
                <span><strong>{run.task || `${run.agent} finished`}</strong><small>{project?.name ?? run.projectId} / {workspace?.label ?? "workspace"}{run.detail ? ` · ${run.detail}` : ""}</small></span>
                <b className={run.status === "failed" ? "is-failed" : ""}>{run.status}</b>
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}

function LaunchProject({
  project,
  devhub,
  now,
  pushToast,
  connected,
  compact,
  canMoveUp,
  canMoveDown,
  onMove,
  reveal,
  neverStarted,
  openLogId,
  onOpenLogs,
  onEditProject,
  onEditLauncher,
  onBack,
  onPorts,
  agentRuns,
  portReservations,
  serviceAnnouncements,
}: {
  project: ProjectView;
  devhub: Devhub;
  now: number;
  pushToast: (t: Omit<ToastData, "id">) => void;
  connected: boolean;
  compact: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (dir: -1 | 1) => void;
  reveal: string | null;
  neverStarted: NeverStarted[];
  openLogId: string | null;
  onOpenLogs: (id: string) => void;
  onEditProject: (id: string) => void;
  onEditLauncher: (a: { projectId: string; repoPath: string; service: ServiceView }) => void;
  onBack: () => void;
  onPorts: () => void;
  agentRuns: AgentRun[];
  portReservations: PortReservation[];
  serviceAnnouncements: ServiceAnnouncement[];
}) {
  const groups = useMemo(() => workspaceGroups(project), [project]);
  const [selectedId, setSelectedId] = useState(() => groups[0]?.id ?? "");
  const [sourcesOpen, setSourcesOpen] = useState(false);

  useEffect(() => {
    if (reveal) {
      const owner = groups.find((group) => group.services.some((service) => service.id === reveal));
      if (owner) setSelectedId(owner.id);
    } else if (!groups.some((group) => group.id === selectedId)) {
      setSelectedId(groups[0]?.id ?? "");
    }
  }, [groups, reveal, selectedId]);

  useEffect(() => {
    const active = focusedRun(agentRuns.filter((run) => run.status === "working" || run.status === "waiting"));
    const owner = active ? groups.find((group) => runTouchesWorkspace(active, group)) : undefined;
    if (owner) setSelectedId(owner.id);
  }, [agentRuns, groups]);

  const selected = groups.find((group) => group.id === selectedId) ?? groups[0];
  const running = selected?.services.filter((service) => service.status === "running" || service.status === "starting") ?? [];
  const startable = selected?.services.filter((service) => service.launchable && service.status !== "running") ?? [];
  const allMemberIds = selected?.services.map((service) => service.id) ?? [];
  const busy = allMemberIds.some((id) => devhub.pending.has(id));
  const workspaceRuns = selected ? agentRuns.filter((run) => runTouchesWorkspace(run, selected)) : [];
  const workspaceRunIds = new Set(workspaceRuns.map((run) => run.id));
  const announcedServices = serviceAnnouncements.filter((item) => workspaceRunIds.has(item.runId));
  const reservedPorts = portReservations.filter((item) => workspaceRunIds.has(item.runId));
  const announcedPreview = announcedServices.find((item) => item.status === "running");
  const previewUrl = announcedPreview?.url ?? pageUrl(selected?.services ?? []);
  const currentRun = focusedRun(workspaceRuns);
  const currentBlocker = currentRun ? blockedCheck(currentRun) : undefined;
  const observedPorts = [...new Set(running.flatMap((service) => service.ports))].sort((a, b) => a - b);
  const declaredSummary = currentRun
    ? currentRun.task || `${currentRun.agent} is ${currentRun.status}`
    : announcedServices.length > 0
      ? `${announcedServices.length} service${announcedServices.length === 1 ? "" : "s"} announced`
      : "No active agent declaration";
  const observedSummary = running.length > 0
    ? `${running.length} runtime${running.length === 1 ? "" : "s"} verified${observedPorts.length ? ` on ${observedPorts.map((port) => `:${port}`).join(", ")}` : ""}`
    : "No runtime observed";

  return (
    <div className="project-focus" data-dh-pane="1">
      <div className="project-focus-topline">
        <button type="button" className="back-button" onClick={onBack}><Icon name="arrow_back" size={16} /> Projects</button>
        <div className="project-focus-identity">
          <ProjectMark project={project} small />
          <span>
            <strong>{project.name}</strong>
            <small>{project.repos.length} {project.repos.length === 1 ? "repository" : "repositories"}</small>
          </span>
        </div>
        <MenuButton
          label={`Actions for ${project.name}`}
          size="md"
          compact={compact}
          items={[
            { key: "edit", label: "Project settings", icon: "settings", onSelect: () => onEditProject(project.id) },
            { key: "ports", label: "View ports", icon: "lan", onSelect: onPorts },
            { key: "reveal", label: "Reveal primary source", icon: "folder_open", onSelect: () => devhub.revealPath(project.repos[0]?.path ?? "") },
            ...(canMoveUp ? [{ key: "up", label: "Move project up", icon: "arrow_upward", divider: true, onSelect: () => onMove(-1) }] : []),
            ...(canMoveDown ? [{ key: "down", label: "Move project down", icon: "arrow_downward", divider: !canMoveUp, onSelect: () => onMove(1) }] : []),
          ]}
        />
      </div>

      <div className="workspace-picker" role="tablist" aria-label={`${project.name} workspaces`}>
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            role="tab"
            aria-selected={group.id === selected?.id}
            className={group.id === selected?.id ? "is-selected" : ""}
            onClick={() => setSelectedId(group.id)}
          >
            <StatusDot status={group.liveCount > 0 ? "running" : "stopped"} size={6} />
            <span>{group.label}</span>
            {group.liveCount > 0 && <b>{group.liveCount}</b>}
          </button>
        ))}
      </div>

      {selected ? (
        <>
          <section className="workspace-hero">
            <div className="workspace-primary">
              <div className="workspace-hero-copy">
                <span className={`workspace-kicker ${!currentBlocker && (currentRun?.status === "working" || running.length) ? "is-live" : ""} ${currentBlocker || currentRun?.status === "waiting" ? "is-waiting" : ""}`}>
                  <span />
                  {currentRun
                    ? `${currentRun.agent} · ${currentBlocker ? "blocked" : currentRun.status === "waiting" ? "waiting for you" : currentRun.status}`
                    : running.length
                      ? "Workspace live"
                      : "Workspace ready"}
                </span>
                <h1>{selected.label}</h1>
                <p>
                  {currentRun?.task
                    ? currentRun.task
                    : running.length
                    ? `${running.map((service) => service.displayName).join(", ")} ${running.length === 1 ? "is" : "are"} running.`
                    : startable.length
                      ? `${startable.length} launcher${startable.length === 1 ? " is" : "s are"} ready to start.`
                      : "Nothing is running and no launcher has been declared."}
                </p>
                {currentRun?.detail && <p className="agent-detail">{currentRun.detail}</p>}
                <div className="workspace-paths">
                  {selected.entries.map(({ repo, worktree }) => <span key={worktree.path}>{repo.label} <b>{tildify(worktree.path)}</b></span>)}
                </div>
              </div>
              <div className="workspace-actions">
                {running.length > 0 ? (
                  <Button
                    variant="secondary"
                    icon="stop"
                    loading={busy}
                    onClick={() => selected.entries.forEach((entry) => devhub.stopWorktree(entry.worktree.path, entry.worktree.services.map((service) => service.id)))}
                  >
                    Stop workspace
                  </Button>
                ) : startable.length > 0 ? (
                  <Button
                    variant="primary"
                    icon="play_arrow"
                    loading={busy}
                    onClick={() => selected.entries.forEach((entry) => devhub.startWorktree(entry.worktree.path, entry.worktree.services.map((service) => service.id)))}
                  >
                    Start workspace
                  </Button>
                ) : null}
                {previewUrl && <Button variant="secondary" icon="open_in_new" onClick={() => window.open(previewUrl, "_blank")}>Open page</Button>}
                {running[0] && <Button variant="secondary" icon="terminal" onClick={() => onOpenLogs(running[0].id)}>View logs</Button>}
                <Button
                  variant="ghost"
                  icon="folder_open"
                  onClick={() => selected.entries.forEach((entry) => devhub.revealPath(entry.worktree.path))}
                >
                  Open folder{selected.entries.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
            <aside className="workspace-evidence" aria-label="Declared and observed workspace state">
              <div className="evidence-heading"><span>Evidence</span><small>{connected ? "Live" : "Last known"}</small></div>
              <div className="evidence-claim is-declared">
                <span><i />Declared</span>
                <strong>{declaredSummary}</strong>
                <small>{currentRun ? `${currentRun.agent} · updated ${dur(Math.max(0, now - currentRun.updatedAt))} ago` : "Agent and configuration intent"}</small>
              </div>
              <div className="evidence-claim is-observed">
                <span><i />Observed</span>
                <strong>{observedSummary}</strong>
                <small>{connected ? "Verified from this machine" : "Observation paused while disconnected"}</small>
              </div>
              {currentBlocker && <div className="evidence-mismatch"><Icon name="priority_high" size={15} /><span>{currentBlocker.detail || currentBlocker.label}</span></div>}
            </aside>
          </section>

          {(announcedServices.length > 0 || reservedPorts.length > 0) && (
            <section className="agent-intent" aria-label="Agent-declared runtime intent">
              <div className="agent-intent-heading">
                <span><Icon name="smart_toy" size={16} /> Agent intent</span>
                <small>Verified separately against local listeners</small>
              </div>
              <div className="agent-intent-items">
                {announcedServices.map((item) => (
                  <div key={item.id} className={`agent-intent-item is-${item.status}`}>
                    <span className="intent-state"><i />{item.status === "running" ? "Observed running" : "Announced"}</span>
                    <strong>{item.role}</strong>
                    <code>{item.url}</code>
                    {item.status === "running" && <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.role}`}><Icon name="open_in_new" size={15} /></a>}
                  </div>
                ))}
                {reservedPorts.filter((reservation) => !announcedServices.some((item) => item.runId === reservation.runId && item.role === reservation.role)).map((item) => (
                  <div key={item.id} className="agent-intent-item is-reserved">
                    <span className="intent-state"><i />Reserved</span>
                    <strong>{item.role}</strong>
                    <code>:{item.port}</code>
                  </div>
                ))}
              </div>
            </section>
          )}

          {currentRun && runChecks(currentRun).length > 0 && (
            <section className="workspace-readiness" aria-label="Workspace readiness">
              <div className="readiness-heading">
                <div><span>Workspace readiness</span><small>Reported by {currentRun.agent}</small></div>
                <b>{readinessLabel(currentRun)}</b>
              </div>
              <div className="readiness-grid">
                {runChecks(currentRun).map((check) => (
                  <div key={check.key} className={`readiness-check is-${check.status}`}>
                    <span><Icon name={check.status === "ready" ? "check" : check.status === "blocked" ? "priority_high" : "more_horiz"} size={14} /></span>
                    <div><strong>{check.label}</strong><small>{check.detail || (check.status === "ready" ? "Ready" : check.status === "blocked" ? "Needs attention" : "In progress")}</small></div>
                    <b>{check.status}</b>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="focus-section">
            <div className="focus-section-heading">
              <h2>Runtime</h2>
              <span>{running.length ? `${running.length} running` : `${selected.services.length} available`}</span>
            </div>
            <div className="runtime-list">
              {selected.entries.flatMap(({ repo, worktree }) =>
                worktree.services.map((service) => (
                  <ServiceRow
                    key={service.id}
                    service={service}
                    projectId={project.id}
                    repoPath={repo.path}
                    devhub={devhub}
                    now={now}
                    pushToast={pushToast}
                    compact={compact}
                    open={openLogId === service.id}
                    revealed={reveal === service.id}
                    onOpenLogs={onOpenLogs}
                    onEditLauncher={onEditLauncher}
                  />
                )),
              )}
              {selected.services.length === 0 && <div className="runtime-empty">An agent can announce a runtime here when it starts one.</div>}
            </div>
          </section>

          {selected.entries.flatMap((entry) => entry.repo.orphans).length > 0 && (
            <OrphanSections orphans={selected.entries.flatMap((entry) => entry.repo.orphans)} onKill={devhub.killOrphan} pending={devhub.pending} />
          )}
        </>
      ) : (
        <div className="launch-empty compact-empty">
          <Icon name="workspaces" size={32} />
          <h2>No workspace found</h2>
          <p>Add a source directory or let an agent register one for this project.</p>
          <Button variant="secondary" icon="settings" onClick={() => onEditProject(project.id)}>Project settings</Button>
        </div>
      )}

      {neverStarted.length > 0 && <NeverStartedSection items={neverStarted} devhub={devhub} reveal={reveal} />}

      <section className="sources-disclosure">
        <button type="button" onClick={() => setSourcesOpen((open) => !open)} aria-expanded={sourcesOpen}>
          <span><Icon name="folder_copy" size={17} /> Sources</span>
          <span>{project.repos.length} {project.repos.length === 1 ? "repository" : "repositories"} <Icon name={sourcesOpen ? "expand_less" : "expand_more"} size={17} /></span>
        </button>
        {sourcesOpen && (
          <div>
            {project.repos.map((repo) => (
              <button type="button" key={repo.path} onClick={() => devhub.revealPath(repo.path)}>
                <ProjectMark project={{ ...project, name: repo.label }} small />
                <span><strong>{repo.label}</strong><small>{repo.path}</small></span>
                <Icon name="folder_open" size={16} />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AttentionPane({
  alerts,
  blockedRuns,
  unowned,
  neverStarted,
  onReveal,
  onOpenProject,
  onOpenUnowned,
}: {
  alerts: Alert[];
  blockedRuns: AgentRun[];
  unowned: Orphan[];
  neverStarted: NeverStarted[];
  onReveal: (projectId: string | null, targetId: string | null) => void;
  onOpenProject: (id: string) => void;
  onOpenUnowned: () => void;
}) {
  const total = alerts.length + unowned.length + blockedRuns.length;
  return (
    <div className="attention-page" data-dh-pane="1">
      <div className="projects-intro">
        <div><h1>Attention</h1><p>Only conditions that may block work or need cleanup.</p></div>
      </div>
      {total === 0 && neverStarted.length === 0 ? (
        <div className="attention-clear"><span><Icon name="check" size={22} /></span><div><h2>Nothing needs you</h2><p>Projects and workspaces are in a healthy state.</p></div></div>
      ) : (
        <div className="attention-list">
          {blockedRuns.map((run) => {
            const check = blockedCheck(run)!;
            return (
              <button type="button" key={`${run.id}:${check.key}`} onClick={() => onOpenProject(run.projectId)}>
                <span className="attention-icon"><Icon name="smart_toy" size={18} /></span>
                <span><strong>{check.label}: {check.detail || "Agent reported a blocker"}</strong><small>{run.agent} · {run.task || run.projectId}</small></span>
                <Icon name="chevron_right" size={18} />
              </button>
            );
          })}
          {alerts.map((alert) => (
            <button type="button" key={alert.id} onClick={() => onReveal(alert.projectId, alert.targetId)}>
              <span className="attention-icon"><Icon name={alert.kind === "collision" ? "compare_arrows" : "warning"} size={18} /></span>
              <span><strong>{alert.message}</strong><small>{alert.kind === "collision" ? "Resolve the conflicting runtime" : "Open the affected workspace"}</small></span>
              <Icon name="chevron_right" size={18} />
            </button>
          ))}
          {unowned.map((orphan) => (
            <button type="button" key={orphan.id} onClick={onOpenUnowned}>
              <span className="attention-icon"><Icon name="folder_off" size={18} /></span>
              <span><strong>{orphan.label}</strong><small>Running outside a known project</small></span>
              <Icon name="chevron_right" size={18} />
            </button>
          ))}
          {neverStarted.length > 0 && (
            <button type="button" onClick={() => neverStarted[0]?.projectId && onOpenProject(neverStarted[0].projectId)}>
              <span className="attention-icon is-muted"><Icon name="deployed_code" size={18} /></span>
              <span><strong>{neverStarted.length} container{neverStarted.length === 1 ? "" : "s"} never started</strong><small>Review or remove inactive container attempts</small></span>
              <Icon name="chevron_right" size={18} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- rail

interface RailProps {
  projects: ProjectView[];
  totalProjects: number;
  alerts: Alert[];
  ports: PortRow[];
  unowned: Orphan[];
  neverStarted: NeverStarted[];
  selection: Selection;
  selectedId: string | null;
  filter: string;
  onFilter: (v: string) => void;
  onSelect: (s: Selection) => void;
  onAddProject: () => void;
  onRevealAlert: (projectId: string | null, targetId: string | null) => void;
}

/** The per-project state line. The design called for "6 up · 2 orphans"; the
 *  rail was instead spending its one subtitle on the repo paths, which
 *  truncate to uselessness on the only project that has two of them and are a
 *  constant you learn in a day. Clauses are omitted rather than printed as 0. */
function stateLine(p: ProjectView, neverStarted: NeverStarted[]): string {
  const parts = [`${p.runningCount} up`];
  if (p.alertCount > 0) parts.push(`${p.alertCount} alert${p.alertCount === 1 ? "" : "s"}`);
  const never = neverStarted.filter((n) => n.projectId === p.id).length;
  if (never > 0) parts.push(`${never} never started`);
  return parts.join(" · ");
}

function Rail({
  projects,
  totalProjects,
  alerts,
  ports,
  unowned,
  neverStarted,
  selection,
  selectedId,
  filter,
  onFilter,
  onSelect,
  onAddProject,
  onRevealAlert,
}: RailProps) {
  return (
    <aside
      style={{
        width: RAIL_W,
        flex: "0 0 auto",
        borderRight: "1px solid var(--dh-border-hairline)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div style={{ padding: "18px 16px 12px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ font: "var(--type-section-title)", letterSpacing: "var(--tracking-section-title)", color: "var(--dh-text)" }}>
          dev<span style={{ background: "var(--dh-accent)", color: "var(--dh-on-accent)", borderRadius: 999, padding: "2px 7px", marginLeft: 2 }}>hub</span>
        </span>
        <span style={{ flex: 1 }} />
        <span data-tabular style={{ font: "var(--type-meta-text)", color: "var(--dh-text-secondary)" }}>
          {filter.trim() ? `${projects.length}/${totalProjects}` : totalProjects}
        </span>
        <IconButton icon="add" label="Add project" size="sm" onClick={onAddProject} />
      </div>

      <div style={{ padding: "0 16px 12px", position: "relative" }}>
        <input
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onFilter("");
          }}
          // Placeholder text is not an accessible name, and it disappears the
          // moment you type.
          aria-label="Filter projects, services and ports"
          placeholder="filter · name or :port"
          spellCheck={false}
          style={{
            width: "100%",
            background: "var(--dh-bg-input)",
            border: "1px solid var(--dh-border-control)",
            borderRadius: 9,
            padding: "9px 28px 9px 11px",
            color: "var(--dh-text)",
            font: "var(--type-body-text)",
          }}
        />
        {filter !== "" && (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => onFilter("")}
            style={{
              position: "absolute",
              right: 22,
              top: "50%",
              transform: "translateY(-50%)",
              width: 18,
              height: 18,
              display: "grid",
              placeItems: "center",
              border: "none",
              borderRadius: 5,
              background: "transparent",
              color: "var(--dh-text-secondary)",
              font: "var(--type-control)",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Directly under the filter, where reading starts — not pinned to the
          bottom of the rail behind ~300px of empty space put there by a flex
          spacer. This is the answer to "what is broken", which is the whole
          reason the app exists. */}
      <AlertsPanel alerts={alerts} onReveal={onRevealAlert} />

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
        {projects.map((p) => (
          <RailRow
            key={p.id}
            active={selection.kind === "project" && selectedId === p.id}
            onClick={() => onSelect({ kind: "project", id: p.id })}
            title={p.name}
            subtitle={stateLine(p, neverStarted)}
            titleAttr={p.repos.map((r) => r.label ?? r.path).join(" · ") || "no repos yet"}
            right={
              p.alertCount > 0 ? (
                <span data-tabular style={{ font: "var(--type-meta-text)", color: "var(--dh-alert-text)" }}>⚠ {p.alertCount}</span>
              ) : null
            }
            dot={p.runningCount ? "running" : "stopped"}
          />
        ))}

        <div style={{ height: 1, background: "var(--dh-border-hairline)", margin: "10px 6px" }} />

        <RailRow
          active={selection.kind === "ports"}
          onClick={() => onSelect({ kind: "ports" })}
          title="ports"
          subtitle="what holds what, right now"
          right={<span data-tabular style={{ font: "var(--type-meta-text)", color: "var(--dh-text-secondary)" }}>{ports.length}</span>}
        />
        {unowned.length > 0 && (
          <RailRow
            active={selection.kind === "unowned"}
            onClick={() => onSelect({ kind: "unowned" })}
            title="not in any repo"
            subtitle="running, unattributed"
            right={<span data-tabular style={{ font: "var(--type-meta-text)", color: "var(--dh-text-secondary)" }}>{unowned.length}</span>}
          />
        )}
      </div>

    </aside>
  );
}

/** Below 700px the rail used to unmount outright, taking the project
 *  switcher, the filter, "add project", the ports view and the alerts panel
 *  with it — whatever project happened to be selected became the only project
 *  that existed. And because the breakpoint is measured in CSS pixels, it was
 *  reached by zooming to 200% on an ordinary window, so zooming in to read
 *  something deleted the navigation.
 *
 *  This keeps all of it reachable in a 44px bar: the project name opens the
 *  rail's own rows as a menu, and the alert count opens the alerts list. */
function CompactBar({ projects, totalProjects, alerts, ports, unowned, neverStarted, selection, selectedId, onSelect, onAddProject, onRevealAlert }: RailProps) {
  const [showAlerts, setShowAlerts] = useState(false);
  const current =
    selection.kind === "ports" ? "ports" : selection.kind === "unowned" ? "not in any repo" : projects.find((p) => p.id === selectedId)?.name ?? "devhub";

  const items: MenuButtonItem[] = [
    ...projects.map((p) => ({
      key: p.id,
      label: `${p.name} · ${stateLine(p, neverStarted)}`,
      icon: "folder",
      onSelect: () => onSelect({ kind: "project", id: p.id }),
    })),
    { key: "ports", label: `Ports · ${ports.length}`, icon: "lan", divider: true, onSelect: () => onSelect({ kind: "ports" }) },
    ...(unowned.length
      ? [{ key: "unowned", label: `Not in any repo · ${unowned.length}`, icon: "help", onSelect: () => onSelect({ kind: "unowned" }) }]
      : []),
    { key: "add", label: "Add a project", icon: "add", divider: true, onSelect: onAddProject },
  ];

  return (
    <>
      <div
        style={{
          flex: "0 0 auto",
          minHeight: 44,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          borderBottom: "1px solid var(--dh-border-hairline)",
          background: "var(--dh-bg-rail)",
        }}
      >
        <span style={{ font: "var(--type-row-title)", color: "var(--dh-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current}
        </span>
        <MenuButton label={`Switch project (${totalProjects})`} icon="unfold_more" size="md" items={items} compact />
        <span style={{ flex: 1 }} />
        {alerts.length > 0 && (
          <button
            type="button"
            onClick={() => setShowAlerts((v) => !v)}
            style={{
              minHeight: 32,
              padding: "0 10px",
              borderRadius: 8,
              border: "1px solid var(--dh-flag-border)",
              background: "var(--dh-flag-bg)",
              color: "var(--dh-alert-text)",
              font: "var(--type-control)",
              cursor: "pointer",
            }}
          >
            ⚠ {alerts.length}
          </button>
        )}
      </div>
      {showAlerts && alerts.length > 0 && (
        <div style={{ flex: "0 0 auto", maxHeight: 220, overflowY: "auto", borderBottom: "1px solid var(--dh-border-hairline)" }}>
          <AlertsPanel
            alerts={alerts}
            onReveal={(pid, tid) => {
              setShowAlerts(false);
              onRevealAlert(pid, tid);
            }}
          />
        </div>
      )}
    </>
  );
}

function RailRow({
  active,
  onClick,
  title,
  subtitle,
  titleAttr,
  right,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  titleAttr?: string;
  right?: ReactNode;
  dot?: "running" | "stopped";
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={titleAttr}
      // The rail answers "which project am I looking at", so selected state
      // stays stronger than the transient hover treatment.
      aria-current={active ? "true" : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: "10px 11px",
        borderRadius: 9,
        borderTop: "1px solid transparent",
        borderRight: "1px solid transparent",
        borderBottom: "1px solid transparent",
        borderLeft: `2px solid ${active ? "var(--dh-accent)" : "transparent"}`,
        background: active ? "var(--dh-bg-row-selected)" : hover ? "var(--dh-bg-hover)" : "transparent",
        cursor: "pointer",
      }}
    >
      {dot && <StatusDot status={dot} size={7} />}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ font: "var(--type-row-title)", color: "var(--dh-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <span style={{ font: "var(--type-meta-text)", color: "var(--dh-text-host)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {subtitle}
        </span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>{right}</span>
    </button>
  );
}

function AlertsPanel({ alerts, onReveal }: { alerts: Alert[]; onReveal: (projectId: string | null, targetId: string | null) => void }) {
  // Collapsed by default past three, so a noisy day cannot push the project
  // list out of the rail.
  const [open, setOpen] = useState(alerts.length <= 3);
  if (alerts.length === 0) {
    return (
      <div style={{ borderBottom: "1px solid var(--dh-border-hairline)", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
        <StatusDot status="running" size={6} />
        <span style={{ font: "var(--type-meta-text)", color: "var(--dh-text-secondary)" }}>Nothing to flag</span>
      </div>
    );
  }
  return (
    <div style={{ borderBottom: "1px solid var(--dh-border-hairline)", display: "flex", flexDirection: "column", minHeight: 0, maxHeight: 240 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          font: "var(--type-control)",
          color: "var(--dh-text-tertiary)",
        }}
      >
        Alerts · {alerts.length}
        <span style={{ flex: 1 }} />
        <Icon name={open ? "expand_more" : "chevron_right"} size={14} />
      </button>
      {open && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
          {alerts.map((a) => (
            // A button, not a div. Every alert already carries the id of the
            // row it is about; rendering only the message made it a
            // notification you had to re-find by hand, which is how the
            // previous alert panel died.
            <button
              key={a.id}
              type="button"
              onClick={() => onReveal(a.projectId, a.targetId)}
              style={{
                display: "flex",
                gap: 9,
                width: "100%",
                textAlign: "left",
                padding: "10px 11px",
                borderRadius: 9,
                background: "var(--dh-flag-bg)",
                border: "1px solid var(--dh-flag-border)",
                cursor: a.targetId || a.projectId ? "pointer" : "default",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  marginTop: 5,
                  flex: "0 0 auto",
                  background: a.kind === "collision" ? "var(--dh-status-starting)" : "var(--dh-status-crashed)",
                }}
              />
              <span style={{ font: "var(--type-meta-text)", color: "var(--dh-alert-text)" }}>{a.message}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- project

function ProjectPane({
  project,
  devhub,
  now,
  pushToast,
  connected,
  canMoveUp,
  canMoveDown,
  onMove,
  reveal,
  neverStarted,
  openLogId,
  onOpenLogs,
  onEditProject,
  onEditLauncher,
}: {
  project: ProjectView;
  devhub: Devhub;
  now: number;
  pushToast: (t: Omit<ToastData, "id">) => void;
  connected: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (dir: -1 | 1) => void;
  reveal: string | null;
  neverStarted: NeverStarted[];
  openLogId: string | null;
  onOpenLogs: (id: string) => void;
  onEditProject: (id: string) => void;
  onEditLauncher: (a: { projectId: string; repoPath: string; service: ServiceView }) => void;
}) {
  // The repo tier only earns a header when a project actually spans more
  // than one repo. Collapsing it away is what removes the old
  // "NOTQA / ↳ MAIN" double header for every single-repo project.
  const showRepoTier = project.repos.length > 1;

  return (
    <>
      <header
        style={{
          flex: "0 0 auto",
          padding: "20px 26px 16px",
          borderBottom: "1px solid var(--dh-border-hairline)",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ font: "var(--type-page-title)", letterSpacing: "var(--tracking-page-title)", color: "var(--dh-text)" }}>{project.name}</span>
          <span
            title={project.repos.map((r) => r.path).join("  ·  ")}
            style={{
              font: "400 var(--type-meta)/1 var(--font-mono)",
              color: "var(--dh-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {project.repos.map((r) => r.path).join("  ·  ") || "no repos yet"}
          </span>
        </div>
        <span data-tabular style={{ font: "var(--type-meta-text)", color: project.runningCount ? "var(--dh-status-running)" : "var(--dh-text-secondary)" }}>
          {project.runningCount} up
        </span>
        <MenuButton
          label={`${project.name} actions`}
          size="md"
          items={[
            { key: "edit", label: "Project settings", icon: "settings", onSelect: () => onEditProject(project.id) },
            { key: "reveal", label: "Reveal in Finder", icon: "folder_open", onSelect: () => devhub.revealPath(project.repos[0]?.path ?? "") },
            ...(canMoveUp ? [{ key: "up", label: "Move up", icon: "arrow_upward", divider: true, onSelect: () => onMove(-1) }] : []),
            ...(canMoveDown ? [{ key: "down", label: "Move down", icon: "arrow_downward", divider: !canMoveUp, onSelect: () => onMove(1) }] : []),
          ]}
        />
      </header>

      {/* Left-aligned max width: at 2560px the service name sat at x≈300 and
          the button acting on it at x≈2400. */}
      <div
        data-dh-pane="1"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "18px 26px 40px",
          display: "flex",
          flexDirection: "column",
          gap: 26,
          maxWidth: 1180,
          width: "100%",
        }}
      >
        {project.repos.length === 0 && (
          <EmptyState
            title="No repositories yet"
            description="Add a repository and DevHub will find its worktrees and running services."
            action={<Button variant="secondary" icon="add" onClick={() => onEditProject(project.id)}>Add a repository</Button>}
          />
        )}

        {project.repos.map((repo) => (
          <RepoSection
            key={repo.path}
            project={project}
            repo={repo}
            showHeader={showRepoTier}
            devhub={devhub}
            now={now}
            pushToast={pushToast}
            reveal={reveal}
            openLogId={openLogId}
            onOpenLogs={onOpenLogs}
            onEditLauncher={onEditLauncher}
          />
        ))}

        {neverStarted.length > 0 && <NeverStartedSection items={neverStarted} devhub={devhub} reveal={reveal} />}

        {project.looseServices.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SectionLabel>one-offs outside every repo</SectionLabel>
            {project.looseServices.map((s) => (
              <ServiceRow
                key={s.id}
                service={s}
                projectId={project.id}
                repoPath=""
                devhub={devhub}
                now={now}
                pushToast={pushToast}
                open={openLogId === s.id}
                revealed={reveal === s.id}
                onOpenLogs={onOpenLogs}
                onEditLauncher={onEditLauncher}
              />
            ))}
          </section>
        )}
      </div>
    </>
  );
}

/** Two-step confirm for an irreversible action, inline in the row it belongs
 *  to. Used where there is nothing to undo afterwards. */
function ConfirmButton({
  label,
  confirmLabel,
  icon,
  loading,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  icon: string;
  loading?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <Button
      variant={armed ? "danger" : "ghost"}
      size="sm"
      icon={icon}
      loading={loading}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

/** Every container that has never run, in one place with one count.
 *
 *  This replaces two surfaces that reported the same predicate by different
 *  names: a red "was created but never started" alert when the worktree still
 *  existed, and a grey "LEFT OVER FROM DELETED WORKTREES" list when it didn't.
 *  Two names, two weights, two counts, and no surface showed the total. The
 *  state is now a column inside one section, and each row carries the action
 *  that actually applies to it. */
function NeverStartedSection({ items, devhub, reveal }: { items: NeverStarted[]; devhub: Devhub; reveal: string | null }) {
  const [open, setOpen] = useState(false);
  const actionable = items.filter((n) => n.action === "start").length;

  return (
    <section className="inactive-containers">
      <button type="button" className="inactive-heading" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span><Icon name="deployed_code" size={17} /><strong>Inactive containers</strong><small>{items.length} never started</small></span>
        <span>{actionable > 0 && <b>{actionable} startable</b>}<Icon name={open ? "expand_less" : "expand_more"} size={17} /></span>
      </button>

      {open && <div className="inactive-list">
        {items.map((n) => (
          <div key={n.targetId} className={`inactive-row ${reveal === n.targetId ? "is-revealed" : ""}`}>
            <span className="inactive-row-icon"><Icon name="deployed_code" size={16} /></span>
            <span className="inactive-row-copy">
              <strong title={n.container}>{n.composeService ?? n.container}</strong>
              <small>{n.worktreeLabel
                ? `${n.worktreeLabel} · ${n.state === "created" ? "created, never ran" : `exited ${n.exitCode ?? ""}`.trim()}`
                : `${n.composeProject ?? n.container} · worktree deleted, safe to remove`}</small>
            </span>
            <span className="inactive-row-state">Never started</span>
            {n.action === "start" ? (
              <Button variant="secondary" size="sm" icon="play_arrow" loading={devhub.pending.has(n.targetId)} onClick={() => devhub.start(n.targetId)}>
                Start
              </Button>
            ) : (
              <ConfirmButton
                label="Remove"
                confirmLabel="Remove for good?"
                icon="delete"
                loading={devhub.pending.has(n.targetId)}
                onConfirm={() => devhub.removeContainer(n.targetId, n.container)}
              />
            )}
          </div>
        ))}
      </div>}
    </section>
  );
}

function RepoSection({
  project,
  repo,
  showHeader,
  devhub,
  now,
  pushToast,
  reveal,
  openLogId,
  onOpenLogs,
  onEditLauncher,
}: {
  project: ProjectView;
  repo: RepoView;
  showHeader: boolean;
  devhub: Devhub;
  now: number;
  pushToast: (t: Omit<ToastData, "id">) => void;
  reveal: string | null;
  openLogId: string | null;
  onOpenLogs: (id: string) => void;
  onEditLauncher: (a: { projectId: string; repoPath: string; service: ServiceView }) => void;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {showHeader && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ font: "var(--type-row-title)", color: "var(--dh-text)", flex: "0 0 auto" }}>{repo.label}</span>
          <span
            title={repo.path}
            style={{
              font: "var(--type-code)",
              color: "var(--dh-text-secondary)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {repo.path}
          </span>
          <span style={{ flex: 1, height: 1, background: "var(--dh-border-hairline)" }} />
        </div>
      )}

      {repo.missing && (
        <Banner tone="red">
          {repo.path} isn't on disk. Its launchers are kept, but nothing can run until the path exists again.
        </Banner>
      )}

      <OrphanSections orphans={repo.orphans} onKill={devhub.killOrphan} pending={devhub.pending} />

      {/* When the path is gone, git returns no worktrees and the store
          synthesises one covering the whole directory — which rendered a group
          literally labelled "worktree", full of inherited launchers with
          enabled start buttons, directly under a banner saying nothing can
          run. The banner is the truth; suppress the phantom. */}
      {!repo.missing &&
        repo.worktrees.map((wt) => (
          <div key={wt.path} style={{ paddingLeft: showHeader ? 12 : 0 }}>
            <WorktreeGroup
              worktree={wt}
              project={project}
              repo={repo}
              devhub={devhub}
              now={now}
              pushToast={pushToast}
              reveal={reveal}
              openLogId={openLogId}
              onOpenLogs={onOpenLogs}
              onEditLauncher={onEditLauncher}
            />
          </div>
        ))}
    </section>
  );
}

function WorktreeGroup({
  worktree,
  project,
  repo,
  devhub,
  now,
  pushToast,
  reveal,
  openLogId,
  onOpenLogs,
  onEditLauncher,
}: {
  worktree: WorktreeView;
  project: ProjectView;
  repo: RepoView;
  devhub: Devhub;
  now: number;
  pushToast: (t: Omit<ToastData, "id">) => void;
  reveal: string | null;
  openLogId: string | null;
  onOpenLogs: (id: string) => void;
  onEditLauncher: (a: { projectId: string; repoPath: string; service: ServiceView }) => void;
}) {
  const live = worktree.services.filter((s) => s.status === "running" || s.status === "starting").length;
  const key = `wt:${worktree.path}`;
  const collapsedByPref = devhub.prefs.collapsed.includes(key);
  // An idle worktree collapses to a single line, and "idle" means nothing is
  // RUNNING — not "nothing is declared". Every worktree inherits its repo's
  // launchers, so once a repo declares anything, every one of its seven
  // feature branches has rows; keying the default on row count would expand
  // all of them and bury the branch actually being worked on.
  // Collapse state persists through `setPrefs` rather than local state. It
  // used to be a component-local `override`, and `ProjectPane` is mounted with
  // `key={project.id}` — so switching project and back remounted this and
  // discarded every expansion you had made.
  const open = collapsedByPref ? false : live > 0 || devhub.prefs.collapsed.includes(`open:${key}`);
  const toggle = () =>
    devhub.setPrefs((prev) => {
      const set = new Set(prev.collapsed);
      // Two keys, because the default itself depends on `live`: `wt:` forces
      // closed, `open:wt:` forces open.
      set.delete(key);
      set.delete(`open:${key}`);
      if (open) set.add(key);
      else set.add(`open:${key}`);
      return { ...prev, collapsed: [...set] };
    });

  const label = worktree.branch ?? (worktree.head ? `detached @${worktree.head}` : "worktree");
  const startable = worktree.services.filter((s) => s.launchable && s.status !== "running");
  const stoppable = worktree.services.filter((s) => s.status === "running" || s.status === "starting");
  const memberIds = worktree.services.map((s) => s.id);
  const busy = memberIds.some((id) => devhub.pending.has(id)) || devhub.pending.has(`wt:${worktree.path}`);
  // Stopping more than one service asks first — it tears down a whole stack,
  // including things devhub did not start, and there is no single inverse to
  // offer as an undo. A single stop does not ask; `start` is its inverse.
  const [confirmStop, setConfirmStop] = useState(false);
  const external = stoppable.filter((s) => s.external).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          style={{
            display: "flex",
            alignItems: "center",
            minWidth: 0,
            gap: 7,
            background: "transparent",
            border: "none",
            padding: "2px 0",
            cursor: "pointer",
            color: "var(--dh-text-action)",
          }}
        >
          <Icon name={open ? "expand_more" : "chevron_right"} size={14} />
          <StatusDot status={live ? "running" : "stopped"} size={6} />
          <span
            title={label}
            style={{
              font: live ? "600 12px/1 var(--font-mono)" : "400 12px/1 var(--font-mono)",
              color: live ? "var(--dh-text)" : "var(--dh-text-secondary)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
          {worktree.isMain && worktree.branch !== "main" && worktree.branch !== "master" && (
            <span style={{ font: "var(--type-caption)", color: "var(--dh-text-secondary)" }}>
              Primary
            </span>
          )}
        </button>
        <span style={{ font: "var(--type-code)", color: "var(--dh-text-secondary)" }}>{worktree.head}</span>
        <span style={{ flex: 1, height: 1, background: "var(--dh-border-hairline)" }} />
        <span data-tabular style={{ font: "var(--type-meta-text)", color: live ? "var(--dh-status-running)" : "var(--dh-text-secondary)" }}>
          {live > 0 ? `${live} up` : "Idle"}
        </span>
        {/* A collapsed idle worktree can be started without expanding it
            first: expanding reveals one inherited `dev` row identical in every
            branch, so the click was pure ceremony. */}
        {!open && startable.length > 0 && (
          <Button variant="ghost" size="sm" icon="play_arrow" loading={busy} onClick={() => devhub.startWorktree(worktree.path, memberIds)}>
            Start
          </Button>
        )}
        {worktree.services.length > 0 && (
          <MenuButton
            label={`${label} actions`}
            items={[
              // Labelled by effect and counted. "start all" silently skipped
              // every row without a launcher — three of four on a notqa
              // worktree — and "stop all" stopped adopted and observed
              // processes too, i.e. dev servers started in your own terminal.
              ...(startable.length
                ? [{ key: "start", label: `Start ${startable.length} launcher${startable.length === 1 ? "" : "s"}`, icon: "play_arrow", onSelect: () => devhub.startWorktree(worktree.path, memberIds) }]
                : []),
              ...(stoppable.length
                ? [{
                    key: "stop",
                    label: `Stop ${stoppable.length} running`,
                    icon: "stop",
                    danger: true,
                    divider: startable.length > 0,
                    onSelect: () => (stoppable.length > 1 ? setConfirmStop(true) : devhub.stopWorktree(worktree.path, memberIds)),
                  }]
                : []),
              { key: "reveal", label: "Reveal in Finder", icon: "folder_open", divider: startable.length > 0 || stoppable.length > 0, onSelect: () => devhub.revealPath(worktree.path) },
            ]}
          />
        )}
      </div>

      {confirmStop && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            margin: "2px 0 0 21px",
            padding: "9px 12px",
            borderRadius: 9,
            background: "var(--dh-flag-bg)",
            border: "1px solid var(--dh-flag-border)",
          }}
        >
          <span style={{ flex: 1, font: "var(--type-meta-text)", color: "var(--dh-alert-text)" }}>
            Stop {stoppable.length} services in {label}?
            {external > 0 && ` ${external} of them devhub didn't start.`}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirmStop(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon="stop"
            onClick={() => {
              setConfirmStop(false);
              devhub.stopWorktree(worktree.path, memberIds);
            }}
          >
            Stop {stoppable.length}
          </Button>
        </div>
      )}

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 21 }}>
          {worktree.services.length === 0 ? (
            <span style={{ font: "var(--type-meta-text)", color: "var(--dh-text-secondary)", padding: "4px 2px" }}>
              Nothing is running, and this repository has no launcher.
            </span>
          ) : (
            worktree.services.map((s) => (
              <ServiceRow
                key={s.id}
                service={s}
                projectId={project.id}
                repoPath={repo.path}
                devhub={devhub}
                now={now}
                pushToast={pushToast}
                open={openLogId === s.id}
                revealed={reveal === s.id}
                onOpenLogs={onOpenLogs}
                onEditLauncher={onEditLauncher}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------- services

function ServiceRow({
  service,
  projectId,
  repoPath,
  devhub,
  now,
  pushToast,
  compact,
  open,
  revealed,
  onOpenLogs,
  onEditLauncher,
}: {
  service: ServiceView;
  projectId: string;
  repoPath: string;
  devhub: Devhub;
  now: number;
  pushToast: (t: Omit<ToastData, "id">) => void;
  compact?: boolean;
  open: boolean;
  revealed?: boolean;
  onOpenLogs: (id: string) => void;
  onEditLauncher: (a: { projectId: string; repoPath: string; service: ServiceView }) => void;
}) {
  const s = service;
  const busy = devhub.pending.has(s.id);
  const live = s.status === "running" || s.status === "starting";

  const items = [
    s.launchable
      ? { key: "edit", label: "Edit launcher", icon: "edit", onSelect: () => onEditLauncher({ projectId, repoPath, service: s }) }
      : { key: "save", label: "Save as launcher", icon: "bookmark_add", onSelect: () => onEditLauncher({ projectId, repoPath, service: s }) },
    { key: "reveal", label: "Reveal in Finder", icon: "folder_open", onSelect: () => devhub.revealPath(s.cwd) },
    ...(s.launchable && s.command
      ? [
          {
            key: "delete",
            label: "Delete launcher",
            icon: "delete",
            danger: true,
            divider: true,
            // Reachable again (the divider flag used to swallow this item
            // entirely), so it needs friction. An undo beats a confirm here:
            // the inverse is exact — the launcher is fully described by what
            // is already on this row.
            onSelect: () => {
              const restore = { role: s.role, cmd: s.command!, policy: s.policy ?? { ports: "fixed" as const } };
              devhub.deleteLauncher(projectId, repoPath, s.role);
              pushToast({
                message: `Deleted launcher “${s.role}”`,
                actionLabel: "Undo",
                onAction: () => devhub.saveLauncher(projectId, repoPath, restore),
              });
            },
          },
        ]
      : []),
  ];

  const metadata = s.ports.length
    ? s.ports.map((port) => `localhost:${port}`).join(" · ")
    : s.command ?? s.container ?? tildify(s.cwd);

  return (
    <div className={`service-row is-${s.status} ${open ? "is-open" : ""} ${revealed ? "is-revealed" : ""}`}>
      <span className="service-row-icon"><Icon name={s.kind === "docker" ? "deployed_code" : "terminal"} size={18} /></span>
      <div className="service-row-copy">
        <div className="service-row-title">
          <strong title={s.displayName}>{s.displayName}</strong>
          {s.kind === "docker" && <span>Docker</span>}
          {s.mode === "built" && <span>Built</span>}
          {!s.launchable && <span title="DevHub can stop this runtime but needs a launcher before it can start it">No launcher</span>}
        </div>
        <div className="service-row-meta" title={metadata}>
          {s.ports.length > 0
            ? s.ports.map((port) => <a key={port} href={`http://localhost:${port}`} target="_blank" rel="noreferrer">localhost:{port}</a>)
            : <span>{metadata}</span>}
          {s.policy?.ports === "alloc" && s.assignedPort != null && <span>reserved :{s.assignedPort}</span>}
          {live && s.startedAt && <span>up {dur(now - s.startedAt)}</span>}
          {s.status === "crashed" && <span className="is-error">exited {s.exitCode ?? "?"}</span>}
        </div>
      </div>
      <span className={`service-row-state is-${s.status}`}><i />{s.status}</span>
      <div className="service-row-actions">
        {live ? (
          <>
            <Button size="sm" variant="ghost" icon="terminal" onClick={() => onOpenLogs(s.id)}>
              Logs
            </Button>
            {s.launchable && (
              <Button size="sm" variant="ghost" icon="restart_alt" loading={busy} onClick={() => devhub.restart(s.id)}>
                Restart
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon="stop"
              loading={busy}
              onClick={() => {
                devhub.stop(s.id);
                pushToast({ message: `Stopping ${s.displayName}`, actionLabel: "Start again", onAction: () => devhub.start(s.id) });
              }}
            >
              Stop
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" icon="play_arrow" loading={busy} disabled={!s.launchable} onClick={() => devhub.start(s.id)}>
            Start
          </Button>
        )}
        {!live && <Button size="sm" variant="ghost" icon="terminal" onClick={() => onOpenLogs(s.id)}>Logs</Button>}
        <MenuButton label={`Actions for ${s.displayName}`} items={items} compact={compact} />
      </div>
    </div>
  );
}

/** Leaked things are loud; debris is quiet and folded away.
 *
 *  A process still holding a port from a deleted worktree is the one thing
 *  devhub knows that `lsof` can't tell you, and it gets the full red
 *  treatment. A `Created` container left behind by the same deleted worktree
 *  is inert — eight of those shouting alongside two real leaks is how the
 *  old alert panel became unreadable. */
function OrphanSections({ orphans, onKill, pending }: { orphans: Orphan[]; onKill: (id: string) => void; pending: Set<string> }) {
  // An orphan is now only ever a LIVE leak — something still holding a port
  // from a worktree that no longer exists, which is the one thing devhub knows
  // that `lsof` cannot tell you. Containers that never ran used to land here
  // too, under "left over from deleted worktrees", a heading named for its
  // cause rather than its state; they now live in one `never started` section
  // with their counterparts from surviving worktrees, and with an action.
  if (orphans.length === 0) return null;
  return (
    <section className="orphan-section">
      <div className="focus-section-heading"><h2>Leaked runtimes</h2><span>{orphans.length} still running after their workspace disappeared</span></div>
      <div className="orphan-ledger">
      {orphans.map((o) => (
        <OrphanRow key={o.id} orphan={o} onKill={onKill} pending={pending.has(o.id)} />
      ))}
      </div>
    </section>
  );
}

function OrphanRow({ orphan, onKill, pending }: { orphan: Orphan; onKill: (id: string) => void; pending: boolean }) {
  const o = orphan;
  return (
    <div className="orphan-row">
      <span className="orphan-row-icon"><Icon name={o.kind === "docker" ? "deployed_code" : "warning"} size={17} /></span>
      <div className="orphan-row-copy">
        <strong>{o.label}</strong>
        <small>{o.ports.length > 0 && `:${o.ports.join(", :")} · `}{o.pid ? `pid ${o.pid} · ` : ""}{tildify(o.cwd)}</small>
      </div>
      <span className="orphan-row-state">{o.reason === "worktree-gone" ? "Workspace gone" : o.reason === "cwd-deleted" ? "Directory gone" : "Unclaimed"}</span>
      <ConfirmButton
        label={o.kind === "docker" ? "Stop" : "Kill"}
        confirmLabel={o.pid ? `Kill pid ${o.pid}?` : "Stop for good?"}
        icon="close"
        loading={pending}
        onConfirm={() => onKill(o.id)}
      />
    </div>
  );
}

// ----------------------------------------------------------------- panes

function PortsPane({ ports, onReveal }: { ports: PortRow[]; onReveal: (projectId: string | null, targetId: string | null) => void }) {
  // Defaults to devhub's own ports. "all" is the complete picture and stays
  // one click away, but on this machine it is 28 rows of which 21 are foreign
  // — six com.docker.backend entries, ControlCenter twice, a Discord helper —
  // and a 4:1 noise ratio on first render teaches you not to open the view.
  const [scope, setScope] = useState<"all" | "devhub">("devhub");
  // "all" is the complete picture and lists every socket, ephemeral ones
  // included. "devhub" answers a different question — what address is my
  // service on — so it drops the OS-assigned ports a runtime opens for its
  // own plumbing, the same ones the service rows already hide. Without this,
  // toolboy's relay alone contributes six near-identical rows for miniflare
  // internals and the count implies devhub owns twice the ports it does.
  const mine = ports.filter((p) => p.kind !== "foreign" && p.port < 49152);
  const shown = scope === "all" ? ports : mine;
  return (
    <div className="ports-page" data-dh-pane="1">
      <div className="projects-intro ports-intro">
        <div><h1>Ports</h1><p>{scope === "all" ? "Every listener currently observed on this machine." : "Addresses used by known project runtimes."}</p></div>
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: "all", label: `All ${ports.length}` },
              { value: "devhub", label: `DevHub ${mine.length}` },
            ]}
          />
      </div>
      <div className="port-ledger">
          {shown.map((p) => (
            <div key={p.port} className={`port-row ${p.kind === "foreign" ? "is-foreign" : ""} ${p.holders.length > 1 ? "is-collision" : ""}`}>
              <span className="port-row-icon"><Icon name={p.holders.length > 1 ? "compare_arrows" : p.kind === "docker" ? "deployed_code" : "lan"} size={17} /></span>
              {p.kind === "foreign" ? (
                <strong className="port-number">:{p.port}</strong>
              ) : (
                <a className="port-number" href={`http://localhost:${p.port}`} target="_blank" rel="noreferrer">:{p.port}</a>
              )}
              <button
                className="port-owner"
                type="button"
                disabled={!p.serviceId}
                onClick={() => onReveal(null, p.serviceId)}
                title={p.holders.length > 1 ? p.holders.map((h) => `${h.label} (pid ${h.pid})`).join("  ·  ") : p.label}
              >
                <strong>{p.label}</strong>
                <small>{p.kind === "foreign" ? "Outside DevHub" : p.kind === "docker" ? "Docker runtime" : "Project runtime"}{p.pid ? ` · pid ${p.pid}` : ""}</small>
              </button>
              <span className={`port-row-state ${p.holders.length > 1 ? "is-warning" : ""}`}>{p.holders.length > 1 ? `${p.holders.length} holders` : p.kind === "foreign" ? "External" : "Listening"}</span>
              {p.kind !== "foreign" && <a className="port-open" href={`http://localhost:${p.port}`} target="_blank" rel="noreferrer" aria-label={`Open localhost port ${p.port}`}><Icon name="open_in_new" size={16} /></a>}
            </div>
          ))}
          {shown.length === 0 && (
            <div className="ledger-empty">
              <EmptyState
                size="sm"
                title={scope === "all" ? "Nothing is listening" : "No DevHub services are listening"}
                description={
                  scope === "all"
                    ? "No process on this machine currently holds a TCP port."
                    : `${ports.length} port${ports.length === 1 ? " is" : "s are"} held by something else — switch to "all" to see them.`
                }
              />
            </div>
          )}
      </div>
    </div>
  );
}

function UnownedPane({ orphans, onKill, pending }: { orphans: Orphan[]; onKill: (id: string) => void; pending: Set<string> }) {
  return (
    <div className="unowned-page" data-dh-pane="1">
      <div className="projects-intro"><div><h1>Not in a project</h1><p>Live processes DevHub cannot connect to a known repository.</p></div></div>
      {orphans.length > 0 ? <div className="orphan-ledger">
        {orphans.map((o) => (
          <OrphanRow key={o.id} orphan={o} onKill={onKill} pending={pending.has(o.id)} />
        ))}
      </div> : <div className="attention-clear"><span><Icon name="check" size={22} /></span><div><h2>Everything is claimed</h2><p>No running process is outside a known project.</p></div></div>}
    </div>
  );
}

function PaneHeader({ title, subtitle, right }: { title: string; subtitle: string; right?: ReactNode }) {
  return (
    <header
      style={{
        flex: "0 0 auto",
        padding: "20px 26px 16px",
        borderBottom: "1px solid var(--dh-border-hairline)",
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ font: "var(--type-page-title)", letterSpacing: "var(--tracking-page-title)", color: "var(--dh-text)" }}>{title}</span>
        <span style={{ font: "var(--type-meta-text)", color: "var(--dh-text-host)" }}>{subtitle}</span>
      </div>
      {right}
    </header>
  );
}

/** Two-state switch styled like the rest of the chrome and quiet enough to
 *  sit in a header without competing with the title. */
function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="launch-segmented">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={on ? "is-selected" : ""}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function MigrationBanner({ count, onReview, onDismiss }: { count: number; onReview: () => void; onDismiss: () => void }) {
  return (
    <div className="migration-notice">
      <span><Icon name="history" size={17} /></span>
      <div><strong>Recovered launcher commands</strong><small>
        {count} command{count === 1 ? "" : "s"} recovered from your old config. Nothing was kept automatically — review and save the ones you still want as launchers.
      </small></div>
      <Button size="sm" variant="secondary" onClick={onReview}>Review</Button>
      <Button size="sm" variant="ghost" onClick={onDismiss}>Discard</Button>
    </div>
  );
}

// --------------------------------------------------------------- atoms

function SectionLabel({ children, tone }: { children: ReactNode; tone?: "red" }) {
  return (
    <span
      style={{
        font: "var(--type-row-title)",
        color: tone === "red" ? "var(--dh-alert-text)" : "var(--dh-text-tertiary)",
      }}
    >
      {children}
    </span>
  );
}

/** Badge grammar. Five orthogonal facts used to share one identical grey
 *  chip with no ordering rule: a kind (docker), a mode (built), a control
 *  relationship (observed/adopted), a policy outcome (:3117 assigned) and an
 *  ownership claim (not devhub's).
 *
 *  `kind` — a fact about the thing itself: filled and tinted.
 *  `neutral` — a fact about devhub's relationship to it: outline.
 *  `warn` — something contended or wrong. */
function Chip({
  children,
  title,
  tone = "neutral",
  style,
}: {
  children: ReactNode;
  title?: string;
  tone?: "neutral" | "kind" | "warn";
  style?: CSSProperties;
}) {
  const tones = {
    neutral: { color: "var(--dh-text-secondary)", border: "1px solid var(--dh-border-button)", background: "transparent" },
    kind: { color: "var(--dh-text)", border: "1px solid transparent", background: "var(--dh-bg-hover)" },
    warn: { color: "var(--dh-status-starting)", border: "1px solid var(--dh-flag-border)", background: "var(--dh-flag-bg)" },
  }[tone];
  return (
    <span
      title={title}
      style={{
        font: "var(--type-caption)",
        borderRadius: 5,
        padding: "3px 6px",
        whiteSpace: "nowrap",
        ...tones,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function Banner({ children, tone }: { children: ReactNode; tone: "red" }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 9,
        background: tone === "red" ? "var(--dh-flag-bg)" : "var(--dh-bg-card)",
        border: `1px solid ${tone === "red" ? "var(--dh-flag-border)" : "var(--dh-border-button)"}`,
        font: "var(--type-meta-text)",
        color: "var(--dh-alert-text)",
      }}
    >
      {children}
    </div>
  );
}
