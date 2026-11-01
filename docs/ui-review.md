# devhub — design, UI and UX review

Reviewed 2026-09-17 against the running app (daemon `dist` build serving
`http://localhost:4317/`) with the observation-first rewrite in the working tree,
uncommitted. Four parallel reviews — visual system, interaction/a11y, information
architecture, copy/scale — over 30 captured states, merged and deduplicated here.
92 raw findings → 61 items.

Scope, as agreed: polish **plus** IA rethinking **plus** functional gaps found while
clicking. Items marked ✅ were verified independently after the reviewing agent
reported them.

**Severity**
- **P0** — devhub states something false, or a core action is unreachable or unsafe
- **P1** — the core loop ("what is running, where, what's wrong, act on it") is degraded
- **P2** — polish; real but survivable
- **P3** — nice to have

---

## Decisions — P0 block (confirmed 2026-09-17)

| # | Decision |
|---|---|
| 1 | **Fix.** Parse `{{.Ports}}`, put host ports on `ObservedContainer.ports`, `recordPorts` them. Docker rows gain a `localhost:` address; ports table stops calling devhub's own containers foreign. |
| 2 | **One section.** Single "never started · 8" group, actionable first, `start` (worktree alive) / `remove` (worktree gone) per row. Drop failed-start from the alerts panel. |
| 3 | **Build it.** Dedupe `portRows` on `(pid, port)`, carry `holders[]` on `PortRow`, emit the collision alert naming both branches. |
| 4 | **Fix + confirm.** Separator renders *before* the row; guard against an item with both a label and the flag. `delete launcher` becomes reachable and gets a confirm or undo rather than a one-click fire. |
| 5 | **Global rule.** One `:focus-visible` rule in `styles.css`; delete the per-component `outline:none`. `Button`'s inset ring stays on top. |
| 6 | **Full menu semantics.** Rows → `<button role="menuitem" tabIndex={-1}>`, focus in on open, Arrow/Home/End roving, Tab closes, `aria-haspopup` + `aria-expanded` on the trigger. |
| 7 | **Undo toast + confirm on multi.** Revive the toast system for an undo receipt on single stop/restart/kill; confirm only when an action hits more than one service. Danger styling and a real divider on `stop all`. |
| 8 | **commandError banner.** Emit `commandError` alongside the log note for every start/stop/restart failure, service name folded into the message. |
| 9 | **Probe status on the wire.** `probes: {lsof, docker}` on `Snapshot`, banner when either is unavailable — "hidden, not gone". |
| 10 | **Refuse and freeze.** `send()` returns false when the socket is closed so `act()` bails without a phantom spinner; pass `connected` into `Dashboard`, disable actions, freeze uptimes at "as of HH:MM", desaturate. |
| 11 | **Retire as a text colour.** State text (`idle`, `N up`, `up 1h 25m`, `pid`) → `--dh-text-secondary`; faint tone kept only for non-semantic ornament. |
| 12 | **Build compact mode.** Below 700px the rail collapses into a top bar (project dropdown incl. ports + not-in-any-repo, filter behind a search icon, `+`, `⚠ N` → alerts sheet). Pass `compact` into `Dialog` and `MenuButton` so their existing sheet layouts run. |

## Implementation status (2026-09-17)

Verified against the live daemon on a second port (4318) with the real machine
state — notqa, pridbuy, sbnotes, toolboy, five containers, 28 listening sockets.

**Done and verified running**

