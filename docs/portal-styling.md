# Portal styling

Visual design notes for the Control Room, member portal and verification page. Behavior is documented in [portals](portals.md). The styling uses Aseprite-style pixel frames drawn at 2 CSS px per art cell; the November 11, 2026 integration of the reference package in [`handoff/verethier/`](../handoff/verethier/README.md) is described at the end.

## Layout and controls

Header and ordinary admin buttons share the server toolbar frames, while tabs, dropdowns and member suggestions keep their dedicated styles. Keyboard focus uses an underline, with system outlines in high-contrast mode.

Edit opens beneath the selected rule, extending the same card frame without a drop shadow. The expanded frame uses the blue indicator band on both its upper and lower sections; Review changes is vertically centered with the editor title. Combined badges sit to the right of Edit/Delete on the same row, with a shorter label in narrow cards.

Cards keep equal heights and actions aligned at the bottom. Changing button labels reserve their largest size. Holding a button or tab keeps its position, size and bevel unchanged; hover, focus and selected states remain distinct. Disabled buttons keep their solid frames and use muted text rather than fading the entire control. Item counts use the reference's 14×16 raised display frame, with its six-row lower bevel preserved in the border-image slice. The theme switcher fits the supplied 10×10 icon at 2× scale inside a 34px square tool button aligned with the header controls and inverts it in light mode. Field and dropdown titles end in colons. Notifications use a fixed, dismissible area with Undo/Redo. Server loading retains the current view, makes it inert, and replaces the server ID and data together only after a successful response; initial loads show static placeholders. Audit results scroll within a stable area so pagination stays in place. The primary font is preloaded to reduce text reflow. Content panels and form gaps are tighter; server-menu and tab spacing is unchanged.

Button contents sit one pixel higher, while workspace-tab text sits one pixel lower without changing control dimensions. The footer has no top separator, and the last previously earned role has no trailing separator.

Shared controls use solid two-pixel border bands in both themes: raised buttons with two short corner cuts and a lower ledge, recessed fields, shallow card frames, and tabs with stepped shoulders and flared active feet. Nine-slice SVG frames keep the corner steps fixed without changing control dimensions or clipping editors, suggestions or keyboard focus. Dropdowns share a select-only combobox with the sampled field and arrow frames, a blue menu outline and gold option highlight. Keyboard navigation scrolls only inside the popup and preserves its scroll position during viewport updates. Arrows, Home/End, Page Up/Down and type-ahead navigate options; Enter/Space/Tab commit, and Escape cancels. The Popover API keeps menus above inline editors and dismisses outside clicks; menus sit directly against the trigger, fit the viewport and open upward when needed. The arrow glyph is 18×16px within a 32px square button, matching the default button and dropdown height. Text fields use a 30px recessed frame; font sizes and the 2px label gap remain unchanged. Single-line menu options use 22px rows. Clicking anywhere on the dropdown field toggles it; mouse hover anywhere on the field highlights the arrow. The list uses its full height when it fits and is capped only by available viewport space. A pointer press remembers whether the menu was open before native light dismissal, so a second click closes it without immediately reopening. Only mouse movement to a new coordinate changes the active option, preserving keyboard navigation under a stationary pointer. Angular form values, null choices, required fields and disabled roles retain their original behavior. High-contrast mode uses system colors and plain borders.

The admin tabs join a shared workspace surface that spans the screen. The server menu and every tab's content sit inside it, with the menu remaining sticky on desktop. Content retains a readable maximum width; on mobile the tabs scroll in one row so the active tab stays connected to the surface. Initial loading uses the same outer layout.

Dropdowns use 18px text and compact, centered rows. The field extends beneath the two-step arrow button, and open menus have no shadow or opaque corner background. The outer corner pixel is transparent and its two neighbors are translucent. Keyboard focus underlines the closed value; the blue frame belongs only to the open menu.

Tab frames preserve the source sprites' asymmetric right edge and flared active feet. The dark palette uses direct PNG pixel samples: active face `#333333`, active rim `#575757`, inactive face `#202125`, inactive rim `#2f3136`, and black outlines. The original theme definitions provide the strip color `#2c2c30`, active text `#c0c0c0`, and inactive text `#7d7d7d`. These values are explicit, not calculated tints.

The server menu uses the source editor frame: a `#202125` interior, black inner border, `#2b2b2b` upper rim and `#575757` left/lower rim. Server controls use the tool-button frames with `#292b30` faces and `#41444a` bands; the current server has the lighter `#41444a` face and `#202125` lower inset of the selected tool. Selection is also marked with `aria-current`. Light mode uses the same geometry with its light palette.

Server buttons and invite links use equal avatar slots and heights, with initials when an icon is missing. Names stay on one line with an ellipsis and a full-name tooltip. Server buttons match the default 34px height and 16px text, with 22px icons or initial slots. Invite entries for servers without Bouncer use #999B9F text.

