import { randomUUID } from "node:crypto";
import type { AgentCheck, AgentRun } from "@devhub/shared";

const ACTIVE_LEASE_MS = 5 * 60_000;
const HANDOFF_LEASE_MS = 30 * 60_000;
const MAX_LEASE_MS = 60 * 60_000;

export interface RegisterAgentRun {
  id?: string;
  agent: string;
  task?: string;
  projectId: string;
  workspacePaths: string[];
  status?: AgentRun["status"];
  detail?: string | null;
  checks?: AgentCheck[];
  ttlMs?: number;
}

export interface UpdateAgentRun {
  agent?: string;
  task?: string;
  projectId?: string;
  workspacePaths?: string[];
  status?: AgentRun["status"];
  detail?: string | null;
  checks?: AgentCheck[];
  ttlMs?: number;
}

/** In-memory, lease-based agent presence.
 *
 * There is deliberately no file backing this registry. A run describes who
 * is acting now, not a reusable declaration, and therefore must not survive a
 * daemon restart or an agent that stopped heartbeating. */
export class AgentRegistry {
  private runs = new Map<string, AgentRun>();

  list(now = Date.now()): AgentRun[] {
    for (const [id, run] of this.runs) if (run.expiresAt <= now) this.runs.delete(id);
    return [...this.runs.values()].sort((a, b) => {
      const rank = (run: AgentRun) => (run.status === "waiting" ? 0 : run.status === "working" ? 1 : run.status === "failed" ? 2 : 3);
      return rank(a) - rank(b) || b.updatedAt - a.updatedAt;
    });
  }

  get(id: string, now = Date.now()): AgentRun | undefined {
    const run = this.runs.get(id);
    if (run && run.expiresAt > now) return run;
    if (run) this.runs.delete(id);
    return undefined;
  }

  register(input: RegisterAgentRun): AgentRun {
    const agent = input.agent.trim();
    if (!agent) throw new Error("An agent run needs an agent name");
    if (!input.projectId.trim()) throw new Error("An agent run needs a project");
    const workspacePaths = cleanPaths(input.workspacePaths);
    if (!workspacePaths.length) throw new Error("An agent run needs at least one workspace path");

    const now = Date.now();
    const candidate = input.id ? this.runs.get(input.id) : undefined;
    const existing = candidate && candidate.expiresAt > now ? candidate : undefined;
    if (candidate && !existing) this.runs.delete(candidate.id);
    const status = input.status ?? existing?.status ?? "working";
    const run: AgentRun = {
      id: input.id?.trim() || randomUUID(),
      agent,
      task: input.task?.trim() ?? existing?.task ?? "",
      projectId: input.projectId.trim(),
      workspacePaths,
      status,
      detail: input.detail === undefined ? existing?.detail ?? null : input.detail?.trim() || null,
      checks: input.checks === undefined ? existing?.checks ?? [] : input.checks.map(cleanCheck),
      startedAt: existing?.startedAt ?? now,
      updatedAt: now,
      expiresAt: now + leaseFor(status, input.ttlMs),
    };
    this.runs.set(run.id, run);
    return run;
  }

  update(id: string, patch: UpdateAgentRun): AgentRun {
    const current = this.runs.get(id);
    if (!current || current.expiresAt <= Date.now()) {
      this.runs.delete(id);
      throw new Error(`Agent run "${id}" was not found or its lease expired`);
    }
    return this.register({
      id,
      agent: patch.agent ?? current.agent,
      task: patch.task ?? current.task,
      projectId: patch.projectId ?? current.projectId,
      workspacePaths: patch.workspacePaths ?? current.workspacePaths,
      status: patch.status ?? current.status,
      detail: patch.detail === undefined ? current.detail : patch.detail,
      checks: patch.checks ?? current.checks,
      ttlMs: patch.ttlMs,
    });
  }

  release(id: string): boolean {
    return this.runs.delete(id);
  }

  setCheck(id: string, key: string, input: { label?: string; status: AgentCheck["status"]; detail?: string | null }): AgentRun {
    const current = this.get(id);
    if (!current) throw new Error(`Agent run "${id}" was not found or its lease expired`);
    const cleanKey = key.trim();
    if (!cleanKey || !/^[a-zA-Z0-9._-]+$/.test(cleanKey)) throw new Error("Check key may contain letters, numbers, dots, dashes, and underscores");
    const prior = current.checks.find((check) => check.key === cleanKey);
    const check = cleanCheck({
      key: cleanKey,
      label: input.label?.trim() || prior?.label || humanize(cleanKey),
      status: input.status,
      detail: input.detail === undefined ? prior?.detail ?? null : input.detail,
      updatedAt: Date.now(),
    });
    return this.update(id, { checks: [...current.checks.filter((item) => item.key !== cleanKey), check] });
  }

  removeCheck(id: string, key: string): AgentRun {
    const current = this.get(id);
    if (!current) throw new Error(`Agent run "${id}" was not found or its lease expired`);
    return this.update(id, { checks: current.checks.filter((check) => check.key !== key) });
  }
}

function cleanCheck(check: AgentCheck): AgentCheck {
  const key = check.key.trim();
  const label = check.label.trim();
  if (!key || !label) throw new Error("A readiness check needs a key and label");
  if (check.status !== "pending" && check.status !== "ready" && check.status !== "blocked") throw new Error("Invalid readiness status");
  return { key, label, status: check.status, detail: check.detail?.trim() || null, updatedAt: check.updatedAt || Date.now() };
}

function humanize(value: string): string {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cleanPaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.trim().replace(/\/$/, "")).filter(Boolean))];
}

function leaseFor(status: AgentRun["status"], requested?: number): number {
  const fallback = status === "done" || status === "failed" ? HANDOFF_LEASE_MS : ACTIVE_LEASE_MS;
  if (requested == null || !Number.isFinite(requested)) return fallback;
  return Math.max(10_000, Math.min(MAX_LEASE_MS, Math.round(requested)));
}