- **A1** NUL bytes removed — `config.ts` and `shared/index.ts` now produce real diffs (405 / 350 lines) instead of `Bin`.
- **1** `{{.Ports}}` parsed; 3306/5173/5433/6380/8000/8108 now resolve to `pridbuy · main · mysql`, `notqa · main · typesense` etc. instead of `com.docker.backend` / NOT DEVHUB'S. Docker rows show `localhost:` addresses.
- **2** One `never started · 8` section, 2 `start` + 6 `remove`, with the source worktree named. `docker rm` wired behind a two-step confirm.
- **3** `portRows` dedupes on `(pid, port)` with `holders[]`; collision alert fires — proven with two listeners sharing a port across address families.
- **4** Separator renders *before* its row; "reveal in Finder" and "delete launcher" are back. Delete launcher has an undo toast.
- **5** One global `:focus-visible` rule; measured `solid 2px rgb(165,140,245)` on a focused control.
- **6** Menu rows are `<button role="menuitem">`, focus enters the panel on open (verified), Escape returns it to the trigger, `aria-haspopup`/`aria-expanded` set.
- **7** `stop N running` is danger-styled below a real divider, confirms above one service, names how many devhub didn't start. Toast receipts restored; `kill` two-step.
- **8** Failures emit `commandError` → banner, via a new `actionFailed` event (deliberately not `"error"`, which EventEmitter throws on).
- **9** `probes: {lsof, docker}` on the Snapshot with "hidden, not gone" banners.
- **10** `send()` returns false when closed, `act()` refuses instead of faking a 15s spinner; pane dims and blocks input.
- **11/34/35/37** Contrast pass: `--dh-text-faint` retired as a text colour (11 sites moved), `host`/`tertiary` → 5.13:1, stopped dot 2.35:1 → 4.8:1 at 2px, card 1.07 → 1.14, hairline 1.03 → 1.16.
- **12** Compact bar below 700px — project switcher (with state lines), ports, add-project, alert pill. Verified at 646px effective width.
- **13/14/28/29** Alerts are buttons that select + flash the target, moved under the filter; ports defaults to `devhub` scope (12 rows, not 28) with foreign ports as plain text; rail subtitle is the state line.
- **15** Filter follows selection, `n/total` count, clear button, Escape-to-clear, no-match empty state.
- **16** Collapse persists through `setPrefs`; reordering rebuilt keyboard-first as move up/down.
- **17** Toast system revived (`pushToast`); undo on delete launcher, receipt on stop.
- **18/19/20** Per-id `actionDone` resolution; bulk actions labelled by effect and count, mark every member pending; drawer gets `pending`, joins the overlay stack (Esc), dialogs raised above it.
- **21/22** Escape dispatches to the top of the overlay stack; `Overlay` gained initial focus, trap, return focus, scroll lock, `aria-labelledby`.
- **23/24** Adopted explanation is its own wrapped line; pause becomes `play_arrow` + "paused · N lines waiting".
- **25/26** `minWidth:0` + ellipsis + `title` on branch/repo/path/name; `overflow-x: hidden` on the pane; a missing repo no longer renders a phantom worktree with live start buttons.
- **27** `adopted` dropped; `observed` → `no launcher` with the consequence in the tooltip.
- **33/40/41/46** Type ramp: 92 inline shorthands across 12 sizes (four half-pixel, smallest 9px) mapped onto six tokens, nothing below 10.5px, zero raw `px` left in a `font:` shorthand. `Chip` gained a tone grammar (kind / relationship / warn).
- **36** Real elevation: `--dh-surface-raised` / `--dh-surface-overlay` + two shadows; the drawer no longer renders darker than the page it floats over.
- **38/39** Selection outranks hover (accent bar + `aria-current`); service rows gained hover/active treatment.
- **43/44/45** Alerts toned down and repositioned; running worktrees are weighted above idle ones.
- **47** Renamed and moved below the live work, with a real action.
- Tail folded in: reduced-motion broadened (and pointed at the element that actually animates), dialog fill-mode `both` → `forwards`, `FolderBrowser` crumbs/rows are real buttons, `"Output cleared"` → `"no output yet"`, `up —` → `not running`, pane max-width, alerts panel capped and collapsed past 3.

**Explicitly not done**

- **30 (half).** The misleading gear is gone — project settings moved to a header kebab — but there is no app-settings dialog, because the things it would hold (poll interval, daemon port, theme, default ports scope) are not configurable values yet. That is a feature, not a fix; it needs its own decision.
- **31 (half).** Reordering is keyboard-only (move up/down). Drag was agreed as an enhancement on top and is not built.
- **42 (half).** Foreign ports no longer use the link colour, but no separate ownership tone was introduced.
- **46 (half).** Sizes are on a ramp; `line-height: 1` in 73 declarations was left alone — changing it wholesale is broad layout churn with no way to verify every surface in one pass.
- **48 (half).** Alerts panel is capped and collapses past three; no memoisation or virtualisation was added, and `now` still flows through the tree every second.
- **61.** No light mode. At 83% raw-palette references this is a rewrite of the colour layer, not a polish item.
- **54, 57, 59, 60** partially: casing and label fixes were applied where the code was already being touched, not swept exhaustively; delete-project still replaces the edit dialog rather than stacking; disabled controls still don't state their reason.

**Not verified by interaction** — arrow-key navigation *within* an open menu. The
handler is symmetric with the paths that were verified (open, initial focus,
Escape-restores-focus), but the browser harness stopped delivering key events to
the page partway through testing, so it was never exercised end to end.

