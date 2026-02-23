export interface ScrollSyncBridge {
  postPreviewScroll(percent: number, line?: number): void;
}

interface LineMarkerMetric {
  line: number;
  endLine?: number;
  top: number;
  height: number;
}

export class ScrollSyncController {
  private ignoreScrollUntil = 0;
  private raf = 0;
  private markerCache:
    | Array<{
        el: HTMLElement;
        line: number;
        endLine?: number;
      }>
    | undefined;
  private markerCacheDirty = true;
  private readonly mutationObserver: MutationObserver;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly markerRoot: HTMLElement,
    private readonly bridge: ScrollSyncBridge
  ) {
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.mutationObserver = new MutationObserver(() => {
      this.markerCacheDirty = true;
    });
    this.mutationObserver.observe(this.markerRoot, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-source-line', 'data-source-line-end', 'style', 'class']
    });
    window.addEventListener('resize', () => {
      this.markerCacheDirty = true;
    });
  }

  applyEditorScroll(percent: number, line?: number): void {
    const max = Math.max(0, this.scroller.scrollHeight - this.scroller.clientHeight);
    this.ignoreScrollUntil = performance.now() + 200;
    const mappedScrollTop = Number.isInteger(line) ? this.estimateScrollTopForLine(line as number) : undefined;
    this.scroller.scrollTop = Math.round(
      Math.min(max, Math.max(0, mappedScrollTop ?? percent * max))
    );
  }

  scrollHeadingIntoView(id: string): void {
    const el = this.scroller.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!el) return;
    this.ignoreScrollUntil = performance.now() + 300;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  private onScroll(): void {
    if (performance.now() < this.ignoreScrollUntil) return;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const max = Math.max(1, this.scroller.scrollHeight - this.scroller.clientHeight);
      const percent = Math.min(1, Math.max(0, this.scroller.scrollTop / max));
      const line = this.estimateLineAtScrollTop(this.scroller.scrollTop);
      this.bridge.postPreviewScroll(percent, line);
    });
  }

  private getMarkers(): Array<{ el: HTMLElement; line: number; endLine?: number }> {
    if (!this.markerCache || this.markerCacheDirty) {
      this.markerCache = Array.from(this.markerRoot.querySelectorAll<HTMLElement>('[data-source-line]'))
        .map((el) => {
          const line = Number.parseInt(el.getAttribute('data-source-line') ?? '', 10);
          const endLine = Number.parseInt(el.getAttribute('data-source-line-end') ?? '', 10);
          if (!Number.isFinite(line)) return undefined;
          return {
            el,
            line,
            endLine: Number.isFinite(endLine) && endLine > line ? endLine : undefined
          };
        })
        .filter((value): value is { el: HTMLElement; line: number; endLine?: number } => Boolean(value))
        .sort((a, b) => a.line - b.line || compareDomPosition(a.el, b.el));
      this.markerCacheDirty = false;
    }
    return this.markerCache;
  }

  private getMarkerMetrics(): LineMarkerMetric[] {
    const markers = this.getMarkers();
    if (markers.length === 0) return [];
    const scrollerRect = this.scroller.getBoundingClientRect();
    const baseScrollTop = this.scroller.scrollTop;
    return markers
      .map((marker) => {
        const rect = marker.el.getBoundingClientRect();
        const top = rect.top - scrollerRect.top + baseScrollTop;
        const height = Math.max(1, rect.height || marker.el.offsetHeight || 1);
        return {
          line: marker.line,
          endLine: marker.endLine,
          top,
          height
        };
      })
      .filter((m) => Number.isFinite(m.top) && Number.isFinite(m.height))
      .sort((a, b) => a.top - b.top || a.line - b.line);
  }

  private estimateScrollTopForLine(line: number): number | undefined {
    const metrics = this.getMarkerMetrics();
    if (metrics.length === 0) return undefined;

    let prev = metrics[0];
    let next: LineMarkerMetric | undefined;
    for (let i = 1; i < metrics.length; i += 1) {
      const candidate = metrics[i];
      if (candidate.line > line) {
        next = candidate;
        break;
      }
      prev = candidate;
    }

    if (prev.endLine && prev.endLine > prev.line && line >= prev.line && line < prev.endLine) {
      const ratio = (line - prev.line) / Math.max(1, prev.endLine - prev.line);
      return prev.top + ratio * prev.height;
    }

    if (next && next.line > prev.line && line >= prev.line && line <= next.line) {
      const ratio = (line - prev.line) / Math.max(1, next.line - prev.line);
      return prev.top + ratio * (next.top - prev.top);
    }

    return prev.top;
  }

  private estimateLineAtScrollTop(scrollTop: number): number | undefined {
    const metrics = this.getMarkerMetrics();
    if (metrics.length === 0) return undefined;

    let prev = metrics[0];
    let next: LineMarkerMetric | undefined;
    for (let i = 1; i < metrics.length; i += 1) {
      const candidate = metrics[i];
      if (candidate.top > scrollTop) {
        next = candidate;
        break;
      }
      prev = candidate;
    }

    if (prev.endLine && prev.endLine > prev.line && scrollTop >= prev.top && scrollTop <= prev.top + prev.height) {
      const ratio = (scrollTop - prev.top) / Math.max(1, prev.height);
      return Math.round(prev.line + ratio * (prev.endLine - prev.line));
    }

    if (next && next.top > prev.top) {
      const ratio = (scrollTop - prev.top) / Math.max(1, next.top - prev.top);
      return Math.round(prev.line + ratio * (next.line - prev.line));
    }

    return prev.line;
  }
}

function compareDomPosition(a: HTMLElement, b: HTMLElement): number {
  if (a === b) return 0;
  const pos = a.compareDocumentPosition(b);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}
