# Preview Styling Setup

This guide shows how to style Offline Markdown Preview with installed GitHub styling or your own CSS.

You can either toggle the built-in GitHub styling import, set the paths directly in settings JSON, or run **Offline Markdown Preview: Set Custom CSS** from the Command Palette and choose the style option interactively.

The extension supports two layers:

- `offlineMarkdownViewer.preview.useMarkdownPreviewGithubStyling`: import CSS from the installed `bierner.markdown-preview-github-styles` extension.
- `offlineMarkdownViewer.preview.globalCustomCssPath`: a user-level stylesheet applied to every preview.
- `offlineMarkdownViewer.preview.customCssPath`: a workspace- or folder-level stylesheet applied after the global stylesheet.

If all three are configured, the installed GitHub styling is injected first, then global CSS, then workspace CSS. Workspace CSS wins on conflicts because it is injected last.

For a repo-local test file you can use immediately, this repository includes `docs/custom-css/test-preview.css`.

## When To Use Each Setting

Use the installed GitHub styling setting when you already have **Markdown Preview Github Styling** installed and want to reuse its CSS directly, including its own `colorTheme`, `lightTheme`, and `darkTheme` settings.

Use the global setting when you want one consistent look everywhere, including when you want to layer your own tweaks on top of the imported GitHub theme.

Use the workspace setting when a specific repo needs extra tweaks, such as wider tables, different code block colors, or custom typography.

If you would like Offline Markdown Preview to support another Markdown styling extension directly, open an issue with the extension name and a link to it so compatibility can be evaluated.

## Installed GitHub Styling Setup

1. Install **Markdown Preview Github Styling** (`bierner.markdown-preview-github-styles`).
2. Enable `offlineMarkdownViewer.preview.useMarkdownPreviewGithubStyling` in user settings.
3. Reopen the preview or update the setting while the preview is open.

You can also run **Offline Markdown Preview: Set Custom CSS** and choose **Use Installed GitHub Markdown Styling**.

## Global CSS Setup

1. Create a CSS file somewhere on your machine.
2. Open VS Code user settings JSON.
3. Set `offlineMarkdownViewer.preview.globalCustomCssPath` to the absolute path of that file.

Example:

```json
{
  "offlineMarkdownViewer.preview.globalCustomCssPath": "/Users/you/.config/offline-markdown-preview/github-markdown.css"
}
```

Notes:

- The path must be absolute.
- The file must end in `.css`.
- `~` and environment variable expansion are not supported.

## Workspace CSS Setup

1. Add a CSS file inside your workspace, for example `.vscode/markdown-preview.css` or `docs/preview.css`.
2. Open workspace settings JSON.
3. Set `offlineMarkdownViewer.preview.customCssPath` to the path relative to the workspace root.

Example:

```json
{
  "offlineMarkdownViewer.preview.customCssPath": ".vscode/markdown-preview.css"
}
```

This repository already includes a workspace example in `.vscode/settings.json` that points to `docs/custom-css/test-preview.css`.

Notes:

- The path must stay inside the workspace.
- The file must end in `.css`.
- Paths like `../theme.css` are rejected.

## GitHub-Style Setup

To get close to GitHub Markdown styling with the least setup:

1. Install **Markdown Preview Github Styling**.
2. Enable `offlineMarkdownViewer.preview.useMarkdownPreviewGithubStyling`.
3. Reopen the preview or update the setting while the preview is open.

If you want to tweak that imported theme:

1. Create a CSS file somewhere on your machine.
2. Point `offlineMarkdownViewer.preview.globalCustomCssPath` to that file.
3. Add only your overrides there.

If you prefer not to install the GitHub styling extension, you can still save a GitHub-like stylesheet as a local file and point `offlineMarkdownViewer.preview.globalCustomCssPath` to it.

You can then add a workspace override if a repo needs small adjustments.

Example workspace override:

```css
.markdown-body {
  max-width: 980px;
  margin: 0 auto;
}
```

## Minimal Example CSS

If you want a starting point instead of a full theme:

```css
body {
  background: #ffffff;
}

.markdown-body {
  max-width: 920px;
  margin: 0 auto;
  color: #24292f;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  line-height: 1.6;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3 {
  border-bottom: 1px solid #d0d7de;
  padding-bottom: 0.3em;
}

.markdown-body code {
  background: rgba(175, 184, 193, 0.2);
  border-radius: 6px;
  padding: 0.2em 0.4em;
}
```

## Troubleshooting

If your styles do not apply:

- Confirm `offlineMarkdownViewer.preview.useMarkdownPreviewGithubStyling` is enabled if you want to import CSS from the installed GitHub styling extension.
- Confirm `bierner.markdown-preview-github-styles` is installed if the GitHub styling import is enabled.
- Confirm the path is valid and points to a real `.css` file; non-`.css` files are ignored.
- Use an absolute path for `offlineMarkdownViewer.preview.globalCustomCssPath`. This is a user-level opt-in for loading a stylesheet from anywhere on your machine.
- Use a workspace- or folder-relative path for `offlineMarkdownViewer.preview.customCssPath`.
- Make sure the workspace or folder path does not leave the workspace root.
- Check whether a workspace or folder stylesheet is overriding the imported GitHub styling or global stylesheet, because repo-local CSS is injected last and wins on conflicts.

If the path is invalid or unreadable, the extension shows a warning and continues rendering the preview without that stylesheet.
