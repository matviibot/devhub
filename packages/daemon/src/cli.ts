#!/usr/bin/env node

import { spawn } from "node:child_process";

type Json = Record<string, unknown>;

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
}

const args = process.argv.slice(2);
const group = args.shift();
const command = args.shift();
const separator = args.indexOf("--");
const childCommand = separator === -1 ? [] : args.slice(separator + 1);
const parsed = parseArgs(separator === -1 ? args : args.slice(0, separator));
const baseUrl = stringFlag(parsed, "daemon") ?? (group === "service" ? undefined : stringFlag(parsed, "url")) ?? process.env.DEVHUB_URL ?? "http://127.0.0.1:4317";
const asJson = boolFlag(parsed, "json");

try {
  if (group === "agent") await agentCommand(command, parsed, childCommand);
  else if (group === "project") await projectCommand(command, parsed);
  else if (group === "port") await portCommand(command, parsed);
  else if (group === "service") await serviceCommand(command, parsed);
  else if (group === "help" || group === "--help" || group === "-h" || !group) usage();
  else fail(`Unknown command "${group}"`);
} catch (err) {
  console.error(`devhub: ${(err as Error).message}`);
  process.exitCode = 1;
}

async function agentCommand(action: string | undefined, input: ParsedArgs, supervisedCommand: string[] = []) {
  if (action === "run") {
    await supervisedRun(input, supervisedCommand);
    return;
  }
  if (action === "start") {
    const task = stringFlag(input, "task") ?? input.positionals.join(" ");
    const agent = stringFlag(input, "agent") ?? process.env.DEVHUB_AGENT;
    if (!agent) fail('agent start needs --agent NAME (or DEVHUB_AGENT)');
    const body: Json = {
      agent,
      task,
      cwd: stringFlag(input, "cwd") ?? process.cwd(),
      status: stringFlag(input, "status") ?? "working",
    };
    assign(body, "id", stringFlag(input, "id") ?? process.env.DEVHUB_RUN_ID);
    assign(body, "projectName", stringFlag(input, "project-name"));
    assign(body, "sourcePath", stringFlag(input, "source"));
    assign(body, "detail", stringFlag(input, "detail"));
    assignNumber(body, "ttlMs", stringFlag(input, "ttl"));
    const result = await request("POST", "/api/agent-runs", body);
    output(result, () => {
      const run = result.run as Json;
      return `${run.id}\n${run.agent} is ${run.status} on ${run.projectId}${task ? `: ${task}` : ""}`;
    });
    return;
  }

  if (action === "update" || action === "heartbeat") {
    const id = requireId(input, action);
    const body: Json = {};
    assign(body, "agent", stringFlag(input, "agent"));
    assign(body, "task", stringFlag(input, "task"));
    assign(body, "status", stringFlag(input, "status"));
    assign(body, "detail", stringFlag(input, "detail"));
    assignNumber(body, "ttlMs", stringFlag(input, "ttl"));
    const result = await request("PATCH", `/api/agent-runs/${encodeURIComponent(id)}`, body);
    output(result, () => {
      const run = result.run as Json;
      return `${run.id} renewed · ${run.status}`;
    });
    return;
  }

  if (action === "finish") {
    const id = requireId(input, action);
    const status = boolFlag(input, "failed") ? "failed" : "done";
    const body: Json = { status };
    assign(body, "detail", stringFlag(input, "detail"));
    const result = await request("PATCH", `/api/agent-runs/${encodeURIComponent(id)}`, body);
    output(result, () => `${id} marked ${status}`);
    return;
  }

  if (action === "check") {
    const key = input.positionals[0];
    if (!key) fail("agent check needs a check key");
    const runId = requireRun(input, "agent check");
    const status = stringFlag(input, "status");
    if (status !== "pending" && status !== "ready" && status !== "blocked") fail("agent check needs --status pending, ready, or blocked");
    const result = await setRunCheck(runId, key, status, stringFlag(input, "label"), stringFlag(input, "detail"));
    output(result, () => `${key}\t${status}${stringFlag(input, "detail") ? `\t${stringFlag(input, "detail")}` : ""}`);
    return;
  }

  if (action === "uncheck") {
    const key = input.positionals[0];
    if (!key) fail("agent uncheck needs a check key");
    const runId = requireRun(input, "agent uncheck");
    const result = await request("DELETE", `/api/agent-runs/${encodeURIComponent(runId)}/checks/${encodeURIComponent(key)}`);
    output(result, () => `${key} removed`);
    return;
  }

  if (action === "release") {
    const id = requireId(input, action);
    const result = await request("DELETE", `/api/agent-runs/${encodeURIComponent(id)}`);
    output(result, () => `${id} released`);
    return;
  }

  if (action === "list") {
    const result = await request("GET", "/api/agent-runs");
    output(result, () => {
      const runs = result.runs as Json[];
      if (!runs.length) return "No agent runs.";
      return runs.map((run) => `${run.id}\t${run.status}\t${run.agent}\t${run.projectId}\t${run.task || ""}`).join("\n");
    });
    return;
  }

  if (action === "help" || !action) {
    usage();
    return;
  }
  fail(`Unknown agent command "${action}"`);
}

