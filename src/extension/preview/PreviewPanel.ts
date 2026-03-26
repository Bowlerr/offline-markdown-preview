import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  getConfiguredCustomCssUris,
  getGithubMarkdownStyleSettings,
  getWorkspaceCustomCssBaseUri,
  inlineCssTag,
  resolveCustomCss
} from './markdown/security';

interface PreviewPanelState {
  snapshot?: RenderedDocumentSnapshot;
  toc: TocItem[];
}

interface PreviewUiState {
  searchUiVisible: boolean;
  tocVisible: boolean;
}

interface HtmlExportSnapshotData {
  html: string;
  themeVariables?: Record<string, string>;
}

interface RuntimeSettings {
  enableMermaid: boolean;
  enableMath: boolean;
  scrollSync: boolean;
  sanitizeHtml: boolean;
  autoOpenPreview: boolean;
  allowRemoteImages: boolean;
  showFrontmatter: boolean;
  externalConfirm: boolean;
  maxImageMB: number;
  embedImages: boolean;
  debounceMs: number;
  useMarkdownPreviewGithubStyling: boolean;
}

interface CustomCssCommandChoice {
  label: string;
  description: string;
  settingKey:
    | 'preview.globalCustomCssPath'
    | 'preview.customCssPath'
    | 'preview.useMarkdownPreviewGithubStyling';
  target: vscode.ConfigurationTarget;
  workspaceFolder?: vscode.WorkspaceFolder;
  clear?: boolean;
  value?: boolean;
}

function getSettings(resource?: vscode.Uri): RuntimeSettings {
  const cfg = vscode.workspace.getConfiguration(
    'offlineMarkdownViewer',
    resource
  );
  return {
    enableMermaid: cfg.get<boolean>('enableMermaid', true),
    enableMath: cfg.get<boolean>('enableMath', true),
    scrollSync: cfg.get<boolean>('scrollSync', true),
    sanitizeHtml: cfg.get<boolean>('sanitizeHtml', true),
    autoOpenPreview: cfg.get<boolean>('preview.autoOpen', true),
    allowRemoteImages: cfg.get<boolean>('preview.allowRemoteImages', false),
    showFrontmatter: cfg.get<boolean>('preview.showFrontmatter', false),
    externalConfirm: cfg.get<boolean>('externalLinks.confirm', true),
    maxImageMB: cfg.get<number>('preview.maxImageMB', 8),
    embedImages: cfg.get<boolean>('export.embedImages', false),
    debounceMs: cfg.get<number>('performance.debounceMs', 120),
    useMarkdownPreviewGithubStyling: cfg.get<boolean>(
      'preview.useMarkdownPreviewGithubStyling',
      false
    )
  };
}

function getCssFilePickerOptions(
  defaultUri?: vscode.Uri
): vscode.OpenDialogOptions {
  return {
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Select CSS File',
    filters: {
      'CSS Files': ['css']
    },
    defaultUri
  };
}

