# DevHub

DevHub is a local control surface for developers working with coding agents.
Projects are the primary objects; worktrees, repositories, runtimes, ports,
agent tasks, and readiness checks are supporting context.

The daemon observes the machine instead of persisting everything it once saw.
Git worktrees and listening processes are discovered live. Configuration only
contains durable project sources and optional launchers, which prevents stale
worktrees and dead servers from accumulating in the UI.

## Start

```sh
npm install
npm run build
npm start
```

Open [http://localhost:4317](http://localhost:4317). Copy
`devhub.config.example.json` to `devhub.config.json` for manual setup, or let
an agent register the repository automatically.

For frontend and daemon watch mode:

```sh
npm run dev
```

## Agent-first workflow

The supervised runner is the shortest complete integration:

```sh
npm run devhub -- agent run "Implement account settings" \
  --agent Codex \
  --role web \
  --range 3100:3199 \
  -- npm run dev
```

It registers the current repository or worktree, maintains agent presence,
reserves a port, injects `PORT`, announces the preview, forwards termination
signals, releases resources, and leaves a short done/failed handoff.

Nested tools receive `DEVHUB_RUN_ID`, `DEVHUB_PROJECT_ID`, `DEVHUB_AGENT`, and
`DEVHUB_URL`. They can report structured workspace readiness:

```sh
npm run devhub -- agent check dependencies --status ready \
  --detail "pnpm install is current"

npm run devhub -- agent check database --status blocked \
  --detail "Postgres is unavailable"
```

Blocked checks appear in the project tile, Active work, workspace detail, and
Attention view. Full HTTP and CLI contracts are documented in
[`docs/agent-api.md`](docs/agent-api.md).

## Mental model

- **Project** — a product or system, possibly spanning multiple repositories.
- **Workspace** — one logical branch context; worktrees with the same branch
  across repositories are grouped together.
- **Runtime** — a process or container DevHub independently observes.
- **Launcher** — an optional durable command inherited by every worktree.
- **Agent run** — leased task presence that disappears if heartbeats stop.
- **Readiness check** — leased, structured setup state reported by an agent.
- **Announcement** — an intended service URL; it is not marked running until
  the daemon observes its port.

## Configuration

The durable schema is deliberately small:

```json
{
  "projects": [
    {
      "id": "my-app",
      "name": "My App",
      "icon": "public/icon.svg",
      "repos": [
        {
          "path": "~/dev/my-app",
          "launchers": [
            {
              "role": "web",
              "cmd": "npm run dev",
              "policy": {
                "ports": "alloc",
                "range": [3100, 3199],
                "env": "PORT"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

Use `fixed` when a service hardcodes its ports and only one worktree may run
it. Use `alloc` when the command accepts a port through an environment
variable. `icon` may be absolute, `~/...`, or relative to the first repo.
The Projects hub starts launchers from each repo's primary checkout and stops
all observed runtimes belonging to the project. See
[`docs/design-observation-first.md`](docs/design-observation-first.md)
for the complete rationale.
