import DOMPurify from '../assets/dompurify.min.js';
import mermaid from '../assets/mermaid.min.js';
import katex from '../assets/katex.min.js';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-bash';

import type {
  RenderPayload,
  TocItem
} from '../../extension/messaging/protocol';
import {
  OMV_EXPORT_SRCSET_ATTR,
  OMV_IMAGE_BLOCKED_ATTR,
  OMV_LOCAL_SRC_ATTR,
  OMV_MAX_MB_ATTR,
  OMV_REMOTE_SRC_ATTR
} from '../../previewImageMetadata';
import { markRemoteImagePreviewHidden } from './remoteImageAttrs';
import { getEffectiveMermaidThemeKind } from './themeUtils';

export interface RendererBridge {
  onOpenLink(
    href: string,
    kindHint?: 'heading' | 'external' | 'relative' | 'unknown'
  ): void;
  onHeadingSelect(id: string): void;
  onCopyHeadingLink(id: string): void;
  onOpenImage(src: string): void;
  onDownloadRemoteImage(src: string): void;
}

interface MermaidRecoveryAttempt {
  code: string;
  strategy: string;
}

// Mermaid expects a global DOMPurify instance for some diagram renderers (notably class/sequence paths).
// We already bundle DOMPurify locally; exposing it here avoids any network dependency and keeps one sanitizer instance.
(window as Window & { DOMPurify?: typeof DOMPurify }).DOMPurify = DOMPurify;

export class PreviewRenderer {
  private toc: TocItem[] = [];
  private activeHeadingId: string | undefined;
  private readonly content: HTMLElement;
  private readonly styledRoot: HTMLElement;
  private readonly frontmatter: HTMLDetailsElement;
  private readonly banner: HTMLElement;
  private mermaidInitialized = false;
  private mermaidThemeSignature = '';

  constructor(
    private readonly host: HTMLElement,
    private readonly bridge: RendererBridge
  ) {
    this.banner = document.createElement('div');
    this.banner.className = 'omv-status-banner';
    this.banner.hidden = true;

    this.frontmatter = document.createElement('details');
    this.frontmatter.className = 'omv-frontmatter';
    this.frontmatter.hidden = true;

    this.styledRoot = document.createElement('div');
    this.styledRoot.className =
      'omv-content markdown-body github-markdown-body';

    this.content = document.createElement('div');
    this.content.className = 'github-markdown-content';

    this.styledRoot.append(this.content);

    this.host.append(this.banner, this.frontmatter, this.styledRoot);
    this.host.addEventListener('click', (event) => this.handleClick(event));
  }

  getContentElement(): HTMLElement {
    return this.content;
  }

  getToc(): TocItem[] {
    return [...this.toc];
  }

  getActiveHeadingId(): string | undefined {
    return this.activeHeadingId;
  }

  getComputedThemeVariables(): Record<string, string> {
    return collectThemeVariables(this.styledRoot);
  }

  async render(payload: RenderPayload): Promise<void> {
    this.toc = payload.toc;
    this.applyGitHubMarkdownStyle(payload.settings);
    this.renderFrontmatter(payload);
    const tableAlignments = extractTableAlignments(payload.html);

    // Render-time sanitization happens in the webview (same trust boundary as actual DOM insertion).
    const sanitized = payload.settings.sanitizeHtml
      ? DOMPurify.sanitize(payload.html, {
          USE_PROFILES: { html: true },
          ADD_ATTR: [
            'data-mermaid',
            'data-math',
            'data-omv-link',
            OMV_LOCAL_SRC_ATTR,
            OMV_EXPORT_SRCSET_ATTR,
            OMV_REMOTE_SRC_ATTR,
            OMV_IMAGE_BLOCKED_ATTR,
            OMV_MAX_MB_ATTR,
            'data-source-line',
            'data-source-line-end',
            'data-align',
            'align'
          ],
          FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form']
        })
      : payload.html;

    this.content.innerHTML = String(sanitized);
    applyContentTheme(this.styledRoot);
    applyTableAlignments(this.content, tableAlignments);
    this.decorateHeadings();
    this.decorateImageActions();
    this.renderBanner(payload.settings.sanitizeHtml);

    Prism.highlightAllUnder(this.content);

    // Incremental heavy enhancement keeps large documents responsive during live updates.
    await this.enhanceMath(payload.settings.enableMath);
    await this.enhanceMermaid(payload.settings.enableMermaid);
  }

  setActiveHeading(id?: string): void {
    this.activeHeadingId = id;
  }

  async refreshTheme(settings: RenderPayload['settings']): Promise<void> {
    this.applyGitHubMarkdownStyle(settings);
    applyContentTheme(this.styledRoot);
    await this.enhanceMermaid(settings.enableMermaid);
  }

  private applyGitHubMarkdownStyle(settings: RenderPayload['settings']): void {
    const githubStyle = settings.githubMarkdownStyle;
    this.host.classList.toggle(
      'omv-uses-github-markdown-style',
      githubStyle.enabled
    );

    this.styledRoot.dataset.colorMode = githubStyle.colorMode;
    this.styledRoot.dataset.lightTheme = githubStyle.lightTheme;
    this.styledRoot.dataset.darkTheme = githubStyle.darkTheme;
  }

  private renderFrontmatter(payload: RenderPayload): void {
    if (!payload.settings.showFrontmatter || !payload.frontmatter) {
      this.frontmatter.hidden = true;
      this.frontmatter.innerHTML = '';
      return;
    }
    this.frontmatter.hidden = false;
    this.frontmatter.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'Frontmatter';
    const pre = document.createElement('pre');
    pre.textContent = payload.frontmatter.raw;
    this.frontmatter.replaceChildren(summary, pre);
  }

  private renderBanner(sanitizeHtml: boolean): void {
    if (sanitizeHtml) {
      this.banner.hidden = true;
      this.banner.textContent = '';
      return;
    }
    this.banner.hidden = false;
    this.banner.textContent =
      'Warning: HTML sanitization is disabled for this preview.';
  }

