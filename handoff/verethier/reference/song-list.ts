// The player's song list: every song in play order, each with a checkbox to
// keep it in the rotation or leave it out. Clicking a song plays it; dragging
// one (or, on a touch screen, holding it a moment, then dragging) moves it.
// The keyboard moves through it with the arrows, plays with Enter, ticks with
// Space and moves the song with Alt + arrows.
// Pointer and key events reach it through pointer() and keydown() (the player
// handles its controls' events before the Crawler's page can see them).
import { LONG_VERSIONS, SONGS, type SongChoice } from './song';

const HOLD_MS = 400, DRAG_PX = 4, EDGE_PX = 24;
type Press = { row: HTMLElement; id: number; x: number; y: number; touch: boolean; dragging: boolean; timer: number; scroll: number };

export class SongList {
  order: SongChoice[];
  off: Set<SongChoice>;
  private current?: SongChoice;
  private active = 0;
  private press?: Press;
  private quiet = false; // the click after a drag doesn't play

  constructor(private list: HTMLElement, saved: { order?: unknown; off?: unknown } | undefined, private changed: () => void, private play: (song: SongChoice) => void) {
    const ids = SONGS.map(item => item.id), known = (value: unknown): value is SongChoice => ids.includes(value as SongChoice);
    const order = Array.isArray(saved?.order) ? saved.order.filter(known) : [];
    this.order = [...new Set([...order, ...ids])];
    // The long versions start unticked (as does one the saved list hasn't met yet).
    this.off = new Set([...(Array.isArray(saved?.off) ? saved.off.filter(known) : []), ...LONG_VERSIONS.filter(id => !order.includes(id))]);
    list.addEventListener('click', event => {
      const row = (event.target as Element).closest<HTMLElement>('.song');
      if (!row || this.quiet) { this.quiet = false; return; }
      const id = row.dataset.id as SongChoice;
      this.active = this.order.indexOf(id);
      if ((event.target as Element).matches('input[type=checkbox]')) this.toggle(id);
      else this.play(id);
    });
    this.render();
  }

  get dragging() { return !!this.press?.dragging; }
  // A song is held (its drag follows the pointer anywhere).
  get pressing() { return !!this.press; }
  // Shows which song is playing (scrolling only the list to it).
  // The keyboard's place in the list moves there too (so it opens on what's playing).
  show(song: SongChoice) { this.current = song; this.active = Math.max(0, this.order.indexOf(song)); this.render(); this.reveal(this.active); }

  // Back to the mix, with the long versions unticked.
  reset() { this.order = SONGS.map(item => item.id); this.off = new Set(LONG_VERSIONS); this.active = this.order.indexOf(this.current ?? this.order[0]); this.render(); this.changed(); }
  private toggle(id: SongChoice) { if (this.off.has(id)) this.off.delete(id); else this.off.add(id); this.render(); this.changed(); }
  private render() {
    const doc = this.list.ownerDocument, title = (id: SongChoice) => SONGS.find(item => item.id === id)?.title ?? id;
    this.list.replaceChildren(...this.order.map((id, index) => {
      const row = doc.createElement('div'), box = doc.createElement('input'), name = doc.createElement('span');
      row.className = 'song'; row.dataset.id = id; row.setAttribute('role', 'option'); row.id = `song-${index}`;
      row.setAttribute('aria-selected', String(id === this.current));
      row.classList.toggle('current', id === this.current); row.classList.toggle('off', this.off.has(id)); row.classList.toggle('active', index === this.active);
      box.type = 'checkbox'; box.tabIndex = -1; box.checked = !this.off.has(id); box.setAttribute('aria-label', `Include ${title(id)}`);
      name.textContent = title(id);
      row.append(box, name);
      return row;
    }));
    this.list.setAttribute('aria-activedescendant', `song-${this.active}`);
  }
  private reveal(index: number) {
    const row = this.list.children[index] as HTMLElement | undefined;
    if (!row) return;
    const top = row.offsetTop - this.list.clientTop - 8, bottom = top + row.offsetHeight + 16;
    if (top < this.list.scrollTop) this.list.scrollTop = top;
    else if (bottom > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = bottom - this.list.clientHeight;
  }
  private move(from: number, to: number) {
    to = Math.max(0, Math.min(this.order.length - 1, to));
    if (to === from) return;
    const [id] = this.order.splice(from, 1); this.order.splice(to, 0, id);
    this.active = to; this.render(); this.reveal(to); this.changed();
  }

  keydown(event: KeyboardEvent) {
    const key = event.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      const to = this.active + (key === 'ArrowDown' ? 1 : -1);
      if (event.altKey) this.move(this.active, to);
      else { this.active = Math.max(0, Math.min(this.order.length - 1, to)); this.render(); this.reveal(this.active); }
    } else if (key === ' ') { event.preventDefault(); this.toggle(this.order[this.active]); }
    else if (key === 'Enter') { event.preventDefault(); this.play(this.order[this.active]); }
  }

