# Changelog

## 0.5.2

- Align the banner with the SQLite IntelliView companion design: a shared navy-and-cyan palette, local/offline/free label, full-height rendered Markdown preview illustration that fades toward the title
- Preserve the exact approved Markdown logo, rounded app frame, and soft shadows

## 0.5.1

- Refresh the extension icon and README banner with a clearer Markdown-and-page identity
- Reorganize the README with direct installation links, a shorter quick start, focused demos, and clearer configuration, privacy, and export guidance
- Clarify support for VS Code and compatible editors, including installation through Open VSX
- Add Marketplace and Open VSX installation links to generated GitHub release notes

## 0.5.0

- Search fenced code and phrases spanning inline formatting, with previous-match keyboard navigation, clear no-results feedback, and accessible controls
- Preserve the reading position during live updates and keyboard focus in the contents list
- Add keyboard and button controls for diagram panning, improve focus indicators and image actions, and respect reduced-motion preferences
- Improve Mermaid connector and arrow contrast in the preview and exported documents
- Preserve the preview background and text colors in standalone exports so translucent diagram backgrounds retain their contrast
- Serialize preview rendering so rapid edits cannot mix diagram/math output from different document versions
- Export only a completed snapshot of the requested document, including when exporting before the preview has opened; report a clear error if rendering cannot finish
- Apply offline Content Security Policy to HTML/PDF exports, retaining the remote-image opt-in and preventing document scripts from running in exported files
- Reject forged internal image attributes and unauthorized local image paths, including symlink escapes, before opening or embedding files
- Bound remote-image downloads by the configured image size and a 30-second timeout
- Update affected rendering and validation dependencies, add strict TypeScript checking, and make dependency installs reproducible with one npm lockfile
- Replace fixture-only E2E checks with real VS Code preview, search, navigation, diagram, HTML-export and PDF-export journeys
- Minify production bundles and exclude demonstration GIFs from the installed extension package

## 0.4.0

- Resolve percent-encoded local image paths, including filenames with spaces and reserved characters, while rejecting malformed or unsafe encoded separators
- Make PDF export wait for images and fonts before rendering and validate that Chromium loaded the generated export document
- Correct PDF export for Markdown filenames containing special characters such as `#` and `?`
- Stage PDF output before writing through the VS Code filesystem API, clean up temporary files, and report actionable failures in the Offline Markdown Preview output channel

## 0.3.1

- Keep the preview panel fixed in its current group while switching between Markdown files instead of re-revealing it on each file change
- Reuse the remembered preview group when reopening the preview so docked previews no longer unexpectedly reopen at the bottom
- Stop auto-revealing hidden preview tabs during Markdown editor switches and rerender when the preview becomes visible again to restore correct styling
- Rename the primary command to `Open Preview` and rename the current-group variant to `Open Preview in Current Group`

## 0.3.0

- Add `offlineMarkdownViewer.preview.useMarkdownPreviewGithubStyling` to import CSS directly from the installed `bierner.markdown-preview-github-styles` extension
- Make the preview/export markdown root compatible with GitHub-style `.markdown-body` selectors while keeping OMV chrome outside that styled content root
- Extend the preview styling command and docs so installed GitHub styling can be enabled without copying versioned extension CSS paths
- Rewrite local image paths inside raw HTML `<img>` tags so README/table-based GIF demos render correctly in the preview webview
- Raise the default `offlineMarkdownViewer.preview.maxImageMB` limit from `8` MB to `24` MB so the bundled README demo GIFs render in preview without extra configuration
- Persist search panel visibility inside the preview so it stays in the preferred state across refreshes and reopened panels
- Persist table-of-contents visibility changes made in the preview UI

## 0.2.0

- Add `offlineMarkdownViewer.preview.globalCustomCssPath` for user-level preview styling and compose it with workspace- and folder-level `preview.customCssPath`
- Add an `Offline Markdown Preview: Set Custom CSS` command to pick or clear global/workspace preview styles from the Command Palette
- Update open previews immediately when custom CSS files change and include custom CSS in exported HTML/PDF output

## 0.1.0

- Initial release
- Offline-first secure Markdown preview webview
- Scroll sync, search, and outline/ToC support
- Mermaid, KaTeX, and Prism local bundling
- HTML/PDF export commands
- Unit tests, e2e harness, and CI workflow
