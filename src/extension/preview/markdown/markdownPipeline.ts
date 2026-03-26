import { statSync } from 'node:fs';
import type * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import deflist from 'markdown-it-deflist';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';

import type { FrontmatterInfo, TocItem } from '../../messaging/protocol';
import {
  getHtmlAttribute,
  mapHtmlImgTags,
  parseHtmlImgTag,
  parseHtmlSrcset,
  serializeHtmlImgTag,
  serializeHtmlSrcset,
  setHtmlAttribute
} from '../htmlImageTags';
import { parseFrontmatter } from './frontmatter';
import { resolveImageUri } from './linkResolver';

interface RenderEnvironment {
  toc: TocItem[];
}

export interface MarkdownRenderOptions {
  sourceUri: vscode.Uri;
  webview: vscode.Webview;
  allowHtml: boolean;
  allowRemoteImages: boolean;
  remoteImageOverrides?: ReadonlyMap<string, vscode.Uri>;
  maxImageMB: number;
}

export interface MarkdownRenderResult {
  html: string;
  toc: TocItem[];
  frontmatter?: FrontmatterInfo;
  lineCount: number;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function applySourceLineAttributes(md: MarkdownIt): void {
  const sourceLineTokenTypes = new Set([
    'heading_open',
    'paragraph_open',
    'table_open',
    'hr'
  ]);

  md.core.ruler.push('omv_source_lines', (state) => {
    for (const token of state.tokens) {
      if (!token.map || token.map.length < 2) continue;
      if (!sourceLineTokenTypes.has(token.type)) continue;
      const [start, endExclusive] = token.map;
      if (!Number.isFinite(start)) continue;
      token.attrSet('data-source-line', String(start));
      if (Number.isFinite(endExclusive) && endExclusive > start) {
        token.attrSet('data-source-line-end', String(endExclusive));
      }
    }
  });
}

function sourceLineAttrString(token: MarkdownIt.Token): string {
  const start = token.map?.[0];
  const endExclusive = token.map?.[1];
  if (!Number.isFinite(start)) return '';
  const attrs = [`data-source-line="${String(start)}"`];
  if (Number.isFinite(endExclusive) && Number(endExclusive) > Number(start)) {
    attrs.push(`data-source-line-end="${String(endExclusive)}"`);
  }
  return ` ${attrs.join(' ')}`;
}

function encodeMathExpression(expr: string): string {
  return Buffer.from(expr, 'utf8').toString('base64');
}

function renderMathPlaceholder(
  expr: string,
  className: 'omv-math-inline' | 'omv-math-block',
  extraAttrs = ''
): string {
  if (className === 'omv-math-block') {
    return `<div class="${className}"${extraAttrs} data-math="${encodeMathExpression(expr)}"></div>`;
  }
  return `<span class="${className}"${extraAttrs} data-math="${encodeMathExpression(expr)}"></span>`;
}

function rewriteSrcsetAttribute(
  attributes: Array<{ name: string; value?: string }>,
  options: MarkdownRenderOptions
): {
  previewCandidates: Array<{ url: string; descriptor?: string }>;
  blockedRemoteCandidates: Array<{ url: string; descriptor?: string }>;
  blockedBySizeLimit: boolean;
  changed: boolean;
} {
  const srcset = getHtmlAttribute(attributes, 'srcset')?.value;
  if (!srcset) {
    return {
      previewCandidates: [],
      blockedRemoteCandidates: [],
      blockedBySizeLimit: false,
      changed: false
    };
  }

  const previewCandidates = [];
  const exportCandidates = [];
  const blockedRemoteCandidates = [];
  let blockedBySizeLimit = false;
  let changed = false;

  for (const candidate of parseHtmlSrcset(srcset)) {
    const override = options.remoteImageOverrides?.get(candidate.url);
    const resolved = resolveImageUri(options.sourceUri, candidate.url);

    if (override) {
      previewCandidates.push({
        url: options.webview.asWebviewUri(override).toString(),
        descriptor: candidate.descriptor
      });
      exportCandidates.push({
        url: override.toString(),
        descriptor: candidate.descriptor
      });
      changed = true;
      continue;
    }

    if (resolved) {
      exportCandidates.push({
        url: resolved.toString(),
        descriptor: candidate.descriptor
      });

      try {
        const bytes = statSync(resolved.fsPath).size;
        if (bytes > options.maxImageMB * 1024 * 1024) {
          blockedBySizeLimit = true;
          changed = true;
          continue;
        }
      } catch {
        // If stat fails we still rewrite to a webview URI and let runtime loading decide the result.
      }

      previewCandidates.push({
        url: options.webview.asWebviewUri(resolved).toString(),
        descriptor: candidate.descriptor
      });
      changed = true;
      continue;
    }

    if (/^https?:\/\//i.test(candidate.url) && !options.allowRemoteImages) {
      exportCandidates.push(candidate);
      blockedRemoteCandidates.push(candidate);
      changed = true;
      continue;
    }

    previewCandidates.push(candidate);
    exportCandidates.push(candidate);
  }

  if (!changed) {
    return {
      previewCandidates,
      blockedRemoteCandidates,
      blockedBySizeLimit,
      changed
    };
  }

  setHtmlAttribute(
    attributes,
    'data-export-srcset',
    serializeHtmlSrcset(exportCandidates)
  );
  setHtmlAttribute(
    attributes,
    'srcset',
    serializeHtmlSrcset(previewCandidates)
  );
  return {
    previewCandidates,
    blockedRemoteCandidates,
    blockedBySizeLimit,
    changed
  };
}

function setBlockedRemoteImageMetadata(
  attributes: Array<{ name: string; value?: string }>,
  blockedCandidates: Array<{ url: string }>
): void {
  if (blockedCandidates.length === 0) {
    return;
  }

  if (!getHtmlAttribute(attributes, 'data-remote-src')?.value) {
    setHtmlAttribute(attributes, 'data-remote-src', blockedCandidates[0].url);
  }
  if (!getHtmlAttribute(attributes, 'data-image-blocked')?.value) {
    setHtmlAttribute(attributes, 'data-image-blocked', 'remote-disabled');
  }
}

function rewriteImageAttributes(
  attributes: Array<{ name: string; value?: string }>,
  rawSrc: string,
  options: MarkdownRenderOptions
): void {
  const override = options.remoteImageOverrides?.get(rawSrc);
  const resolved = resolveImageUri(options.sourceUri, rawSrc);
  const blockedRemoteImage =
    /^https?:\/\//i.test(rawSrc) && !options.allowRemoteImages;

  if (override) {
    setHtmlAttribute(attributes, 'data-local-src', override.toString());
    setHtmlAttribute(
      attributes,
      'src',
      options.webview.asWebviewUri(override).toString()
    );
  } else if (resolved) {
    setHtmlAttribute(attributes, 'data-local-src', resolved.toString());
    try {
      const bytes = statSync(resolved.fsPath).size;
      if (bytes > options.maxImageMB * 1024 * 1024) {
        const alt = getHtmlAttribute(attributes, 'alt')?.value ?? 'image';
        setHtmlAttribute(
          attributes,
          'alt',
          `${alt} (blocked: exceeds preview.maxImageMB)`
        );
        setHtmlAttribute(attributes, 'data-image-blocked', 'size-limit');
        setHtmlAttribute(attributes, 'src', '');
        setHtmlAttribute(attributes, 'data-max-mb', String(options.maxImageMB));
      } else {
        setHtmlAttribute(
          attributes,
          'src',
          options.webview.asWebviewUri(resolved).toString()
        );
      }
    } catch {
      // If stat fails we still rewrite to a webview URI and let runtime loading decide the result.
      setHtmlAttribute(
        attributes,
        'src',
        options.webview.asWebviewUri(resolved).toString()
      );
    }
  } else if (blockedRemoteImage) {
    setHtmlAttribute(attributes, 'data-remote-src', rawSrc);
    setHtmlAttribute(attributes, 'data-image-blocked', 'remote-disabled');
  }

  const srcsetRewrite = rewriteSrcsetAttribute(attributes, options);
  setBlockedRemoteImageMetadata(
    attributes,
    srcsetRewrite.blockedRemoteCandidates
  );

  if (blockedRemoteImage) {
    if (srcsetRewrite.previewCandidates.length > 0) {
      const previewSrc = srcsetRewrite.previewCandidates[0]?.url;
      setHtmlAttribute(attributes, 'src', previewSrc ?? '');
    } else {
      setHtmlAttribute(attributes, 'srcset', '');
      setHtmlAttribute(attributes, 'src', '');
    }
  }

  setHtmlAttribute(attributes, 'loading', 'lazy');
  setHtmlAttribute(attributes, 'decoding', 'async');
  setHtmlAttribute(attributes, 'referrerpolicy', 'no-referrer');
  setHtmlAttribute(attributes, 'data-max-mb', String(options.maxImageMB));
}

function rewriteRawHtmlImages(
  html: string,
  options: MarkdownRenderOptions
): string {
  return mapHtmlImgTags(html, (tag) => {
    const parsed = parseHtmlImgTag(tag);
    if (!parsed) {
      return tag;
    }

    if (
      getHtmlAttribute(parsed.attributes, 'data-local-src') ||
      getHtmlAttribute(parsed.attributes, 'data-remote-src') ||
      getHtmlAttribute(parsed.attributes, 'data-image-blocked') ||
      getHtmlAttribute(parsed.attributes, 'data-export-srcset')
    ) {
      return tag;
    }

    const src = getHtmlAttribute(parsed.attributes, 'src')?.value;
    const srcset = getHtmlAttribute(parsed.attributes, 'srcset')?.value;
    if (!src && !srcset) {
      return serializeHtmlImgTag(parsed.attributes, parsed.selfClosing);
    }

    if (src) {
      rewriteImageAttributes(parsed.attributes, src, options);
    } else {
      const srcsetRewrite = rewriteSrcsetAttribute(parsed.attributes, options);
      setBlockedRemoteImageMetadata(
        parsed.attributes,
        srcsetRewrite.blockedRemoteCandidates
      );
      if (
        srcsetRewrite.changed &&
        srcsetRewrite.previewCandidates.length === 0
      ) {
        if (srcsetRewrite.blockedRemoteCandidates.length > 0) {
          setHtmlAttribute(parsed.attributes, 'src', '');
        } else if (srcsetRewrite.blockedBySizeLimit) {
          const alt = getHtmlAttribute(parsed.attributes, 'alt')?.value ?? 'image';
          setHtmlAttribute(
            parsed.attributes,
            'alt',
            `${alt} (blocked: exceeds preview.maxImageMB)`
          );
          setHtmlAttribute(parsed.attributes, 'data-image-blocked', 'size-limit');
          setHtmlAttribute(parsed.attributes, 'src', '');
        }
      }
      setHtmlAttribute(parsed.attributes, 'loading', 'lazy');
      setHtmlAttribute(parsed.attributes, 'decoding', 'async');
      setHtmlAttribute(parsed.attributes, 'referrerpolicy', 'no-referrer');
      setHtmlAttribute(
        parsed.attributes,
        'data-max-mb',
        String(options.maxImageMB)
      );
    }
    return serializeHtmlImgTag(parsed.attributes, parsed.selfClosing);
  });
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && source.charCodeAt(i) === 0x5c; i -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findUnescapedDelimiter(source: string, delimiter: string, fromIndex: number): number {
  let index = fromIndex;
  while (index < source.length) {
    const found = source.indexOf(delimiter, index);
    if (found < 0) return -1;
    if (!isEscaped(source, found)) return found;
    index = found + delimiter.length;
  }
  return -1;
}

function parseInlineDollarMath(state: any, silent: boolean): boolean {
  const { src, pos, posMax } = state;
  if (pos + 1 >= posMax || src.charCodeAt(pos) !== 0x24 || isEscaped(src, pos)) {
    return false;
  }

  const delimiter = src.charCodeAt(pos + 1) === 0x24 ? '$$' : '$';
  const openLength = delimiter.length;
  const contentStart = pos + openLength;
  if (contentStart >= posMax) return false;

  if (delimiter === '$') {
    const nextChar = src.charAt(contentStart);
    if (!nextChar || /\s/u.test(nextChar)) return false;
  }

  const close = findUnescapedDelimiter(src, delimiter, contentStart);
  if (close < 0 || close > posMax) return false;

  const raw = src.slice(contentStart, close);
  if (!raw.trim()) return false;

  if (delimiter === '$') {
    const previous = raw.charAt(raw.length - 1);
    if (!previous || /\s/u.test(previous)) return false;
  }

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = raw.trim();
    token.markup = delimiter;
  }

  state.pos = close + openLength;
  return true;
}

function parseInlineBracketMath(state: any, silent: boolean): boolean {
  const { src, pos, posMax } = state;
  if (pos + 2 >= posMax || src.charCodeAt(pos) !== 0x5c || isEscaped(src, pos)) {
    return false;
  }

  const opener = src.charAt(pos + 1);
  const closeDelimiter = opener === '(' ? '\\)' : opener === '[' ? '\\]' : '';
  if (!closeDelimiter) return false;

  const contentStart = pos + 2;
  const close = findUnescapedDelimiter(src, closeDelimiter, contentStart);
  if (close < 0 || close > posMax) return false;

  const raw = src.slice(contentStart, close);
  if (!raw.trim()) return false;

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = raw.trim();
    token.markup = `\\${opener}`;
  }

