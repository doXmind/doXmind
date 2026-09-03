# Product Direction

Status: active
Last updated: 2026-07-22

This document is the living source of truth for doXmind's product boundary and
roadmap. Architecture decisions that make this direction durable live in
[`adr/0011-local-markdown-knowledge-workspace.md`](adr/0011-local-markdown-knowledge-workspace.md),
[`adr/0012-markdown-source-block-editor.md`](adr/0012-markdown-source-block-editor.md),
[`adr/0013-electron-only-desktop-runtime.md`](adr/0013-electron-only-desktop-runtime.md),
[`adr/0014-local-page-pdf-export.md`](adr/0014-local-page-pdf-export.md),
and [`adr/0015-legacy-sidecars-are-inert.md`](adr/0015-legacy-sidecars-are-inert.md).

## North star

> doXmind is a fully local, Markdown-native knowledge workspace: Notion-style
> editing and organization with Obsidian-style file ownership, links, and a
> rebuildable knowledge graph.

This is the target state, not a claim of current Notion or Obsidian parity. The
delivery-status table and phased roadmap below are authoritative for what has
actually shipped.

The comparison is deliberately narrow:

- **Notion-style** means blocks, properties, templates, and collection views.
  It does not mean cloud databases, accounts, permissions, or collaboration.
- **Obsidian-style** means a real local folder, portable Markdown, Wiki Links,
  backlinks, and indexes that can be rebuilt from files. It does not require a
  plugin marketplace before the core product is complete.

The product has one primary content type: a **Page** backed by `.md` or
`.markdown`. The currently surfaced **Attachment** types are PDF, spreadsheet,
and HTML; images and other files remain ordinary local assets/files. Expanding
which files appear in the Attachment surface does not make them editable Page
types. Exporting a Page to PDF does not make PDF an editable content type.

## Product invariants

1. The user's workspace folder is the source of truth.
2. One Markdown file is a complete Page. Normal Page operations do not require
   or create a same-name `.doxmind` file.
3. Page body, properties, aliases, and links live in Markdown or YAML
   frontmatter.
4. Markdown source is the editor state. Blocks are source spans and operations,
   not HTML/JSON records mirrored into another document model.
5. Backlinks, search results, and graph edges are derived indexes, never source
   data.
6. Attachments are never silently rewritten. doXmind may preview, reveal, open,
   or reference them. Any future explicit conversion must create a Page without
   rewriting the source Attachment.
7. Existing Page/PDF/Excel sidecars are inert legacy artifacts. doXmind does not
   read them, and they are never overwritten or deleted as part of scope
   reduction.
8. New features must strengthen Pages, links, properties, collections, or the
   local workspace. A second office-format editor requires a new product
   decision.

## Capability boundary

