# Changelog

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
