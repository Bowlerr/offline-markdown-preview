import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Uri } from './helpers/vscodeMock';

type Listener<T> = (event: T) => void;

class EventEmitter<T> {
  private listeners: Listener<T>[] = [];

  readonly event = (listener: Listener<T>) => {
    this.listeners.push(listener);
    return { dispose() {} };
  };

  fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

function createEventHook<T>() {
  const emitter = new EventEmitter<T>();
  return {
    fire(event: T): void {
      emitter.fire(event);
    },
    register(listener: Listener<T>) {
      return emitter.event(listener);
    }
  };
}

function createWorkspaceFolder(fsPath: string) {
  return {
    name: path.basename(fsPath),
    uri: Uri.file(fsPath)
  };
}

function createPreviewPanelTestContext(options: {
  workspaceFolderPaths: string[];
  workspaceFilePath?: string;
  activeEditorPath?: string;
  activeEditorLanguageId?: string;
  quickPickLabel?: string;
  openDialogPath?: string;
  customCssUris?: InstanceType<typeof Uri>[];
  baseCssText?: string;
  initialPreviewUiState?: {
    searchUiVisible?: boolean;
    tocVisible?: boolean;
  };
}) {
  const workspaceFolders = options.workspaceFolderPaths.map(
    createWorkspaceFolder
  );
  const textDocumentChange = createEventHook<{
    document: { uri: InstanceType<typeof Uri> };
  }>();
  const textDocumentSave = createEventHook<{
    uri: InstanceType<typeof Uri>;
  }>();
  const textDocumentClose = createEventHook<{
    languageId: string;
    uri: InstanceType<typeof Uri>;
  }>();
  const configurationChange = createEventHook<{
    affectsConfiguration: (
      section: string,
      resource?: InstanceType<typeof Uri>
    ) => boolean;
  }>();
  const activeEditorChange = createEventHook<unknown>();
  const visibleRangesChange = createEventHook<unknown>();
  const update = vi.fn().mockResolvedValue(undefined);
  const showInformationMessage = vi.fn().mockResolvedValue(undefined);
  const showWarningMessage = vi.fn().mockResolvedValue(undefined);
  const showOpenDialog = vi
    .fn()
    .mockResolvedValue(
      options.openDialogPath ? [Uri.file(options.openDialogPath)] : undefined
    );
  const globalStateGet = vi.fn((key: string) =>
    key === 'preview.uiState' ? options.initialPreviewUiState : undefined
  );
  const globalStateUpdate = vi.fn().mockResolvedValue(undefined);

  const activeTextEditor = options.activeEditorPath
    ? {
        document: {
          languageId: options.activeEditorLanguageId ?? 'markdown',
          uri: Uri.file(options.activeEditorPath),
          lineCount: 1
        },
        viewColumn: 1
      }
    : undefined;

  const showQuickPick = vi.fn().mockImplementation(async (choices: any[]) => {
    if (!options.quickPickLabel) {
      return undefined;
    }
    return choices.find((choice) => choice.label === options.quickPickLabel);
  });

  const workspace = {
    workspaceFile: options.workspaceFilePath
      ? Uri.file(options.workspaceFilePath)
      : undefined,
    workspaceFolders,
    textDocuments: [],
    getWorkspaceFolder(uri: InstanceType<typeof Uri>) {
      return workspaceFolders.find((folder) => {
        const relative = path.relative(folder.uri.fsPath, uri.fsPath);
        return (
          relative === '' ||
          (!relative.startsWith('..') && !path.isAbsolute(relative))
        );
      });
    },
    getConfiguration: vi.fn(() => ({
      get<T>(key: string, defaultValue: T): T {
        if (key === 'preview.autoOpen') {
          return false as T;
        }
        if (key === 'preview.useMarkdownPreviewGithubStyling') {
          return false as T;
        }
        return defaultValue;
      },
      inspect<T>() {
        return {} as {
          globalValue?: T;
          workspaceValue?: T;
          workspaceFolderValue?: T;
        };
      },
      update
    })),
    onDidChangeTextDocument: (
      listener: Listener<{ document: { uri: InstanceType<typeof Uri> } }>
    ) => textDocumentChange.register(listener),
    onDidSaveTextDocument: (
      listener: Listener<{ uri: InstanceType<typeof Uri> }>
    ) => textDocumentSave.register(listener),
    onDidCloseTextDocument: (
      listener: Listener<{ languageId: string; uri: InstanceType<typeof Uri> }>
    ) => textDocumentClose.register(listener),
    onDidChangeConfiguration: (
      listener: Listener<{
        affectsConfiguration: (
          section: string,
          resource?: InstanceType<typeof Uri>
        ) => boolean;
      }>
    ) => configurationChange.register(listener)
  };

  const vscodeMock = {
    Uri,
    workspace,
    window: {
      activeTextEditor,
      activeColorTheme: { kind: 2 },
      showQuickPick,
      showOpenDialog,
      showInformationMessage,
      showWarningMessage,
      onDidChangeActiveTextEditor: (listener: Listener<unknown>) =>
        activeEditorChange.register(listener),
      onDidChangeTextEditorVisibleRanges: (listener: Listener<unknown>) =>
        visibleRangesChange.register(listener),
      tabGroups: { all: [], close: vi.fn().mockResolvedValue(undefined) }
    },
    EventEmitter,
    TreeItem: class {},
    TreeItemCollapsibleState: { None: 0 },
    ColorThemeKind: {
      Light: 1,
      Dark: 2,
      HighContrast: 3,
      HighContrastLight: 4
    },
    ViewColumn: {
      Active: 1,
      Beside: 2
    },
    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
      WorkspaceFolder: 3
    },
    Position: class {},
    Selection: class {},
    Range: class {},
    TextEditorRevealType: { InCenter: 0, AtTop: 1 },
    TabInputText: class {},
    commands: {
      executeCommand: vi.fn().mockResolvedValue(undefined)
    },
    env: {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      openExternal: vi.fn().mockResolvedValue(undefined)
    },
    FileType: {
      Directory: 2,
      File: 1,
      SymbolicLink: 64
    }
  };