| Capability                                                                   | Decision            | Boundary                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open Folder and real file tree                                               | Keep and strengthen | Real folders and filenames remain visible; no hidden cloud workspace.                                                                                                                            |
| Markdown block editing                                                       | Core                | A source-backed block kernel, autosave, external-edit protection, and exact-source preservation are the main editing path.                                                                       |
| TipTap / ProseMirror                                                         | Removed             | No runtime, source import, or package dependency; raw Markdown is the fallback for syntax without semantic controls.                                                                             |
| Blocks                                                                       | Keep and strengthen | Headings, lists, tasks, quotes, tables, code, math, Mermaid, callouts, portable `<details>` Toggles, raw fallback, and block handles are native; slash commands insert canonical Markdown.       |
| Search, outline, tabs, command palette, templates                            | Keep                | All operate locally and primarily on Pages.                                                                                                                                                      |
| Page properties, aliases, and relations                                      | Core                | Aliases, scalar/list fields, and exact Wiki-Link relations use revision-guarded lossless YAML patches. Formulas and rollups are zero-write Collection projections, not persisted fields.         |
| Page links                                                                   | Keep and strengthen | Local `[[Wiki Links]]` navigate from the native editor; Wiki and relative Markdown links are indexed from files. Page/Folder relocation repairs resolvable links transactionally.                |
| Backlinks and unlinked mentions                                              | Keep and strengthen | Backlinks, unresolved links, and unlinked mentions rebuild on demand from Markdown with no workspace writes.                                                                                     |
| Transclusion                                                                 | Keep and strengthen | Standalone Page, unique ATX heading, and unique `^block-id` embeds project recursively from Markdown with ambiguity/cycle/depth guards.                                                          |
| Daily Notes                                                                  | Keep                | Today's local-date note opens or creates the ordinary Page `Daily Notes/YYYY-MM-DD.md`; there is no journal database.                                                                            |
| Collections                                                                  | Rebuild             | Strict `doxmind-collection` v1/v2 fences derive read-only Table, Board, and Calendar views from Pages; v2 can evaluate relations, safe formula ASTs, and rollups before querying.                |
| Existing DatabaseBlock                                                       | UI removed; recover | The mounted editor/store is deleted. PAGELEG-1 exports the exact artifact bytes containing `extras.databases`; row migration into Pages and portable Collection definitions remains future work. |
| Markdown source copy and Markdown-to-PDF export                              | Keep                | Desktop source copy preserves complete Page bytes; Electron generates and atomically writes PDF output locally without a printer or server pipeline.                                             |
| PDF/spreadsheet/HTML files                                                   | Attachments         | Current desktop behavior is a read-only card with reveal/open-externally actions. CLI/MCP parsing of PDF/spreadsheets is separate; conversion into a Page remains future work.                   |
| New blank PDF/Excel                                                          | Remove now          | The New menu and primary create model create only Page, Folder, or Template.                                                                                                                     |
| PDF text editing and annotation                                              | Remove              | The old editor is no longer mounted. Read-only inspection can export its exact legacy JSON state in a Markdown recovery report.                                                                  |
| Excel grid, formulas, and formatting                                         | Remove              | The old editor is no longer mounted. Read-only inspection can export its exact legacy JSON state in a Markdown recovery report.                                                                  |
| HTML editing                                                                 | Compatibility only  | HTML is not a Page format. Existing workspace files are read-only Attachments; there is no current HTML drag-import or conversion-to-Page flow.                                                  |
| PDF/Excel-specific settings and release expansion                            | Removed             | Dedicated editor, create/write/cache, and Synthetic Document migration paths are deleted.                                                                                                        |
| Local Markdown images                                                        | Keep and strengthen | Relative images use bounded, signature-checked, symlink-free reads. Electron paste/drop imports supported raster bytes into `assets/` without overwrite and inserts a portable relative link.    |
| Graph view                                                                   | Keep                | The Page context derives a bounded, navigable graph from the zero-write resolved-link index; graph layout and edges are disposable views.                                                        |
| Plugin API and marketplace                                                   | Later               | First stabilize commands, storage, and extension boundaries; do not make plugins the architecture.                                                                                               |
| Accounts, cloud sync, sharing, comments, permissions, realtime collaboration | Out                 | These conflict with the fully local single-user product.                                                                                                                                         |
| Built-in AI runtime, providers, billing, telemetry                           | Out                 | Not part of this product boundary.                                                                                                                                                               |

## Navigation contract

The main navigation has one editing destination: Page.

```text
Welcome
├── New Page
├── Open Workspace
└── Recent Workspaces / Pages

Workspace sidebar
├── Search
├── Daily Note
├── Pages and folders
└── Attachments

New (+)
├── Page
├── Folder
└── From Template

Page context
├── Outline
├── Properties
├── Backlinks
└── Graph
```

An Attachment click opens a read-only preview or offers **Open Externally**.
It must not switch the application into a second document editor with its own
creation, save, formatting, and export model.

The visible tree continues to mirror the real filesystem. Notion-style manual
sibling ordering is not part of the current boundary; folders, names, and a
deterministic sort remain authoritative.

## Data model

The ownership rules below are the active contract. The persisted workspace
index contains only a rebuildable frontmatter-id/path map, while the shared Page
catalog, Markdown search, link/backlink occurrence index, Collection membership,
and graph rebuild from files on demand. Replaceable preferences/recents live in
the desktop WebView's local application profile. There is no persisted property,
Collection, or graph truth.

