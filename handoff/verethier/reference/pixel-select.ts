// Verethier's pixel dropdown (its pixel-select component, CC0), for a native
// <select> that stays the source of truth: choosing an option sets its value
// and fires its change event, and setting its value or disabled updates the
// dropdown. A click anywhere on it opens the list; the keyboard
// opens it with Enter, Space or the arrows, moves with the arrows, Home, End
// and Page keys, finds options by typing, and closes it with Escape or Tab.
// Keys reach it through keydown() (the player handles its controls' keys
// before the Crawler's page can see them).
export class PixelSelect {
  readonly trigger: HTMLButtonElement;
  readonly menu: HTMLDivElement;
  private text: HTMLSpanElement;
  private active = -1;
  private search = '';
  private searchTime = 0;
  isOpen = false;
  private closedAt = 0;

  constructor(private select: HTMLSelectElement) {
    const doc = select.ownerDocument, id = `${select.id}-menu`;
    this.trigger = doc.createElement('button');
    this.trigger.type = 'button'; this.trigger.className = 'pixel-select-trigger';
    this.trigger.setAttribute('role', 'combobox'); this.trigger.setAttribute('aria-haspopup', 'listbox'); this.trigger.setAttribute('aria-controls', id);
    this.trigger.setAttribute('aria-label', select.getAttribute('aria-label') ?? select.closest('label')?.firstChild?.textContent?.trim() ?? '');
    const value = doc.createElement('span'); value.className = 'pixel-select-value';
    this.text = doc.createElement('span'); this.text.className = 'pixel-select-text'; value.append(this.text);
    const arrow = doc.createElement('span'); arrow.className = 'pixel-select-arrow'; arrow.setAttribute('aria-hidden', 'true');
    this.trigger.append(value, arrow);
    this.menu = doc.createElement('div');
    this.menu.className = 'pixel-select-menu'; this.menu.id = id; this.menu.setAttribute('popover', 'auto'); this.menu.setAttribute('role', 'listbox');
    select.hidden = true;
    select.after(this.trigger, this.menu);
    // A press on the field closes the open list (as any press outside it
    // does); the click that follows mustn't open it again.
    this.trigger.addEventListener('click', () => { if (this.isOpen) this.close(); else if (performance.now() - this.closedAt > 300) this.open(); });
    // The list never takes focus from the field.
    this.menu.addEventListener('mousedown', event => event.preventDefault());
    this.menu.addEventListener('click', event => { event.preventDefault(); const option = (event.target as Element).closest<HTMLElement>('[role=option]'); if (option) this.choose(Number(option.dataset.index)); });
    this.menu.addEventListener('mouseover', event => { const option = (event.target as Element).closest<HTMLElement>('[role=option]'); if (option && !this.disabled(Number(option.dataset.index))) this.highlight(Number(option.dataset.index)); });
    this.menu.addEventListener('beforetoggle', event => { if ((event as ToggleEvent).newState === 'closed') { this.closedAt = performance.now(); this.isOpen = false; this.search = ''; this.trigger.setAttribute('aria-expanded', 'false'); } });
    const reposition = () => { if (!this.isOpen) return; const rect = this.trigger.getBoundingClientRect(); if (rect.bottom <= 0 || rect.top >= innerHeight) this.close(false); else this.position(); };
    addEventListener('resize', reposition); addEventListener('scroll', reposition, true);
    // Setting the select's value or disabled from code shows here too.
    const self = this;
    for (const name of ['value', 'disabled'] as const) {
      const own = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, name)!;
      Object.defineProperty(select, name, { configurable: true, get() { return own.get!.call(this); }, set(next) { own.set!.call(this, next); self.refresh(); } });
    }
    this.refresh();
  }

  refresh() {
    const chosen = this.select.selectedOptions[0];
    this.text.textContent = chosen?.textContent ?? '';
    this.trigger.disabled = this.select.disabled;
    if (this.select.disabled) this.close(false);
  }
  private get options() { return [...this.select.options]; }
  private disabled(index: number) { return !this.options[index] || this.options[index].disabled; }
  open() {
    if (this.select.disabled || this.options.every((_, index) => this.disabled(index))) return;
    this.menu.replaceChildren(...this.options.map((option, index) => {
      const item = this.select.ownerDocument.createElement('div');
      item.setAttribute('role', 'option'); item.id = `${this.menu.id}-${index}`; item.dataset.index = String(index);
      item.setAttribute('aria-selected', String(option.selected)); if (option.disabled) item.setAttribute('aria-disabled', 'true');
      item.textContent = option.textContent;
      return item;
    }));
    this.active = this.select.selectedIndex >= 0 && !this.disabled(this.select.selectedIndex) ? this.select.selectedIndex : this.options.findIndex((_, index) => !this.disabled(index));
    this.isOpen = true; this.trigger.setAttribute('aria-expanded', 'true');
    this.menu.showPopover();
    this.position(); this.highlight(this.active);
  }
  close(focus = true) {
    if (!this.isOpen) return;
    this.isOpen = false; this.search = ''; this.trigger.setAttribute('aria-expanded', 'false');
    if (this.menu.matches(':popover-open')) this.menu.hidePopover();
    if (focus) this.trigger.focus({ preventScroll: true });
  }
  private choose(index: number, focus = true) {
    if (this.disabled(index)) return;
    this.close(focus);
    if (this.select.selectedIndex !== index) {
      this.select.selectedIndex = index; this.refresh();
      this.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  private highlight(index: number) {
    this.active = index;
    for (const item of this.menu.children) item.classList.toggle('active', Number((item as HTMLElement).dataset.index) === index);
    if (index >= 0) this.trigger.setAttribute('aria-activedescendant', `${this.menu.id}-${index}`); else this.trigger.removeAttribute('aria-activedescendant');
    this.reveal();
  }
  // Scrolls only the list; scrolling the page could move it mid-choice.
  private reveal() {
    const option = this.menu.children[this.active] as HTMLElement | undefined;
    if (!option) return;
    const top = this.menu.getBoundingClientRect().top + this.menu.clientTop, bottom = top + this.menu.clientHeight, rect = option.getBoundingClientRect();
    if (rect.top < top) this.menu.scrollTop -= top - rect.top;
    else if (rect.bottom > bottom) this.menu.scrollTop += rect.bottom - bottom;
  }
  private move(step: number, edge = false) {
    const enabled = this.options.map((_, index) => this.disabled(index) ? -1 : index).filter(index => index >= 0);
    const at = enabled.indexOf(this.active);
    this.highlight(edge ? enabled[step > 0 ? enabled.length - 1 : 0] : enabled[Math.max(0, Math.min(enabled.length - 1, at + step))]);
  }
  keydown(event: KeyboardEvent) {
    if (this.select.disabled) return;
    const key = event.key;
    if (key === 'Tab') { if (this.isOpen) this.choose(this.active, false); return; }
    if (key === 'Escape') { if (this.isOpen) { event.preventDefault(); this.close(); } return; }
    if (key === 'Enter' || key === ' ') { event.preventDefault(); if (this.isOpen) this.choose(this.active); else this.open(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(key)) {
      event.preventDefault();
      const wasOpen = this.isOpen;
      if (!wasOpen) this.open();
      if (!this.isOpen) return;
      if (event.altKey && key === 'ArrowUp') this.choose(this.active);
      else if (key === 'Home' || key === 'End') this.move(key === 'End' ? 1 : -1, true);
      else if (wasOpen) this.move(key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : key === 'PageDown' ? 10 : -10);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!this.isOpen) this.open();
      const now = Date.now();
      this.search = now - this.searchTime > 650 ? key : this.search + key;
      this.searchTime = now;
      const text = this.search.toLocaleLowerCase(), repeated = [...text].every(letter => letter === text[0]);
      const prefix = repeated ? text[0] : text, start = repeated ? this.active + 1 : this.active, count = this.options.length;
      for (let offset = 0; offset < count; offset++) {
        const index = (start + offset + count) % count;
        if (!this.disabled(index) && (this.options[index].textContent ?? '').toLocaleLowerCase().startsWith(prefix)) { this.highlight(index); break; }
      }
    }
  }
  // Below the field (above it if it only fits there, or there's more room there), as wide as it.
  private position() {
    const rect = this.trigger.getBoundingClientRect(), menu = this.menu, scrollTop = menu.scrollTop, margin = 8;
    menu.style.width = `${Math.min(rect.width, innerWidth - margin * 2)}px`;
    menu.style.maxHeight = 'none';
    const below = innerHeight - rect.bottom - margin, above = rect.top - margin;
    // The whole list when there's room; a scrollbar only when the window is too short.
    const height = Math.ceil(menu.getBoundingClientRect().height), up = below < height && above > below, room = Math.max(0, Math.floor(up ? above : below));
    menu.style.maxHeight = height <= room ? 'none' : `${room}px`;
    menu.style.left = `${Math.max(margin, Math.min(rect.left, innerWidth - rect.width - margin))}px`;
    menu.style.top = `${up ? rect.top - Math.min(height, room) : rect.bottom}px`;
    menu.scrollTop = scrollTop;
  }
}
