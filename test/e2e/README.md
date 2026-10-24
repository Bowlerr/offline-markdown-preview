# VS Code end-to-end tests

These tests launch the built extension in a real VS Code window with a fresh
profile, extension directory, and copy of the Markdown fixtures for every test.
They drive the workbench, inspect the actual preview webview, and use the real
export commands. Launch failures and missing rendered output fail the suite.

```sh
npm run build
npx playwright install chromium
npm run test:e2e
```

On headless Linux, use `xvfb-run -a npm run test:e2e`. PDF export additionally
requires an installed Chrome, Chromium, or Edge executable discoverable by the
extension. GitHub's Ubuntu runner includes Google Chrome.

The runner downloads stable VS Code by default. Set `OMV_E2E_VSCODE_VERSION` to
test a specific supported version, or `VSCODE_EXECUTABLE_PATH` to use an existing
VS Code application binary. Set `OMV_E2E_CHROMIUM_EXECUTABLE_PATH` to use an
existing Chromium browser for the standalone HTML check instead of Playwright's
installed browser. Playwright filters are forwarded, for example:

```sh
npm run test:e2e -- --grep 'cold preview'
```

Set `OMV_E2E_VSIX_PATH` to a packaged `.vsix` to install it through VS Code's own
CLI into each test's isolated extension directory. In this mode the development
extension path is omitted, so the journeys exercise the installed artifact and
cannot accidentally load the repository's build instead.

Coverage includes local images, blocked remote images, sanitization, math,
Mermaid flowchart/sequence/class diagrams and math labels, search across inline
formatting and highlighted code, keyboard controls, ToC focus, live edits,
scroll preservation, HTML export rendered in a separate browser, and cold-start
PDF export through the extension's Chromium renderer. A 400 KB single-line code
fixture verifies that very large search results are bounded, the browser stays
responsive, and clearing highlights preserves the original content.

Screenshots, traces, and exported artifacts are written under `test-results/e2e`.
The PDF test checks that the real export command produces a complete PDF; it
does not assert pixel-perfect pagination. The tests do not claim to cover every
OS, VS Code version, screen reader, or diagram grammar from a single run.
