import type { TocItem } from '../../extension/messaging/protocol';

export class TocView {
  constructor(
    private readonly root: HTMLElement,
    private readonly onClick: (item: TocItem) => void
  ) {}

  render(items: TocItem[], activeId?: string): void {
    const focusedId = this.root.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.headingId
      : undefined;
    const scrollTop = this.root.scrollTop;
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
      button.dataset.headingId = item.id;
      button.title = item.text;
      button.style.paddingLeft = `${0.4 + (item.level - 1) * 0.7}rem`;
      if (activeId && activeId === item.id) {
        button.setAttribute('aria-current', 'true');
      }
      button.addEventListener('click', () => this.onClick(item));
      this.root.appendChild(button);
      if (focusedId === item.id) button.focus({ preventScroll: true });
    }
    this.root.scrollTop = scrollTop;
  }

  setActive(id?: string): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('button[data-heading-id]')) {
      if (button.dataset.headingId === id) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  }
}
