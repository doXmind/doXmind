# Block interaction reference: Notion and Feishu Doc

Measured directly in Chrome against live Notion (light theme, 720px content column, 16px/24px body)
and live Feishu Doc (dark theme, 16px/28.8px body) on 2026-07-24. Numbers are computed styles and
`getBoundingClientRect` values, not estimates. This is the yardstick for our block editor; where the
two products differ, the "ours" column records which one we took and why.

## Hover affordances and the control gutter

|                       | Notion                                                                                       | Feishu Doc                                                                                                           | Ours                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Controls              | `+` 24×24 then 6-dot grip 18×24, both `border-radius: 4px`                                   | one 42×26 pill, `border-radius: 6px`, holding a block-type icon + grip                                               | Notion's pair — a separate `+` is a bigger, more discoverable target than a type chip |
| Offset from text      | grip right edge 10px left of the text; `+` right edge 28px further left                      | pill right edge 4px left of the text                                                                                 | Notion's, via `--editor-content-rail: 4rem`                                           |
| Vertical alignment    | centered on the Block's **first line box**, not the row                                      | top-aligned to the Block box                                                                                         | Notion's, via `--controls-lead` per kind                                              |
| Reveal                | opacity, no perceptible fade                                                                 | never fades — one shared overlay _slides_ between rows (`transition: left .04s, top .2s cubic-bezier(.34,.69,.1,1)`) | instant reveal (0ms), 110ms fade-out after a 90ms grace                               |
| Hover band            | full page width at the Block's y, so moving into the gutter never drops it                   | the whole Block box; the sliding overlay makes a gap impossible                                                      | contiguous row boxes (spacing is `padding-top`, never `margin-top`)                   |
| Button hover feedback | `background 0.02s ease-in`                                                                   | `#292929` → `#373737`, instant                                                                                       | Notion's 20ms                                                                         |
| Row hover tint        | **none** on a text Block                                                                     | a very subtle tint on the Block box only                                                                             | **none**, Notion's — see below                                                        |
| Tooltips              | "Click to add below. Option-click to add a block above" / "Drag to move, click to open menu" | none                                                                                                                 | Notion's, as two-line app tooltips                                                    |

Feishu's Block box uses `padding: 0 2px; margin: 0 -2px` so its tint is 2px wider than the text with
zero layout shift — worth copying if the tint ever needs more breathing room.

We shipped a hover tint first and then removed it, so the reason is worth keeping. The cell above
used to read "a 2.8% tint confined to the content rail — Feishu's discoverability, Notion's
restraint", which was wrong twice. The rail was only the tint's _left_ bound; it ran to `right: 0`,
so it was not confined to anything. And Feishu tints the Block box, which for a short paragraph is
short — copying Feishu's tint at Notion's full column width produced a band belonging to neither
product. Measured in the running app: hovering a six-character paragraph painted 1016×40px and
changed 73% of the row's pixels, from anywhere in the row including the gutter. That reads as the
Block inflating into a long clickable bar. The gutter controls appearing are the entire hover
affordance in Notion, and they are enough here too.

The click target is a separate question and was already right: pressing at 95% of the row width on a
six-character paragraph puts the caret at offset 6, the end of the text, which is what Notion does
across its own content column. Only the paint was wrong.

## Menus

This table had no "Ours" column until 2026-08-05, unlike the two either side of it. That absence was
load-bearing and easy to misread: the Notion figures were a _target_, and nothing had ever recorded
whether we hit them. `rgba(42,28,0,.07)` in particular has never appeared in `src/` in any commit
(`git log --all -S`). The "Ours" column below is measured, not aspirational.

