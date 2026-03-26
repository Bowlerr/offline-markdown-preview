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
