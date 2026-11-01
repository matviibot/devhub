# Font candidates for DevHub

## Which families render well at 11–16 px for dense cross-platform scanning?

### Takeaway

IBM Plex Sans is the strongest default interface family for DevHub, with IBM Plex Mono as its companion. The pair is practical at small UI sizes, visually grounded, and more ownable than the current crop of generic SaaS fonts. Atkinson Hyperlegible Next is the accessibility-first alternative; Recursive is the more characterful alternative. Regardless of family, DevHub should validate 11 px metadata and 12–16 px controls on actual Windows, macOS, and Linux displays before release because no official source provides a comparable three-platform rasterization benchmark.

### Cited Findings

- **IBM Plex Sans** — IBM describes Plex as a four-subfamily system (Sans, Serif, Mono, and Sans Condensed) with eight weights and true italics; the official repository says Plex was designed to work well in user-interface environments and is licensed under the SIL Open Font License (OFL). The repository also lists extensive script extensions beyond Latin. ([IBM Design Language](https://www.ibm.com/design/language/typography/typeface/), [official repository](https://github.com/IBM/plex/))
- **Atkinson Hyperlegible Next** — The official project says its grotesque forms deliberately differentiate characters that are commonly confused, and that the Next release improves glyph design and kerning while adding six upright and italic weights. Braille Institute lists seven weights, a variable version, 370 glyphs, and support for more than 150 languages. ([official repository](https://github.com/googlefonts/atkinson-hyperlegible-next), [Braille Institute](https://www.brailleinstitute.org/freefont/))
- **Public Sans** — The US Web Design System project describes Public Sans as a strong, neutral interface face whose metrics were chosen to sit between common Apple and Google system fonts. Its repository includes WOFF2 webfonts and calls out tabular figures, while marking its variable fonts experimental. ([official repository](https://github.com/uswds/public-sans))
- **Source Sans 3** — Adobe's official repository describes Source Sans as an open-source sans serif designed for user-interface environments. Adobe identifies the GitHub repository as the source of truth and confirms OFL self-hosting rights. ([official repository](https://github.com/adobe-fonts/source-sans), [Adobe Community answer](https://community.adobe.com/questions-438/source-sans-pro-licence-details-736614))
- **Inter** — Inter's official project describes it as a typeface designed for computer screens, with a large x-height and OpenType features including tabular figures and a slashed zero; the repository distributes it under the OFL. ([official project](https://rsms.me/inter/), [official repository](https://github.com/rsms/inter))
- **Geist** — Vercel distributes Geist Sans and Geist Mono in OTF, WOFF2, and variable formats under the OFL, with full weights from 100 through 900. ([official font page](https://vercel.com/font), [official repository](https://github.com/vercel/geist-font))
- **Recursive** — Recursive combines proportional sans and monospaced designs in one variable family. Its five axes are `MONO`, `CASL`, `wght`, `slnt`, and `CRSV`; the project says glyph widths remain stable across the non-`MONO` axes and that its Linear style is intended for dense information. It supports more than 200 Latin-based languages and is OFL-licensed. ([official specimen](https://www.recursive.design/), [official repository](https://github.com/arrowtype/recursive))
- **IBM Plex Mono** — It is part of the same OFL-licensed Plex system and inherits the family's eight-weight range and broad distribution support. ([IBM Design Language](https://www.ibm.com/design/language/typography/typeface/), [official repository](https://github.com/IBM/plex/))
- **Atkinson Hyperlegible Mono** — Braille Institute describes the mono family as optimized for coding and tabular scanning, with seven weights, a variable version, 373 glyphs, and more than 150 supported languages. The Google Fonts repository carries an OFL text. ([Braille Institute](https://www.brailleinstitute.org/freefont/), [official OFL file](https://github.com/googlefonts/atkinson-hyperlegible-next-mono/blob/main/OFL.txt))
- **Intel One Mono** — Intel says the family was developed with low-vision and legally blind developers, covers more than 200 Latin-script languages, includes four weights with italics, and ships WOFF/WOFF2 files optimized for the web. The project recommends it for screen sizes of 9 px and above and specifically documents screen optimization and Windows hinting. ([official repository](https://github.com/intel/intel-one-mono))
- **Recursive Mono** — The `MONO` axis provides a fully monospaced endpoint within the same OFL family, while shared vertical metrics and width-stable axes help mixed UI/code settings avoid reflow. ([official specimen](https://www.recursive.design/), [official repository](https://github.com/arrowtype/recursive))
- **Iosevka** — Iosevka is an OFL-licensed family built for code, terminal, and technical-document use, with monospaced and quasi-proportional variants and extensive configurability. Its package documentation shows why selecting a targeted package matters: the full webfont distribution contains many individual WOFF2 files. ([official repository](https://github.com/be5invis/Iosevka), [official package list](https://github.com/be5invis/Iosevka/blob/main/doc/PACKAGE-LIST.md))
- **Monaspace** — GitHub's code superfamily distributes static and variable WOFF/WOFF2 builds and adds optional coding features such as texture healing and stylistic sets. ([official repository](https://github.com/githubnext/monaspace), [official releases](https://github.com/githubnext/monaspace/releases))
- **Commit Mono** — The project's specimen presents it as an anonymous, neutral coding font and exposes variable-font controls and character-feature settings. ([official specimen](https://commitmono.com/), [official repository](https://github.com/eigilnikolajsen/commit-mono))

### Inferences

- At 11–16 px, IBM Plex Sans has the best balance of compact rhythm, recognizable forms, hierarchy, and an industrial voice. It should support fast scanning without making every label feel enlarged for accessibility.
- Atkinson Hyperlegible Next is the strongest choice when maximum differentiation of ambiguous letters is more important than density. Its wider, emphatic forms may make a 20-project list feel less compact.
- Public Sans, Source Sans 3, and Inter are dependable interface choices but visually recede into “standard product UI.” That is useful for invisibility, but weaker for a distinct DevHub identity.
- Geist is polished, but its close association with Vercel makes it read as contemporary web-product branding rather than a native-feeling local tool.
- Recursive is unusually well suited to a single-family system and has an excellent dense Linear mode. It also introduces more typographic personality and axis complexity than DevHub needs in its first redesign.
- Intel One Mono is the strongest alternate mono for maximum glyph differentiation and low-size robustness. Iosevka is the strongest for fitting more code per line, but its narrow construction can reduce glanceability in timestamps and short status data. Monaspace is expressive enough to compete with the interface; Commit Mono is quieter but has less natural family continuity with the recommended UI face.

### Gaps

- The official sources do not provide a controlled comparison across CoreText, DirectWrite, and common Linux FreeType configurations. DevHub still needs screenshot tests at 100%, 125%, and 150% scaling, on both low-density and Retina/HiDPI screens.
- Language needs beyond Latin were not specified. Plex has broad script extensions, but each required script must be tested because script families and metrics are not identical substitutes.

## Which candidates best satisfy axes, figures, character coverage, ambiguous glyphs, and licensing requirements?

### Takeaway

No single candidate wins every dimension. IBM Plex offers the best overall system breadth and licensing confidence; Atkinson leads in deliberate character differentiation; Recursive leads in useful variable axes; Public Sans and Inter explicitly document tabular figures; and Intel One Mono offers unusually strong small-screen and low-vision evidence. The default should remain conservative: use static IBM Plex cuts and enable numeric OpenType features only after a visual regression test confirms the shipped build supports them.

### Cited Findings

- The OFL permits use, study, modification, redistribution, embedding, and bundling with software, but the font cannot be sold by itself; modified versions must follow the license's naming and redistribution conditions. ([official OFL text](https://openfontlicense.org/open-font-license-official-text/), [official OFL FAQ](https://openfontlicense.org/ofl-faq/))
- IBM Plex's official project is OFL-licensed, includes Sans and Mono within one type system, has eight weights and true italics, and publishes both core fonts and script-specific extensions. ([IBM Design Language](https://www.ibm.com/design/language/typography/typeface/), [official repository](https://github.com/IBM/plex/))
- Atkinson Hyperlegible Next explicitly targets unambiguous character recognition; the official repository says it redesigned multiple characters and improved kerning in the Next release. ([official repository](https://github.com/googlefonts/atkinson-hyperlegible-next))
- Public Sans documents tabular figures, but its official repository labels its variable fonts experimental. ([official repository](https://github.com/uswds/public-sans))
- Inter documents tabular numbers, fractions, slashed zero, alternate digits, and variable-font distribution. ([official project](https://rsms.me/inter/), [official repository](https://github.com/rsms/inter))
- Recursive's axes allow DevHub to move continuously between proportional and monospaced widths and between Linear and Casual expression; its other axes do not change character width. ([official specimen](https://www.recursive.design/))
- Geist provides variable Sans and Mono fonts spanning weights 100–900. ([official font page](https://vercel.com/font))
- Intel One Mono includes deliberate differentiation work, four weights plus italics, and more than 200 Latin-script languages. ([official repository](https://github.com/intel/intel-one-mono))

### Inferences

- For DevHub's rapidly changing uptime, port, PID, CPU, and memory fields, tabular figures are a functional requirement because they keep columns visually stable. Apply `font-variant-numeric: tabular-nums` to those fields, not indiscriminately to prose.
- IBM Plex's family cohesion is more valuable than a large axis set: users repeatedly switch between project names, process state, command lines, and logs, so matching proportions and color reduce visual friction.
- A variable font is not automatically the best deployment. DevHub only needs a small set of weights; static WOFF2 cuts are easier to audit, often simpler to preload, and prevent unplanned intermediate weights from weakening hierarchy.
- Use `0`, `O`, `1`, `l`, `I`, braces, punctuation, slashes, backticks, and arrows as the acceptance-test string for the mono font. Intel One Mono and Atkinson Hyperlegible Mono should be kept as fallback options if Plex Mono fails this test for the actual log density.

### Gaps

- IBM's high-level documentation does not enumerate every OpenType feature in every distributed file. Confirm `tnum`, slashed-zero, and locale behavior against the exact WOFF2 binaries DevHub vendors.
- Exact non-Latin coverage depends on which Plex extension files are bundled; the core Latin download alone does not provide the whole advertised script range.

## Which pair feels technical and grounded without becoming a generic startup dashboard or default IDE?

### Takeaway

Recommend **IBM Plex Sans + IBM Plex Mono**. It feels engineered rather than ornamental, yet it is warmer and more authored than a system stack. It avoids Inter/Geist's startup-dashboard associations and avoids the “code editor everywhere” feeling created by using mono for ordinary interface text. The typography should make the product feel like a reliable local control panel: proportional text for decisions, mono text for machine identity and output.

### Cited Findings

- IBM positions Plex as its corporate typeface and a system intended to balance engineered and human qualities; the system contains matching Sans and Mono subfamilies. ([IBM Design Language](https://www.ibm.com/design/language/typography/typeface/))
- IBM's repository explicitly describes Plex as suitable for user-interface work and makes the family available under the OFL. ([official repository](https://github.com/IBM/plex/))
- Source Sans was created for user interfaces, while Inter was created for computer-screen use; both are credible functional alternatives. ([Source Sans repository](https://github.com/adobe-fonts/source-sans), [Inter project](https://rsms.me/inter/))
- Recursive intentionally spans text, UI, and code and can interpolate between proportional and monospaced forms. ([official specimen](https://www.recursive.design/))

### Inferences

- **Primary pair:** IBM Plex Sans for navigation, project names, buttons, status language, dialogs, and help; IBM Plex Mono for ports, paths, branches, commands, timestamps, process IDs, environment keys, and log output.
- Do not set tabs, navigation, card titles, buttons, or status pills in mono. Mono should mean “machine-originated or machine-addressable,” giving it semantic value instead of serving as developer-themed decoration.
- Suggested hierarchy: Sans 400 for body/metadata, 500 for controls and selected rows, 600 for page/section headings; Mono 400 for logs and values, 500 only for emphasis or a selected log match. Avoid 700+ in the dense operational UI.
- Suggested starting sizes: 15–16 px page titles, 13–14 px primary labels and controls, 12 px metadata, 11–12 px dense secondary values, and 12–13 px logs with roughly 1.45–1.55 line height. Never compensate for poor contrast by shrinking secondary text below 11 px.
- **Accessibility alternative:** Atkinson Hyperlegible Next + Atkinson Hyperlegible Mono when user testing shows character recognition is a recurring failure.
- **Brand-forward alternative:** Recursive configured near `CASL 0` for the interface and `MONO 1` for technical data. This would be more ownable but should be adopted only if DevHub wants typography to be a visible part of its identity.

### Gaps

- The brand preference is ultimately subjective and should be checked with a small set of representative project rows, not alphabet specimens. Test idle, launching, failed, and log-heavy screens before committing.
- The current app's existing spacing and line-height tokens were not evaluated in this subtask; font replacement without retuning those tokens may misrepresent every candidate.

## What WOFF2 files, subsets, fallbacks, and loading strategy should DevHub ship?

### Takeaway

Ship five local static WOFF2 files initially: IBM Plex Sans Regular 400, Medium 500, SemiBold 600; IBM Plex Mono Regular 400 and Medium 500. Preload only the two regular files, use `font-display: swap`, and let the stronger cuts load when first requested. Subset to the exact languages the product supports, not merely the developer's sample data. Keep OS-native fallbacks behind the bundled fonts and test layout under blocked-font conditions.

### Cited Findings

- WOFF2 is the W3C webfont format based on Brotli compression and is designed to reduce downloadable font data. ([W3C WOFF2 Recommendation](https://www.w3.org/TR/WOFF2/))
- `font-display: swap` gives the downloaded face a zero block period and an effectively unlimited swap period, so text is rendered immediately with a fallback and replaced when the font arrives. ([MDN `font-display`](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display))
- `unicode-range` lets a browser download a font resource only when characters from the declared range occur on the page. ([MDN `unicode-range`](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/unicode-range))
- IBM recommends obtaining the latest Plex release from its official GitHub project. ([IBM Design Language](https://www.ibm.com/design/language/typography/typeface/), [official releases](https://github.com/IBM/plex/releases))

### Inferences

- Prefer release-pinned WOFF2 assets copied into the application bundle, with no Google Fonts or other runtime CDN dependency. This makes the local tool work offline, removes a third-party request, and prevents unreviewed font updates.
- Start with static cuts because DevHub needs only three Sans and two Mono weights. Reconsider a variable build only after measuring that the exact variable WOFF2 is smaller than the combined files used in a normal session and renders consistently across the app's supported webviews.
- Suggested declarations:

```css
@font-face {
  font-family: "IBM Plex Sans";
  src: url("/fonts/ibm-plex-sans-latin-400.woff2") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: "IBM Plex Sans";
  src: url("/fonts/ibm-plex-sans-latin-500.woff2") format("woff2");
  font-style: normal;
  font-weight: 500;
  font-display: swap;
}

@font-face {
  font-family: "IBM Plex Sans";
  src: url("/fonts/ibm-plex-sans-latin-600.woff2") format("woff2");
  font-style: normal;
  font-weight: 600;
  font-display: swap;
}

@font-face {
  font-family: "IBM Plex Mono";
  src: url("/fonts/ibm-plex-mono-latin-400.woff2") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}

@font-face {
  font-family: "IBM Plex Mono";
  src: url("/fonts/ibm-plex-mono-latin-500.woff2") format("woff2");
  font-style: normal;
  font-weight: 500;
  font-display: swap;
}

:root {
  --font-ui: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", "SFMono-Regular", "Cascadia Mono", Consolas,
    "Liberation Mono", monospace;
}
```

- Name subsets explicitly (`latin`, `latin-ext`, `cyrillic`, and so on) and add `unicode-range` only after generating each subset from the same pinned release. For an app with unknown project names or logs, a Latin-only mono subset is unsafe: logs may contain paths, package names, or user data in other scripts.
- Preload only Sans 400 and Mono 400. The browser can discover 500/600 naturally; preloading all five creates unnecessary competition with the application shell.
- Do not synthesize bold or italics. If the design uses italics, vendor the actual italic cut; otherwise declare only normal style and avoid italic UI states.
- Record the upstream release tag and SHA-256 hashes in a small `fonts/README.md`; copy `OFL.txt` alongside the assets and into the distributed notices.

### Gaps

- Exact filenames and byte counts should be recorded from the chosen IBM Plex release at implementation time; the official release package layout can change.
- A desktop webview may load local URLs differently from a conventional web server. Verify preload URLs, caching, and CSP rules in each packaged target.
- Subsetting can accidentally remove diagnostic glyphs needed in logs. A representative multilingual and symbols corpus is required before trimming the Mono files.

## What are the performance and licensing implications of the recommendation?

### Takeaway

The recommendation has a modest and controllable cost: five compressed local resources, two on the critical path, with no runtime network dependency. OFL permits bundling and redistribution with the application, but DevHub must retain the license and should avoid modifying or renaming font binaries unless it is prepared to follow OFL reserved-name and derivative-font requirements.

### Cited Findings

- WOFF2 reduces font transfer size through transformed Brotli compression. ([W3C WOFF2 Recommendation](https://www.w3.org/TR/WOFF2/))
- The OFL allows a font to be bundled, embedded, redistributed, and modified with software, while requiring the license and copyright notice to remain and prohibiting sale of the font by itself. ([official OFL text](https://openfontlicense.org/open-font-license-official-text/), [official OFL FAQ](https://openfontlicense.org/ofl-faq/))
- IBM Plex is distributed under the OFL. ([official repository](https://github.com/IBM/plex/))
- `font-display: swap` favors immediate text visibility over hiding text while a font loads. ([MDN `font-display`](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display))

### Inferences

- In a packaged local application, latency is dominated less by network transfer than by resource decoding, initial paint, and how many faces are requested. Two preloads and five total files keep that work bounded.
- The largest typography performance mistake would be shipping multiple entire families “just in case.” Keep only the selected pair in production; candidate fonts belong in design experiments, not the bundle.
- A small flash of fallback text is preferable to blank project names or controls. If swap creates measurable layout shift, tune fallback metrics with `size-adjust` and ascent/descent overrides based on screenshots rather than changing to `block`.
- Static files also reduce design drift: a developer cannot casually request weight 472 or 725 and undermine a deliberately small hierarchy.
- The safe legal workflow is to redistribute upstream, unmodified release files; preserve `OFL.txt`, copyright headers, release tag, and attribution in third-party notices. Any subsetting or binary modification should be reviewed as a derivative-font workflow, including reserved font names.

### Gaps

- No stable byte budget can be stated before downloading the exact release files and deciding language coverage. Measure compressed installed size and first-render decode time in the packaged application.
- This research is not legal advice. If DevHub modifies outlines, renames fonts, or distributes outside the app bundle, counsel should verify the resulting OFL compliance process.
