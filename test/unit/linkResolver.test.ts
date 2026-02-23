import { beforeAll, describe, expect, it, vi } from 'vitest';

let api: any;
let Uri: any;

beforeAll(async () => {
  const mock = await import('./helpers/vscodeMock');
  Uri = mock.Uri;
  vi.doMock('vscode', () => mock.createVscodeMock('/workspace'));
  api = await import('../../src/extension/preview/markdown/linkResolver');
});

describe('linkResolver', () => {
  it('classifies heading and external links', () => {
    const source = Uri.file('/workspace/docs/a.md');
    expect(api.resolveLinkTarget(source as any, '#intro')).toMatchObject({ kind: 'heading', fragment: 'intro' });
    expect(api.resolveLinkTarget(source as any, 'https://example.com')).toMatchObject({ kind: 'external' });
  });

  it('resolves workspace relative links and fragments', () => {
    const source = Uri.file('/workspace/docs/a.md');
    const resolved = api.resolveLinkTarget(source as any, '../b.md#part');
    expect(resolved.kind).toBe('workspace');
    expect(resolved.fragment).toBe('part');
  });

  it('blocks preview image resolution outside workspace', () => {
    const source = Uri.file('/workspace/docs/a.md');
    expect(api.resolveImageUri(source as any, '../../secret.png')).toBeUndefined();
  });
});
