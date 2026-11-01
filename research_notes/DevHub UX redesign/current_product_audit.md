# DevHub current product audit

## What is DevHub's intended purpose and who are its likely primary users?

### Takeaway
DevHub is not a generic infrastructure dashboard. It is a local, agent-aware work-resumption and runtime-control surface for developers who use multiple Git worktrees and coding agents concurrently. Its differentiated job is to reconcile declared intent (agent task, launcher, port reservation, announced preview) with independently observed machine truth (worktree, process, container, listener), then make exceptions and recovery actions legible.

### Cited Findings
- The README defines DevHub as “a local control surface for developers working with coding agents,” makes projects primary, and explicitly places worktrees, repositories, runtimes, ports, agent tasks, and readiness checks in supporting roles. — [README.md lines 1–10](/Users/admin/dev/devhub/README.md#L1)
- The documented happy path is agent-first: `agent run` registers the current repo/worktree, maintains presence, reserves and injects a port, announces a preview, forwards termination signals, releases resources, and leaves a done/failed handoff. — [README.md lines 30–47](/Users/admin/dev/devhub/README.md#L30)
- Agents can publish structured readiness checks such as dependencies or database status, and blocked checks are deliberately repeated in the project tile, Active work, workspace detail, and Attention view. — [README.md lines 47–59](/Users/admin/dev/devhub/README.md#L47)
- The product model sharply separates durable declarations from live observations: config contains projects, repositories, and launchers, while views are recomputed and never survive restart. — [shared model lines 1–7](/Users/admin/dev/devhub/packages/shared/src/index.ts#L1)
- The workspace model joins same-branch worktrees across multiple repos into one logical context rather than exposing repository topology as the primary object. — [README.md lines 61–71](/Users/admin/dev/devhub/README.md#L61); [workspace grouping implementation](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L213)
- A launcher is inherited by every worktree, fixed-port launchers preempt siblings, and allocated-port launchers assign a deterministic per-worktree port. This makes simultaneous feature worktrees a first-class case, not an edge case. — [shared model lines 11–38](/Users/admin/dev/devhub/packages/shared/src/index.ts#L11)
- The data model distinguishes an agent’s declared service URL from an actually observed listener; an announcement becomes “running” only after daemon verification. — [shared model lines 192–213](/Users/admin/dev/devhub/packages/shared/src/index.ts#L192)
- Orphan processes and containers whose worktrees disappeared are explicitly described in the model as “the highest-value thing devhub shows.” — [shared model lines 216–236](/Users/admin/dev/devhub/packages/shared/src/index.ts#L216)
- The prior observation-first design arose because stale configuration produced false alarms while real leaked processes remained invisible; the redesign intentionally made observation primary and bootstrapping explicit. — [observation-first problem statement](/Users/admin/dev/devhub/docs/design-observation-first.md#L8); [observation-first decisions](/Users/admin/dev/devhub/docs/design-observation-first.md#L62)

### Inferences
- The primary user is likely a solo developer or small technical team member operating several local codebases/worktrees with coding agents, not a production SRE team. The local daemon, Finder reveal actions, localhost previews, Git worktree grouping, and ephemeral agent leases all point to that audience.
- The highest-value user questions are: “What should I resume?”, “What is waiting on me?”, “What is actually running for this work?”, “Can I open it?”, and “What leaked or collided?” A resource-inventory dashboard is only one supporting representation of those questions.
- DevHub’s strongest product moat is trust. It can compare agent intent to observed machine state and explain mismatches. Visual polish should amplify that distinction rather than make DevHub resemble a generic deployment dashboard.
- The product should be evaluated as a coordination tool with control-plane capabilities, not as a passive monitor. An interface that merely lists accurate processes would underuse the agent task, readiness, reservation, and handoff model already present.

### Gaps
- The repository contains no explicit personas, interview notes, telemetry, or task-frequency data, so user segments and relative workflow frequency are inferred from code and documentation.
- It is unclear whether DevHub is intended strictly for its author’s machine, for a small expert cohort, or for broader distribution. This changes how much onboarding and terminology explanation the design needs.
- It is unclear whether multiple people ever view the same daemon or whether all state is single-user; the UI and preferences appear single-user, but this is not documented.

## What are the current navigation, page hierarchy, primary workflows, and data model?

### Takeaway
The current interface is a top-navigation launchpad with five global views and a drill-down workspace page. It has already moved away from a monitoring rail toward project cards and agent-centric views, but it still distributes the core “resume and act” loop across separate Projects, Active, Attention, Ports, and project-detail surfaces.

### Cited Findings
- Dashboard state defines six page kinds: home, active, project, attention, ports, and unowned. Projects, Active, and Attention are visible top-level navigation at non-compact widths; Ports, Not in a project, and Add project live in the overflow menu. — [Dashboard view model and router](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L23); [header navigation](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L333)
- Search appears only on the Projects home view and matches project names, repo labels, workspace labels, service names, agent/task/check text, or an exact `:port` query. — [Dashboard search logic](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L54); [search UI](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L315)
- Projects home is an auto-filling card grid. Each tile selects one “focus” workspace by active agent run first, then live service, then the first workspace; it summarizes one task/blocker/runtime state and offers preview, logs, start/stop, folder, and settings actions. — [project home and tile selection](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L383); [project tile actions](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L510)
- Active work separates current agent runs from projects running without an agent, then places done/failed agent runs in a “Recent handoffs” section. — [ActivePane](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L574)
- Attention aggregates blocked readiness checks, daemon alerts, unattributed running processes, and never-started containers; each row routes toward the affected project or cleanup surface. — [AttentionPane](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L946)
- Project detail begins with horizontal workspace tabs, automatically selects the workspace touched by the focused active run, then renders a workspace hero with open/preview/log/start-stop actions. — [workspace selection and tabs](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L709); [workspace hero](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L779)
- Below the hero, conditional sections show agent intent, readiness checks, runtime rows, repo-scoped orphans, never-started containers, and a collapsed Sources disclosure. — [project detail sections](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L838)
- The app provides resilient status handling: if Docker or `lsof` probes fail, banners say observations are hidden rather than absent; if the WebSocket disconnects, observations freeze and the interaction pane is dimmed and disabled. — [App probe/disconnection banners](/Users/admin/dev/devhub/packages/web/src/App.tsx#L69); [disabled dashboard state](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L119)
- The current data hierarchy is Project → Repo → Worktree → Service, with agent runs joining workspaces by filesystem paths. Project and repo definitions persist; worktrees, services, agent runs, reservations, announcements, alerts, ports, and orphans are derived or leased views. — [shared config and view model](/Users/admin/dev/devhub/packages/shared/src/index.ts#L41); [agent run model](/Users/admin/dev/devhub/packages/shared/src/index.ts#L161)
- UI preferences support renames, role order, project order, and collapsed sections, keyed by stable project/repo/role identities. — [Prefs model](/Users/admin/dev/devhub/packages/shared/src/index.ts#L68)
- The log viewer is a global drawer resolved by service id on each snapshot, while add/edit/migration workflows are dialogs and feedback is delivered through toast state. — [App composition](/Users/admin/dev/devhub/packages/web/src/App.tsx#L10)

### Inferences
- The current architecture represents the domain faithfully, but the navigation represents entity collections (“Projects,” “Ports”) and exception collections (“Attention”) separately from temporal work (“Active,” “Recent handoffs”). Users must decide which representation contains their next action before they see the content.
- The project page is the most coherent surface because it begins with human context (workspace and task) and progressively reveals machine context (intent, readiness, runtime, source). It is a stronger model for the rest of the product than the project-card home.
- Ports and Not in a project are valuable diagnostic lenses but are secondary modes. Keeping them out of the primary nav is appropriate; they should remain globally searchable/actionable.
- The status model has unusually good epistemic honesty: “declared,” “reserved,” “observed,” probe unavailable, disconnected, and external/no launcher are distinct. This should become a visible product principle and perhaps a consistent visual grammar.

### Gaps
- The running interface could not be captured in this sandbox because binding `0.0.0.0:4317` failed with `EPERM`; this audit therefore relies on source, design documentation, and the previous review’s documented live verification.
- No automated UI, accessibility, or visual-regression tests were found outside dependencies, so several interaction details cannot be confirmed without a runnable browser session.
- The current branch is a large uncommitted rewrite, so some legacy functions and comments coexist with the new launchpad and may not represent intended final behavior.

## Which design decisions encode questionable assumptions about frequency, priority, terminology, layout, and user intent?

### Takeaway
The biggest questionable assumption is that the stable project catalog deserves to be home while volatile, actionable work is a separate destination. The second is that one card can truthfully compress a project with multiple concurrent workspaces into one state. The third is that a developer tool becomes keyboard-first through accessible menus alone; DevHub still lacks a global command/navigation layer.

### Cited Findings
- Home always initializes to the Projects view even though Active and Attention contain the states most likely to change between visits. — [initial Dashboard view](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L52)
- Project cards are large (minimum 276 px), rounded, shadowed, animated cards in an auto-fill grid, so stable projects consume the most visual area even when little is happening. — [project card CSS](/Users/admin/dev/devhub/packages/web/src/styles.css#L391)
- A project tile shows exactly one focus workspace. The selection algorithm privileges a focused active run, then a live workspace, then the first group, and reduces all remaining project activity to counts. — [tile focus algorithm](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L482)
- Project tile status collapses a blocker, a waiting agent, alerts, and never-started containers into the same broad `attention` styling; it similarly collapses a working agent and any live runtime into `live`. — [tile state and summary](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L490)
- The home card’s primary lifecycle action starts launchers only from each repo’s primary checkout, even though the product’s distinctive use case is concurrent feature worktrees. — [primary launcher selection](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L492); [README project-hub behavior](/Users/admin/dev/devhub/README.md#L105)
- Active work places agents before runtime-only projects, but it preserves incoming array order and does not sort working, waiting, blocked, or handoff rows by urgency or `updatedAt`, even though agent runs carry both `updatedAt` and `expiresAt`. — [ActivePane collection logic](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L585); [AgentRun timestamps](/Users/admin/dev/devhub/packages/shared/src/index.ts#L167)
- “Recent handoffs” does not display when the handoff occurred, and its count is the entire leased handoff array; temporal recency is implied by the heading rather than communicated in each row. — [Recent handoffs rendering](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L648)
- Search disappears outside Projects and only filters projects; there is no global shortcut or command-palette implementation in the web package. Actions remain split across card footers, row buttons, overflow menus, tabs, a log drawer, and dialogs. — [home-only search UI](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L309); [Dashboard action surfaces](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L510)
- Workspace navigation uses `role="tablist"` and `role="tab"` but has no arrow-key handling, roving tab index, `aria-controls`, or tabpanel relationship. — [workspace picker](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L762)
- Compact mode moves all global navigation into one overflow menu and hides the brand label; the breakpoint is computed at 700 CSS px, while CSS independently changes layout at 760 px, producing two overlapping responsive systems. — [header compact behavior](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L333); [ResizeObserver breakpoints](/Users/admin/dev/devhub/packages/web/src/hooks/useBreakpoint.ts#L3); [CSS mobile breakpoint](/Users/admin/dev/devhub/packages/web/src/styles.css#L1911)
- On narrow screens, supporting text and explicit state columns are hidden, which reduces context precisely when cards become a single long column. — [mobile CSS](/Users/admin/dev/devhub/packages/web/src/styles.css#L1935)
- The visual language is a familiar dark developer SaaS/dashboard kit: dark neutral surfaces, blue accent, rounded project cards, colored initials, status pills, shadows, and a dense set of nested rounded sections. — [color tokens](/Users/admin/dev/devhub/packages/web/src/ds/tokens/colors.css#L1); [launchpad/card CSS](/Users/admin/dev/devhub/packages/web/src/styles.css#L179)
- Fonts and Material Symbols are fetched from Google Fonts at runtime, despite DevHub being a local control surface whose daemon and observations may need to remain useful while offline. — [font tokens](/Users/admin/dev/devhub/packages/web/src/ds/tokens/fonts.css#L1)
- The main dashboard component is about 2,300 lines and the stylesheet about 2,044 lines; legacy `Rail`, `CompactBar`, and `ProjectPane` functions remain defined but unused by the current `Dashboard` return path. — [Dashboard.tsx](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx); [styles.css](/Users/admin/dev/devhub/packages/web/src/styles.css); [legacy Rail definition](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L1040)
- The previous live review found and fixed many trust, keyboard, contrast, async-feedback, responsive, and alert-routing defects, but it explicitly left light mode, disabled-control explanations, some copy consistency, and internal performance/virtualization unresolved. — [previous review implementation status](/Users/admin/dev/devhub/docs/ui-review.md#L38)
- No first-party test or spec files were found in the repository outside dependencies, leaving a complex set of lifecycle, keyboard, and responsive behaviors without an automated regression safety net. — [repository file inventory](/Users/admin/dev/devhub)

### Inferences
- **Assumption to reject: “Projects are primary” means “Projects grid is home.”** Projects can remain the stable organizing object in the data model while the landing experience is organized around current work and required decisions.
- **Assumption to reject: one project equals one current context.** Multi-worktree agent use means one project may have several simultaneous contexts. A single chosen workspace on a project tile can hide concurrency and make the “active context brought forward” promise ambiguous.
- **Assumption to reject: all attention is equivalent.** “Waiting for you,” “blocked setup,” “port collision,” “orphan cleanup,” “failed start,” and “never started container” have different urgency, reversibility, and likely next actions. A shared amber/red treatment does not establish an action order.
- **Assumption to challenge: starting a project means starting `main`.** For an agent/worktree tool, users may more often want to resume or launch the task workspace. A global “Start project” action should name the target context or present an explicit choice.
- **Assumption to reject: navigation and actions can stay page-local.** A keyboard-heavy developer audience benefits from global recognition and execution: switch workspace, open preview/logs/folder, start/stop, find port, and jump to blockers without first navigating to the correct page.
- **Assumption to challenge: compact/mobile is merely a narrower desktop.** DevHub’s real constraint may be split-pane or side-panel width during development rather than phone usage. Responsive priorities should preserve current task, blocker, and primary action before decorative project identity or generic descriptions.
- **Assumption to reject: generic “dark devtool” styling is sufficient identity.** DevHub’s specific subject matter is the relationship between intention and observation. Its visual system can encode those two evidence layers far more distinctively than cards and status pills.
- **Assumption to reject: externally hosted fonts are harmless.** A local diagnostic tool should have a deterministic local visual baseline; font and icon availability should not depend on Internet access.
- **Assumption to challenge: surface-level design can proceed safely before code consolidation.** Duplicate/legacy rendering paths and extremely large files raise the chance that visual changes create inaccessible or inconsistent states.

### Gaps
- Without usage telemetry, the audit cannot prove whether users visit Projects more often than Active, Attention, or direct project pages.
- Without observing real sessions, it is unknown whether project-level start/stop is a frequent convenience or a rarely used, risky bulk action.
- No user vocabulary study exists, so terms such as “workspace,” “launcher,” “agent intent,” “not in a project,” and “never started” may be technically correct but not yet validated for comprehension.
- The prior UI review refers to more than 30 captured states, but those captures are not stored in the repository; visual conclusions are based on CSS/source and written verification rather than current screenshots.

## What technical and product constraints should shape a redesign?

### Takeaway
The redesign must preserve the observation-first trust model, leased ephemeral state, stable identity keys, and direct lifecycle controls. It should also respect that snapshots can change every few seconds, logs are high-volume, Docker/`lsof` can disappear, and the app must remain understandable under disconnection, narrow widths, and partial capability.

### Cited Findings
- Observed services are rebuilt every tick and the app resolves an open log target by id on every render instead of storing a stale object. — [App live service resolution](/Users/admin/dev/devhub/packages/web/src/App.tsx#L24)
- High-volume log lines bypass React state and stream directly to listeners/xterm, which limits how a redesign should couple logs to general page state. — [useDevhub log architecture](/Users/admin/dev/devhub/packages/web/src/hooks/useDevhub.ts#L32)
- The client uses a WebSocket snapshot protocol, reconnects automatically, retains log subscriptions, and applies backward-compatible defaults when the daemon is older than the UI bundle. — [useDevhub WebSocket lifecycle](/Users/admin/dev/devhub/packages/web/src/hooks/useDevhub.ts#L45)
- Lifecycle actions are optimistic but bounded: they mark exact ids pending, wait for daemon `actionDone`, and clear after a 15-second timeout; sending is refused when disconnected. — [useDevhub action handling](/Users/admin/dev/devhub/packages/web/src/hooks/useDevhub.ts#L108)
- The daemon discovers Git worktrees, listening processes, and Docker containers live rather than persisting observations. Configuration is intentionally small and hand-editable. — [README observation model](/Users/admin/dev/devhub/README.md#L7); [README config schema](/Users/admin/dev/devhub/README.md#L73)
- Fixed-port policy can stop another worktree’s instance before starting the selected one, while allocated ports depend on a declared range and environment variable. The UI must expose this consequence before activation. — [PortPolicy contract](/Users/admin/dev/devhub/packages/shared/src/index.ts#L11)
- Services may be observed but not launchable; DevHub can stop them but cannot restart them until the user saves a launcher. — [ServiceView launchability](/Users/admin/dev/devhub/packages/shared/src/index.ts#L93)
- Repos can be missing, worktrees detached, agent presence can expire, probes can fail, and service intent may remain declared without becoming observed. These are designed states, not generic errors. — [RepoView and WorktreeView](/Users/admin/dev/devhub/packages/shared/src/index.ts#L126); [AgentRun lease](/Users/admin/dev/devhub/packages/shared/src/index.ts#L161); [ServiceAnnouncement status](/Users/admin/dev/devhub/packages/shared/src/index.ts#L203)
- Existing project ordering, service renames, role ordering, and collapse preferences rely on stable semantic keys even though view ids may be rebuilt. — [Prefs model](/Users/admin/dev/devhub/packages/shared/src/index.ts#L68)
- The previous review established a baseline of visible focus, menu keyboard semantics, overlay focus trapping, reduced-motion support, compact navigation, undo/confirmation, and honest disconnected/probe states that a redesign must not regress. — [previous review verified fixes](/Users/admin/dev/devhub/docs/ui-review.md#L43)

### Inferences
- A redesign should not cache or visually “stabilize” stale live state without showing an observation timestamp. Fast updates need keyed transitions and local pending feedback, not full-page motion.
- Every major state should answer both “who says this?” and “what did DevHub verify?” The UI can use a two-layer evidence grammar: declared/agent-reported versus observed/daemon-verified.
- Destructive or preemptive controls must name scope. “Stop” is insufficient when the action affects several services or a sibling fixed-port workspace.
- The most important technical refactor before or during visual implementation is to split `Dashboard.tsx` by route/domain and delete unused legacy surfaces. This enables targeted accessibility and responsive tests.
- UI state worth persisting should use existing stable semantic keys. Ephemeral selection and expanded details can remain session state, but recent workspace/task history would require an explicit product decision because the current observation-first model deliberately avoids persistent event history.
- If the future home becomes chronological, the daemon needs a bounded, trustworthy event/handoff history rather than inferring chronology from the current snapshot. The existing short-lived handoff lease is enough for “just finished,” not a durable activity feed.

### Gaps
- Poll cadence, snapshot size at large scale, and expected upper bounds for projects/worktrees/services are not documented as product requirements.
- Cross-platform scope is unclear. Current copy includes Finder, while process discovery depends on `lsof` and local path conventions; this may intentionally be macOS-first.
- There is no documented offline asset policy, despite external font/icon imports.
- There is no explicit compatibility policy for daemon/UI version skew beyond defensive snapshot defaults.

## What parts should be preserved because they already fit the core job well?

### Takeaway
Preserve the observation-first model, the project/workspace mental model, the focused workspace detail, honest degraded states, actionable exceptions, and the reversible lifecycle feedback. Reframe the landing/navigation layer around resumption and decisions without discarding the product logic that makes DevHub trustworthy.

### Cited Findings
- The split between durable declarations and live observations directly fixes the earlier product failure in which stale config generated false alerts and concealed real orphans. — [observation-first rationale](/Users/admin/dev/devhub/docs/design-observation-first.md#L8); [observation-first decisions](/Users/admin/dev/devhub/docs/design-observation-first.md#L62)
- Grouping same-branch worktrees across repos into a logical workspace matches the user’s task context better than exposing repository mechanics first. — [workspaceGroups implementation](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L213)
- Project detail automatically opens the workspace touched by a current agent and places the task, blocker/waiting state, paths, preview, logs, and lifecycle controls together. — [project selection and workspace hero](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L722)
- Agent intent is explicitly labeled as separate from listener verification, and running announcements provide direct preview links. — [Agent intent section](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L838)
- Readiness checks expose a compact ready/blocked/pending grid reported by the current agent rather than forcing users to parse logs. — [workspace readiness](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L864)
- Alerts route to and briefly reveal the affected target; orphan rows and never-started containers carry direct cleanup/start actions. — [revealTarget behavior](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L74); [AttentionPane](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L972)
- Probe failure and disconnection are represented as inability to observe, not as an empty healthy state; uptime freezes while disconnected. — [App degraded-state handling](/Users/admin/dev/devhub/packages/web/src/App.tsx#L15)
- Actions provide per-item pending state, exact daemon confirmation, failure banners, undo toasts, and confirmation for irreversible cleanup. — [useDevhub action lifecycle](/Users/admin/dev/devhub/packages/web/src/hooks/useDevhub.ts#L108); [ConfirmButton](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L1537)
- The product includes first-class Ports and unattributed-process views, preserving expert diagnostic depth without forcing those tables into every project. — [global view routing](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx#L150); [Port model](/Users/admin/dev/devhub/packages/shared/src/index.ts#L255)
- The previous review made keyboard focus, menus, overlays, compact navigation, contrast, and reduced motion materially stronger; these are a baseline, not redesign debris. — [previous review implementation status](/Users/admin/dev/devhub/docs/ui-review.md#L43)

### Inferences
- The best reframing is evolutionary at the product-model level and radical at the presentation level: make “Now” or “Resume” the landing surface, keep Projects as an inventory/library, and retain Attention and deep diagnostics as lenses.
- Project detail can remain the primary working surface, but its horizontal workspace tabs should become a scalable workspace switcher that supports multiple active contexts and full keyboard semantics.
- The intent-versus-observation distinction can become DevHub’s signature visual language: one restrained treatment for declarations, a stronger one for verified live state, and explicit mismatch treatments for waiting, blocked, collided, or stale conditions.
- Exceptions should stay actionable and routed to targets, but should be ordered by user impact: waiting for user / blocked work first, collision or failed start next, cleanup later.
- Ports, raw runtime metadata, repository sources, and migration tools should remain available through progressive disclosure and global search rather than dominate the main workflow.

### Gaps
- The current project detail was not interaction-tested in this sandbox, so its apparent coherence should be validated with real tasks before treating it as settled.
- There is no evidence yet about whether users understand the intent/observation distinction without explanatory copy.
- The relative value of project artwork and identity marks versus dense operational context has not been tested.
