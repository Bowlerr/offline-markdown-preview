# Custom CSS Setup

This guide shows how to style Offline Markdown Preview with your own CSS.

You can either set the paths directly in settings JSON or run **Offline Markdown Preview: Set Custom CSS** from the Command Palette and pick the file interactively.

The extension supports two layers:

- `offlineMarkdownViewer.preview.globalCustomCssPath`: a user-level stylesheet applied to every preview.
- `offlineMarkdownViewer.preview.customCssPath`: a workspace-level stylesheet applied after the global stylesheet.

If both are configured, workspace CSS wins on conflicts because it is injected second.

For a repo-local test file you can use immediately, this repository includes `docs/custom-css/test-preview.css`.

## When To Use Each Setting

Use the global setting when you want one consistent look everywhere, such as a GitHub-like Markdown theme.

Use the workspace setting when a specific repo needs extra tweaks, such as wider tables, different code block colors, or custom typography.

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

To get close to GitHub Markdown styling:

1. Download or create a GitHub-like Markdown stylesheet.
2. Save it as a local file such as `/Users/you/.config/offline-markdown-preview/github-markdown.css`.
3. Point `offlineMarkdownViewer.preview.globalCustomCssPath` to that file.
4. Reopen the preview or update the setting while the preview is open.

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

- Confirm the path is valid and points to a real `.css` file.
- Use an absolute path for `offlineMarkdownViewer.preview.globalCustomCssPath`.
- Use a workspace-relative path for `offlineMarkdownViewer.preview.customCssPath`.
- Make sure the workspace path does not leave the workspace root.
- Check whether a workspace stylesheet is overriding the global one.

If the path is invalid or unreadable, the extension shows a warning and continues rendering the preview without that stylesheet.