## Decisions — P1 themes (confirmed 2026-09-17)

| Theme | Items | Decision |
|---|---|---|
| A — dead wiring | 16, 30, 31 | Wire prefs (collapse, renames, role order) through `setPrefs`; project settings move to a header kebab and the gear becomes real app settings; **rebuild reordering keyboard-first** (move up/down in a rail kebab, drag as enhancement). |
| B — async | 18, 19, 20 | Daemon resolves pending per-id (`actionDone` or stamped ids); bulk actions mark every member service pending, label by effect and count, confirm `fixed`-role preemption, report what was touched; `pending` passed into `LogDrawer`, drawer routed through `Overlay`. |
| C — overlays | 21, 22, 23, 24 | Esc dispatches to the top of `Overlay`'s stack; `Overlay` gains initial focus, trap, return focus, scroll lock, `aria-labelledby`; the adopted explanation becomes its own wrapped line; pause becomes `play_arrow` + "paused · N waiting". |
| D — alerts | 13, 14, 28, 29, 32 | Alerts become buttons (select project → expand worktree → flash row); panel moves under the filter; rail subtitle becomes the state line; ports defaults to `devhub` scope with foreign ports as plain text; alert copy names service, worktree and contended port. |
| E — resilience | 15, 25, 26, 27 | Filter auto-selects first match + empty state + Esc-to-clear; `minWidth:0` + ellipsis + `title` on worktree/repo/path labels and `overflow-x: hidden` on the pane; missing repo suppresses its phantom worktree and offers locate/remove; drop `adopted`, rename `observed` → `no launcher`. |
| F1 — colour | 34, 35, 37, 38, 39, 42, 43 | One pass: `--dh-text-host` to AA, stopped dot to 3:1+ at 2px, real card/border separation, selection outranks hover, row hover + `:focus-within`, purple reserved for interaction with a separate ownership tone, alert cards toned down. |
| F2 — type | 33, 36, 40, 41, 44, 45, 46 | Delete unused scales, make survivors load-bearing, replace the 83 inline shorthands with a mono ramp, real elevation for menus/dialogs, badge grammar, mono means machine-fact, tree expressed in a repeating spacing scale with idle visibly secondary. |
| Tail | 48–61 | **Folded in opportunistically** — picked up where they sit in code already being touched; the rest stay documented. |

---

## P0 — false statements and unreachable actions

**1. Docker services have no port, anywhere — and the ports view attributes them to Docker.** ✅
`externalScan.ts:191` requests seven `--format` fields and `{{.Ports}}` is not one of them,
so a docker `ServiceView` is built with `ports: []` and `recordPorts` is never called for it.
Consequences: container rows show a container name where every other row shows
`localhost:NNNN`; pridbuy reports "2 up" with zero addresses; and ports 3306, 5173, 5433,
6380, 8000, 8108 render in the ports table as `com.docker.backend` tagged **NOT DEVHUB'S** —
those are the five containers devhub simultaneously lists as its own. The pane titled "what
holds what, right now" gives a false owner for six rows.
*Fix:* add `{{.Ports}}`, parse the host side of `0.0.0.0:H->C/tcp`, `recordPorts` it.

**2. The eight never-started containers are split across two surfaces and no number says eight.**
`repoStore.ts:431` files a never-started container as a red **alert** when its worktree still
exists; `:292` files the identical condition as grey debris under "LEFT OVER FROM DELETED
WORKTREES" when it doesn't. Same predicate, two names, two visual weights, two counts
(`ALERTS · 2` and `· 6`), and nothing explains the split. The wording is nearly identical in
both places, so the different treatment reads as a bug.
*Fix:* one section, "never started · 8", actionable first, each row carrying `start` (worktree
alive) or `remove` (worktree gone). Drop failed-start from the alerts panel — an inert
container is not an alarm.

**3. The `collision` alert can never fire.** ✅
The string appears exactly once in the entire codebase — `Dashboard.tsx:327`, in a colour
switch. No daemon code path emits `kind: "collision"`. `portRows` (`repoStore.ts:631`)
dedupes by port, so contention is structurally unrepresentable. One of the three alert kinds
the design doc promises is UI-only — and port contention is the failure this machine actually
has.
*Fix:* dedupe on `(pid, port)`, carry `holders: {pid,label}[]` on `PortRow`, emit the alert.