|                     | Notion                                                                                                                                            | Feishu Doc                                      | Ours (measured 2026-08-05)                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Block menu          | 265px wide, `border-radius: 10px`, opaque white, **no** backdrop blur                                                                             | —                                               | 265px, `10px`, `rgb(255,255,255)`, `backdrop-filter: none` — all four match              |
| Shadow              | `0 20px 24px rgba(25,25,25,.05)`, `0 5px 8px rgba(25,25,25,.027)`, `0 0 0 1px rgba(42,28,0,.07)` — a hairline ring, not a border                  | `0 8px 16px rgba(0,0,0,.28)`                    | **diverges** — both blur layers 2x Notion's alpha, ring opaque `#CCCCCC`; see below      |
| Menu item           | 28px tall, `border-radius: 6px`, 1px gap, `background .02s ease-in`, right-aligned ⌘ hint                                                         | 32px tall, `border-radius: 4px`                 | 28px, `6px`, 1px gap, `0.02s` — the gap was 0px until `MENU_PANEL_CLASS` gained `gap-px` |
| Block menu contents | search · Turn into ▸ · Color ▸ · Copy link to block · Duplicate ⌘D · Move to ⌘⇧P · Delete · Comment · Suggest edits · Ask AI · last-edited footer | Turn into · Copy · Duplicate · Comment · Delete | no Color / Copy link / Comment / Suggest edits / Ask AI — excluded by ADR-0011/0012      |

**Something moves the block menu's panel on Linux, and it is not the row gap.** `menus.spec.ts`'s
"a second press on Turn into" asserts the parent panel's height does not change when the submenu
opens, and on CI it changed by 13.97px and then 13.53px on two of three runs. The row gap was the
obvious suspect — `gap-px` across fourteen rows is about 14px — so it was backed out, and the
assertion failed at 13.53px anyway with the gap gone. The magnitude agreeing was a coincidence; the
gap is restored and the panel movement is unexplained.

What is known: it does not reproduce on macOS across ten consecutive local runs, it is intermittent
on Linux CI, and ~13.5px is close to the thickness of a classic scrollbar — which macOS does not
have, because its scrollbars are overlays that take no layout space. That is a direction to check,
not a conclusion. The same test was failing before this work at 2.837px for a different reason (an
unsettled read, since fixed), so it has a history of being the place where platform differences in
menu layout surface first.

**The shadow is a live decision, not a bug.** Ours is
`0 0 0 1px hsl(var(--popover-ring)), 0 5px 8px rgba(25,25,25,.06), 0 20px 24px rgba(25,25,25,.1)`
with `--popover-ring: #CCCCCC`. Against Notion that is twice the alpha on both blur layers and an
opaque ring at 1.61:1 where Notion's is a translucent warm black at roughly 1.08:1 — our menu edge is
markedly more present, which is most of what reads as "heavier than Notion". But the ring token and
its first-in-the-list position are deliberate and measured (`globals.css`, 15 lines of rationale):
they exist so the light and dark themes state the _same_ edge strength, and Notion's 7%-alpha warm
black is invisible on a dark panel. Adopting Notion's values would restore light-mode parity and
reintroduce exactly the cross-theme asymmetry the token pair was introduced to remove. Decide the
ring and the two blur alphas together — they are one visual system — and record the outcome here.

## Slash / insert menu

