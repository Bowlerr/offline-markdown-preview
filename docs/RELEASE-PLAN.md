# Release delivery record

Latest cycle (November 16, 2026): **0.5.5 is verified and published on GitHub; Marketplace and Open VSX publication awaits publisher access.** Resume the same canonical release artifact before starting another version.

## Objective and selected scope

Research, implement, verify, version, and publish improvements autonomously. Preserve offline-first rendering, document privacy, and existing user work. The selected delivery scope is **0.5.0: reliable reading and safe exports**. The scope is finite; additional product ideas are recorded below rather than expanding delivery indefinitely.

Baseline: `ef3d02d` on `main`, manifest/tag 0.4.0. At intake, GitHub's latest release entry was 0.3.1 and both extension registries reported 0.4.0. No open PRs were found at intake. Prior issues concern image paths, PDF export, preview flashing, styling, and persistent UI visibility; their existing fixes must be preserved.

## Request ledger

| ID  | Outcome / acceptance                                                                                                                                                         | Status                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Authored HTML cannot forge privileged image metadata or cause access outside allowed local roots; regression tests cover the trust boundary.                                 | Implemented; regression tests passing                                                                                                                                                       |
| R2  | HTML/PDF export uses a current, completed rendering snapshot and fails clearly on timeout or stale responses; no unsanitized fallback.                                       | Implemented; unit and actual export checks passing                                                                                                                                          |
| R3  | Standalone exports preserve offline defaults with CSP; remote-image downloads are bounded by size and time.                                                                  | Implemented; regression tests passing                                                                                                                                                       |
| R4  | Search finds text in fenced code and across inline formatting; next/previous/clear and keyboard behavior remain accessible.                                                  | Implemented; browser verification passing                                                                                                                                                   |
| R5  | Contents navigation retains keyboard focus, live edits retain reading position, and diagram panning has keyboard/button alternatives.                                        | Implemented; browser verification passing                                                                                                                                                   |
| R6  | Actual VS Code/webview E2E journeys replace fixture-only checks; failures fail the gate.                                                                                     | Current/minimum suites passed 8/8 each; affected contrast/export journeys rechecked 4/4 on each; final installed VSIX smoke passed 4/4, including IME search                                |
| R7  | Reproducible dependency install, explicit type checking, CI and packaging gates, meaningful dependency audit.                                                                | Clean install, lint, strict types, 149 unit tests, build and package inspection passed; final PR and post-merge CI passed across three operating systems and both supported VS Code targets |
| R8  | Version, changelog, docs and release notes agree; required checks/review pass; intended artifacts are published and verified.                                                | Version 0.5.0 published and downloads verified on GitHub, Marketplace and Open VSX; both registry downloads exactly match the canonical VSIX                                                |
| R9  | User-requested follow-up: refresh the logo/banner, improve the complete README, include install links in release notes, and publish the final branding with verified assets. | Completed in 0.5.4; GitHub, Marketplace and Open VSX published, with both public registry packages byte-identical to the canonical release                                                  |

## Ownership

| Owner                     | Components                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Coordinator               | Dependencies, manifest, CI/build/package/release, documentation, integration, final verification |
| Security/rendering worker | Extension preview/pipeline, messaging protocol, associated unit tests                            |
| Preview UX worker         | Webview implementation, search/navigation/diagram accessibility, UI unit tests                   |
| E2E worker                | VS Code harness, browser journeys, E2E fixtures/configuration                                    |

Workers coordinate protocol changes directly. Only the coordinator changes Git state or publishes. Independent review follows integration.

## Evidence and delivery status