**4. Any menu item marked `divider: true` is swallowed.** ✅
`MenuButton.tsx:134` and `:175` render `item.divider ? <hairline/> : <MenuRow/>`, but both
call sites pass a full item *with* the flag, meaning "draw a divider above this". So
`Dashboard.tsx:556` "reveal in Finder" never renders (confirmed in the captured worktree
menu) and `Dashboard.tsx:620` "delete launcher" is unreachable — the only way to remove a
launcher.
*Fix:* render the separator *before* the row; assert on an item with both a label and the flag.

**5. There is no visible focus ring on almost anything.** ✅
`--focus-ring` is consumed by exactly two components, `Button` and the unused `TextField`.
Verified on a focused kebab: `outline: rgb(164,158,185) none 3px` — colour and width set,
style `none`. 15+ controls set `outline:none` or never style focus, including the rail rows,
worktree disclosures, filter input, every dialog field and every icon button. 54 focusables,
all invisible.
*Fix:* one global `:focus-visible` rule in `styles.css`; delete the per-component `outline:none`.

**6. Dropdown menus cannot be operated by keyboard at all.**
`MenuRow` is a `tabIndex={0}` div with an `onClick` and no `onKeyDown` — tabbable, inert on
Enter and Space. No arrow keys, no focus move on open, no `aria-haspopup`/`aria-expanded`,
and Tab leaks straight past the open menu into the page. Every action other than
start/stop/restart/logs lives behind these kebabs.

**7. "stop all" sits directly under "start all" with no confirm, no undo and no danger styling.**
Same size, same colour, no divider (the divider that should separate them is consumed by
item 4), 37px apart. `stopWorktree` fires immediately — on `notqa/main` that is six services
including three containers with 323h uptime. `stop`, `restart` and orphan `kill` are likewise
one unconfirmed click. The *only* confirm dialog in the app guards `deleteProject`, which by
design stops nothing. The friction is attached to the one harmless action and absent from all
the harmful ones.

**8. Every start/stop/restart failure is invisible.**
`processManager.ts:400,521,540,558` writes `[devhub] failed to start: …` into the service's
log ring buffer and nowhere else — never as `commandError`, so the red banner never fires.
The row flips back to stopped after the spinner and the user is told nothing. "Press start,
nothing happens, no reason given" sends you back to the terminal devhub exists to replace.

**9. Docker or lsof being unavailable silently empties the dashboard.**
`externalScan.ts:20` and `:176` `console.warn` once into the *daemon's* terminal and return
empty, which every caller reads as "nothing found". With Docker stopped, five container rows
and six leftovers vanish and the UI shows a confident, wrong "everything is fine". No string
in `packages/web/src` mentions docker or lsof.
*Fix:* put probe status on `Snapshot` and say "couldn't look" instead of rendering "nothing there".

**10. Disconnected from the daemon, the dashboard keeps pretending.** ✅ (partly)
`App.tsx` does render an amber "reconnecting… attempt N" banner — but everything below it
stays live: green dots, uptimes ticking upward once a second, every action enabled.
`useDevhub.ts:125` drops the message when the socket isn't open while `act` still enters the
pending set, so a click spins convincingly for `PENDING_TIMEOUT_MS = 15000` and then silently
reverts. Nothing was sent; nothing is said.

**11. `--dh-text-faint` fails AA by roughly 2× at all 21 of its sites, and it carries state.** ✅
`#565169` measures **2.27:1** on a card (independently recomputed), rendered at 9–11.5px
where AA needs 4.5:1. It is the colour of `0 up`, `idle`, `up 1h 25m`, the HEAD sha and the
`pid` column — i.e. two of the three facts the dashboard exists to deliver are its least
readable text. A project with nothing running renders almost entirely in it, so it reads as
a failed load.

**12. Below 700px the entire rail unmounts with no replacement — and 200% zoom triggers it.** ✅
`Dashboard.tsx:61` is `{!compact && <Rail/>}`; `useBreakpoint.ts` sets `compact: width < 700`
from a ResizeObserver in **CSS pixels**. Lost: project switcher, filter, add-project, ports,
alerts. There are no width media queries anywhere in the web package (the only two `@media`
rules are `prefers-reduced-motion`). Because the threshold is CSS px, zooming in to read
something deletes your navigation. `Dialog` and `MenuButton` both ship unreachable
bottom-sheet layouts behind a `compact` prop no caller passes.

---

## P1 — the core loop is degraded

