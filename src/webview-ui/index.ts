import './assets/styles.css';
import 'katex/dist/katex.min.css';
import './assets/katex.min.css';

import type { ExtensionToWebviewMessage, RenderPayload } from '../extension/messaging/protocol';
import { parseExtensionMessage } from '../extension/messaging/validate';
import { PreviewRenderer } from './app/renderer';
import { PreviewSearch } from './app/search';
import { ScrollSyncController } from './app/scrollSync';
import { TocView } from './app/toc';
import { initTheme } from './app/theme';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  setState(data: unknown): void;
  getState(): unknown;
};

interface ViewState {
  activeHeadingId?: string;
  searchQuery?: string;
  lastRenderRequestId?: number;
  searchUiVisible?: boolean;
  tocVisible?: boolean;
}

const vscode = acquireVsCodeApi();
blockRemoteNetworking();

const root = document.getElementById('app');
if (!root) {
  throw new Error('Missing app root');
}

root.innerHTML = `
  <div class="omv-chrome">
    <div class="omv-chrome-actions">
      <button type="button" class="omv-chrome-btn" data-ui-toggle="toc" aria-controls="omv-toc" aria-expanded="true" aria-pressed="true">Contents</button>
      <button type="button" class="omv-chrome-btn" data-ui-toggle="search" aria-controls="omv-search-toolbar" aria-expanded="true" aria-pressed="true">Search</button>
      <button type="button" class="omv-chrome-btn" data-chrome-action="export">Export</button>
    </div>
    <span class="omv-meta" aria-live="polite"></span>
  </div>
  <div class="omv-toolbar" id="omv-search-toolbar">
    <input type="search" placeholder="Search preview" aria-label="Search preview" />
    <button type="button" data-action="prev">Prev</button>
    <button type="button" data-action="next">Next</button>
    <button type="button" data-action="clear">Clear</button>
  </div>
  <div class="omv-main" id="omv-main">
    <aside class="omv-toc" id="omv-toc" aria-label="Table of contents"></aside>
    <div class="omv-preview-scroll">
      <article class="omv-preview"></article>
    </div>
  </div>
`;

const searchInput = root.querySelector<HTMLInputElement>('input[type="search"]');
const meta = root.querySelector<HTMLElement>('.omv-meta');
const tocEl = root.querySelector<HTMLElement>('.omv-toc');
const article = root.querySelector<HTMLElement>('.omv-preview');
const scroller = root.querySelector<HTMLElement>('.omv-preview-scroll');
const searchToolbar = root.querySelector<HTMLElement>('#omv-search-toolbar');
const mainLayout = root.querySelector<HTMLElement>('#omv-main');

if (!searchInput || !meta || !tocEl || !article || !scroller || !searchToolbar || !mainLayout) {
  throw new Error('Webview UI bootstrap failed');
}

const state = (vscode.getState() as ViewState | undefined) ?? {};
initTheme();

let lastRender: RenderPayload | undefined;
let searchUiVisible = state.searchUiVisible ?? true;
let tocVisible = state.tocVisible ?? true;

const renderer = new PreviewRenderer(article, {
  onOpenLink(href, kindHint) {
    vscode.postMessage({ type: 'openLink', href, kindHint });
  },
  onHeadingSelect(id) {
    renderer.setActiveHeading(id);
    toc.render(renderer.getToc(), id);
    scrollSync.scrollHeadingIntoView(id);
    vscode.postMessage({ type: 'headingSelected', headingId: id });
    persistState();
  },
  onCopyHeadingLink(id) {
    vscode.postMessage({ type: 'copyHeadingLink', headingId: id });
  },
  onOpenImage(src) {
    vscode.postMessage({ type: 'openImage', src });
  }
});

const search = new PreviewSearch(renderer.getContentElement(), (count, index) => {
  meta.textContent = count === 0 ? '' : `${index + 1}/${count}`;
});

