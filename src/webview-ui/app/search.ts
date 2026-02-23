export class PreviewSearch {
  private hits: HTMLElement[] = [];
  private index = -1;

  constructor(private readonly container: HTMLElement, private readonly onCount: (count: number, index: number) => void) {}

  clear(): void {
    for (const el of this.hits) {
      const parent = el.parentNode;
      if (!parent) continue;
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
      parent.normalize();
    }
    this.hits = [];
    this.index = -1;
    this.onCount(0, -1);
  }

  query(term: string | undefined | null): void {
    this.clear();
    const q = typeof term === 'string' ? term.trim() : '';
    if (!q) return;
    const matcher = new RegExp(escapeRegExp(q), 'gi');
    const walker = document.createTreeWalker(this.container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('script, style, pre')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      if (n.nodeType === Node.TEXT_NODE) {
        textNodes.push(n as Text);
      }
    }

    for (const textNode of textNodes) {
      const value = textNode.nodeValue ?? '';
      matcher.lastIndex = 0;
      if (!matcher.test(value)) continue;
      matcher.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const match of value.matchAll(matcher)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        if (start > last) {
          frag.appendChild(document.createTextNode(value.slice(last, start)));
        }
        const mark = document.createElement('mark');
        mark.className = 'omv-search-hit';
        mark.textContent = value.slice(start, end);
        this.hits.push(mark);
        frag.appendChild(mark);
        last = end;
      }
      if (last < value.length) {
        frag.appendChild(document.createTextNode(value.slice(last)));
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }

    if (this.hits.length > 0) {
      this.index = 0;
      this.focusCurrent();
    }
    this.onCount(this.hits.length, this.index);
  }

  next(): void {
    if (this.hits.length === 0) return;
    this.index = (this.index + 1) % this.hits.length;
    this.focusCurrent();
    this.onCount(this.hits.length, this.index);
  }

  prev(): void {
    if (this.hits.length === 0) return;
    this.index = (this.index - 1 + this.hits.length) % this.hits.length;
    this.focusCurrent();
    this.onCount(this.hits.length, this.index);
  }

  private focusCurrent(): void {
    for (const [i, el] of this.hits.entries()) {
      if (i === this.index) {
        el.setAttribute('aria-current', 'true');
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
      } else {
        el.removeAttribute('aria-current');
      }
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
