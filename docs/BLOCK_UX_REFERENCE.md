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

## Verified in the running app (2026-07-24)

Measured with a seeded 19-Block fixture covering every kind, in Chrome at 1440×1000.

**Gutter geometry** — `+` 24×24, grip 24×24 (Notion: 24×24 and 18×24; the grip is kept square so
the drag target is not the smallest thing on the row). Grip right edge to first glyph: **10px
exactly**, matching Notion. Cluster is right-aligned in a 54px gutter with a 6px row gap, which is
what keeps `--editor-content-rail` a round 4rem.

**Control alignment to the Block's first text line** — measured `controlCentre − textCentre` per
kind, after correcting `--controls-lead` against these numbers rather than trusting the arithmetic
(the arithmetic alone was 3-24px out because container kinds add their own chrome):

| kind                      | before             | after             |
| ------------------------- | ------------------ | ----------------- |
| paragraph, all list kinds | −4.0               | 0.0               |
| heading 1 / 2 / 3         | −3.3 / −3.5 / −2.8 | +0.3 / 0.0 / +0.3 |
| blockquote                | +0.5               | +0.5              |
| fenced code               | +2.5               | 0.0               |
| table                     | −5.0               | 0.0               |
| block math                | −13.7              | +0.3              |
| callout                   | +5.5               | 0.0               |

**Hover band** — zero vertical gap between all 19 consecutive row boxes, so no pointer dead band
exists anywhere in the column. Controls at rest: `opacity: 0`, `pointer-events: none`,
`transition: opacity 110ms ease-out 90ms`; on hover `transition-duration: 0ms` — instant in,
forgiving out. Button feedback `0.02s`, radius `4px` — both Notion's measured values.

**Activation parity** — clicking into a Block must move nothing. Measured box x, first-glyph x,
font-size, line-height, font-style, colour and border width before and after activation for all 18
editable kinds: **17 report zero change on every axis.** The one exception is `block_math`
(16px→12px), which is intentional: the content itself changes from rendered KaTeX to LaTeX source,
and both Notion and Feishu also switch to a small mono input there.

### Code Blocks and inline code

Measured, then closed:

- A fenced Block's ``` delimiter lines are projected out of both the preview and the editing
  surface, so the Block reads as code the way it does in Notion and Feishu. The delimiters are
  reassembled verbatim on every write, and the split fails closed whenever it would be ambiguous —
  more than one candidate closing line, or content after it.
- The info string moved into a language chip on the Block, since projecting the fence away would
  otherwise make it unreachable. A free-text field rather than a menu, because a Markdown info
  string is arbitrary and a closed list would silently drop whatever a file already says.
- `block_math` keeps its `$$` visible on purpose. A fence tolerates an empty payload
  (` ```ts\n\n``` ` is still one code Block) but `$$\n\n$$` is a blank line between two
  paragraphs, so projecting it would let deleting an equation's contents disintegrate the Block.
- Inline code renders at **ratio 1.0** against its paragraph. Measured in Feishu Doc: inline code is
  the same size as body text, with the mono family and the tint carrying the distinction. Ours had
  been 12px inside 16px prose because `globals.css` routes `.markdown-page code` to the chrome
  code-font slider. Fenced Blocks still follow that slider — a code Block genuinely is a code
  surface — but inline code is prose.

### History and IME

- A typing run folds into one undo entry, keyed on position rather than a clock: the run continues
  only while the next edit starts exactly where the last one ended, in the same Block, without
  crossing whitespace and without changing the Block's kind. That gives word-level Mod+Z. Whitespace,
  any structural command, a Markdown autoformat, moving to another Block, an IME composition
  boundary, and a 600ms pause all checkpoint. Undo and redo stacks are capped at 200 entries.
- An IME composition issues **exactly one** command, at `compositionend`. The textarea holds its own
  DOM value for the duration, so React never writes a derived string back over in-flight pinyin —
  which is what used to close the candidate window. Verified in Chrome: zero document revisions
  across four composition updates, the DOM still holding `nihao` after a React commit, then one
  revision for the settled `你好`. The contenteditable surface additionally refuses to move the DOM
  selection while composing.
- The slash menu filters on the live composing text, so `/` followed by pinyin narrows as you type —
  Feishu's behaviour. Safe because Enter belongs to the IME until the composition commits, so the
  offsets used to execute a command always come from committed text.

### Drag and drop