const scrollSync = new ScrollSyncController(scroller, renderer.getContentElement(), {
  postPreviewScroll(percent, line) {
    if (!lastRender?.settings.scrollSync) return;
    vscode.postMessage({ type: 'previewScroll', percent, line });
  }
});

const toc = new TocView(tocEl, (item) => {
  renderer.setActiveHeading(item.id);
  toc.render(renderer.getToc(), item.id);
  scrollSync.scrollHeadingIntoView(item.id);
  vscode.postMessage({ type: 'headingSelected', headingId: item.id });
  persistState();
});

searchInput.value = state.searchQuery ?? '';
applyUiVisibility();
searchInput.addEventListener('input', () => {
  const query = searchInput.value;
  search.query(query);
  vscode.postMessage({ type: 'search', action: 'query', query });
  persistState();
});

for (const btn of root.querySelectorAll<HTMLButtonElement>('button[data-ui-toggle]')) {
  btn.addEventListener('click', () => {
    const target = btn.dataset.uiToggle;
    if (target === 'search') {
      setSearchUiVisible(!searchUiVisible, { focus: searchUiVisible ? false : true });
    }
    if (target === 'toc') {
      setTocVisible(!tocVisible);
    }
    persistState();
  });
}

for (const btn of root.querySelectorAll<HTMLButtonElement>('button[data-chrome-action]')) {
  btn.addEventListener('click', () => {
    const action = btn.dataset.chromeAction;
    if (action === 'export') {
      vscode.postMessage({ type: 'requestExport' });
    }
  });
}

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    search.next();
  }
});

for (const btn of root.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (action === 'next') search.next();
    if (action === 'prev') search.prev();
    if (action === 'clear') {
      searchInput.value = '';
      search.clear();
    }
    persistState();
  });
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  let message: ExtensionToWebviewMessage;
  try {
    message = parseExtensionMessage(event.data);
  } catch {
    return;
  }

  void handleMessage(message);
});

window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    setSearchUiVisible(true, { focus: true, select: true });
    persistState();
  }
});

vscode.postMessage({ type: 'ready' });

async function handleMessage(message: ExtensionToWebviewMessage): Promise<void> {
  switch (message.type) {
    case 'render': {
      lastRender = message;
      await renderer.render(message);
      toc.render(message.toc, state.activeHeadingId);
      if (searchInput.value.trim()) {
        search.query(searchInput.value);
      }
      if (state.activeHeadingId) {
        scrollSync.scrollHeadingIntoView(state.activeHeadingId);
      }
      state.lastRenderRequestId = message.requestId;
      persistState();
      break;
    }
    case 'editorScroll': {
      scrollSync.applyEditorScroll(message.percent, message.line);
      break;
    }
    case 'notify': {
      meta.textContent = message.message;
      break;
    }
    case 'searchCommand': {
      if (message.action === 'open') {
        setSearchUiVisible(true, { focus: true, select: true });
      } else if (message.action === 'next') {
        search.next();
      } else if (message.action === 'prev') {
        search.prev();
      } else {
        searchInput.value = '';
        search.clear();
      }
      persistState();
      break;
    }
    case 'exportPdf': {
      try {
        window.print();
        vscode.postMessage({ type: 'pdfExportResult', ok: true });
      } catch (error) {
        vscode.postMessage({ type: 'pdfExportResult', ok: false, error: String(error) });
      }
      break;
    }
    case 'requestHtmlExportSnapshot': {
      vscode.postMessage({
        type: 'htmlExportSnapshot',
        requestId: message.requestId,
        html: buildRenderedHtmlExportSnapshot()
      });
      break;
    }
  }
}

function persistState(): void {
  state.activeHeadingId = renderer.getActiveHeadingId();
  state.searchQuery = searchInput.value;
  state.searchUiVisible = searchUiVisible;
  state.tocVisible = tocVisible;
  vscode.setState(state);
}

