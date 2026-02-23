import type { TocItem } from '../../extension/messaging/protocol';

export class TocView {
  constructor(
    private readonly root: HTMLElement,
    private readonly onClick: (item: TocItem) => void
  ) {}

  render(items: TocItem[], activeId?: string): void {
    this.root.innerHTML = '';
    const title = document.createElement('h2');
    title.textContent = 'Contents';
    this.root.appendChild(title);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No headings';
      empty.style.opacity = '0.7';
      empty.style.padding = '0.35rem 0.4rem';
      this.root.appendChild(empty);
      return;
    }

    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.text;
      button.style.paddingLeft = `${0.4 + (item.level - 1) * 0.7}rem`;
      if (activeId && activeId === item.id) {
        button.setAttribute('aria-current', 'true');
      }
      button.addEventListener('click', () => this.onClick(item));
      this.root.appendChild(button);
    }
  }
}
