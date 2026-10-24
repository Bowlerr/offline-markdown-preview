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

function createTextDocument(
  filePath: string,
  languageId = 'markdown',
  content = '# Doc'
) {
  return {
    languageId,
    uri: Uri.file(filePath),
    lineCount: Math.max(1, content.split('\n').length),
    version: 1,
    getText: () => content
  };
}

function createTextEditor(
  filePath: string,
  options: {
    languageId?: string;
    viewColumn?: number;
    content?: string;
  } = {}
) {
  const document = createTextDocument(
    filePath,
    options.languageId,
    options.content
  );
  return {
    document,
    viewColumn: options.viewColumn ?? 1,
    selection: undefined,
    revealRange: vi.fn()
  };
}

function createPreviewPanelTestContext(options: {
  workspaceFolderPaths: string[];
  workspaceFilePath?: string;
  activeEditorPath?: string;
  activeEditorLanguageId?: string;
  autoOpenPreview?: boolean;
  quickPickLabel?: string;
  openDialogPath?: string;
  saveDialogPath?: string;
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
  const showErrorMessage = vi.fn().mockResolvedValue(undefined);
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
  const outputChannel = {
    appendLine: vi.fn(),
    dispose: vi.fn()
  };
  const workspaceWriteFile = vi.fn().mockResolvedValue(undefined);

  let activeTextEditor = options.activeEditorPath
    ? createTextEditor(options.activeEditorPath, {
        languageId: options.activeEditorLanguageId
      })
    : undefined;

  const showQuickPick = vi.fn().mockImplementation(async (choices: any[]) => {
    if (!options.quickPickLabel) {
      return undefined;
    }
    return choices.find((choice) => choice.label === options.quickPickLabel);
  });
  const createWebviewPanel = vi.fn().mockImplementation(
    (_viewType: string, _title: string, viewColumn: number) => {
      const disposeListeners: Array<() => void> = [];
      const viewStateListeners: Array<
        (event: { webviewPanel: { viewColumn?: number } }) => void
      > = [];
      const messageListeners: Array<(message: unknown) => void> = [];

      const panel = {
        visible: true,
        viewColumn,
        title: _title,
        reveal: vi.fn((nextColumn?: number) => {
          panel.visible = true;
          if (typeof nextColumn === 'number') {
            panel.viewColumn = nextColumn;
            viewStateListeners.forEach((listener) =>
              listener({ webviewPanel: panel })
            );
          }
        }),
        dispose: vi.fn(() => {
          panel.visible = false;
          disposeListeners.forEach((listener) => listener());
        }),
        onDidDispose: (listener: () => void) => {
          disposeListeners.push(listener);
          return { dispose() {} };
        },
        onDidChangeViewState: (
          listener: (event: { webviewPanel: { viewColumn?: number } }) => void
        ) => {
          viewStateListeners.push(listener);
          return { dispose() {} };
        },
        webview: {
          html: '',
          cspSource: 'webview-source',
          asWebviewUri: (uri: InstanceType<typeof Uri>) => uri,
          postMessage: vi.fn(),
          onDidReceiveMessage: (listener: (message: unknown) => void) => {
            messageListeners.push(listener);
            return { dispose() {} };
          }
        }
      };

      return panel;
    }
  );
  const showTextDocument = vi
    .fn()
    .mockImplementation(async (document: any, columnOrOptions?: any) => {
      const viewColumn =
        typeof columnOrOptions === 'number'
          ? columnOrOptions
          : columnOrOptions?.viewColumn ?? 1;
      const editor = {
        document,
        viewColumn,
        selection: undefined,
        revealRange: vi.fn()
      };
      activeTextEditor = editor;
      return editor;
    });

  const workspace = {
    workspaceFile: options.workspaceFilePath
      ? Uri.file(options.workspaceFilePath)
      : undefined,
    workspaceFolders,
    textDocuments: [],
    fs: {
      writeFile: workspaceWriteFile,
      createDirectory: vi.fn().mockResolvedValue(undefined)
    },
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
          return (options.autoOpenPreview ?? false) as T;
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
      get activeTextEditor() {
        return activeTextEditor;
      },
      activeColorTheme: { kind: 2 },
      createWebviewPanel,
      showQuickPick,
      showOpenDialog,
      showSaveDialog: vi
        .fn()
        .mockResolvedValue(
          options.saveDialogPath ? Uri.file(options.saveDialogPath) : undefined
        ),
      showInformationMessage,
      showErrorMessage,
      showTextDocument,
      showWarningMessage,
      createOutputChannel: vi.fn(() => outputChannel),
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
          ? Uri.file(options.workspaceFolderPaths[0]!)
          : undefined
    ),
    inlineCssTag: vi.fn(
      (cssText: string, _nonce: string, attributes = '') =>
        `<style${attributes}>${cssText}</style>`
    ),
    resolveCustomCss: vi.fn(async () => ({
      key: 'custom-css',
      cssTexts: [] as string[]
    }))
  };

  const fsMock = {
    realpath: vi.fn().mockImplementation(async (value: string) => value),
    access: vi.fn().mockResolvedValue(undefined),
    mkdtemp: vi.fn().mockResolvedValue('/tmp/omv-pdf-test'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 1024 }),
    readFile: vi
      .fn()
      .mockResolvedValue(options.baseCssText ?? 'body { color: black; }')
  };

  return {
    changeTextDocument: textDocumentChange.fire,
    changeConfiguration: configurationChange.fire,
    changeActiveTextEditor: activeEditorChange.fire,
    closeTextDocument: textDocumentClose.fire,
    createTextEditor,
    fsMock,
    globalState: {
      get: globalStateGet,
      update: globalStateUpdate
    },
    outputChannel,
    renderMarkdown: vi.fn(() => ({
      html: '<p>Rendered</p>',
      toc: [],
      frontmatter: undefined,
      lineCount: 1
    })),
    securityMock,
    update,
    vscodeMock,
    workspaceWriteFile
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock('vscode');
  vi.doUnmock('../../src/extension/preview/markdown/markdownPipeline');
  vi.doUnmock('../../src/extension/preview/markdown/security');
  vi.clearAllMocks();
});

