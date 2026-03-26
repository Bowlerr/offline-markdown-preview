import { describe, expect, it } from 'vitest';

import {
  mapHtmlImgTags,
  parseHtmlSrcset
} from '../../src/extension/preview/htmlImageTags';

describe('htmlImageTags', () => {
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
});
