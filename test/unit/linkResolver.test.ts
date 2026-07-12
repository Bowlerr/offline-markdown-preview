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
    expect(api.resolveImageUri(source as any, '%2e%2e/%2e%2e/secret.png')).toBeUndefined();
  });

  it.each([
    ['name%20with%20spaces.png', '/workspace/docs/name with spaces.png'],
    ['name%20with%20multiple%20spaces.png', '/workspace/docs/name with multiple spaces.png'],
    ['status%20%28final%29.png', '/workspace/docs/status (final).png'],
    ['section%23one.png', '/workspace/docs/section#one.png'],
    ['question%3Fmark.png', '/workspace/docs/question?mark.png'],
    ['plain.png', '/workspace/docs/plain.png'],
    ['nested/images/name%20with%20spaces.png', '/workspace/docs/nested/images/name with spaces.png'],
    ['progress%25100.png', '/workspace/docs/progress%100.png']
  ])('decodes local image URI path segments once: %s', (src, expectedPath) => {
    const source = Uri.file('/workspace/docs/a.md');
    const resolved = api.resolveImageUri(source as any, src);

    expect(resolved?.fsPath).toBe(expectedPath);
  });

  it('does not decode local image paths twice', () => {
    const source = Uri.file('/workspace/docs/a.md');
    const resolved = api.resolveImageUri(source as any, 'literal%2520name.png');

    expect(resolved?.fsPath).toBe('/workspace/docs/literal%20name.png');
  });

  it('resolves encoded file URIs through VS Code URI parsing', () => {
    const source = Uri.file('/workspace/docs/a.md');
    const resolved = api.resolveImageUri(
      source as any,
      'file:///workspace/docs/name%20with%20spaces.png'
    );

    expect(resolved?.fsPath).toBe('/workspace/docs/name with spaces.png');
  });

  it.each([
    'nested%2Fsecret.png',
    'nested%5Csecret.png',
    'file:///workspace/docs/nested%2Fsecret.png',
    'file:///workspace/docs/nested%5Csecret.png',
    'malformed%E0%A4%A.png'
  ])('rejects unsafe or malformed local image encoding without throwing: %s', (src) => {
    const source = Uri.file('/workspace/docs/a.md');

    expect(() => api.resolveImageUri(source as any, src)).not.toThrow();
    expect(api.resolveImageUri(source as any, src)).toBeUndefined();
  });

  it('keeps remote HTTP image URLs out of local resolution', () => {
    const source = Uri.file('/workspace/docs/a.md');

    expect(api.resolveImageUri(source as any, 'http://example.com/name%20one.png')).toBeUndefined();
    expect(api.resolveImageUri(source as any, 'https://example.com/name%20two.png')).toBeUndefined();
  });

  it('strips query strings and fragments before resolving local image paths', () => {
    const source = Uri.file('/workspace/docs/a.md');

    expect(api.resolveImageUri(source as any, './demo.gif?v=1#preview')?.toString()).toBe(
      'file:///workspace/docs/demo.gif'
    );
    expect(
      api.resolveImageUri(
        source as any,
        'file:///workspace/docs/demo@2x.gif?cache=1#retina'
      )?.toString()
    ).toBe('file:///workspace/docs/demo@2x.gif');
    expect(
      api.resolveImageUri(
        source as any,
        './icons%23set.svg?cache=1#logo'
      )?.toString()
    ).toBe('file:///workspace/docs/icons%23set.svg#logo');
  });

  it('preserves SVG fragments in resolved local image URIs', () => {
    const source = Uri.file('/workspace/docs/a.md');

    expect(
      api.resolveImageUri(source as any, './icons.svg?v=1#logo')?.toString()
    ).toBe('file:///workspace/docs/icons.svg#logo');
    expect(
      api.resolveImageUri(
        source as any,
        'file:///workspace/docs/icons.svg?cache=1#logo'
      )?.toString()
    ).toBe('file:///workspace/docs/icons.svg#logo');
  });
});