```text
Workspace/
├── Project Plan.md                 # Page body + frontmatter properties + links
├── Research/
│   └── Source Notes.md
├── attachments/
│   ├── spec.pdf                    # attachment; no new editor state
│   └── budget.xlsx
└── assets/
    └── diagram.png                 # ordinary local file; referenced read-only

~/.doxmind/workspaces/<workspace-key>/
└── index.json                      # current: disposable frontmatter id/path map

Platform application profile
└── WebView localStorage            # current: replaceable preferences/recents
```

### Page

- Body: Markdown.
- Properties, aliases, dates, and collection fields: YAML frontmatter.
- Stable identity: frontmatter `id` for doXmind-created Pages. External files
  without an id open without modification and use path identity until the user
  explicitly adds properties.
- Links and embeds: visible `[[target]]`, `![[target]]`, standard Markdown links,
  and authored trailing `^block-id` anchors, never a sidecar-only relationship.
- Toggles: standard `<details>` / `<summary>` source with Markdown content.
- Collections: strict `doxmind-collection` fenced JSON definitions; membership,
  computed values, and Table/Board/Calendar projections are derived rather than
  persisted into the Page.
- Images: relative Markdown references to local workspace assets. Electron may
  copy verified pasted/dropped bytes into `assets/`; the Markdown reference is
  the only Page state and preview Blob URLs remain ephemeral.
- Rich editor state: the Markdown source itself. Block spans, selections and
  rendered HTML are in-memory, replaceable views.

### Attachment

- The original file is the only authoritative attachment content.
- The workspace may index filename, path, MIME type, and extractable text as a
  disposable cache.
- New PDF/Excel edit state is not written.
- Legacy PDF/Excel sidecars are never opened, migrated, or rewritten.

### Collection

- A collection is a query over Pages and their frontmatter properties.
- A row is a Page, not a record stored only in `extras.databases`.
- Version 1 remains an exact `table` definition with ANDed `equals` / `contains`
  / `exists` filters, explicit columns, and deterministic multi-field sorting.
- Version 2 keeps that query grammar and adds `table`, `board`, and `calendar`.
  Board requires `groupBy`; Calendar requires `dateBy` and accepts only real
  `YYYY-MM-DD` values, with an explicit Unscheduled bucket.
- Version 2 may carry a strict computed-properties version 1 object. A relation
  declaration resolves an exact `[[Page]]` string or string array from the
  same-named frontmatter field. Formula values come from a non-executable JSON
  AST (`literal`, `property`, arithmetic, comparison, boolean, `concat`, `if`).
  Rollups apply `count`, `sum`, `min`, `max`, `join`, or `unique` over a declared
  relation. Derived values participate in filters, sort, columns, Board grouping,
  and Calendar scheduling but are never written to a Page or sidecar.
- Every preview is read-only. Invalid schemas, dependency cycles, type errors,
  and missing/ambiguous relation targets fail closed with diagnostics.

### Derived indexes

The current persisted index maps authored Page ids to paths; Markdown search
scans files on demand. One zero-write Page catalog supplies Wiki and relative
Markdown link occurrences, backlinks, unlinked mentions, ambiguities,
unresolved links, the source-page view used by transclusion, scalar/list and
relation-source properties, Collection membership/computed projections, and
graph edges. Collection and graph views are recomputed in memory. Any future
cache must live in app data rather than the workspace, remain safe to delete,
and be recreatable by a zero-write scan without changing any Page or Attachment.

## Transition policy for PDF and Excel

Scope reduction is intentionally two-stage:

1. **Freeze and hide:** remove blank creation and primary navigation; stop all
   new editor work; classify the formats as Attachments in the shared model.
2. **Remove:** `LEGACY-03` removed the old editor bundles, attachment
   create/write/cache commands, Synthetic Document migration writers, and their
   dedicated dependencies. The Attachment card now only reveals the file or
   opens it in the system application.

