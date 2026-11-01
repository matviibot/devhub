import { randomUUID } from "node:crypto";
import type { AgentRun, PortReservation, PortRow, ServiceAnnouncement } from "@devhub/shared";
import type { AgentRegistry } from "./agentRegistry.js";

const DEFAULT_RANGE: [number, number] = [3000, 3999];

/** Leased coordination state owned by agent runs.
 *
 * A reservation prevents two cooperating agents from choosing the same port.
 * An announcement describes intent. Only the observed socket table can
 * promote an announcement to `running`. */
export class ResourceRegistry {
  private reservations = new Map<string, PortReservation>();
  private announcements = new Map<string, ServiceAnnouncement>();

  constructor(private agents: AgentRegistry) {}

  reserve(input: { runId: string; role: string; range?: [number, number]; preferred?: number }, observed: PortRow[]): PortReservation {
    this.prune(new Set(this.agents.list().map((run) => run.id)));
    const run = this.requireRun(input.runId);
    const role = cleanRole(input.role);
    const key = resourceKey(run.id, role);
    const existing = [...this.reservations.values()].find((item) => resourceKey(item.runId, item.role) === key);
    if (existing) return existing;

    const [from, to] = validRange(input.range ?? DEFAULT_RANGE);
    const occupied = new Set([
      ...observed.map((row) => row.port),
      ...[...this.reservations.values()].map((item) => item.port),
    ]);
    let port: number | undefined;
    if (input.preferred != null) {
      if (!Number.isInteger(input.preferred) || input.preferred < from || input.preferred > to) {
        throw new Error(`Preferred port must be inside ${from}:${to}`);
      }
      if (!occupied.has(input.preferred)) port = input.preferred;
    }
    if (port == null) {
      const size = to - from + 1;
      const seed = hash(`${run.workspacePaths.join("\0")}\0${role}`) % size;
      for (let offset = 0; offset < size; offset += 1) {
        const candidate = from + ((seed + offset) % size);
        if (!occupied.has(candidate)) {
          port = candidate;
          break;
        }
      }
    }
    if (port == null) throw new Error(`No free port is available in ${from}:${to}`);

    const reservation: PortReservation = {
      id: randomUUID(),
      runId: run.id,
      projectId: run.projectId,
      role,
      port,
      createdAt: Date.now(),
    };
    this.reservations.set(reservation.id, reservation);
    return reservation;
  }

  announce(input: { runId: string; role: string; port?: number; url?: string }): ServiceAnnouncement {
    const run = this.requireRun(input.runId);
    const role = cleanRole(input.role);
    const reservation = [...this.reservations.values()].find((item) => item.runId === run.id && item.role === role);
    const port = input.port ?? reservation?.port ?? portFromUrl(input.url);
    if (!Number.isInteger(port) || port! < 1 || port! > 65535) throw new Error("A valid service port is required");
    const url = input.url?.trim() || `http://localhost:${port}`;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Service URL is invalid");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Service URL must use http or https");

    const key = resourceKey(run.id, role);
    const existing = [...this.announcements.values()].find((item) => resourceKey(item.runId, item.role) === key);
    const announcement: ServiceAnnouncement = {
      id: existing?.id ?? randomUUID(),
      runId: run.id,
      projectId: run.projectId,
      role,
      url,
      port: port!,
      status: "declared",
      updatedAt: Date.now(),
    };
    this.announcements.set(announcement.id, announcement);
    return announcement;
  }

  snapshot(observed: PortRow[], liveRuns: AgentRun[]) {
    this.prune(new Set(liveRuns.map((run) => run.id)));
    const listening = new Set(observed.map((row) => row.port));
    return {
      portReservations: [...this.reservations.values()].sort((a, b) => a.port - b.port),
      serviceAnnouncements: [...this.announcements.values()]
        .map((item) => ({ ...item, status: listening.has(item.port) ? "running" as const : "declared" as const }))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    };
  }

  releaseReservation(id: string): boolean {
    return this.reservations.delete(id);
  }

  releaseAnnouncement(id: string): boolean {
    return this.announcements.delete(id);
  }

  releaseRun(runId: string) {
    for (const [id, item] of this.reservations) if (item.runId === runId) this.reservations.delete(id);
    for (const [id, item] of this.announcements) if (item.runId === runId) this.announcements.delete(id);
  }

  private requireRun(id: string): AgentRun {
    const run = this.agents.get(id.trim());
    if (!run) throw new Error(`Agent run "${id}" was not found or its lease expired`);
    return run;
  }

  private prune(live: Set<string>) {
    for (const [id, item] of this.reservations) if (!live.has(item.runId)) this.reservations.delete(id);
    for (const [id, item] of this.announcements) if (!live.has(item.runId)) this.announcements.delete(id);
  }
}

function cleanRole(role: string): string {
  const value = role.trim();
  if (!value) throw new Error("A resource role is required");
  return value;
}

function validRange(range: [number, number]): [number, number] {
  const [from, to] = range;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 65535 || from > to) {
    throw new Error("Port range must contain two valid ports in ascending order");
  }
  return range;
}

function portFromUrl(value: string | undefined): number | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return undefined;
  }
}

function resourceKey(runId: string, role: string): string {
  return `${runId}\0${role}`;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}
