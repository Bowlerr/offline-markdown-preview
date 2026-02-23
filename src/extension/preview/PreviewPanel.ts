import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import * as vscode from 'vscode';

import type {
  ExtensionToWebviewMessage,
  RenderedDocumentSnapshot,
  TocItem,
  WebviewToExtensionMessage
} from '../messaging/protocol';
import { parseWebviewMessage } from '../messaging/validate';
import { renderMarkdown } from './markdown/markdownPipeline';
import {
  fileSizeBytes,
  resolveLinkTarget,
  toDataUri
} from './markdown/linkResolver';
import {
  buildWebviewCsp,
  confirmSanitizeDisabled,
  createNonce,
  getWorkspaceCustomCss,
  inlineCssTag
} from './markdown/security';

interface PreviewPanelState {
  snapshot?: RenderedDocumentSnapshot;
  toc: TocItem[];
}

interface RuntimeSettings {
  enableMermaid: boolean;
  enableMath: boolean;
  scrollSync: boolean;
  sanitizeHtml: boolean;
  showFrontmatter: boolean;
  externalConfirm: boolean;
  maxImageMB: number;
  embedImages: boolean;
  debounceMs: number;
}

function getSettings(resource?: vscode.Uri): RuntimeSettings {
  const cfg = vscode.workspace.getConfiguration('offlineMarkdownViewer', resource);
  return {
    enableMermaid: cfg.get<boolean>('enableMermaid', true),
    enableMath: cfg.get<boolean>('enableMath', true),
    scrollSync: cfg.get<boolean>('scrollSync', true),
    sanitizeHtml: cfg.get<boolean>('sanitizeHtml', true),
    showFrontmatter: cfg.get<boolean>('preview.showFrontmatter', false),
    externalConfirm: cfg.get<boolean>('externalLinks.confirm', true),
    maxImageMB: cfg.get<number>('preview.maxImageMB', 8),
    embedImages: cfg.get<boolean>('export.embedImages', false),
    debounceMs: cfg.get<number>('performance.debounceMs', 120)
  };
}