The removal gate is satisfied only when all of the following are true:

- New workspaces cannot create a PDF or spreadsheet editor state.
- Opening a normal attachment creates no sidecar and reads no sidecar.
- Automated tests prove that sources, sidecars, `.bak`, `.lock`, and
  `.corrupt-*` files are not silently deleted or overwritten.

## Roadmap

### Delivery status — 2026-07-22

| ID         | Status   | Current state                                                                                                                                                                                                 |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DIR-01     | Complete | The product direction and ADR-0011 define Markdown Page as the only primary content type.                                                                                                                     |
| NAV-01     | Complete | New creates only Page, Folder, or Template; PDF/Excel creation is absent from primary navigation.                                                                                                             |
| MODEL-01   | Complete | Primary create input is Markdown/folder-only; binary formats enter the workspace only as existing files or imports.                                                                                           |
| STORE-01   | Complete | Electron/Node, browser-dev Python, CLI, and frontend Page paths persist one Markdown file; scan indexes live in app data.                                                                                     |
| ID-01      | Complete | Page scan/search use frontmatter identity or path fallback; legacy Sidecar ids cannot influence the derived index.                                                                                            |
| DESKTOP-01 | Complete | Electron is the only packaged desktop shell, executes workspace commands in-process, and has no Python/FastAPI lifecycle or bundled server.                                                                   |
| EDITOR-01  | Complete | One native runtime handles every Page; exact spans, guarded block/keyboard commands, CRLF-aware multi-block paste, IME-safe undo, autosave, semantic projections, and raw fallback share canonical Markdown.  |
| EDITOR-02  | Complete | Production source and package dependencies contain no TipTap or ProseMirror; obsolete adapters, extensions and tests are deleted.                                                                             |
| PAGE-01    | Complete | Aliases, scalar/list properties, and exact Wiki-Link Page relations use revision-guarded minimal YAML patches while preserving untouched source.                                                              |
| PAGELEG-1  | Complete | A separate zero-write Page recovery path exports every legacy artifact as byte-exact Base64 plus readable UTF-8 preview; the old HTML reader, DatabaseBlock UI and writable store are deleted.                |
| LINK-01    | Complete | Resolvable local Wiki Links navigate from native Blocks; Wiki and relative Markdown Page links are indexed with exact body-relative occurrences.                                                              |
| INDEX-01   | Complete | A shared zero-write Page catalog produces deterministic links, backlinks, ambiguity, unresolved results, property projections, Collection membership, transclusion sources, and graph edges.                  |
| LINK-02    | Complete | The Page context exposes rebuilt backlinks, unresolved outgoing links, and unlinked mentions. Page/Folder relocation repairs resolvable links through previewed, revision-checked transactions with rollback. |
| LINK-03    | Complete | Standalone Page/heading/`^block-id` transclusion uses the zero-write source index, preserves canonical expressions, recurses read-only, and fails closed on ambiguity, duplicate ids, cycles, or depth.       |
| DAILY-01   | Complete | Today's local calendar date opens or creates `Daily Notes/YYYY-MM-DD.md` after safely saving the active Page.                                                                                                 |
| COLL-01    | Complete | Portable `doxmind-collection` v1/v2 JSON semantics are strict, source-backed, deterministic, and select only ordinary Markdown Pages.                                                                         |
| COLL-02    | Complete | The native Collection Block renders read-only Table, Board, and Calendar views with Page/relation navigation plus explicit invalid/loading/error/empty/unscheduled states.                                    |
| COLL-03    | Complete | Collection v2 evaluates strict relation, non-executable formula-AST, and rollup definitions in memory before filter/sort/group/date projection; diagnostics fail closed and no result is persisted.           |
| GRAPH-01   | Complete | The Page context renders a bounded deterministic SVG neighborhood from resolved links and navigates without writing graph state.                                                                              |
| IMAGE-01   | Complete | Relative local images use confined, bounded, typed, symlink-free reads and revocable Blob previews; Electron paste/drop imports verified raster bytes into `assets/` without overwrite and inserts Markdown.  |
| EXPORT-01  | Complete | Page PDF export generates a real PDF locally inside Electron, needs no printer, writes only the user-selected destination, and has no FastAPI or server HTML-to-PDF dependency.                               |
| EXPORT-02  | Complete | Desktop and CLI Markdown copy paths preserve the complete Page bytes, including frontmatter/BOM/line endings, and refuse silent destination overwrite.                                                        |
| ATTACH-01  | Complete | PDF, spreadsheet, and HTML default to one read-only Attachment surface; Page save/export actions are hidden.                                                                                                  |
| LEGACY-01  | Complete | Sidecars are inspected through a zero-write path; malformed, mixed, future, or backup-bearing state is conservatively flagged.                                                                                |
| LEGACY-02  | Complete | Explicit export produces a Markdown recovery report with exact legacy JSON while source, sidecar, backup, lock, and corrupt artifacts remain unchanged.                                                       |
| LEGACY-03  | Complete | Old PDF/Excel editor bundles, attachment create/write/cache endpoints, Synthetic Document migration writers, and dedicated dependencies are deleted.                                                          |

