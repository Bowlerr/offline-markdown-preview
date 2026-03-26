import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createVscodeMock } from './helpers/vscodeMock';

type SecurityModule =
  typeof import('../../src/extension/preview/markdown/security');

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'omv-security-'));
  tempDirs.push(dir);
  return dir;
}

function createConfiguredVscodeMock(options: {
  workspaceRoot?: string;
  globalCustomCssPath?: string;
  workspaceCustomCssPath?: string;
  warnings: string[];
}) {
  const base = createVscodeMock(options.workspaceRoot);

  return {
    ...base,
    workspace: {
      ...base.workspace,
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
                workspaceFolderValue: options.workspaceCustomCssPath as
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
    globalCustomCssPath?: string;
    workspaceCustomCssPath?: string;
  } = {}
): Promise<{
  security: SecurityModule;
  vscodeMock: ReturnType<typeof createConfiguredVscodeMock>;
  warnings: string[];
}> {
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

    expect(result.cssText).toBeUndefined();
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

    expect(result.cssText).toBe('body { color: red; }');
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

    expect(result.cssText).toBeUndefined();
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

    expect(result.cssText).toBe('.markdown-body { max-width: 960px; }');
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

    expect(result.cssText).toBeUndefined();
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

    expect(result.cssText).toBeUndefined();
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

    expect(result.cssText).toBe(
      'body { color: black; }\n\nbody { color: green; }'
    );
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
    const keyA = securityA.getCustomCssKey(
      vscodeMockA.Uri.file(path.join(workspaceRootA, 'doc.md'))
    );

    const { security: securityB, vscodeMock: vscodeMockB } = await loadSecurity(
      {
        workspaceRoot: workspaceRootB,
        workspaceCustomCssPath: cssPath
      }
    );
    const keyB = securityB.getCustomCssKey(
      vscodeMockB.Uri.file(path.join(workspaceRootB, 'doc.md'))
    );

    expect(keyA).not.toBe(keyB);
  });
});