async function supervisedRun(input: ParsedArgs, command: string[]) {
  if (!command.length) fail("agent run needs a command after --");
  const task = (stringFlag(input, "task") ?? input.positionals.join(" ")) || command.join(" ");
  const agent = stringFlag(input, "agent") ?? process.env.DEVHUB_AGENT;
  if (!agent) fail('agent run needs --agent NAME (or DEVHUB_AGENT)');
  const cwd = stringFlag(input, "cwd") ?? process.cwd();
  const runBody: Json = { agent, task, cwd, status: "working" };
  assign(runBody, "id", stringFlag(input, "id") ?? process.env.DEVHUB_RUN_ID);
  assign(runBody, "projectName", stringFlag(input, "project-name"));
  assign(runBody, "sourcePath", stringFlag(input, "source"));
  assign(runBody, "detail", stringFlag(input, "detail"));
  assignNumber(runBody, "ttlMs", stringFlag(input, "ttl"));

  const started = await request("POST", "/api/agent-runs", runBody);
  const run = started.run as Json;
  const runId = String(run.id);
  const role = stringFlag(input, "role");
  let reservation: Json | undefined;
  let announcement: Json | undefined;
  let childStarted = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  try {
    await setRunCheck(runId, "workspace", "ready", "Workspace", cwd);
    if (role) {
      const reserveBody: Json = { runId, role };
      const range = stringFlag(input, "range");
      if (range) reserveBody.range = parseRange(range);
      assignNumber(reserveBody, "preferred", stringFlag(input, "preferred"));
      reservation = (await request("POST", "/api/ports/reserve", reserveBody)).reservation as Json;
      await setRunCheck(runId, "port", "ready", "Port", `:${reservation.port} reserved for ${role}`);
      if (!boolFlag(input, "no-announce")) {
        const port = Number(reservation.port);
        const announceBody: Json = { runId, role, port };
        const template = stringFlag(input, "service-url");
        if (template) announceBody.url = template.replaceAll("{port}", String(port));
        announcement = (await request("POST", "/api/services/announce", announceBody)).announcement as Json;
      }
    }

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      DEVHUB_URL: baseUrl,
      DEVHUB_RUN_ID: runId,
      DEVHUB_AGENT: agent,
      DEVHUB_PROJECT_ID: String(run.projectId),
    };
    if (reservation) childEnv[stringFlag(input, "port-env") ?? "PORT"] = String(reservation.port);

    console.error(`[devhub] ${agent} · ${runId} · ${task}`);
    if (reservation) console.error(`[devhub] reserved :${reservation.port} for ${role}`);
    if (announcement) console.error(`[devhub] announced ${announcement.url}`);

    await setRunCheck(runId, "command", "pending", "Command", command.join(" "));
    const child = spawn(command[0], command.slice(1), { cwd, env: childEnv, stdio: "inherit" });
    childStarted = true;
    const forward = (signal: NodeJS.Signals) => {
      if (!child.killed) child.kill(signal);
    };
    const onSigint = () => forward("SIGINT");
    const onSigterm = () => forward("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    const requestedTtl = stringFlag(input, "ttl") ? Number(stringFlag(input, "ttl")) : 300_000;
    const defaultHeartbeat = Number.isFinite(requestedTtl) ? Math.min(120_000, Math.max(1_000, Math.floor(requestedTtl / 2))) : 120_000;
    const heartbeatMs = numberFlag(input, "heartbeat", defaultHeartbeat, 1_000);
    heartbeat = setInterval(() => {
      void request("PATCH", `/api/agent-runs/${encodeURIComponent(runId)}`, {}).catch((err) => {
        console.error(`[devhub] heartbeat failed: ${(err as Error).message}`);
      });
    }, heartbeatMs);
    heartbeat.unref();

    const outcomePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolve) => {
      child.once("error", (error) => resolve({ code: null, signal: null, error }));
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    const spawned = await new Promise<boolean>((resolve) => {
      child.once("spawn", () => resolve(true));
      child.once("error", () => resolve(false));
    });
    if (spawned) await setRunCheck(runId, "command", "ready", "Command", `Running ${command[0]}`);
    const outcome = await outcomePromise;
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    if (heartbeat) clearInterval(heartbeat);

    const success = outcome.code === 0 && !outcome.error;
    const detail = outcome.error
      ? `Command could not start: ${outcome.error.message}`
      : outcome.signal
        ? `Command stopped by ${outcome.signal}`
        : `Command exited with code ${outcome.code ?? 1}`;
    await setRunCheck(runId, "command", success ? "ready" : "blocked", "Command", success ? "Completed successfully" : detail);
    await releaseResources(reservation, announcement);
    if (reservation) await removeRunCheck(runId, "port");
    await request("PATCH", `/api/agent-runs/${encodeURIComponent(runId)}`, {
      status: success ? "done" : "failed",
      detail: success ? stringFlag(input, "done-detail") ?? "Command completed successfully" : detail,
    });
    console.error(`[devhub] ${runId} ${success ? "completed" : "failed"}`);
    process.exitCode = success ? 0 : outcome.code && outcome.code > 0 ? outcome.code : 1;
  } catch (err) {
    if (heartbeat) clearInterval(heartbeat);
    await releaseResources(reservation, announcement);
    if (reservation) await removeRunCheck(runId, "port").catch(() => undefined);
    await setRunCheck(runId, "supervisor", "blocked", "Supervisor", (err as Error).message).catch(() => undefined);
    await request("PATCH", `/api/agent-runs/${encodeURIComponent(runId)}`, {
      status: "failed",
      detail: childStarted ? `Supervisor failed: ${(err as Error).message}` : `Setup failed: ${(err as Error).message}`,
    }).catch(() => undefined);
    throw err;
  }
}

