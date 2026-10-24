# Contributing to Offline Markdown Preview

Thank you for your interest in contributing. Pull requests, bug reports, and feature suggestions are welcome.

## How to Contribute

1. **Fork the repository**
2. **Create a branch** for your feature or bug fix
3. **Make your changes** with clear, descriptive commit messages
4. **Test your changes** (unit tests and/or e2e where relevant)
5. **Update documentation** if behaviour or settings changed
6. **Open a pull request** against the main branch

## Code Guidelines

- Keep changes focused and easy to review
- Preserve offline-first and security-focused behaviour
- Add or update tests for bug fixes and new features when practical
- Keep user-facing docs/settings descriptions accurate

## Development and verification

Use the Node version in `.nvmrc` (`nvm use`), then `npm ci`. npm and `package-lock.json` are the canonical dependency workflow.

Run `npm run check` for lint, strict TypeScript checking, unit tests, and the production build. Run `npm run watch` for readable development bundles.

`npm run test:e2e` launches a real VS Code instance with an isolated temporary profile and workspace. It exercises rendering, keyboard navigation, search, live edits, offline behavior, and HTML/PDF export. Install the test browser with `npx playwright install chromium`; use `xvfb-run -a npm run test:e2e` on headless Linux. A missing display or failed application launch fails the suite.

Set `VSCODE_EXECUTABLE_PATH` to test an existing VS Code executable, or `OMV_E2E_VSCODE_VERSION` to download a specific version. E2E traces and screenshots are written under `test-results/e2e`.

## Release process

1. Update the version in `package.json` and `package-lock.json`, and write the changelog and any behavior documentation.
2. Run `npm ci`, `npm run check`, `npm run test:e2e`, and `npm audit`. Review dependency advisories in context; do not silently force major upgrades.
3. Run `npm run package`, inspect the VSIX contents, and verify installation and key workflows. Demo GIFs stay in the repository/Marketplace README and are excluded from the installed package.
4. Commit the verified source and obtain passing CI/review. CI checks lint, strict types, build and units on Linux, Windows and macOS, plus real E2E journeys on stable and minimum-supported VS Code.
5. Merge the version change to `main`. The Release workflow repeats the gates, creates a version tag and GitHub release, and publishes the **same verified VSIX** to both registries using repository secrets `VSCE_PAT` and `OVSX_PAT`. Missing credentials fail the affected publishing job explicitly. A workflow retry reuses an existing GitHub release asset only when its tag matches the source revision.
6. Verify both registry versions and download metadata against the intended artifact. Report a partial publication explicitly if one registry fails. For manual recovery, download the existing GitHub release VSIX and use `npx --no-install vsce publish --packagePath offline-markdown-preview-VERSION.vsix` and `npx --no-install ovsx publish offline-markdown-preview-VERSION.vsix`, or upload that file in the publisher interface. Never commit or print credentials.

The dependency overrides intentionally share patched KaTeX between the preview and Mermaid while preserving Mermaid 11 layouts, and keep publishing tooling on Azure Identity 4.13.0 (the compatible MSAL 3 dependency line) until its newer dependency resolves GHSA-xcx6-jx8p-x3h5. Reassess these overrides with upstream updates and rendering/publishing checks.

The October 2026 audit reports no production advisories. Three moderate development dependency entries share GHSA-w5hq-g745-h8pq in MSAL's UUID 8 dependency; its affected v3/v5/v6 buffer functions are not used by MSAL's `uuid.v4()` call. These publishing tools are excluded from the VSIX. We retain the supported dependency contract instead of forcing UUID across major versions; reassess when Azure publishes compatible fixes.

## Reporting Issues

- Use the [issue tracker](https://github.com/Bowlerr/offline-markdown-preview/issues) for bugs and feature requests.
- Include reproduction steps, sample Markdown (if relevant), screenshots, and logs/errors
- Note your VS Code version, OS, and extension version

## Security / Safety Notes

- Please do not post sensitive document contents or private data in public issues
- If the issue relates to sanitization, CSP, or link-handling safety, include a minimal reproducible example

## Code of Conduct

Be respectful and inclusive. We follow the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

## Questions?

Open an issue (`https://github.com/Bowlerr/offline-markdown-preview/issues/new`) and include context on what you are trying to do.
