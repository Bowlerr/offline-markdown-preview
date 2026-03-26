export type PreviewThemeKind = 'light' | 'dark' | 'high-contrast';

export function getThemeKindFromBodyClass(
  className: string
): PreviewThemeKind {
  if (className.includes('vscode-high-contrast')) {
    return 'high-contrast';
  }
  if (className.includes('vscode-dark')) {
    return 'dark';
  }
  return 'light';
}

export function normalizeObservedBodyClass(className: string): string {
  const classNames = new Set(
    className
      .split(/\s+/u)
      .map((value) => value.trim())
      .filter(Boolean)
  );

  const hasHighContrastLight = [...classNames].some(
    (value) =>
      value === 'vscode-high-contrast-light' ||
      value.includes('vscode-high-contrast-light')
  );
  const hasHighContrast = [...classNames].some(
    (value) =>
      value === 'vscode-high-contrast' ||
      value.includes('vscode-high-contrast')
  );

  classNames.add('vscode-body');
  if (hasHighContrastLight) {
    classNames.add('vscode-high-contrast');
    classNames.add('vscode-light');
  } else if (hasHighContrast) {
    classNames.add('vscode-dark');
  }
  return [...classNames].sort().join(' ');
}

export function shouldRefreshTheme(
  previousBodyClass: string | undefined,
  nextBodyClass: string
): boolean {
  return Boolean(previousBodyClass && previousBodyClass !== nextBodyClass);
}

export function getEffectiveMermaidThemeKind(
  backgroundColor: string,
  fallbackThemeKind: PreviewThemeKind
): PreviewThemeKind {
  if (fallbackThemeKind === 'high-contrast') {
    return 'high-contrast';
  }
  return isDarkColor(backgroundColor) ? 'dark' : 'light';
}

function isDarkColor(value: string): boolean {
  const rgb = parseCssColor(value);
  if (!rgb) {
    return false;
  }

  const [r, g, b] = rgb.map((channel) => channel / 255);
  const linear = [r, g, b].map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  const luminance =
    0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance < 0.45;
}

function parseCssColor(value: string): [number, number, number] | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const rgbMatch = normalized.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*[\d.]+\s*)?\)$/
  );
  if (rgbMatch) {
    return [
      Number.parseFloat(rgbMatch[1]),
      Number.parseFloat(rgbMatch[2]),
      Number.parseFloat(rgbMatch[3])
    ];
  }

  return parseHexColor(normalized);
}

function parseHexColor(
  hex: string | undefined | null
): [number, number, number] | undefined {
  const value = String(hex ?? '')
    .trim()
    .replace(/^#/, '');
  if (!/^[\da-fA-F]{3}([\da-fA-F]{3})?$/.test(value)) {
    return undefined;
  }

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