|             | Notion                                                                                        | Feishu Doc                                                                          | Ours                                                                  |
| ----------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Trigger     | `/`                                                                                           | `/` **and** the fullwidth `、`                                                      | both                                                                  |
| Anchor      | the caret, 8px below the caret's line                                                         | the line's left edge                                                                | the caret (Notion's — it tracks where you are typing)                 |
| Panel       | 314px, ≤434px tall, `border-radius: 10px`                                                     | 247px, `border-radius: 6px`                                                         | 314px, ≤434px, `10px` — the ceiling was a hard 320px until 2026-08-05 |
| Item        | 31px tall, `border-radius: 6px`; selected `rgba(42,28,0,0.07)` — a **warm neutral**, not blue | 32px; selected `rgba(235,235,235,0.08)`                                             | 31px, theme accent                                                    |
| Row content | icon + label + right-aligned Markdown shortcut (`#`, `##`, `###`)                             | icon + label                                                                        | Notion's, including the shortcut hint                                 |
| Grouping    | "Suggested" / "Basic blocks" section headers                                                  | "Basics" / "Common"                                                                 | flat + ranking (see below)                                            |
| CJK search  | —                                                                                             | **matches full pinyin**: `/biaoti` filters to Heading 1-6 in an _English_ workspace | Feishu's, plus pinyin initials (`bt`) and acronyms (`bl`, `tbl`)      |
| Inline hint | block placeholder becomes "Type to search"                                                    | "Type in keywords to find a command"                                                | —                                                                     |

The pinyin behaviour was verified live, not assumed: typing `/biaoti` into an English-labelled Feishu
workspace narrowed the panel to exactly the six Heading rows.

## Placeholders

- Notion, focused empty paragraph: `Press 'space' for AI or '/' for commands`. Unfocused empty
  Blocks carry `placeholder=" "`, i.e. nothing is shown.
- Notion page title: `New page`.
- Ours: `Write, or press '/' for commands` on the focused empty paragraph; an empty heading always
  shows `Heading N`, the way both products label one.

## Selection

- Notion text selection: `rgba(35, 131, 226, 0.28)`. This line read `0.14` until 2026-08-06, and
  that number was measured off the wrong element. Read out of Notion's stylesheet, its global rule is
  `::selection { background: rgba(35, 131, 226, 0.28) }` — no media query, and no dark-theme override
  anywhere in the sheet, so Notion selects text at 0.28 in both themes. The 0.14 is real but scoped
  to `.notion-page-mention-token`, `.notion-external-object-token`, `.notion-team-mention-token` and
  `.notion-collection-mention-token`: the inline chips, which carry a tint already and so take a
  lighter wash over it.
- Notion keeps the highlight visible when focus moves into a menu by swapping in a `.pseudoSelection`
  class that repaints the range from CSS variables. Worth copying when our inline toolbar grows a
  field that takes focus.
- Ours: the same `rgba(35,131,226,0.14)` for a Block selection, drawn on a row `::after` that bridges
  the inter-row gap so consecutive selected Blocks read as one band. Verified still exact on
  2026-08-05.
- **Text** selection is a separate value from Block selection, and conflating them cost two wrong
  conclusions in a row. Ours paints `.markdown-page ::selection { rgba(35,131,226,0.28) }`. Against
  the mis-scoped 0.14 that looked like twice Notion's alpha and got written up as a divergence; against
  Notion's actual `::selection` it is exact, and always was. Two things were genuinely wrong and are
  now fixed: the app chrome outside the Page painted `rgba(46,170,220,·)`, a colder cyan that is not
  Notion's hue at all, under a comment already claiming it was; and our dark theme used `0.34` where
  Notion uses the same `0.28` it uses in light. One alpha, both themes, chrome and Page alike.
- The lesson worth keeping: a colour read off a rendered element is only as good as the element. Both
  errors here came from measuring something adjacent to the thing being described — a mention chip
  instead of body text — and neither would have survived reading the rule that actually applies.

## Motion

Neither product animates anything anchored to the caret — a menu or toolbar that eases into position
reads as lag. Hover states are effectively instant (Notion: 20ms). Only menus get an entry
animation, and only around 150ms.

Audited against the code on 2026-08-05. Three corrections, all to this paragraph rather than to the
product:

- **"Nothing anchored to the caret animates" was not true of the gutter.** The controls answer
  `:focus-within`, and the rule that cancels their 90ms + 110ms fade for rows the user has left was
  gated on `.markdown-page:hover` — it only ever saw the pointer. ArrowDown with the mouse away from
  the Page left the previous row's cluster ramping down behind the caret. Fixed by extending the
  cancel to `:focus-within`, on the condition the original comment already stated: the forgiving fade
  is for when _nothing else is lighting up to take over_, and while the Page holds focus something
  always is. Pinned by `tests/e2e/block-ux/caret-gutter-continuity.spec.ts`, which fails with
  `0.11s` against the rule removed.
- **"Hover states are 20ms" held everywhere it was a hover state.** The two exceptions that audit
  found were emoji-picker buttons, and that component has since been deleted with the rest of the
  Page-icon surface. The three remaining 150ms/200ms sites it flagged — `switch.tsx`, `input.tsx`, `.skip-to-content` —
  are not hover states: the first two transition a focus ring and a checked state, and the third is
  the skip link sliding into view, where the animation is the feature. The sentence means hover, not
  every transition in the product.
- **"Only menus get an entry animation" is a claim about menus, not about the keyframe.**
  `animate-in fade-in-0 zoom-in-95` is also used by the tooltip, the popover primitive, the command
  palette and the quick switcher — all overlays, none caret-anchored, so none of them contradict the
  rule this sentence exists to state. The gap this once named — the sidebar folder and
  empty-area context menus hard-cutting into view — is closed; both now carry the same keyframe. The slash panel's omission is
  deliberate and correct — it _is_ caret-anchored.

## Local trap worth knowing

`globals.css` overrides Tailwind's `.text-*` utilities with the 13px chrome type scale using
`!important`. Any Block preview that carries `text-base` therefore renders at 13px while its editing
surface inherits `.markdown-page`'s 16px, so clicking a paragraph jumped it a whole type step and
reflowed the Page. Previews now carry the same `data-editor-kind`/`data-editor-level` attributes as
the editing surface and both are sized once in `editor.css`. Do not reintroduce `text-*` utilities
inside `BlockPreview`.

## Verified in the running app (2026-07-24)

Measured with a seeded 19-Block fixture covering every kind, in Chrome at 1440×1000.

"Every kind" was not true of `KIND_FIXTURES`, and one of the gaps was hiding a dead test. The list
covers 13 of the 16 members of `MarkdownBlockKind`; `image`, `collection` and `mermaid` had no entry.
`mermaid` was the costly one: `in-place.spec.ts` gates its activation-growth test on
`label === "equation" || label === "mermaid"`, and since no case anywhere carried that label, the
branch had never run — the file read as though it covered the kind. A `mermaid` case is now in
`CASES`, which activates four tests that were previously unreachable. `image` and `collection` are
select-only shells with no caret; `image` already has its own case there, `collection` still has
none.

**Gutter geometry** — `+` 24×24, grip 24×24 (Notion: 24×24 and 18×24; the grip is kept square so
the drag target is not the smallest thing on the row). Grip right edge to first glyph: **10px
exactly**, matching Notion. Cluster is right-aligned in a 54px gutter with a 6px row gap, which is
what keeps `--editor-content-rail` a round 4rem.

**Control alignment to the Block's first text line** — measured `controlCentre − textCentre` per
kind, after correcting `--controls-lead` against these numbers rather than trusting the arithmetic
(the arithmetic alone was 3-24px out because container kinds add their own chrome):

| kind                      | before             | after             | re-measured 2026-08-05 |
| ------------------------- | ------------------ | ----------------- | ---------------------- |
| paragraph, all list kinds | −4.0               | 0.0               | 0.00                   |
| heading 1 / 2 / 3         | −3.3 / −3.5 / −2.8 | +0.3 / 0.0 / +0.3 | 0.00 / 0.00 / 0.00     |
| blockquote                | +0.5               | +0.5              | 0.00                   |
| fenced code               | +2.5               | 0.0               | 0.00                   |
| table                     | −5.0               | 0.0               | 0.00                   |
| block math                | −13.7              | +0.3              | −0.01                  |
| callout                   | +5.5               | 0.0               | 0.00                   |

The fourth column is not drift — it is an improvement nobody had recorded. `fdc325a` rewrote the
gutter-alignment effect to measure every row before writing to any of them (it was doing O(N²)
forced layout). Batching the reads also removed the sub-pixel residue the third column still
carried: every kind now lands on 0.00, headings and block math included. Re-take this column with
`tests/e2e/block-ux/parity-measure.spec.ts` rather than by hand.

**Hover band** — zero vertical gap between all 19 consecutive row boxes, so no pointer dead band
exists anywhere in the column. Controls at rest: `opacity: 0`, `pointer-events: none`,
`transition: opacity 110ms ease-out 90ms`; on hover `transition-duration: 0ms` — instant in,
forgiving out. Button feedback `0.02s`, radius `4px` — both Notion's measured values.

**Activation parity** — clicking into a Block must move nothing. Measured box x, first-glyph x,
font-size, line-height, font-style, colour and border width before and after activation for all 18
editable kinds: **17 report zero change on every axis.** The one exception is `block_math`
(16px→12px), which is intentional: the content itself changes from rendered KaTeX to LaTeX source,
and both Notion and Feishu also switch to a small mono input there.

Three amendments from the 2026-08-05 audit. The behaviour is intentional and tested in every case;
it is the paragraph above that had gone stale.

- **There are two exceptions now, not one.** `mermaid` joins `block_math`: both route to
  `MarkdownFigureBlock`, and `in-place.spec.ts` names them together —
  `testCase.label === "equation" || testCase.label === "mermaid"` — to skip the height-parity test
  and run a growth test instead.
- **The exception is a height change, not just a font-size one.** `MarkdownFigureBlock` mounts its
  source panel _below_ the figure while active, so the row grows — 56.8px for a one-line equation,
  capped at eight rows. The figure itself does not move; everything after it does. "Clicking into a
  Block must move nothing" is still the rule, and these two kinds are the priced exception to it.
- **The 16px→12px description no longer describes what happens.** The KaTeX render stays mounted at
  its own 16px; the 12px is the source field _added beneath it_, sized by
  `--ui-code-font-size-base`, which the user can move from 10 to 22px with the code-font slider. So
  it is not a substitution and not a fixed 12px.

### Code Blocks and inline code

Measured, then closed:

- A fenced Block's ``` delimiter lines are projected out of both the preview and the editing
  surface, so the Block reads as code the way it does in Notion and Feishu. The delimiters are
  reassembled verbatim on every write, and the split fails closed whenever it would be ambiguous —
  more than one candidate closing line, or content after it.
- The info string moved into a language chip on the Block, since projecting the fence away would
  otherwise make it unreachable. A free-text field rather than a menu, because a Markdown info
  string is arbitrary and a closed list would silently drop whatever a file already says.
- `block_math` no longer keeps its `$$` visible — this line used to say it did, and that the
  visibility was what stopped an emptied equation from disintegrating. The hazard is real and
  unchanged: a fence tolerates an empty payload (` ```ts\n\n``` ` is still one code Block) but
  `$$\n\n$$` is a blank line between two `$$` paragraphs. The defence moved rather than
  disappeared. `assembleMath` refuses to write that shape at all: an emptied equation collapses to
  the one-line `$$ $$`, which holds nothing safely and leaves something to type back into, and the
  first newline typed into a one-line equation promotes it back to the fenced shape rather than
  producing `$$a` / `b$$`. Verified end to end against the file's bytes in
  `tests/e2e/block-ux/figure-integrity.spec.ts` — emptying an equation leaves one `block_math` row,
  two `$$`, and its neighbours untouched.
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
  _editing_ surface is highlighted too: the `<pre>` is mounted in both states and never unmounted, and the editing surface is a transparent textarea laid exactly over it, so the glyphs the user reads are always the rendered ones.
- Callout type icon and accent per `[!TYPE]`, matched on the editing surface so activation does not
  repaint it.
- Table cells carry their own source offsets, so clicking a cell puts the caret in that cell; Tab
  walks cells and appends a row at the end; column alignment from the delimiter row is honoured.

### Known gaps, measured not guessed

- `isMarkdownLinkOpaqueBlockSource` judges a span by its raw text alone, so a genuine nested list
  item indented 4+ columns is treated as indented code and its wiki links are masked out of link
  relocation: rename or move a Page and the links inside such an item are left pointing at the old
  path. Pre-existing; the fix belongs at the two call sites — `page-link-relocation.ts`, which the
  rename and move paths run, and `knowledge-index.ts`, whose `buildKnowledgeIndex` no component
  calls any more — which should skip the check when the span has a `listDepth`.