function isUriWithinFolder(
  uri: vscode.Uri,
  folder: vscode.WorkspaceFolder
): boolean {
  const relative = path.relative(folder.uri.fsPath, uri.fsPath);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function getExportThemeBodyClass(): string {
  switch (vscode.window.activeColorTheme.kind) {
    case vscode.ColorThemeKind.Light:
      return 'vscode-body vscode-light';
    case vscode.ColorThemeKind.HighContrastLight:
      return 'vscode-body vscode-light vscode-high-contrast';
    case vscode.ColorThemeKind.HighContrast:
      return 'vscode-body vscode-dark vscode-high-contrast';
    case vscode.ColorThemeKind.Dark:
    default:
      return 'vscode-body vscode-dark';
  }
}

function buildGitHubMarkdownStyleAttributes(enabled: boolean): string {
  const githubStyle = getGithubMarkdownStyleSettings(enabled);
  return ` data-color-mode="${githubStyle.colorMode}" data-light-theme="${githubStyle.lightTheme}" data-dark-theme="${githubStyle.darkTheme}"`;
}

const PREVIEW_UI_STATE_KEY = 'preview.uiState';
const DEFAULT_PREVIEW_UI_STATE: PreviewUiState = {
  searchUiVisible: true,
  tocVisible: true
};

export class MarkdownOutlineProvider
  implements vscode.TreeDataProvider<TocItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TocItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private toc: readonly TocItem[] = [];

  setToc(items: readonly TocItem[]): void {
    this.toc = items;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TocItem): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.text,
      vscode.TreeItemCollapsibleState.None
    );
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
  private previewUiState: PreviewUiState;
  private renderRequestId = 0;
  private renderTimer: NodeJS.Timeout | undefined;
  private suppressEditorScrollUntil = 0;
  private unsafeHtmlAcknowledged = false;
  private followActiveMarkdownBeside = false;
  private autoOpenInFlight = false;
  private relocatingEditor = false;
  private preferredMarkdownColumn: vscode.ViewColumn | undefined;
  private lastPreviewColumn: vscode.ViewColumn | undefined;
  private webviewAllowsRemoteImages: boolean | undefined;
  private webviewCustomCssDirty = true;
  private webviewCustomCssKey: string | undefined;
  private webviewCustomCssTexts: string[] | undefined;
  private readonly remoteImageOverrides = new Map<string, vscode.Uri>();
  private htmlExportSnapshotReqId = 0;
  private pendingHtmlExportSnapshot:
    | {
        requestId: number;
        resolve: (snapshot: HtmlExportSnapshotData | undefined) => void;
        timer: NodeJS.Timeout;
      }
    | undefined;
  private readonly outlineEmitter = new vscode.EventEmitter<
    readonly TocItem[]
  >();

  readonly onOutlineChanged = this.outlineEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.previewUiState = this.readPreviewUiState();
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!this.currentEditor) {
          return;
        }

        if (
          e.document.uri.toString() ===
          this.currentEditor.document.uri.toString()
        ) {
          this.scheduleRender();
          return;
        }

        if (this.isCurrentCustomCssUri(e.document.uri)) {
          this.webviewCustomCssDirty = true;
          void this.refreshCustomCssOnly();
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.isCurrentCustomCssUri(document.uri)) {
          this.webviewCustomCssDirty = true;
          void this.refreshCustomCssOnly();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document.languageId === 'markdown') {
          if (this.relocatingEditor) {
            this.currentEditor = editor;
            return;
          }

          const previewColumn =
            this.panel?.viewColumn ?? this.lastPreviewColumn;
          const editorColumn = editor.viewColumn;
          if (
            previewColumn &&
            editorColumn &&
            editorColumn === previewColumn &&
            this.preferredMarkdownColumn &&
            this.preferredMarkdownColumn !== previewColumn
          ) {
            void this.relocateMarkdownOutOfPreviewColumn(editor, previewColumn);
            return;
          }

          this.currentEditor = editor;
          this.webviewCustomCssDirty = true;
          if (editorColumn && editorColumn !== previewColumn) {
            this.preferredMarkdownColumn = editorColumn;
          }
          void this.tryAutoOpenPreview(editor);
          if (
            this.panel &&
            this.followActiveMarkdownBeside &&
            this.panel.visible
          ) {
            // Keep preview open without relocating it to a new group on every file switch.
            this.panel.reveal(
              this.panel.viewColumn ??
                this.lastPreviewColumn ??
                vscode.ViewColumn.Beside,
              true
            );
          }
          // File switches should feel instant; debounce is still used for document edits.
          this.scheduleRender(true);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (this.isCurrentCustomCssUri(document.uri)) {
          this.webviewCustomCssDirty = true;
          void this.refreshCustomCssOnly();
        }

        if (document.languageId !== 'markdown') return;
        if (!this.panel) return;
        const previewUri = this.state.snapshot?.uri.toString();
        if (previewUri && previewUri === document.uri.toString()) {
          const panel = this.panel;
          this.lastPreviewColumn = panel.viewColumn ?? this.lastPreviewColumn;
          this.panel = undefined;
          panel.dispose();
          this.currentEditor = undefined;
          this.state = { toc: [] };
          this.outlineEmitter.fire([]);
        }
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (!this.panel || !this.currentEditor) return;
        if (
          e.textEditor.document.uri.toString() !==
          this.currentEditor.document.uri.toString()
        )
          return;
        const settings = getSettings(this.currentEditor.document.uri);
        if (!settings.scrollSync) return;
        if (Date.now() < this.suppressEditorScrollUntil) return;
        const lineCount = Math.max(
          1,
          this.currentEditor.document.lineCount - 1
        );
        const topLine = e.visibleRanges[0]?.start.line ?? 0;
        this.postMessage({
          type: 'editorScroll',
          percent: Math.min(1, Math.max(0, topLine / lineCount)),
          line: topLine,
          source: 'extension'
        });
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('offlineMarkdownViewer') ||
          e.affectsConfiguration('markdown-preview-github-styles')
        ) {
          if (
            this.currentEditor &&
            e.affectsConfiguration('offlineMarkdownViewer') &&
            (e.affectsConfiguration(
              'offlineMarkdownViewer.preview.globalCustomCssPath'
            ) ||
              e.affectsConfiguration(
                'offlineMarkdownViewer.preview.useMarkdownPreviewGithubStyling'
              ) ||
              e.affectsConfiguration(
                'offlineMarkdownViewer.preview.customCssPath',
                this.currentEditor.document.uri
              ))
          ) {
            this.webviewCustomCssDirty = true;
          }
          if (
            this.currentEditor &&
            this.currentEditor.document.languageId === 'markdown' &&
            e.affectsConfiguration('offlineMarkdownViewer.preview.autoOpen')
          ) {
            void this.tryAutoOpenPreview(this.currentEditor);
          }
          this.scheduleRender(true);
        }
      })
    );

    this.currentEditor = vscode.window.activeTextEditor;
    if (this.currentEditor?.document.languageId === 'markdown') {
      this.preferredMarkdownColumn = this.currentEditor.viewColumn;
      void this.tryAutoOpenPreview(this.currentEditor);
    }
  }

  async openPreview(
    sideBySide = false,
    preserveFocus = false,
    targetColumn?: vscode.ViewColumn,
    sourceEditor?: vscode.TextEditor
  ): Promise<void> {
    const editor =
      sourceEditor && sourceEditor.document.languageId === 'markdown'
        ? sourceEditor
        : vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'markdown') {
      void vscode.window.showInformationMessage(
        'Open a Markdown file to preview.'
      );
      return;
    }

    this.currentEditor = editor;
    this.followActiveMarkdownBeside = sideBySide;
    this.webviewCustomCssDirty = true;

    if (this.panel) {
      try {
        const revealColumn =
          this.panel.viewColumn ?? targetColumn ?? this.lastPreviewColumn;
        this.panel.reveal(revealColumn, preserveFocus);
        this.lastPreviewColumn = this.panel.viewColumn ?? revealColumn;
        await this.renderNow();
        return;
      } catch (error) {
        if (!isDisposedWebviewError(error)) {
          throw error;
        }
        this.panel = undefined;
      }
    }

    const initialColumn =
      targetColumn ??
      (sideBySide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active);
    this.panel = vscode.window.createWebviewPanel(
      'offlineMarkdownViewer.preview',
      `Offline Preview: ${path.basename(editor.document.uri.fsPath)}`,
      initialColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // Restrict file access to extension-bundled assets plus current workspace roots only.
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview-ui'),
          this.context.globalStorageUri,
          ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? [])
        ]
      }
    );

    const settings = getSettings(editor.document.uri);
    const customCss = await resolveCustomCss(editor.document.uri);
    this.panel.webview.html = await this.buildWebviewHtml(
      this.panel.webview,
      settings,
      customCss.cssTexts
    );
    this.webviewAllowsRemoteImages = settings.allowRemoteImages;
    this.webviewCustomCssDirty = false;
    this.webviewCustomCssKey = customCss.key;
    this.webviewCustomCssTexts = customCss.cssTexts;
    this.disposables.push(
      this.panel,
      this.panel.onDidDispose(() => {
        this.lastPreviewColumn =
          this.panel?.viewColumn ?? this.lastPreviewColumn;
        this.panel = undefined;
        this.webviewAllowsRemoteImages = undefined;
        this.webviewCustomCssDirty = true;
        this.webviewCustomCssKey = undefined;
        this.webviewCustomCssTexts = undefined;
        this.remoteImageOverrides.clear();
      }),
      this.panel.onDidChangeViewState((event) => {
        this.lastPreviewColumn =
          event.webviewPanel.viewColumn ?? this.lastPreviewColumn;
      }),
      this.panel.webview.onDidReceiveMessage((msg: unknown) => {
        void this.handleWebviewMessage(msg);
      })
    );

    this.lastPreviewColumn = this.panel.viewColumn ?? initialColumn;
    await this.renderNow();
    if (preserveFocus) {
      await vscode.window.showTextDocument(
        editor.document,
        editor.viewColumn,
        false
      );
    }
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
    const renderedSnapshot = await this.requestRenderedHtmlExportSnapshot();
    let html = renderedSnapshot?.html ?? snapshot.html;
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

    const defaultUri = snapshot.uri.with({
      path: snapshot.uri.path.replace(/\.md$/i, '.html')
    });
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { HTML: ['html'] },
      saveLabel: 'Export HTML'
    });
    if (!target) return;

    const document = await this.buildStandaloneHtml(
      html,
      snapshot.uri,
      settings,
      renderedSnapshot?.themeVariables
    );
    await vscode.workspace.fs.writeFile(target, Buffer.from(document, 'utf8'));
    void vscode.window.showInformationMessage(
      `Exported HTML to ${target.fsPath}`
    );
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
    const renderedSnapshot = await this.requestRenderedHtmlExportSnapshot();
    let html = renderedSnapshot?.html ?? snapshot.html;
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

    const defaultUri = snapshot.uri.with({
      path: snapshot.uri.path.replace(/\.md$/i, '.pdf')
    });
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { PDF: ['pdf'] },
      saveLabel: 'Export PDF'
    });
    if (!target) return;

    const document = await this.buildStandaloneHtml(
      html,
      snapshot.uri,
      settings,
      renderedSnapshot?.themeVariables
    );
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omv-pdf-'));
    const tempHtmlPath = path.join(
      tempDir,
      `${path.basename(snapshot.uri.fsPath).replace(/\.md$/i, '')}.print.html`
    );
    await fs.writeFile(tempHtmlPath, document, 'utf8');
    const pdfExport = await this.tryHeadlessPdfExport(
      vscode.Uri.file(tempHtmlPath),
      target
    );
    if (pdfExport.ok) {
      void vscode.window.showInformationMessage(
        `Exported PDF to ${target.fsPath}`
      );
      return;
    }

    await vscode.env.openExternal(vscode.Uri.file(tempHtmlPath));
    void vscode.window.showWarningMessage(
      `Direct PDF export is unavailable (${pdfExport.reason}). Opened printable HTML instead; use Print → Save as PDF.`
    );
  }

  async toggleScrollSync(): Promise<void> {
    const editor = this.currentEditor;
    const cfg = vscode.workspace.getConfiguration(
      'offlineMarkdownViewer',
      editor?.document.uri
    );
    const current = cfg.get<boolean>('scrollSync', true);
    const hasFolder = editor
      ? Boolean(vscode.workspace.getWorkspaceFolder(editor.document.uri))
      : false;
    await cfg.update(
      'scrollSync',
      !current,
      hasFolder
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : vscode.ConfigurationTarget.Workspace
    );
    void vscode.window.showInformationMessage(
      `Offline Markdown Viewer scroll sync: ${!current ? 'On' : 'Off'}`
    );
  }

  async configureCustomCss(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    const resource =
      activeEditor?.document.uri ??
      (this.currentEditor?.document.languageId === 'markdown'
        ? this.currentEditor.document.uri
        : undefined);
    const workspaceFolder = resource
      ? vscode.workspace.getWorkspaceFolder(resource)
      : undefined;
    const workspaceFolderCount = vscode.workspace.workspaceFolders?.length ?? 0;
    const workspaceCustomCssBaseUri = getWorkspaceCustomCssBaseUri();
    const cfg = vscode.workspace.getConfiguration(
      'offlineMarkdownViewer',
      resource
    );

    const choices: CustomCssCommandChoice[] = [
      {
        label: 'Use Installed GitHub Markdown Styling',
        description:
          'Load CSS from bierner.markdown-preview-github-styles when it is installed',
        settingKey: 'preview.useMarkdownPreviewGithubStyling',
        target: vscode.ConfigurationTarget.Global,
        value: true
      },
      {
        label: 'Disable Installed GitHub Markdown Styling',
        description:
          'Use only OMV base CSS and any configured custom stylesheets',
        settingKey: 'preview.useMarkdownPreviewGithubStyling',
        target: vscode.ConfigurationTarget.Global,
        value: false
      },
      {
        label: 'Set Global Custom CSS',
        description: 'Choose a user-level .css file applied to every preview',
        settingKey: 'preview.globalCustomCssPath',
        target: vscode.ConfigurationTarget.Global
      },
      {
        label: 'Clear Global Custom CSS',
        description: 'Remove the user-level stylesheet',
        settingKey: 'preview.globalCustomCssPath',
        target: vscode.ConfigurationTarget.Global,
        clear: true
      }
    ];

    if (workspaceFolderCount > 0 && workspaceCustomCssBaseUri) {
      choices.push(
        {
          label: 'Set Workspace Custom CSS',
          description:
            'Choose a workspace-level .css path applied across the workspace',
          settingKey: 'preview.customCssPath',
          target: vscode.ConfigurationTarget.Workspace
        },
        {
          label: 'Clear Workspace Custom CSS',
          description: 'Remove the workspace-level stylesheet path',
          settingKey: 'preview.customCssPath',
          target: vscode.ConfigurationTarget.Workspace,
          clear: true
        }
      );
    }

    if (workspaceFolder) {
      choices.push({
        label: 'Set Folder Custom CSS',
        description: `Choose a folder-level .css file for ${workspaceFolder.name}`,
        settingKey: 'preview.customCssPath',
        target: vscode.ConfigurationTarget.WorkspaceFolder,
        workspaceFolder
      });
      choices.push({
        label: 'Clear Folder Custom CSS',
        description: `Remove the folder-level stylesheet for ${workspaceFolder.name}`,
        settingKey: 'preview.customCssPath',
        target: vscode.ConfigurationTarget.WorkspaceFolder,
        workspaceFolder,
        clear: true
      });
    }

    const picked = await vscode.window.showQuickPick(choices, {
      placeHolder: 'Choose which preview style setting to configure'
    });
    if (!picked) return;

    if (
      picked.target === vscode.ConfigurationTarget.WorkspaceFolder &&
      !workspaceFolder
    ) {
      void vscode.window.showInformationMessage(
        'Open a Markdown file inside a workspace folder to configure folder custom CSS.'
      );
      return;
    }

    if (
      picked.settingKey === 'preview.useMarkdownPreviewGithubStyling' &&
      typeof picked.value === 'boolean'
    ) {
      await cfg.update(picked.settingKey, picked.value, picked.target);
      void vscode.window.showInformationMessage(
        picked.value
          ? 'Installed GitHub Markdown styling enabled.'
          : 'Installed GitHub Markdown styling disabled.'
      );
      return;
    }

    if (picked.clear) {
      await cfg.update(picked.settingKey, undefined, picked.target);
      void vscode.window.showInformationMessage(
        picked.settingKey === 'preview.globalCustomCssPath'
          ? 'Cleared global custom CSS.'
          : picked.target === vscode.ConfigurationTarget.Workspace
            ? 'Cleared workspace custom CSS.'
            : 'Cleared folder custom CSS.'
      );
      return;
    }

    const defaultWorkspaceUri =
      picked.target === vscode.ConfigurationTarget.Workspace
        ? workspaceCustomCssBaseUri
        : (picked.workspaceFolder?.uri ?? workspaceFolder?.uri ?? resource);
    const defaultUri =
      picked.settingKey === 'preview.globalCustomCssPath'
        ? resource
        : defaultWorkspaceUri;
    const selection = await vscode.window.showOpenDialog(
      getCssFilePickerOptions(defaultUri)
    );
    const cssUri = selection?.[0];
    if (!cssUri) return;

    if (path.extname(cssUri.fsPath).toLowerCase() !== '.css') {
      void vscode.window.showWarningMessage(
        'Select a .css file to configure custom preview styles.'
      );
      return;
    }

    if (picked.settingKey === 'preview.globalCustomCssPath') {
      await cfg.update(
        picked.settingKey,
        cssUri.fsPath,
        vscode.ConfigurationTarget.Global
      );
      void vscode.window.showInformationMessage(
        `Global custom CSS set to ${path.basename(cssUri.fsPath)}`
      );
      return;
    }

    if (picked.target === vscode.ConfigurationTarget.Workspace) {
      if (!workspaceCustomCssBaseUri) {
        void vscode.window.showInformationMessage(
          'Open a saved workspace or a single-folder workspace to configure workspace custom CSS.'
        );
        return;
      }

      if (!vscode.workspace.getWorkspaceFolder(cssUri)) {
        void vscode.window.showInformationMessage(
          'Select a .css file inside the current workspace to configure workspace custom CSS.'
        );
        return;
      }

      const relative = path.relative(
        workspaceCustomCssBaseUri.fsPath,
        cssUri.fsPath
      );
      if (path.isAbsolute(relative) || !relative.trim()) {
        void vscode.window.showWarningMessage(
          'Workspace custom CSS must point to a .css file inside the current workspace.'
        );
        return;
      }

      await cfg.update(
        picked.settingKey,
        relative.split(path.sep).join('/'),
        picked.target
      );
      void vscode.window.showInformationMessage(
        `Workspace custom CSS set to ${relative}`
      );
      return;
    }

    const folder = picked.workspaceFolder;
    if (!folder) {
      void vscode.window.showInformationMessage(
        'Open a Markdown file inside a workspace folder to configure folder custom CSS.'
      );
      return;
    }

    if (!isUriWithinFolder(cssUri, folder)) {
      void vscode.window.showWarningMessage(
        'Folder custom CSS must point to a .css file inside the current workspace folder.'
      );
      return;
    }

    const relative = path.relative(folder.uri.fsPath, cssUri.fsPath);
    await cfg.update(
      picked.settingKey,
      relative.split(path.sep).join('/'),
      picked.target
    );
    void vscode.window.showInformationMessage(
      `${
        picked.target === vscode.ConfigurationTarget.Workspace
          ? 'Workspace'
          : 'Folder'
      } custom CSS set to ${relative}`
    );
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
    const relative = vscode.workspace.asRelativePath(
      editor.document.uri,
      false
    );
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
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Jump to heading'
    });
    if (!picked) return;
    const pos = new vscode.Position(picked.heading.line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    await vscode.window.showTextDocument(
      editor.document,
      editor.viewColumn,
      false
    );
    editor.revealRange(
      new vscode.Range(pos, pos),
      vscode.TextEditorRevealType.InCenter
    );
  }

  async showRemoteImageCacheUsage(): Promise<void> {
    const usage = await this.collectRemoteImageCacheUsage();
    if (usage.totalFiles === 0) {
      void vscode.window.showInformationMessage('Remote image cache is empty.');
      return;
    }

    const locationSummary = usage.locations
      .filter((location) => location.exists && location.files > 0)
      .map(
        (location) =>
          `${formatBytes(location.bytes)} in ${location.files} file(s) at ${location.label}`
      )
      .join(' | ');

    void vscode.window.showInformationMessage(
      `Remote image cache: ${formatBytes(usage.totalBytes)} across ${usage.totalFiles} file(s). ${locationSummary}`
    );
  }

  async clearRemoteImageCache(): Promise<void> {
    const usage = await this.collectRemoteImageCacheUsage();
    if (usage.totalFiles === 0) {
      void vscode.window.showInformationMessage(
        'Remote image cache is already empty.'
      );
      return;
    }

    const answer = await vscode.window.showWarningMessage(
      `Clear remote image cache (${formatBytes(usage.totalBytes)} across ${usage.totalFiles} file(s))?`,
      { modal: true },
      'Clear Cache'
    );
    if (answer !== 'Clear Cache') {
      return;
    }

    let deletedLocations = 0;
    for (const location of usage.locations) {
      if (!location.exists) continue;
      try {
        await vscode.workspace.fs.delete(location.uri, {
          recursive: true,
          useTrash: false
        });
        deletedLocations += 1;
      } catch {
        // Best-effort; keep clearing other locations.
      }
    }

    this.remoteImageOverrides.clear();
    if (this.panel && this.currentEditor?.document.languageId === 'markdown') {
      await this.renderNow();
    }

    const after = await this.collectRemoteImageCacheUsage();
    const removedBytes = Math.max(0, usage.totalBytes - after.totalBytes);
    const removedFiles = Math.max(0, usage.totalFiles - after.totalFiles);
    const suffix =
      after.totalFiles > 0
        ? ` ${after.totalFiles} file(s) (${formatBytes(after.totalBytes)}) remain.`
        : '';

    void vscode.window.showInformationMessage(
      `Cleared remote image cache in ${deletedLocations} location(s): removed ${removedFiles} file(s), freed ${formatBytes(removedBytes)}.${suffix}`
    );
  }

  getOutlineProvider(): MarkdownOutlineProvider {
    const provider = new MarkdownOutlineProvider();
    this.disposables.push(
      this.onOutlineChanged((toc) => provider.setToc(toc)),
      provider
    );
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

  private async relocateMarkdownOutOfPreviewColumn(
    editor: vscode.TextEditor,
    previewColumn: vscode.ViewColumn
  ): Promise<void> {
    if (this.relocatingEditor) return;
    this.relocatingEditor = true;
    try {
      let relocated = editor;
      if (this.preferredMarkdownColumn) {
        relocated = await vscode.window.showTextDocument(editor.document, {
          viewColumn: this.preferredMarkdownColumn,
          preview: false
        });
        await this.closeMarkdownTabsInColumn(
          editor.document.uri,
          previewColumn
        );
      }
      this.currentEditor = relocated;
      if (!this.panel) {
        await this.openPreview(false, true, previewColumn, relocated);
      } else {
        this.panel.reveal(this.panel.viewColumn ?? previewColumn, true);
        await this.renderNow();
      }
    } finally {
      this.relocatingEditor = false;
    }
  }

  private async closeMarkdownTabsInColumn(
    uri: vscode.Uri,
    column: vscode.ViewColumn
  ): Promise<void> {
    const targetGroup = vscode.window.tabGroups.all.find(
      (group) => group.viewColumn === column
    );
    if (!targetGroup) return;

    const tabsToClose = targetGroup.tabs.filter((tab) => {
      return (
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.toString() === uri.toString()
      );
    });

    if (tabsToClose.length === 0) return;

    try {
      await vscode.window.tabGroups.close(tabsToClose, true);
    } catch {
      // Best-effort cleanup. If closing fails, rendering still proceeds in the preferred editor column.
    }
  }

  private async tryAutoOpenPreview(editor: vscode.TextEditor): Promise<void> {
    if (this.autoOpenInFlight) return;
    const settings = getSettings(editor.document.uri);
    if (!settings.autoOpenPreview) return;
    if (this.panel?.visible) return;

    this.autoOpenInFlight = true;
    try {
      await this.openPreview(true, true, undefined, editor);
    } finally {
      this.autoOpenInFlight = false;
    }
  }

  private async renderNow(): Promise<void> {
    const panel = this.panel;
    const editor = this.currentEditor;
    if (!panel || !editor || editor.document.languageId !== 'markdown') return;

    const settings = getSettings(editor.document.uri);
    if (await this.refreshWebviewShellIfNeeded(editor.document.uri, settings)) {
      return;
    }
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
      allowRemoteImages: settings.allowRemoteImages,
      remoteImageOverrides: this.remoteImageOverrides,
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
        showFrontmatter: settings.showFrontmatter,
        githubMarkdownStyle: getGithubMarkdownStyleSettings(
          settings.useMarkdownPreviewGithubStyling
        )
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
        if (
          !this.currentEditor ||
          !getSettings(this.currentEditor.document.uri).scrollSync
        )
          return;
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
        this.currentEditor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.AtTop
        );
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
      case 'uiStateChanged': {
        await this.updatePreviewUiState({
          searchUiVisible: message.searchUiVisible,
          tocVisible: message.tocVisible
        });
        break;
      }
      case 'pdfExportResult': {
        if (!message.ok && message.error) {
          void vscode.window.showWarningMessage(
            `Preview print failed: ${message.error}`
          );
        }
        break;
      }
      case 'openImage': {
        await this.openLocalImage(message.src);
        break;
      }
      case 'downloadRemoteImage': {
        await this.downloadRemoteImageForPreview(message.src);
        break;
      }
      case 'requestExport': {
        const picked = await vscode.window.showQuickPick(
          [
            {
              label: 'HTML',
              description: 'Self-contained HTML export',
              value: 'html' as const
            },
            {
              label: 'PDF',
              description: 'Open print dialog / Save as PDF',
              value: 'pdf' as const
            }
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
        if (
          this.pendingHtmlExportSnapshot &&
          this.pendingHtmlExportSnapshot.requestId === message.requestId
        ) {
          clearTimeout(this.pendingHtmlExportSnapshot.timer);
          this.pendingHtmlExportSnapshot.resolve({
            html: message.html,
            themeVariables: message.themeVariables
          });
          this.pendingHtmlExportSnapshot = undefined;
        }
        break;
      }
      default:
        break;
    }
  }

  private async buildWebviewHtml(
    webview: vscode.Webview,
    settings: RuntimeSettings,
    customCssTexts: string[] = []
  ): Promise<string> {
    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        'dist',
        'webview-ui',
        'index.js'
      )
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        'dist',
        'webview-ui',
        'index.css'
      )
    );
    // Strict CSP with optional remote image sources; script/style/connect remain locked down.
    const csp = buildWebviewCsp(webview.cspSource, nonce, {
      allowRemoteImages: settings.allowRemoteImages
    });
    const customCssTags = customCssTexts
      .map((cssText, index) =>
        inlineCssTag(
          cssText,
          nonce,
          ` id="omv-custom-css-${index}" data-omv-custom-css="true"`
        )
      )
      .join('\n  ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Offline Markdown Preview</title>
  <link nonce="${nonce}" rel="stylesheet" href="${cssUri}" />
  ${customCssTags}
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    window.__OMV_BOOT__ = {
      platform: ${JSON.stringify(process.platform)},
      styleNonce: ${JSON.stringify(nonce)},
      initialUiState: ${JSON.stringify(this.previewUiState)}
    };
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private readPreviewUiState(): PreviewUiState {
    const saved = this.context.globalState?.get<Partial<PreviewUiState>>(
      PREVIEW_UI_STATE_KEY
    );
    return {
      searchUiVisible:
        saved?.searchUiVisible ?? DEFAULT_PREVIEW_UI_STATE.searchUiVisible,
      tocVisible: saved?.tocVisible ?? DEFAULT_PREVIEW_UI_STATE.tocVisible
    };
  }

  private async updatePreviewUiState(next: PreviewUiState): Promise<void> {
    if (
      this.previewUiState.searchUiVisible === next.searchUiVisible &&
      this.previewUiState.tocVisible === next.tocVisible
    ) {
      return;
    }

    this.previewUiState = next;
    await this.context.globalState?.update?.(PREVIEW_UI_STATE_KEY, next);
  }

  private async refreshWebviewShellIfNeeded(
    documentUri: vscode.Uri,
    settings: RuntimeSettings
  ): Promise<boolean> {
    if (!this.panel) return false;
    const remoteImagesChanged =
      this.webviewAllowsRemoteImages !== settings.allowRemoteImages;

    const customCss = await this.resolvePendingCustomCss(documentUri);
    const nextCustomCssKey = customCss.key;
    const nextCustomCssTexts = customCss.cssTexts;

    const customCssChanged = this.webviewCustomCssKey !== nextCustomCssKey;
    if (!remoteImagesChanged && !customCssChanged) {
      return false;
    }

    if (remoteImagesChanged) {
      this.panel.webview.html = await this.buildWebviewHtml(
        this.panel.webview,
        settings,
        nextCustomCssTexts
      );
    } else {
      this.postMessage({
        type: 'updateCustomCss',
        cssTexts: nextCustomCssTexts
      });
    }

    this.webviewAllowsRemoteImages = settings.allowRemoteImages;
    this.webviewCustomCssKey = nextCustomCssKey;
    this.webviewCustomCssTexts = nextCustomCssTexts;
    return remoteImagesChanged;
  }

  private async refreshCustomCssOnly(): Promise<void> {
    const panel = this.panel;
    const editor = this.currentEditor;
    if (!panel || !editor || editor.document.languageId !== 'markdown') {
      return;
    }

    const customCss = await this.resolvePendingCustomCss(editor.document.uri);
    if (this.webviewCustomCssKey === customCss.key) {
      return;
    }

    this.postMessage({
      type: 'updateCustomCss',
      cssTexts: customCss.cssTexts
    });
    this.webviewCustomCssKey = customCss.key;
    this.webviewCustomCssTexts = customCss.cssTexts;
  }

  private async resolvePendingCustomCss(
    documentUri: vscode.Uri
  ): Promise<{ key: string; cssTexts: string[] }> {
    if (!this.webviewCustomCssDirty && this.webviewCustomCssKey !== undefined) {
      return {
        key: this.webviewCustomCssKey,
        cssTexts: this.webviewCustomCssTexts ?? []
      };
    }

    const customCss = await resolveCustomCss(documentUri);
    this.webviewCustomCssDirty = false;
    return customCss;
  }

  private isCurrentCustomCssUri(uri: vscode.Uri): boolean {
    if (!this.panel || !this.currentEditor) {
      return false;
    }

    const targets = getConfiguredCustomCssUris(this.currentEditor.document.uri);
    return targets.some((target) => target.toString() === uri.toString());
  }

  private postMessage(message: ExtensionToWebviewMessage): void {
    if (!this.panel) return;
    try {
      void this.panel.webview.postMessage(message);
    } catch (error) {
      if (isDisposedWebviewError(error)) {
        this.panel = undefined;
      } else {
        throw error;
      }
    }
  }

  private async requestRenderedHtmlExportSnapshot(): Promise<
    HtmlExportSnapshotData | undefined
  > {
    if (!this.panel) return undefined;

    if (this.pendingHtmlExportSnapshot) {
      clearTimeout(this.pendingHtmlExportSnapshot.timer);
      this.pendingHtmlExportSnapshot.resolve(undefined);
      this.pendingHtmlExportSnapshot = undefined;
    }

    const requestId = ++this.htmlExportSnapshotReqId;
    return new Promise<HtmlExportSnapshotData | undefined>((resolve) => {
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
        void vscode.window.showWarningMessage(
          `Could not open link target: ${href}`
        );
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
          void vscode.window.showWarningMessage(
            'Could not open the selected file.'
          );
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
    editor.revealRange(
      new vscode.Range(pos, pos),
      vscode.TextEditorRevealType.InCenter
    );
  }

  private async openLocalImage(src: string): Promise<void> {
    const uri = vscode.Uri.parse(src, true);
    const folder = this.currentEditor
      ? vscode.workspace.getWorkspaceFolder(this.currentEditor.document.uri)
      : undefined;
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

  private async downloadRemoteImageForPreview(src: string): Promise<void> {
    const editor = this.currentEditor;
    if (!editor) return;

    const settings = getSettings(editor.document.uri);
    if (settings.allowRemoteImages) {
      this.postMessage({
        type: 'notify',
        level: 'info',
        message: 'Remote images are already allowed by settings.'
      });
      return;
    }

    try {
      const downloaded = await this.downloadRemoteImageToCache(
        src,
        editor.document.uri,
        settings.maxImageMB
      );
      this.remoteImageOverrides.set(src, downloaded);
      this.postMessage({
        type: 'notify',
        level: 'info',
        message: `Downloaded remote image for preview: ${path.basename(downloaded.fsPath)}`
      });
      await this.renderNow();
    } catch (error) {
      this.postMessage({
        type: 'notify',
        level: 'warning',
        message: `Could not download remote image: ${getErrorMessage(error)}`
      });
    }
  }

  private async downloadRemoteImageToCache(
    src: string,
    documentUri: vscode.Uri,
    maxImageMB: number
  ): Promise<vscode.Uri> {
    let parsed: URL;
    try {
      parsed = new URL(src);
    } catch {
      throw new Error('Invalid URL');
    }

    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new Error('Only http(s) URLs are supported');
    }

    const response = await fetch(parsed.toString(), { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }

    const contentType = (
      response.headers.get('content-type') ?? ''
    ).toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new Error(
        `URL did not return an image (${contentType || 'unknown content-type'})`
      );
    }

    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength === 0) {
      throw new Error('Downloaded image is empty');
    }

    const maxBytes = maxImageMB * 1024 * 1024;
    if (data.byteLength > maxBytes) {
      throw new Error(`Image exceeds preview.maxImageMB (${maxImageMB} MB)`);
    }

    const targetDir = await this.resolveRemoteImageCacheDir(documentUri);
    await vscode.workspace.fs.createDirectory(targetDir);

    const extension = inferRemoteImageExtension(contentType, parsed.pathname);
    const hash = createHash('sha256').update(src).digest('hex').slice(0, 24);
    const target = vscode.Uri.joinPath(targetDir, `${hash}${extension}`);
    await vscode.workspace.fs.writeFile(target, data);
    return target;
  }

  private async resolveRemoteImageCacheDir(
    documentUri: vscode.Uri
  ): Promise<vscode.Uri> {
    const folder = vscode.workspace.getWorkspaceFolder(documentUri);
    if (folder) {
      return vscode.Uri.joinPath(
        folder.uri,
        '.offline-markdown-preview',
        'remote-images'
      );
    }
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'remote-images');
  }

  private getRemoteImageCacheLocations(): Array<{
    uri: vscode.Uri;
    label: string;
  }> {
    const locations: Array<{ uri: vscode.Uri; label: string }> = [];
    const seen = new Set<string>();
    const add = (uri: vscode.Uri, label: string) => {
      const key = uri.toString();
      if (seen.has(key)) return;
      seen.add(key);
      locations.push({ uri, label });
    };

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      add(
        vscode.Uri.joinPath(
          folder.uri,
          '.offline-markdown-preview',
          'remote-images'
        ),
        `workspace:${folder.name}`
      );
    }
    add(
      vscode.Uri.joinPath(this.context.globalStorageUri, 'remote-images'),
      'global-storage'
    );

    return locations;
  }

  private async collectRemoteImageCacheUsage(): Promise<{
    totalBytes: number;
    totalFiles: number;
    locations: Array<{
      uri: vscode.Uri;
      label: string;
      exists: boolean;
      bytes: number;
      files: number;
    }>;
  }> {
    const locations = this.getRemoteImageCacheLocations();
    const usageLocations: Array<{
      uri: vscode.Uri;
      label: string;
      exists: boolean;
      bytes: number;
      files: number;
    }> = [];
    let totalBytes = 0;
    let totalFiles = 0;

    for (const location of locations) {
      const stats = await this.measureDirectoryUsage(location.uri);
      usageLocations.push({ ...location, ...stats });
      totalBytes += stats.bytes;
      totalFiles += stats.files;
    }

    return { totalBytes, totalFiles, locations: usageLocations };
  }

  private async measureDirectoryUsage(
    dir: vscode.Uri
  ): Promise<{ exists: boolean; bytes: number; files: number }> {
    try {
      const stat = await vscode.workspace.fs.stat(dir);
      if (!(stat.type & vscode.FileType.Directory)) {
        return { exists: true, bytes: 0, files: 0 };
      }
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return { exists: false, bytes: 0, files: 0 };
      }
      throw error;
    }

    let bytes = 0;
    let files = 0;
    const queue: vscode.Uri[] = [dir];

    while (queue.length > 0) {
      const nextDir = queue.shift();
      if (!nextDir) break;
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(nextDir);
      } catch {
        continue;
      }

      for (const [name, type] of entries) {
        const child = vscode.Uri.joinPath(nextDir, name);
        if (type & vscode.FileType.Directory) {
          queue.push(child);
          continue;
        }
        if (!(type & (vscode.FileType.File | vscode.FileType.SymbolicLink))) {
          continue;
        }
        try {
          const childStat = await vscode.workspace.fs.stat(child);
          if (childStat.type & vscode.FileType.Directory) {
            queue.push(child);
          } else {
            bytes += childStat.size;
            files += 1;
          }
        } catch {
          // Ignore files that disappear while measuring.
        }
      }
    }

    return { exists: true, bytes, files };
  }

  private async embedLocalImages(
    html: string,
    maxImageMB: number
  ): Promise<string> {
    const matches = [
      ...html.matchAll(
        /<img[^>]*data-local-src="([^"]+)"[^>]*src="([^"]*)"[^>]*>/g
      )
    ];
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
      (
        _match,
        prefix: string,
        localSrc: string,
        _currentSrc: string,
        suffix: string
      ) => `${prefix}${localSrc}${suffix}`
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

  private async buildStandaloneHtml(
    bodyHtml: string,
    sourceUri: vscode.Uri,
    settings: RuntimeSettings,
    themeVariables?: Record<string, string>
  ): Promise<string> {
    const cssPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      'dist',
      'webview-ui',
      'index.css'
    ).fsPath;
    let baseCss = '';
    try {
      baseCss = await fs.readFile(cssPath, 'utf8');
    } catch {
      baseCss =
        'body{font-family:sans-serif;padding:1rem;max-width:900px;margin:0 auto;}';
    }
    const customCss = await resolveCustomCss(sourceUri);
    const customCssTags = customCss.cssTexts
      .map((cssText, index) =>
        inlineCssTag(
          cssText,
          'omv-export-custom-css',
          ` data-omv-custom-css="${index}"`
        )
      )
      .join('\n');

    const frontmatter =
      settings.showFrontmatter && this.state.snapshot?.frontmatter
        ? `<details open><summary>Frontmatter</summary><pre>${escapeHtml(this.state.snapshot.frontmatter.raw)}</pre></details>`
        : '';
    const githubStyleAttributes = buildGitHubMarkdownStyleAttributes(
      settings.useMarkdownPreviewGithubStyling
    );
    const themeStyleAttribute = buildInlineStyleAttribute(themeVariables);
    const wrappedBodyHtml = `<article class="omv-preview">
${frontmatter}
<div class="omv-content markdown-body github-markdown-body"${githubStyleAttributes}${themeStyleAttribute}>
<div class="github-markdown-content">
${bodyHtml}
</div>
</div>
</article>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(path.basename(sourceUri.fsPath))}</title>
<style>${baseCss}</style>
${customCssTags}
</head>
<body class="${getExportThemeBodyClass()}">
${wrappedBodyHtml}
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

function buildInlineStyleAttribute(
  styleMap: Record<string, string> | undefined
): string {
  if (!styleMap) {
    return '';
  }

  const declarations = Object.entries(styleMap)
    .filter(([, value]) => value.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ');
  return declarations ? ` style="${escapeHtml(declarations)}"` : '';
}

function isDisposedWebviewError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /webview is disposed/i.test(message) || /disposed/i.test(message);
}

function inferRemoteImageExtension(
  contentType: string,
  urlPathname: string
): string {
  const typeMap: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
    'image/avif': '.avif'
  };

  const mime = contentType.split(';')[0]?.trim();
  if (mime && typeMap[mime]) {
    return typeMap[mime];
  }

  const ext = path.extname(urlPathname || '').toLowerCase();
  if (/^\.[a-z0-9]{1,6}$/i.test(ext)) {
    return ext;
  }

  return '.img';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  const text = String(error ?? '').trim();
  return text || 'Unknown error';
}

function isFileNotFoundError(error: unknown): boolean {
  const code =
    typeof error === 'object' && error
      ? (error as { code?: string }).code
      : undefined;
  if (code && (code === 'FileNotFound' || code === 'ENOENT')) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /file not found|no such file or directory|enoent/i.test(message);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded =
    value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
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
): Promise<
  { ok: true } | { ok: false; code: number | string; stderr?: string }
> {
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
      resolve({
        ok: false,
        code: error.code ?? 'ERROR',
        stderr: error.message
      });
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
