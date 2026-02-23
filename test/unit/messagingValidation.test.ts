import { describe, expect, it } from 'vitest';

import { parseExtensionMessage, parseWebviewMessage } from '../../src/extension/messaging/validate';

describe('messaging validation', () => {
  it('accepts valid webview messages', () => {
    const msg = parseWebviewMessage({ type: 'previewScroll', percent: 0.5 });
    expect(msg).toMatchObject({ type: 'previewScroll', percent: 0.5 });
  });

  it('rejects invalid webview message payloads', () => {
    expect(() => parseWebviewMessage({ type: 'previewScroll', percent: 2 })).toThrow();
  });

  it('accepts valid extension render message', () => {
    const msg = parseExtensionMessage({
      type: 'render',
      requestId: 1,
      documentUri: 'file:///a.md',
      version: 3,
      html: '<h1 id="a">A</h1>',
      toc: [{ id: 'a', level: 1, text: 'A', line: 0 }],
      editorLineCount: 1,
      settings: {
        enableMermaid: true,
        enableMath: true,
        scrollSync: true,
        sanitizeHtml: true,
        showFrontmatter: false
      }
    });
    expect(msg.type).toBe('render');
  });
});