  const securityMock = {
    buildWebviewCsp: vi.fn(() => ''),
    confirmSanitizeDisabled: vi.fn(async () => true),
    createNonce: vi.fn(() => 'nonce'),
    getConfiguredCustomCssUris: vi.fn(() => options.customCssUris ?? []),
    getGithubMarkdownStyleSettings: vi.fn((enabled: boolean) => ({
      enabled,
      colorMode: 'light',
      lightTheme: 'light',
      darkTheme: 'dark'
    })),
    getWorkspaceCustomCssBaseUri: vi.fn(() =>
      options.workspaceFilePath
        ? Uri.file(path.dirname(options.workspaceFilePath))
        : options.workspaceFolderPaths.length === 1
          ? Uri.file(options.workspaceFolderPaths[0])
          : undefined
    ),
    inlineCssTag: vi.fn(
      (cssText: string, _nonce: string, attributes = '') =>
        `<style${attributes}>${cssText}</style>`
    ),
    resolveCustomCss: vi.fn(async () => ({
      key: 'custom-css',
      cssTexts: []
    }))
  };

  const fsMock = {
    readFile: vi
      .fn()
      .mockResolvedValue(options.baseCssText ?? 'body { color: black; }')
  };

  return {
    changeTextDocument: textDocumentChange.fire,
    changeConfiguration: configurationChange.fire,
    closeTextDocument: textDocumentClose.fire,
    fsMock,
    globalState: {
      get: globalStateGet,
      update: globalStateUpdate
    },
    renderMarkdown: vi.fn(() => ({
      html: '<p>Rendered</p>',
      toc: [],
      frontmatter: undefined,
      lineCount: 1
    })),
    securityMock,
    update,
    vscodeMock
  };
}

