export function initTheme(): void {
  const apply = () => {
    const body = document.body;
    const cls = body.className;
    body.dataset.vscodeThemeKind = cls.includes('vscode-high-contrast')
      ? 'high-contrast'
      : cls.includes('vscode-dark')
        ? 'dark'
        : 'light';
  };

  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