**13. Alerts are a dead end.** Every `Alert` carries `targetId`, `port` and `projectId`;
`Dashboard.tsx:308` renders only `message`, in a non-interactive div. The alerted container
sits inside a collapsed idle worktree at the bottom of a long scroll, named by branch, not by
container. An alert you must re-find by hand becomes an alert you ignore.

**14. The ports view defaults to its noisiest scope.** `useState<"all"|"devhub">("all")` —
28 rows, 21 foreign: `com.docker.backend` ×6, `ControlCenter` ×2, Discord Helper,
WavesLocalServer, `plugin_host`. `:4317`, the daemon serving the page you are looking at, is
listed as `node` / NOT DEVHUB'S. Every foreign row is a live link to a tab that resolves to
nothing. The view does earn its place — `all` is the only way to answer "who has 3000?" — but
a 4:1 noise ratio on first render trains you not to open it.

**15. Filtering moves the rail and nothing else.** `selected` resolves against the unfiltered
list, so typing `tool` leaves the notqa pane on screen with only toolboy in the rail and *no*
row highlighted. A no-match filter blanks the rail with no empty state while the pane is
unchanged. The header count drops 4 → 1 in the slot meaning "how many projects you have".
The placeholder also undersells it: `:55` matches service names too.

**16. Every preference is readable, persistable and unreachable — including collapse.**
`setPrefs` and `reorderProjects` are exported by the hook and called from **nowhere** in the
web package. The worktree chevron sets component-local `override`, and `ProjectPane` is
mounted with `key={selected.id}`, so switching project and back discards every collapse
decision. Renames, role order and project order have complete daemon backends and no UI.

**17. The toast system is dead code — there is no receipt for anything.** `setToasts` is only
ever called by the dismiss filter; nothing adds a toast, so `ToastStack` always renders null
and `Toast`'s undo hook is unreachable. `git show HEAD` has the `pushToast` call — the
undo plumbing from commit e0e02fe was dropped in the rewrite and the component left behind.
No confirmation and no undo for delete project, delete launcher, kill, stop or stop all.

**18. The pending spinner is cleared by any snapshot, not by the action completing.**
`useDevhub.ts:80` clears the entire pending set on *any* incoming snapshot, on the assumption
that snapshots only arrive because of your action. The daemon ticks every 5s and broadcasts
on any diff — including the churning `lsof` port table. So the spinner vanishes on a routine
tick while the row is still grey, the button re-enables, and the next click is a genuine
double-submit.

**19. "start all" starts some things; "stop all" stops things devhub never started.**
`start all` skips every launcher-less row with a log-only note (3 of 4 rows on a notqa
worktree) and says nothing. `stop all` has no such limit — it kills adopted and observed
processes, i.e. dev servers you started in your own terminal. For a `fixed` launcher,
`start all` additionally stops that role in *every other worktree* first, which the menu never
mentions. Neither reports what it touched, and `WorktreeGroup` never reads `pending`, so the
most expensive action in the app looks like it did nothing.

**20. The log drawer's Stop and Restart have no pending state and the drawer ignores Esc.**
`devhub.pending` is never passed to `LogDrawer`, so both buttons stay enabled mid-action
(unlike the equivalent row buttons, which do pass `loading`). `stopDisabled` is
`status === "stopped"`, so Stop is live for a crashed service. The drawer paints its own scrim
instead of registering with `Overlay`'s stack, so backdrop-click closes it and Esc does not.

**21. Esc with the folder picker stacked closes both dialogs and discards the form.**
`Dialogs.tsx:26` registers one window keydown that calls the *top-level* `onClose`, unmounting
the whole tree — while backdrop click correctly closes only the top layer. Two dismiss
gestures, two outcomes, and the destructive one is the reflex. You hit this on the first
project you create, because the picker is the only way to add a repo.

**22. `Overlay` has no focus management at all.** No initial focus (there is not one `.focus()`
call in the web package), no trap, no return focus, no scroll lock, and `role="dialog"` with
no `aria-labelledby` despite the title sitting right there. The folder picker opens with focus
still in the dialog behind it; the delete-project confirm opens with focus nowhere, so Enter
does nothing.

**23. The log drawer clips its own explanation mid-word.** A 26px `nowrap; overflow:hidden`
strip packs command + pid + uptime + the 49-character "adopted — restart through devhub to
capture output". Only the command span has `text-overflow: ellipsis`; the adopted span has
none, so it is hard-cut with no indication text is missing — and it is the drawer's
explanation for why the terminal is empty.

