import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Alert,
  Launcher,
  NeverStarted,
  Orphan,
  PortHolder,
  PortPolicy,
  PortRow,
  Prefs,
  Project,
  ProjectView,
  RepoInput,
  RepoView,
  ServiceMode,
  ServiceStatus,
  ServiceView,
  Snapshot,
  WorktreeView,
} from "@devhub/shared";
import { prefKey, repoKey } from "@devhub/shared";
import { expandHome, slugify, tildify, writeConfig } from "./config.js";
import type { ListeningSocket, ObservedContainer, ObservedProcess } from "./externalScan.js";
import { probeStatus } from "./externalScan.js";
import { listWorktrees } from "./gitWorktrees.js";
import type { RuntimeServerConfig, RuntimeSnapshot } from "./processManager.js";
import { allocatePort, deriveRole, looseServiceId, orphanId, serviceId, singletonGroupFor } from "./roles.js";

/** A worktree, flattened across every project so ownership lookups are one
 *  pass. Rebuilt on each `refreshWorktrees()`. */
interface WT {
  projectId: string;
  repoPath: string;
  repoAbs: string;
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
}

/** Every listening process that strips to the same source directory, merged
 *  into one row. A single logical service routinely spans several pids —
 *  toolboy's relay is a `wrangler` parent and a `workerd` child sharing a
 *  cwd, with the interesting port (8787) on the child — so keying a row on
 *  one pid shows the wrong ports and invents a duplicate row for the rest. */
interface ProcGroup {
  procs: ObservedProcess[];
  role: string;
  dir: string | null;
  mode: ServiceMode;
}

const groupPorts = (g: ProcGroup): number[] => [...new Set(g.procs.flatMap((p) => p.ports))].sort((a, b) => a - b);
/** The pid worth showing/adopting: the one that actually holds a port. */
const groupPid = (g: ProcGroup): number => (g.procs.find((p) => p.ports.length) ?? g.procs[0]).pid;

export interface BuildResult {
  snapshot: Snapshot;
  /** What ProcessManager should be driving this tick. */
  runtimes: RuntimeServerConfig[];
  /** Service id -> the already-running pid/port devhub should adopt so it
   *  comes up controllable without anyone clicking anything. */
  adoptions: Map<string, { pid: number; port: number }>;
  /** Container refs worth a `docker inspect` for precise start time. */
  dockerRefs: { id: string; container: string }[];
}

export class RepoStore {
  private projects: Project[];
  private prefs: Prefs;
  private migration: Snapshot["migration"];
  /** Live worktree list per `projectId\0repoPath`, recomputed from
   *  `git worktree list` each tick and never persisted — same "matching aid,
   *  not a constraint" philosophy the repo paths themselves have. */
  private worktrees = new Map<string, WT[]>();

  constructor(projects: Project[], prefs: Prefs, migration: Snapshot["migration"]) {
    this.projects = projects;
    this.prefs = prefs;
    this.migration = migration;
  }

  getProjects(): Project[] {
    return this.projects;
  }
  getPrefs(): Prefs {
    return this.prefs;
  }
  setPrefs(prefs: Prefs) {
    this.prefs = prefs;
  }
  dismissMigration() {
    this.migration = [];
  }

  replaceAll(projects: Project[], migration: Snapshot["migration"]) {
    this.projects = projects;
    // Only ADOPT a fresh migration list; never let an empty one clear the
    // pending offer. Saving the first recovered command rewrites the config
    // into the new shape, which the file watcher then re-reads as
    // "no legacy section, nothing to recover" — wiping the other twelve
    // candidates out from under the dialog the user is still working
    // through. Candidates are dropped one at a time by `saveLauncher`, or
    // all at once by an explicit dismiss.
    if (migration.length) this.migration = migration;
  }

  // ------------------------------------------------------------ worktrees

  async refreshWorktrees() {
    const next = new Map<string, WT[]>();
    for (const p of this.projects) {
      for (const r of p.repos) {
        const repoAbs = expandHome(r.path).replace(/\/$/, "");
        const entries = await listWorktrees(repoAbs);
        const list: WT[] =
          entries.length > 0
            ? entries.map((e, i) => ({
                projectId: p.id,
                repoPath: r.path,
                repoAbs,
                path: e.path.replace(/\/$/, ""),
                branch: e.branch,
                head: e.head,
                isMain: i === 0,
              }))
            : // Not a git repo (or git couldn't read it): one synthetic
              // worktree covering the whole directory, so the tree shape is
              // identical either way.
              [{ projectId: p.id, repoPath: r.path, repoAbs, path: repoAbs, branch: null, head: "", isMain: true }];
        next.set(repoKey(p.id, r.path), list);
      }
    }
    this.worktrees = next;
  }

