import { describe, expect, it } from 'vitest';

import {
  parseExtensionMessage,
  parseWebviewMessage
} from '../../src/extension/messaging/validate';

describe('messaging validation', () => {
  it('accepts valid webview messages', () => {
    const msg = parseWebviewMessage({ type: 'previewScroll', percent: 0.5 });
    expect(msg).toMatchObject({ type: 'previewScroll', percent: 0.5 });
  });

  it('rejects invalid webview message payloads', () => {
    expect(() =>
      parseWebviewMessage({ type: 'previewScroll', percent: 2 })
    ).toThrow();
  });

  it('accepts HTML export snapshots with theme variables', () => {
    const msg = parseWebviewMessage({
      type: 'htmlExportSnapshot',
      requestId: 1,
      html: '<p>Rendered</p>',
      themeVariables: {
        '--omv-active-pre-bg': 'rgb(1, 2, 3)',
        '--omv-mermaid-border': 'rgb(4, 5, 6)'
      }
    });
    expect(msg).toMatchObject({
      type: 'htmlExportSnapshot',
      requestId: 1,
      html: '<p>Rendered</p>'
    });
  });

  it('accepts preview UI state change messages', () => {
    const msg = parseWebviewMessage({
      type: 'uiStateChanged',
      searchUiVisible: false,
      tocVisible: true
    });
    expect(msg).toMatchObject({
      type: 'uiStateChanged',
      searchUiVisible: false,
      tocVisible: true
    });
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
        showFrontmatter: false,
        githubMarkdownStyle: {
          enabled: true,
          colorMode: 'light',
          lightTheme: 'light',
          darkTheme: 'dark'
        }
      }
    });
    expect(msg.type).toBe('render');
  });

  it('accepts custom CSS update messages', () => {
    const msg = parseExtensionMessage({
      type: 'updateCustomCss',
      cssTexts: ['.omv-content { color: red; }']
    });
    expect(msg).toMatchObject({
      type: 'updateCustomCss',
      cssTexts: ['.omv-content { color: red; }']
    });
  });
});