function setRunCheck(runId: string, key: string, status: "pending" | "ready" | "blocked", label?: string, detail?: string): Promise<Json> {
  const body: Json = { status };
  assign(body, "label", label);
  assign(body, "detail", detail);
  return request("PUT", `/api/agent-runs/${encodeURIComponent(runId)}/checks/${encodeURIComponent(key)}`, body);
}

function removeRunCheck(runId: string, key: string): Promise<Json> {
  return request("DELETE", `/api/agent-runs/${encodeURIComponent(runId)}/checks/${encodeURIComponent(key)}`);
}

async function releaseResources(reservation: Json | undefined, announcement: Json | undefined) {
  const requests: Promise<Json>[] = [];
  if (announcement?.id) requests.push(request("DELETE", `/api/services/announcements/${encodeURIComponent(String(announcement.id))}`));
  if (reservation?.id) requests.push(request("DELETE", `/api/ports/reservations/${encodeURIComponent(String(reservation.id))}`));
  await Promise.allSettled(requests);
}

async function projectCommand(action: string | undefined, input: ParsedArgs) {
  if (action === "ensure") {
    const body: Json = { cwd: stringFlag(input, "cwd") ?? input.positionals[0] ?? process.cwd() };
    assign(body, "projectName", stringFlag(input, "name"));
    assign(body, "sourcePath", stringFlag(input, "source"));
    const result = await request("POST", "/api/projects/ensure", body);
    output(result, () => `${result.projectId}\t${result.workspacePath}${result.created ? "\tcreated" : ""}`);
    return;
  }
  if (action === "help" || !action) {
    usage();
    return;
  }
  fail(`Unknown project command "${action}"`);
}

async function portCommand(action: string | undefined, input: ParsedArgs) {
  if (action === "reserve") {
    const body: Json = {
      runId: requireRun(input, "port reserve"),
      role: requiredFlag(input, "role", "port reserve"),
    };
    const range = stringFlag(input, "range");
    if (range) body.range = parseRange(range);
    assignNumber(body, "preferred", stringFlag(input, "preferred"));
    const result = await request("POST", "/api/ports/reserve", body);
    output(result, () => {
      const reservation = result.reservation as Json;
      return `${reservation.port}\n${reservation.id}\nreserved for ${reservation.role}`;
    });
    return;
  }
  if (action === "release") {
    const id = requireResourceId(input, "port release");
    const result = await request("DELETE", `/api/ports/reservations/${encodeURIComponent(id)}`);
    output(result, () => `${id} released`);
    return;
  }
  if (action === "help" || !action) return usage();
  fail(`Unknown port command "${action}"`);
}

async function serviceCommand(action: string | undefined, input: ParsedArgs) {
  if (action === "announce") {
    const body: Json = {
      runId: requireRun(input, "service announce"),
      role: requiredFlag(input, "role", "service announce"),
    };
    assignNumber(body, "port", stringFlag(input, "port"));
    assign(body, "url", stringFlag(input, "url") ?? stringFlag(input, "service-url"));
    const result = await request("POST", "/api/services/announce", body);
    output(result, () => {
      const announcement = result.announcement as Json;
      return `${announcement.url}\n${announcement.id}\nannounced as ${announcement.role}`;
    });
    return;
  }
  if (action === "release") {
    const id = requireResourceId(input, "service release");
    const result = await request("DELETE", `/api/services/announcements/${encodeURIComponent(id)}`);
    output(result, () => `${id} released`);
    return;
  }
  if (action === "list") {
    const result = await request("GET", "/api/resources");
    output(result, () => {
      const announcements = result.serviceAnnouncements as Json[];
      if (!announcements.length) return "No announced services.";
      return announcements.map((item) => `${item.id}\t${item.status}\t${item.role}\t${item.url}`).join("\n");
    });
    return;
  }
  if (action === "help" || !action) return usage();
  fail(`Unknown service command "${action}"`);
}