  private allWorktrees(): WT[] {
    return [...this.worktrees.values()].flat();
  }

  contextForPath(rawPath: string): { projectId: string; repoPath: string; workspacePath: string } | null {
    const match = this.owner(resolve(expandHome(rawPath)).replace(/\/$/, ""));
    return match ? { projectId: match.projectId, repoPath: match.repoPath, workspacePath: match.path } : null;
  }

  /** Resolve a declared agent cwd, creating the minimal project grouping when
   * no known repo owns it. Git's primary worktree becomes the persisted repo
   * source even when the agent is currently inside a sibling worktree. */
  async ensureProjectForPath(
    cwd: string,
    options: { projectName?: string; sourcePath?: string } = {},
  ): Promise<{ projectId: string; repoPath: string; workspacePath: string; created: boolean }> {
    const abs = resolve(expandHome(cwd)).replace(/\/$/, "");
    const known = this.contextForPath(abs);
    if (known) return { ...known, created: false };

    const explicitSource = options.sourcePath ? resolve(expandHome(options.sourcePath)).replace(/\/$/, "") : null;
    const discovered = explicitSource ? await listWorktrees(explicitSource) : await listWorktrees(abs);
    const sourceAbs = explicitSource ?? discovered[0]?.path ?? abs;

    let project = this.projects.find((candidate) =>
      candidate.repos.some((repo) => resolve(expandHome(repo.path)).replace(/\/$/, "") === sourceAbs),
    );
    let created = false;
    if (!project) {
      project = this.createProject(options.projectName?.trim() || basename(sourceAbs), [{ path: tildify(sourceAbs) }]);
      created = true;
    }

    await this.refreshWorktrees();
    const context = this.contextForPath(abs) ?? this.contextForPath(sourceAbs);
    if (!context) throw new Error(`DevHub couldn't resolve a workspace for "${cwd}"`);
    return { ...context, created };
  }

  /** The worktree owning `path`, by longest-path match. Must run against
   *  worktree paths, not repo paths: this machine's worktrees are siblings
   *  (`notqa--danger-tweaks` next to `notqa`), not nested inside the repo. */
  private owner(path: string): WT | null {
    let best: WT | null = null;
    for (const w of this.allWorktrees()) {
      if ((path === w.path || path.startsWith(`${w.path}/`)) && (!best || w.path.length > best.path.length)) best = w;
    }
    return best;
  }

  /** The repo a path belongs to even though git has forgotten it — keys on
   *  the `<repo>--<branch-slug>` sibling convention this machine uses
   *  everywhere. This is what attributes a leaked process from a deleted
   *  worktree back to its repo instead of dropping it on the floor. */
  private repoBySiblingPath(path: string): WT | null {
    for (const w of this.allWorktrees()) {
      if (!w.isMain) continue;
      const prefix = `${dirname(w.repoAbs)}/${basename(w.repoAbs)}--`;
      if (path.startsWith(prefix)) return w;
    }
    return null;
  }

  private repoByComposeProject(project: string): WT | null {
    const base = project.split("--")[0];
    for (const w of this.allWorktrees()) {
      if (w.isMain && basename(w.repoAbs) === base) return w;
    }
    return null;
  }

  // ---------------------------------------------------------------- build

