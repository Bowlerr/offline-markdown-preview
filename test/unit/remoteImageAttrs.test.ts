import { describe, expect, it } from 'vitest';

import {
  markRemoteImagePreviewHidden,
  restoreRemoteImageExportVisibility
} from '../../src/webview-ui/app/remoteImageAttrs';

class FakeImageElement {
  private readonly attrs = new Map<string, string>();
  private hiddenValue = false;

  constructor(initialAttrs: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(initialAttrs)) {
      this.setAttribute(name, value);
    }
  }

  get hidden(): boolean {
    return this.hiddenValue;
  }

  set hidden(value: boolean) {
    this.hiddenValue = value;
    if (value) {
      this.attrs.set('hidden', '');
    } else {
      this.attrs.delete('hidden');
    }
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    if (name === 'hidden') {
      this.hiddenValue = true;
    }
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
    if (name === 'hidden') {
      this.hiddenValue = false;
    }
  }
}

describe('remoteImageAttrs', () => {
  it('preserves authored hidden attrs when restoring export visibility', () => {
    const image = new FakeImageElement({ hidden: '' });

    markRemoteImagePreviewHidden(image);
    restoreRemoteImageExportVisibility(image);

    expect(image.hidden).toBe(true);
    expect(image.hasAttribute('hidden')).toBe(true);
    expect(image.getAttribute('aria-hidden')).toBeNull();
    expect(image.getAttribute('data-omv-preview-hidden')).toBeNull();
    expect(
      image.getAttribute('data-omv-preview-restore-aria-hidden')
    ).toBeNull();
  });

  it('restores preview-added hidden and original aria-hidden values', () => {
    const image = new FakeImageElement({ 'aria-hidden': 'false' });

    markRemoteImagePreviewHidden(image);
    restoreRemoteImageExportVisibility(image);

    expect(image.hidden).toBe(false);
    expect(image.hasAttribute('hidden')).toBe(false);
    expect(image.getAttribute('aria-hidden')).toBe('false');
    expect(image.getAttribute('data-omv-preview-hidden')).toBeNull();
    expect(
      image.getAttribute('data-omv-preview-restore-aria-hidden')
    ).toBeNull();
  });
});
