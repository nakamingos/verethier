import {
  booleanAttribute,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Output,
  forwardRef,
  HostListener,
  Input,
  OnChanges,
  ViewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export interface SelectChoice {
  value: string | null;
  label: string;
  disabled?: boolean;
  action?: boolean;
}

let nextId = 0;

@Component({
  selector: 'app-pixel-select',
  templateUrl: './pixel-select.component.html',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PixelSelectComponent),
      multi: true,
    },
  ],
})
export class PixelSelectComponent implements ControlValueAccessor, OnChanges {
  @Input() options: SelectChoice[] = [];
  @Input() label = '';
  @Input() placeholder = '';
  @Input({ transform: booleanAttribute }) multiple = false;
  @Input() maxSelections = 20;
  @Output() optionAction = new EventEmitter<string | null>();
  @Input({ transform: booleanAttribute }) disabled = false;
  @Input({ transform: booleanAttribute }) required = false;
  @ViewChild('trigger', { static: true })
  trigger!: ElementRef<HTMLButtonElement>;
  @ViewChild('menu', { static: true }) menu!: ElementRef<HTMLDivElement>;
  readonly id = `pixel-select-${++nextId}`;
  value: string | string[] | null = null;
  isOpen = false;
  active = -1;
  private search = '';
  private searchTime = 0;
  private change: (value: string | string[] | null) => void = () => {};
  touched: () => void = () => {};

  constructor(private readonly view: ChangeDetectorRef) {}