  build(
    procs: ObservedProcess[],
    containers: ObservedContainer[],
    sockets: ListeningSocket[],
    pmStates: Map<string, RuntimeSnapshot>,
    dockerStarted: Map<string, number | null>,
  ): BuildResult {
    const runtimes: RuntimeServerConfig[] = [];
    const adoptions = new Map<string, { pid: number; port: number }>();
    const dockerRefs: { id: string; container: string }[] = [];
    const alerts: Alert[] = [];
    const unowned: Orphan[] = [];
    const orphansByRepo = new Map<string, Orphan[]>();
    /** Every container that never ran, regardless of whether its worktree
     *  survives — see the `NeverStarted` doc comment for why this is one list
     *  and not an alert on one side and grey debris on the other. */
    const neverStarted: NeverStarted[] = [];
    /** service id -> ports, for the collision pass and the ports table. */
    const portsByService = new Map<string, { ports: number[]; label: string; kind: "process" | "docker"; pid: number | null }>();

    // ---- classify every observed process ----
    const procsByWorktree = new Map<string, Map<string, ProcGroup>>();
    for (const proc of procs) {
      const wt = this.owner(proc.cwd);
      if (wt) {
        const { role, dir, mode } = deriveRole(proc.cwd, wt.path, wt.repoAbs);
        let groups = procsByWorktree.get(wt.path);
        if (!groups) procsByWorktree.set(wt.path, (groups = new Map()));
        const key = dir ?? "";
        const existing = groups.get(key);
        if (existing) {
          existing.procs.push(proc);
          // A dev server and a production build of the same directory are
          // two modes of one service; only call the row "built" when there
          // is nothing running from source.
          if (mode === "dev") existing.mode = "dev";
        } else {
          groups.set(key, { procs: [proc], role, dir, mode });
        }
        continue;
      }
      const sibling = this.repoBySiblingPath(proc.cwd);
      if (sibling) {
        const wtName = proc.cwd.slice(dirname(sibling.repoAbs).length + 1).split("/")[0];
        const { role } = deriveRole(proc.cwd, `${dirname(sibling.repoAbs)}/${wtName}`, sibling.repoAbs);
        push(orphansByRepo, repoKey(sibling.projectId, sibling.repoPath), {
          id: orphanId("process", proc.pid),
          kind: "process",
          pid: proc.pid,
          container: null,
          cwd: proc.cwd,
          ports: proc.ports,
          reason: "worktree-gone",
          label: `${wtName} / ${role}`,
          status: "running",
          exitCode: null,
        });
        continue;
      }
      if (!existsSync(proc.cwd)) {
        unowned.push({
          id: orphanId("process", proc.pid),
          kind: "process",
          pid: proc.pid,
          container: null,
          cwd: proc.cwd,
          ports: proc.ports,
          reason: "cwd-deleted",
          label: basename(proc.cwd) || proc.command,
          status: "running",
          exitCode: null,
        });
        continue;
      }
      if (looksLikeDevTree(proc.cwd) && !isSelf(proc.cwd)) {
        unowned.push({
          id: orphanId("process", proc.pid),
          kind: "process",
          pid: proc.pid,
          container: null,
          cwd: proc.cwd,
          ports: proc.ports,
          reason: "unattributed",
          label: basename(proc.cwd),
          status: "running",
          exitCode: null,
        });
      }
      // Anything else is system noise (a menu-bar app, Docker's own proxy).
      // It still shows up in the ports table, just not as devhub's problem.
    }

    // ---- classify every container ----
    const containersByWorktree = new Map<string, ObservedContainer[]>();
    for (const c of containers) {
      const wd = c.composeWorkingDir;
      const wt = wd ? this.allWorktrees().find((w) => w.path === wd) ?? null : null;
      if (wt) {
        push(containersByWorktree, wt.path, c);
        continue;
      }
      const byProject = c.composeProject ? this.repoByComposeProject(c.composeProject) : null;
      if (byProject) {
        // Only a container still RUNNING from a deleted worktree is an orphan:
        // it holds a port and leaks resources, and plain `docker ps` won't tell
        // you its worktree is gone. One that never ran holds nothing — it is
        // debris, and it belongs in `neverStarted` alongside the never-ran
        // containers whose worktrees DO still exist, so that one count covers
        // the whole class instead of two counts covering halves of it.
        if (c.running) {
          push(orphansByRepo, repoKey(byProject.projectId, byProject.repoPath), {
            id: orphanId("docker", c.name),
            kind: "docker",
            pid: null,
            container: c.name,
            cwd: wd ?? "",
            ports: c.ports,
            reason: "worktree-gone",
            label: `${c.composeProject} / ${c.composeService ?? c.name}`,
            status: "running",
            exitCode: c.exitCode,
          });
          alerts.push({
            id: `alert:orphan:${c.name}`,
            kind: "orphan",
            message: `${c.name} is still running from a worktree that no longer exists`,
            projectId: byProject.projectId,
            targetId: orphanId("docker", c.name),
          });
        } else {
          neverStarted.push({
            targetId: orphanId("docker", c.name),
            container: c.name,
            composeProject: c.composeProject,
            composeService: c.composeService,
            projectId: byProject.projectId,
            worktreePath: null,
            worktreeLabel: null,
            action: "remove",
            state: c.state === "created" ? "created" : "exited",
            exitCode: c.exitCode,
          });
        }
      }
    }

    // ---- assemble the tree ----
    const projectViews: ProjectView[] = [];
    for (const p of this.projects) {
      const repoViews: RepoView[] = [];
      for (const r of p.repos) {
        const key = repoKey(p.id, r.path);
        const wts = this.worktrees.get(key) ?? [];
        const repoAbs = expandHome(r.path).replace(/\/$/, "");
        const takenPorts = new Set<number>();
        const worktreeViews: WorktreeView[] = [];

        for (const wt of wts) {
          const services: ServiceView[] = [];
          const obs = [...(procsByWorktree.get(wt.path)?.values() ?? [])];
          const consumed = new Set<ProcGroup>();

          for (const l of orderLaunchers(r.launchers, this.prefs.roleOrder[key])) {
            // Match observation to launcher by DIRECTORY, not derived role:
            // a launcher may be named `relay` while its directory is
            // `backend`, and a production build of `apps/web` reports a
            // build-output cwd that strips back to the same directory.
            const match = obs.find((o) => !consumed.has(o) && (o.dir ?? null) === (l.dir ?? null));
            const matchPorts = match ? groupPorts(match) : [];
            if (match) consumed.add(match);
            const cwd = l.dir ? join(wt.path, l.dir) : wt.path;
            const id = serviceId(wt.path, l.role);
            const assignedPort =
              l.policy.ports === "alloc" ? allocatePort(l.policy, wt.path, l.role, takenPorts) : null;
            if (assignedPort != null) takenPorts.add(assignedPort);

            const rt = pmStates.get(id);
            services.push(
              this.serviceView({
                id,
                projectId: p.id,
                repoPath: r.path,
                role: l.role,
                kind: "process",
                launchable: true,
                command: l.cmd,
                cwd,
                container: null,
                policy: l.policy,
                assignedPort,
                mode: match?.mode ?? null,
                observedPorts: matchPorts,
                observedPid: match ? groupPid(match) : null,
                rt,
              }),
            );

            runtimes.push({
              id,
              projectId: p.id,
              name: l.role,
              kind: "process",
              command: l.cmd,
              cwd,
              ...(l.policy.ports === "fixed" ? { singletonGroup: singletonGroupFor(r.path, l.role) } : {}),
              ...(assignedPort != null ? { env: { [l.policy.ports === "alloc" && l.policy.env ? l.policy.env : "PORT"]: String(assignedPort) } } : {}),
              ...(l.killPatterns?.length ? { killPatterns: l.killPatterns } : {}),
            });
            if (match && (!rt || rt.status === "stopped")) {
              adoptions.set(id, { pid: groupPid(match), port: matchPorts[0] ?? 0 });
            }
            recordPorts(portsByService, id, matchPorts, `${p.name} · ${wtLabel(wt)} · ${l.role}`, "process", match ? groupPid(match) : null);
          }

          // Observed but not declared: devhub can stop it, and offer to
          // turn it into a launcher, but has no command to restart it.
          for (const o of obs) {
            if (consumed.has(o)) continue;
            const id = serviceId(wt.path, o.role);
            if (services.some((s) => s.id === id)) continue;
            const oPorts = groupPorts(o);
            const oPid = groupPid(o);
            const rt = pmStates.get(id);
            services.push(
              this.serviceView({
                id,
                projectId: p.id,
                repoPath: r.path,
                role: o.role,
                kind: "process",
                launchable: false,
                command: null,
                cwd: o.procs[0].cwd,
                container: null,
                policy: null,
                assignedPort: null,
                mode: o.mode,
                observedPorts: oPorts,
                observedPid: oPid,
                rt,
              }),
            );
            runtimes.push({ id, projectId: p.id, name: o.role, kind: "process", command: "", cwd: o.procs[0].cwd });
            if (!rt || rt.status === "stopped") adoptions.set(id, { pid: oPid, port: oPorts[0] ?? 0 });
            recordPorts(portsByService, id, oPorts, `${p.name} · ${wtLabel(wt)} · ${o.role}`, "process", oPid);
          }

          for (const c of containersByWorktree.get(wt.path) ?? []) {
            const role = c.composeService ?? c.name;
            const id = serviceId(wt.path, `docker:${role}`);
            const rt = pmStates.get(id);
            const status: ServiceStatus = c.running ? "running" : c.state === "created" ? "stopped" : c.exitCode ? "crashed" : "stopped";
            services.push({
              id,
              role,
              displayName: this.prefs.renames[prefKey(p.id, r.path, role)] ?? role,
              kind: "docker",
              launchable: true,
              command: null,
              cwd: c.composeWorkingDir ?? wt.path,
              container: c.name,
              policy: r.compose ?? null,
              assignedPort: null,
              mode: null,
              status: rt?.status === "starting" ? "starting" : status,
              pid: rt?.pid ?? null,
              // Published host ports, so a container row shows an address like
              // every other row and the ports table attributes the port to this
              // service instead of to Docker's own proxy.
              ports: c.running ? c.ports : [],
              startedAt: dockerStarted.get(id) ?? rt?.startedAt ?? null,
              exitCode: c.exitCode,
              external: false,
            });
            runtimes.push({ id, projectId: p.id, name: role, kind: "docker", container: c.name });
            dockerRefs.push({ id, container: c.name });
            if (c.running && c.ports.length) {
              recordPorts(portsByService, id, c.ports, `${p.name} · ${wtLabel(wt)} · ${role}`, "docker", null);
            }
            if (!c.running) {
              neverStarted.push({
                targetId: id,
                container: c.name,
                composeProject: c.composeProject,
                composeService: c.composeService,
                projectId: p.id,
                worktreePath: wt.path,
                worktreeLabel: wtLabel(wt),
                action: "start",
                state: c.state === "created" ? "created" : "exited",
                exitCode: c.exitCode,
              });
            }
          }

          worktreeViews.push({ path: wt.path, branch: wt.branch, head: wt.head, isMain: wt.isMain, services });
        }

        // Running worktrees first, then the main checkout, then by branch —
        // an idle worktree collapses to one line and shouldn't push a busy
        // one below the fold.
        worktreeViews.sort((a, b) => {
          const ar = a.services.some(isLive) ? 0 : 1;
          const br = b.services.some(isLive) ? 0 : 1;
          if (ar !== br) return ar - br;
          if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
          return (a.branch ?? a.path).localeCompare(b.branch ?? b.path);
        });

        repoViews.push({
          path: r.path,
          absPath: repoAbs,
          label: r.label ?? basename(repoAbs),
          isGit: existsSync(join(repoAbs, ".git")),
          missing: !existsSync(repoAbs),
          worktrees: worktreeViews,
          orphans: orphansByRepo.get(key) ?? [],
        });
      }

      // ---- loose launchers: a one-off outside every checkout ----
      const looseServices: ServiceView[] = [];
      for (const l of p.looseLaunchers ?? []) {
        const cwd = expandHome(l.dir ?? "~");
        const id = looseServiceId(p.id, l.role);
        const match = procs.find((x) => x.cwd === cwd);
        const rt = pmStates.get(id);
        looseServices.push(
          this.serviceView({
            id,
            projectId: p.id,
            repoPath: "",
            role: l.role,
            kind: "process",
            launchable: true,
            command: l.cmd,
            cwd,
            container: null,
            policy: l.policy,
            assignedPort: null,
            mode: null,
            observedPorts: match?.ports ?? [],
            observedPid: match?.pid ?? null,
            rt,
          }),
        );
        runtimes.push({ id, projectId: p.id, name: l.role, kind: "process", command: l.cmd, cwd });
        if (match && (!rt || rt.status === "stopped")) adoptions.set(id, { pid: match.pid, port: match.ports[0] ?? 0 });
        recordPorts(portsByService, id, match?.ports ?? [], `${p.name} · ${l.role}`, "process", match?.pid ?? null);
      }

      const allServices = [...repoViews.flatMap((r) => r.worktrees.flatMap((w) => w.services)), ...looseServices];
      const repoOrphans = repoViews.flatMap((r) => r.orphans);
      for (const o of repoOrphans) {
        if (o.kind !== "process") continue;
        alerts.push({
          id: `alert:orphan:${o.id}`,
          kind: "orphan",
          message: `${o.label} is still listening on :${o.ports.join(", :")} — its worktree is gone`,
          projectId: p.id,
          targetId: o.id,
          port: o.ports[0],
        });
      }

      projectViews.push({
        id: p.id,
        name: p.name,
        iconUrl: p.icon ? `/api/projects/${encodeURIComponent(p.id)}/icon` : null,
        repos: repoViews,
        looseServices,
        runningCount: allServices.filter(isLive).length,
        alertCount: alerts.filter((a) => a.projectId === p.id).length,
      });
    }

    for (const o of unowned) {
      if (o.reason !== "cwd-deleted") continue;
      alerts.push({
        id: `alert:orphan:${o.id}`,
        kind: "orphan",
        message: `${o.label} is listening on :${o.ports.join(", :")} from a directory that no longer exists`,
        projectId: null,
        targetId: o.id,
        port: o.ports[0],
      });
    }

    // ---- ports table + collisions, both purely from observation ----
    const ports = this.portRows(sockets, portsByService, unowned);
    const projectIdByService = new Map(runtimes.map((r) => [r.id, r.projectId]));
    for (const row of ports) {
      if (row.holders.length < 2) continue;
      // Attribute the alert to a project where we can, so it earns a rail
      // badge instead of living only in the global tray.
      const owner = row.holders.find((h) => h.serviceId);
      alerts.push({
        id: `alert:collision:${row.port}`,
        kind: "collision",
        message: `:${row.port} is held by ${row.holders.map((h) => h.label).join(" and ")}`,
        projectId: owner?.serviceId ? projectIdByService.get(owner.serviceId) ?? null : null,
        targetId: owner?.serviceId ?? null,
        port: row.port,
      });
    }

    const order = this.prefs.projectOrder;
    if (order.length) {
      projectViews.sort((a, b) => {
        const ai = order.indexOf(a.id);
        const bi = order.indexOf(b.id);
        return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
      });
    }

    // Recount now that every alert exists.
    for (const pv of projectViews) pv.alertCount = alerts.filter((a) => a.projectId === pv.id).length;

    return {
      snapshot: {
        projects: projectViews,
        // Filled by ActivityStore after this observed snapshot is compared
        // with the previous one.
        activity: [],
        // Filled by the daemon's ephemeral AgentRegistry after the observed
        // project/runtime view is built.
        agentRuns: [],
        portReservations: [],
        serviceAnnouncements: [],
        unowned,
        alerts,
        ports,
        prefs: this.prefs,
        migration: this.migration,
        probes: probeStatus(),
        neverStarted: neverStarted.sort(
          // Actionable first: a container whose worktree still exists can be
          // started; one whose worktree is gone can only be removed.
          (a, b) => (a.action === b.action ? a.container.localeCompare(b.container) : a.action === "start" ? -1 : 1),
        ),
      },
      runtimes,
      adoptions,
      dockerRefs,
    };
  }

