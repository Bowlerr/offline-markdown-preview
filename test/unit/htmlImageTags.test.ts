import { describe, expect, it } from 'vitest';

import {
  mapHtmlImgTags,
  parseHtmlSrcset
} from '../../src/extension/preview/htmlImageTags';

describe('htmlImageTags', () => {
  it('skips img tags inside HTML comments', () => {
    const html =
      '<!-- note > <img src="images/commented.png" alt="commented" /> --><p><img src="images/rendered.png" alt="rendered" /></p>';

    const result = mapHtmlImgTags(html, (tag) => `[${tag}]`);

    expect(result).toContain(
      '<!-- note > <img src="images/commented.png" alt="commented" /> -->'
    );
    expect(result).toContain(
      '<p>[<img src="images/rendered.png" alt="rendered" />]</p>'
    );
  });

  it('skips img tags nested inside inert HTML containers', () => {
    const html = [
      '<template><img src="images/template.png" alt="template" /></template>',
      '<noscript><img src="images/noscript.png" alt="noscript" /></noscript>',
      '<p><img src="images/rendered.png" alt="rendered" /></p>'
    ].join('');

    const result = mapHtmlImgTags(html, (tag) => `[${tag}]`);

    expect(result).toContain(
      '<template><img src="images/template.png" alt="template" /></template>'
    );
    expect(result).toContain(
      '<noscript><img src="images/noscript.png" alt="noscript" /></noscript>'
    );
    expect(result).toContain(
      '<p>[<img src="images/rendered.png" alt="rendered" />]</p>'
    );
  });

  it('preserves inline SVG data URIs inside srcset candidates', () => {
    const srcset =
      'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg> 1x, images/scroll@2x.gif 2x';

    expect(parseHtmlSrcset(srcset)).toEqual([
      {
        url:
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
        descriptor: '1x'
      },
      {
        url: 'images/scroll@2x.gif',
        descriptor: '2x'
      }
    ]);
  });

  it('preserves commas that are part of non-data srcset URLs', () => {
    const srcset =
      'images/scroll,final.gif 1x, https://example.com/scroll.gif?sig=a,b 2x';

    expect(parseHtmlSrcset(srcset)).toEqual([
      {
        url: 'images/scroll,final.gif',
        descriptor: '1x'
      },
      {
        url: 'https://example.com/scroll.gif?sig=a,b',
        descriptor: '2x'
      }
    ]);
  });

  it('splits comma-separated candidates even when no whitespace follows the comma', () => {
    const srcset = 'small.jpg,large.jpg 2x';

    expect(parseHtmlSrcset(srcset)).toEqual([
      {
        url: 'small.jpg'
      },
      {
        url: 'large.jpg',
        descriptor: '2x'
      }
    ]);
  });

  it('splits compact root-relative candidates without file extensions', () => {
    const srcset = '/image?id=1,/image?id=2 2x';

    expect(parseHtmlSrcset(srcset)).toEqual([
      {
        url: '/image?id=1'
      },
      {
        url: '/image?id=2',
        descriptor: '2x'
      }
    ]);
  });

  it('splits compact protocol-relative candidates without file extensions', () => {
    const srcset = '//cdn.example.com/a,//cdn.example.com/b 2x';

    expect(parseHtmlSrcset(srcset)).toEqual([
      {
        url: '//cdn.example.com/a'
      },
      {
        url: '//cdn.example.com/b',
        descriptor: '2x'
      }
    ]);
  });

  it('preserves commas in root-relative URLs when the right side is not another root-relative candidate', () => {
    const srcset = '/api/image,retina 2x';

    expect(parseHtmlSrcset(srcset)).toEqual([
      {
        url: '/api/image,retina',
        descriptor: '2x'
      }
    ]);
  });

  it('preserves commas inside absolute http srcset URLs', () => {
    const srcset =
      'https://cdn.example.com/demo,retina.gif 2x, https://cdn.example.com/demo@3x.gif 3x';

    expect(parseHtmlSrcset(srcset)).toEqual([
      {
        url: 'https://cdn.example.com/demo,retina.gif',
        descriptor: '2x'
      },
      {
        url: 'https://cdn.example.com/demo@3x.gif',
        descriptor: '3x'
      }
    ]);
  });

  it('preserves commas inside file srcset URLs', () => {
    const srcset =
      'file:///tmp/demo,retina.gif 2x, file:///tmp/demo@3x.gif 3x';

    expect(parseHtmlSrcset(srcset)).toEqual([
      {
        url: 'file:///tmp/demo,retina.gif',
        descriptor: '2x'
      },
      {
        url: 'file:///tmp/demo@3x.gif',
        descriptor: '3x'
      }
    ]);
  });
});
