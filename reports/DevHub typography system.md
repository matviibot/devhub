# DevHub typography system

## Decision

DevHub now uses **IBM Plex Sans** for interface language and **IBM Plex Mono** for machine-addressable information. The pairing is technical without making the whole product feel like a code editor: Sans carries navigation, decisions, project names, status language, controls, dialogs, and explanations; Mono carries paths, branches, ports, commands, timestamps, identifiers, and logs.

IBM describes Plex as a coordinated Sans/Serif/Mono system that balances engineered and human qualities, and its official repository explicitly positions the family for interface use. Both families are released under the SIL Open Font License. Sources: [IBM Design Language](https://www.ibm.com/design/language/typography/typeface/), [IBM Plex repository](https://github.com/IBM/plex/), [official OFL text](https://openfontlicense.org/open-font-license-official-text/).

This is a product decision, not a claim that one font is universally most legible. The strongest accessibility-first alternative is **Atkinson Hyperlegible Next + Atkinson Hyperlegible Mono**; the strongest more expressive alternative is **Recursive**. Sources: [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next), [Braille Institute](https://www.brailleinstitute.org/freefont/), [Recursive](https://www.recursive.design/).

## What changed

- Bundled IBM Plex Sans 400/500/600 and IBM Plex Mono 400/500 through pinned Fontsource packages.
- Bundled Material Symbols locally as well, removing the remaining runtime Google Fonts dependency.
- Replaced the platform-dependent SF Pro/Segoe UI/system stack with the same primary faces on macOS, Windows, and Linux, while retaining native fallbacks.
- Replaced the overlapping raw-size scales with semantic roles: page title, section title, row title, body, control, metadata, caption, code, and log.
- Raised persistent information to a 12px minimum. The 11px caption role is limited to redundant counts and shortcut hints.
- Changed prose, labels, menus, toasts, empty states, and form help from mono to proportional sans.
- Connected xterm to the same resolved mono token used by the rest of the application.
- Enabled tabular figures only for changing values and disabled font synthesis and code ligatures where character identity matters.

WOFF2 is the webfont format standardized by W3C for compressed font delivery. Fontsource's declarations use `font-display: swap` and Unicode ranges, allowing immediate fallback rendering and selective subset loading. Sources: [W3C WOFF2](https://www.w3.org/TR/WOFF2/), [MDN `font-display`](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display), [MDN `unicode-range`](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/unicode-range).

## Productive type ramp

| Role | Face | Size / line height | Weight | Use |
| --- | --- | --- | --- | --- |
| Page title | Plex Sans | 32 / 36px | 600 | One primary heading per page |
| Section title | Plex Sans | 15 / 20px | 600 | Ledger and panel headings |
| Row title | Plex Sans | 14 / 19px | 600 | Project, service, and result names |
| Body | Plex Sans | 14 / 20px | 400 | Explanations and readable prose |
| Control | Plex Sans | 13 / 18px | 500 | Buttons, inputs, states |
| Metadata | Plex Sans | 12 / 16px | 400 | Supporting operational context |
| Caption | Plex Sans | 11 / 15px | 500 | Redundant counts and key hints only |
| Code | Plex Mono | 12 / 18px | 400 | Paths, commands, branches, ports |
| Log | Plex Mono | 13 / 20px | 400 | Terminal and stream output |

The scale follows the same broad productive pattern as mature product systems: compact 12–14px operational text, restrained weights, and semantic shorthand tokens rather than arbitrary per-component styling. Sources: [Carbon productive type sets](https://www.carbondesignsystem.com/building-blocks/foundations/typography/type-sets), [Primer typography primitives](https://next.primer.style/product/primitives/typography/), [Atlassian typography guidance](https://atlassian.design/foundations/typography/applying-typography).

## Challenged assumptions

1. **“Developer tool” does not mean mono everywhere.** Mono now conveys machine identity instead of atmosphere. That makes scanning faster because its presence has meaning.
2. **Density is not the same as tiny type.** A 3–20 project control surface gains more from aligned rows, concise language, and stable columns than from 8.5–10px metadata.
3. **Native-looking does not require platform-dependent metrics.** A bundled open family gives DevHub consistent hierarchy across platforms; OS fallbacks still keep it resilient.
4. **More weights do not create better hierarchy.** Three Sans weights and two Mono weights cover the interface. Spacing and role do the remaining work.
5. **A single global font setting is insufficient.** Terminal cell geometry is an independent subsystem, so xterm resolves and uses the mono token directly. This matches the separation exposed by tools such as [VS Code terminal appearance settings](https://code.visualstudio.com/docs/terminal/appearance).
6. **Brand is not a license to reduce accessibility.** Distinction comes from Plex's shapes and the product's information model, not low contrast, all-caps microcopy, or unusual tracking.

## Accessibility and QA gates

The type system should be considered complete only when it preserves function at browser text zoom, narrow widths, and user spacing overrides. WCAG guidance requires 4.5:1 contrast for normal text, text resizing to 200%, reflow at a 320 CSS-pixel equivalent, and tolerance of user-defined text spacing. Sources: [Contrast Minimum](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum), [Resize Text](https://www.w3.org/WAI/WCAG21/Understanding/resize-text), [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing).

Release checks:

- No information-bearing text below 12px.
- No clipped labels or inaccessible actions at 200% text zoom.
- No page-level horizontal scrolling at a 320px equivalent; literal paths and logs may scroll inside their own regions.
- No overlap after applying WCAG text-spacing overrides.
- Font-load failure retains complete functionality with the declared fallbacks.
- Screenshots cover 500, 700, 1024, and 1440 CSS pixels.
- Platform acceptance covers current macOS, Windows, and one mainstream Linux/FreeType environment at common display scaling.
- Mono acceptance string includes `0 O 1 l I {} [] / \\ \` -> =>`, plus representative ports, paths, and log lines.

## Files and ownership

The family stacks live in `packages/web/src/ds/tokens/fonts.css`; semantic roles live in `packages/web/src/ds/tokens/typography.css`; package imports live in `packages/web/src/main.tsx`; and xterm resolves the mono custom property in `packages/web/src/components/LogDrawer.tsx`. Components should consume a semantic shorthand rather than inventing a family/weight/size tuple.

Font packages are pinned in `packages/web/package.json` and bundled into the production build. They make no runtime font request to Google or another third-party CDN.
