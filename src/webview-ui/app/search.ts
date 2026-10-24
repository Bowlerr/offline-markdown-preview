interface TextRun {
  root: Element;
  nodes: Text[];
  text: string;
}

interface SearchHit {
  marks: HTMLElement[];
}

// Keep phrases within a reading block, while joining inline formatting and Prism tokens.
const BLOCKS = 'p, pre, h1, h2, h3, h4, h5, h6, li, td, th, dt, dd, blockquote, div';
const EXCLUDED = 'script, style, noscript, textarea, select, button, [hidden], [aria-hidden="true"], .katex, .omv-mermaid, .omv-heading-anchor, .omv-remote-image';
export const SEARCH_RESULT_LIMIT = 1000;

export class PreviewSearch {
  private hits: SearchHit[] = [];
  private index = -1;
  private truncated = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly onCount: (count: number, index: number, truncated: boolean) => void
  ) {}

  clear(): void {
    this.removeHighlights();
    this.onCount(0, -1, false);
  }

  query(
    term: string | undefined | null,
    options: { reveal?: boolean; preserveIndex?: boolean } = {}
  ): void {
    const previousIndex = this.index;
    this.removeHighlights();
    const query = typeof term === 'string' ? term.trim() : '';
    if (!query) {
      this.onCount(0, -1, false);
      return;
    }

    const matcher = new RegExp(escapeRegExp(query), 'gi');
    for (const run of this.collectTextRuns()) {
      const matches: Array<{ start: number; end: number; hit: SearchHit }> = [];
      for (const match of run.text.matchAll(matcher)) {
        // One additional match establishes that the result is capped, without
        // constructing or laying out unbounded highlight elements.
        if (this.hits.length + matches.length === SEARCH_RESULT_LIMIT) {
          this.truncated = true;
          break;
        }
        matches.push({
          start: match.index ?? 0,
          end: (match.index ?? 0) + match[0].length,
          hit: { marks: [] }
        });
      }
      if (!matches.length) {
        if (this.truncated) break;
        continue;
      }
      for (const match of matches) this.hits.push(match.hit);

      let offset = 0;
      let matchIndex = 0;
      for (const textNode of run.nodes) {
        const value = textNode.data;
        const endOffset = offset + value.length;
        while (matches[matchIndex] && matches[matchIndex]!.end <= offset) matchIndex += 1;
        if (!matches[matchIndex]) break;
        if (matches[matchIndex]!.start >= endOffset) {
          offset = endOffset;
          continue;
        }

        const fragment = document.createDocumentFragment();
        let last = 0;
        for (let index = matchIndex; index < matches.length; index += 1) {
          const match = matches[index]!;
          if (match.start >= endOffset) break;
          const start = Math.max(0, match.start - offset);
          const end = Math.min(value.length, match.end - offset);
          if (start > last) fragment.append(document.createTextNode(value.slice(last, start)));
          const mark = document.createElement('mark');
          mark.className = 'omv-search-hit';
          mark.textContent = value.slice(start, end);
          match.hit.marks.push(mark);
          fragment.append(mark);
          last = end;
        }
        if (last < value.length) fragment.append(document.createTextNode(value.slice(last)));
        textNode.replaceWith(fragment);
        offset = endOffset;
      }
      if (this.truncated) break;
    }

    if (this.hits.length) {
      this.index = options.preserveIndex
        ? Math.min(Math.max(0, previousIndex), this.hits.length - 1)
        : 0;
      this.activateCurrent(options.reveal !== false);
    }
    this.onCount(this.hits.length, this.index, this.truncated);
  }

  next(): void {
    this.move(1);
  }

  prev(): void {
    this.move(-1);
  }

  private move(direction: number): void {
    if (!this.hits.length) return;
    for (const mark of this.hits[this.index]?.marks ?? []) mark.removeAttribute('aria-current');
    this.index = (this.index + direction + this.hits.length) % this.hits.length;
    this.activateCurrent(true);
    this.onCount(this.hits.length, this.index, this.truncated);
  }

  private activateCurrent(reveal: boolean): void {
    const hit = this.hits[this.index];
    for (const mark of hit?.marks ?? []) mark.setAttribute('aria-current', 'true');
    if (reveal) hit?.marks[0]?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  private removeHighlights(): void {
    const parents = new Set<Node>();
    for (const hit of this.hits) {
      for (const mark of hit.marks) {
        const parent = mark.parentNode;
        if (!parent) continue;
        mark.replaceWith(...Array.from(mark.childNodes));
        parents.add(parent);
      }
    }
    for (const parent of parents) parent.normalize();
    this.hits = [];
    this.index = -1;
    this.truncated = false;
  }

  private *collectTextRuns(): Generator<TextRun> {
    let current: TextRun | undefined;
    const walker = document.createTreeWalker(
      this.container,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node instanceof Element && node.matches(EXCLUDED)) return NodeFilter.FILTER_REJECT;
          // SVG text needs SVG elements, not HTML mark wrappers.
          if (node instanceof Element && node.namespaceURI !== 'http://www.w3.org/1999/xhtml') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node instanceof Element) {
        if (node.matches(BLOCKS) || node.tagName === 'BR') {
          if (current) yield current;
          current = undefined;
        }
        continue;
      }
      if (!(node instanceof Text) || !node.data) continue;
      const root = node.parentElement?.closest(BLOCKS) ?? this.container;
      if (!current || current.root !== root) {
        if (current) yield current;
        current = { root, nodes: [], text: '' };
      }
      current.nodes.push(node);
      current.text += node.data;
    }
    if (current) yield current;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
