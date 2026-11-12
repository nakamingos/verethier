# Verethier styling: additions and changes from Crawlers Music Box

This package lists everything the Crawlers Music Box changed or added on top of Verethier's pixel styling. That styling covers the Aseprite-dark-theme frames in `_pixel-frames.scss`, the `pixel-select` component and the portal CSS. Use it to bring Verethier in line, or to add the new elements.

**The checkbox box art is deliberately left out.** Keep Verethier's own: the Music Box's would conflict with it. Everything around the box is included (§12): the option rows, hover, focus ring, disabled state and layouts.

## Files

| File | What it is |
|---|---|
| `verethier-additions.scss` | All visual changes, written in Verethier's conventions: `pixel-grid()`, cells drawn at 2 CSS px, slices = 2 × cells. Sections are numbered to match this README. |
| `reference/pixel-select.ts` | The Music Box's framework-free port of `pixel-select`, with the behaviour changes from §5 applied. Read it for the logic; Verethier's is an Angular component. |
| `reference/song-list.ts` | The sortable list (§10): drag to reorder, touch hold, edge auto-scroll, keyboard. |

## Ground rules the Music Box follows

These explain the exact numbers used throughout.

- **Grid:** one art cell is 2 CSS px everywhere. Every control height is a whole number of cells: buttons and dropdowns are 32px (16 cells), the text entry is 30px (15 cells), list rows are 18px (9 cells).
- **Type:** Pizzascript at 20px/24px, so one font pixel is one 2px cell and capitals are 6 cells tall, like Aseprite's text. The Music Box also sets `letter-spacing: 0` and `font-synthesis: none`. Verethier sizes in rem (1.8rem text, 3.4rem controls), which doesn't land on this grid.
- **Colours:** the same palette as Verethier's `--ase-*` dark tokens:

  | Use | Colour | Verethier token |
  |---|---|---|
  | Text | `#c0c0c0` | `--ase-text` |
  | Dim text | `#999b9f` | `--ase-dim` |
  | Highlight | `#e1b85f` | `--ase-selected` |
  | Text on highlight | `#41444a` | |
  | Panel face | `#2c2c30` | `--ase-face` |
  | Field face | `#292b30` | |
  | Band | `#41444a` | |
  | Shade | `#202125` | |
  | Focus blue | `#4069c2` | |
  | Headings and links | `#6e9adb` | |
  | Disabled | `opacity: .5` | |

## 1. Scrollbar (changed)

Verethier draws a diamond-ended thumb, 10px wide, with art at 1 CSS px per cell. The Music Box replaces it with Aseprite's own mini scrollbar, taken from Aseprite's `mini_scrollbar_thumb` sprite and its `ScrollBar` drawing code.