  // Pointer events in the list: a press, a drag, a drop. Returns true while
  // dragging (so the page doesn't scroll instead).
  pointer(event: PointerEvent): boolean {
    const press = this.press;
    if (event.type === 'pointerdown') {
      // The element pressed (seen from the window, the event's target is the panel's host).
      const origin = event.composedPath()[0] as Element, row = origin.closest?.<HTMLElement>('.song');
      if (!row || event.button !== 0 || origin.matches('input[type=checkbox]')) return false;
      const touch = event.pointerType === 'touch';
      this.press = { row, id: event.pointerId, x: event.clientX, y: event.clientY, touch, dragging: false, timer: 0, scroll: 0 };
      if (touch) this.press.timer = window.setTimeout(() => this.begin(), HOLD_MS);
      return false;
    }
    if (!press || event.pointerId !== press.id) return false;
    if (event.type === 'pointermove') {
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (!press.dragging) {
        if (press.touch) { if (moved > 8) this.cancel(); return false; }
        if (moved < DRAG_PX) return false;
        this.begin();
      }
      this.drag(event.clientY);
      return true;
    }
    if (event.type === 'pointerup' || event.type === 'pointercancel') {
      const dragged = press.dragging;
      this.cancel();
      // The click a drop can make doesn't play the song (and nothing later is ignored).
      if (dragged) { this.quiet = event.type === 'pointerup'; setTimeout(() => { this.quiet = false; }); this.commit(); }
      return dragged;
    }
    return false;
  }
  private begin() {
    const press = this.press; if (!press) return;
    press.dragging = true; clearTimeout(press.timer);
    press.row.classList.add('dragging'); this.list.classList.add('sorting');
    navigator.vibrate?.(10);
  }
  private drag(y: number) {
    const press = this.press!, rect = this.list.getBoundingClientRect();
    // Near the top or bottom edge, the list scrolls (and keeps scrolling while held there).
    const edge = y < rect.top + EDGE_PX ? -1 : y > rect.bottom - EDGE_PX ? 1 : 0;
    clearInterval(press.scroll); press.scroll = 0;
    if (edge) press.scroll = window.setInterval(() => { this.list.scrollTop += edge * 6; this.place(y); }, 30);
    this.place(y);
  }
  // Moves the dragged row to where the pointer is.
  private place(y: number) {
    const press = this.press; if (!press) return;
    const rows = [...this.list.children] as HTMLElement[];
    const over = rows.find(row => { const r = row.getBoundingClientRect(); return y >= r.top && y < r.bottom; });
    if (!over || over === press.row) return;
    const below = rows.indexOf(over) > rows.indexOf(press.row);
    over[below ? 'after' : 'before'](press.row);
  }
  private commit() {
    this.order = ([...this.list.children] as HTMLElement[]).map(row => row.dataset.id as SongChoice);
    this.active = this.order.indexOf(this.current ?? this.order[0]);
    this.render(); this.changed();
  }
  private cancel() {
    const press = this.press; if (!press) return;
    clearTimeout(press.timer); clearInterval(press.scroll);
    press.row.classList.remove('dragging'); this.list.classList.remove('sorting');
    this.press = undefined;
  }
}