describe('PreviewController panel lifecycle', () => {
  it('switches active markdown files without re-revealing the preview panel', async () => {
    vi.useFakeTimers();
    const { changeActiveTextEditor, createTextEditor, module, vscodeMock } =
      await loadPreviewPanelTestModule({
        workspaceFolderPaths: ['/workspace-a'],
        activeEditorPath: '/workspace-a/one.md'
      });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const reveal = vi.fn();
    const renderNow = vi.fn().mockResolvedValue(undefined);
    (controller as any).panel = {
      visible: true,
      viewColumn: 2,
      reveal,
      webview: { postMessage: vi.fn() }
    };
    (controller as any).followActiveMarkdownBeside = true;
    (controller as any).renderNow = renderNow;

    changeActiveTextEditor(
      createTextEditor('/workspace-a/two.md', { viewColumn: 1 })
    );
    await vi.runAllTimersAsync();

    expect((controller as any).currentEditor.document.uri.fsPath).toBe(
      '/workspace-a/two.md'
    );
    expect(reveal).not.toHaveBeenCalled();
    expect(renderNow).toHaveBeenCalledTimes(1);
    expect(vscodeMock.window.showTextDocument).not.toHaveBeenCalled();
  });

  it('reuses the remembered preview column when auto-opening', async () => {
    vi.useFakeTimers();
    const { changeActiveTextEditor, createTextEditor, module, vscodeMock } =
      await loadPreviewPanelTestModule({
        workspaceFolderPaths: ['/workspace-a'],
        activeEditorPath: '/workspace-a/notes.txt',
        activeEditorLanguageId: 'plaintext',
        autoOpenPreview: true
      });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    (controller as any).lastPreviewColumn = 3;

    changeActiveTextEditor(
      createTextEditor('/workspace-a/doc.md', { viewColumn: 1 })
    );
    await vi.runAllTimersAsync();

    expect(vscodeMock.window.createWebviewPanel).toHaveBeenCalled();
    expect(vscodeMock.window.createWebviewPanel.mock.calls[0]![2]).toBe(3);
  });

  it('does not auto-reveal an existing hidden preview tab on markdown switches', async () => {
    vi.useFakeTimers();
    const { changeActiveTextEditor, createTextEditor, module } =
      await loadPreviewPanelTestModule({
        workspaceFolderPaths: ['/workspace-a'],
        activeEditorPath: '/workspace-a/notes.txt',
        activeEditorLanguageId: 'plaintext',
        autoOpenPreview: true
      });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const reveal = vi.fn();
    const renderNow = vi.fn().mockResolvedValue(undefined);
    (controller as any).panel = {
      visible: false,
      viewColumn: 1,
      reveal,
      webview: { postMessage: vi.fn() }
    };
    (controller as any).renderNow = renderNow;

    changeActiveTextEditor(
      createTextEditor('/workspace-a/two.md', { viewColumn: 1 })
    );
    await vi.runAllTimersAsync();

    expect(reveal).not.toHaveBeenCalled();
    expect(renderNow).toHaveBeenCalledTimes(1);
  });

  it('relocates markdown editors only when they open in the preview column', async () => {
    const { changeActiveTextEditor, createTextEditor, module, vscodeMock } =
      await loadPreviewPanelTestModule({
        workspaceFolderPaths: ['/workspace-a'],
        activeEditorPath: '/workspace-a/one.md'
      });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const reveal = vi.fn();
    const renderNow = vi.fn().mockResolvedValue(undefined);
    (controller as any).panel = {
      visible: true,
      viewColumn: 2,
      reveal,
      webview: { postMessage: vi.fn() }
    };
    (controller as any).preferredMarkdownColumn = 1;
    (controller as any).renderNow = renderNow;

    const conflictedEditor = createTextEditor('/workspace-a/two.md', {
      viewColumn: 2
    });
    changeActiveTextEditor(conflictedEditor);
    await Promise.resolve();
    await Promise.resolve();

    expect(vscodeMock.window.showTextDocument).toHaveBeenCalledWith(
      conflictedEditor.document,
      {
        viewColumn: 1,
        preview: false
      }
    );
    expect(reveal).toHaveBeenCalledWith(2, true);
    expect(renderNow).toHaveBeenCalledTimes(1);
    expect((controller as any).currentEditor.viewColumn).toBe(1);
  });

  it('rerenders when a hidden preview becomes visible again', async () => {
    vi.useFakeTimers();
    const { module, vscodeMock } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a'],
      activeEditorPath: '/workspace-a/one.md'
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const renderNow = vi.spyOn(controller as any, 'renderNow');
    await controller.openPreview(true, true);
    renderNow.mockClear();

    const panel = (controller as any).panel;
    panel.visible = false;
    panel.reveal(panel.viewColumn, true);
    await vi.runAllTimersAsync();

    expect(renderNow).toHaveBeenCalledTimes(1);
    expect(vscodeMock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });
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
    expect(html).not.toContain('offline-markdown-preview-export');
    expect(html).not.toContain('data-omv-pdf-ready');
  });

  it('keeps captured frontmatter when the active document changes during export preparation', async () => {
    const { module, securityMock } = await loadPreviewPanelTestModule({ workspaceFolderPaths: ['/workspace-a'] });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'), globalStorageUri: Uri.file('/global-storage')
    } as any);
    securityMock.resolveCustomCss.mockImplementation(async () => {
      (controller as any).state = { snapshot: {
        uri: Uri.file('/workspace-a/private.md'),
        frontmatter: { raw: 'title: Other private document', data: {} }
      }, toc: [] };
      return { key: 'custom-css', cssTexts: [] };
    });
    const html = await (controller as any).buildStandaloneHtml(
      '<p>Original body</p>', Uri.file('/workspace-a/original.md'),
      { showFrontmatter: true }, undefined, false,
      { raw: 'title: Original document', data: {} }
    );
    expect(html).toContain('title: Original document');
    expect(html).not.toContain('Other private document');
  });

  it('builds PDF HTML that waits for local images and fonts', async () => {
    const { module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const html = await (controller as any).buildStandaloneHtml(
      '<img src="file:///workspace-a/assets/name%20with%20spaces.svg" alt="fixture" />',
      Uri.file('/workspace-a/nested/résumé #1.md'),
      { showFrontmatter: false, useMarkdownPreviewGithubStyling: false },
      undefined,
      true
    );

    expect(html).toContain(
      '<meta name="offline-markdown-preview-export" content="ready">'
    );
    expect(html).toContain('data-omv-pdf-ready="pending"');
    expect(html).toContain('await image.decode()');
    expect(html).toContain('await document.fonts.ready');
    expect(html).toContain(
      'src="file:///workspace-a/assets/name%20with%20spaces.svg"'
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
      '<p><img src="vscode-webview://file:///workspace-a/images/demo.gif" alt="demo" data-omv-local-src="file:///workspace-a/images/demo.gif" /></p>'
    );

    expect(html).toContain(
      '<img src="file:///workspace-a/images/demo.gif" alt="demo" data-omv-local-src="file:///workspace-a/images/demo.gif" />'
    );
  });

  it('rewrites local image sources for export when quoted attributes contain >', async () => {
    const { module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const html = (controller as any).rewriteLocalImageSourcesForExport(
      '<p><img data-omv-local-src="file:///workspace-a/images/demo.gif" alt="a > b" src="vscode-webview://file:///workspace-a/images/demo.gif" /></p>'
    );

    expect(html).toContain(
      '<img data-omv-local-src="file:///workspace-a/images/demo.gif" alt="a > b" src="file:///workspace-a/images/demo.gif" />'
    );
  });

  it('restores blocked local image sources and srcset for export', async () => {
    const { module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const html = (controller as any).rewriteLocalImageSourcesForExport(
      '<p><img data-omv-local-src="file:///workspace-a/images/demo.gif" src="" data-omv-export-srcset="file:///workspace-a/images/demo.gif 1x, file:///workspace-a/images/demo@2x.gif 2x" srcset="" /></p>'
    );

    expect(html).toContain(
      '<img data-omv-local-src="file:///workspace-a/images/demo.gif" src="file:///workspace-a/images/demo.gif" data-omv-export-srcset="file:///workspace-a/images/demo.gif 1x, file:///workspace-a/images/demo@2x.gif 2x" srcset="file:///workspace-a/images/demo.gif 1x, file:///workspace-a/images/demo@2x.gif 2x" />'
    );
  });

  it('restores blocked remote image sources and srcset for export', async () => {
    const { module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const html = (controller as any).rewriteLocalImageSourcesForExport(
      '<p><img data-omv-remote-src="https://example.com/demo.gif" src="" data-omv-export-srcset="https://example.com/demo.gif 1x, https://example.com/demo@2x.gif 2x" srcset="" /></p>'
    );

    expect(html).toContain(
      '<img data-omv-remote-src="https://example.com/demo.gif" src="https://example.com/demo.gif" data-omv-export-srcset="https://example.com/demo.gif 1x, https://example.com/demo@2x.gif 2x" srcset="https://example.com/demo.gif 1x, https://example.com/demo@2x.gif 2x" />'
    );
  });

  it('ignores authored generic data-remote-src during export rewriting', async () => {
    const { module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const html = (controller as any).rewriteLocalImageSourcesForExport(
      '<p><img src="https://cdn.example.com/demo.gif" data-remote-src="hero" alt="demo" /></p>'
    );

    expect(html).toContain(
      '<img src="https://cdn.example.com/demo.gif" data-remote-src="hero" alt="demo" />'
    );
  });

  it('preserves SVG fragments when embedding local images for export', async () => {
    const { fsMock, module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });

    fsMock.readFile.mockResolvedValueOnce(Buffer.from('<svg />'));

    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);

    const html = await (controller as any).embedLocalImages(
      '<p><img data-omv-local-src="file:///workspace-a/images/icons.svg#logo" src="file:///workspace-a/images/icons.svg#logo" /></p>',
      24,
      Uri.file('/workspace-a/doc.md')
    );

    expect(html).toContain('src="data:image/svg+xml;base64,PHN2ZyAvPg==#logo"');
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

  it('passes normal, nested, spaced, encoded, and non-ASCII paths as encoded file URIs', async () => {
    const { module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });

    expect(
      module.buildPdfNavigationUrl(
        Uri.file('/tmp/normal/nested/doc.print.html') as any
      )
    ).toBe('file:///tmp/normal/nested/doc.print.html');

    const specialUrl = module.buildPdfNavigationUrl(
      Uri.file(
        '/tmp/folder with spaces/nested/résumé #100% %20.print.html'
      ) as any
    );
    expect(specialUrl).toBe(
      'file:///tmp/folder%20with%20spaces/nested/r%C3%A9sum%C3%A9%20%23100%25%20%2520.print.html'
    );

    const windowsUrl = module.buildPdfNavigationUrl(
      Uri.file('C:\\Users\\Jane Doe\\nested\\résumé #1.print.html') as any
    );
    expect(windowsUrl).toBe(
      'file:///C:/Users/Jane%20Doe/nested/r%C3%A9sum%C3%A9%20%231.print.html'
    );
  });

  it('identifies Chromium navigation and resource readiness failures', async () => {
    const { module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });

    expect(
      module.getPdfNavigationError('<html>ERR_FILE_NOT_FOUND</html>')
    ).toBe('Chromium navigation failed with ERR_FILE_NOT_FOUND');
    expect(
      module.getPdfNavigationError('<html><p>Different page</p></html>')
    ).toBe(
      'Chromium loaded a document other than the generated PDF export HTML'
    );
    expect(
      module.getPdfNavigationError(
        '<html data-omv-pdf-ready="pending"><head><meta name="offline-markdown-preview-export" content="ready"></head></html>'
      )
    ).toBe('the exported document did not finish loading its images and fonts');
    expect(
      module.getPdfNavigationError(
        '<html data-omv-pdf-ready="true"><head><meta name="offline-markdown-preview-export" content="ready"></head></html>'
      )
    ).toBeUndefined();
    expect(
      module.getPdfNavigationError(
        '<html data-omv-pdf-ready="true"><head><meta name="offline-markdown-preview-export" content="ready"></head><body><code>ERR_FILE_NOT_FOUND</code></body></html>'
      )
    ).toBeUndefined();
  });

  it('validates PDF navigation before printing with separate Chromium actions', async () => {
    const { module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);
    const runHeadlessBrowser = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        code: 0,
        stdout:
          '<html data-omv-pdf-ready="true"><head><meta name="offline-markdown-preview-export" content="ready"></head></html>',
        stderr: ''
      })
      .mockResolvedValueOnce({ ok: true, code: 0, stdout: '', stderr: '' });
    (controller as any).getHeadlessBrowserCandidates = () => ['chromium'];
    (controller as any).runHeadlessBrowser = runHeadlessBrowser;
    const sourceUri = Uri.file('/tmp/source with spaces.html');
    const targetUri = Uri.file('/tmp/rendered.pdf');

    const result = await (controller as any).tryHeadlessPdfExport(
      sourceUri,
      targetUri
    );

    expect(result).toEqual({ ok: true });
    expect(runHeadlessBrowser).toHaveBeenCalledTimes(2);
    const navigationArgs = runHeadlessBrowser.mock.calls[0]?.[1] as string[];
    const pdfArgs = runHeadlessBrowser.mock.calls[1]?.[1] as string[];
    const sharedFlags = [
      '--allow-file-access-from-files',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=10000'
    ];
    expect(navigationArgs).toEqual(expect.arrayContaining(sharedFlags));
    expect(navigationArgs).toContain('--dump-dom');
    expect(navigationArgs).not.toContain('--no-pdf-header-footer');
    expect(
      navigationArgs.some((arg) => arg.startsWith('--print-to-pdf='))
    ).toBe(false);
    expect(pdfArgs).toEqual(expect.arrayContaining(sharedFlags));
    expect(pdfArgs).not.toContain('--dump-dom');
    expect(pdfArgs).toContain('--no-pdf-header-footer');
    expect(pdfArgs).toContain(`--print-to-pdf=${targetUri.fsPath}`);
    expect(navigationArgs.at(-1)).toBe(sourceUri.toString());
    expect(pdfArgs.at(-1)).toBe(sourceUri.toString());
  });

  it('does not print when Chromium navigation validation fails', async () => {
    const { module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);
    const runHeadlessBrowser = vi.fn().mockResolvedValue({
      ok: true,
      code: 0,
      stdout: '<html>ERR_FILE_NOT_FOUND</html>',
      stderr: ''
    });
    (controller as any).getHeadlessBrowserCandidates = () => ['chromium'];
    (controller as any).runHeadlessBrowser = runHeadlessBrowser;

    const result = await (controller as any).tryHeadlessPdfExport(
      Uri.file('/tmp/missing.html'),
      Uri.file('/tmp/rendered.pdf')
    );

    expect(result).toEqual({
      ok: false,
      reason: 'Chromium navigation failed with ERR_FILE_NOT_FOUND'
    });
    expect(runHeadlessBrowser).toHaveBeenCalledTimes(1);
    const args = runHeadlessBrowser.mock.calls[0]?.[1] as string[];
    expect(args).toContain('--dump-dom');
    expect(args.some((arg) => arg.startsWith('--print-to-pdf='))).toBe(false);
  });

  it('reports PDF renderer failure without accepting staged output', async () => {
    const { fsMock, module } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a']
    });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);
    const runHeadlessBrowser = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        code: 0,
        stdout:
          '<html data-omv-pdf-ready="true"><head><meta name="offline-markdown-preview-export" content="ready"></head></html>',
        stderr: ''
      })
      .mockResolvedValueOnce({
        ok: false,
        code: 'ENOENT',
        stdout: '',
        stderr: 'renderer unavailable'
      });
    (controller as any).getHeadlessBrowserCandidates = () => ['chromium'];
    (controller as any).runHeadlessBrowser = runHeadlessBrowser;

    const result = await (controller as any).tryHeadlessPdfExport(
      Uri.file('/tmp/source.html'),
      Uri.file('/tmp/rendered.pdf')
    );

    expect(result).toEqual({
      ok: false,
      reason: 'chromium PDF renderer exited with status ENOENT'
    });
    expect(runHeadlessBrowser).toHaveBeenCalledTimes(2);
    expect(fsMock.stat).not.toHaveBeenCalled();
  });

  it('waits for a cold webview to become ready before requesting the export snapshot', async () => {
    const { module, vscodeMock, workspaceWriteFile } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a'], activeEditorPath: '/workspace-a/doc.md',
      saveDialogPath: '/workspace-a/output.html'
    });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'), globalStorageUri: Uri.file('/global-storage')
    } as any);
    const exported = controller.exportHtml();
    await vi.waitFor(() => expect((controller as any).panel?.webview.html).toContain('<!DOCTYPE html>'));
    const postMessage = (controller as any).panel.webview.postMessage;
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'requestHtmlExportSnapshot' }));
    postMessage.mockImplementation((message: any) => {
      if (message.type === 'requestHtmlExportSnapshot') {
        void (controller as any).handleWebviewMessage({
          ...message, type: 'htmlExportSnapshot', html: '<p>Completed preview</p>'
        });
      }
      return Promise.resolve(true);
    });
    await (controller as any).handleWebviewMessage({ type: 'ready' });
    await exported;
    expect(workspaceWriteFile).toHaveBeenCalledWith(Uri.file('/workspace-a/output.html'), expect.any(Buffer));
    expect(workspaceWriteFile.mock.calls[0]![1].toString()).toContain('<p>Completed preview</p>');
    expect(vscodeMock.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it.each(['exportHtml', 'exportPdf'] as const)('fails safely when %s cannot obtain a rendered snapshot', async (method) => {
    const { module, vscodeMock, workspaceWriteFile, fsMock } = await loadPreviewPanelTestModule({
      workspaceFolderPaths: ['/workspace-a'],
      saveDialogPath: '/workspace-a/output.html'
    });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'), globalStorageUri: Uri.file('/global-storage')
    } as any);
    (controller as any).currentEditor = createTextEditor('/workspace-a/doc.md');
    (controller as any).panel = { webview: { postMessage: vi.fn() } };
    (controller as any).webviewReady = true;
    (controller as any).state = { snapshot: {
      uri: Uri.file('/workspace-a/doc.md'), version: 1,
      html: '<script>unsafe()</script>'
    }, toc: [] };
    (controller as any).renderNow = vi.fn().mockResolvedValue(undefined);
    (controller as any).requestRenderedHtmlExportSnapshot = vi.fn().mockResolvedValue(undefined);

    await controller[method]();

    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Export cancelled'));
    expect(vscodeMock.window.showSaveDialog).not.toHaveBeenCalled();
    expect(workspaceWriteFile).not.toHaveBeenCalled();
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    { documentUri: 'file:///workspace-a/other.md' },
    { version: 2 },
    { renderRequestId: 4 },
    { error: 'Preview has not finished rendering' }
  ])('rejects stale or failed export snapshots: %j', async (override) => {
    const { module } = await loadPreviewPanelTestModule({ workspaceFolderPaths: ['/workspace-a'] });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'), globalStorageUri: Uri.file('/global-storage')
    } as any);
    (controller as any).currentEditor = createTextEditor('/workspace-a/doc.md');
    (controller as any).panel = { webview: { postMessage: vi.fn() } };
    (controller as any).webviewReady = true;
    (controller as any).state = { snapshot: { uri: Uri.file('/workspace-a/doc.md'), version: 1 }, toc: [] };
    (controller as any).renderRequestId = 3;
    const pending = (controller as any).requestRenderedHtmlExportSnapshot();
    await (controller as any).handleWebviewMessage({
      type: 'htmlExportSnapshot', requestId: 1,
      documentUri: 'file:///workspace-a/doc.md', version: 1, renderRequestId: 3,
      html: '<p>Rendered</p>', ...override
    });
    await expect(pending).resolves.toBeUndefined();
  });

  it('accepts a matching completed export snapshot and times out without raw HTML fallback', async () => {
    vi.useFakeTimers();
    const { module } = await loadPreviewPanelTestModule({ workspaceFolderPaths: ['/workspace-a'] });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'), globalStorageUri: Uri.file('/global-storage')
    } as any);
    (controller as any).currentEditor = createTextEditor('/workspace-a/doc.md');
    const postMessage = vi.fn();
    (controller as any).panel = { webview: { postMessage } };
    (controller as any).state = { snapshot: { uri: Uri.file('/workspace-a/doc.md'), version: 1 }, toc: [] };
    (controller as any).renderRequestId = 3;
    const pending = (controller as any).requestRenderedHtmlExportSnapshot();
    expect(postMessage).toHaveBeenCalledWith({
      type: 'requestHtmlExportSnapshot', requestId: 1,
      documentUri: 'file:///workspace-a/doc.md', version: 1, renderRequestId: 3
    });
    await (controller as any).handleWebviewMessage({
      type: 'htmlExportSnapshot', requestId: 1,
      documentUri: 'file:///workspace-a/doc.md', version: 1, renderRequestId: 3,
      html: '<p>Rendered</p>'
    });
    await expect(pending).resolves.toMatchObject({ html: '<p>Rendered</p>' });
    const timedOut = (controller as any).requestRenderedHtmlExportSnapshot();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(timedOut).resolves.toBeUndefined();
  });

  it('refuses local file embedding outside the workspace, including symlink escapes and forged srcset', async () => {
    const { module, fsMock } = await loadPreviewPanelTestModule({ workspaceFolderPaths: ['/workspace-a'] });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'), globalStorageUri: Uri.file('/global-storage')
    } as any);
    fsMock.realpath.mockImplementation(async (value: string) => value.includes('/linked/') ? '/outside/private.txt' : value);
    const html = '<img data-omv-local-src="file:///outside/private.txt" srcset="file:///workspace-a/linked/private.txt 1x, file:///outside/private.txt 2x">';
    expect(await (controller as any).embedLocalImages(html, 24, Uri.file('/workspace-a/doc.md'))).toBe(html);
    expect(fsMock.readFile).not.toHaveBeenCalled();
    expect(fsMock.stat).not.toHaveBeenCalled();
  });

  it('opens only authorized local image paths and rejects non-file image actions', async () => {
    const { module, vscodeMock } = await loadPreviewPanelTestModule({ workspaceFolderPaths: ['/workspace-a'] });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'), globalStorageUri: Uri.file('/global-storage')
    } as any);
    (controller as any).currentEditor = createTextEditor('/workspace-a/doc.md');
    for (const src of ['command:workbench.action.closeWindow', 'https://example.com', 'file:///outside/private.txt']) {
      await (controller as any).openLocalImage(src);
    }
    expect(vscodeMock.commands.executeCommand).not.toHaveBeenCalled();
    await (controller as any).openLocalImage('file:///workspace-a/image.png');
    expect(vscodeMock.commands.executeCommand).toHaveBeenCalledWith('vscode.open', Uri.file('/workspace-a/image.png'));
  });

  it.each([false, true])('applies standalone CSP with remote image opt-in %s and a PDF readiness nonce', async (allowRemoteImages) => {
    const { module } = await loadPreviewPanelTestModule({ workspaceFolderPaths: ['/workspace-a'] });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'), globalStorageUri: Uri.file('/global-storage')
    } as any);
    const html = await (controller as any).buildStandaloneHtml(
      '<img src="https://example.com/tracker.png">', Uri.file('/workspace-a/doc.md'),
      { allowRemoteImages, showFrontmatter: false }, undefined, true
    );
    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
    expect(policy).toContain(`img-src file: data: blob:${allowRemoteImages ? ' https: http:' : ''};`);
    expect(policy).toContain("style-src 'unsafe-inline' file:");
    expect(policy).toContain('font-src file: data:');
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("script-src 'nonce-nonce'");
    expect(html).toContain('<script nonce="nonce">');
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<style>'));
    const plainHtml = await (controller as any).buildStandaloneHtml('', Uri.file('/workspace-a/doc.md'), { allowRemoteImages });
    expect(plainHtml).toContain("script-src 'none'");
  });

  it('rejects oversized image responses before reading their declared body', async () => {
    const { module, workspaceWriteFile } = await loadPreviewPanelTestModule({ workspaceFolderPaths: ['/workspace-a'] });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'), globalStorageUri: Uri.file('/global-storage')
    } as any);
    const getReader = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png', 'content-length': String(2 * 1024 * 1024) }),
      body: { getReader }
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect((controller as any).downloadRemoteImageToCache('https://example.com/image.png', Uri.file('/workspace-a/doc.md'), 1))
      .rejects.toThrow('exceeds preview.maxImageMB');
    expect(getReader).not.toHaveBeenCalled();
    expect(workspaceWriteFile).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true);
  });

  it('stops chunked image downloads at the byte limit without buffering the remainder', async () => {
    const { module, workspaceWriteFile } = await loadPreviewPanelTestModule({ workspaceFolderPaths: ['/workspace-a'] });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'), globalStorageUri: Uri.file('/global-storage')
    } as any);
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(700_000) })
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(700_000) })
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(700_000) }),
      cancel: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn()
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, headers: new Headers({ 'content-type': 'image/png' }),
      body: { getReader: () => reader }
    }));
    await expect((controller as any).downloadRemoteImageToCache('https://example.com/image.png', Uri.file('/workspace-a/doc.md'), 1))
      .rejects.toThrow('exceeds preview.maxImageMB');
    expect(reader.read).toHaveBeenCalledTimes(2);
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
    expect(workspaceWriteFile).not.toHaveBeenCalled();
  });

  it('writes a completed bounded image download to the local cache', async () => {
    const { module, workspaceWriteFile } = await loadPreviewPanelTestModule({ workspaceFolderPaths: ['/workspace-a'] });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'), globalStorageUri: Uri.file('/global-storage')
    } as any);
    const reader = {
      read: vi.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) }).mockResolvedValueOnce({ done: true }),
      cancel: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn()
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, headers: new Headers({ 'content-type': 'image/png' }),
      body: { getReader: () => reader }
    }));
    const target = await (controller as any).downloadRemoteImageToCache('https://example.com/image.png', Uri.file('/workspace-a/doc.md'), 1);
    expect(target.fsPath).toContain('/workspace-a/.offline-markdown-preview/remote-images/');
    expect(workspaceWriteFile).toHaveBeenCalledWith(target, new Uint8Array([1, 2, 3]));
  });

  it('aborts a stalled image download after its deadline', async () => {
    vi.useFakeTimers();
    const { module, workspaceWriteFile } = await loadPreviewPanelTestModule({ workspaceFolderPaths: ['/workspace-a'] });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'), globalStorageUri: Uri.file('/global-storage')
    } as any);
    vi.stubGlobal('fetch', vi.fn((_url: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    })));
    const pending = (controller as any).downloadRemoteImageToCache('https://example.com/image.png', Uri.file('/workspace-a/doc.md'), 1);
    const rejected = expect(pending).rejects.toThrow('timed out after 30 seconds');
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(workspaceWriteFile).not.toHaveBeenCalled();
  });

  it('stages a successful PDF and cleans temporary files after copying it', async () => {
    const { fsMock, module, vscodeMock, workspaceWriteFile } =
      await loadPreviewPanelTestModule({
        workspaceFolderPaths: ['/workspace-a'],
        saveDialogPath: '/workspace-a/output with spaces.pdf'
      });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);
    (controller as any).currentEditor = createTextEditor(
      '/workspace-a/nested/résumé #1.md'
    );
    (controller as any).panel = { webview: { postMessage: vi.fn() } };
    (controller as any).webviewReady = true;
    (controller as any).state = {
      snapshot: {
        uri: Uri.file('/workspace-a/nested/résumé #1.md'),
        html: '<p>Rendered</p>'
      },
      toc: []
    };
    (controller as any).requestRenderedHtmlExportSnapshot = vi
      .fn()
      .mockResolvedValue({ html: '<p>Rendered</p>' });
    (controller as any).renderNow = vi.fn().mockResolvedValue(undefined);
    (controller as any).buildStandaloneHtml = vi
      .fn()
      .mockResolvedValue('<html>PDF fixture</html>');
    (controller as any).tryHeadlessPdfExport = vi
      .fn()
      .mockResolvedValue({ ok: true });
    fsMock.readFile.mockResolvedValueOnce(Buffer.from('%PDF fixture'));

    await controller.exportPdf();

    expect(fsMock.writeFile).toHaveBeenCalledWith(
      path.join('/tmp/omv-pdf-test', 'résumé #1.print.html'),
      '<html>PDF fixture</html>',
      'utf8'
    );
    expect(workspaceWriteFile).toHaveBeenCalledWith(
      Uri.file('/workspace-a/output with spaces.pdf'),
      Buffer.from('%PDF fixture')
    );
    expect(fsMock.rm).toHaveBeenLastCalledWith('/tmp/omv-pdf-test', {
      recursive: true,
      force: true
    });
    expect(vscodeMock.window.showInformationMessage).toHaveBeenCalledWith(
      'Exported PDF to /workspace-a/output with spaces.pdf'
    );
  });

  it('reports renderer navigation failures and cleans temporary files without replacing the target', async () => {
    const { fsMock, module, vscodeMock, workspaceWriteFile } =
      await loadPreviewPanelTestModule({
        workspaceFolderPaths: ['/workspace-a'],
        saveDialogPath: '/workspace-a/existing.pdf'
      });
    const controller = new module.PreviewController({
      extensionUri: Uri.file('/extension'),
      globalStorageUri: Uri.file('/global-storage')
    } as any);
    (controller as any).currentEditor = createTextEditor('/workspace-a/doc.md');
    (controller as any).panel = { webview: { postMessage: vi.fn() } };
    (controller as any).webviewReady = true;
    (controller as any).state = {
      snapshot: {
        uri: Uri.file('/workspace-a/doc.md'),
        html: '<p>Rendered</p>'
      },
      toc: []
    };
    (controller as any).requestRenderedHtmlExportSnapshot = vi
      .fn()
      .mockResolvedValue({ html: '<p>Rendered</p>' });
    (controller as any).renderNow = vi.fn().mockResolvedValue(undefined);
    (controller as any).buildStandaloneHtml = vi
      .fn()
      .mockResolvedValue('<html>PDF fixture</html>');
    (controller as any).tryHeadlessPdfExport = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'Chromium navigation failed with ERR_FILE_NOT_FOUND'
    });

    await controller.exportPdf();

    expect(workspaceWriteFile).not.toHaveBeenCalled();
    expect(vscodeMock.window.showErrorMessage).toHaveBeenCalledWith(
      'PDF export failed: Chromium navigation failed with ERR_FILE_NOT_FOUND. See the Offline Markdown Preview output for details.'
    );
    expect(fsMock.rm).toHaveBeenLastCalledWith('/tmp/omv-pdf-test', {
      recursive: true,
      force: true
    });
  });
});