The recovery report is not a reconstructed PDF or workbook and is not a reason
to continue investing in attachment editing. It is a portable, human-readable
container for the exact old editor-state JSON. Source files and their complete
legacy artifact families remain intact.

### Phase 0 — Boundary and investment freeze

- Publish this direction and ADR-0011.
- Remove PDF/Excel from New menus and the primary create contract.
- Remove PDF/Excel-specific future settings and roadmap promises.
- Mark old Synthetic Document and DatabaseBlock work as compatibility-only.

Exit: every product document names Markdown Page as the only primary content
type, and no user-facing flow creates a blank PDF or spreadsheet.

### Phase 1 — Attachment compatibility bridge

- Keep the generic read-only Attachment surface with Reveal and Open
  Externally.
- Keep sidecar inspection and recovery-report export removed.
- Keep attachment editing out of normal navigation; the old editors are absent.
- Keep the completed `LEGACY-03` deletion locked: no dedicated PDF/Excel editor
  bundle, create/write/cache endpoint, or Synthetic Document migration writer
  may return. Read-only CLI/MCP parsing is not an editor path.

Exit: ordinary attachments are read-only and produce no doXmind state, and the
physical attachment-editor deletion is complete.

### Phase 2 — Markdown-only editor foundation

- Keep the completed Markdown-only Page storage contract locked with desktop,
  browser-dev, CLI, exact-source, and zero-workspace-write tests.
- Keep the landed native grammar for headings, lists, tasks, quotes, fenced
  code, dividers, tables, math, Mermaid, callouts, and exact raw fallback locked
  with source-preservation fixtures.
- Keep the old DatabaseBlock UI and writable store absent. PAGELEG-1 preserves
  any `extras.databases` payload inside a byte-exact artifact report; collection
  migration must consume that explicit export rather than restore the old UI.
- Keep the landed keyboard focus/navigation, revision guard, IME protection,
  exact multi-Block clipboard behavior, and grouped undo covered by fixtures.
- Keep legacy Page artifacts untouched: nothing inventories, opens, or exports
  them.
- Keep portable `<details>` Toggles and slash-command source insertion locked
  with exact-source tests. Electron image paste/drop may only copy verified
  raster bytes to `assets/` without overwrite and insert a safe relative
  Markdown destination; resize/crop/delete and remote fetch remain outside scope.
- Keep all Page Sidecar writers and legacy Sidecar readers absent, including the
  removed inspection/recovery commands.

Exit: Markdown is the only Page content/editor-state field; Page APIs contain no
HTML, Extras, editor JSON, or Sidecar state. The normal Page lifecycle creates
no Sidecar, and the production bundle contains no TipTap/ProseMirror import.

### Phase 3 — Local Notion foundation

- Keep frontmatter-backed aliases, scalar/list fields, and exact Wiki-Link
  relation values lossless. Keep formulas and rollups as strict versioned
  Collection JSON projections; never persist their results as hidden Page state.
