import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createVscodeMock } from './helpers/vscodeMock';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omv-security-'));
  tempDirs.push(dir);
  return dir;
}

function createConfiguredVscodeMock(options: {
  workspaceRoot?: string;
  workspaceFolderPaths?: string[];
  workspaceFilePath?: string;
  globalCustomCssPath?: string;
  workspaceCustomCssPath?: string;
  workspaceFolderCustomCssPath?: string;
  openTextDocuments?: Array<{ fsPath: string; text: string }>;
  warnings: string[];
}) {
  const workspaceFolderPaths =
    options.workspaceFolderPaths ??
    (options.workspaceRoot ? [options.workspaceRoot] : undefined);
  const base = createVscodeMock(workspaceFolderPaths?.[0]);

  return {
    ...base,
    workspace: {
      ...base.workspace,
      workspaceFile: options.workspaceFilePath
        ? base.Uri.file(options.workspaceFilePath)
        : undefined,
      workspaceFolders: (workspaceFolderPaths ?? []).map((workspacePath) => ({
        name: path.basename(workspacePath),
        uri: base.Uri.file(workspacePath)
      })),
      textDocuments: (options.openTextDocuments ?? []).map((document) => ({
        uri: base.Uri.file(document.fsPath),
        getText: () => document.text
      })),
      getWorkspaceFolder(uri: InstanceType<typeof base.Uri>) {
        return this.workspaceFolders.find((folder) => {
          const relative = path.relative(folder.uri.fsPath, uri.fsPath);
          return (
            relative === '' ||
            (!relative.startsWith('..') && !path.isAbsolute(relative))
          );
        });
      },
      getConfiguration: () => ({
        inspect<T>(key: string): {
          globalValue?: T;
          workspaceValue?: T;
          workspaceFolderValue?: T;
        } {
          switch (key) {
            case 'preview.globalCustomCssPath':
              return {
                globalValue: options.globalCustomCssPath as T | undefined
              };
            case 'preview.customCssPath':
              return {
                workspaceValue: options.workspaceCustomCssPath as T | undefined,
                workspaceFolderValue: options.workspaceFolderCustomCssPath as
                  | T
                  | undefined
              };
            default:
              return {};
          }
        },
        get<T>(_key: string, defaultValue: T): T {
          return defaultValue;
        }
      })
    },
    window: {
      showWarningMessage: vi.fn((message: string) => {
        options.warnings.push(message);
        return Promise.resolve(undefined);
      })
    }
  };
}

async function loadSecurity(
  options: {
    workspaceRoot?: string;
    workspaceFolderPaths?: string[];
    workspaceFilePath?: string;
    globalCustomCssPath?: string;
    workspaceCustomCssPath?: string;
    workspaceFolderCustomCssPath?: string;
    openTextDocuments?: Array<{ fsPath: string; text: string }>;
  } = {}
) {
  vi.resetModules();
  const warnings: string[] = [];
  const vscodeMock = createConfiguredVscodeMock({ ...options, warnings });
  vi.doMock('vscode', () => vscodeMock);
  const security =
    await import('../../src/extension/preview/markdown/security');
  return { security, vscodeMock, warnings };
}