async function loadPreviewPanelTestModule(
  options: Parameters<typeof createPreviewPanelTestContext>[0]
) {
  vi.resetModules();
  const context = createPreviewPanelTestContext(options);
  vi.doMock('node:fs/promises', () => context.fsMock);
  vi.doMock('vscode', () => context.vscodeMock);
  vi.doMock('../../src/extension/preview/markdown/markdownPipeline', () => ({
    renderMarkdown: context.renderMarkdown
  }));
  vi.doMock(
    '../../src/extension/preview/markdown/security',
    () => context.securityMock
  );
  const module = await import('../../src/extension/preview/PreviewPanel');
  return { ...context, module };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('vscode');
  vi.doUnmock('../../src/extension/preview/markdown/markdownPipeline');
  vi.doUnmock('../../src/extension/preview/markdown/security');
  vi.clearAllMocks();
});

describe('PreviewController custom CSS', () => {
  it('enables installed GitHub Markdown styling in user settings', async () => {
    const { module, update, vscodeMock } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-root/workspace-a'],
      activeEditorPath: '/workspace-root/workspace-a/doc.md',
      quickPickLabel: 'Use Installed GitHub Markdown Styling'
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    await controller.configureCustomCss();

    expect(update).toHaveBeenCalledWith(
      'preview.useMarkdownPreviewGithubStyling',
      true,
      vscodeMock.ConfigurationTarget.Global
    );
  });

  it('disables installed GitHub Markdown styling in user settings', async () => {
    const { module, update, vscodeMock } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-root/workspace-a'],
      activeEditorPath: '/workspace-root/workspace-a/doc.md',
      quickPickLabel: 'Disable Installed GitHub Markdown Styling'
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    await controller.configureCustomCss();

    expect(update).toHaveBeenCalledWith(
      'preview.useMarkdownPreviewGithubStyling',
      false,
      vscodeMock.ConfigurationTarget.Global
    );
  });

  it('writes workspace custom CSS to workspace settings', async () => {
    const { module, update, vscodeMock } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: [
        '/workspace-root/workspace-a',
        '/workspace-root/workspace-b'
      ],
      workspaceFilePath: '/workspace-root/demo.code-workspace',
      activeEditorPath: '/workspace-root/workspace-a/doc.md',
      quickPickLabel: 'Set Workspace Custom CSS',
      openDialogPath: '/workspace-root/workspace-a/styles/preview.css'
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    await controller.configureCustomCss();

    expect(update).toHaveBeenCalledWith(
      'preview.customCssPath',
      'workspace-a/styles/preview.css',
      vscodeMock.ConfigurationTarget.Workspace
    );
  });

  it('clears folder custom CSS by removing the override', async () => {
    const { module, update, vscodeMock } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: [
        '/workspace-root/workspace-a',
        '/workspace-root/workspace-b'
      ],
      workspaceFilePath: '/workspace-root/demo.code-workspace',
      activeEditorPath: '/workspace-root/workspace-a/doc.md',
      quickPickLabel: 'Clear Folder Custom CSS'
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    await controller.configureCustomCss();

    expect(update).toHaveBeenCalledWith(
      'preview.customCssPath',
      undefined,
      vscodeMock.ConfigurationTarget.WorkspaceFolder
    );
  });

  it('scopes folder custom CSS to the active non-markdown editor folder', async () => {
    const { module, update, vscodeMock } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: [
        '/workspace-root/workspace-a',
        '/workspace-root/workspace-b'
      ],
      workspaceFilePath: '/workspace-root/demo.code-workspace',
      activeEditorPath: '/workspace-root/workspace-b/notes.txt',
      activeEditorLanguageId: 'plaintext',
      quickPickLabel: 'Set Folder Custom CSS',
      openDialogPath: '/workspace-root/workspace-b/styles/preview.css'
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    (controller as any).currentEditor = {
      document: {
        languageId: 'markdown',
        uri: Uri.file('/workspace-root/workspace-a/doc.md'),
        lineCount: 1,
        version: 1,
        getText: () => '# Doc'
      }
    };

    await controller.configureCustomCss();

    expect(update).toHaveBeenCalledWith(
      'preview.customCssPath',
      'styles/preview.css',
      vscodeMock.ConfigurationTarget.WorkspaceFolder
    );
    expect(vscodeMock.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('refreshes custom CSS immediately when the stylesheet is closed', async () => {
    const cssUri = Uri.file('/workspace-a/styles/preview.css');
    const { closeTextDocument, module, securityMock } =
      await loadPreviewPanelTestModule({
        workspaceFolderPaths: ['/workspace-a'],
        activeEditorPath: '/workspace-a/doc.md',
        customCssUris: [cssUri]
      });

    securityMock.resolveCustomCss.mockResolvedValue({
      key: 'closed-custom-css',
      cssTexts: []
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const postMessage = vi.fn();
    (controller as any).panel = {
      webview: {
        postMessage
      }
    };
    (controller as any).currentEditor = {
      document: {
        languageId: 'markdown',
        uri: Uri.file('/workspace-a/doc.md'),
        lineCount: 1,
        version: 1,
        getText: () => '# Doc'
      }
    };
    (controller as any).webviewCustomCssDirty = false;
    (controller as any).webviewCustomCssKey = 'initial-custom-css';

    closeTextDocument({
      languageId: 'css',
      uri: cssUri
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(securityMock.resolveCustomCss).toHaveBeenCalledWith(
      Uri.file('/workspace-a/doc.md')
    );
    expect((controller as any).webviewCustomCssDirty).toBe(false);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'updateCustomCss',
      cssTexts: []
    });
  });

  it('updates custom CSS without rerendering markdown on stylesheet edits', async () => {
    const cssUri = Uri.file('/workspace-a/styles/preview.css');
    const { changeTextDocument, module, renderMarkdown, securityMock } =
      await loadPreviewPanelTestModule({
        workspaceFolderPaths: ['/workspace-a'],
        activeEditorPath: '/workspace-a/doc.md',
        customCssUris: [cssUri]
      });

    securityMock.resolveCustomCss.mockResolvedValue({
      key: 'updated-custom-css',
      cssTexts: ['.omv-content { color: red; }']
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const postMessage = vi.fn();
    (controller as any).panel = {
      webview: {
        postMessage
      }
    };
    (controller as any).currentEditor = {
      document: {
        languageId: 'markdown',
        uri: Uri.file('/workspace-a/doc.md'),
        lineCount: 1,
        version: 1,
        getText: () => '# Doc'
      }
    };
    (controller as any).webviewCustomCssDirty = false;
    (controller as any).webviewCustomCssKey = 'initial-custom-css';
    (controller as any).webviewCustomCssTexts = [
      '.omv-content { color: blue; }'
    ];

    changeTextDocument({
      document: {
        uri: cssUri
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'updateCustomCss',
      cssTexts: ['.omv-content { color: red; }']
    });
    expect(renderMarkdown).not.toHaveBeenCalled();
  });

  it('marks webview CSS dirty when installed GitHub styling configuration changes', async () => {
    const { changeConfiguration, module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a'],
      activeEditorPath: '/workspace-a/doc.md'
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    (controller as any).currentEditor = {
      document: {
        languageId: 'markdown',
        uri: Uri.file('/workspace-a/doc.md'),
        lineCount: 1,
        version: 1,
        getText: () => '# Doc'
      }
    };
    (controller as any).webviewCustomCssDirty = false;

    changeConfiguration({
      affectsConfiguration: (section: string) =>
        section === 'offlineMarkdownViewer' ||
        section ===
          'offlineMarkdownViewer.preview.useMarkdownPreviewGithubStyling'
    });

    expect((controller as any).webviewCustomCssDirty).toBe(true);
  });

  it('keeps custom CSS in separate style tags in standalone export HTML', async () => {
    const { module, securityMock } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });

    securityMock.resolveCustomCss.mockResolvedValue({
      key: 'export-custom-css',
      cssTexts: [
        '.github-markdown-body { color: black; }',
        '.omv-content { color: red; }',
        '@import url("https://example.com/theme.css");'
      ]
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const html = await (controller as any).buildStandaloneHtml(
      '<p>Rendered</p>',
      Uri.file('/workspace-a/doc.md'),
      {
        showFrontmatter: false
      },
      {
        '--omv-active-pre-bg': 'rgb(1, 2, 3)',
        '--omv-mermaid-border': 'rgb(4, 5, 6)'
      }
    );

    expect(securityMock.resolveCustomCss).toHaveBeenCalledWith(
      Uri.file('/workspace-a/doc.md')
    );
    expect(html).toContain('<style>body { color: black; }</style>');
    expect(html).toContain(
      '<style data-omv-custom-css="0">.github-markdown-body { color: black; }</style>'
    );
    expect(html).toContain(
      '<style data-omv-custom-css="1">.omv-content { color: red; }</style>'
    );
    expect(html).toContain(
      '<style data-omv-custom-css="2">@import url("https://example.com/theme.css");</style>'
    );
    expect(html).toContain(
      '<div class="omv-content markdown-body github-markdown-body" data-color-mode="light" data-light-theme="light" data-dark-theme="dark" style="--omv-active-pre-bg: rgb(1, 2, 3); --omv-mermaid-border: rgb(4, 5, 6);">'
    );
    expect(html).toContain('<div class="github-markdown-content">');
    expect(html).toContain('<body class="vscode-body vscode-dark">');
    expect(html).toContain(
      '<div class="github-markdown-content">\n<p>Rendered</p>\n</div>'
    );
    expect(html.indexOf('<style data-omv-custom-css="0">')).toBeLessThan(
      html.indexOf('<style data-omv-custom-css="1">')
    );
    expect(html.indexOf('<style data-omv-custom-css="1">')).toBeLessThan(
      html.indexOf('<style data-omv-custom-css="2">')
    );
  });

  it('rewrites local image sources for export regardless of attribute order', async () => {
    const { module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const html = (controller as any).rewriteLocalImageSourcesForExport(
      '<p><img src="vscode-webview://file:///workspace-a/images/demo.gif" alt="demo" data-local-src="file:///workspace-a/images/demo.gif" /></p>'
    );

    expect(html).toContain(
      '<img src="file:///workspace-a/images/demo.gif" alt="demo" data-local-src="file:///workspace-a/images/demo.gif" />'
    );
  });

  it('hydrates new webviews with the saved preview UI toggle state', async () => {
    const { globalState, module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a'],
      initialPreviewUiState: {
        searchUiVisible: false,
        tocVisible: false
      }
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage'),
      globalState
    } as any);

    const html = await (controller as any).buildWebviewHtml(
      {
        asWebviewUri: (uri: InstanceType<typeof Uri>) => uri,
        cspSource: 'webview-source'
      },
      {
        enableMermaid: true,
        enableMath: true,
        scrollSync: true,
        sanitizeHtml: true,
        autoOpenPreview: false,
        allowRemoteImages: false,
        showFrontmatter: false,
        externalConfirm: true,
        maxImageMB: 8,
        embedImages: false,
        debounceMs: 120,
        useMarkdownPreviewGithubStyling: false
      }
    );

    expect(globalState.get).toHaveBeenCalledWith('preview.uiState');
    expect(html).toContain(
      'initialUiState: {"searchUiVisible":false,"tocVisible":false}'
    );
  });

  it('persists preview UI toggle changes from the webview', async () => {
    const { globalState, module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage'),
      globalState
    } as any);

    await (controller as any).handleWebviewMessage({
      type: 'uiStateChanged',
      searchUiVisible: false,
      tocVisible: true
    });

    expect(globalState.update).toHaveBeenCalledWith('preview.uiState', {
      searchUiVisible: false,
      tocVisible: true
    });
  });
});
