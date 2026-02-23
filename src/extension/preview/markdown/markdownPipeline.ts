import { statSync } from 'node:fs';
import type * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import deflist from 'markdown-it-deflist';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';

import type { FrontmatterInfo, TocItem } from '../../messaging/protocol';
import { parseFrontmatter } from './frontmatter';
import { resolveImageUri } from './linkResolver';

interface RenderEnvironment {
  toc: TocItem[];
}

export interface MarkdownRenderOptions {
  sourceUri: vscode.Uri;
  webview: vscode.Webview;
  allowHtml: boolean;
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
  md.use(taskLists, { enabled: true, label: true, labelAfter: true });
  md.use(anchor, {
    slugify
  });
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
    const resolved = resolveImageUri(options.sourceUri, src);
    if (resolved) {
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
        // If stat fails we leave the original src untouched; webview CSP still blocks remote URLs.
      }
      token.attrSet('data-local-src', resolved.toString());
      token.attrSet('src', options.webview.asWebviewUri(resolved).toString());
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

  const inlineRule = md.renderer.rules.text || ((tokens, idx) => tokens[idx].content);
  md.renderer.rules.text = (tokens, idx, opts, env, self) => {
    const raw = inlineRule(tokens, idx, opts, env, self);
    return raw
      .replace(/\$\$([^$]+)\$\$/g, (_, expr: string) => {
        const encoded = Buffer.from(expr.trim(), 'utf8').toString('base64');
        return `<span class="omv-math-inline" data-math="${encoded}"></span>`;
      })
      .replace(/\$([^$\n]+)\$/g, (_, expr: string) => {
        const encoded = Buffer.from(expr.trim(), 'utf8').toString('base64');
        return `<span class="omv-math-inline" data-math="${encoded}"></span>`;
      });
  };

  return md;
}

export function renderMarkdown(input: string, options: MarkdownRenderOptions): MarkdownRenderResult {
  const parsed = parseFrontmatter(input);
  const md = createMarkdownIt(options);
  const env: RenderEnvironment = { toc: [] };
  const html = md.render(parsed.content, env);
  const lineCount = input.split(/\r?\n/).length;

  return {
    html,
    toc: env.toc,
    frontmatter: parsed.frontmatter,
    lineCount
  };
}