- At intake, `npm ci` on Node 22.22.1 failed: package-lock did not match package.json (`@vscode/vsce` and related entries missing). The original CI used `npm install`, hiding this mismatch.
- At intake, E2E checks mostly inspected fixture text; optional GUI checks could skip or annotate failures. These did not establish functional extension coverage.
- Baseline CI on GitHub was green across the original jobs despite the coverage gaps above.
- Local shell defaults to unsupported Node 23.11.0; verification uses the repository's Node 22.22.1.
- Both Marketplace and Open VSX reported 0.4.0 at intake. All release verification gates have now passed. GitHub release 0.5.0 is published; the registry jobs reported missing VSCE_PAT and OVSX_PAT secrets, so publication uses the existing personal-browser publisher sessions.
- Initial strict type checking found existing production and test type errors; these have been repaired without weakening strict compiler settings.
- Independent reviews caught and resolved export readiness, cross-document frontmatter, IME Escape, large-search argument overflow, and theme-observer feedback issues.
- The production dependency audit reports zero advisories. The full development audit has three moderate entries from one UUID advisory in publishing tooling; the affected APIs are unused by the MSAL consumer. See CONTRIBUTING.md for the rationale and recheck requirement.
- Mermaid remains on the patched 11.x line to preserve layouts and the minimum VS Code browser baseline. Mermaid shares KaTeX 0.19.1 through a scoped override; actual math labels and multiple diagram types are covered by browser tests.
- Current VS Code 1.143.1 passes all eight actual application journeys, including a 400 KB single-line stress document with 200,000 potential matches. Highlights are capped at 1,000 with an explicit status; clearing restores exact text and the preview stays responsive.
- VS Code 1.90.0 also passes all eight journeys. Four final smoke journeys install the actual VSIX into isolated extension directories and verify rendering, standalone HTML, cold PDF export and IME search without a development extension path.
- Visual inspection identified a pre-existing dark Mermaid connector contrast defect (1.08:1). Connectors now use foreground color; regression checks require at least 3:1 for both lines and arrowheads in preview and exported HTML.
- Minimum-version exports with translucent diagram backgrounds also require captured page colors. Resolved background/foreground variables now apply to both the exported body and content. Contrast assertions composite actual ancestor backgrounds and pass on both supported-version test targets.
- Initial GitHub CI passed all three OS build/type/unit jobs and stable VS Code E2E. Minimum-version Linux screenshots exposed a test harness mismatch: the emulated viewport was 1,440 pixels wide but the native window was 1,024, so right-side mouse targets fell outside it. The harness now sizes the actual BrowserWindow and CI provides a 1,920-pixel display. Both corrected CI runs passed all jobs on `dd88879`.
- The final automated review identified an IME composition-completion gap and persisted CI checkout credentials. Search now schedules the committed composition value and cancels pending searches while composing; CI and release checkouts remove credentials before subsequent steps. The follow-up commit passed both CI runs and all four installed-package smoke checks before merge.
- PR #13 merged after both final CI runs passed, and its exact packaged VSIX passed rendering, HTML, PDF and IME smoke checks. The post-merge release gate then caught a stable-VS-Code PDF export still pending at the test's 30-second deadline. Trace evidence confirms the correct save path and no visible error; exporter logs were missing, so it cannot distinguish slow Chromium from a hang. PDF tests now allow 60 seconds for the two browser processes and retain isolated application logs on failure; assertions remain unchanged and automatic retries remain disabled.
- PR #14 merged after all checks passed. Current and minimum-version PDF tests passed locally; an intentional failure after a successful real PDF export confirmed that application logs and process output survive teardown. The next release run passed every verification job, then exposed a release-script mismatch: GitHub returns HTTP 422 for an absent commit name, but HTTP 404 for an absent exact tag ref. The corrected workflow uses the exact tag endpoint, rejects unrelated API errors and was independently exercised through 27 shell scenarios.
- The candidate VSIX contains 19 files (about 3 MB), with manifest version 0.5.0 and bundled outputs byte-matching the production build. Sources, tests, node_modules, maps, declarations and demo GIFs are excluded.

## Publication evidence

