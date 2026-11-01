import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { ActivityEvent, AgentRun, ProjectView, ServiceStatus, Snapshot } from "@devhub/shared";
import { CONFIG_PATH } from "./config.js";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PER_PROJECT = 200;
export const ACTIVITY_PATH = process.env.DEVHUB_ACTIVITY ?? join(dirname(CONFIG_PATH), "devhub.activity.json");

interface ServiceFact {
  projectId: string;
  workspacePath: string | null;
  serviceId: string;
  name: string;
  status: ServiceStatus;
}

const serviceFacts = (projects: ProjectView[]) => {
  const facts = new Map<string, ServiceFact>();
  for (const project of projects) {
    for (const repo of project.repos) {
      for (const worktree of repo.worktrees) {
        for (const service of worktree.services) facts.set(service.id, { projectId: project.id, workspacePath: worktree.path, serviceId: service.id, name: service.displayName, status: service.status });
      }
    }
    for (const service of project.looseServices) facts.set(service.id, { projectId: project.id, workspacePath: null, serviceId: service.id, name: service.displayName, status: service.status });
  }
  return facts;
};

const runMap = (runs: AgentRun[]) => new Map(runs.map((run) => [run.id, run]));

const validEvent = (value: unknown): value is ActivityEvent => {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<ActivityEvent>;
  return typeof event.id === "string" && typeof event.projectId === "string" && typeof event.kind === "string" && typeof event.message === "string" && typeof event.observedAt === "number";
};

export class ActivityStore {
  private events: ActivityEvent[];

  constructor(private path = ACTIVITY_PATH) {
    this.events = this.load();
    this.prune();
  }

  list(): ActivityEvent[] {
    return [...this.events];
  }

  record(previous: Snapshot | null, next: Snapshot): void {
    if (!previous) return;
    const now = Date.now();
    const additions: ActivityEvent[] = [];
    const beforeServices = serviceFacts(previous.projects);
    const afterServices = serviceFacts(next.projects);

    for (const [id, after] of afterServices) {
      const before = beforeServices.get(id);
      if (!before || before.status === after.status) continue;
      let kind: ActivityEvent["kind"] | null = null;
      let message = "";
      if (after.status === "running" && before.status !== "running") {
        kind = "service-started";
        message = `${after.name} started`;
      } else if (after.status === "crashed") {
        kind = "service-crashed";
        message = `${after.name} crashed`;
      } else if (after.status === "stopped" && (before.status === "running" || before.status === "starting")) {
        kind = "service-stopped";
        message = `${after.name} stopped`;
      }
      if (kind) additions.push(this.event(after.projectId, kind, message, now, after.workspacePath, after.serviceId));
    }

    const beforeRuns = runMap(previous.agentRuns);
    for (const run of next.agentRuns) {
      const before = beforeRuns.get(run.id);
      const changed = !before || before.status !== run.status;
      if (changed && run.status === "waiting") additions.push(this.event(run.projectId, "agent-waiting", run.task ? `${run.agent} is waiting: ${run.task}` : `${run.agent} is waiting`, now, run.workspacePaths[0] ?? null, null));
      if (changed && run.status === "done") additions.push(this.event(run.projectId, "agent-finished", run.task ? `${run.agent} finished: ${run.task}` : `${run.agent} finished`, now, run.workspacePaths[0] ?? null, null));
      if (changed && run.status === "failed") additions.push(this.event(run.projectId, "agent-failed", run.detail || (run.task ? `${run.agent} failed: ${run.task}` : `${run.agent} failed`), now, run.workspacePaths[0] ?? null, null));
      const beforeBlocked = new Set((before?.checks ?? []).filter((check) => check.status === "blocked").map((check) => check.key));
      for (const check of run.checks.filter((item) => item.status === "blocked" && !beforeBlocked.has(item.key))) {
        additions.push(this.event(run.projectId, "blocker", check.detail || `${check.label} is blocked`, now, run.workspacePaths[0] ?? null, null));
      }
    }

    if (!additions.length) return;
    this.events.unshift(...additions);
    this.prune();
    this.write();
  }

  private event(projectId: string, kind: ActivityEvent["kind"], message: string, observedAt: number, workspacePath: string | null, serviceId: string | null): ActivityEvent {
    return { id: randomUUID(), projectId, workspacePath, serviceId, kind, message, observedAt };
  }

  private load(): ActivityEvent[] {
    if (!existsSync(this.path)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf-8")) as unknown;
      return Array.isArray(parsed) ? parsed.filter(validEvent).sort((a, b) => b.observedAt - a.observedAt) : [];
    } catch {
      return [];
    }
  }

  private prune() {
    const cutoff = Date.now() - RETENTION_MS;
    const counts = new Map<string, number>();
    this.events = this.events.filter((event) => {
      if (event.observedAt < cutoff) return false;
      const count = counts.get(event.projectId) ?? 0;
      if (count >= MAX_PER_PROJECT) return false;
      counts.set(event.projectId, count + 1);
      return true;
    });
  }

  private write() {
    writeFileSync(this.path, `${JSON.stringify(this.events, null, 2)}\n`, "utf-8");
  }
}