function setSearchUiVisible(
  visible: boolean,
  options: { focus?: boolean; select?: boolean } = {}
): void {
  searchUiVisible = visible;
  applyUiVisibility();
  if (visible && options.focus) {
    searchInput.focus();
    if (options.select) {
      searchInput.select();
    }
  }
}

function setTocVisible(visible: boolean): void {
  tocVisible = visible;
  applyUiVisibility();
}

function applyUiVisibility(): void {
  searchToolbar.hidden = !searchUiVisible;
  mainLayout.classList.toggle('omv-toc-collapsed', !tocVisible);
  tocEl.hidden = !tocVisible;

  for (const btn of root.querySelectorAll<HTMLButtonElement>('button[data-ui-toggle="search"]')) {
    btn.setAttribute('aria-expanded', String(searchUiVisible));
    btn.setAttribute('aria-pressed', String(searchUiVisible));
    btn.classList.toggle('is-active', searchUiVisible);
  }
  for (const btn of root.querySelectorAll<HTMLButtonElement>('button[data-ui-toggle="toc"]')) {
    btn.setAttribute('aria-expanded', String(tocVisible));
    btn.setAttribute('aria-pressed', String(tocVisible));
    btn.classList.toggle('is-active', tocVisible);
  }
}

function buildRenderedHtmlExportSnapshot(): string {
  const clone = renderer.getContentElement().cloneNode(true) as HTMLElement;

  // Remove transient search highlights/selection state.
  for (const mark of clone.querySelectorAll<HTMLElement>('mark.omv-search-hit')) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  }

  // Export Mermaid as static SVG content (no preview toolbar/pan-zoom controls).
  for (const interactive of clone.querySelectorAll<HTMLElement>('.omv-mermaid-interactive')) {
    const svg = interactive.querySelector<SVGSVGElement>('svg');
    if (svg) {
      interactive.replaceWith(svg.cloneNode(true));
    } else {
      interactive.remove();
    }
  }

  // Remove preview-only state attrs.
  for (const el of clone.querySelectorAll<HTMLElement>('[aria-current],[aria-busy]')) {
    el.removeAttribute('aria-current');
    el.removeAttribute('aria-busy');
  }

  clone.normalize();
  return clone.innerHTML;
}

function blockRemoteNetworking(): void {
  const isRemote = (input: string) => /^https?:\/\//i.test(input);

  // Defense-in-depth: CSP already denies outbound connections, but we also fail fast at runtime.
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (isRemote(url)) {
      throw new Error(`Remote fetch blocked in Offline Markdown Preview: ${url}`);
    }
    return originalFetch(input, init);
  }) as typeof window.fetch;

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(method: string, url: string | URL, ...rest: unknown[]) {
    const target = typeof url === 'string' ? url : url.href;
    if (isRemote(target)) {
      throw new Error(`Remote XHR blocked in Offline Markdown Preview: ${target}`);
    }
    return (originalOpen as unknown as (...args: unknown[]) => unknown).apply(this, [
      method,
      url,
      ...rest
    ]) as void;
  };

  const WebSocketCtor = window.WebSocket;
  class BlockedWebSocket extends WebSocketCtor {
    constructor(url: string | URL, protocols?: string | string[]) {
      const href = typeof url === 'string' ? url : url.href;
      if (/^wss?:\/\//i.test(href)) {
        throw new Error(`WebSocket blocked in Offline Markdown Preview: ${href}`);
      }
      super(url, protocols);
    }
  }
  window.WebSocket = BlockedWebSocket as typeof WebSocket;

  if ('EventSource' in window) {
    const ES = window.EventSource;
    window.EventSource = class extends ES {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        const href = typeof url === 'string' ? url : url.href;
        if (isRemote(href)) {
          throw new Error(`EventSource blocked in Offline Markdown Preview: ${href}`);
        }
        super(url, eventSourceInitDict);
      }
    } as typeof EventSource;
  }
}
