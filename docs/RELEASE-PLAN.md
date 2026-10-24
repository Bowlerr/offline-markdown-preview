# Release delivery record

## Objective and selected scope

Research, implement, verify, version, and publish improvements autonomously. Preserve offline-first rendering, document privacy, and existing user work. The selected delivery scope is **0.5.0: reliable reading and safe exports**. The scope is finite; additional product ideas are recorded below rather than expanding delivery indefinitely.

Baseline: `ef3d02d` on `main`, manifest/tag 0.4.0. GitHub's latest release entry is 0.3.1; published registry versions must be checked separately. No open PRs were found at intake. Prior issues concern image paths, PDF export, preview flashing, styling, and persistent UI visibility; their existing fixes must be preserved.

## Request ledger

| ID | Outcome / acceptance | Status |
| --- | --- | --- |
| R1 | Authored HTML cannot forge privileged image metadata or cause access outside allowed local roots; regression tests cover the trust boundary. | Implemented; regression tests passing |
| R2 | HTML/PDF export uses a current, completed rendering snapshot and fails clearly on timeout or stale responses; no unsanitized fallback. | Implemented; unit and actual export checks passing |
| R3 | Standalone exports preserve offline defaults with CSP; remote-image downloads are bounded by size and time. | Implemented; regression tests passing |
| R4 | Search finds text in fenced code and across inline formatting; next/previous/clear and keyboard behavior remain accessible. | Implemented; browser verification passing |
| R5 | Contents navigation retains keyboard focus, live edits retain reading position, and diagram panning has keyboard/button alternatives. | Implemented; browser verification passing |
| R6 | Actual VS Code/webview E2E journeys replace fixture-only checks; failures fail the gate. | Implemented; final current/minimum version suites in progress |
| R7 | Reproducible dependency install, explicit type checking, CI and packaging gates, meaningful dependency audit. | Clean install, lint, strict types, 149 unit tests, build and package inspection passed; CI pending |
| R8 | Version, changelog, docs and release notes agree; required checks/review pass; intended artifacts are published and verified. | Version 0.5.0 prepared; publication pending |

## Ownership

| Owner | Components |
| --- | --- |
| Coordinator | Dependencies, manifest, CI/build/package/release, documentation, integration, final verification |
| Security/rendering worker | Extension preview/pipeline, messaging protocol, associated unit tests |
| Preview UX worker | Webview implementation, search/navigation/diagram accessibility, UI unit tests |
| E2E worker | VS Code harness, browser journeys, E2E fixtures/configuration |

Workers coordinate protocol changes directly. Only the coordinator changes Git state or publishes. Independent review follows integration.

## Evidence and delivery status

- `npm ci` on Node 22.22.1 fails at baseline: package-lock does not match package.json (`@vscode/vsce` and related entries missing). Existing CI uses `npm install`, hiding this mismatch.
- Existing E2E checks mostly inspect fixture text; optional GUI checks can skip or annotate failures. These do not establish functional extension coverage.
- Baseline CI on GitHub is green across the existing jobs; this does not invalidate the coverage gaps above.
- Local shell defaults to unsupported Node 23.11.0; verification uses the repository's Node 22.22.1.
- Both Marketplace and Open VSX report 0.4.0 at intake. GitHub connector has repository access. Local CLI credentials are unavailable; Marketplace owner access is confirmed in the user's personal Chrome profile. Publication remains pending until all gates pass.
- Initial strict type checking found existing production and test type errors; these have been repaired without weakening strict compiler settings.
- Independent reviews caught and resolved export readiness, cross-document frontmatter, IME Escape, large-search argument overflow, and theme-observer feedback issues.
- The production dependency audit reports zero advisories. The full development audit has three moderate entries from one UUID advisory in publishing tooling; the affected APIs are unused by the MSAL consumer. See CONTRIBUTING.md for the rationale and recheck requirement.
- Mermaid remains on the patched 11.x line to preserve layouts and the minimum VS Code browser baseline. Mermaid shares KaTeX 0.19.1 through a scoped override; actual math labels and multiple diagram types are covered by browser tests.
- Current VS Code 1.143.1 passes all eight actual application journeys, including a 400 KB single-line stress document with 200,000 potential matches. Highlights are capped at 1,000 with an explicit status; clearing restores exact text and the preview stays responsive.
- VS Code 1.90.0 passes the seven standard rendering/navigation/export journeys; its final stress check and installed-VSIX smoke verification are pending at candidate preparation.
- The candidate VSIX contains 19 files (about 3 MB), with manifest version 0.5.0 and bundled outputs byte-matching the production build. Sources, tests, node_modules, maps, declarations and demo GIFs are excluded.

## Research sources

- [VS Code Markdown workflows](https://code.visualstudio.com/docs/languages/markdown): navigation and preview behavior reference.
- [VS Code publishing guidance](https://code.visualstudio.com/api/working-with-extensions/publishing-extension): package and publish a verified VSIX; versioning and authentication.
- [Open VSX publishing](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions): namespace, publisher account and VSIX publication requirements.
- [Repository issues](https://github.com/Bowlerr/offline-markdown-preview/issues): evidence of existing image/export/preview/styling needs.
- [Mermaid releases](https://github.com/mermaid-js/mermaid/releases): major-version layout/browser changes and supported 11.x updates.
- [KaTeX releases](https://github.com/KaTeX/KaTeX/releases): patched rendering dependency and strict-mode changes.
- [DOMPurify releases](https://github.com/cure53/DOMPurify/releases): current sanitizer fixes.
- [Zod 4 migration](https://zod.dev/v4/changelog): explicit record key/value schemas.
- [UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) and [MSAL advisory](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5): publishing dependency tradeoff.

## Deferred roadmap

- Measure scrolling/render costs on large documents before proposing incremental rendering or structural rewrites.
- Consider a persistent preview lock and richer Markdown workspace navigation after current lifecycle behavior is tested.
- Evaluate additional export layout controls against real authoring needs after export safety and fidelity are verified.
- Consider architectural extraction from the large preview controller where it simplifies future changes; avoid a broad rewrite in this delivery.
- Evaluate publishing identity modernization when account configuration is available; keep release authentication aligned with official guidance.