- Make templates create ordinary Pages with properties.
- Keep the landed Page context panel and local-date Daily Notes as ordinary
  Pages locked.
- Keep strict portable `doxmind-collection` v1 compatibility and v2
  Table/Board/Calendar plus computed-property grammar locked.

Exit: every Page property and all user knowledge can be read from the Markdown
file alone.

### Phase 4 — Obsidian knowledge layer

- Keep local `[[Wiki Links]]` navigation and the landed Wiki/relative-Markdown
  occurrence index locked with deterministic zero-write rebuild tests.
- Keep backlinks, unresolved links, unlinked mentions, and transactional
  Page/Folder relocation repair locked with zero-write preview, complete
  workspace Page-snapshot checks, exact target-token patches, and rollback
  fixtures.
- Keep legacy `rename/move` commands Attachment-only. CLI/MCP Page and Folder
  relocation fails closed until those surfaces can present and approve the same
  source-backed impact plan; no entry point may silently move links without
  repair.
- Keep standalone-paragraph Page, heading, and `![[Page#^block-id]]` transclusion
  locked to a zero-write source index, exact heading-source projection,
  unique trailing block anchors, recursive read-only rendering, and deterministic
  missing/ambiguity/duplicate/cycle/depth failure states.
- Keep the complete knowledge index rebuildable from files on demand.

Exit: deleting the index and rebuilding it reproduces links, backlinks, unlinked
mentions, deterministic Page/heading/block-id projections, collection membership
and computed values, and graph edges from workspace files.

### Phase 5 — Local Collections

- Keep shipped read-only Table, Board, and Calendar views derived from the same
  Page catalog and portable definition.
- Treat each row/card/event as a Page selected by frontmatter properties.
- Keep relation, formula, and rollup evaluation zero-write and deterministic;
  computed diagnostics must never guess a target or materialize partial state.
- Consume preserved DatabaseBlock payloads from PAGELEG-1 reports when portable
  collection migration is implemented; do not restore the old editor/store.

Exit: collection views can disappear without losing a row or property, and all
rows remain individually readable Markdown files.

### Phase 6 — Extension surface

- Keep the shipped zero-write Page graph on the public knowledge-index Interface;
  it must never become graph-owned Page state.
- Stabilize command, template, importer, and theme extension points.
- Consider a sandboxed plugin API only after the storage and command contracts
  have proven stable.

## Dependency-aware delivery backlog

Priority uses P0 (blocking), P1 (important), and P2 (later). A task is done only
when its verification statement passes.

