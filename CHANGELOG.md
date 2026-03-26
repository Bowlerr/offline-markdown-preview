# Changelog

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
