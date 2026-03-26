export interface HtmlAttribute {
  name: string;
  value?: string;
  originalValue?: string;
  quote?: '"' | "'";
  changed?: boolean;
}

export interface HtmlSrcsetCandidate {
  url: string;
  descriptor?: string;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeHtmlAttribute(value: string): string {
  const decodeCodePoint = (codePoint: number, raw: string): string => {
    if (
      Number.isNaN(codePoint) ||
      codePoint < 0 ||
      codePoint > 0x10ffff
    ) {
      return raw;
    }

    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return raw;
    }
  };

  return value.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|amp|quot|apos|lt|gt);/g,
    (match, numeric, hex) => {
      if (numeric) {
        const codePoint = Number.parseInt(numeric, 10);
        return decodeCodePoint(codePoint, match);
      }

      if (hex) {
        const codePoint = Number.parseInt(hex, 16);
        return decodeCodePoint(codePoint, match);
      }

      switch (match) {
        case '&amp;':
          return '&';
        case '&quot;':
          return '"';
        case '&apos;':
          return "'";
        case '&lt;':
          return '<';
        case '&gt;':
          return '>';
        default:
          return match;
      }
    }
  );
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
    const quote = match[2] !== undefined ? '"' : match[3] !== undefined ? "'" : undefined;
    const originalValue = match[2] ?? match[3] ?? match[4];
    const value =
      originalValue === undefined
        ? undefined
        : decodeHtmlAttribute(originalValue);
    attributes.push(
      value === undefined
        ? { name }
        : { name, value, originalValue, quote, changed: false }
    );
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
    .map((attr) => {
      if (attr.value === undefined) {
        return ` ${attr.name}`;
      }

      if (!attr.changed && attr.originalValue !== undefined) {
        if (attr.quote) {
          return ` ${attr.name}=${attr.quote}${attr.originalValue}${attr.quote}`;
        }
        return ` ${attr.name}=${attr.originalValue}`;
      }

      return ` ${attr.name}="${escapeHtmlAttribute(attr.value)}"`;
    })
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
    existing.originalValue = undefined;
    existing.quote = undefined;
    existing.changed = true;
    return;
  }
  attributes.push({ name, value, changed: true });
}

export function getHtmlAttribute(
  attributes: HtmlAttribute[],
  name: string
): HtmlAttribute | undefined {
  return attributes.find(
    (attr) => attr.name.toLowerCase() === name.toLowerCase()
  );
}

export function parseHtmlSrcset(value: string): HtmlSrcsetCandidate[] {
  const candidates: HtmlSrcsetCandidate[] = [];
  let index = 0;

  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index])) {
      index += 1;
    }
    if (index >= value.length) {
      break;
    }

    const urlStart = index;
    while (index < value.length && !/[\s,]/.test(value[index])) {
      index += 1;
    }

    const url = value.slice(urlStart, index);
    const descriptorStart = index;
    while (index < value.length && value[index] !== ',') {
      index += 1;
    }

    const descriptor = value.slice(descriptorStart, index).trim();
    if (url) {
      candidates.push({
        url,
        descriptor: descriptor || undefined
      });
    }

    if (value[index] === ',') {
      index += 1;
    }
  }

  return candidates;
}

export function serializeHtmlSrcset(
  candidates: HtmlSrcsetCandidate[]
): string {
  return candidates
    .map((candidate) =>
      candidate.descriptor
        ? `${candidate.url} ${candidate.descriptor}`
        : candidate.url
    )
    .join(', ');
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

function findHtmlImgTagStart(html: string, fromIndex: number): number {
  let insideTag = false;
  let quote: '"' | "'" | undefined;

  for (let index = fromIndex; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (insideTag) {
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        insideTag = false;
      }
      continue;
    }

    if (char !== '<') {
      continue;
    }

    if (/^<img\b/i.test(html.slice(index))) {
      return index;
    }

    insideTag = true;
  }

  return -1;
}

function mapHtmlImgTagsInternal<T extends string | Promise<string>>(
  html: string,
  transform: (tag: string) => T
): T | string {
  let nextIndex = 0;
  let result = '';
  let start = findHtmlImgTagStart(html, nextIndex);

  while (start >= 0) {
    const end = findHtmlImgTagEnd(html, start + 4);
    if (end < 0) {
      break;
    }

    result += html.slice(nextIndex, start);
    nextIndex = end + 1;
    const tag = html.slice(start, nextIndex);
    const mapped = transform(tag);
    if (typeof mapped === 'string') {
      result += mapped;
      start = findHtmlImgTagStart(html, nextIndex);
      continue;
    }

    return (async () => {
      let asyncResult = result + (await mapped);
      let asyncStart = findHtmlImgTagStart(html, nextIndex);

      while (asyncStart >= 0) {
        const asyncEnd = findHtmlImgTagEnd(html, asyncStart + 4);
        if (asyncEnd < 0) {
          break;
        }

        asyncResult += html.slice(nextIndex, asyncStart);
        nextIndex = asyncEnd + 1;
        const asyncTag = html.slice(asyncStart, nextIndex);
        asyncResult += await transform(asyncTag);
        asyncStart = findHtmlImgTagStart(html, nextIndex);
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
