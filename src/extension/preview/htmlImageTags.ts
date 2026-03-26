export interface HtmlAttribute {
  name: string;
  value?: string;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function parseHtmlImgTag(tag: string): {
  attributes: HtmlAttribute[];
  selfClosing: boolean;
} | null {
  if (!/^<img\b/i.test(tag)) {
    return null;
  }

  const body = tag.replace(/^<img\b/i, '').replace(/\s*\/?>$/, '');
  const attributes: HtmlAttribute[] = [];
  const attrPattern =
    /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  for (const match of body.matchAll(attrPattern)) {
    const name = match[1];
    const value = match[2] ?? match[3] ?? match[4];
    attributes.push(value === undefined ? { name } : { name, value });
  }

  return {
    attributes,
    selfClosing: /\/\s*>$/.test(tag)
  };
}

export function serializeHtmlImgTag(
  attributes: HtmlAttribute[],
  selfClosing: boolean
): string {
  const renderedAttrs = attributes
    .map((attr) =>
      attr.value === undefined
        ? ` ${attr.name}`
        : ` ${attr.name}="${escapeHtmlAttribute(attr.value)}"`
    )
    .join('');
  return `<img${renderedAttrs}${selfClosing ? ' />' : '>'}`;
}

export function setHtmlAttribute(
  attributes: HtmlAttribute[],
  name: string,
  value: string
): void {
  const existing = attributes.find(
    (attr) => attr.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    existing.name = name;
    existing.value = value;
    return;
  }
  attributes.push({ name, value });
}

export function getHtmlAttribute(
  attributes: HtmlAttribute[],
  name: string
): HtmlAttribute | undefined {
  return attributes.find(
    (attr) => attr.name.toLowerCase() === name.toLowerCase()
  );
}

function findHtmlImgTagEnd(html: string, fromIndex: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = fromIndex; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') {
      return index;
    }
  }

  return -1;
}

function mapHtmlImgTagsInternal<T extends string | Promise<string>>(
  html: string,
  transform: (tag: string) => T
): T | string {
  const startPattern = /<img\b/gi;
  let nextIndex = 0;
  let result = '';
  let match: RegExpExecArray | null;

  while ((match = startPattern.exec(html))) {
    const start = match.index;
    const end = findHtmlImgTagEnd(html, startPattern.lastIndex);
    if (end < 0) {
      break;
    }

    result += html.slice(nextIndex, start);
    nextIndex = end + 1;
    const tag = html.slice(start, nextIndex);
    const mapped = transform(tag);
    if (typeof mapped === 'string') {
      result += mapped;
      startPattern.lastIndex = nextIndex;
      continue;
    }

    return (async () => {
      let asyncResult = result + (await mapped);
      startPattern.lastIndex = nextIndex;

      while ((match = startPattern.exec(html))) {
        const asyncStart = match.index;
        const asyncEnd = findHtmlImgTagEnd(html, startPattern.lastIndex);
        if (asyncEnd < 0) {
          break;
        }

        asyncResult += html.slice(nextIndex, asyncStart);
        nextIndex = asyncEnd + 1;
        const asyncTag = html.slice(asyncStart, nextIndex);
        asyncResult += await transform(asyncTag);
        startPattern.lastIndex = nextIndex;
      }

      return asyncResult + html.slice(nextIndex);
    })() as T;
  }

  return result + html.slice(nextIndex);
}

export function mapHtmlImgTags(
  html: string,
  transform: (tag: string) => string
): string {
  return mapHtmlImgTagsInternal(html, transform);
}

export async function mapHtmlImgTagsAsync(
  html: string,
  transform: (tag: string) => Promise<string>
): Promise<string> {
  return mapHtmlImgTagsInternal(html, transform);
}