- The drop target is computed once, from a boundary table measured at dragstart, and resolved as the
  boundary nearest the pointer. Deciding it from `dragover` on each row made the insertion line jump,
  because a row only sees pointer events inside its own box — the boundary flipped on whichever row
  happened to receive the event rather than on the edge the pointer is nearest. One table also makes
  the page margins and the tail region live drop zones instead of dead space.
- Boundaries that would not move anything are filtered out at dragstart, so a no-op drop paints no
  line and reports `dropEffect: "none"` rather than promising a move that will not happen.
- The insertion line is written straight to the DOM. Routing `dragover` through React state
  re-rendered every row on every pointer move.
- `setDragImage` gets a translucent clone of the Block's own content — the browser otherwise drags
  the 24px grip, which says nothing about what was picked up. Multiple Blocks stack with a count
  badge. The source rows fade to 40%.
- The Page auto-scrolls within 72px of either edge, ramping ~240px/s to ~1440px/s with proximity.
  HTML drag-and-drop suppresses wheel scrolling, so without this a Block can only be dropped
  somewhere already on screen.
- A moved list range is re-indented to be valid where it lands. Dragging a depth-2 item to the top of
  a Page used to emit `    - c`, four leading spaces, which Markdown reads as an indented code block —
  the list item silently stopped being a list item _in the user's file_. The shift applies to the
  whole range so nesting inside it survives, and it is validated by re-scanning: if the result would
  not parse back to the same Block kinds, the original bytes are kept rather than made worse.

Verified in Chrome with a real drag cycle: ghost created then removed, the line painted on the
correct row for a given `clientY`, the drop reordering as expected, and no leftover `data-block-dragging`,
indicator or ghost node afterwards.

### Block selection

- A pointer sweep past 4px becomes a Block selection, resolved from the rows' vertical bands rather
  than from `elementFromPoint` — which is what makes it work over the page margins, and the only
  thing that works when the pointer is beyond the content column. From the margin it also draws a
  marquee; inside a single Block the browser's own text selection is left alone.
- Typing over a selection replaces it. ArrowLeft/Right collapse it to a caret. Shift+Arrow grows a
  text selection into a Block selection. Shift+click extends from the caret's Block.
- A floating toolbar (Turn into / Copy / Duplicate / Delete) appears above the union of the selected
  rows, measured after commit. Turn into applies to the whole range; source-only Blocks in it are
  left byte-identical.
- One shortcut legend for the document, not one per row: a per-row `sr-only` copy landed inside any
  Range spanning two rows, so copying across Blocks pasted "Press Enter to edit…" into the clipboard.

### Inline marks and links

- Mod+B / Mod+I / Mod+E / Mod+Shift+X apply bold, italic, code, strike. Mod+K opens a link editor,
  from a range or from a caret inside an existing link.
- Applying a link asks for a destination. It used to write `[label](https://)` — a dead link, with
  the selection over the _label_, so the next keystroke rewrote the text rather than the URL.
- Two things were claiming those keys and both had to move: the window shortcut handler now honours
  `defaultPrevented`, and the app menu's Mod+B / Mod+K are `registerAccelerator: false` — a
  main-process accelerator fires _before_ the page, so no renderer-side handling could have won.

### Code Blocks, callouts, tables

- Syntax highlighting via `highlight.js/lib/core` with one dynamic import per language, so a Page
  with no code loads none of it. Output is reduced to `{ text, className }` tokens and rendered as
  React elements — nothing derived from a document reaches the DOM as markup (ADR-0011). An unknown
  language falls back to plain text rather than deriving a module path from the document. The
  _editing_ surface stays plain; only the rendered Block is highlighted.
- Callout type icon and accent per `[!TYPE]`, matched on the editing surface so activation does not
  repaint it.
- Table cells carry their own source offsets, so clicking a cell puts the caret in that cell; Tab
  walks cells and appends a row at the end; column alignment from the delimiter row is honoured.

### Known gaps, measured not guessed

- The active code editing surface is a plain textarea — highlighting applies to the rendered Block
  only. Highlighting while editing needs a token-aware editing surface, which is a much larger
  change than a preview.
- Table row/column _insertion_ has no hover control; Tab-at-the-end is the only way to add a row, and
  there is no way to add a column.
- `isMarkdownLinkOpaqueBlockSource` judges a span by its raw text alone, so a genuine nested list
  item indented 4+ columns is treated as indented code and its wiki links are masked out of the
  knowledge index. Pre-existing; the fix belongs at the two call sites, which should skip the check
  when the span has a `listDepth`.