  private decorateHeadings(): void {
    const headings =
      this.content.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6');
    for (const heading of headings) {
      const id = heading.id;
      if (!id) continue;
      if (heading.querySelector('.omv-heading-anchor')) continue;
      const anchor = document.createElement('a');
      anchor.href = `#${id}`;
      anchor.className = 'omv-heading-anchor';
      anchor.textContent = '#';
      anchor.title = 'Copy heading link';
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        this.bridge.onCopyHeadingLink(id);
      });
      heading.appendChild(anchor);
    }
  }

  private decorateImageActions(): void {
    const imgs = this.content.querySelectorAll<HTMLImageElement>(
      `img[${OMV_LOCAL_SRC_ATTR}]`
    );
    for (const img of imgs) {
      img.addEventListener('click', () => {
        const localSrc = img.getAttribute(OMV_LOCAL_SRC_ATTR);
        if (localSrc) this.bridge.onOpenImage(localSrc);
      });
    }

    const remoteImgs = this.content.querySelectorAll<HTMLImageElement>(
      `img[${OMV_REMOTE_SRC_ATTR}]`
    );
    for (const img of remoteImgs) {
      const src = img.getAttribute(OMV_REMOTE_SRC_ATTR);
      if (!src) continue;
      const hasPreviewSource = Boolean(
        (img.getAttribute('src') ?? '').trim() ||
          (img.getAttribute('srcset') ?? '').trim()
      );
      const block = document.createElement('div');
      block.className = 'omv-remote-image';

      const text = document.createElement('div');
      text.className = 'omv-remote-image-text';
      text.textContent = hasPreviewSource
        ? 'Some remote image sources are blocked by settings.'
        : 'Remote image blocked by settings.';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'omv-remote-image-btn';
      btn.dataset.remoteImageSrc = src;
      btn.textContent = 'Download Image';

      block.append(text, btn);
      if (!hasPreviewSource) {
        markRemoteImagePreviewHidden(img);
      }
      img.insertAdjacentElement('afterend', block);
    }
  }

  private async enhanceMath(enableMath: boolean): Promise<void> {
    const nodes = [
      ...this.content.querySelectorAll<HTMLElement>('[data-math]')
    ];
    if (!enableMath) {
      for (const node of nodes) {
        const expr = decodeBase64(node.dataset.math ?? '');
        node.textContent = expr;
      }
      return;
    }

    let processed = 0;
    for (const node of nodes) {
      const expr = decodeBase64(node.dataset.math ?? '');
      const displayMode = node.classList.contains('omv-math-block');
      try {
        katex.render(expr, node, {
          throwOnError: false,
          displayMode,
          strict: 'warn',
          trust: false
        });
      } catch {
        node.textContent = expr;
      }
      processed += 1;
      if (processed % 25 === 0) {
        await nextTick();
      }
    }
  }

  private async enhanceMermaid(enableMermaid: boolean): Promise<void> {
    const nodes = [
      ...this.content.querySelectorAll<HTMLElement>(
        '.omv-mermaid[data-mermaid]'
      )
    ];
    if (!enableMermaid) {
      for (const node of nodes) {
        node.textContent = decodeBase64(node.dataset.mermaid ?? '');
      }
      return;
    }

    const mermaidTheme = buildMermaidThemeConfig(this.styledRoot);
    if (
      !this.mermaidInitialized ||
      this.mermaidThemeSignature !== mermaidTheme.signature
    ) {
      try {
        mermaid.initialize({
          startOnLoad: false,
          // Mermaid strict mode disables potentially unsafe HTML labels / scriptable behavior.
          securityLevel: 'strict',
          // Use Mermaid's base theme and drive colors from VS Code theme variables.
          theme: 'base',
          markdownAutoWrap: false,
          flowchart: {
            // Prefer HTML labels for better text measurement/wrapping; the interactive viewer handles fitting/zooming.
            htmlLabels: true,
            useMaxWidth: false,
            // Let labels stay readable and expand node width; viewer auto-fit handles the larger diagram.
            wrappingWidth: 1400,
            padding: 24,
            nodeSpacing: 48,
            rankSpacing: 64
          },
          themeVariables: mermaidTheme.themeVariables
        });
      } catch {
        // Fallback to a minimal safe config so Mermaid rendering never disappears due to theme parsing.
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          markdownAutoWrap: false,
          flowchart: {
            htmlLabels: true,
            useMaxWidth: false,
            wrappingWidth: 1400,
            padding: 24,
            nodeSpacing: 48,
            rankSpacing: 64
          },
          themeVariables: {
            fontFamily: String(mermaidTheme.themeVariables.fontFamily ?? ''),
            fontSize: String(mermaidTheme.themeVariables.fontSize ?? '14px')
          }
        });
      }
      this.mermaidInitialized = true;
      this.mermaidThemeSignature = mermaidTheme.signature;
    }

    const jobs = nodes.map((node) => {
      const code = decodeBase64(node.dataset.mermaid ?? '');
      const diagramType = detectMermaidDiagramType(code);
      node.setAttribute('aria-busy', 'true');
      node.replaceChildren(buildMermaidLoadingNode(diagramType));
      return { node, code, diagramType };
    });

    let index = 0;
    for (const job of jobs) {
      const { node, code, diagramType } = job;
      const id = `omv-mermaid-${index++}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const rendered = await mermaid.render(id, code);
        node.removeAttribute('data-omv-mermaid-recovered');
        node.removeAttribute('data-omv-mermaid-recovery-strategy');
        node.replaceChildren(buildMermaidSvgNode(rendered.svg, diagramType));
      } catch (error) {
        const recovery = buildMermaidRecoveryAttempt(code, diagramType);
        if (recovery) {
          try {
            const recovered = await mermaid.render(
              `${id}-recovery`,
              recovery.code
            );
            node.setAttribute('data-omv-mermaid-recovered', 'true');
            node.setAttribute(
              'data-omv-mermaid-recovery-strategy',
              recovery.strategy
            );
            node.replaceChildren(
              buildMermaidSvgNode(recovered.svg, diagramType)
            );
            continue;
          } catch (recoveryError) {
            const hints = buildMermaidErrorHints(
              code,
              diagramType,
              recoveryError
            );
            node.replaceChildren(
              buildMermaidErrorNode(code, recoveryError, hints)
            );
            continue;
          }
        }
        const hints = buildMermaidErrorHints(code, diagramType, error);
        node.replaceChildren(buildMermaidErrorNode(code, error, hints));
      } finally {
        node.removeAttribute('aria-busy');
      }
      if (index % 5 === 0) {
        await nextTick();
      }
    }
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const remoteDownload = target.closest<HTMLButtonElement>(
      'button[data-remote-image-src]'
    );
    if (remoteDownload) {
      event.preventDefault();
      const src = remoteDownload.dataset.remoteImageSrc;
      if (src) {
        this.bridge.onDownloadRemoteImage(src);
      }
      return;
    }

    const heading = target.closest<HTMLElement>('h1,h2,h3,h4,h5,h6');
    if (heading && heading.id && target.tagName !== 'A') {
      this.bridge.onHeadingSelect(heading.id);
    }

    const link = target.closest<HTMLAnchorElement>('a[href][data-omv-link]');
    if (link) {
      event.preventDefault();
      const href = link.getAttribute('href') ?? '';
      const kindHint = href.startsWith('#')
        ? 'heading'
        : /^https?:/i.test(href)
          ? 'external'
          : 'relative';
      this.bridge.onOpenLink(href, kindHint);
    }
  }
}

function buildMermaidThemeConfig(themeRoot: HTMLElement): {
  signature: string;
  themeVariables: Record<string, string | number | boolean>;
} {
  const bodyStyle = getComputedStyle(document.body);
  const rootStyle = getComputedStyle(themeRoot);
  const probe = createThemeProbe(themeRoot);
  const linkStyle = getComputedStyle(probe.link);
  const preStyle = getComputedStyle(probe.pre);
  const blockquoteStyle = getComputedStyle(probe.blockquote);

  const bodyFontSize = Number.parseFloat(bodyStyle.fontSize || '14');

  const fg = firstDefinedColor(
    rootStyle.color,
    bodyStyle.color,
    'rgb(204, 204, 204)'
  );
  const bg = firstOpaqueColor(
    rootStyle.backgroundColor,
    bodyStyle.backgroundColor,
    'rgb(30, 30, 30)'
  );
  const border = firstOpaqueColor(
    blockquoteStyle.borderLeftColor,
    preStyle.borderTopColor,
    resolveThemeColor(
      'var(--omv-border)',
      'borderTopColor',
      'rgba(127,127,127,0.35)'
    ),
    fg
  );
  const accent = firstDefinedColor(
    linkStyle.color,
    resolveThemeColor('var(--omv-accent)', 'color', fg),
    fg
  );
  const codeBg = firstOpaqueColor(
    preStyle.backgroundColor,
    resolveThemeColor('var(--omv-code-bg)', 'backgroundColor', bg),
    bg
  );
  const editorBg = bg;
  const themeKind = getEffectiveMermaidThemeKind(
    bg,
    document.body.dataset.vscodeThemeKind ?? 'light'
  );

  probe.root.remove();

  // High-contrast should prefer stronger edge/node borders.
  const strongBorder = themeKind === 'high-contrast' ? fg : border;
  const transparent = 'rgba(0, 0, 0, 0)';
  const categorical = getMermaidCategoricalPalette(themeKind);

  const themeVariables: Record<string, string | number | boolean> = {
    darkMode: themeKind !== 'light',
    // Match Mermaid text metrics to the actual preview font to reduce last-character wraps/clipping.
    fontFamily: bodyStyle.fontFamily,
    fontSize: `${Math.max(13, Math.round(bodyFontSize))}px`,
    background: editorBg,
    textColor: fg,
    lineColor: strongBorder,
    // Keep Mermaid's generic edge/label backgrounds transparent; flowchart edge labels are styled
    // separately via scoped CSS so sequence/class labels don't get unintended fills.
    edgeLabelBackground: transparent,
    // Flowchart/default node palette
    primaryColor: codeBg,
    primaryTextColor: fg,
    primaryBorderColor: accent || strongBorder,
    secondaryColor: bg,
    secondaryTextColor: fg,
    secondaryBorderColor: strongBorder,
    tertiaryColor: editorBg,
    tertiaryTextColor: fg,
    tertiaryBorderColor: strongBorder,
    mainBkg: codeBg,
    secondBkg: bg,
    clusterBkg: editorBg,
    clusterBorder: strongBorder,
    // Sequence/state/note-ish surfaces
    noteBkgColor: codeBg,
    noteTextColor: fg,
    noteBorderColor: strongBorder,
    actorBkg: codeBg,
    actorTextColor: fg,
    actorBorder: strongBorder,
    actorLineColor: strongBorder,
    signalTextColor: fg,
    labelBoxBkgColor: transparent,
    labelBoxBorderColor: transparent,
    labelTextColor: fg,
    activationBorderColor: strongBorder,
    activationBkgColor: codeBg,
    scaleLabelColor: fg,
    pieTitleTextColor: fg,
    pieSectionTextColor: fg,
    pieLegendTextColor: fg,
    pieStrokeColor: strongBorder,
    pieOuterStrokeColor: strongBorder
  };

  categorical.forEach((color, index) => {
    const labelColor = getReadableTextColorForHex(color);
    themeVariables[`cScale${index}`] = color;
    themeVariables[`cScaleInv${index}`] = labelColor;
    themeVariables[`cScaleLabel${index}`] = labelColor;
    themeVariables[`cScalePeer${index}`] = color;
    themeVariables[`pie${index + 1}`] = color;
    if (index < 8) {
      themeVariables[`git${index}`] = color;
      themeVariables[`gitInv${index}`] = labelColor;
      themeVariables[`gitBranchLabel${index}`] = labelColor;
    }
  });

  return {
    signature: JSON.stringify({
      themeKind,
      fontFamily: themeVariables.fontFamily,
      fontSize: themeVariables.fontSize,
      fg,
      bg,
      border: strongBorder,
      accent,
      codeBg,
      editorBg
    }),
    themeVariables
  };
}

function getMermaidCategoricalPalette(themeKind: string): string[] {
  if (themeKind === 'high-contrast') {
    return [
      '#ffd800',
      '#00ffff',
      '#ff5cff',
      '#7fff00',
      '#ff8c00',
      '#00b7ff',
      '#ff3b30',
      '#b388ff',
      '#00e5a8',
      '#ffe66d',
      '#4dd0ff',
      '#ff99c8'
    ];
  }

  if (themeKind === 'dark') {
    return [
      '#58a6ff',
      '#3fb950',
      '#d2a8ff',
      '#f2cc60',
      '#ff7b72',
      '#79c0ff',
      '#ffa657',
      '#7ee787',
      '#a5d6ff',
      '#c297ff',
      '#56d364',
      '#ffd580'
    ];
  }

  return [
    '#0f6cbd',
    '#107c10',
    '#8e5bd9',
    '#b76e00',
    '#c23934',
    '#0067c0',
    '#ca5010',
    '#0b8a5f',
    '#5c2e91',
    '#0078d4',
    '#11875d',
    '#a4262c'
  ];
}

function createThemeProbe(themeRoot: HTMLElement): {
  root: HTMLDivElement;
  content: HTMLDivElement;
  link: HTMLAnchorElement;
  code: HTMLElement;
  pre: HTMLPreElement;
  blockquote: HTMLQuoteElement;
} {
  const root = document.createElement('div');
  root.setAttribute('aria-hidden', 'true');
  root.style.position = 'absolute';
  root.style.left = '-99999px';
  root.style.top = '0';
  root.style.visibility = 'hidden';
  root.style.pointerEvents = 'none';
  // Mirror the live styled root so the probe picks up OMV base rules as well as
  // any imported GitHub markdown selectors.
  root.className = themeRoot.className;
  root.dataset.colorMode = themeRoot.dataset.colorMode ?? 'auto';
  root.dataset.lightTheme = themeRoot.dataset.lightTheme ?? 'light';
  root.dataset.darkTheme = themeRoot.dataset.darkTheme ?? 'dark';

  const content = document.createElement('div');
  content.className = 'github-markdown-content';

  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'link';

  const code = document.createElement('code');
  code.textContent = 'const value = 1;';

  const pre = document.createElement('pre');
  pre.textContent = 'code';

  const blockquote = document.createElement('blockquote');
  blockquote.textContent = 'quote';

  content.append(link, code, pre, blockquote);
  root.append(content);
  (themeRoot.parentElement ?? themeRoot).append(root);
  return { root, content, link, code, pre, blockquote };
}

const computedThemeVarNames = [
  '--omv-mermaid-panel-bg',
  '--omv-mermaid-viewport-bg',
  '--omv-mermaid-border',
  '--omv-mermaid-muted',
  '--omv-mermaid-accent',
  '--omv-active-pre-fg',
  '--omv-active-pre-bg',
  '--omv-active-pre-border',
  '--omv-active-pre-radius',
  '--omv-active-inline-code-fg',
  '--omv-active-inline-code-bg',
  '--omv-active-inline-code-radius',
  '--omv-code-fg',
  '--omv-code-bg',
  '--omv-syntax-comment',
  '--omv-syntax-keyword',
  '--omv-syntax-string',
  '--omv-syntax-function',
  '--omv-syntax-class',
  '--omv-syntax-number',
  '--omv-syntax-constant',
  '--omv-syntax-property',
  '--omv-syntax-tag',
  '--omv-syntax-attr-name',
  '--omv-syntax-operator',
  '--omv-syntax-punctuation',
  '--omv-syntax-inserted',
  '--omv-syntax-deleted'
] as const;

function resetComputedThemeVars(themeRoot: HTMLElement): void {
  for (const name of computedThemeVarNames) {
    themeRoot.style.removeProperty(name);
  }
}

function applyContentTheme(themeRoot: HTMLElement): void {
  resetComputedThemeVars(themeRoot);

  const probe = createThemeProbe(themeRoot);
  const rootStyle = getComputedStyle(themeRoot);
  const linkStyle = getComputedStyle(probe.link);
  const codeStyle = getComputedStyle(probe.code);
  const preStyle = getComputedStyle(probe.pre);
  const blockquoteStyle = getComputedStyle(probe.blockquote);

  const panelBg = firstOpaqueColor(
    preStyle.backgroundColor,
    rootStyle.backgroundColor,
    'rgba(0, 0, 0, 0)'
  );
  const viewportBg = firstOpaqueColor(
    rootStyle.backgroundColor,
    panelBg,
    'rgba(0, 0, 0, 0)'
  );
  const border = firstOpaqueColor(
    preStyle.borderTopColor,
    blockquoteStyle.borderLeftColor,
    'rgba(127,127,127,0.35)'
  );
  const muted = firstDefinedColor(
    blockquoteStyle.color,
    rootStyle.color,
    'inherit'
  );
  const accent = firstDefinedColor(linkStyle.color, rootStyle.color, 'inherit');

  themeRoot.style.setProperty('--omv-mermaid-panel-bg', panelBg);
  themeRoot.style.setProperty('--omv-mermaid-viewport-bg', viewportBg);
  themeRoot.style.setProperty('--omv-mermaid-border', border);
  themeRoot.style.setProperty('--omv-mermaid-muted', muted);
  themeRoot.style.setProperty('--omv-mermaid-accent', accent);

  applyCodeTheme(themeRoot, {
    rootStyle,
    codeStyle,
    preStyle
  });

  probe.root.remove();
}

function collectThemeVariables(themeRoot: HTMLElement): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const name of computedThemeVarNames) {
    const value = themeRoot.style.getPropertyValue(name).trim();
    if (value) {
      variables[name] = value;
    }
  }
  return variables;
}

function applyCodeTheme(
  themeRoot: HTMLElement,
  styles: {
    rootStyle: CSSStyleDeclaration;
    codeStyle: CSSStyleDeclaration;
    preStyle: CSSStyleDeclaration;
  }
): void {
  const preFg = firstDefinedColor(
    styles.preStyle.color,
    styles.rootStyle.color,
    'inherit'
  );
  const preBg = firstOpaqueColor(
    styles.preStyle.backgroundColor,
    'rgba(0, 0, 0, 0)'
  );
  const preBorder = firstOpaqueColor(
    styles.preStyle.borderTopColor,
    'rgba(0, 0, 0, 0)'
  );
  const inlineFg = firstDefinedColor(
    styles.codeStyle.color,
    styles.rootStyle.color,
    'inherit'
  );
  const inlineBg = firstOpaqueColor(
    styles.codeStyle.backgroundColor,
    preBg,
    'rgba(0, 0, 0, 0)'
  );

  themeRoot.style.setProperty('--omv-active-pre-fg', preFg);
  themeRoot.style.setProperty('--omv-active-pre-bg', preBg);
  themeRoot.style.setProperty('--omv-active-pre-border', preBorder);
  themeRoot.style.setProperty(
    '--omv-active-pre-radius',
    styles.preStyle.borderRadius || '8px'
  );
  themeRoot.style.setProperty('--omv-active-inline-code-fg', inlineFg);
  themeRoot.style.setProperty('--omv-active-inline-code-bg', inlineBg);
  themeRoot.style.setProperty(
    '--omv-active-inline-code-radius',
    styles.codeStyle.borderRadius || '4px'
  );
  themeRoot.style.setProperty('--omv-code-fg', preFg);
  themeRoot.style.setProperty('--omv-code-bg', preBg);

  const syntaxVarMap = {
    '--omv-syntax-comment': '--color-prettylights-syntax-comment',
    '--omv-syntax-keyword': '--color-prettylights-syntax-keyword',
    '--omv-syntax-string': '--color-prettylights-syntax-string',
    '--omv-syntax-function': '--color-prettylights-syntax-entity',
    '--omv-syntax-class': '--color-prettylights-syntax-entity',
    '--omv-syntax-number': '--color-prettylights-syntax-constant',
    '--omv-syntax-constant': '--color-prettylights-syntax-variable',
    '--omv-syntax-property': '--color-prettylights-syntax-constant',
    '--omv-syntax-tag': '--color-prettylights-syntax-entity-tag',
    '--omv-syntax-attr-name': '--color-prettylights-syntax-constant',
    '--omv-syntax-operator': '--fgColor-default',
    '--omv-syntax-punctuation': '--fgColor-muted',
    '--omv-syntax-inserted': '--color-prettylights-syntax-markup-inserted-text',
    '--omv-syntax-deleted': '--color-prettylights-syntax-markup-deleted-text'
  } as const;

  for (const [targetVar, sourceVar] of Object.entries(syntaxVarMap)) {
    const value = styles.rootStyle.getPropertyValue(sourceVar).trim();
    if (value) {
      themeRoot.style.setProperty(targetVar, value);
    } else {
      themeRoot.style.removeProperty(targetVar);
    }
  }
}

function isTransparentColor(value: string | undefined | null): boolean {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return (
    !normalized ||
    normalized === 'transparent' ||
    normalized === 'rgba(0, 0, 0, 0)' ||
    normalized === 'rgba(0,0,0,0)'
  );
}

function firstOpaqueColor(...values: string[]): string {
  for (const value of values) {
    if (!isTransparentColor(value)) {
      return value;
    }
  }
  return values[values.length - 1] ?? 'rgb(30, 30, 30)';
}

function firstDefinedColor(...values: string[]): string {
  for (const value of values) {
    if (String(value ?? '').trim()) {
      return value;
    }
  }
  return values[values.length - 1] ?? 'rgb(204, 204, 204)';
}

function getReadableTextColorForHex(hex: string): string {
  const rgb = parseHexColor(hex);
  if (!rgb) return '#111111';
  const [r, g, b] = rgb.map((v) => v / 255);
  const linear = [r, g, b].map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  const luminance =
    0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.45 ? '#111111' : '#f5f7fa';
}

function parseHexColor(
  hex: string | undefined | null
): [number, number, number] | undefined {
  const value = String(hex ?? '')
    .trim()
    .replace(/^#/, '');
  if (!/^[\da-fA-F]{3}([\da-fA-F]{3})?$/.test(value)) return undefined;
  const full =
    value.length === 3
      ? value
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : value;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return [r, g, b];
}

function buildMermaidSvgNode(svgMarkup: string, diagramType?: string): Node {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = svgMarkup;

  // Mermaid injects an internal <style> inside the SVG. Our CSP requires a nonce for inline styles.
  const styleNonce = getBootStyleNonce();
  if (styleNonce) {
    for (const styleEl of wrapper.querySelectorAll('style')) {
      styleEl.setAttribute('nonce', styleNonce);
    }
  }

  const svg = wrapper.querySelector('svg');
  if (svg) {
    // Mermaid often emits inline sizing styles. Normalize sizing to the preview container.
    svg.removeAttribute('style');
    const hasValidViewBox =
      svg.viewBox.baseVal &&
      svg.viewBox.baseVal.width > 0 &&
      svg.viewBox.baseVal.height > 0;
    if (hasValidViewBox) {
      const viewBox = svg.viewBox.baseVal;
      const widthAttr = svg.getAttribute('width') ?? '';
      const heightAttr = svg.getAttribute('height') ?? '';
      // Several Mermaid diagram types emit percentage sizing on the root SVG. In our absolutely-positioned
      // interactive canvas that can collapse to a blank viewport. Replace % sizing with concrete viewBox size.
      if (/%$/.test(widthAttr.trim()) || /%$/.test(heightAttr.trim())) {
        svg.setAttribute('width', String(Math.ceil(viewBox.width)));
        svg.setAttribute('height', String(Math.ceil(viewBox.height)));
      }
    }
    // Some diagram types (notably sequence/class in certain Mermaid builds) depend on root width/height
    // when no viewBox is emitted. Only drop 100% width when a valid viewBox exists.
    if (svg.getAttribute('width') === '100%' && hasValidViewBox) {
      svg.removeAttribute('width');
    }
    if (svg.getAttribute('height') === '100%' && hasValidViewBox) {
      svg.removeAttribute('height');
    }
    svg.classList.add('omv-mermaid-svg');
    if (diagramType) {
      svg.setAttribute('data-omv-diagram-type', diagramType.toLowerCase());
    }
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    if (diagramType && /^pie$/i.test(diagramType)) {
      normalizePieLegendColors(svg);
    }
    styleMermaidEdgeLabelBackgrounds(svg, diagramType);
    return createMermaidInteractiveViewer(svg);
  }

  return wrapper.firstElementChild ?? document.createTextNode(svgMarkup);
}

function styleMermaidEdgeLabelBackgrounds(
  svg: SVGSVGElement,
  diagramType?: string
): void {
  // This visual patch is intended for flowchart edge labels like |sanitizeHtml=true|.
  // Applying it to sequence/class labels distorts callout/message bubbles.
  if (diagramType && !/^(flowchart|graph)$/i.test(diagramType)) {
    return;
  }
  // Keep edge-label text/layout untouched. Only enhance the background rect so labels don't clip.
  for (const rect of svg.querySelectorAll<SVGRectElement>(
    'g.edgeLabel rect.labelBkg'
  )) {
    const x = Number.parseFloat(rect.getAttribute('x') ?? '');
    const y = Number.parseFloat(rect.getAttribute('y') ?? '');
    const width = Number.parseFloat(rect.getAttribute('width') ?? '');
    const height = Number.parseFloat(rect.getAttribute('height') ?? '');
    if (![x, y, width, height].every(Number.isFinite)) continue;

    const padX = 6;
    const padY = 3;
    rect.setAttribute('x', String(x - padX));
    rect.setAttribute('y', String(y - padY));
    rect.setAttribute('width', String(width + padX * 2));
    rect.setAttribute('height', String(height + padY * 2));

    const rx = Number.parseFloat(rect.getAttribute('rx') ?? '');
    const ry = Number.parseFloat(rect.getAttribute('ry') ?? '');
    rect.setAttribute('rx', String(Number.isFinite(rx) ? Math.max(rx, 8) : 8));
    rect.setAttribute('ry', String(Number.isFinite(ry) ? Math.max(ry, 8) : 8));
    rect.classList.add('omv-edge-label-bkg');
    rect.setAttribute('data-omv-edge-label-bkg', 'true');
  }
}

function normalizePieLegendColors(svg: SVGSVGElement): void {
  // Mermaid pie slices use SVG attrs, but legend swatches are often emitted via inline style()
  // and can lose color under strict sanitization. Reapply legend colors from slice fills.
  const sliceFills = Array.from(
    svg.querySelectorAll<SVGPathElement>('path.pieCircle')
  )
    .map((path) => path.getAttribute('fill') || path.style.fill || '')
    .filter((value) => value.trim().length > 0);
  if (sliceFills.length === 0) return;

  const legendRects = svg.querySelectorAll<SVGRectElement>('g.legend rect');
  legendRects.forEach((rect, index) => {
    const color = sliceFills[index % sliceFills.length];
    if (!color) return;
    rect.setAttribute('fill', color);
    rect.setAttribute('stroke', color);
    rect.style.fill = color;
    rect.style.stroke = color;
  });
}

function buildMermaidErrorNode(
  code: string,
  error: unknown,
  hints: string[] = []
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'omv-mermaid-error';

  const title = document.createElement('div');
  title.className = 'omv-mermaid-error-title';
  title.textContent = `Mermaid render failed (${detectMermaidDiagramType(code)})`;

  const msg = document.createElement('div');
  msg.className = 'omv-mermaid-error-message';
  msg.textContent = getErrorMessage(error);

  const pre = document.createElement('pre');
  pre.className = 'omv-mermaid-error-source';
  pre.textContent = code;

  if (hints.length > 0) {
    const hintBox = document.createElement('div');
    hintBox.className = 'omv-mermaid-error-hints';
    const label = document.createElement('div');
    label.className = 'omv-mermaid-error-hints-title';
    label.textContent = 'Syntax hints';
    const list = document.createElement('ul');
    list.className = 'omv-mermaid-error-hints-list';
    for (const hint of hints) {
      const item = document.createElement('li');
      item.textContent = hint;
      list.appendChild(item);
    }
    hintBox.append(label, list);
    root.append(title, msg, hintBox, pre);
    return root;
  }

  root.append(title, msg, pre);
  return root;
}

function buildMermaidLoadingNode(diagramType: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'omv-mermaid-loading';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');

  const spinner = document.createElement('span');
  spinner.className = 'omv-mermaid-loading-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'omv-mermaid-loading-label';
  label.textContent = `Rendering ${diagramType || 'mermaid'} diagram…`;

  root.append(spinner, label);
  return root;
}

function detectMermaidDiagramType(code: string | undefined | null): string {
  const first = String(code ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!first) return 'unknown';
  const match = /^([a-zA-Z][\w-]*)/.exec(first);
  return match?.[1] ?? 'unknown';
}

function buildMermaidRecoveryAttempt(
  code: string,
  diagramType: string
): MermaidRecoveryAttempt | undefined {
  const normalizedType = diagramType.trim().toLowerCase();
  if (/^requirement(diagram)?$/i.test(normalizedType)) {
    const normalized = normalizeRequirementDiagramSyntax(code);
    if (normalized !== code) {
      return {
        code: normalized,
        strategy: 'requirement-diagram-normalization'
      };
    }
    return undefined;
  }

  if (normalizedType === 'block-beta') {
    const normalized = normalizeBlockBetaNodeLabels(code);
    if (normalized !== code) {
      return { code: normalized, strategy: 'block-beta-label-normalization' };
    }
  }

  return undefined;
}

function normalizeRequirementDiagramSyntax(code: string): string {
  const keyNormalized = code
    .replace(/\bverifymethod\b/g, 'verifyMethod')
    .replace(/\bdocref\b/g, 'docRef');

  const lines = keyNormalized.split(/\r?\n/u).map((line) => {
    const match = /^(\s*)(id|text|name|docRef)\s*:\s*(.+?)\s*$/u.exec(line);
    if (!match) return line;
    const [, indent, key, rawValue] = match;
    const unquoted = rawValue.replace(/^"(.*)"$/u, '$1').trim();
    if (key === 'id') {
      const sanitized = unquoted.replace(/[^\w]/g, '');
      return sanitized ? `${indent}${key}: ${sanitized}` : line;
    }

    if (!unquoted) return line;
    const escaped = unquoted.replace(/"/g, '\\"');
    return `${indent}${key}: "${escaped}"`;
  });
  return lines.join('\n');
}

function normalizeBlockBetaNodeLabels(code: string): string {
  const lines = code.split(/\r?\n/u).map((line) => {
    const match = /^(\s*)([A-Za-z_][\w-]*)\[(.+)\]\s*$/u.exec(line);
    if (!match) return line;
    const [, indent, nodeId, rawLabel] = match;
    const label = rawLabel.replace(/^"(.*)"$/u, '$1').trim();
    return `${indent}${nodeId}|${label}|`;
  });
  return lines.join('\n');
}

function buildMermaidErrorHints(
  code: string,
  diagramType: string,
  error: unknown
): string[] {
  const hints: string[] = [];
  const normalizedType = diagramType.trim().toLowerCase();
  const message = getErrorMessage(error);

  if (/^(flowchart|graph)$/i.test(normalizedType)) {
    if (/\[[^\n]*\[\][^\n]*\]/u.test(code)) {
      hints.push(
        'Flowchart labels with raw [] often fail inside A[...]. Use quoted labels: A["..."].'
      );
    }
  }

  if (/^requirement(diagram)?$/i.test(normalizedType)) {
    if (/\bverifymethod\b/i.test(code)) {
      hints.push('Use `verifyMethod` (camelCase), not `verifymethod`.');
    }
    if (/\bdocref\b/i.test(code)) {
      hints.push('Use `docRef` (camelCase), not `docref`.');
    }
    if (/^\s*id\s*:\s*[^"\n]*-[^"\n]*$/mu.test(code)) {
      hints.push(
        'Use alphanumeric requirement IDs (for example `REQ1`) instead of `REQ-1`.'
      );
    }
    if (/^\s*text\s*:\s*[^"\n]+\s+[^"\n]+$/mu.test(code)) {
      hints.push(
        'Quote multi-word `text:` values, e.g. `text: "render markdown offline"`.'
      );
    }
  }

  if (normalizedType === 'block-beta') {
    if (/^[ \t]*[A-Za-z_][\w-]*\[[^\]]+\]/mu.test(code)) {
      hints.push(
        '`block-beta` does not use flowchart node syntax like `A[Label]`; use `A|Label|` or plain `A`.'
      );
    }
  }

  if (hints.length === 0 && /syntax error/i.test(message)) {
    hints.push(
      'This parser error is generic. Validate the snippet with Mermaid 11.12.x syntax rules.'
    );
  }

  return Array.from(new Set(hints));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  try {
    const text = JSON.stringify(error);
    return text && text !== '{}' ? text : 'Unknown Mermaid error';
  } catch {
    return 'Unknown Mermaid error';
  }
}

function createMermaidInteractiveViewer(svg: SVGSVGElement): HTMLElement {
  const root = document.createElement('div');
  root.className = 'omv-mermaid-interactive';

  const toolbar = document.createElement('div');
  toolbar.className = 'omv-mermaid-toolbar';

  const viewport = document.createElement('div');
  viewport.className = 'omv-mermaid-viewport';
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'group');
  viewport.setAttribute(
    'aria-label',
    'Mermaid diagram viewer. Drag to pan. Ctrl or Cmd + wheel to zoom.'
  );

  const canvas = document.createElement('div');
  canvas.className = 'omv-mermaid-canvas';
  canvas.appendChild(svg);
  viewport.appendChild(canvas);

  const hint = document.createElement('span');
  hint.className = 'omv-mermaid-hint';
  hint.textContent = 'Drag to pan · Ctrl/Cmd+Wheel to zoom';

  const state = {
    scale: 1,
    tx: 0,
    ty: 0,
    minScale: 0.2,
    maxScale: 4,
    dragging: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    startTx: 0,
    startTy: 0,
    touched: false
  };

  const natural = getSvgNaturalSize(svg);
  viewport.style.height = `${Math.round(clamp(natural.height + 20, 220, 520))}px`;

  const applyTransform = () => {
    const clamped = clampPan(
      { tx: state.tx, ty: state.ty },
      viewport,
      natural,
      state.scale
    );
    state.tx = clamped.tx;
    state.ty = clamped.ty;
    canvas.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
  };

  const fitToViewport = (markUntouched = false) => {
    const vw = Math.max(1, viewport.clientWidth - 16);
    const vh = Math.max(1, viewport.clientHeight - 16);
    const fitScale = Math.min(1, vw / natural.width, vh / natural.height);
    state.scale = clamp(fitScale || 1, state.minScale, state.maxScale);
    const contentW = natural.width * state.scale;
    const contentH = natural.height * state.scale;
    state.tx = Math.max(8, (viewport.clientWidth - contentW) / 2);
    state.ty = Math.max(8, (viewport.clientHeight - contentH) / 2);
    if (markUntouched) state.touched = false;
    applyTransform();
  };

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const rect = viewport.getBoundingClientRect();
    const anchorX = clientX ?? rect.left + rect.width / 2;
    const anchorY = clientY ?? rect.top + rect.height / 2;
    const localX = anchorX - rect.left;
    const localY = anchorY - rect.top;
    const prevScale = state.scale;
    const nextScale = clamp(prevScale * factor, state.minScale, state.maxScale);
    if (Math.abs(nextScale - prevScale) < 0.0001) return;
    const worldX = (localX - state.tx) / prevScale;
    const worldY = (localY - state.ty) / prevScale;
    state.scale = nextScale;
    state.tx = localX - worldX * nextScale;
    state.ty = localY - worldY * nextScale;
    state.touched = true;
    applyTransform();
  };

  const setOneToOne = () => {
    state.scale = 1;
    state.tx = 8;
    state.ty = 8;
    state.touched = true;
    applyTransform();
  };

  toolbar.append(
    button('−', 'Zoom out', () => zoomAt(1 / 1.2)),
    button('+', 'Zoom in', () => zoomAt(1.2)),
    button('Fit', 'Fit diagram to viewport', () => {
      state.touched = true;
      fitToViewport();
    }),
    button('100%', 'Reset to original size', setOneToOne),
    hint
  );

  viewport.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(factor, event.clientX, event.clientY);
    },
    { passive: false }
  );

  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    state.dragging = true;
    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.startTx = state.tx;
    state.startTy = state.ty;
    state.touched = true;
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-dragging');
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!state.dragging || event.pointerId !== state.pointerId) return;
    state.tx = state.startTx + (event.clientX - state.startX);
    state.ty = state.startTy + (event.clientY - state.startY);
    applyTransform();
  });

  const endDrag = (event: PointerEvent) => {
    if (!state.dragging || event.pointerId !== state.pointerId) return;
    state.dragging = false;
    viewport.classList.remove('is-dragging');
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
  };

  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('dblclick', () => fitToViewport());
  viewport.addEventListener('keydown', (event) => {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomAt(1.2);
    } else if (event.key === '-') {
      event.preventDefault();
      zoomAt(1 / 1.2);
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      fitToViewport();
    } else if (event.key === '0') {
      event.preventDefault();
      setOneToOne();
    }
  });

  root.append(toolbar, viewport);
  requestAnimationFrame(() => {
    normalizeSvgViewBoxFromContent(svg);
    fitToViewport(true);
  });
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(() => {
      if (!state.touched) {
        fitToViewport(true);
      } else {
        applyTransform();
      }
    });
    observer.observe(viewport);
  }
  return root;
}

function normalizeSvgViewBoxFromContent(svg: SVGSVGElement): void {
  const vb = svg.viewBox.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return;
  }
  try {
    const bbox = svg.getBBox();
    if (
      !Number.isFinite(bbox.width) ||
      !Number.isFinite(bbox.height) ||
      bbox.width <= 0 ||
      bbox.height <= 0
    ) {
      return;
    }
    const pad = 8;
    const x = Math.floor(bbox.x - pad);
    const y = Math.floor(bbox.y - pad);
    const width = Math.ceil(bbox.width + pad * 2);
    const height = Math.ceil(bbox.height + pad * 2);
    svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);

    const widthAttr = svg.getAttribute('width') ?? '';
    const heightAttr = svg.getAttribute('height') ?? '';
    if (!widthAttr || /%/.test(widthAttr)) {
      svg.setAttribute('width', String(width));
    }
    if (!heightAttr || /%/.test(heightAttr)) {
      svg.setAttribute('height', String(height));
    }
  } catch {
    // Some SVGs cannot be measured until later; the viewer will still attempt best-effort sizing.
  }
}

function button(
  label: string,
  title: string,
  onClick: () => void
): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'omv-mermaid-btn';
  el.textContent = label;
  el.title = title;
  el.addEventListener('click', onClick);
  return el;
}

function getSvgNaturalSize(svg: SVGSVGElement): {
  width: number;
  height: number;
} {
  const viewBox = svg.viewBox.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }
  const widthAttr = Number.parseFloat(svg.getAttribute('width') ?? '');
  const heightAttr = Number.parseFloat(svg.getAttribute('height') ?? '');
  return {
    width: Number.isFinite(widthAttr) && widthAttr > 0 ? widthAttr : 800,
    height: Number.isFinite(heightAttr) && heightAttr > 0 ? heightAttr : 500
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampPan(
  point: { tx: number; ty: number },
  viewport: HTMLElement,
  natural: { width: number; height: number },
  scale: number
): { tx: number; ty: number } {
  const pad = 8;
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  const cw = natural.width * scale;
  const ch = natural.height * scale;

  let tx = point.tx;
  let ty = point.ty;

  if (cw + pad * 2 <= vw) {
    tx = (vw - cw) / 2;
  } else {
    tx = clamp(tx, vw - cw - pad, pad);
  }

  if (ch + pad * 2 <= vh) {
    ty = (vh - ch) / 2;
  } else {
    ty = clamp(ty, vh - ch - pad, pad);
  }

  return { tx, ty };
}

function getBootStyleNonce(): string | undefined {
  const boot = (window as Window & { __OMV_BOOT__?: { styleNonce?: string } })
    .__OMV_BOOT__;
  return boot?.styleNonce;
}

function resolveThemeColor(
  token: string,
  property: 'color' | 'backgroundColor' | 'borderTopColor',
  fallback: string
): string {
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.width = '0';
  probe.style.height = '0';
  probe.style.overflow = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.opacity = '0';
  probe.style.setProperty(
    property === 'borderTopColor' ? 'border-top-color' : property,
    token
  );
  if (property === 'borderTopColor') {
    probe.style.borderTopStyle = 'solid';
    probe.style.borderTopWidth = '1px';
  }
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe);
  const resolved =
    property === 'borderTopColor'
      ? computed.borderTopColor
      : property === 'backgroundColor'
        ? computed.backgroundColor
        : computed.color;
  probe.remove();
  return resolved && !/^rgba?\(0,\s*0,\s*0(?:,\s*0)?\)$/i.test(resolved)
    ? resolved
    : fallback;
}

function decodeBase64(value: string): string {
  try {
    return decodeURIComponent(
      Array.from(atob(value))
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join('')
    );
  } catch {
    return '';
  }
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) {
      (
        window as Window & { requestIdleCallback: (cb: () => void) => number }
      ).requestIdleCallback(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

type TableAlignment = Array<'left' | 'center' | 'right' | undefined>;

function extractTableAlignments(rawHtml: string): TableAlignment[] {
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  return Array.from(doc.querySelectorAll('table')).map((table) => {
    const row = table.querySelector('tr');
    if (!row) return [];
    return Array.from(row.children).map((cell) =>
      readAlignment(cell as HTMLElement)
    );
  });
}

function readAlignment(
  cell: HTMLElement
): 'left' | 'center' | 'right' | undefined {
  const alignAttr =
    cell.getAttribute('data-align') || cell.getAttribute('align');
  if (alignAttr && /^(left|center|right)$/i.test(alignAttr)) {
    return alignAttr.toLowerCase() as 'left' | 'center' | 'right';
  }
  const style = cell.getAttribute('style') ?? '';
  const match = /text-align\s*:\s*(left|center|right)/i.exec(style);
  return match
    ? (match[1].toLowerCase() as 'left' | 'center' | 'right')
    : undefined;
}

function applyTableAlignments(
  root: HTMLElement,
  tableAlignments: TableAlignment[]
): void {
  const tables = root.querySelectorAll<HTMLTableElement>('table');
  tables.forEach((table, tableIndex) => {
    const aligns = tableAlignments[tableIndex] ?? [];
    if (aligns.length === 0) return;
    const rows = table.querySelectorAll('tr');
    rows.forEach((row) => {
      Array.from(row.children).forEach((cell, colIndex) => {
        const align = aligns[colIndex];
        if (!align) return;
        cell.classList.remove(
          'omv-align-left',
          'omv-align-center',
          'omv-align-right'
        );
        cell.classList.add(`omv-align-${align}`);
        (cell as HTMLElement).style.textAlign = align;
      });
    });
  });
}
