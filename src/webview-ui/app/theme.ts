import {
  getThemeKindFromBodyClass,
  normalizeObservedBodyClass,
  shouldRefreshTheme
} from './themeUtils';

export function initTheme(onChange?: () => void): void {
  let previousBodyClass: string | undefined;

  const apply = () => {
    const body = document.body;
    const nextBodyClass = normalizeObservedBodyClass(body.className);
    body.className = nextBodyClass;
    const nextThemeKind = getThemeKindFromBodyClass(nextBodyClass);
    body.dataset.vscodeThemeKind = nextThemeKind;
    if (shouldRefreshTheme(previousBodyClass, nextBodyClass)) {
      onChange?.();
    }
    previousBodyClass = nextBodyClass;
  };

  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });
}
