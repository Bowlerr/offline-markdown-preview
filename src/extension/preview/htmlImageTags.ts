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

function isValidSrcsetDescriptorSequence(value: string): boolean {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }

  let sawDensity = false;
  let sawWidth = false;
  let sawHeight = false;

  for (const token of tokens) {
    if (/^\d+w$/i.test(token)) {
      if (sawDensity || sawWidth) {
        return false;
      }
      sawWidth = true;
      continue;
    }

    if (/^\d+h$/i.test(token)) {
      if (sawDensity || sawHeight) {
        return false;
      }
      sawHeight = true;
      continue;
    }

    if (/^(?:\d+|\d*\.\d+)x$/i.test(token)) {
      if (sawDensity || sawWidth || sawHeight) {
        return false;
      }
      sawDensity = true;
      continue;
    }

    return false;
  }

  return true;
}

function looksLikeSrcsetUrlStart(value: string): boolean {
  const match = /^\s*([^,\s]+)/.exec(value);
  if (!match) {
    return false;
  }

  return !/[<>"'=]/.test(match[1]);
}

function looksLikeStandaloneSrcsetUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /[\s,]/.test(trimmed)) {
    return false;
  }

  return (
    /^(?:https?:|file:)/i.test(trimmed) ||
    /^[^/?#,\s]+\.[a-z0-9]{1,8}(?:[?#][^,\s]*)?$/i.test(trimmed) ||
    /\/[^/?#,\s]+\.[a-z0-9]{1,8}(?:[?#][^,\s]*)?$/i.test(trimmed)
  );
}

function findImplicitSrcsetCandidateSplit(
  url: string,
  descriptor?: string
): number {
  if (!descriptor || !isValidSrcsetDescriptorSequence(descriptor)) {
    return -1;
  }

  const normalizedUrl = url.trim();
  const requiresAbsoluteRightCandidate = /^(?:https?:|file:)/i.test(
    normalizedUrl
  );

  for (let index = 0; index < url.length; index += 1) {
    if (url[index] !== ',') {
      continue;
    }

    const left = url.slice(0, index);
    const right = url.slice(index + 1);
    const rightSegment = right.split(',')[0] ?? '';
    if (
      looksLikeStandaloneSrcsetUrl(left) &&
      looksLikeStandaloneSrcsetUrl(rightSegment)
    ) {
      if (
        requiresAbsoluteRightCandidate &&
        !/^(?:https?:|file:)/i.test(rightSegment.trim())
      ) {
        continue;
      }
      return index;
    }
  }

  return -1;
}

function parseDataSrcsetCandidate(
  value: string,
  startIndex: number
): { candidate: HtmlSrcsetCandidate; nextIndex: number } {
  let index = startIndex;

  while (index < value.length) {
    while (
      index < value.length &&
      value[index] !== ',' &&
      !/\s/.test(value[index])
    ) {
      index += 1;
    }

    if (index >= value.length) {
      return {
        candidate: { url: value.slice(startIndex).trim() },
        nextIndex: value.length
      };
    }

    if (!/\s/.test(value[index])) {
      index += 1;
      continue;
    }

    const descriptorStart = index;
    while (index < value.length && value[index] !== ',') {
      index += 1;
    }

    const descriptor = value.slice(descriptorStart, index).trim();
    const url = value.slice(startIndex, descriptorStart).trimEnd();

    if (descriptor && isValidSrcsetDescriptorSequence(descriptor)) {
      return {
        candidate: { url, descriptor },
        nextIndex: value[index] === ',' ? index + 1 : index
      };
    }

    if (
      descriptor &&
      url.endsWith(',') &&
      looksLikeSrcsetUrlStart(descriptor)
    ) {
      const normalizedUrl = url.slice(0, -1);
      return {
        candidate: { url: normalizedUrl },
        nextIndex: startIndex + normalizedUrl.length + 1
      };
    }

    index = descriptorStart + 1;
  }

  return {
    candidate: { url: value.slice(startIndex).trim() },
    nextIndex: value.length
  };
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
    const isDataUrl = /^data:/i.test(value.slice(index));
    if (isDataUrl) {
      const parsed = parseDataSrcsetCandidate(value, urlStart);
      candidates.push(parsed.candidate);
      index = parsed.nextIndex;
      continue;
    }

    while (
      index < value.length &&
      !/\s/.test(value[index])
    ) {
      index += 1;
    }

    let url = value.slice(urlStart, index);
    if (!url) {
      if (value[index] === ',') {
        index += 1;
      }
      continue;
    }

    while (index < value.length && value[index] !== ',') {
      index += 1;
    }
    const descriptorEnd = index;
    const descriptor = value
      .slice(url.length + urlStart, descriptorEnd)
      .trim();

    const implicitSplit = findImplicitSrcsetCandidateSplit(url, descriptor);
    if (implicitSplit >= 0) {
      candidates.push({ url: url.slice(0, implicitSplit) });
      index = urlStart + implicitSplit + 1;
      continue;
    }

    if (
      url.endsWith(',') &&
      descriptor &&
      !isValidSrcsetDescriptorSequence(descriptor)
    ) {
      url = url.slice(0, -1);
      index = urlStart + url.length + 1;
      candidates.push({ url });
      continue;
    }

    candidates.push({
      url,
      descriptor: descriptor || undefined
    });

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

function findTagEnd(html: string, fromIndex: number): number {
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

function getLiteralContentTagName(tag: string): string | undefined {
  const match = /^<([a-z0-9:-]+)/i.exec(tag);
  if (!match) {
    return undefined;
  }

  switch (match[1].toLowerCase()) {
    case 'script':
    case 'style':
    case 'template':
    case 'textarea':
    case 'title':
    case 'noscript':
      return match[1];
    default:
      return undefined;
  }
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

    if (html.startsWith('<!--', index)) {
      const commentEnd = html.indexOf('-->', index + 4);
      if (commentEnd < 0) {
        return -1;
      }
      index = commentEnd + 2;
      continue;
    }

    if (/^<img\b/i.test(html.slice(index))) {
      return index;
    }

    const tagEnd = findTagEnd(html, index + 1);
    if (tagEnd < 0) {
      return -1;
    }

    const tag = html.slice(index, tagEnd + 1);
    const literalTagName = getLiteralContentTagName(tag);
    if (literalTagName) {
      const closePattern = new RegExp(`</${literalTagName}\\s*>`, 'i');
      const closeIndex = html.slice(tagEnd + 1).search(closePattern);
      if (closeIndex < 0) {
        return -1;
      }
      index = tagEnd + closeIndex + literalTagName.length + 3;
      continue;
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
