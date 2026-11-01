# Usability, cognitive ergonomics, accessibility, and responsive design

## What research or authoritative guidance supports how users should resume complex work and scan system state?

### Takeaway
DevHub should treat “resume the right workspace with the right context” as a first-class job, not as a side effect of showing a dashboard. The strongest direct evidence supports recent-history/context cues—especially chronological, concrete cues—while general recognition-over-recall guidance supports surfacing recognizable projects, branches, commands, and last activity rather than requiring exact recall.

### Cited Findings
- In a survey of 371 programmers and a controlled study, both automated resumption cues doubled task-completion success relative to note-taking alone; developers strongly preferred a chronological presentation using code snippets over an aggregate/symbol presentation. This is direct evidence about interrupted programming, though from a 2010 study and not specifically about project dashboards. — [Microsoft Research: Evaluating Cues for Resuming Interrupted Programming Tasks](https://www.microsoft.com/en-us/research/publication/evaluating-cues-for-resuming-interrupted-programming-tasks/)
- In a controlled complex-task experiment, mean resumption lag after an interruption was about 3.8 seconds versus 1.9 seconds between uninterrupted actions, and cues visible immediately before interruption reduced resumption lag. The study used a resource-allocation task with 96 undergraduates, so the mechanism is relevant but the exact timings should not be generalized to developers. — [Altmann & Trafton, Task Interruption: Resumption Lag and the Role of Cues](https://www.interruptions.net/literature/Altmann-CogSci04.pdf)
- Recognition is easier than recall because the visible context supplies more retrieval cues; practice, recency, and context all affect memory activation. The same guidance specifically recommends recent-history and previously visited-content lists to help people resume incomplete tasks. This is practitioner synthesis rather than a DevHub-specific experiment. — [Nielsen Norman Group: Memory Recognition and Recall in User Interfaces](https://www.nngroup.com/articles/recognition-and-recall/)
- WCAG requires status messages to be programmatically determinable so assistive technology can present them without moving focus; W3C techniques explicitly include `role=log` for sequential updates and live/status regions for progress. — [WCAG 2.2 SC 4.1.3](https://www.w3.org/TR/WCAG22/#status-messages); [W3C Understanding Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- WAI’s feed pattern supports skim reading by giving each article a name and description and allowing assistive technology to jump article-to-article. It also warns that infinite/dynamic loading can create interoperability problems and that unconventional keyboard interfaces must be documented discoverably. This is consensus design guidance, not normative WCAG. — [WAI-ARIA APG Feed Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/feed/)

### Inferences
- DevHub’s default landing view should contain a compact “Continue” surface ordered primarily by recency, with one recognizable row per active/recent workspace: project name, branch/worktree, last meaningful action, current service/readiness state, and the exact next action. This directly turns the research’s chronological/contextual cues into product behavior.
- Preserve a short chronological activity trail per workspace (agent started, check blocked, service launched, log failed, last user action) rather than only aggregate counts. Aggregate health can remain secondary for scanning, but it is weaker as a resumption cue.
- A global command/search field should suggest recent projects, workspaces, commands, and services before the user types. Search-only navigation still requires recalling a query; visible recent/suggested results shift the task toward recognition.
- Status should answer “what changed, where, and what can I do?” A colored dot alone is insufficient as a resumption cue and insufficient for nonvisual users.
- Preserve the user’s place across refresh/reconnect: selected project/workspace, expanded section, relevant filter, and log scroll state. A reconnect that returns to a generic home screen imposes a fresh reconstruction cost.

### Gaps
- The cited programming study predates coding agents, worktrees, and modern local-control surfaces; user testing is needed to establish which DevHub events constitute meaningful “activity” and how much history is useful before it becomes noise.
- No authoritative source establishes a universal optimum number of recent workspaces or activity items; instrument usage and validate candidate limits (for example, 3–5 recent workspaces and 3–7 events) in task-based tests.

## How should dense developer information be layered without hiding important state?

### Takeaway
Use progressive disclosure based on user job and urgency, not visual neatness: frequent actions, blockers, and live state belong in the first layer; configuration, verbose logs, and provenance belong in the second. Important state must remain scannable and identifiable in text even when detail is collapsed.

### Cited Findings
- Progressive disclosure can improve learnability, efficiency, and error rate by prioritizing common features and deferring rare ones, but it only works when the initial/secondary split matches actual frequency and the path to more detail is obvious and clearly labelled. NN/g recommends combining analytics with observational usability testing and warns that more than two disclosure levels often causes users to get lost. — [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- Recognition-over-recall guidance says visible, easily accessible information and functions reduce memory burden, and recent-history/favorites support returning to unfinished work. — [Nielsen Norman Group: Memory Recognition and Recall in User Interfaces](https://www.nngroup.com/articles/recognition-and-recall/)
- W3C requires information, structure, and relationships conveyed visually to be programmatically determinable or available in text, and requires meaningful sequence to be programmatically determinable. — [WCAG 2.2 SC 1.3.1–1.3.2](https://www.w3.org/TR/WCAG22/#info-and-relationships)
- WCAG 2.2 Level AA requires text contrast of at least 4.5:1 (3:1 for large-scale text), and Level AA non-text contrast requires essential visual information and UI component boundaries/states to meet 3:1 against adjacent colors. — [WCAG 2.2 SC 1.4.3](https://www.w3.org/TR/WCAG22/#contrast-minimum); [WCAG 2.2 SC 1.4.11](https://www.w3.org/TR/WCAG22/#non-text-contrast)
- WCAG’s color criterion means color cannot be the sole visual means of conveying information, indicating an action, or prompting a response. — [WCAG 2.2 SC 1.4.1](https://www.w3.org/TR/WCAG22/#use-of-color)

### Inferences
- Layer DevHub around urgency: (1) blockers/crashes and currently active work, (2) running but healthy workspaces and resumable recent work, (3) stopped projects, ports, configuration, and full event/log history. “Collapsed” must never hide the existence or severity of a blocker.
- Each project/workspace row needs a stable textual state such as “2 services running,” “Blocked: database unavailable,” or “Stopped”; pair it with shape/icon and color. Do not encode running/starting/crashed/stopped solely with green/amber/red dots.
- Prefer one scannable hierarchy (Project → Workspace/branch → service/agent/check) over a matrix of similarly weighted cards. Dense rows with aligned fields are likely more useful than large tiles because developers compare state across many objects; test this rather than assuming either format.
- Detail panels/drawers should reveal commands, paths, ports, runtime provenance, and logs without replacing the selected object or losing list context. Keep the workspace identity and current status visible while detail is open.
- Measure disclosure choices: event instrumentation should track openings of hidden sections, repeated backtracking, command use, and time-to-action; observational tests must verify that low use is not caused by poor discoverability.

### Gaps
- Progressive disclosure guidance does not decide DevHub’s actual first-layer fields. This requires task analysis with representative users (for example, single-project solo developer, multi-repo maintainer, and developer supervising several agents).
- There is no strong evidence that cards or tables are inherently better for DevHub; compare prototypes using time-to-resume, time-to-identify-blocker, error rate, and subjective confidence.

## What keyboard, search, and navigation behaviors reduce interaction cost while staying discoverable?

### Takeaway
Provide a keyboard-first command/search surface in addition to visible navigation, not instead of it. Use established platform and WAI-ARIA conventions, preserve predictable focus, expose shortcuts beside their visible commands, and let Escape cancel/revert transient UI without committing a selection.

### Cited Findings
- WAI-ARIA APG says every interactive element must be keyboard-operable and emphasizes visible focus, predictable focus movement, consistent desktop GUI conventions, and revealing shortcuts while avoiding conflicts with browsers, operating systems, and assistive technology. — [WAI-ARIA APG: Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- WAI-ARIA’s combobox pattern specifies familiar interactions: `Tab` places the combobox in page order, arrow keys move through suggestions, `Enter` accepts, and `Escape` closes/cancels and returns focus. It also notes that a combobox lets users explore options and Escape without losing the previous value. — [WAI-ARIA APG Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- WAI-ARIA’s toolbar guidance says grouping controls can reduce tab stops and recommends toolbar semantics only for groups of three or more controls. — [WAI-ARIA APG Toolbar Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)
- Apple’s keyboard guidance says standard shortcuts work consistently across apps and let people transfer prior knowledge; Microsoft likewise says shortcuts improve both efficiency and accessibility. These are platform guidelines, not controlled DevHub studies. — [Apple Human Interface Guidelines: Keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards); [Microsoft: Keyboard interactions](https://learn.microsoft.com/en-us/windows/apps/design/input/keyboard-interactions)
- WCAG 2.2 requires all functionality to be operable through a keyboard without specific timing, prohibits keyboard traps, requires a visible focus mode, and at Level AA requires author-created content not to entirely obscure the focused component. — [WCAG 2.2 SC 2.1.1–2.1.2](https://www.w3.org/TR/WCAG22/#keyboard-accessible); [SC 2.4.7](https://www.w3.org/TR/WCAG22/#focus-visible); [SC 2.4.11](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum)
- WCAG’s new Level AAA Focus Appearance criterion provides a useful quality target beyond minimum conformance: a focus indicator at least as large as a 2 CSS-pixel perimeter and at least 3:1 different between focused and unfocused pixels. — [WCAG 2.2 SC 2.4.13](https://www.w3.org/TR/WCAG22/#focus-appearance)

### Inferences
- Keep a visible project/workspace rail or list, plus a globally available command palette. Suggested actions should be grouped and labelled by object and verb (for example, “Open Acme / feature-auth,” “Start web,” “Show crashed API logs”), with recent actions first and fuzzy matching second.
- Recommended default conventions: `/` or a visible search control for filtering the current collection; a platform-appropriate command-palette shortcut shown in the UI; arrow keys to traverse results; Enter to open/run; Escape to close without changing prior selection. Avoid single-character global shortcuts when typing focus could make them fire unexpectedly.
- Put shortcut hints in menus, command results, and action tooltips, and include a searchable shortcut/help view. A shortcut that only exists in documentation is not discoverable.
- Use roving tabindex/arrow-key navigation inside composite widgets (menus, tabs, toolbars, trees) rather than adding every child to the page Tab sequence. Use native controls where possible and APG patterns for custom composites.
- After a command, keep focus on the initiating control for nonmodal status updates; if a modal/drawer opens, move focus into it and restore focus to the trigger on close. Never allow a log drawer or sticky header to obscure focused content.

### Gaps
- The best activation shortcut depends on DevHub’s host environment and collision profile; validate on macOS, Windows, and browser contexts rather than hard-coding one chord everywhere.
- WAI-ARIA APG is consensus implementation guidance and examples are not themselves proof of production robustness; keyboard flows still require testing with actual browsers, screen readers, and voice input.

## Which WCAG 2.2 and platform-level accessibility requirements are especially relevant?

### Takeaway
Target WCAG 2.2 AA as the release floor and adopt a few AAA criteria (focus appearance, reduced interaction motion) as internal design standards. DevHub’s highest-risk areas are dense small controls, color-only status, dynamic updates, log/drawer focus, fixed navigation at high zoom, custom keyboard widgets, and destructive runtime actions.

### Cited Findings
- W3C recommends using WCAG 2.2 for current accessibility work; it applies across desktop, laptop, kiosk, and mobile devices and uses testable, technology-independent success criteria. — [WCAG 2.2 Recommendation](https://www.w3.org/TR/WCAG22/)
- Level AA Reflow requires content to work without loss of information/functionality or two-dimensional scrolling at a 320 CSS-pixel width, except content whose meaning genuinely requires two dimensions. W3C cautions that sticky/fixed content can obscure focus and make reflowed content hard to read. — [WCAG 2.2 SC 1.4.10](https://www.w3.org/TR/WCAG22/#reflow); [Understanding Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- WCAG 2.2 Level AA requires pointer targets of at least 24×24 CSS pixels or sufficient spacing/equivalent controls; the enhanced AAA target is 44×44 CSS pixels. — [WCAG 2.2 SC 2.5.8](https://www.w3.org/TR/WCAG22/#target-size-minimum); [SC 2.5.5](https://www.w3.org/TR/WCAG22/#target-size-enhanced)
- Motion triggered by interaction must be disableable at Level AAA unless essential, and W3C lists `prefers-reduced-motion` as a sufficient technique. — [W3C Understanding Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions)
- W3C’s input-assistance guidance aims to help users avoid and correct mistakes; Level A requires input labels/instructions and error identification, while error suggestions and prevention requirements apply at higher levels/context. — [W3C Understanding Input Assistance](https://www.w3.org/WAI/WCAG22/Understanding/input-assistance)
- GOV.UK’s extensively used validation pattern says errors should state what happened and how to fix it, preserve entered values, provide a summary linked to field-level errors, and generally avoid validating before the user finishes unless research shows a benefit. This is design-system guidance, not a WCAG requirement for every DevHub flow. — [GOV.UK: Recover from validation errors](https://design-system.service.gov.uk/patterns/validation/)
- Apple’s design principles state that reversibility encourages exploration; this platform guidance aligns with user-control heuristics but is not a web conformance requirement. — [Apple Human Interface Guidelines: Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles/)

### Inferences
- Use semantic text with every service/check/agent state; ensure status changes are announced through appropriately polite live regions without stealing focus. Avoid announcing high-frequency log lines; announce meaningful transitions such as “API started on port 4317,” “database check blocked,” or “restart failed.”
- Treat stop/restart/delete/kill actions according to reversibility and consequence. Use direct action for safe/reversible operations with an immediate receipt; require confirmation for destructive or broad-scope actions; preserve errors and offer a specific recovery path.
- At 400% zoom/320 CSS-pixel equivalent, collapse secondary navigation and metadata into labelled disclosures while retaining project identity, blocker state, and the primary action. Logs and genuinely two-dimensional terminal content may scroll internally, but surrounding navigation and controls should reflow.
- Give all interactive controls at least 24×24 CSS pixels with spacing, and prefer 44×44 for primary mobile/touch actions. Keep visually compact density by enlarging hit areas rather than shrinking labels.
- Honor `prefers-reduced-motion`; drawers may appear without translation/scale motion, status dots should not pulse indefinitely, and animation must never be the only indicator of starting/running state.
- Build light/dark themes from semantic tokens and verify 4.5:1 text, 3:1 UI/status boundaries, focus visibility, forced-colors mode, and non-color status differentiation.

### Gaps
- Accessibility conformance cannot be inferred from component code or automated checks alone. DevHub needs manual keyboard testing, zoom/reflow testing, forced-colors checks, and screen-reader testing (at minimum VoiceOver/Safari on macOS plus NVDA/Firefox or NVDA/Chrome on Windows if Windows is supported).
- Terminal emulation and continuously updating logs have specialized accessibility limitations not fully addressed by the sources above; assess xterm.js accessibility behavior separately and provide a non-terminal text/log alternative if required.

## What concrete acceptance criteria can be used in design and implementation reviews?

### Takeaway
Use task outcomes plus accessibility checks, not visual-review approval alone. The criteria below convert the evidence into falsifiable release gates for DevHub while separating mandatory WCAG AA from product-quality targets.

### Cited Findings
- WCAG 2.2 provides normative, testable requirements for keyboard access, focus, contrast, reflow, target size, input assistance, and status messages. — [WCAG 2.2 Recommendation](https://www.w3.org/TR/WCAG22/)
- NN/g recommends choosing initial vs secondary features using task analysis, usage frequency, analytics, and observational usability testing, not intuition alone. — [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- Direct programming-task research found chronological, concrete cues preferred and automated resumption cues associated with twice the task success of note-taking alone in that study. — [Microsoft Research: Evaluating Cues for Resuming Interrupted Programming Tasks](https://www.microsoft.com/en-us/research/publication/evaluating-cues-for-resuming-interrupted-programming-tasks/)

### Inferences
- **Resume test:** From a cold visit, 5/5 formative-test participants can identify the workspace they used most recently, state what was happening, and reopen the relevant preview/log/action without inspecting more than one unrelated detail view. Measure time and wrong turns; do not set a hard time threshold until a baseline exists.
- **Blocker test:** Given one blocked agent/readiness check among healthy projects, at least 90% of representative test attempts identify the affected project/workspace and the prescribed next step without relying on color.
- **Core keyboard flow:** A user can select a project, open a workspace, start/restart/stop a service, inspect logs, dismiss overlays, and return to the trigger with keyboard alone. There are no traps; focus is always visible and never fully obscured.
- **Command palette:** Opening, filtering, moving through results, running/opening, and cancelling work with standard keys; each result exposes object type, project/workspace context, action verb, and any destructive consequence. Escape never silently commits a changed selection.
- **Dynamic status:** Starting, running, blocked, crashed, reconnecting, and command-error transitions have visible text and appropriate programmatic announcements; routine log streaming is not spammed to live regions.
- **Contrast and color:** Normal text ≥4.5:1; large text and essential component/state boundaries ≥3:1; every status remains distinguishable in grayscale/forced colors and has a textual or shaped cue.
- **Targets:** Every pointer target passes WCAG 2.2 AA 24×24/spacing rules; primary touch actions target 44×44 CSS pixels; adjacent destructive controls are not tightly packed.
- **Reflow:** At 320 CSS-pixel width or 400% zoom, all non-terminal UI remains usable without horizontal page scrolling or loss of actions/state. Fixed/sticky elements never cover content or keyboard focus.
- **Motion:** With reduced motion enabled, no position/scale animation is required to understand state; pulsing/spinning has a static text equivalent and does not run indefinitely without purpose.
- **Errors and destructive actions:** Errors name the failed action, affected object, cause when known, and a recovery action. User-entered configuration remains intact after validation failure. Broad/destructive actions state scope before execution; completion/failure provides a persistent-enough receipt.
- **Disclosure:** Blockers, current activity, and the primary action are visible in the first layer. Configuration/provenance/full logs are no more than one clearly labelled disclosure away. Analytics plus observation are reviewed before moving a feature between layers.
- **Assistive-technology regression:** Release checks include keyboard-only, 200% and 400% zoom, reduced motion, forced colors, automated axe-equivalent scanning, and manual screen-reader smoke tests for navigation, dynamic status, dialogs/drawers, and the command palette.

### Gaps
- Success-rate thresholds should be recalibrated after the first baseline study; the proposed 90% blocker target is a product-quality goal, not a published universal standard.
- Representative user segments and their task frequencies are not yet established. Acceptance testing should not be finalized until the product team identifies whether DevHub optimizes primarily for a solo developer, a multi-project maintainer, an agent supervisor, or all three with adaptive views.