Stacked server buttons overlap their bottom outline and shadow with the next top outline, leaving one shared divider. Cards across Rules, Bot Settings, Member Lookup and Audit Log use the reference editor frame with black inner/outer outlines, a `#41444a` rim and a `#202125` interior. Combined-rule and editor highlights retain their accent, with joined open/lower frames keeping inline editors continuous. Light mode retains the same geometry.

Border geometry and reference palettes are adapted from the [Aseprite Default themes](https://github.com/aseprite/aseprite/tree/main/data/extensions/aseprite-theme) by David Capello, Ilija Melentijevic and Nicolas Desilets, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Bouncer reconstructs the frames as SVG grids, recolors them to its themes, and adds card/editor variants; the theme toggle and checkbox use the supplied PNG assets (both supplied 9×9 checkbox icons).

Rule search and member lookup use the supplied `search.png` unchanged at 2× scale inside their fields, with space reserved before the text. Text fields use the reference's recessed frame and blue focus border with gold text selection; focusing a field keeps its dimensions fixed.

The Servers heading uses the dropdown-label color and sits above the menu; avatar slots have transparent backgrounds. Counts and status indicators share the stepped light-rim display frame. Bot Settings dropdowns have a wider 32rem preferred width. Their actions align to the right of their dropdowns and wrap to the right on small screens. Save settings, Update message and Check again reserve the widest of their labels so all three buttons have the same width. Activity pagination groups Previous, Next and Last together on the right.

The Communities search field uses the supplied pixel search icon and the shared light-mode inversion.

## Theme reference colors

Light mode uses the Aseprite Default light theme's XML colors and sampled sheet pixels: header `#d3cbbe`, workspace/active tab `#7d929e`, tab rim `#adcade`, button/card face `#c6c6c6`, selected toolbar shade `#7c919d`, white fields and highlights, black text/outlines, inset rim/separators `#958174`, inset shade `#7c7c7c`, and menu selection `#ff5555` with white text. Frame geometry stays shared between themes. Search icons invert in light mode; the supplied 9×9 check icons render at 2× and invert in dark mode. Table dividers use a 2px-high repeating 4px dash / 2px gap, with no trailing divider after the final entry.

Mobile header links retain the same side padding as default buttons. Navigation aligns beside the title where it fits and wraps intact on very narrow screens; authentication remains right-aligned below.

Light dropdowns have white outer/focus rims, white field/menu faces, coral selection with white text, black text/arrows, gray (`#c6c6c6`) arrow buttons, white button highlights and `#7c7c7c` button shading. Brown (`#958174`) inset/corner pixels remain distinct from the white rims. The theme toggle keeps ordinary button chrome in both themes; its `aria-pressed` state does not apply selected-server colors.

Field titles use a compact 20px line height and no extra top margin before their dropdowns or text inputs; control heights and font sizes remain unchanged.

Light mode has no visible header divider. Expanded rules and the Add rule form use white frame highlights. The server menu matches the light editor frame: `#655561` interior, `#645460` upper rim, `#adcade` side/bottom highlights, black outline, and workspace-colored outer corners.

The strip immediately inside the top black outline uses `#c6c6c6` in light mode, independently of the darker outer inset rim. Text entries and dropdown fields share this lighter inner shadow.

## Music Box styling handoff

The November 11 integration adapts the reference package in `handoff/verethier/` to Angular and Bouncer's existing theme tokens. It retains the current font sizes, palette, light-mode overrides, checkbox image assets, theme-button dimensions, tab layout, and multiline inputs. Raised-button art drops its translucent final shadow row. Mini scrollbar thumbs use Aseprite's cut-corner shape, a black track with stepped end gaps, a 48px minimum length and blue hover/drag feedback. Vertical and horizontal variants retain dark `#41444a` and light `#7c919d` resting colors. The page's unframed scrollbar centres its thumb in a wider black track; framed containers use the narrower variant. Firefox retains native thin scrollbars with the same resting colors.

Checkbox labels gain mouse-only hover backgrounds, a pixel focus frame, disabled feedback and wrapping rows; the check images are unchanged. Light mode and forced colors retain their own focus colors. Member-lookup keyboard navigation adjusts only the suggestion list's scroll position, keeping the page still. New-role autofocus runs only if focus is still where the action left it, so a delayed animation frame cannot redirect subsequent typing into the wrong field.

The music-player widgets, draggable ordering, global typography/palette changes, custom animated caret, and text-selection suppression are intentionally not imported. Browser coverage checks whole-field toggle/hover, touch dismissal, keyboard navigation with a stationary pointer, menus beyond the previous height cap, field frames, control dimensions, and member-suggestion scrolling. Screenshots include scrollbars for visual review.