**24. The pause button never says "resume" and hides the backlog it is holding.** Icon and
label are constants; `state.queued` is tracked and never surfaced. A paused drawer on a busy
service is indistinguishable from a hung process — the exact confusion the drawer should
resolve.

**25. Long branch names and paths never truncate, so the whole pane scrolls sideways.**
Rail rows truncate correctly; the worktree header does not — the branch label is a flex item
with no `minWidth: 0`, and the scroll pane leaves `overflow-x` at `visible`, which computes
to `auto`. So overflow becomes a horizontal scrollbar on the entire pane and every row slides
together, hiding the action buttons on the right. Repo paths and the project header have the
same gap; `tildify` only collapses `$HOME` and there is no truncation helper.

**26. A repo whose path is gone renders a phantom worktree literally called "worktree".**
`listWorktrees` returns `[]` for an unreadable path and the fallback synthesises one worktree
with `branch: null`, so the red banner "nothing can run until the path exists again" is
immediately followed by a group of inherited launchers with *enabled* start buttons. The
banner and the rows contradict each other; starting one spawns into a non-existent cwd.

**27. `observed` and `adopted` duplicate the buttons and distinguish nothing.** Both decode to
"devhub didn't start this"; they are mutually exclusive by construction, and the only real
difference — can I press start/restart — is already carried by the buttons themselves.
`observed` is on nearly every running row, and a badge that is almost always present is
chrome, not information.
*Fix:* drop `adopted`; rename `observed` → `no launcher`, titled "devhub can stop this but has
no command to start it".

**28. The answer to "what's broken" is in the corner the eye reaches last.** `AlertsPanel` is
the last child of the rail, pinned below the project list — with roughly 300px of empty rail
(34% of its height) above it, put there by a flex spacer. The app's reason to exist loses the
layout fight to whitespace.
*Fix:* move alerts directly under the filter, above the project list. The space is free.

