import { beforeAll, describe, expect, it, vi } from 'vitest';

let security: any;

beforeAll(async () => {
  vi.doMock('vscode', () => ({ workspace: { getConfiguration: () => ({}) } }));
  security = await import('../../src/extension/preview/markdown/security');
});

describe('security helpers', () => {
  it('builds a strict CSP with no remote connect and no unsafe-eval', () => {
    const csp = security.buildWebviewCsp('vscode-webview://x', 'abc');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('img-src vscode-webview://x data: blob:');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("script-src 'nonce-abc'");
  });

  it('can allow remote images without opening remote connect', () => {
    const csp = security.buildWebviewCsp('vscode-webview://x', 'abc', { allowRemoteImages: true });
    expect(csp).toContain('img-src vscode-webview://x data: blob: https: http:');
    expect(csp).toContain("connect-src 'none'");
  });

  it('generates unique nonces', () => {
    expect(security.createNonce()).not.toBe(security.createNonce());
  });
});