  private serviceView(a: {
    id: string;
    projectId: string;
    repoPath: string;
    role: string;
    kind: "process";
    launchable: boolean;
    command: string | null;
    cwd: string;
    container: string | null;
    policy: PortPolicy | null;
    assignedPort: number | null;
    mode: ServiceMode | null;
    observedPorts: number[];
    observedPid: number | null;
    rt: RuntimeSnapshot | undefined;
  }): ServiceView {
    const observed = a.observedPorts.length > 0 || a.observedPid != null;
    // Observation wins: it is ground truth. The runtime's own port is only a
    // stopgap for a process devhub just spawned that hasn't bound yet.
    const ports = a.observedPorts.length ? serviceAddresses(a.observedPorts) : a.rt?.port ? [a.rt.port] : [];
    let status: ServiceStatus;
    if (a.rt?.status === "starting") status = "starting";
    else if (observed) status = "running";
    else if (a.rt?.status === "running") status = "running";
    else if (a.rt?.status === "crashed") status = "crashed";
    else status = "stopped";

    return {
      id: a.id,
      role: a.role,
      displayName: this.prefs.renames[prefKey(a.projectId, a.repoPath, a.role)] ?? a.role,
      kind: a.kind,
      launchable: a.launchable,
      command: a.command,
      cwd: a.cwd,
      container: a.container,
      policy: a.policy,
      assignedPort: a.assignedPort,
      mode: a.mode,
      status,
      pid: a.observedPid ?? a.rt?.pid ?? null,
      ports,
      startedAt: a.rt?.startedAt ?? null,
      exitCode: a.rt?.exitCode ?? null,
      external: a.rt?.external ?? (observed && (!a.rt || a.rt.status === "stopped")),
    };
  }