  get selectedLabel() {
    if (this.multiple) return this.options.filter(option => this.selected(option)).map(option => option.label).join(', ') || this.placeholder;
    return this.options.find((option) => option.value === this.value)?.label || this.placeholder;
  }
  selected(option: SelectChoice) {
    return this.multiple ? Array.isArray(this.value) && this.value.includes(option.value as string) : option.value === this.value;
  }
  optionDisabled(option: SelectChoice) {
    if (!this.multiple) return !!option.disabled;
    if (this.selected(option)) return false; // Removed/unmanageable saved roles can still be deselected.
    return !!option.disabled || (Array.isArray(this.value) && this.value.length >= this.maxSelections);
  }
  writeValue(value: string | string[] | null | undefined) {
    this.value = Array.isArray(value) ? [...value] : value ?? null;
  }
  registerOnChange(change: (value: string | string[] | null) => void) {
    this.change = change;
  }
  registerOnTouched(touched: () => void) {
    this.touched = touched;
  }
  setDisabledState(disabled: boolean) {
    this.disabled = disabled;
    if (disabled) this.close(false);
  }
  ngOnChanges() {
    if (this.disabled) this.close(false);
    if (!this.options[this.active] || this.optionDisabled(this.options[this.active]))
      this.active = this.options.findIndex((option) => !this.optionDisabled(option));
  }
  toggle(event: MouseEvent) {
    // Keep keyboard/assistive activation; pointer clicks open only on the arrow.
    if (
      event.detail > 0 &&
      !(
        event.target instanceof Element &&
        event.target.closest('.pixel-select-arrow')
      )
    ) {
      event.preventDefault();
      return;
    }
    if (this.isOpen) this.close();
    else this.open();
  }
  open() {
    if (this.disabled || !this.options.some((option) => !this.optionDisabled(option)))
      return;
    this.active = this.options.findIndex(
      (option) => this.selected(option) && !this.optionDisabled(option),
    );
    if (this.active < 0)
      this.active = this.options.findIndex((option) => !this.optionDisabled(option));
    this.isOpen = true;
    this.view.detectChanges();
    this.menu.nativeElement.showPopover();
    this.position();
    this.reveal();
  }
  close(focus = true) {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.menu.nativeElement.hidePopover();
    this.search = '';
    if (focus) this.trigger.nativeElement.focus({ preventScroll: true });
  }
  onToggle(event: Event) {
    if ((event as ToggleEvent).newState === 'closed') {
      this.isOpen = false;
      this.search = '';
    }
  }
  choose(index: number, focus = true) {
    const option = this.options[index];
    if (!option || this.optionDisabled(option)) return;
    if (option.action) { this.close(focus); this.optionAction.emit(option.value); this.touched(); return; }
    if (this.multiple) {
      const values = Array.isArray(this.value) ? this.value : [];
      this.value = values.includes(option.value as string) ? values.filter(v => v !== option.value) : [...values, option.value as string];
      this.change([...this.value]); this.touched();
      this.active = index;
      if (focus) this.trigger.nativeElement.focus({ preventScroll: true });
      return;
    }
    this.close(focus);
    if (this.value !== option.value) {
      this.value = option.value;
      this.change(this.value);
    }
    this.touched();
  }
  hover(index: number) {
    if (this.options[index] && !this.optionDisabled(this.options[index])) this.active = index;
  }
  private reveal() {
    const menu = this.menu.nativeElement;
    const option = menu.children[this.active] as HTMLElement | undefined;
    if (!option) return;
    // Scroll only the popup; scrolling the page can reposition it mid-selection.
    const top = menu.getBoundingClientRect().top + menu.clientTop;
    const bottom = top + menu.clientHeight;
    const rect = option.getBoundingClientRect();
    if (rect.top < top) menu.scrollTop -= top - rect.top;
    else if (rect.bottom > bottom) menu.scrollTop += rect.bottom - bottom;
  }
  private move(direction: number, edge = false) {
    const enabled = this.options
      .map((option, index) => (this.optionDisabled(option) ? -1 : index))
      .filter((index) => index >= 0);
    const position = enabled.indexOf(this.active);
    this.active = edge
      ? enabled[direction > 0 ? enabled.length - 1 : 0]
      : enabled[
          Math.max(0, Math.min(enabled.length - 1, position + direction))
        ];
    this.reveal();
  }
  keydown(event: KeyboardEvent) {
    if (this.disabled) return;
    const key = event.key;
    if (key === 'Tab') {
      if (this.isOpen) { if (this.multiple) this.close(false); else this.choose(this.active, false); }
      return;
    }
    if (key === 'Escape') {
      if (this.isOpen) {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
      return;
    }
    if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      if (this.isOpen) this.choose(this.active);
      else this.open();
      return;
    }
    if (
      ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(
        key,
      )
    ) {
      event.preventDefault();
      const wasOpen = this.isOpen;
      this.openIfClosed();
      if (!this.isOpen) return;
      if (event.altKey && key === 'ArrowUp') { if (this.multiple) this.close(); else this.choose(this.active); }
      else if (key === 'Home' || key === 'End')
        this.move(key === 'End' ? 1 : -1, true);
      else if (wasOpen)
        this.move(
          key === 'ArrowDown'
            ? 1
            : key === 'ArrowUp'
              ? -1
              : key === 'PageDown'
                ? 10
                : -10,
        );
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.openIfClosed();
      const now = Date.now();
      this.search = now - this.searchTime > 650 ? key : this.search + key;
      this.searchTime = now;
      const text = this.search.toLocaleLowerCase();
      const repeated = [...text].every((letter) => letter === text[0]);
      const prefix = repeated ? text[0] : text;
      const start = repeated ? this.active + 1 : this.active;
      for (let offset = 0; offset < this.options.length; offset++) {
        const index =
          (start + offset + this.options.length) % this.options.length;
        const option = this.options[index];
        if (
          !this.optionDisabled(option) &&
          option.label.toLocaleLowerCase().startsWith(prefix)
        ) {
          this.active = index;
          this.reveal();
          break;
        }
      }
    }
  }
  private openIfClosed() {
    if (!this.isOpen) this.open();
  }
  @HostListener('window:resize')
  @HostListener('window:scroll')
  viewportChanged() {
    if (!this.isOpen) return;
    const rect = this.trigger.nativeElement.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= innerHeight) this.close(false);
    else this.position();
  }
  private position() {
    const rect = this.trigger.nativeElement.getBoundingClientRect();
    const menu = this.menu.nativeElement;
    const scrollTop = menu.scrollTop;
    const margin = 8;
    const gap = 0;
    menu.style.width = `${Math.min(rect.width, innerWidth - margin * 2)}px`;
    menu.style.maxHeight = 'none';
    const below = innerHeight - rect.bottom - margin - gap;
    const above = rect.top - margin - gap;
    const height = Math.min(menu.getBoundingClientRect().height, 320);
    const up = below < height && above > below;
    const available = Math.max(0, up ? above : below);
    menu.style.maxHeight = `${Math.min(320, available)}px`;
    menu.style.left = `${Math.max(margin, Math.min(rect.left, innerWidth - rect.width - margin))}px`;
    menu.style.top = `${up ? rect.top - Math.min(height, available) - gap : rect.bottom + gap}px`;
    menu.scrollTop = scrollTop;
  }
}