**29. The rail's one subtitle line is spent on truncated paths.** It renders
`~/dev/pridbuy · ~/dev/prid…` — a constant you learn in a day, ellipsised into uselessness on
the one project with two repos — while the orphan count the design doc specified ("6 up · 2
orphans") is not shown at all. Configured repo labels (`"api (Laravel/Sail)"`) exist in the
config and are ignored here and in the project header.
*Fix:* `7 up · 2 alerts · 6 left over`; path to the `title` attribute.

**30. There are no app settings; the gear is a project editor.** A gear in the top-right of a
full-window app reads as app settings by convention; this one opens name + repos + delete.
Homeless as a result: poll interval, daemon port, ports-view default scope, theme, and all
four preference categories from item 16.
*Fix:* project settings become a kebab on the project header (consistent with every other
row); the gear gets a real settings dialog.

**31. Drag-and-drop project reordering regressed out of the rewrite.** `HEAD`'s Dashboard
imports `Reorder`/`useDragControls` and has a drag handle; the rewritten one has neither.
`framer-motion` is still a dependency imported nowhere, and `reorderProjects` survives on the
client, the server and in persisted `projectOrder` with no caller. Rail order is no longer
under the user's control.
*Fix:* decide explicitly — delete the dead protocol, or rebuild it keyboard-first
("move up"/"move down" in a rail kebab) with drag as the enhancement.

**32. "…was created but never started" states a fact and stops.** It restates a compose state
verbatim, with no consequence and no next step, and it is the most frequent alert on this
machine. Three of the five alert strings are good (they name the thing, the port and the
reason); this is the weak one.
*Fix:* "postgres never came up in web-shell-polish — :5433 is already held by
notqa-postgres-1 (main)." Plus a `show in ports` action.

**33. The type, spacing, elevation and tonal scales are dead code.** ✅
`--space-*` (14 tokens), `--elevation-*` (5) and `--tonal-*` (5) have **zero** references
— independently confirmed. The M3 type scale is consumed only by `ds/Button.tsx`. Against
that, `Dashboard.tsx` carries 83 hand-written `font:` shorthands across 12 distinct sizes,
four of them half-pixel, with five different letter-spacings for the same uppercase
micro-label. The scales are the only thing that would make a 1000-line component internally
consistent, and they are inert.

**34. `--dh-text-host`, the default secondary tone, fails AA everywhere.** `#7b7590` is
3.91:1 on a card, used at 10.5–12px across 17 sites: every service row's meta line, every
repo path, every dialog hint, every empty-state description — and the branch name of a
collapsed worktree, which is how you identify which worktree you are looking at.

**35. The stopped status dot is a 2.5:1 hollow ring.** `#5c5772` as a 1.5px annulus on an
8px circle, against a solid 9.1:1 green for running. WCAG wants 3:1 for a graphic that
conveys information. Running and stopped aren't two points on one scale — one is four times
the contrast of the other. "What is *not* running that should be" is half the core loop.

**36. There is no elevation story.** Four floating surfaces, three bespoke shadows, dialogs
with none; menus, dialogs and toasts all reuse the *resting card* fill `#1c1a25`, and the log
drawer is darker than the page it floats over. `--elevation-*` exists and is unused (item 33).

**37. Surfaces and hairlines do almost no work.** Card-against-page is **1.07:1** and
`--dh-border-hairline` on a card is **1.03:1** across 21 borders — so the row grouping that
the whole hierarchy depends on is carried by a difference most displays and most eyes will
not resolve.

**38. In the rail, hover reads louder than selection.** Selected is `#1c1a25` + a border;
hover is `#262234` fill — lighter, therefore more prominent. While the mouse is anywhere in
the rail, the rail answers "which project am I looking at" incorrectly. No `aria-current`
either.

**39. In the action cluster the least important control is the loudest.** The kebab is the
only one of the four with a border, so the overflow menu outranks `stop`. Ghost-button hover
is 1.11:1 — effectively no feedback. And the service row itself has no hover, no
`:focus-within` and no active state, so with ten near-identical rows stacked, "which row am I
about to act on" is answered only by a tiny tint under the cursor. That is where an
accidental `stop` comes from.

**40. Five orthogonal facts are compressed into one identical grey badge.** `DOCKER` (kind),
`BUILT` (mode), `OBSERVED`/`ADOPTED` (control relationship), `:3117 assigned` (policy
outcome), `NOT DEVHUB'S` (ownership) — one style, no ordering rule, inside a `flex-wrap` that
reflows unpredictably. `--dh-docker-badge-border` was defined for exactly this and never used.

**41. The mono/sans split is by size, not by meaning.** 68 of 80 font declarations are
monospace, including all prose, menu items, hints and empty states — while branch names are
mono and service roles are sans. Mono should mean "this is a machine fact you might copy";
right now it means "this text is small".

**42. Purple means "clickable" everywhere except the ports table, where it means "ours".**
The same accent that marks the `localhost:43101` link marks a devhub-owned row — so in the
one view where ownership is the subject, the ownership colour and the link colour are the
same colour.

**43. The loudest surface on screen is the least actionable.** The salmon alert cards measure
10.2:1 and sit in the bottom-left for *inert* never-started containers, while the orphan
section renders above the live worktrees. First thing a project shows is its debris.

**44. Grouping is carried by a 4px difference.** 12px between worktrees, 8px within one. At
that delta the tree structure is inferred, not seen — and it is the only thing distinguishing
levels, since the surfaces don't (item 37).

**45. An idle collapsed worktree is typographically identical to an active one.** Same weight,
same size, same colour family. Six idle worktrees eat 26% of the viewport at the same visual
priority as the branch you're working on.

**46. 61% of the app's type is 11.5px or smaller, with `line-height: 1` in 73 declarations.**
The smallest tier is 9px uppercase mono with 0.1em tracking. Combined with items 11 and 34,
the app's least readable text is also the text carrying its state.

**47. "LEFT OVER FROM DELETED WORKTREES" is named for its cause, placed above the live work,
and offers no action.** Expanded it pushes all live work below the fold. The design doc
records the no-action decision deliberately (`docker rm` is destructive) — but the result is a
permanent list that can only grow and can never be cleared from inside devhub, which is the
shape of the config rot the rewrite exists to remove, re-expressed as UI.
*Fix:* rename to "dead containers · 6", move below the worktree list, add `remove` behind a
confirm that names them.

---

## P2 — polish

**48.** The alerts panel can steal 42% of the rail height, pushing projects out of view;
default it collapsed above ~3 alerts.
**49.** Neither alert cards nor port rows can navigate to the service they name, though both
carry the id. One shared `revealService(serviceId)` handler serves both.
**50.** Per-project `⚠ n` badges and the global `ALERTS · n` can never reconcile — two of the
three alert kinds are built with `projectId: null`, so they appear in the panel and in no badge.
**51.** Expanding an idle worktree reveals a single inherited `dev / start` row, identical in
all seven. Put `start` on the collapsed row; the rule line has ~600px spare.
**52.** In a two-repo project the repo header sits at the same indent and near the same weight
as the worktrees, so one project reads as two. Indent the contents 12px.
**53.** `ports` is rendered as a visual peer of the four projects, advertising `28` — a number
about the machine, not about devhub. Demote it and `not in any repo` to a "machine" strip.
**54.** "delete project" replaces the edit dialog instead of stacking, so opening it discards
unsaved edits and cancelling drops you to the dashboard rather than back.
**55.** `FolderBrowser` breadcrumbs are bare `<span onClick>` — no role, no tabindex, no key
handler, so they are invisible to the keyboard; its rows are `role="button"` with no
`onKeyDown`. Adding a repo is the entry point to the app and half its navigation is mouse-only.
**56.** `prefers-reduced-motion` targets `[data-dh-dialog]`, which is the inner column — the
animation is on the outer panel, so the dialog entrance is never suppressed. Menus, sheets,
tooltips, spinners and the infinite `starting` pulse aren't covered at all, and every one
hardcodes a literal duration that bypasses the motion tokens. Separately, the panel's
`animation-fill-mode: both` holds `opacity: 0` before animations run, so a dialog opened in a
throttled tab is invisible but present — the exact failure the scrim code fixes with `forwards`.
**57.** Disabled controls never say why. The app knows the reason ("no launcher") and puts it
in a chip's `title` next to a dimmed button that has none.
**58.** No max width: at 2560px a service name sits at x≈300 and the button that acts on it at
x≈2400. Same shape in the ports table.
**59.** Casing is split down the middle — lowercase wherever you act (`stop`, `logs`, `save as
launcher`), Title case wherever a surface opens (`Choose a folder`, `Pause stream`). The clash
peaks inside one interaction: the row says `stop`, the drawer it opens says `Stop`.
**60.** Four labels leak implementation vocabulary: `outside every repo`, `nothing declared or
running here`, `running, unattributed`, `left over from deleted worktrees`. `no repos` and
`no repos yet` are two strings for one state. `"Output cleared"` is shown for output that
never existed.
**61.** `dur()` has no day tier, so a weekend-old server reads `up 63h 12m`; `LogDrawer:342`
renders `up —` for a service that isn't up. No light mode exists, and at 83% raw-palette
references adding one is a rewrite. Radius drift: 11 literal corner values against a 7-step
token scale. `--font-feature-mono` (slashed zero) is defined and never applied, in an app made
of port numbers.

---

## Not tested

- **Daemon-disconnected behaviour** was read from source, not exercised — testing it means
  killing a daemon that is managing live processes. Item 10's banner is confirmed by code;
  the ticking-uptime behaviour underneath it is inferred.
- **True window resize** — the automation's resize did not affect the rendered viewport, so
  narrow-width behaviour (item 12) was reproduced with CSS zoom at an equivalent effective
  width. The breakpoint and the unmount are confirmed in source.
- **First-run empty state** was read, not reproduced; it is the one entry state with a
  proper design.

## Appendix — not UI, found on the way

**A1. Three source files contain raw NUL bytes and are therefore binary to git and grep.**
`packages/shared/src/index.ts` (6), `packages/daemon/src/repoStore.ts` (1) and
`packages/daemon/src/config.ts` (1). They are intentional — NUL as a composite-key separator,
e.g. `` `${best.path}\0${role}` `` at `config.ts:151` — but written as literal bytes rather
than the `\0` escape sequence. Consequences: `git diff` reports `Bin 8434 -> 12588 bytes` and
shows **no diff** for three of the files the rewrite touched most; `grep`/`rg` skip them
unless forced with `-a`; editors and codemods may silently drop or mangle them.
*Fix:* replace each raw byte with the escape `\0` in the template literal. Identical runtime
behaviour, files become text again. Worth doing before committing the rewrite, so the commit
is reviewable.

## Themes

Four patterns account for most of the list:

1. **The observation model is right; the UI doesn't finish the sentence.** Devhub sees the
   truth and then reports it twice, under two names, with no way to act (items 1, 2, 3, 13, 47).
2. **The rewrite dropped working features and left their wiring behind.** Toasts, undo,
   drag-reorder, prefs, `deleteLauncher` — all have complete backends and no caller
   (items 4, 16, 17, 31).
3. **Nothing is ever confirmed, and the one confirm is on the harmless action.** Kill, stop
   all and delete launcher fire on a single click; deleting a project asks (items 7, 17, 19).
4. **The design system exists and is unused.** Dead scales, 83 inline fonts, contrast failures
   on the text that carries state (items 11, 33, 34, 35, 46).