  private portRows(
    sockets: ListeningSocket[],
    byService: Map<string, { ports: number[]; label: string; kind: "process" | "docker"; pid: number | null }>,
    unowned: Orphan[],
  ): PortRow[] {
    const labelForPort = new Map<number, { serviceId: string; label: string; kind: "process" | "docker" }>();
    for (const [id, info] of byService) {
      for (const port of info.ports) labelForPort.set(port, { serviceId: id, label: info.label, kind: info.kind });
    }
    const orphanPorts = new Map<number, string>();
    for (const o of unowned) for (const port of o.ports) orphanPorts.set(port, `${o.label} (orphan)`);

    // One row per port, but every distinct PROCESS on that port is kept as a
    // holder. Deduping by port alone (the previous behaviour) collapsed a real
    // collision into a single row, which is why the `collision` alert could
    // never fire. Deduping by pid still folds the common v4+v6 double-bind,
    // which is the only reason dedupe existed in the first place.
    const byPort = new Map<number, PortRow>();
    for (const s of sockets) {
      const hit = labelForPort.get(s.port);
      const holder: PortHolder = hit
        ? { pid: s.pid, label: hit.label, serviceId: hit.serviceId, kind: hit.kind }
        : { pid: s.pid, label: orphanPorts.get(s.port) ?? s.command, serviceId: null, kind: "foreign" };

      const row = byPort.get(s.port);
      if (!row) {
        byPort.set(s.port, {
          port: s.port,
          pid: s.pid,
          serviceId: holder.serviceId,
          label: holder.label,
          kind: holder.kind,
          holders: [holder],
        });
        continue;
      }
      if (row.holders.some((h) => h.pid === s.pid)) continue;
      row.holders.push(holder);
      // A row owned by devhub keeps its own identity in the summary columns;
      // a foreign row adopts the first holder devhub does recognise.
      if (row.kind === "foreign" && holder.kind !== "foreign") {
        row.serviceId = holder.serviceId;
        row.label = holder.label;
        row.kind = holder.kind;
      }
    }
    return [...byPort.values()].sort((a, b) => a.port - b.port);
  }

