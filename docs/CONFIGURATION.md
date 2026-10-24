# Configuration and command reference

[← Back to the overview](../README.md)

Open your editor's Settings and search for **Offline Markdown Preview**, or use settings JSON. All extension settings begin with `offlineMarkdownViewer.`. Defaults below match the extension manifest; interface labels may vary between compatible editors. See the [installation and compatibility notes](../README.md#quick-start).

[Reading and rendering](#reading-and-rendering) · [Privacy and images](#privacy-and-images) · [Appearance](#appearance) · [Export](#export) · [Commands](#commands) · [Shortcuts](#keyboard-and-mouse-controls) · [Troubleshooting](#troubleshooting-and-known-limits)

## Reading and rendering

| Setting                                         | Default | Behavior                                                                                 |
| ----------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `offlineMarkdownViewer.preview.autoOpen`        | `true`  | Open or reuse the preview in its remembered group when a Markdown editor becomes active. |
| `offlineMarkdownViewer.scrollSync`              | `true`  | Synchronize scrolling between the editor and preview.                                    |
| `offlineMarkdownViewer.enableMermaid`           | `true`  | Render Mermaid diagrams with the bundled library.                                        |
| `offlineMarkdownViewer.enableMath`              | `true`  | Render math with bundled KaTeX.                                                          |
| `offlineMarkdownViewer.preview.showFrontmatter` | `false` | Show YAML frontmatter above the rendered document.                                       |
| `offlineMarkdownViewer.performance.debounceMs`  | `120`   | Delay live updates after editing, in milliseconds. Allowed range: 30–1,000.              |

Search includes code blocks and text across inline formatting. It highlights and navigates the first 1,000 matches; the status indicates when there are more. This limit is not configurable.

## Privacy and images

| Setting                                           | Default | Behavior                                                                                                                                                                  |
| ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `offlineMarkdownViewer.sanitizeHtml`              | `true`  | Sanitize rendered HTML. Turning this off is unsafe for untrusted Markdown or HTML.                                                                                        |
| `offlineMarkdownViewer.externalLinks.confirm`     | `true`  | Ask before opening external links in your browser.                                                                                                                        |
| `offlineMarkdownViewer.preview.allowRemoteImages` | `false` | Permit direct HTTP(S) image loading in the preview and exports. When disabled, use a placeholder's **Download Image** action to fetch a specific image.                   |
| `offlineMarkdownViewer.preview.maxImageMB`        | `24`    | Size limit for local images and explicit downloads, in MB. Allowed range: 1–100. This limit does not govern remote images loaded directly when remote images are enabled. |

Explicit image downloads also have a 30-second timeout. Downloading an image or enabling remote images makes network requests; neither is needed to render local Markdown, diagrams, or math.

Local image actions and embedding allow files inside the document's workspace, its containing directory when opened outside a workspace, or the extension's image cache. Files outside these roots, including symlinks that escape them, are rejected.

The preview restricts network access with Content Security Policy, including `connect-src 'none'`, and blocks HTTP(S) calls through `fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource` in the webview. Remote-image opt-in and explicit downloads are separate, intentional network paths.

### Remote image cache

**Download Image** fetches a blocked image and associates the cached file with its URL in the current preview.

| Location                     | Cache directory                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| Document inside a workspace  | `.offline-markdown-preview/remote-images` in that workspace folder                  |
| Document outside a workspace | `remote-images` in the extension's global storage directory, managed by your editor |

Cached files remain on disk, but URL-to-file associations last only for the current preview session. After closing and reopening the preview, an image may need to be downloaded again.

- **Show Remote Image Cache Usage** reports file counts and total size.
- **Clear Remote Image Cache** asks before deleting the cache and resets downloaded-image associations.

Both commands have the **Offline Markdown Preview:** prefix in the Command Palette.

## Appearance

| Setting                                                         | Default | Where to configure it                                                                                                                                                    |
| --------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `offlineMarkdownViewer.preview.useMarkdownPreviewGithubStyling` | `false` | User settings. Import styles from the installed `bierner.markdown-preview-github-styles` extension, respecting its `colorTheme`, `lightTheme`, and `darkTheme` settings. |
| `offlineMarkdownViewer.preview.globalCustomCssPath`             | `""`    | User settings. An explicitly chosen absolute path to a `.css` file applied across projects.                                                                              |
| `offlineMarkdownViewer.preview.customCssPath`                   | `""`    | Workspace or folder settings. A workspace-relative `.css` path that stays inside its workspace.                                                                          |

The two user settings use the VS Code extension API's `machine` scope; the workspace CSS setting uses `resource` scope. An empty CSS path disables that custom layer. `~` and environment-variable expansion are not supported in CSS paths.

Styles are applied in this order:

1. Extension base styles.
2. Installed GitHub preview styles, if enabled.
3. Global custom CSS.
4. Workspace or folder custom CSS.

Later styles can override earlier ones according to the normal CSS cascade, including specificity and `!important`.

Run **Offline Markdown Preview: Set Custom CSS** to select a layer interactively. For setup instructions and copyable examples, see the [custom CSS guide](custom-css/README.md).

## Export

| Setting                                    | Default | Behavior                                                                                                                                                                              |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `offlineMarkdownViewer.export.embedImages` | `false` | Embed permitted local images as data URIs in HTML or PDF intermediates, subject to the image size limit. A confirmation appears because the export will include those image contents. |

Use **Export HTML** or **Export PDF** from the Command Palette, or select a format with the preview's **Export** button. Both formats use a completed preview snapshot and preserve its captured page colors. A document change during capture or a preview-rendering timeout cancels export with a message to retry.

HTML includes the rendered document and styles. With image embedding disabled, local images remain `file:` references and may not be accessible when you share the HTML. Enable embedding when the export should include their contents; review the result before sharing it.

PDF requires a locally installed Chrome, Edge, or Chromium. It runs locally and waits for document resources, including images and fonts. Browser and platform differences can affect layout. Browser processes do not currently have an overall wall-clock deadline, so a stalled browser can leave PDF export pending; the preview snapshot timeout does not cover this stage.

Exports block remote images unless `preview.allowRemoteImages` is enabled, and prevent authored document scripts from running. For PDF errors, inspect the **Offline Markdown Preview** channel under **View → Output**.

## Commands

Every command below has the **Offline Markdown Preview:** prefix in the Command Palette. The command IDs are also available for custom keyboard shortcuts in compatible editors.

| Command                           | Command ID                                        | Purpose                                                           |
| --------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| **Open Preview**                  | `offlineMarkdownViewer.openPreviewToSide`         | Open in the remembered preview group, or beside the editor.       |
| **Open Preview in Current Group** | `offlineMarkdownViewer.openPreview`               | Open in the active editor group.                                  |
| **Export HTML**                   | `offlineMarkdownViewer.exportHtml`                | Save the completed preview as HTML.                               |
| **Export PDF**                    | `offlineMarkdownViewer.exportPdf`                 | Save the completed preview as PDF using a local browser.          |
| **Set Custom CSS**                | `offlineMarkdownViewer.configureCustomCss`        | Select installed GitHub styling or a global/workspace stylesheet. |
| **Show Remote Image Cache Usage** | `offlineMarkdownViewer.showRemoteImageCacheUsage` | Inspect cached image counts and size.                             |
| **Clear Remote Image Cache**      | `offlineMarkdownViewer.clearRemoteImageCache`     | Remove downloaded images after confirmation.                      |
| **Toggle Scroll Sync**            | `offlineMarkdownViewer.toggleScrollSync`          | Turn editor/preview scroll synchronization on or off.             |
| **Copy Heading Link**             | `offlineMarkdownViewer.copyHeadingLink`           | Choose a heading and copy its anchor link.                        |
| **Quick Pick Heading**            | `offlineMarkdownViewer.quickPickHeading`          | Choose a heading to navigate to.                                  |

The extension does not register editor keybindings by default. To assign one, open your editor's keyboard shortcut settings and search for the command name (**Keyboard Shortcuts** in VS Code).

## Keyboard and mouse controls

These controls apply while focus is inside the preview.

| Context                     | Input                        | Action                                             |
| --------------------------- | ---------------------------- | -------------------------------------------------- |
| Preview                     | `Ctrl+F` / `Cmd+F`           | Open or focus search and select its current query. |
| Search field                | `Enter`                      | Next match.                                        |
| Search field                | `Shift+Enter`                | Previous match.                                    |
| Preview with search visible | `Escape`                     | Hide search and focus its toggle.                  |
| Focused diagram             | Arrow keys                   | Pan.                                               |
| Focused diagram             | `+` / `=` and `-`            | Zoom in and out.                                   |
| Focused diagram             | `F`                          | Fit to the viewport.                               |
| Focused diagram             | `0`                          | Show at actual size.                               |
| Diagram                     | Drag                         | Pan.                                               |
| Diagram                     | `Ctrl` / `Cmd` + mouse wheel | Zoom at the pointer.                               |
| Diagram                     | Double-click                 | Fit to the viewport.                               |
| Focused local image         | `Enter` / `Space`            | Open the image.                                    |

The diagram toolbar provides button alternatives for pan, zoom, fit, and actual size. Search leaves composition keystrokes to your input method; it searches the committed text when composition ends.

## Troubleshooting and known limits

| Problem                                       | What to check                                                                                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview does not open automatically           | Confirm `preview.autoOpen` is enabled and the document's language mode is Markdown, or run **Open Preview**.                                                                 |
| Mermaid or math does not render               | Check `enableMermaid` / `enableMath` and the source syntax. Invalid input may appear as code or plain text.                                                                  |
| A local image is missing                      | Check the file path, allowed local roots, and `preview.maxImageMB`.                                                                                                          |
| A remote image is blocked                     | This is the default. Choose **Download Image**, or explicitly enable `preview.allowRemoteImages`.                                                                            |
| A downloaded image is missing after reopening | Download associations are session-specific. Use **Show Remote Image Cache Usage** to inspect files; clear the cache if needed, then retry the download.                      |
| Custom CSS is not applied                     | Verify the `.css` extension, setting scope, and path. Global CSS needs an absolute path; workspace CSS must remain inside its workspace. Check later styles and specificity. |
| Installed GitHub styling is not applied       | Install `bierner.markdown-preview-github-styles` and enable `preview.useMarkdownPreviewGithubStyling`.                                                                       |
| External links ask for confirmation           | Expected by default; controlled by `externalLinks.confirm`.                                                                                                                  |
| Export is cancelled before saving             | Wait for rendering to settle and retry without editing or switching documents during capture.                                                                                |
| HTML images disappear on another machine      | Enable `export.embedImages` before exporting local image contents.                                                                                                           |
| PDF export fails or stays pending             | Confirm a supported local browser is available and inspect **View → Output → Offline Markdown Preview**. PDF browser processes currently have no overall timeout.            |

Still stuck? [Open an issue](https://github.com/Bowlerr/offline-markdown-preview/issues) with the extension version, editor name and version, operating system, relevant output, and a minimal Markdown example. Remove private content and paths before sharing diagnostics.
