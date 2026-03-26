const PREVIEW_HIDDEN_MARKER = 'data-omv-preview-hidden';
const PREVIEW_ARIA_HIDDEN_RESTORE_MARKER =
  'data-omv-preview-restore-aria-hidden';
const MISSING_ARIA_HIDDEN = '__omv_missing__';

interface ImageAttributeTarget {
  hidden: boolean;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export function markRemoteImagePreviewHidden(
  image: ImageAttributeTarget
): void {
  if (!image.hasAttribute('hidden')) {
    image.setAttribute(PREVIEW_HIDDEN_MARKER, '1');
  }

  const originalAriaHidden = image.getAttribute('aria-hidden');
  if (originalAriaHidden !== 'true') {
    image.setAttribute(
      PREVIEW_ARIA_HIDDEN_RESTORE_MARKER,
      originalAriaHidden ?? MISSING_ARIA_HIDDEN
    );
  }

  image.hidden = true;
  image.setAttribute('aria-hidden', 'true');
}

export function restoreRemoteImageExportVisibility(
  image: ImageAttributeTarget
): void {
  if (image.getAttribute(PREVIEW_HIDDEN_MARKER) === '1') {
    image.hidden = false;
    image.removeAttribute('hidden');
  }

  const restoreAriaHidden = image.getAttribute(
    PREVIEW_ARIA_HIDDEN_RESTORE_MARKER
  );
  if (restoreAriaHidden === MISSING_ARIA_HIDDEN) {
    image.removeAttribute('aria-hidden');
  } else if (restoreAriaHidden !== null) {
    image.setAttribute('aria-hidden', restoreAriaHidden);
  }

  image.removeAttribute(PREVIEW_HIDDEN_MARKER);
  image.removeAttribute(PREVIEW_ARIA_HIDDEN_RESTORE_MARKER);
}
