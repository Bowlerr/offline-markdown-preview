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
      allowRemoteImages: false,
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

  it('parses inline and multiline display math placeholders', () => {
    const sourceUri = Uri.file('/workspace/docs/math.md');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const input = [
      'Inline: $a^2+b^2=c^2$, $e^{i\\pi}+1=0$, $\\alpha+\\beta+\\gamma=\\pi$.',
      '',
      '$$ \\int_0^1 x^2\\,dx = \\frac{1}{3} $$',
      '',
      '$$ \\sum_{k=1}^{n} k = \\frac{n(n+1)}{2} $$',
      '',
      '$$',
      '\\begin{aligned}',
      '2x + 3y &= 7 \\\\',
      '4x - y &= 5',
      '\\end{aligned}',
      '$$',
      '',
      '$$',
      'A = \\begin{bmatrix}',
      '1 & 2 & 3 \\\\',
      '0 & 1 & 4 \\\\',
      '5 & 6 & 0',
      '\\end{bmatrix}',
      '$$',
      '',
      '$$',
      'f(x)= \\begin{cases}',
      'x^2, & x < 0 \\\\',
      '\\sin(x), & 0 \\le x < \\pi \\\\',
      '\\ln(x), & x \\ge \\pi',
      '\\end{cases}',
      '$$',
      ''
    ].join('\n');

    const result = renderMarkdown(input, {
      sourceUri,
      webview: webview as any,
      allowHtml: true,
      allowRemoteImages: false,
      maxImageMB: 8
    });

    const encoded = Array.from(result.html.matchAll(/data-math="([^"]+)"/g), (match) =>
      Buffer.from(match[1], 'base64').toString('utf8')
    );

    const inlineCount = (result.html.match(/omv-math-inline/g) ?? []).length;
    const blockCount = (result.html.match(/omv-math-block/g) ?? []).length;

    expect(inlineCount).toBe(3);
    expect(blockCount).toBe(5);
    expect(encoded).toContain('a^2+b^2=c^2');
    expect(encoded).toContain('e^{i\\pi}+1=0');
    expect(encoded).toContain('\\alpha+\\beta+\\gamma=\\pi');
    expect(encoded.some((expr) => expr.includes('\\begin{aligned}') && expr.includes('4x - y &= 5'))).toBe(true);
    expect(encoded.some((expr) => expr.includes('\\begin{bmatrix}') && expr.includes('5 & 6 & 0'))).toBe(true);
    expect(encoded.some((expr) => expr.includes('\\begin{cases}') && expr.includes('\\ln(x), & x \\ge \\pi'))).toBe(
      true
    );
  });

  it('marks remote images for download when remote images are disabled', () => {
    const sourceUri = Uri.file('/workspace/docs/remote.md');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const input = '![remote](https://example.com/image.png)';

    const blocked = renderMarkdown(input, {
      sourceUri,
      webview: webview as any,
      allowHtml: true,
      allowRemoteImages: false,
      maxImageMB: 8
    });
    expect(blocked.html).toContain('data-remote-src="https://example.com/image.png"');
    expect(blocked.html).toContain('data-image-blocked="remote-disabled"');

    const allowed = renderMarkdown(input, {
      sourceUri,
      webview: webview as any,
      allowHtml: true,
      allowRemoteImages: true,
      maxImageMB: 8
    });
    expect(allowed.html).not.toContain('data-remote-src=');
    expect(allowed.html).toContain('src="https://example.com/image.png"');
  });
});