| ID         | Priority | Task                                                    | Depends on           | Verification                                                                                                 |
| ---------- | -------- | ------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| DIR-01     | P0       | Adopt the new boundary and superseding ADR              | —                    | Product, architecture, and contributor docs agree on one primary type.                                       |
| NAV-01     | P0       | Limit New to Page, Folder, and Template                 | DIR-01               | No PDF/Excel item exists in header or tree context menus.                                                    |
| MODEL-01   | P0       | Make primary create input Page/folder-only              | DIR-01               | Frontend create APIs have no PDF/Excel discriminator or binary payload.                                      |
| STORE-01   | P0       | Lock the Markdown-only Page storage cut                 | MODEL-01             | Create/save/reopen/rename uses one `.md`; legacy Sidecar bytes remain unchanged.                             |
| DESKTOP-01 | P0       | Keep one in-process packaged desktop runtime            | STORE-01             | Electron packages and runs without Tauri, Rust, or a spawned/bundled Python/FastAPI service.                 |
| EDITOR-01  | P0       | Build the native source-backed block kernel             | STORE-01             | Paragraph/heading commands and autosave preserve untouched source bytes.                                     |
| EDITOR-02  | P0       | Migrate all supported blocks off TipTap                 | EDITOR-01            | Production imports and package dependencies contain no TipTap/ProseMirror.                                   |
| EXPORT-01  | P0       | Make Page PDF export desktop-local                      | EDITOR-01            | Export generates and atomically writes a real PDF without a printer or server HTML-to-PDF request.           |
| PAGELEG-1  | —        | _Withdrawn_ — legacy Page Sidecar inventory/export      | STORE-01             | Removed; Sidecar bytes are preserved but never opened.                                                       |
| LEGACY-01  | —        | _Withdrawn_ — legacy PDF/Excel sidecar inventory        | DIR-01               | Removed; Sidecar bytes are preserved but never opened.                                                       |
| ATTACH-01  | P0       | Build the generic Attachment surface                    | NAV-01               | PDF/spreadsheet/HTML opens without an editable document toolbar.                                             |
| LEGACY-02  | —        | _Withdrawn_ — explicit legacy export/recovery           | LEGACY-01, ATTACH-01 | Removed with LEGACY-01; the artifact family remains unchanged on disk.                                       |
| LEGACY-03  | P1       | Remove dedicated PDF/Excel editing paths                | LEGACY-02            | No new edit sidecar/write endpoint/editor bundle remains.                                                    |
| PAGE-01    | P1       | Lock portable v1 frontmatter Properties                 | EDITOR-01            | Cross-runtime lossless source-patch fixtures cover external edits and every supported value type.            |
| LINK-01    | P1       | Complete the portable Page-link surface                 | EDITOR-01            | Local Wiki Links navigate without rewriting source; link indexing remains in `INDEX-01`.                     |
| INDEX-01   | P1       | Build rebuildable link/search/property index            | LINK-01              | Delete-index/rebuild tests reproduce the same results.                                                       |
| LINK-02    | P1       | Add backlinks, unlinked mentions, and relocation repair | INDEX-01             | Rebuild and relocation fixtures retain or explicitly flag every relationship.                                |
| LINK-03    | P1       | Keep source-backed Page/heading/block-id transclusion   | LINK-02              | Unique projections are zero-write, ambiguity/cycle/depth guarded, and leave the canonical expression intact. |
| DAILY-01   | P1       | Ship local-date Daily Notes                             | STORE-01             | Today's action opens or creates one ordinary `Daily Notes/YYYY-MM-DD.md` Page.                               |
| COLL-01    | P1       | Lock portable Collection v1/v2 semantics                | PAGE-01, INDEX-01    | No row, relation source, or computed definition exists only in sidecar/workspace view state.                 |
| COLL-02    | P1       | Keep all read-only Collection views                     | COLL-01              | Table, Board, and Calendar results match Page fixtures and survive sidecar/index deletion.                   |
| COLL-03    | P2       | Keep computed relation/formula/rollup projections       | COLL-02              | Strict definitions evaluate deterministically, diagnose failures, and write no Page result.                  |
| GRAPH-01   | P1       | Keep the zero-write Page graph                          | LINK-02              | Rebuilding from the same Page snapshot reproduces nodes/edges without workspace writes.                      |
| IMAGE-01   | P1       | Preview and import local Markdown images safely         | EDITOR-01, STORE-01  | Reads/imports are confined, bounded, typed, symlink-free, no-overwrite, and never fetch remote data.         |
| EXT-01     | P2       | Stabilize extension points                              | LINK-02, COLL-02     | Extensions consume public commands/indexes without private storage access.                                   |

Critical path:

```text
DIR-01 → MODEL-01 → STORE-01 → DESKTOP-01 / EDITOR-01 → EDITOR-02 / EXPORT-01
                         ├── PAGELEG-1
                         └── PAGE-01 → LINK-01 → INDEX-01 → LINK-02 → LINK-03 / GRAPH-01 / COLL-01
DIR-01 → NAV-01 → ATTACH-01 → LEGACY-01 → LEGACY-02 → LEGACY-03
```

Current delivery focus: keep the completed storage, Electron-only desktop,
native editor, export, Page relation, computed Collection,
Table/Board/Calendar, block-id embed, local-image import/preview, graph, index,
and link/backlink cuts locked. Remaining expansion work is deliberately outside
this completed core: editable Collection cells, binary image editing or remote
fetching, attachment editors, cloud collaboration, and a plugin marketplace.
