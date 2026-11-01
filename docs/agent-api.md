# DevHub agent presence API

DevHub exposes a small HTTP API on the daemon's local address. It is designed
for coding agents and shell integrations; it does not depend on the web UI or
on a particular agent vendor.

The API accepts loopback connections only. Examples below assume the default
daemon address, `http://127.0.0.1:4317`.

## CLI

After `npm run build`, the repository exposes the same contract through a
small dependency-free CLI:

```sh
npm run devhub -- agent start "Fix notification preferences" \
  --agent Codex \
  --cwd "$PWD" \
  --id codex-task-42

npm run devhub -- agent heartbeat codex-task-42
npm run devhub -- agent update codex-task-42 --status waiting \
  --detail "Choose whether archived notifications remain searchable"
npm run devhub -- agent finish codex-task-42 --detail "Implemented and tested"
npm run devhub -- agent release codex-task-42
```

When the daemon package is linked or installed, the command is simply
`devhub`. `DEVHUB_AGENT`, `DEVHUB_RUN_ID`, and `DEVHUB_URL` can replace their
corresponding flags. Add `--json` when another program will consume the
response.

### Supervise a command

For the normal agent workflow, `agent run` manages the entire lifecycle:

```sh
devhub agent run "Implement account settings" \
  --agent Codex \
  --role web \
  --range 3100:3199 \
  -- npm run dev
```

It registers the current project and task, reserves a port, puts that port in
the child process's `PORT` environment variable, announces the preview,
renews the agent lease, and forwards `SIGINT`/`SIGTERM`. When the command
finishes, its resources are released and DevHub retains a short `done` or
`failed` handoff with the exit result.

The child also receives `DEVHUB_RUN_ID`, `DEVHUB_PROJECT_ID`, `DEVHUB_AGENT`,
and `DEVHUB_URL`, so nested tools can update the same run. Useful options are:

- `--port-env VITE_PORT` to inject the selected port under another name;
- `--preferred 3142` to request a port when it is available;
- `--service-url 'http://app.local:{port}'` to customize the preview URL;
- `--no-announce` when the port is internal and has no browser endpoint;
- `--done-detail TEXT` to improve the successful handoff message.

The supervisor reports three readiness checks automatically: workspace
context, any reserved port, and child-command state.

### Report workspace readiness

Agents can add project-specific checks to the same run. Inside a supervised
child, `DEVHUB_RUN_ID` supplies `--run` automatically:

```sh
devhub agent check dependencies --status ready \
  --detail "pnpm install is current"

devhub agent check database --status blocked \
  --detail "Postgres container is not accepting connections"

devhub agent check migrations --status pending
devhub agent uncheck migrations
```

Check keys are stable machine identifiers; `--label` can provide a nicer
display name. A blocked check promotes its project into DevHub's Attention
view and is shown on the project tile, active-work row, and workspace detail.
Checks share the agent run's lease and therefore cannot become permanent
stale configuration.

The HTTP form is idempotent by run and key:

```sh
curl -X PUT \
  http://127.0.0.1:4317/api/agent-runs/codex-task-42/checks/database \
  -H 'content-type: application/json' \
  --data '{"status":"blocked","label":"Database","detail":"Postgres is unavailable"}'
```

## Reserve a port and announce a service

An agent can claim a port before it launches a process, then advertise the
endpoint it intends to provide:

```sh
npm run devhub -- port reserve \
  --run codex-task-42 --role web --range 3100:3199

npm run devhub -- service announce \
  --run codex-task-42 --role web --url http://localhost:3142
```

The reserve command prints the chosen port first, so shell integrations can
pass it to a child process. Repeating the same run/role request returns the
same reservation. DevHub excludes both observed listeners and other live
reservations while choosing a port.

Announcements are intent, not runtime truth. They appear as `declared` until
DevHub's independent socket scan observes the announced port, at which point
their computed status becomes `running`. Agents cannot set that status.

The HTTP equivalents are:

```sh
curl -X POST http://127.0.0.1:4317/api/ports/reserve \
  -H 'content-type: application/json' \
  --data '{"runId":"codex-task-42","role":"web","range":[3100,3199]}'

curl -X POST http://127.0.0.1:4317/api/services/announce \
  -H 'content-type: application/json' \
  --data '{"runId":"codex-task-42","role":"web","port":3142}'
```

`GET /api/resources` returns both live reservations and announcements.
Releasing an agent run also releases every resource it owns. Individual
resources can be released using their returned IDs:

```sh
devhub port release RESERVATION_ID
devhub service release ANNOUNCEMENT_ID
```

## Start or renew a run

```sh
curl -X POST http://127.0.0.1:4317/api/agent-runs \
  -H 'content-type: application/json' \
  --data '{
    "id": "codex-task-42",
    "agent": "Codex",
    "task": "Fix notification preferences",
    "cwd": "/Users/me/dev/notqa--danger-tweaks",
    "status": "working"
  }'
```

`cwd` is resolved against DevHub's live worktree list. If it belongs to no
known project, DevHub creates the minimal project entry automatically:

- for a Git worktree, the repository's primary checkout becomes the source;
- for a non-Git directory, `cwd` itself becomes the source;
- `projectName` and `sourcePath` may be supplied to override those defaults.

An agent may instead send `projectId` and `workspacePaths` explicitly.

Providing the same `id` again renews and replaces that run while preserving
its original `startedAt`. Active leases default to five minutes, so an agent
should renew approximately every two minutes. `ttlMs` can request a lease from
10 seconds up to one hour.

## Update or heartbeat

```sh
curl -X PATCH http://127.0.0.1:4317/api/agent-runs/codex-task-42 \
  -H 'content-type: application/json' \
  --data '{
    "status": "waiting",
    "detail": "Choose whether archived notifications remain searchable"
  }'
```

Every update renews the lease. Supported states are:

- `working` — actively progressing;
- `waiting` — needs developer input or approval;
- `done` — completed handoff;
- `failed` — stopped with a useful failure to review.

`done` and `failed` default to a 30-minute lease so their outcome remains
visible briefly without becoming permanent history.

## Release

```sh
curl -X DELETE http://127.0.0.1:4317/api/agent-runs/codex-task-42
```

Release removes the run immediately. Agents should release runs they no
longer want shown; leases are the crash-safe fallback.

## Inspect current runs

```sh
curl http://127.0.0.1:4317/api/agent-runs
```

## Ensure only the project/workspace

Agents that are not ready to announce a task can register the development
context independently:

```sh
curl -X POST http://127.0.0.1:4317/api/projects/ensure \
  -H 'content-type: application/json' \
  --data '{"cwd":"/Users/me/dev/my-app--feature"}'
```

The response contains `projectId`, `repoPath`, `workspacePath`, and whether a
new project was created.

Agent runs, port reservations, and service announcements are deliberately not
written to `devhub.config.json`. Projects and repository sources are durable
declarations; coordination and presence are leased runtime state.
