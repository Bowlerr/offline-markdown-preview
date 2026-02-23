import { beforeAll, describe, expect, it, vi } from 'vitest';

let renderMarkdown: any;
let Uri: any;

beforeAll(async () => {
  const mock = await import('./helpers/vscodeMock');
  Uri = mock.Uri;
  vi.doMock('vscode', () => mock.createVscodeMock('/workspace'));
  ({ renderMarkdown } = await import('../../src/extension/preview/markdown/markdownPipeline'));
});

describe('markdownPipeline', () => {
  it('renders toc/frontmatter/mermaid/math placeholders and local image attrs', () => {
    const sourceUri = Uri.file('/workspace/docs/readme.md');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const input = `---\ntitle: Demo\n---\n\n# Title\n\n- [x] task\n\nTerm\n: Definition\n\nInline math $a+b$ and $$c=d$$.\n\n\`\`\`mermaid\ngraph TD; A-->B;\n\`\`\`\n\n\`\`\`math\n\\int_0^1 x dx\n\`\`\`\n\n![img](./pic.png)\n\nFootnote ref[^1]\n\n[^1]: Footnote\n`;

    const result = renderMarkdown(input, {
      sourceUri,
      webview: webview as any,
      allowHtml: true,
      maxImageMB: 8
    });

    expect(result.frontmatter?.data.title).toBe('Demo');
    expect(result.toc[0]).toMatchObject({ id: 'title', text: 'Title' });
    expect(result.html).toContain('omv-mermaid');
    expect(result.html).toContain('data-math=');
    expect(result.html).toContain('data-local-src=');
    expect(result.html).toContain('task-list-item');
    expect(result.html).toContain('<dl>');
    expect(result.html).toContain('footnote');
  });
});
