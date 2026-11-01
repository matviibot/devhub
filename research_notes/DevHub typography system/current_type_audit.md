# Current DevHub typography audit

## What font families, weights, sizes, line heights, casing, and letter spacing does DevHub currently use?

### Takeaway
DevHub has the beginnings of a tokenized system but still renders two overlapping systems: a large unused Material-style scale plus a six-step app ramp, alongside extensive hard-coded component CSS and inline React styles. The practical interface uses native sans and mono stacks, yet the log terminal separately hard-codes JetBrains Mono.

### Cited Findings
- `fonts.css` defines the interface stack as `SF Pro Text`, Apple system UI, Segoe UI, and `system-ui`; the mono stack is SF Mono, `ui-monospace`, Menlo, and Consolas. Material Symbols is still fetched from Google Fonts, so the type text is local but icon typography is not. — [DevHub font tokens](/Users/admin/dev/devhub/packages/web/src/ds/tokens/fonts.css)
- `typography.css` contains a complete Material-like display/headline/title/body/label/mono scale, then a second application scale with `micro 10.5`, `meta 11`, `body 12`, `title-sm 13`, `title 15`, and `display 19` pixels. The file itself documents that the latter was introduced to absorb 92 earlier shorthand declarations across 12 sizes. — [DevHub typography tokens](/Users/admin/dev/devhub/packages/web/src/ds/tokens/typography.css)
- The current stylesheet still contains 128 typography declarations and at least 14 distinct hard-coded `font-size` values, ranging from 9px to a responsive 28–38px page heading; 11px appears 15 times, 12px 12 times, and 10px nine times. — [DevHub main stylesheet](/Users/admin/dev/devhub/packages/web/src/styles.css)
- Inline component styles still include roughly 68 uses of `var(--font-mono)` across TSX. Dashboard alone contains about 30 typography declarations; FolderBrowser 11, Dialogs 10, LogDrawer seven, and the primitives another 17. — [Dashboard](/Users/admin/dev/devhub/packages/web/src/components/Dashboard.tsx); [Folder browser](/Users/admin/dev/devhub/packages/web/src/ds/FolderBrowser.tsx); [Dialogs](/Users/admin/dev/devhub/packages/web/src/components/Dialogs.tsx); [Log drawer](/Users/admin/dev/devhub/packages/web/src/components/LogDrawer.tsx)
- The xterm instance does not consume `--font-mono`; it hard-codes `"JetBrains Mono", "SF Mono", Menlo, monospace` at 12px/1.5, although JetBrains Mono is no longer loaded by `fonts.css`. — [LogDrawer terminal options](/Users/admin/dev/devhub/packages/web/src/components/LogDrawer.tsx#L134)
- Button typography uses the older Material label tokens at 12px or 14px and weight 600, while much of the custom application UI uses the newer 10.5–15px application ramp. — [Button primitive](/Users/admin/dev/devhub/packages/web/src/ds/Button.tsx); [DevHub typography tokens](/Users/admin/dev/devhub/packages/web/src/ds/tokens/typography.css)
- Several labels remain uppercase with added tracking, including TextField labels (11px with `0.55px` tracking), while the current visual-design direction explicitly prefers sentence case. — [TextField](/Users/admin/dev/devhub/packages/web/src/ds/TextField.tsx); [DevHub main stylesheet](/Users/admin/dev/devhub/packages/web/src/styles.css)

### Inferences
- The interface is not truly governed by its tokens: changing the six application variables would leave most CSS selectors and multiple primitives unchanged.
- Mono is being used as a generic “technical mood” for prose, menus, notifications, hints, errors, and folder names—not just for paths, commands, ports, logs, and values that benefit from fixed-width alignment.
- The current native sans stack is fast and resilient but is not metrically stable across the three target platforms; Segoe UI, SF Pro, and Linux `system-ui` will produce different row density and hierarchy.

### Gaps
- The repository has no automated visual-regression or font-metric test suite, so the exact number of layouts affected by a family change cannot be established from static inspection alone.

## Where do hard-coded values or semantic mismatches undermine hierarchy, accessibility, or cross-platform rendering?

### Takeaway
The principal problems are not the nominal font names but semantic overuse of mono, sub-12px information-bearing text, multiple competing scales, and typography encoded directly inside components. These choices make hierarchy inconsistent and amplify cross-platform metric changes.

### Cited Findings
- The main CSS contains information-bearing text at 8.5px, 9px, 9.5px, 10px, and 10.5px in evidence labels, runtime metadata, badges, activity timestamps, and service rows. — [DevHub main stylesheet](/Users/admin/dev/devhub/packages/web/src/styles.css)
- Primer's current product typography uses 12px as its smallest body/caption size, 14px for medium body, 16px for large body, unitless line heights, and rem-based size tokens so browser default-size preferences are respected. — [Primer typography primitives](https://next.primer.style/product/primitives/typography/); [Primer responsive guidance](https://primer.style/product/getting-started/foundations/responsive)
- Atlassian's guidance says its smallest 12px token should generally be avoided except for fine print, recommends body line height around 1.5 and heading line height around 1.2, and calls for rem-based responsive text. — [Atlassian applying typography](https://atlassian.design/foundations/typography/applying-typography); [Atlassian typefaces and scale](https://atlassian.design/foundations/typography/product-typefaces-and-scale)
- DevHub uses mono for toast prose, error explanations, folder names, menu items, dialog descriptions, and empty-state descriptions, which adds width and lowers normal prose texture without encoding code semantics. — [Toast](/Users/admin/dev/devhub/packages/web/src/ds/Toast.tsx); [Dialogs](/Users/admin/dev/devhub/packages/web/src/components/Dialogs.tsx); [EmptyState](/Users/admin/dev/devhub/packages/web/src/ds/EmptyState.tsx); [Folder browser](/Users/admin/dev/devhub/packages/web/src/ds/FolderBrowser.tsx)
- Material recommends roughly 1.5 line height for smaller body text, roughly 1.2 for headings, and tabular figures for values that change or need aligned scanning. — [Material 3 typography](https://m3.material.io/styles/typography/applying-type)
- Carbon distinguishes a dense “productive” type set for product spaces from larger expressive/editorial type, recommends regular and semibold for digital use, and reserves semibold from long passages. — [Carbon typography](https://www.carbondesignsystem.com/building-blocks/foundations/typography/overview)
- Primer advises using semantic shorthand tokens rather than arbitrary weights, keeping text left aligned and ragged-right, and avoiding color as the primary hierarchy mechanism. — [Primer product typography](https://primer.style/product/getting-started/foundations/typography/)

### Inferences
- DevHub should treat 12px as an absolute floor for persistent information-bearing UI and use 13–14px for the dominant scanning layer; 10–11px may remain only for genuinely supplementary, redundant labels.
- Replacing mono prose with sans will shorten labels and reduce visual noise, partially offsetting the width increase from raising small text sizes.
- A new family with a larger x-height or wider metrics could break the command palette, project rows, service-action clusters, evidence rail, nav, and dialogs unless sizes and column definitions are adjusted together.

### Gaps
- Official Linear documentation confirms user-adjustable interface font size, but it does not publish Linear's internal type tokens or font family; visual imitation would therefore be guesswork. — [Linear preferences](https://linear.app/docs/account-preferences)

## Which components are most likely to regress when metrics change?

### Takeaway
Risk is concentrated in horizontal, single-line, fixed-height components and in xterm, not in large headings. The migration should test the header, project ledger, runtime rows, command palette, menus, dialogs, and log terminal before broad cleanup.

### Cited Findings
- Header search/nav, project rows, evidence claims, command results, service rows, activity rows, and many metadata lines enforce `white-space: nowrap`, ellipsis, fixed grid columns, or fixed heights. — [DevHub main stylesheet](/Users/admin/dev/devhub/packages/web/src/styles.css)
- Button heights and sizes are derived from old label tokens and explicit pixel padding, so a new family may clip or appear vertically miscentered even if the global body stack changes cleanly. — [Button primitive](/Users/admin/dev/devhub/packages/web/src/ds/Button.tsx)
- TextField uses a 30px fixed input height, 11px uppercase label, and separate hard-coded 12/13px field values. — [TextField](/Users/admin/dev/devhub/packages/web/src/ds/TextField.tsx)
- MenuButton renders items in mono at the application body step and overlays keyboard hints in the micro step; it is both semantically mismatched and width-sensitive. — [MenuButton](/Users/admin/dev/devhub/packages/web/src/ds/MenuButton.tsx)
- xterm computes cell geometry from its own configured font family, size, and line height; changing CSS tokens alone will not update its renderer. VS Code likewise exposes terminal font family, font size, letter spacing, line height, weight, and ligature behavior as separate settings, indicating that terminal typography is an independent subsystem. — [DevHub LogDrawer](/Users/admin/dev/devhub/packages/web/src/components/LogDrawer.tsx); [VS Code terminal appearance](https://code.visualstudio.com/docs/terminal/appearance)
- Atlassian describes typography migrations as foundation-level changes that benefit from incremental rollout because they affect a large design system and many applications. — [Atlassian typography migration](https://atlassian.design/whats-new/implementing-typography-at-scale)

### Inferences
- Highest-risk QA order: header and command palette; Now project rows; project hero/evidence rail; service rows and action clusters; menus/dialogs/forms; folder browser; log drawer/xterm; then empty states and toasts.
- Screens should be checked at 500, 700, 1024, and 1440 CSS pixels, 200% zoom, Windows font rasterization, and at least one Linux distribution.
- The project mark initials and Material Symbol ligatures are separate typographic assets; neither should inherit interface font changes.

### Gaps
- No Windows or Linux screenshot baseline exists in the repository, so platform-specific clipping will require manual or CI browser capture after implementation.

## What token architecture and CSS migration sequence should replace the current system?

### Takeaway
Use one semantic productive type system—family, size, line height, weight, tracking, numeric features—rather than a numeric scale plus scattered declarations. Migrate shared primitives first, then application surfaces, and make xterm consume the resolved mono token.

### Cited Findings
- Primer exposes opinionated shorthand tokens that bind family, weight, size, and line height, uses rem units, and discourages arbitrary weights. — [Primer product typography](https://primer.style/product/getting-started/foundations/typography/); [Primer typography primitives](https://next.primer.style/product/primitives/typography/)
- Material names roles by purpose—display, headline, title, label, and body—rather than by raw size. — [Material 3 typography](https://m3.material.io/styles/typography/applying-type)
- Carbon separates dense productive type from expressive type, a useful model for a local control surface whose dominant job is operational scanning rather than editorial display. — [Carbon typography](https://www.carbondesignsystem.com/building-blocks/foundations/typography/overview)
- DevHub's existing `--type-micro/meta/body/title-sm/title/display` tokens encode size alone and therefore allow components to re-decide family, line height, weight, and tracking independently. — [DevHub typography tokens](/Users/admin/dev/devhub/packages/web/src/ds/tokens/typography.css)

### Inferences
- Recommended semantic shorthands: `--type-page-title`, `--type-section-title`, `--type-row-title`, `--type-body`, `--type-label`, `--type-meta`, `--type-caption`, `--type-code`, and `--type-log`. Each should be a complete `font` shorthand, accompanied only where needed by role-specific tracking and OpenType features.
- Recommended productive ramp: page title 30–32px/1.15/650; section title 15px/1.3/600; row title 13px/1.35/600; body and controls 13px/1.45/400–550; meta 12px/1.4/400; caption 11px/1.35 only when redundant; code 12px/1.45; log 12–13px/1.5. Use rem equivalents so browser defaults scale them.
- Set `font-synthesis: none`, sans `font-variant-numeric: tabular-nums` only on changing aligned values, and mono `font-variant-ligatures: none` for paths/commands/logs where character identity matters.
- Migration sequence: add self-hosted `@font-face` and semantic tokens; update body and shared primitives; update header/Now/detail/command palette; replace mono prose; connect xterm to computed `--font-mono`; remove hard-coded CSS sizes and the unused Material scale; then run cross-platform visual and accessibility QA.

### Gaps
- The exact family metrics and payload should follow the separate candidate-font research rather than be selected from this audit.

## Which developer-product precedents demonstrate useful typography behavior, and which should DevHub avoid copying?

### Takeaway
GitHub Primer and IBM Carbon offer the most transferable system behavior: semantic shorthand tokens, restrained productive scales, neutral text color, and deliberate mono roles. DevHub should borrow these mechanics without inheriting their brand expression or copying Linear's undocumented visual surface.

### Cited Findings
- Primer's product guidance emphasizes efficient, clean reading, semantic hierarchy, left alignment, line-height tokens, and lines around 80 characters or less. — [Primer product typography](https://primer.style/product/getting-started/foundations/typography/)
- Primer's public stack stays system-native and adds Noto Sans/Helvetica/Arial plus emoji fallbacks; mono is a distinct stack. — [Primer typography primitives](https://next.primer.style/product/primitives/typography/)
- Carbon uses IBM Plex across Sans, Serif, and Mono and defines a compact productive set specifically for task-focused product interfaces. — [Carbon typography](https://www.carbondesignsystem.com/building-blocks/foundations/typography/overview)
- Atlassian uses a sans family derived from Inter and a mono derived from JetBrains Mono, enables tabular figures for tables/lists, always uses a slashed zero in mono, and disables code ligatures. — [Atlassian product typefaces](https://atlassian.design/foundations/typography/product-typefaces-and-scale)
- Linear exposes interface font-size adjustment and separate code typography/theme preferences, supporting the principle that UI text and code/log text are different systems and that user scaling is valuable. — [Linear preferences](https://linear.app/docs/account-preferences); [Linear coding settings](https://linear.app/docs/code-and-reviews)
- VS Code exposes terminal typography independently from the rest of the workbench, including family, size, spacing, line height, weight, rendering, and ligatures. — [VS Code terminal appearance](https://code.visualstudio.com/docs/terminal/appearance)

### Inferences
- Borrow Carbon's “productive” restraint and Primer's shorthand-token mechanics; do not import Material's oversized marketing/display scale into the operational UI.
- Avoid using mono to make ordinary prose feel technical, avoid all-caps micro-labels as decoration, and avoid copying Linear's very tight visual density without offering a user font-size preference.
- A distinctive DevHub identity should come from the selected family's shapes and the Declared/Observed hierarchy, not from unusual tracking, artificially tiny metadata, or many weights.

### Gaps
- Raycast does not publish a sufficiently detailed official typography system for reliable token-level comparison; its visual appearance should not be treated as sourced guidance.