  state.pos = close + 2;
  return true;
}

function parseBlockDollarMath(state: any, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (pos + 1 >= max) return false;

  if (state.src.charCodeAt(pos) !== 0x24 || state.src.charCodeAt(pos + 1) !== 0x24 || isEscaped(state.src, pos)) {
    return false;
  }

  const firstLine = state.src.slice(pos + 2, max);
  const firstClose = findUnescapedDelimiter(firstLine, '$$', 0);
  let nextLine = startLine;
  let body = '';

  if (firstClose >= 0) {
    const trailing = firstLine.slice(firstClose + 2);
    if (trailing.trim().length > 0) return false;
    body = firstLine.slice(0, firstClose);
  } else {
    body = firstLine;
    let foundClose = false;
    for (nextLine = startLine + 1; nextLine < endLine; nextLine += 1) {
      pos = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMax = state.eMarks[nextLine];
      const line = state.src.slice(pos, lineMax);
      const closeIndex = findUnescapedDelimiter(line, '$$', 0);
      if (closeIndex >= 0) {
        const trailing = line.slice(closeIndex + 2);
        if (trailing.trim().length > 0) return false;
        body += `\n${line.slice(0, closeIndex)}`;
        foundClose = true;
        break;
      }
      body += `\n${line}`;
    }

    if (!foundClose) return false;
  }

  if (silent) return true;

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = body.trim();
  token.map = [startLine, nextLine + 1];
  token.markup = '$$';
  state.line = nextLine + 1;
  return true;
}