async function request(method: string, path: string, body?: Json): Promise<Json> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`can't reach the DevHub daemon at ${baseUrl}`);
  }
  const result = (await response.json()) as Json;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `request failed (${response.status})`);
  return result;
}

function parseArgs(values: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const [rawName, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) flags.set(rawName, inline);
    else if (values[i + 1] && !values[i + 1].startsWith("--")) flags.set(rawName, values[++i]);
    else flags.set(rawName, true);
  }
  return { positionals, flags };
}

function stringFlag(input: ParsedArgs, name: string): string | undefined {
  const value = input.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function boolFlag(input: ParsedArgs, name: string): boolean {
  return input.flags.get(name) === true;
}

function numberFlag(input: ParsedArgs, name: string, fallback: number, minimum: number): number {
  const value = stringFlag(input, name);
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) fail(`--${name} needs a number of at least ${minimum}`);
  return number;
}

function requireId(input: ParsedArgs, action: string): string {
  const id = input.positionals[0] ?? stringFlag(input, "id") ?? process.env.DEVHUB_RUN_ID;
  if (!id) fail(`agent ${action} needs a run id`);
  return id;
}

function requireRun(input: ParsedArgs, action: string): string {
  const id = stringFlag(input, "run") ?? process.env.DEVHUB_RUN_ID;
  if (!id) fail(`${action} needs --run ID (or DEVHUB_RUN_ID)`);
  return id;
}

function requireResourceId(input: ParsedArgs, action: string): string {
  const id = input.positionals[0] ?? stringFlag(input, "id");
  if (!id) fail(`${action} needs a resource id`);
  return id;
}

function requiredFlag(input: ParsedArgs, name: string, action: string): string {
  const value = stringFlag(input, name);
  if (!value) fail(`${action} needs --${name.toUpperCase()}`);
  return value;
}

function parseRange(value: string): [number, number] {
  const match = value.match(/^(\d+):(\d+)$/);
  if (!match) fail("--range needs FROM:TO");
  return [Number(match[1]), Number(match[2])];
}

function assign(target: Json, key: string, value: string | undefined) {
  if (value !== undefined) target[key] = value;
}

function assignNumber(target: Json, key: string, value: string | undefined) {
  if (value === undefined) return;
  const number = Number(value);
  if (!Number.isFinite(number)) fail(`--${key === "ttlMs" ? "ttl" : key} needs a number`);
  target[key] = number;
}

function output(value: Json, human: () => string) {
  console.log(asJson ? JSON.stringify(value, null, 2) : human());
}

function fail(message: string): never {
  throw new Error(message);
}

function usage() {
  console.log(`DevHub CLI

Usage:
  devhub agent run [TASK] --agent NAME [--role NAME] [--range FROM:TO] -- COMMAND [ARGS...]
  devhub agent start [TASK] --agent NAME [--cwd PATH] [--id ID]
  devhub agent update ID [--task TEXT] [--status STATE] [--detail TEXT]
  devhub agent heartbeat ID
  devhub agent check KEY --run ID --status pending|ready|blocked [--detail TEXT]
  devhub agent uncheck KEY --run ID
  devhub agent finish ID [--detail TEXT] [--failed]
  devhub agent release ID
  devhub agent list
  devhub project ensure [PATH] [--name NAME] [--source PATH]
  devhub port reserve --run ID --role NAME [--range FROM:TO] [--preferred PORT]
  devhub port release RESERVATION_ID
  devhub service announce --run ID --role NAME [--port PORT] [--url URL]
  devhub service release ANNOUNCEMENT_ID
  devhub service list

Global flags:
  --daemon URL daemon URL (default http://127.0.0.1:4317)
  --json       print the full JSON response

Environment:
  DEVHUB_URL, DEVHUB_AGENT, DEVHUB_RUN_ID

Agent run options:
  --role NAME          reserve and announce a service role
  --range FROM:TO      reservation range (default 3000:3999)
  --preferred PORT     preferred port when available
  --port-env NAME      child port variable (default PORT)
  --service-url URL    announced URL; {port} is replaced
  --no-announce        reserve without announcing a service
  --heartbeat MS       lease renewal interval (default 120000)`);
}
