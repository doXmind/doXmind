# Block interaction reference: Notion and Feishu Doc

Measured directly in Chrome against live Notion (light theme, 720px content column, 16px/24px body)
and live Feishu Doc (dark theme, 16px/28.8px body) on 2026-07-24. Numbers are computed styles and
`getBoundingClientRect` values, not estimates. This is the yardstick for our block editor; where the
two products differ, the "ours" column records which one we took and why.

## Hover affordances and the control gutter

|                       | Notion                                                                                       | Feishu Doc                                                                                                           | Ours                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Controls              | `+` 24×24 then 6-dot grip 18×24, both `border-radius: 4px`                                   | one 42×26 pill, `border-radius: 6px`, holding a block-type icon + grip                                               | Notion's pair — a separate `+` is a bigger, more discoverable target than a type chip   |
| Offset from text      | grip right edge 10px left of the text; `+` right edge 28px further left                      | pill right edge 4px left of the text                                                                                 | Notion's, via `--editor-content-rail: 4rem`                                             |
| Vertical alignment    | centered on the Block's **first line box**, not the row                                      | top-aligned to the Block box                                                                                         | Notion's, via `--controls-lead` per kind                                                |
| Reveal                | opacity, no perceptible fade                                                                 | never fades — one shared overlay _slides_ between rows (`transition: left .04s, top .2s cubic-bezier(.34,.69,.1,1)`) | instant reveal (0ms), 110ms fade-out after a 90ms grace                                 |
| Hover band            | full page width at the Block's y, so moving into the gutter never drops it                   | the whole Block box; the sliding overlay makes a gap impossible                                                      | contiguous row boxes (spacing is `padding-top`, never `margin-top`)                     |
| Button hover feedback | `background 0.02s ease-in`                                                                   | `#292929` → `#373737`, instant                                                                                       | Notion's 20ms                                                                           |
| Row hover tint        | **none** on a text Block                                                                     | a very subtle tint on the Block box only                                                                             | a 2.8% tint confined to the content rail — Feishu's discoverability, Notion's restraint |
| Tooltips              | "Click to add below. Option-click to add a block above" / "Drag to move, click to open menu" | none                                                                                                                 | Notion's, as two-line app tooltips                                                      |

Feishu's Block box uses `padding: 0 2px; margin: 0 -2px` so its tint is 2px wider than the text with
zero layout shift — worth copying if the tint ever needs more breathing room.

## Menus

|                     | Notion                                                                                                                                            | Feishu Doc                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Block menu          | 265px wide, `border-radius: 10px`, opaque white, **no** backdrop blur                                                                             | —                                               |
| Shadow              | `0 20px 24px rgba(25,25,25,.05)`, `0 5px 8px rgba(25,25,25,.027)`, `0 0 0 1px rgba(42,28,0,.07)` — a hairline ring, not a border                  | `0 8px 16px rgba(0,0,0,.28)`                    |
| Menu item           | 28px tall, `border-radius: 6px`, 1px gap, `background .02s ease-in`, right-aligned ⌘ hint                                                         | 32px tall, `border-radius: 4px`                 |
| Block menu contents | search · Turn into ▸ · Color ▸ · Copy link to block · Duplicate ⌘D · Move to ⌘⇧P · Delete · Comment · Suggest edits · Ask AI · last-edited footer | Turn into · Copy · Duplicate · Comment · Delete |

## Slash / insert menu

|             | Notion                                                                                        | Feishu Doc                                                                          | Ours                                                             |
| ----------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Trigger     | `/`                                                                                           | `/` **and** the fullwidth `、`                                                      | both                                                             |
| Anchor      | the caret, 8px below the caret's line                                                         | the line's left edge                                                                | the caret (Notion's — it tracks where you are typing)            |
| Panel       | 314px, ≤434px tall, `border-radius: 10px`                                                     | 247px, `border-radius: 6px`                                                         | 314px                                                            |
| Item        | 31px tall, `border-radius: 6px`; selected `rgba(42,28,0,0.07)` — a **warm neutral**, not blue | 32px; selected `rgba(235,235,235,0.08)`                                             | 31px, theme accent                                               |
| Row content | icon + label + right-aligned Markdown shortcut (`#`, `##`, `###`)                             | icon + label                                                                        | Notion's, including the shortcut hint                            |
| Grouping    | "Suggested" / "Basic blocks" section headers                                                  | "Basics" / "Common"                                                                 | flat + ranking (see below)                                       |
| CJK search  | —                                                                                             | **matches full pinyin**: `/biaoti` filters to Heading 1-6 in an _English_ workspace | Feishu's, plus pinyin initials (`bt`) and acronyms (`bl`, `tbl`) |
| Inline hint | block placeholder becomes "Type to search"                                                    | "Type in keywords to find a command"                                                | —                                                                |

The pinyin behaviour was verified live, not assumed: typing `/biaoti` into an English-labelled Feishu
workspace narrowed the panel to exactly the six Heading rows.

## Placeholders

- Notion, focused empty paragraph: `Press 'space' for AI or '/' for commands`. Unfocused empty
  Blocks carry `placeholder=" "`, i.e. nothing is shown.
- Notion page title: `New page`.
- Ours: `Write, or press '/' for commands` on the focused empty paragraph; an empty heading always
  shows `Heading N`, the way both products label one.

## Selection

- Notion text selection: `rgba(35, 131, 226, 0.14)`.
- Notion keeps the highlight visible when focus moves into a menu by swapping in a `.pseudoSelection`
  class that repaints the range from CSS variables. Worth copying when our inline toolbar grows a
  field that takes focus.
- Ours: the same `rgba(35,131,226,0.14)` for a Block selection, drawn on a row `::after` that bridges
  the inter-row gap so consecutive selected Blocks read as one band.

## Motion

Neither product animates anything anchored to the caret — a menu or toolbar that eases into position
reads as lag. Hover states are effectively instant (Notion: 20ms). Only menus get an entry
animation, and only around 150ms.

## Local trap worth knowing

`globals.css` overrides Tailwind's `.text-*` utilities with the 13px chrome type scale using
`!important`. Any Block preview that carries `text-base` therefore renders at 13px while its editing
surface inherits `.markdown-page`'s 16px, so clicking a paragraph jumped it a whole type step and
reflowed the Page. Previews now carry the same `data-editor-kind`/`data-editor-level` attributes as
the editing surface and both are sized once in `editor.css`. Do not reintroduce `text-*` utilities
inside `BlockPreview`.