export class MarkdownOutlineProvider
  implements vscode.TreeDataProvider<TocItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TocItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private toc: readonly TocItem[] = [];

  setToc(items: readonly TocItem[]): void {
    this.toc = items;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TocItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.text, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.description = `L${element.line + 1}`;
    item.command = {
      command: 'offlineMarkdownViewer.revealHeading',
      title: 'Reveal Heading',
      arguments: [element]
    };
    item.contextValue = 'offlineMarkdownHeading';
    return item;
  }

  getChildren(): Thenable<TocItem[]> {
    return Promise.resolve([...this.toc]);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

export class PreviewController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private panel: vscode.WebviewPanel | undefined;
  private currentEditor: vscode.TextEditor | undefined;
  private state: PreviewPanelState = { toc: [] };
  private renderRequestId = 0;
  private renderTimer: NodeJS.Timeout | undefined;
  private suppressEditorScrollUntil = 0;
  private unsafeHtmlAcknowledged = false;
  private followActiveMarkdownBeside = false;
  private htmlExportSnapshotReqId = 0;
  private pendingHtmlExportSnapshot:
    | {
        requestId: number;
        resolve: (html: string | undefined) => void;
        timer: NodeJS.Timeout;
      }
    | undefined;
  private readonly outlineEmitter = new vscode.EventEmitter<readonly TocItem[]>();

  readonly onOutlineChanged = this.outlineEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!this.currentEditor || e.document.uri.toString() !== this.currentEditor.document.uri.toString()) {
          return;
        }
        this.scheduleRender();
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document.languageId === 'markdown') {
          this.currentEditor = editor;
          if (this.panel && this.followActiveMarkdownBeside && this.panel.visible) {
            // Keep preview paired beside the active markdown editor without stealing focus.
            this.panel.reveal(vscode.ViewColumn.Beside, true);
          }
          // File switches should feel instant; debounce is still used for document edits.
          this.scheduleRender(true);
        }
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (!this.panel || !this.currentEditor) return;
        if (e.textEditor.document.uri.toString() !== this.currentEditor.document.uri.toString()) return;
        const settings = getSettings(this.currentEditor.document.uri);
        if (!settings.scrollSync) return;
        if (Date.now() < this.suppressEditorScrollUntil) return;
        const lineCount = Math.max(1, this.currentEditor.document.lineCount - 1);
        const topLine = e.visibleRanges[0]?.start.line ?? 0;
        this.postMessage({
          type: 'editorScroll',
          percent: Math.min(1, Math.max(0, topLine / lineCount)),
          line: topLine,
          source: 'extension'
        });
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('offlineMarkdownViewer')) {
          this.scheduleRender(true);
        }
      })
    );

    this.currentEditor = vscode.window.activeTextEditor;
  }

  async openPreview(sideBySide = false): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
      void vscode.window.showInformationMessage('Open a Markdown file to preview.');
      return;
    }

    this.currentEditor = editor;
    this.followActiveMarkdownBeside = sideBySide;

    if (this.panel) {
      this.panel.reveal(sideBySide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, true);
      await this.renderNow();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'offlineMarkdownViewer.preview',
      `Offline Preview: ${path.basename(editor.document.uri.fsPath)}`,
      sideBySide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // Restrict file access to extension-bundled assets plus current workspace roots only.
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview-ui'),
          ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? [])
        ]
      }
    );

    this.panel.webview.html = await this.buildWebviewHtml(this.panel.webview, editor.document.uri);
    this.disposables.push(
      this.panel,
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      }),
      this.panel.webview.onDidReceiveMessage((msg: unknown) => {
        void this.handleWebviewMessage(msg);
      })
    );

    await this.renderNow();
  }

  async exportHtml(): Promise<void> {
    if (!this.currentEditor) return;
    if (!this.panel) {
      await this.openPreview(true);
    }
    if (!this.state.snapshot) {
      await this.renderNow();
    }
    const snapshot = this.state.snapshot;
    if (!snapshot) return;

    const settings = getSettings(snapshot.uri);
    let html = (await this.requestRenderedHtmlExportSnapshot()) ?? snapshot.html;
    html = this.rewriteLocalImageSourcesForExport(html);
    if (settings.embedImages) {
      const answer = await vscode.window.showWarningMessage(
        'Embedding local images can expose private paths/content in exported HTML. Continue?',
        { modal: true },
        'Export'
      );
      if (answer !== 'Export') return;
      html = await this.embedLocalImages(html, settings.maxImageMB);
    }

    const defaultUri = snapshot.uri.with({ path: snapshot.uri.path.replace(/\.md$/i, '.html') });
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { HTML: ['html'] },
      saveLabel: 'Export HTML'
    });
    if (!target) return;

    const document = await this.buildStandaloneHtml(html, snapshot.uri, settings);
    await vscode.workspace.fs.writeFile(target, Buffer.from(document, 'utf8'));
    void vscode.window.showInformationMessage(`Exported HTML to ${target.fsPath}`);
  }

  async exportPdf(): Promise<void> {
    if (!this.currentEditor) return;
    if (!this.panel) {
      await this.openPreview(true);
    }
    if (!this.state.snapshot) {
      await this.renderNow();
    }
    const snapshot = this.state.snapshot;
    if (!snapshot) return;

    const settings = getSettings(snapshot.uri);
    let html = (await this.requestRenderedHtmlExportSnapshot()) ?? snapshot.html;
    html = this.rewriteLocalImageSourcesForExport(html);

    if (settings.embedImages) {
      const answer = await vscode.window.showWarningMessage(
        'Embedding local images can expose private paths/content in exported PDF intermediates. Continue?',
        { modal: true },
        'Continue'
      );
      if (answer !== 'Continue') return;
      html = await this.embedLocalImages(html, settings.maxImageMB);
    }

    const defaultUri = snapshot.uri.with({ path: snapshot.uri.path.replace(/\.md$/i, '.pdf') });
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { PDF: ['pdf'] },
      saveLabel: 'Export PDF'
    });
    if (!target) return;

    const document = await this.buildStandaloneHtml(html, snapshot.uri, settings);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omv-pdf-'));
    const tempHtmlPath = path.join(tempDir, `${path.basename(snapshot.uri.fsPath).replace(/\.md$/i, '')}.print.html`);
    await fs.writeFile(tempHtmlPath, document, 'utf8');
    const pdfExport = await this.tryHeadlessPdfExport(vscode.Uri.file(tempHtmlPath), target);
    if (pdfExport.ok) {
      void vscode.window.showInformationMessage(`Exported PDF to ${target.fsPath}`);
      return;
    }

    await vscode.env.openExternal(vscode.Uri.file(tempHtmlPath));
    void vscode.window.showWarningMessage(
      `Direct PDF export is unavailable (${pdfExport.reason}). Opened printable HTML instead; use Print → Save as PDF.`
    );
  }

  async toggleScrollSync(): Promise<void> {
    const editor = this.currentEditor;
    const cfg = vscode.workspace.getConfiguration('offlineMarkdownViewer', editor?.document.uri);
    const current = cfg.get<boolean>('scrollSync', true);
    const hasFolder = editor ? Boolean(vscode.workspace.getWorkspaceFolder(editor.document.uri)) : false;
    await cfg.update(
      'scrollSync',
      !current,
      hasFolder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace
    );
    void vscode.window.showInformationMessage(`Offline Markdown Viewer scroll sync: ${!current ? 'On' : 'Off'}`);
  }

  async copyHeadingLink(item?: TocItem): Promise<void> {
    const editor = this.currentEditor;
    if (!editor) return;
    const toc = this.state.toc;
    let heading = item;
    if (!heading) {
      const activeLine = editor.selection.active.line;
      heading = [...toc].reverse().find((t) => t.line <= activeLine);
    }
    if (!heading) {
      void vscode.window.showInformationMessage('No heading found to copy.');
      return;
    }
    const relative = vscode.workspace.asRelativePath(editor.document.uri, false);
    const link = `${relative}#${heading.id}`;
    await vscode.env.clipboard.writeText(link);
    void vscode.window.showInformationMessage(`Copied heading link: ${link}`);
  }

  async revealHeadingItem(item: TocItem): Promise<void> {
    await this.revealHeading(item.id);
  }

  async quickPickHeading(): Promise<void> {
    const editor = this.currentEditor;
    if (!editor) return;
    const items = this.state.toc.map((t) => ({
      label: `${'  '.repeat(Math.max(0, t.level - 1))}${t.text}`,
      description: `Line ${t.line + 1}`,
      heading: t
    }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Jump to heading' });
    if (!picked) return;
    const pos = new vscode.Position(picked.heading.line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  getOutlineProvider(): MarkdownOutlineProvider {
    const provider = new MarkdownOutlineProvider();
    this.disposables.push(this.onOutlineChanged((toc) => provider.setToc(toc)), provider);
    return provider;
  }

  private scheduleRender(force = false): void {
    if (!this.panel) return;
    const editor = this.currentEditor;
    if (!editor || editor.document.languageId !== 'markdown') return;
    const delay = force ? 0 : getSettings(editor.document.uri).debounceMs;
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      void this.renderNow();
    }, delay);
  }

  private async renderNow(): Promise<void> {
    const panel = this.panel;
    const editor = this.currentEditor;
    if (!panel || !editor || editor.document.languageId !== 'markdown') return;

    const settings = getSettings(editor.document.uri);
    if (!settings.sanitizeHtml) {
      if (!this.unsafeHtmlAcknowledged) {
        if (!(await confirmSanitizeDisabled(editor.document.uri))) {
          return;
        }
        this.unsafeHtmlAcknowledged = true;
      }
    } else {
      this.unsafeHtmlAcknowledged = false;
    }
    const result = renderMarkdown(editor.document.getText(), {
      sourceUri: editor.document.uri,
      webview: panel.webview,
      allowHtml: true,
      maxImageMB: settings.maxImageMB
    });

    this.state = {
      toc: result.toc,
      snapshot: {
        uri: editor.document.uri,
        version: editor.document.version,
        html: result.html,
        toc: result.toc,
        frontmatter: result.frontmatter,
        lineCount: result.lineCount
      }
    };

    this.outlineEmitter.fire(result.toc);
    this.panel.title = `Offline Preview: ${path.basename(editor.document.uri.fsPath)}`;

    this.postMessage({
      type: 'render',
      requestId: ++this.renderRequestId,
      documentUri: editor.document.uri.toString(),
      version: editor.document.version,
      html: result.html,
      toc: result.toc,
      frontmatter: result.frontmatter,
      editorLineCount: editor.document.lineCount,
      settings: {
        enableMermaid: settings.enableMermaid,
        enableMath: settings.enableMath,
        scrollSync: settings.scrollSync,
        sanitizeHtml: settings.sanitizeHtml,
        showFrontmatter: settings.showFrontmatter
      }
    });
  }

  private async handleWebviewMessage(raw: unknown): Promise<void> {
    let message: WebviewToExtensionMessage;
    try {
      message = parseWebviewMessage(raw);
    } catch {
      return;
    }

    switch (message.type) {
      case 'ready': {
        await this.renderNow();
        break;
      }
      case 'previewScroll': {
        if (!this.currentEditor || !getSettings(this.currentEditor.document.uri).scrollSync) return;
        const maxLine = Math.max(0, this.currentEditor.document.lineCount - 1);
        const line = Math.min(
          maxLine,
          Math.max(
            0,
            Number.isInteger(message.line)
              ? message.line
              : Math.round(message.percent * maxLine)
          )
        );
        const pos = new vscode.Position(line, 0);
        this.suppressEditorScrollUntil = Date.now() + 250;
        this.currentEditor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
        break;
      }
      case 'openLink': {
        await this.handleOpenLink(message.href);
        break;
      }
      case 'headingSelected': {
        // Preview-initiated heading navigation already scrolls the webview precisely to the heading.
        // Suppress the next editor->preview percent sync update so it doesn't fight that scroll and
        // force users to click the ToC item twice.
        this.suppressEditorScrollUntil = Date.now() + 500;
        await this.revealHeading(message.headingId);
        break;
      }
      case 'copyHeadingLink': {
        const item = this.state.toc.find((t) => t.id === message.headingId);
        await this.copyHeadingLink(item);
        break;
      }
      case 'search': {
        // Search runs in webview UI; command exists for future extension-driven search actions.
        break;
      }
      case 'pdfExportResult': {
        if (!message.ok && message.error) {
          void vscode.window.showWarningMessage(`Preview print failed: ${message.error}`);
        }
        break;
      }
      case 'openImage': {
        await this.openLocalImage(message.src);
        break;
      }
      case 'requestExport': {
        const picked = await vscode.window.showQuickPick(
          [
            { label: 'HTML', description: 'Self-contained HTML export', value: 'html' as const },
            { label: 'PDF', description: 'Open print dialog / Save as PDF', value: 'pdf' as const }
          ],
          { placeHolder: 'Export preview as…' }
        );
        if (!picked) break;
        if (picked.value === 'html') {
          await this.exportHtml();
        } else {
          await this.exportPdf();
        }
        break;
      }
      case 'htmlExportSnapshot': {
        if (this.pendingHtmlExportSnapshot && this.pendingHtmlExportSnapshot.requestId === message.requestId) {
          clearTimeout(this.pendingHtmlExportSnapshot.timer);
          this.pendingHtmlExportSnapshot.resolve(message.html);
          this.pendingHtmlExportSnapshot = undefined;
        }
        break;
      }
      default:
        break;
    }
  }

  private async buildWebviewHtml(webview: vscode.Webview, documentUri: vscode.Uri): Promise<string> {
    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview-ui', 'index.js'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview-ui', 'index.css'));
    // Strict CSP: no remote connections, nonce-only scripts, local-resource-only images/styles/fonts.
    const csp = buildWebviewCsp(webview.cspSource, nonce);
    const customCss = await getWorkspaceCustomCss(documentUri);

    const customCssTag = customCss ? inlineCssTag(customCss, nonce) : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Offline Markdown Preview</title>
  <link nonce="${nonce}" rel="stylesheet" href="${cssUri}" />
  ${customCssTag}
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    window.__OMV_BOOT__ = { platform: ${JSON.stringify(process.platform)}, styleNonce: ${JSON.stringify(nonce)} };
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    if (!this.panel) return;
    void this.panel.webview.postMessage(message);
  }

  private async requestRenderedHtmlExportSnapshot(): Promise<string | undefined> {
    if (!this.panel) return undefined;

    if (this.pendingHtmlExportSnapshot) {
      clearTimeout(this.pendingHtmlExportSnapshot.timer);
      this.pendingHtmlExportSnapshot.resolve(undefined);
      this.pendingHtmlExportSnapshot = undefined;
    }

    const requestId = ++this.htmlExportSnapshotReqId;
    return new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingHtmlExportSnapshot?.requestId === requestId) {
          this.pendingHtmlExportSnapshot.resolve(undefined);
          this.pendingHtmlExportSnapshot = undefined;
        }
      }, 2000);

      this.pendingHtmlExportSnapshot = { requestId, resolve, timer };
      this.postMessage({ type: 'requestHtmlExportSnapshot', requestId });
    });
  }

  private async handleOpenLink(href: string): Promise<void> {
    const editor = this.currentEditor;
    if (!editor) return;
    const targetEditorColumn = editor.viewColumn ?? vscode.ViewColumn.Active;
    const resolved = resolveLinkTarget(editor.document.uri, href);
    if (resolved.kind === 'heading') {
      await this.revealHeading(resolved.fragment ?? '');
      return;
    }
    if (resolved.kind === 'external') {
      const settings = getSettings(editor.document.uri);
      if (settings.externalConfirm) {
        const answer = await vscode.window.showWarningMessage(
          `Open external link? ${href}`,
          { modal: true },
          'Open'
        );
        if (answer !== 'Open') return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(href, true));
      return;
    }
    if (resolved.kind === 'workspace' && resolved.uri) {
      try {
        const doc = await vscode.workspace.openTextDocument(resolved.uri);
        const editor2 = await vscode.window.showTextDocument(doc, {
          viewColumn: targetEditorColumn,
          preview: false
        });
        this.currentEditor = editor2;
        if (resolved.fragment) {
          await this.revealHeading(resolved.fragment);
        }
      } catch {
        void vscode.window.showWarningMessage(`Could not open link target: ${href}`);
      }
      return;
    }
    if (resolved.kind === 'outside-workspace' && resolved.uri) {
      const answer = await vscode.window.showWarningMessage(
        'This link points outside the workspace. Open anyway?',
        { modal: true },
        'Open'
      );
      if (answer === 'Open') {
        try {
          const doc = await vscode.workspace.openTextDocument(resolved.uri);
          const editor2 = await vscode.window.showTextDocument(doc, {
            viewColumn: targetEditorColumn,
            preview: false
          });
          this.currentEditor = editor2;
        } catch {
          void vscode.window.showWarningMessage('Could not open the selected file.');
        }
      }
      return;
    }
  }

  private async revealHeading(headingId: string): Promise<void> {
    const editor = this.currentEditor;
    if (!editor) return;
    const heading = this.state.toc.find((t) => t.id === headingId);
    if (!heading) return;
    const pos = new vscode.Position(heading.line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  private async openLocalImage(src: string): Promise<void> {
    const uri = vscode.Uri.parse(src, true);
    const folder = this.currentEditor ? vscode.workspace.getWorkspaceFolder(this.currentEditor.document.uri) : undefined;
    if (folder) {
      const rel = path.relative(folder.uri.fsPath, uri.fsPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        const answer = await vscode.window.showWarningMessage(
          'This image is outside the workspace. Open anyway?',
          { modal: true },
          'Open'
        );
        if (answer !== 'Open') return;
      }
    }
    await vscode.commands.executeCommand('vscode.open', uri);
  }

  private async embedLocalImages(html: string, maxImageMB: number): Promise<string> {
    const matches = [...html.matchAll(/<img[^>]*data-local-src="([^"]+)"[^>]*src="([^"]*)"[^>]*>/g)];
    let next = html;
    for (const match of matches) {
      const localUri = vscode.Uri.parse(match[1], true);
      const bytes = await fileSizeBytes(localUri).catch(() => 0);
      if (bytes <= 0 || bytes > maxImageMB * 1024 * 1024) continue;
      const dataUri = await toDataUri(localUri).catch(() => undefined);
      if (!dataUri) continue;
      next = next.replace(match[2], dataUri);
    }
    return next;
  }

  private rewriteLocalImageSourcesForExport(html: string): string {
    return html.replace(
      /(<img[^>]*data-local-src="([^"]+)"[^>]*src=")([^"]*)(")/g,
      (_match, prefix: string, localSrc: string, _currentSrc: string, suffix: string) =>
        `${prefix}${localSrc}${suffix}`
    );
  }

  private async tryHeadlessPdfExport(
    sourceHtmlUri: vscode.Uri,
    targetPdfUri: vscode.Uri
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const candidates = getHeadlessBrowserCandidates();
    const htmlUrl = sourceHtmlUri.toString(true);

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
      } catch {
        // Not all candidates are absolute paths. PATH-based commands are handled below.
      }

      const result = await runProcess(candidate, [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--allow-file-access-from-files',
        '--print-to-pdf-no-header',
        `--print-to-pdf=${targetPdfUri.fsPath}`,
        htmlUrl
      ]);

      if (result.ok) return { ok: true };

      // Older Chromium builds may not support --headless=new.
      if (result.code !== 'ENOENT') {
        const legacy = await runProcess(candidate, [
          '--headless',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--allow-file-access-from-files',
          '--print-to-pdf-no-header',
          `--print-to-pdf=${targetPdfUri.fsPath}`,
          htmlUrl
        ]);
        if (legacy.ok) return { ok: true };
      }
    }

    return {
      ok: false,
      reason: 'no supported local Chrome/Edge/Chromium executable was found'
    };
  }

  private async buildStandaloneHtml(bodyHtml: string, sourceUri: vscode.Uri, settings: RuntimeSettings): Promise<string> {
    const cssPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview-ui', 'index.css').fsPath;
    let baseCss = '';
    try {
      baseCss = await fs.readFile(cssPath, 'utf8');
    } catch {
      baseCss = 'body{font-family:sans-serif;padding:1rem;max-width:900px;margin:0 auto;}';
    }

    const frontmatter =
      settings.showFrontmatter && this.state.snapshot?.frontmatter
        ? `<details open><summary>Frontmatter</summary><pre>${escapeHtml(this.state.snapshot.frontmatter.raw)}</pre></details>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(path.basename(sourceUri.fsPath))}</title>
<style>${baseCss}</style>
</head>
<body>
${frontmatter}
${bodyHtml}
</body>
</html>`;
  }

  dispose(): void {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    if (this.pendingHtmlExportSnapshot) {
      clearTimeout(this.pendingHtmlExportSnapshot.timer);
      this.pendingHtmlExportSnapshot.resolve(undefined);
      this.pendingHtmlExportSnapshot = undefined;
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.outlineEmitter.dispose();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getHeadlessBrowserCandidates(): string[] {
  const candidates = new Set<string>();

  // PATH-based commands (Linux/macOS/Homebrew/Windows PATH installs).
  for (const cmd of [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
    'microsoft-edge-stable',
    'msedge',
    'chrome',
    'chrome.exe',
    'msedge.exe'
  ]) {
    candidates.add(cmd);
  }

  if (process.platform === 'darwin') {
    for (const p of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ]) {
      candidates.add(p);
    }
  } else if (process.platform === 'win32') {
    const roots = [
      process.env['PROGRAMFILES'],
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA
    ].filter(Boolean) as string[];

    for (const root of roots) {
      for (const suffix of [
        'Google/Chrome/Application/chrome.exe',
        'Google/Chrome Beta/Application/chrome.exe',
        'Google/Chrome SxS/Application/chrome.exe',
        'Microsoft/Edge/Application/msedge.exe'
      ]) {
        candidates.add(path.join(root, suffix));
      }
    }
  } else {
    for (const p of [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/snap/bin/chromium'
    ]) {
      candidates.add(p);
    }
  }

  return [...candidates];
}

async function runProcess(
  command: string,
  args: string[]
): Promise<{ ok: true } | { ok: false; code: number | string; stderr?: string }> {
  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe']
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, code: error.code ?? 'ERROR', stderr: error.message });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, code: code ?? 'UNKNOWN', stderr });
      }
    });
  });
}