- **Track:** solid black, 6 cells wide (12px). It sits against the container frame's black inner line, so the black reads as 7 cells.
- **Thumb:** `#41444a`, 5 cells wide, with its corners cut (its end rows are 3 cells wide). It has 1 black cell on the side away from the frame.
- **End gaps:** at the top of its travel the thumb keeps 2 black cells above it, and at the bottom 1. Aseprite itself uses 1 and 0. The extra cell at each end was a deliberate request; keep it.
- **Minimum length:** 24 cells (48px), Aseprite's minimum.
- **Hover:** the thumb turns blue (`#4069c2`) while hovered or dragged, as Aseprite's does.
- **No arrow buttons.**
- **Horizontal scrollbars:** a matching variant.
- **Framed variant:** for a container whose frame has no black inner line (the Music Box's window frame is grey on the inside). It is 14px wide with the thumb centred in 7 cells of black, so it still reads like Aseprite's.
- **Other browsers:** Firefox and others get `scrollbar-width: thin; scrollbar-color: #41444a #000`, as before.

The code is `aseprite-scrollbars()` and `aseprite-scrollbars-framed()` in the SCSS. Use them in place of `scrollbars()`.

## 2. Raised button (changed)

- **Art:** Verethier's `$pixel-raised`, with its last row (the `#0006` drop-shadow row) made transparent. That's `$pixel-raised-flat` in the SCSS. The slices stay `8 8 12 8 / 8px 8px 12px 8px`.
- **Colours:**

  | State | Edge | Face | Highlight | Shade |
  |---|---|---|---|---|
  | Rest | `#000` | `#2c2c30` | `#434347` | `#212124` |
  | Hover | `#000` | `#535557` | `#666869` | `#3e4041` |

- **Hover leaves the text colour alone.** Only the art changes.
- **Metrics:** 32px tall, `padding: 1px 8px 0`, `line-height: 12px`, so the text sits in the 6 cells between the 4-cell top edge and the 6-cell bottom edge.

## 3. Slider (new: Verethier has none)

Aseprite's slider is `aseprite-slider()` in the SCSS, with its markup shown in a comment there.

- **At rest:** a black frame with a 2-cell shade beneath it.
- **Filled part:** `#41444a` with a bevel.
- **Empty part:** `#575b61` with a bevel.
- **Value:** centred text, for example "100%".
- **Focused:** after it's clicked into (not on hover), the frame becomes Aseprite's double ring and the bar insets by 1 cell.
- **Input:** a real `<input type="range">` sits on top, invisible, so keyboard, pointer and accessibility stay native. The script only sets `--value` and the output text on `input`.
- **Label:** in the Music Box it sits to the left ("Main:"), in a two-column grid (`grid-template-columns: auto 1fr; column-gap: 8px`).

## 4. Window frame, title bar and title buttons (new)

An Aseprite window, `aseprite-window()` in the SCSS.

- **Frame:** a black edge, two lines inside it at the sides (`#41444a`, then `#2f3136`), and a thicker shaded foot (`#202125`). The face is `#2c2c30`. Slices are `2 6 10 6`.
- **Title bar:** `#41444a`, 26px tall, with a 1-cell highlight along its top and sides (`#74777a` / `#575b61`). The title is plain `#c0c0c0` text.
- **Title buttons:** "?" and "×", each a 5×5-cell glyph on a dark square with a shaded base and shadow, shown at 18×22px. **They have no hover state**, as in Aseprite.
- **Content area:** separated from the title bar by a 2px `#2f3136` rule. If it scrolls, use the framed scrollbar (§1).

## 5. Dropdown, `pixel-select` (changed)

The frames are unchanged from Verethier. These are the differences.

**Visual** (in the SCSS):
- **Height:** exactly 32px, on the 2px grid.
- **Text:** sits 1 cell lower than in Verethier (`line-height: 24px; top: 2px`, with no `padding-top` on the value). At Verethier's offset it looked a cell too high, and its tops were clipped.
- **Arrow button:** 32px wide, with the arrow glyph at 18×16px.
- **List:** Pizzascript 20px/18px, with one row every 9 cells (`min-height: 18px`) and `padding: 0 4px`.
- **Hover:** the arrow button takes its hover art when the mouse is anywhere on the field, not only over the arrow.
- **Cursor:** the pointer cursor shows on the whole field.

**Behaviour** (see `reference/pixel-select.ts`):
1. **The whole field opens it.** Verethier opens on pointer clicks only on the arrow; here a click anywhere on the trigger toggles it.
2. **Clicking the field while it's open closes it**, and the click doesn't reopen it straight away. A press outside a `popover="auto"` closes it before the click lands, so the code records when it closed and ignores a click within 300ms. Record that time in **`beforetoggle`** (`newState === 'closed'`), not `toggle`. `toggle` is coalesced and fires too late, so the list reopens.
3. **No height cap.** Verethier caps the list at 320px (`max-height: min(32rem, …)` plus `Math.min(…, 320)` in `position()`). Here the list opens at its full height when it fits:
   - It opens below the field if it fits there.
   - Otherwise it opens above, if it fits there or there's more room above.
   - It gets a `max-height`, and so a scrollbar, only when the window is too short:
     ```ts
     const height = Math.ceil(menu.getBoundingClientRect().height); // measured with max-height: none
     const up = below < height && above > below, room = Math.max(0, Math.floor(up ? above : below));
     menu.style.maxHeight = height <= room ? 'none' : `${room}px`;
     menu.style.top = `${up ? rect.top - Math.min(height, room) : rect.bottom}px`;
     ```
4. **Unchanged:** typeahead, Home/End/PageUp/PageDown, Alt+Up, and scrolling only the list to keep the active option in view.

**New use: a field that opens a custom list.** The trigger markup (`button.pixel-select-trigger` > `.pixel-select-value` + `.pixel-select-arrow`) can also open a hand-built `popover="auto"` list that isn't a `<select>`; the Music Box uses it for the sortable song list (§10). The same close-on-field-click rule (2) and sizing (3) apply.

## 6. Text entry (changed) and autocomplete (new)

**Entry art:** Verethier's `$pixel-entry` and `$pixel-entry-focused`, unchanged.

**Entry metrics** (in the SCSS):
- Exactly 30px tall (15 cells), with `padding: 1px 6px 0 8px` and `line-height: 29px`.
- The text sits right under the inset shadow; at Verethier's padding it was clipped and off-centre.
- `border: 0` (the border image does the frame).

**Aseprite's block caret:** the browser's caret is hidden (`caret-color: transparent`) and a 2-cell-wide block is drawn instead: 4×18px, `#c0c0c0`, blinking with `steps(1)` and restarting lit after every move.
- The caret is an absolutely positioned `<i class="caret">` in the entry's row.
- Its x position is measured with a canvas, snapped to the 2px grid:
  ```ts
  measure.font = getComputedStyle(input).font;
  const row = input.parentElement!.getBoundingClientRect(), box = input.getBoundingClientRect();
  const x = Math.round((box.left - row.left + 8 + measure.measureText(input.value.slice(0, input.selectionStart ?? 0)).width - input.scrollLeft) / 2) * 2;
  caret.hidden = selectionStart !== selectionEnd || x + 4 > box.right - row.left - 4;
  caret.style.left = `${x}px`; caret.style.top = `${box.top - row.top + 6}px`;
  caret.style.animation = 'none'; void caret.offsetWidth; caret.style.animation = ''; // restart lit on every move
  ```
- It updates every animation frame while the entry has focus, and hides on blur.
- In the panel, all other text is `user-select: none` with a transparent caret, so clicking empty space never shows a stray caret.

**Autocomplete list** (new): the dropdown list's look (`.pixel-select-menu`, `popover="manual"`) opens under the entry with matches as the user types.

Behaviour that turned out to matter:
- **Arrow keys and Enter:** handle them on `keydown` only. Handling on every key event (`keyup` too) moved the highlight two rows per press, and made Enter fire twice.
- **Keeping the active row in view:** scroll only the list, never call `scrollIntoView`. `scrollIntoView` also scrolls the scrollable ancestors of the list's DOM parent, so the panel moved under a fixed-position list.
- **Mouse picking:** only a mouse that actually moves picks a row. Use `mousemove` and ignore events whose `clientX`/`clientY` haven't changed. With `mouseover`, rows scrolling under a resting pointer stole the highlight, and arrowing down "jumped around".
- **Clicking into an entry that already has text** opens the matches for that text.
- **Pressing in the list** is `preventDefault`ed on `mousedown`, so the entry keeps focus.

## 7. Section heading (new)

`h2.section` in the SCSS:
- Blue `#6e9adb` text on a 32px row.
- A dashed rule (4px dash, 2px gap, `#202125`) on each side: a short 4px stub before the text, and a rule filling the rest after it.

## 8. Links (changed)

| | Verethier | Music Box |
|---|---|---|
| Colour | `#8fb2e6` | `#6e9adb` |
| Hover | underline | turns gold (`#e1b85f`), no underline |
| Arrow glyphs after link text | | none |

## 9. Corner "open" button (new)

- A raised button 21×22 cells (42×44px). The last row of its art is clear, so the 7×7-cell "+" glyph (`#c0c0c0`) has 6 cells on every side.
- The glyph doesn't dim when the button is inactive.
- It hides while the panel it opens is showing, since the panel's own title bar closes it.

## 10. Sortable list (new)

A list shown inside the dropdown list frame, with one row every 9 cells. Each row is a checkbox (use Verethier's) followed by the item name. The styling is `.sortable-list` in the SCSS, and the behaviour is `reference/song-list.ts`.

**Row states:**

| State | Look |
|---|---|
| Current item | gold background, `#41444a` text |
| Unticked item | dim text |
| Keyboard cursor (only while the list has keyboard focus) | 2px blue `#4069c2` inset outline |
| Row being dragged | blue outline on `#575b61` |

**Interaction:**
- **Click a row:** acts on that item.
- **Reorder with the mouse:** drag once it has moved 4px.
- **Reorder on touch:** hold for 400ms (a short vibration if available), then drag. Moving more than 8px before that cancels, so normal scrolling still works.
- **Click after a drop:** swallowed, then cleared on the next tick so later clicks still work.
- **Edges:** while dragging near the top or bottom 24px, the list auto-scrolls.
- **Pointer origin:** taken from `event.composedPath()[0]`. Inside a shadow root, the window sees the host as `event.target`.
- **While a row is held:** pointer moves anywhere on the page are routed to the list, so a drag can leave its bounds.

**Keyboard:**

| Key | Action |
|---|---|
| Up / Down | move the cursor |
| Alt + Up / Down | move the item |
| Space | tick or untick |
| Enter | act on the item |

- The keyboard cursor follows the current item, so the list always opens on it.

## 11. Small rules

- **Dim text:** `#999b9f`, used for secondary lines (details, status).
- **Status lines:** lines whose text changes with state get reserved height (`min-height` for their tallest message), so the panel doesn't jump. They don't scroll.
- **Disabled controls:** `opacity: .5; cursor: not-allowed`.
- **Focused button:** a 2px gold outline, offset 2px. The dropdown trigger keeps Verethier's gold text underline instead.

## 12. Checkbox rows (changed: everything except the box art)

Aseprite-style option rows, `.check-row` in the SCSS. Use Verethier's own box art for the box itself.

**The box:**
- 18×18px (9 cells), `appearance: none`, `flex: 0 0 18px`, with no margin, padding or border.
- It has no outline of its own when focused: the row shows focus instead.

**The row:**
- A `<label>` with the checkbox inside it: 12 cells tall on a 16-cell pitch, so rows sit one every 32px.
- Metrics: `height: 24px; padding: 2px 0 0; border: 4px solid transparent; border-left-width: 2px; margin: 4px -6px; line-height: 16px; gap: 10px`.
- The negative side margin lets the hover and focus backgrounds reach past the text, as Aseprite's do. The text keeps its alignment.

| State | Look |
|---|---|
| Hover | `#575b61` background across the row |
| Focused (the option last used) | Aseprite's blue ring with soft corners (5×5-cell art, slice 2 cells / 4px), and no hover background |
| Disabled | `opacity: .5`, `cursor: not-allowed`, no hover background |

**Keep the ring after a click:**
```ts
// A checkbox clicked through its label keeps the focus ring (Aseprite marks the option last used).
for (const box of root.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))
  box.closest('label')?.addEventListener('click', () => box.focus({ preventScroll: true }));
```
Without this, clicking the label text doesn't focus the box, and the ring never appears.

**Layouts:**
- **Two checkboxes on one row:** a flex row with `gap: 8px`, each taking an equal share.
- **A checkbox after a text entry** (for example "Shuffle" next to the name box): a grid row with `grid-template-columns: minmax(0, 1fr) auto`.
- **A checkbox before a slider's label**, which switches that slider's sound on and off:
  - It sits in the slider grid's label column, with `margin: 4px -6px 8px` so its 32px row lines up with the 32px slider.
  - While it's unticked, the slider beside it dims to `opacity: .5`: `label:has(input:not(:checked)) + .slider`.
  - Moving the slider ticks the box again.

## How the Music Box checked these

- **Pixel accuracy:** the scrollbar, dropdown text and entry text were checked pixel by pixel at 1× zoom against Aseprite screenshots and Aseprite's own theme sheet (`data/extensions/aseprite-theme/dark/sheet.png` and `theme.xml` in the Aseprite repo). Check the same way, at 1× zoom, rather than by eye.
- **Scrollbars in headless Chrome:** headless Chrome hides scrollbars by default. Launch it with `ignoreDefaultArgs: ['--hide-scrollbars']` to screenshot them.