function installMathRules(md: MarkdownIt): void {
  md.inline.ruler.after('escape', 'omv_math_dollar_inline', parseInlineDollarMath);
  md.inline.ruler.after('omv_math_dollar_inline', 'omv_math_bracket_inline', parseInlineBracketMath);
  md.block.ruler.after('blockquote', 'omv_math_dollar_block', parseBlockDollarMath, {
    alt: ['paragraph', 'reference', 'blockquote', 'list']
  });

  md.renderer.rules.math_inline = (tokens, idx) => {
    const token = tokens[idx];
    return renderMathPlaceholder(token.content, 'omv-math-inline');
  };

  md.renderer.rules.math_block = (tokens, idx) => {
    const token = tokens[idx];
    const lineAttrs = sourceLineAttrString(token);
    return renderMathPlaceholder(token.content, 'omv-math-block', lineAttrs);
  };
}

// We use markdown-it for speed and predictable token maps (line mapping for scroll sync / outline).
function createMarkdownIt(options: MarkdownRenderOptions): MarkdownIt {
  const md = new MarkdownIt({
    html: options.allowHtml,
    linkify: true,
    breaks: false,
    typographer: false
  });

  md.use(deflist);
  md.use(footnote);
  // Preview should be read-only; task checkboxes stay non-interactive unless wired back to document edits.
  md.use(taskLists, { enabled: false, label: true, labelAfter: true });
  md.use(anchor, {
    slugify
  });
  installMathRules(md);
  applySourceLineAttributes(md);

  md.core.ruler.push('collect_toc', (state) => {
    const env = state.env as RenderEnvironment;
    env.toc = [];
    for (let i = 0; i < state.tokens.length; i += 1) {
      const token = state.tokens[i];
      if (token.type !== 'heading_open') continue;
      const inline = state.tokens[i + 1];
      if (!inline || inline.type !== 'inline') continue;
      const idAttr = token.attrGet('id') ?? slugify(inline.content);
      token.attrSet('id', idAttr);
      const level = Number(token.tag.slice(1));
      env.toc.push({
        id: idAttr,
        level,
        text: inline.content,
        line: token.map?.[0] ?? 0
      });
    }
  });

  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const info = (token.info || '').trim().split(/\s+/)[0] ?? '';
    const lineAttrs = sourceLineAttrString(token);
    if (info === 'mermaid') {
      const encoded = Buffer.from(token.content, 'utf8').toString('base64');
      return `<div class="omv-mermaid"${lineAttrs} data-mermaid="${encoded}"></div>`;
    }
    if (info === 'math') {
      const encoded = Buffer.from(token.content, 'utf8').toString('base64');
      return `<div class="omv-math-block"${lineAttrs} data-math="${encoded}"></div>`;
    }
    const html = fence ? fence(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
    return lineAttrs ? html.replace(/<pre\b/i, `<pre${lineAttrs}`) : html;
  };

  const codeBlock = md.renderer.rules.code_block;
  md.renderer.rules.code_block = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const lineAttrs = sourceLineAttrString(token);
    const html = codeBlock ? codeBlock(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
    return lineAttrs ? html.replace(/<pre\b/i, `<pre${lineAttrs}`) : html;
  };

  const imageRule = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src') ?? '';
    const override = options.remoteImageOverrides?.get(src);
    const resolved = resolveImageUri(options.sourceUri, src);
    if (override) {
      token.attrSet('data-local-src', override.toString());
      token.attrSet('src', options.webview.asWebviewUri(override).toString());
    } else if (resolved) {
      try {
        const bytes = statSync(resolved.fsPath).size;
        if (bytes > options.maxImageMB * 1024 * 1024) {
          token.attrSet(
            'alt',
            `${token.attrGet('alt') ?? 'image'} (blocked: exceeds preview.maxImageMB)`
          );
          token.attrSet('data-image-blocked', 'size-limit');
          token.attrSet('src', '');
          return imageRule ? imageRule(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
        }
      } catch {
        // If stat fails we leave the original src untouched; CSP/runtime policy governs remote sources.
      }
      token.attrSet('data-local-src', resolved.toString());
      token.attrSet('src', options.webview.asWebviewUri(resolved).toString());
    } else if (/^https?:\/\//i.test(src) && !options.allowRemoteImages) {
      token.attrSet('data-remote-src', src);
      token.attrSet('data-image-blocked', 'remote-disabled');
      token.attrSet('src', '');
    }
    token.attrSet('loading', 'lazy');
    token.attrSet('decoding', 'async');
    token.attrSet('referrerpolicy', 'no-referrer');
    token.attrSet('data-max-mb', String(options.maxImageMB));
    return imageRule ? imageRule(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
  };

  const linkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    token.attrSet('data-omv-link', '1');
    token.attrSet('rel', 'noopener noreferrer nofollow');
    return linkOpen ? linkOpen(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
  };

  const tableCellOpen = (ruleName: 'th_open' | 'td_open') => md.renderer.rules[ruleName];
  for (const ruleName of ['th_open', 'td_open'] as const) {
    const original = tableCellOpen(ruleName);
    md.renderer.rules[ruleName] = (tokens, idx, opts, env, self) => {
      const token = tokens[idx];
      const style = token.attrGet('style') ?? '';
      const match = /text-align\s*:\s*(left|center|right)/i.exec(style);
      if (match) {
        const align = match[1].toLowerCase();
        token.attrSet('data-align', align);
        token.attrSet('align', align);
        const existingClass = token.attrGet('class');
        token.attrSet('class', [existingClass, `omv-align-${align}`].filter(Boolean).join(' '));
        token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'style');
      }
      return original ? original(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
    };
  }

  return md;
}

export function renderMarkdown(input: string, options: MarkdownRenderOptions): MarkdownRenderResult {
  const parsed = parseFrontmatter(input);
  const md = createMarkdownIt(options);
  const env: RenderEnvironment = { toc: [] };
  const html = rewriteRawHtmlImages(md.render(parsed.content, env), options);
  const lineCount = input.split(/\r?\n/).length;

  return {
    html,
    toc: env.toc,
    frontmatter: parsed.frontmatter,
    lineCount
  };
}