afterEach(async () => {
  vi.resetModules();
  vi.doUnmock('vscode');
  vi.clearAllMocks();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('security helpers', () => {
  it('builds a strict CSP with no remote connect and no unsafe-eval', async () => {
    const { security } = await loadSecurity();
    const csp = security.buildWebviewCsp('vscode-webview://x', 'abc');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('img-src vscode-webview://x data: blob:');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("script-src 'nonce-abc'");
  });

  it('can allow remote images without opening remote connect', async () => {
    const { security } = await loadSecurity();
    const csp = security.buildWebviewCsp('vscode-webview://x', 'abc', {
      allowRemoteImages: true
    });
    expect(csp).toContain(
      'img-src vscode-webview://x data: blob: https: http:'
    );
    expect(csp).toContain("connect-src 'none'");
  });

  it('generates unique nonces', async () => {
    const { security } = await loadSecurity();
    expect(security.createNonce()).not.toBe(security.createNonce());
  });

  it('loads no custom CSS when both settings are empty', async () => {
    const workspaceRoot = await makeTempDir();
    const { security, vscodeMock, warnings } = await loadSecurity({
      workspaceRoot
    });
    const result = await security.resolveCustomCss(
      vscodeMock.Uri.file(path.join(workspaceRoot, 'doc.md'))
    );

    expect(result.cssTexts).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('loads global CSS from an absolute .css path', async () => {
    const dir = await makeTempDir();
    const cssPath = path.join(dir, 'global.css');
    await fs.writeFile(cssPath, 'body { color: red; }', 'utf8');

    const { security, vscodeMock, warnings } = await loadSecurity({
      globalCustomCssPath: cssPath
    });
    const result = await security.resolveCustomCss(
      vscodeMock.Uri.file(path.join(dir, 'doc.md'))
    );

    expect(result.cssTexts).toEqual(['body { color: red; }']);
    expect(warnings).toEqual([]);
  });

  it('rejects a non-absolute global path', async () => {
    const dir = await makeTempDir();
    const { security, vscodeMock, warnings } = await loadSecurity({
      globalCustomCssPath: 'styles/global.css'
    });
    const result = await security.resolveCustomCss(
      vscodeMock.Uri.file(path.join(dir, 'doc.md'))
    );

    expect(result.cssTexts).toEqual([]);
    expect(warnings).toEqual([
      'Ignoring global custom CSS path because it is not an absolute .css file.'
    ]);
  });

  it('loads workspace CSS when the file stays inside the workspace root', async () => {
    const workspaceRoot = await makeTempDir();
    const cssPath = path.join(workspaceRoot, 'styles', 'preview.css');
    await fs.mkdir(path.dirname(cssPath), { recursive: true });
    await fs.writeFile(cssPath, '.markdown-body { max-width: 960px; }', 'utf8');

    const { security, vscodeMock, warnings } = await loadSecurity({
      workspaceRoot,
      workspaceCustomCssPath: 'styles/preview.css'
    });
    const result = await security.resolveCustomCss(
      vscodeMock.Uri.file(path.join(workspaceRoot, 'doc.md'))
    );

    expect(result.cssTexts).toEqual(['.markdown-body { max-width: 960px; }']);
    expect(warnings).toEqual([]);
  });

  it('loads workspace-scoped CSS from the saved workspace base in multi-root workspaces', async () => {
    const workspaceRoot = await makeTempDir();
    const workspaceA = path.join(workspaceRoot, 'workspace-a');
    const workspaceB = path.join(workspaceRoot, 'workspace-b');
    const workspaceFilePath = path.join(workspaceRoot, 'demo.code-workspace');
    const cssPath = path.join(workspaceB, 'styles', 'preview.css');
    await fs.mkdir(workspaceA, { recursive: true });
    await fs.mkdir(path.dirname(cssPath), { recursive: true });
    await fs.writeFile(cssPath, '.markdown-body { color: purple; }', 'utf8');

    const { security, vscodeMock, warnings } = await loadSecurity({
      workspaceFolderPaths: [workspaceA, workspaceB],
      workspaceFilePath,
      workspaceCustomCssPath: 'workspace-b/styles/preview.css'
    });
    const result = await security.resolveCustomCss(
      vscodeMock.Uri.file(path.join(workspaceA, 'doc.md'))
    );

    expect(result.cssTexts).toEqual(['.markdown-body { color: purple; }']);
    expect(warnings).toEqual([]);
  });

  it('falls back to the active folder for legacy workspace-scoped paths in saved multi-root workspaces', async () => {
    const workspaceRoot = await makeTempDir();
    const workspaceA = path.join(workspaceRoot, 'workspace-a');
    const workspaceB = path.join(workspaceRoot, 'workspace-b');
    const workspaceFilePath = path.join(workspaceRoot, 'demo.code-workspace');
    const cssPath = path.join(workspaceA, 'styles', 'preview.css');
    await fs.mkdir(workspaceB, { recursive: true });
    await fs.mkdir(path.dirname(cssPath), { recursive: true });
    await fs.writeFile(cssPath, '.markdown-body { color: teal; }', 'utf8');

    const { security, vscodeMock, warnings } = await loadSecurity({
      workspaceFolderPaths: [workspaceA, workspaceB],
      workspaceFilePath,
      workspaceCustomCssPath: 'styles/preview.css'
    });
    const result = await security.resolveCustomCss(
      vscodeMock.Uri.file(path.join(workspaceA, 'doc.md'))
    );

    expect(result.cssTexts).toEqual(['.markdown-body { color: teal; }']);
    expect(warnings).toEqual([]);
  });

  it('falls back to the active folder for workspace-scoped paths in untitled multi-root workspaces', async () => {
    const workspaceRoot = await makeTempDir();
    const workspaceA = path.join(workspaceRoot, 'workspace-a');
    const workspaceB = path.join(workspaceRoot, 'workspace-b');
    const cssPath = path.join(workspaceA, 'styles', 'preview.css');
    await fs.mkdir(workspaceB, { recursive: true });
    await fs.mkdir(path.dirname(cssPath), { recursive: true });
    await fs.writeFile(cssPath, '.markdown-body { color: navy; }', 'utf8');

    const { security, vscodeMock, warnings } = await loadSecurity({
      workspaceFolderPaths: [workspaceA, workspaceB],
      workspaceCustomCssPath: 'styles/preview.css'
    });
    const result = await security.resolveCustomCss(
      vscodeMock.Uri.file(path.join(workspaceA, 'doc.md'))
    );

    expect(result.cssTexts).toEqual(['.markdown-body { color: navy; }']);
    expect(warnings).toEqual([]);
  });

  it('lets a folder-level empty value disable inherited workspace CSS', async () => {
    const workspaceRoot = await makeTempDir();
    const workspaceA = path.join(workspaceRoot, 'workspace-a');
    const workspaceB = path.join(workspaceRoot, 'workspace-b');
    const workspaceFilePath = path.join(workspaceRoot, 'demo.code-workspace');
    const cssPath = path.join(workspaceB, 'styles', 'preview.css');
    await fs.mkdir(workspaceA, { recursive: true });
    await fs.mkdir(path.dirname(cssPath), { recursive: true });
    await fs.writeFile(cssPath, '.markdown-body { color: purple; }', 'utf8');

    const { security, vscodeMock, warnings } = await loadSecurity({
      workspaceFolderPaths: [workspaceA, workspaceB],
      workspaceFilePath,
      workspaceCustomCssPath: 'workspace-b/styles/preview.css',
      workspaceFolderCustomCssPath: ''
    });
    const result = await security.resolveCustomCss(
      vscodeMock.Uri.file(path.join(workspaceA, 'doc.md'))
    );

    expect(result.cssTexts).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('rejects workspace traversal paths', async () => {
    const workspaceRoot = await makeTempDir();
    const { security, vscodeMock, warnings } = await loadSecurity({
      workspaceRoot,
      workspaceCustomCssPath: '../theme.css'
    });
    const result = await security.resolveCustomCss(
      vscodeMock.Uri.file(path.join(workspaceRoot, 'doc.md'))
    );

    expect(result.cssTexts).toEqual([]);
    expect(warnings).toEqual([
      'Ignoring custom CSS path because it is not a workspace-local .css file.'
    ]);
  });

  it('rejects non-css files for both global and workspace settings', async () => {
    const workspaceRoot = await makeTempDir();
    const globalPath = path.join(workspaceRoot, 'global.txt');

    const { security, vscodeMock, warnings } = await loadSecurity({
      workspaceRoot,
      globalCustomCssPath: globalPath,
      workspaceCustomCssPath: 'styles/preview.txt'
    });
    const result = await security.resolveCustomCss(
      vscodeMock.Uri.file(path.join(workspaceRoot, 'doc.md'))
    );

    expect(result.cssTexts).toEqual([]);
    expect(warnings).toEqual([
      'Ignoring global custom CSS path because it is not an absolute .css file.',
      'Ignoring custom CSS path because it is not a workspace-local .css file.'
    ]);
  });

  it('composes global CSS before workspace CSS', async () => {
    const workspaceRoot = await makeTempDir();
    const globalPath = path.join(workspaceRoot, 'global.css');
    const workspaceCssPath = path.join(workspaceRoot, 'styles', 'preview.css');
    await fs.mkdir(path.dirname(workspaceCssPath), { recursive: true });
    await fs.writeFile(globalPath, 'body { color: black; }', 'utf8');
    await fs.writeFile(workspaceCssPath, 'body { color: green; }', 'utf8');

    const { security, vscodeMock } = await loadSecurity({
      workspaceRoot,
      globalCustomCssPath: globalPath,
      workspaceCustomCssPath: 'styles/preview.css'
    });
    const result = await security.resolveCustomCss(
      vscodeMock.Uri.file(path.join(workspaceRoot, 'doc.md'))
    );

    expect(result.cssTexts).toEqual([
      'body { color: black; }',
      'body { color: green; }'
    ]);
  });

  it('includes the workspace root in the custom CSS key', async () => {
    const workspaceRootA = await makeTempDir();
    const workspaceRootB = await makeTempDir();
    const cssPath = 'styles/preview.css';

    const { security: securityA, vscodeMock: vscodeMockA } = await loadSecurity(
      {
        workspaceRoot: workspaceRootA,
        workspaceCustomCssPath: cssPath
      }
    );
    const keyA = (
      await securityA.resolveCustomCss(
        vscodeMockA.Uri.file(path.join(workspaceRootA, 'doc.md'))
      )
    ).key;

    const { security: securityB, vscodeMock: vscodeMockB } = await loadSecurity(
      {
        workspaceRoot: workspaceRootB,
        workspaceCustomCssPath: cssPath
      }
    );
    const keyB = (
      await securityB.resolveCustomCss(
        vscodeMockB.Uri.file(path.join(workspaceRootB, 'doc.md'))
      )
    ).key;

    expect(keyA).not.toBe(keyB);
  });

  it('changes the custom CSS key when file contents change at the same path', async () => {
    const workspaceRoot = await makeTempDir();
    const cssPath = path.join(workspaceRoot, 'styles', 'preview.css');

    const { security, vscodeMock } = await loadSecurity({
      workspaceRoot,
      workspaceCustomCssPath: 'styles/preview.css',
      openTextDocuments: [{ fsPath: cssPath, text: 'body { color: red; }' }]
    });
    const first = await security.resolveCustomCss(
      vscodeMock.Uri.file(path.join(workspaceRoot, 'doc.md'))
    );

    const { security: updatedSecurity, vscodeMock: updatedVscodeMock } =
      await loadSecurity({
        workspaceRoot,
        workspaceCustomCssPath: 'styles/preview.css',
        openTextDocuments: [{ fsPath: cssPath, text: 'body { color: blue; }' }]
      });
    const second = await updatedSecurity.resolveCustomCss(
      updatedVscodeMock.Uri.file(path.join(workspaceRoot, 'doc.md'))
    );

    expect(first.key).not.toBe(second.key);
    expect(first.cssTexts).toEqual(['body { color: red; }']);
    expect(second.cssTexts).toEqual(['body { color: blue; }']);
  });

  it('changes the custom CSS key when a missing file later appears', async () => {
    const workspaceRoot = await makeTempDir();
    const cssPath = path.join(workspaceRoot, 'styles', 'preview.css');

    const { security, vscodeMock, warnings } = await loadSecurity({
      workspaceRoot,
      workspaceCustomCssPath: 'styles/preview.css'
    });
    const first = await security.resolveCustomCss(
      vscodeMock.Uri.file(path.join(workspaceRoot, 'doc.md'))
    );
    expect(first.cssTexts).toEqual([]);
    expect(warnings).toEqual([
      'Could not read custom CSS file: styles/preview.css'
    ]);

    await fs.mkdir(path.dirname(cssPath), { recursive: true });
    await fs.writeFile(cssPath, 'body { color: green; }', 'utf8');

    const { security: updatedSecurity, vscodeMock: updatedVscodeMock } =
      await loadSecurity({
        workspaceRoot,
        workspaceCustomCssPath: 'styles/preview.css'
      });
    const second = await updatedSecurity.resolveCustomCss(
      updatedVscodeMock.Uri.file(path.join(workspaceRoot, 'doc.md'))
    );

    expect(first.key).not.toBe(second.key);
    expect(second.cssTexts).toEqual(['body { color: green; }']);
  });
});