  // ----------------------------------------------------------------- CRUD

  private persist() {
    writeConfig(this.projects);
  }

  project(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id);
  }

  projectIconPath(id: string): string | null {
    const project = this.project(id);
    if (!project?.icon) return null;
    const raw = expandHome(project.icon);
    const path = raw.startsWith("/") ? raw : resolve(expandHome(project.repos[0]?.path ?? "~"), raw);
    return existsSync(path) ? path : null;
  }

  createProject(name: string, repos: RepoInput[] = []): Project {
    name = name.trim();
    if (!name) throw new Error("A project needs a name");
    const taken = new Set(this.projects.map((p) => p.id));
    let id = slugify(name) || "project";
    let n = 2;
    while (taken.has(id)) id = `${slugify(name)}-${n++}`;
    const project: Project = { id, name, repos: repos.filter((r) => r.path.trim()).map((r) => ({ path: r.path.trim(), ...(r.label ? { label: r.label } : {}), launchers: [] })) };
    this.projects.push(project);
    this.persist();
    return project;
  }

  updateProject(id: string, name: string, repos: RepoInput[]) {
    const p = this.project(id);
    if (!p) throw new Error("Project not found");
    name = name.trim();
    if (!name) throw new Error("A project needs a name");
    p.name = name;
    // Keep the launchers of any repo that survives the edit — they're the
    // user's real work, and a repo list edit shouldn't quietly bin them.
    const existing = new Map(p.repos.map((r) => [r.path, r]));
    p.repos = repos
      .filter((r) => r.path.trim())
      .map((r) => {
        const prev = existing.get(r.path.trim());
        return { path: r.path.trim(), ...(r.label ? { label: r.label } : {}), launchers: prev?.launchers ?? [], ...(prev?.compose ? { compose: prev.compose } : {}) };
      });
    this.persist();
  }

  deleteProject(id: string) {
    this.projects = this.projects.filter((p) => p.id !== id);
    this.persist();
  }

  saveLauncher(projectId: string, repoPath: string, launcher: Launcher, replacingRole?: string) {
    const p = this.project(projectId);
    if (!p) throw new Error("Project not found");
    const repo = p.repos.find((r) => r.path === repoPath);
    if (!repo) throw new Error(`Repo "${repoPath}" not found in "${p.name}"`);
    const role = launcher.role.trim();
    if (!role) throw new Error("A launcher needs a role");
    if (!launcher.cmd.trim()) throw new Error("A launcher needs a command");
    const target = replacingRole ?? role;
    const idx = repo.launchers.findIndex((l) => l.role === target);
    const clean: Launcher = {
      role,
      cmd: launcher.cmd.trim(),
      ...(launcher.dir?.trim() ? { dir: launcher.dir.trim().replace(/^\.?\/*/, "").replace(/\/+$/, "") } : {}),
      policy: launcher.policy,
      ...(launcher.killPatterns?.length ? { killPatterns: launcher.killPatterns } : {}),
    };
    if (idx === -1) repo.launchers.push(clean);
    else repo.launchers[idx] = clean;
    // This candidate has been dealt with; the rest of the offer stands.
    this.migration = this.migration.filter((c) => !(c.projectId === projectId && c.repoPath === repoPath && c.role === target));
    this.persist();
  }

  deleteLauncher(projectId: string, repoPath: string, role: string) {
    const repo = this.project(projectId)?.repos.find((r) => r.path === repoPath);
    if (!repo) return;
    repo.launchers = repo.launchers.filter((l) => l.role !== role);
    this.persist();
  }

  setComposePolicy(projectId: string, repoPath: string, policy: PortPolicy | null) {
    const repo = this.project(projectId)?.repos.find((r) => r.path === repoPath);
    if (!repo) return;
    if (policy) repo.compose = policy;
    else delete repo.compose;
    this.persist();
  }

  reorderProjects(ids: string[]) {
    this.prefs.projectOrder = ids;
  }

  /** Every service id under a worktree — for the per-worktree start/stop. */
  serviceIdsForWorktree(view: Snapshot, worktreePath: string): string[] {
    for (const p of view.projects) {
      for (const r of p.repos) {
        const w = r.worktrees.find((x) => x.path === worktreePath);
        if (w) return w.services.map((s) => s.id);
      }
    }
    return [];
  }

  /** Project start means the primary checkout of every repo, plus loose
   * launchers. Project stop means every service currently attributed to it,
   * including sibling worktrees. */
  serviceIdsForProject(view: Snapshot, projectId: string, action: "start" | "stop"): string[] {
    const project = view.projects.find((candidate) => candidate.id === projectId);
    if (!project) return [];
    const repoServices = project.repos.flatMap((repo) =>
      (action === "start" ? repo.worktrees.filter((worktree) => worktree.isMain).slice(0, 1) : repo.worktrees)
        .flatMap((worktree) => worktree.services)
        .filter((service) => action === "stop" || service.launchable),
    );
    return [...repoServices, ...project.looseServices.filter((service) => action === "stop" || service.launchable)].map((service) => service.id);
  }
}

// ------------------------------------------------------------- helpers

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const isLive = (s: ServiceView) => s.status === "running" || s.status === "starting";

/** IANA dynamic/ephemeral range. A port the OS handed out is an internal
 *  detail, never the address you would open. */
const EPHEMERAL_FROM = 49152;

/** The ports worth showing ON a service row. toolboy's relay binds 8787 plus
 *  five miniflare control ports in the ephemeral range; listing all seven
 *  buries the only one you would ever click. The ports view still lists
 *  every socket — that one is explicitly the complete picture. */
function serviceAddresses(ports: number[]): number[] {
  const real = ports.filter((p) => p < EPHEMERAL_FROM);
  return real.length ? real : ports;
}

function wtLabel(wt: WT): string {
  return wt.branch ?? (wt.head ? `detached @${wt.head}` : basename(wt.path));
}

/** Launchers in the user's saved order, with anything unordered appended. */
function orderLaunchers(launchers: Launcher[], order: string[] | undefined): Launcher[] {
  if (!order?.length) return launchers;
  return [...launchers].sort((a, b) => {
    const ai = order.indexOf(a.role);
    const bi = order.indexOf(b.role);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });
}

function recordPorts(
  map: Map<string, { ports: number[]; label: string; kind: "process" | "docker"; pid: number | null }>,
  id: string,
  ports: number[],
  label: string,
  kind: "process" | "docker",
  pid: number | null,
) {
  if (!ports.length) return;
  map.set(id, { ports, label, kind, pid });
}

const HOME = homedir();
/** Devhub's own checkout. Reporting the daemon serving the page as a stray
 *  dev process is pure noise. */
const SELF_ROOT = resolve(fileURLToPath(import.meta.url), "../../../..");
const isSelf = (cwd: string) => cwd === SELF_ROOT || cwd.startsWith(`${SELF_ROOT}/`);

/** A directory that looks like somebody's checkout — worth surfacing as
 *  "running but devhub doesn't know about it" rather than filing under
 *  system noise like Dropbox or a menu-bar app. */
function looksLikeDevTree(cwd: string): boolean {
  if (cwd !== HOME && !cwd.startsWith(`${HOME}/`)) return false;
  return existsSync(join(cwd, "package.json")) || existsSync(join(cwd, ".git")) || existsSync(join(cwd, "Cargo.toml")) || existsSync(join(cwd, "go.mod"));
}