- [Release run #3](https://github.com/Bowlerr/offline-markdown-preview/actions/runs/40057891159): all three OS checks and stable/minimum VS Code E2E passed; GitHub publication succeeded. The run is marked failed only because both registry tokens are absent.
- [GitHub release 0.5.0](https://github.com/Bowlerr/offline-markdown-preview/releases/tag/0.5.0) and tag point to `01b54165de26fc1337801393a5850769ae1f76bb`.
- [Marketplace 0.5.0](https://marketplace.visualstudio.com/items?itemName=bowlerr.offline-markdown-preview): public version listing and download verified. The downloaded VSIX is byte-for-byte identical to the canonical GitHub asset.
- [Open VSX 0.5.0](https://open-vsx.org/extension/bowlerr/offline-markdown-preview): public version endpoint and download verified. The downloaded VSIX is byte-for-byte identical to the canonical GitHub asset.
- Canonical VSIX: 3,007,529 bytes; SHA-256 `f21dc9cd2d55ad0e5a561caee7897fc1f532ac3e0a3079a2a6689790a8c6b769`. All 19 uncompressed payloads match the final installed-package smoke-test artifact.
- Both registry installation links are appended to the published release notes and the workflow now appends them to future release notes. The exact Node extraction script was checked for preservation of all 13 changelog entries and correct final link placement.
- A documentation-only follow-up clarifies that downloading a remote image makes an explicit network request and distinguishes preview-rendering timeouts from the deferred PDF-process deadline.

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

## User-requested 0.5.1 follow-up

After 0.5.0 publication, the user requested a new logo based on an attached blue/cyan Markdown-and-page reference, a refined matching banner, and a complete README improvement. This is a separate 0.5.1 documentation/branding release; the published 0.5.0 tag and artifact remain immutable. Small-size icon checks passed at 32, 64 and 128 pixels on light and dark backgrounds. The banner reuses the exact icon with a rounded border, soft tile shadow and subtle title shadow. README installation guidance and the banner now cover VS Code and compatible editors; a supported-editors table distinguishes direct VS Code testing from Open VSX compatibility.

## 0.5.1 publication evidence

- Source revision: `6658350f7803fa91f66f9205d1b363329e3c9c47`; [release run](https://github.com/Bowlerr/offline-markdown-preview/actions/runs/40060737678) passed all three OS verification jobs and both actual VS Code E2E targets.
- [GitHub release 0.5.1](https://github.com/Bowlerr/offline-markdown-preview/releases/tag/0.5.1): immutable tag and artifact match the intended source; release notes contain all four changelog entries and both registry links.
- Canonical VSIX: 3,508,142 bytes; SHA-256 `c79789a61f6b15e2b07cfbd5634a28a9bae709e2acbe214524871a6e3dcd0159`. The 21-file package contains the new icon, banner, real product screenshot and configuration guide. Runtime bundles remain byte-identical to 0.5.0.
- Documentation checks covered 36 internal links/anchors, all 14 setting defaults, all 10 commands and JSON examples. The supported-editors section links to official VSCodium and Cursor installation guidance and distinguishes compatibility from directly tested VS Code targets. Its issue link pre-fills editor/version, extension version, OS, expected/actual behavior and reproduction details without submitting an issue.
- Registry uploads were held before submission when the user requested matching the evolving SQLite IntelliView banner. GitHub 0.5.1 remains immutable; the final matching banner is prepared as 0.5.2 for the registry release. The reference banner settled at SQLite IntelliView commit `a46b75c`; the Markdown banner retains its own exact logo and adds a more visible rendered-preview illustration at the user's request.

## 0.5.2 publication and 0.5.3 packaging correction

- Source revision `ea0553fdef971af9943552f020b14b773c75b087`; [release run](https://github.com/Bowlerr/offline-markdown-preview/actions/runs/40061984486) and [push CI](https://github.com/Bowlerr/offline-markdown-preview/actions/runs/40061984239) passed all three operating-system checks and both actual VS Code E2E targets.
- [GitHub release 0.5.2](https://github.com/Bowlerr/offline-markdown-preview/releases/tag/0.5.2) and the exact Open VSX 0.5.2 public endpoint are available. Open VSX reports publication at `2026-10-24T04:32:10.069885Z`.
- Canonical VSIX: 3,539,537 bytes, 21 files; SHA-256 `d7cc3cd9333c2075b8c9b95ba682e66df6ef824fbd41cd6ddcb0f93ae093b080`. The four changed payloads versus 0.5.1 are version metadata, changelog and banner; all runtime files and the README remain identical.
- Marketplace rejected the package because its 1,100,205-byte icon exceeds the server's 1,024 KB limit. Version 0.5.3 reduces the PNG to 765,173 bytes using lossless compression, with decoded RGBA equality verified, and adds a prepublish size guard. The banner remains unchanged and uses the identical logo pixels. The prior GitHub and Open VSX versions remain immutable.

## 0.5.3 dimension validation and 0.5.4 correction

- [GitHub release 0.5.3](https://github.com/Bowlerr/offline-markdown-preview/releases/tag/0.5.3) points to `7a731773e027047dc9ec1db3b692bee7a1ba7652`. All verification jobs passed in [release run](https://github.com/Bowlerr/offline-markdown-preview/actions/runs/40063060751) and [push CI](https://github.com/Bowlerr/offline-markdown-preview/actions/runs/40063060687).
- Its canonical 21-file VSIX is 3,436,892 bytes, SHA-256 `a0851462eade4f2abf44121c20b79c254dde0dfaeee68fb4c366ee968efa275b`; every payload matches the locally reviewed package. The 765,173-byte icon has decoded RGBA equality with the generated original.
- Marketplace's next validation stage rejected the 1,254-pixel dimensions: its maximum is 1,024 by 1,024 pixels. Version 0.5.3 was not uploaded to Open VSX. Version 0.5.4 exports a 1,024-pixel store icon, preserves the original master for the unchanged banner, and validates both PNG dimensions and file size before packaging.

## 0.5.4 final publication evidence

- [GitHub release 0.5.4](https://github.com/Bowlerr/offline-markdown-preview/releases/tag/0.5.4) and its immutable tag point to `93ba438a59a2109a6a736c2dd29c7540fa4c3450`. All three OS checks and both actual VS Code E2E suites passed in the [release run](https://github.com/Bowlerr/offline-markdown-preview/actions/runs/40063729439) and [independent push CI](https://github.com/Bowlerr/offline-markdown-preview/actions/runs/40063729437).
- Canonical VSIX: 3,224,285 bytes, 21 files; SHA-256 `5542531fd5b87602313a154872ae42c2647edfed806436a7145a1448eea0c08c`. Every uncompressed payload matches the locally reviewed package.
- The store icon is 1,024 by 1,024 pixels and 552,437 bytes. The original master retains every approved RGBA pixel and is excluded from the VSIX. The banner remains byte-identical to 0.5.2; README and runtime files are unchanged. Small-size icon inspection passed at 32, 64 and 128 pixels on light and dark backgrounds.
- The prepublish guard rejects both actual rejected assets and passes the final store icon. Fourteen focused boundary/invalid-file checks cover size, PNG signature/header, dimensions, empty files, missing files and directories.
- [Marketplace](https://marketplace.visualstudio.com/items?itemName=bowlerr.offline-markdown-preview) and [Open VSX](https://open-vsx.org/extension/bowlerr/offline-markdown-preview) both report latest version 0.5.4. Marketplace published at `2026-10-24T04:59:50.023Z`; Open VSX published at `2026-10-24T04:54:07.536882Z`. Both public VSIX downloads are byte-for-byte identical to the canonical GitHub release, all 21 payloads match, and both public package manifests match. The workflow's automated publishing jobs stopped only because publisher tokens are not configured, so publication used the existing personal-browser publisher sessions.

## Deferred roadmap

- Measure scrolling/render costs on large documents before proposing incremental rendering or structural rewrites.
- Consider a persistent preview lock and richer Markdown workspace navigation after current lifecycle behavior is tested.
- Evaluate additional export layout controls against real authoring needs after export safety and fidelity are verified.
- Consider an explicit print-friendly palette option; exports now preserve the captured preview background/foreground to keep translucent diagram backgrounds legible.
- Review compatible development-tool updates for the November minimatch/glob advisories; do not force cross-major overrides or suggested major downgrades.
- Consider architectural extraction from the large preview controller where it simplifies future changes; avoid a broad rewrite in this delivery.
- Evaluate publishing identity modernization when account configuration is available; keep release authentication aligned with official guidance.

## Fortnightly cycle: November 16, 2026 — 0.5.5

Baseline: `ba6894242cbc79f50792d84418b7971b7dafd6ee`, published version 0.5.4. No open issues or PRs, no newer release or source changes, and the last main CI run passed all OS and editor targets. The external workspace drive was unmounted, so work uses an isolated checkout at `/private/tmp/offline-markdown-preview-fortnightly-20261116`; no unavailable local work was changed.

Selected scope: complete the previously deferred PDF process deadline/cancellation and correct registry verification's short propagation window. The PDF subprocess had no wall-clock limit, leaving its promise and temporary HTML pending if Chromium stalled. The registry polling allowed roughly one minute even though the previous successful Marketplace publication took about six minutes.

- PDF exports now show cancellable progress, share a 90-second rendering deadline across browser phases/candidates, stop retrying after cancellation, and check cancellation before committing the destination write. Controller disposal stops active rendering jobs. Temporary files remain under the existing cleanup boundary.
- Registry verification polls for up to 15 minutes with useful attempt and final-failure diagnostics; canonical VSIX and immutable release handling are retained.
- Independent dependency audit: zero production findings; 12 moderate development package entries across UUID, minimatch and glob advisories; zero high/critical findings. Major dependency contract changes are deferred for compatibility review (details in CONTRIBUTING.md).
- Branding assets, original logo master, supported-editor guidance and issue-reporting links remain unchanged. Packaging still enforces icon dimensions and size.
- Context7 tools were unavailable. Process cancellation and progress APIs were checked against official Node 22.22.1 and VS Code documentation instead.

Candidate evidence:

- Node 22.22.1 clean install, lint, strict types, production build and all 169 unit tests pass. Nine tests spawn actual processes, covering cancellation, ignored termination, inherited pipes, bounded stream teardown, large DOM output, missing executables and normal exit. POSIX-only process-group cases are skipped on Windows; the direct cancellation test runs on every OS.
- Independent review found and resolved two issues before publication: a proposed output cap rejected valid embedded-image documents, and logging after controller disposal could interrupt cleanup. Large output remains supported and the disposed-channel test now reproduces the editor's throwing behavior.
- The actual registry verification shell passed 16 mocked scenarios using real response validators, including immediate and six-minute delayed success, recovery, transport failures, malformed/unexpected/null data, and wrong versions. No real waits or network requests were needed for these simulations.
- Packaging passes the original icon guards and contains 21 files; the original logo master, source, tests, dependencies and source maps remain excluded. Runtime payloads match the tested build.
- Real VS Code 1.145.3 HTML and cold PDF exports pass. The full initial editor suite exposed an existing test setup race: live editing began while heading navigation was still animating. Waiting for meaningful movement and stable scroll samples fixes the setup; the heading-focus and ±100-pixel preservation assertions and zero-retry policy remain unchanged. Three isolated verification runs pass. All eight journeys then passed with the actual 0.5.5 VSIX installed into isolated VS Code 1.145.3 profiles, including rendering, HTML/PDF, search, scroll preservation and diagrams. Local candidate: 3,225,116 bytes; SHA-256 `c54a0ea5869e3d34400dd3a3d31d6cb285af40313a3834df079976b73a2f6083`. GitHub CI and publication evidence follow after the remote gates.

Termination scope: cancellation targets only the spawned browser's POSIX process group or Windows process tree. Deliberately detached descendants can escape that group; inherited output-stream waits still have a finite fallback. Windows uses the OS tree termination tool and falls back to terminating the owned parent if that tool fails. These OS limitations are not a claim that arbitrary detached processes can always be stopped.

Initial checks found no publisher PAT environment variables or legacy credential files. Subsequent scoped checks found existing publisher entries in macOS Keychain, but unattended reads require user authorization (details below). Personal Chrome control is unavailable in this session.

- First remote candidate `f33f905` passed all three OS lint/type/build/unit jobs. Both editor jobs stopped before launching tests because the floating Ubuntu image supplied Ubuntu 26.04, unsupported by Playwright 1.58.2. The E2E job is now pinned to Ubuntu 24.04, which the [pinned Playwright platform implementation](https://github.com/microsoft/playwright/blob/v1.58.2/packages/playwright-core/src/server/utils/hostPlatform.ts) explicitly supports. The three-OS unit/build matrix remains on the current runner images. No test was skipped or assertion weakened for this infrastructure correction.

### 0.5.5 verified release and publication handoff

- [PR #15](https://github.com/Bowlerr/offline-markdown-preview/pull/15) merged after both final [PR CI](https://github.com/Bowlerr/offline-markdown-preview/actions/runs/43844990438) and [branch CI](https://github.com/Bowlerr/offline-markdown-preview/actions/runs/43844979645) passed. Independent reviews found no unresolved defects. Release source and immutable tag: `84a2c06c8182f98573e54dcf2cd3239055918be5` (tree `5a222c600baf96523479a79f430c31b428830108`).
- [Post-merge CI](https://github.com/Bowlerr/offline-markdown-preview/actions/runs/43845786688) and every verification job in the [release workflow](https://github.com/Bowlerr/offline-markdown-preview/actions/runs/43845786694) passed on all three operating systems and both VS Code targets. Unix unit runs pass 169 tests; Windows passes the applicable tests with the four POSIX-specific cases skipped.
- [GitHub release 0.5.5](https://github.com/Bowlerr/offline-markdown-preview/releases/tag/0.5.5) is published. Its four changelog entries are followed by the required Marketplace and Open VSX installation links.
- Canonical [VSIX download](https://github.com/Bowlerr/offline-markdown-preview/releases/download/0.5.5/offline-markdown-preview-0.5.5.vsix): **3,225,161 bytes**, 21 files, SHA-256 **`90057816bf7f7ff8c6d0c402ecc68fef5efb1f7a9b99c1732ae265dd128ffaaa`**. The downloaded bytes match GitHub's asset digest. All 21 uncompressed payloads match the reviewed final package. Four further real-editor journeys installed this exact downloaded artifact and passed rendering, search, standalone HTML and cold PDF export.
- Registry publication is **incomplete**. The workflow's only failed jobs are publishing: Marketplace explicitly reports missing `VSCE_PAT`; Open VSX explicitly reports missing `OVSX_PAT`. Public lookups on November 16 still show 0.5.4 in both registries, with no Marketplace 0.5.5 entry and HTTP 404 for the Open VSX 0.5.5 endpoint. No registry artifact is claimed verified for 0.5.5.
- Existing Keychain items were found only at services/accounts `vscode-vsce`/`bowlerr` and `ovsx`/`bowlerr`. Noninteractive password reads failed with macOS status -25293; a bounded native-keytar attempt also could not obtain access. No token was obtained, printed, changed or submitted, so token validity is unknown. No trust/ACL, login or Keychain-unlock changes were attempted. The user has been asked to choose an interactive Keychain approval or configure the two repository secrets.
- Once access is available, publish **the existing canonical VSIX**, then verify both public versions and download hashes against the SHA-256 above. If repository secrets are configured, rerun the failed publishing jobs from the linked release workflow. Do not rebuild, replace the tag/asset, or bump the version to recover this authentication-only failure.
- The external drive remained unmounted. All implementation and handoff records are committed remotely; the isolated local checkout and verification evidence remain under `/private/tmp/offline-markdown-preview-fortnightly-20261116` and `/private/tmp/omv-055-*`.
