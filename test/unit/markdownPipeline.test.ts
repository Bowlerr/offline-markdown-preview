import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let renderMarkdown: any;
let Uri: any;
const statSyncMock = vi.fn(() => {
  throw new Error('ENOENT');
});

beforeAll(async () => {
  const mock = await import('./helpers/vscodeMock');
  Uri = mock.Uri;
  vi.doMock('vscode', () => mock.createVscodeMock('/workspace'));
  vi.doMock('node:fs', () => ({
    statSync: statSyncMock
  }));
  ({ renderMarkdown } = await import('../../src/extension/preview/markdown/markdownPipeline'));
});

beforeEach(() => {
  statSyncMock.mockImplementation(() => {
    throw new Error('ENOENT');
  });
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
    expect(result.html).toContain('data-local-src="file:///workspace/docs/pic.png"');
    expect(result.html).toContain(
      'src="vscode-webview://file:///workspace/docs/pic.png"'
    );
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

  it('rewrites local raw HTML img tags to webview URIs', () => {
    const sourceUri = Uri.file('/workspace/docs/readme.md');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const input = [
      '<table>',
      '  <tr>',
      '    <td><img src="images/scroll.gif" alt="demo" /></td>',
      '  </tr>',
      '</table>'
    ].join('\n');

    const result = renderMarkdown(input, {
      sourceUri,
      webview: webview as any,
      allowHtml: true,
      allowRemoteImages: false,
      maxImageMB: 100
    });

    expect(result.html).toContain(
      'src="vscode-webview://file:///workspace/docs/images/scroll.gif"'
    );
    expect(result.html).toContain(
      'data-local-src="file:///workspace/docs/images/scroll.gif"'
    );
    expect(result.html).toContain('loading="lazy"');
  });

  it('rewrites raw HTML img tags when quoted attributes contain >', () => {
    const sourceUri = Uri.file('/workspace/docs/readme.md');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const result = renderMarkdown('<img src="images/scroll.gif" alt="a > b" />', {
      sourceUri,
      webview: webview as any,
      allowHtml: true,
      allowRemoteImages: false,
      maxImageMB: 100
    });

    expect(result.html).toContain(
      'src="vscode-webview://file:///workspace/docs/images/scroll.gif"'
    );
    expect(result.html).toContain('alt="a > b"');
    expect(result.html).toContain(
      'data-local-src="file:///workspace/docs/images/scroll.gif"'
    );
  });

  it('preserves local export metadata for size-blocked raw HTML images', () => {
    statSyncMock.mockReturnValue({ size: 101 * 1024 * 1024 });

    const sourceUri = Uri.file('/workspace/docs/readme.md');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const result = renderMarkdown(
      '<img src="images/scroll.gif" alt="demo" srcset="images/scroll.gif 1x, images/scroll@2x.gif 2x" />',
      {
        sourceUri,
        webview: webview as any,
        allowHtml: true,
        allowRemoteImages: false,
        maxImageMB: 100
      }
    );

    expect(result.html).toContain(
      'data-local-src="file:///workspace/docs/images/scroll.gif"'
    );
    expect(result.html).toContain('data-image-blocked="size-limit"');
    expect(result.html).toContain('src=""');
    expect(result.html).toContain('srcset=""');
    expect(result.html).toContain(
      'data-export-srcset="file:///workspace/docs/images/scroll.gif 1x, file:///workspace/docs/images/scroll@2x.gif 2x"'
    );
  });

  it('rewrites raw HTML srcset candidates and preserves export srcset', () => {
    const sourceUri = Uri.file('/workspace/docs/readme.md');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const result = renderMarkdown(
      '<img src="images/scroll.gif" srcset="images/scroll.gif 1x, images/scroll@2x.gif 2x" />',
      {
        sourceUri,
        webview: webview as any,
        allowHtml: true,
        allowRemoteImages: false,
        maxImageMB: 100
      }
    );

    expect(result.html).toContain(
      'srcset="vscode-webview://file:///workspace/docs/images/scroll.gif 1x, vscode-webview://file:///workspace/docs/images/scroll@2x.gif 2x"'
    );
    expect(result.html).toContain(
      'data-export-srcset="file:///workspace/docs/images/scroll.gif 1x, file:///workspace/docs/images/scroll@2x.gif 2x"'
    );
  });

  it('preserves existing HTML entities when raw img tags are rewritten', () => {
    const sourceUri = Uri.file('/workspace/docs/readme.md');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const result = renderMarkdown(
      '<img src="https://example.com/image.gif?a=1&amp;b=2" alt="AT&amp;T" />',
      {
        sourceUri,
        webview: webview as any,
        allowHtml: true,
        allowRemoteImages: true,
        maxImageMB: 100
      }
    );

    expect(result.html).toContain(
      'src="https://example.com/image.gif?a=1&amp;b=2"'
    );
    expect(result.html).toContain('alt="AT&amp;T"');
    expect(result.html).not.toContain('&amp;amp;');
  });

  it('clears remote raw HTML srcset when remote images are disabled', () => {
    const sourceUri = Uri.file('/workspace/docs/readme.md');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const result = renderMarkdown(
      '<img src="https://example.com/image.gif" srcset="https://example.com/image.gif 1x, https://example.com/image@2x.gif 2x" />',
      {
        sourceUri,
        webview: webview as any,
        allowHtml: true,
        allowRemoteImages: false,
        maxImageMB: 100
      }
    );

    expect(result.html).toContain(
      'data-remote-src="https://example.com/image.gif"'
    );
    expect(result.html).toContain('src=""');
    expect(result.html).toContain('srcset=""');
    expect(result.html).toContain(
      'data-export-srcset="https://example.com/image.gif 1x, https://example.com/image@2x.gif 2x"'
    );
  });

  it('rewrites raw HTML srcset when a remote image override exists', () => {
    const sourceUri = Uri.file('/workspace/docs/readme.md');
    const cachedUri = Uri.file('/workspace/.omv-cache/image.gif');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const result = renderMarkdown(
      '<img src="https://example.com/image.gif" srcset="https://example.com/image.gif 1x, https://example.com/image@2x.gif 2x" />',
      {
        sourceUri,
        webview: webview as any,
        allowHtml: true,
        allowRemoteImages: false,
        remoteImageOverrides: new Map([
          ['https://example.com/image.gif', cachedUri]
        ]),
        maxImageMB: 100
      }
    );

    expect(result.html).toContain(
      'src="vscode-webview://file:///workspace/.omv-cache/image.gif"'
    );
    expect(result.html).toContain(
      'srcset="vscode-webview://file:///workspace/.omv-cache/image.gif 1x"'
    );
    expect(result.html).toContain(
      'data-export-srcset="file:///workspace/.omv-cache/image.gif 1x, https://example.com/image@2x.gif 2x"'
    );
  });

  it('ignores img-like text inside other HTML attribute values', () => {
    const sourceUri = Uri.file('/workspace/docs/readme.md');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const result = renderMarkdown(
      `<div data-template="<img src='images/scroll.gif' alt='demo'>" data-kind="example"></div>`,
      {
        sourceUri,
        webview: webview as any,
        allowHtml: true,
        allowRemoteImages: false,
        maxImageMB: 100
      }
    );

    expect(result.html).toContain(
      `data-template="<img src='images/scroll.gif' alt='demo'>"`
    );
    expect(result.html).not.toContain('data-local-src=');
    expect(result.html).toContain('data-kind="example"');
  });

  it('does not rewrite img-like text inside raw-text HTML elements', () => {
    const sourceUri = Uri.file('/workspace/docs/readme.md');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const input = [
      '<textarea><img src="images/scroll.gif" alt="demo" /></textarea>',
      '<script type="application/json">{"html":"<img src=\\"images/scroll.gif\\" alt=\\"demo\\" />"}</script>'
    ].join('\n');

    const result = renderMarkdown(input, {
      sourceUri,
      webview: webview as any,
      allowHtml: true,
      allowRemoteImages: false,
      maxImageMB: 100
    });

    expect(result.html).toContain(
      '<textarea><img src="images/scroll.gif" alt="demo" /></textarea>'
    );
    expect(result.html).toContain(
      '<script type="application/json">{"html":"<img src=\\"images/scroll.gif\\" alt=\\"demo\\" />"}</script>'
    );
    expect(result.html).not.toContain('data-local-src=');
  });

  it('preserves blocked remote srcset candidates for export metadata', () => {
    const sourceUri = Uri.file('/workspace/docs/readme.md');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const result = renderMarkdown(
      '<img src="images/scroll.gif" srcset="images/scroll.gif 1x, https://cdn.example.com/scroll@2x.gif 2x" />',
      {
        sourceUri,
        webview: webview as any,
        allowHtml: true,
        allowRemoteImages: false,
        maxImageMB: 100
      }
    );

    expect(result.html).toContain(
      'srcset="vscode-webview://file:///workspace/docs/images/scroll.gif 1x"'
    );
    expect(result.html).toContain(
      'data-export-srcset="file:///workspace/docs/images/scroll.gif 1x, https://cdn.example.com/scroll@2x.gif 2x"'
    );
  });

  it('preserves data URL srcset candidates when rewriting raw HTML images', () => {
    const sourceUri = Uri.file('/workspace/docs/readme.md');
    const webview = {
      asWebviewUri(uri: { toString(): string }) {
        return { toString: () => `vscode-webview://${uri.toString()}` };
      }
    };

    const result = renderMarkdown(
      '<img src="images/scroll.gif" srcset="data:image/svg+xml;base64,PHN2Zy8+ 1x, images/scroll@2x.gif 2x" />',
      {
        sourceUri,
        webview: webview as any,
        allowHtml: true,
        allowRemoteImages: false,
        maxImageMB: 100
      }
    );

    expect(result.html).toContain(
      'srcset="data:image/svg+xml;base64,PHN2Zy8+ 1x, vscode-webview://file:///workspace/docs/images/scroll@2x.gif 2x"'
    );
    expect(result.html).toContain(
      'data-export-srcset="data:image/svg+xml;base64,PHN2Zy8+ 1x, file:///workspace/docs/images/scroll@2x.gif 2x"'
    );
  });
});
