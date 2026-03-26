import { describe, expect, it } from 'vitest';

import {
  getEffectiveMermaidThemeKind,
  getThemeKindFromBodyClass,
  normalizeObservedBodyClass,
  shouldRefreshTheme
} from '../../src/webview-ui/app/themeUtils';

describe('theme utils', () => {
  it('normalizes observed body classes and keeps vscode-body present', () => {
    expect(
      normalizeObservedBodyClass('vscode-light theme-a custom-class')
    ).toBe('custom-class theme-a vscode-body vscode-light');
  });

  it('adds a light or dark class for high-contrast body classes', () => {
    expect(normalizeObservedBodyClass('theme-a vscode-high-contrast')).toBe(
      'theme-a vscode-body vscode-dark vscode-high-contrast'
    );
    expect(
      normalizeObservedBodyClass('theme-b vscode-high-contrast-light')
    ).toBe(
      'theme-b vscode-body vscode-high-contrast vscode-high-contrast-light vscode-light'
    );
  });

  it('keeps theme kind detection stable after normalization', () => {
    expect(
      getThemeKindFromBodyClass(
        normalizeObservedBodyClass('theme-a vscode-light')
      )
    ).toBe('light');
    expect(
      getThemeKindFromBodyClass(
        normalizeObservedBodyClass('theme-b vscode-dark')
      )
    ).toBe('dark');
    expect(
      getThemeKindFromBodyClass(
        normalizeObservedBodyClass('theme-c vscode-high-contrast')
      )
    ).toBe('high-contrast');
  });

  it('refreshes when the observed theme classes change within the same theme kind', () => {
    const previous = normalizeObservedBodyClass('theme-a vscode-light');
    const next = normalizeObservedBodyClass('theme-b vscode-light');

    expect(shouldRefreshTheme(undefined, previous)).toBe(false);
    expect(shouldRefreshTheme(previous, previous)).toBe(false);
    expect(shouldRefreshTheme(previous, next)).toBe(true);
  });

  it('preserves high-contrast Mermaid styling on light high-contrast themes', () => {
    expect(
      getEffectiveMermaidThemeKind('rgb(255, 255, 255)', 'high-contrast')
    ).toBe('high-contrast');
  });

  it('uses background luminance for non-high-contrast Mermaid themes', () => {
    expect(getEffectiveMermaidThemeKind('rgb(255, 255, 255)', 'light')).toBe(
      'light'
    );
    expect(getEffectiveMermaidThemeKind('rgb(30, 30, 30)', 'light')).toBe(
      'dark'
    );
  });
});
