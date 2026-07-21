# Product Direction

Status: active
Last updated: 2026-07-20

This document is the living source of truth for doXmind's product boundary and
roadmap. Architecture decisions that make this direction durable live in
[`adr/0012-local-markdown-knowledge-workspace.md`](adr/0012-local-markdown-knowledge-workspace.md).

## North star

> doXmind is a fully local, Markdown-native knowledge workspace: Notion-style
> editing and organization with Obsidian-style file ownership, links, and a
> rebuildable knowledge graph.

The comparison is deliberately narrow:

- **Notion-style** means blocks, properties, templates, and collection views.
  It does not mean cloud databases, accounts, permissions, or collaboration.
- **Obsidian-style** means a real local folder, portable Markdown, Wiki Links,
  backlinks, and indexes that can be rebuilt from files. It does not require a
  plugin marketplace before the core product is complete.

The product has one primary content type: a **Page** backed by `.md` or
`.markdown`. PDF, spreadsheet, HTML, image, and other files are
**Attachments**. Exporting a Page to PDF does not make PDF an editable content
type.

## Product invariants

1. The user's workspace folder is the source of truth.
2. User-authored knowledge must survive deletion of every `.doxmind` cache and
   index file.
3. Page body, properties, aliases, tags, and links live in Markdown or YAML
   frontmatter.
4. Sidecars may store lossless editor HTML, caches, and replaceable UI state;
   they must not be the only copy of page or collection data.
5. Backlinks, search results, and graph edges are derived indexes, never source
   data.
6. Attachments are never silently rewritten. doXmind may preview, reveal, open,
   reference, or explicitly convert them into a Page.
7. Existing PDF/Excel sidecars are user data until the user has recovered or
   exported their edits. They are never deleted as part of scope reduction.
8. New features must strengthen Pages, links, properties, collections, or the
   local workspace. A second office-format editor requires a new product
   decision.

## Capability boundary

| Capability                                                                   | Decision                          | Boundary                                                                                                                    |
| ---------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Open Folder and real file tree                                               | Keep and strengthen               | Real folders and filenames remain visible; no hidden cloud workspace.                                                       |
| Markdown rich editing                                                        | Core                              | TipTap, autosave, external-edit recovery, and Markdown round-trip remain the main editing path.                             |
| Blocks                                                                       | Keep and strengthen               | Headings, lists, tasks, tables, code, math, Mermaid, callouts, toggles, images, slash commands, and block handles.          |
| Search, outline, tabs, command palette, templates                            | Keep                              | All operate locally and primarily on Pages.                                                                                 |
| Page properties, tags, and aliases                                           | Add next                          | Persist in YAML frontmatter and remain readable outside doXmind.                                                            |
| Page links                                                                   | Rebuild                           | Replace title-only `page-link` state with standard Markdown links and `[[Wiki Links]]`.                                     |
| Backlinks and unlinked mentions                                              | Add next                          | Derived from a rebuildable workspace index.                                                                                 |
| Daily Notes and transclusion                                                 | Add after links                   | Daily Notes are ordinary Pages; embeds retain a portable source expression.                                                 |
| Collections                                                                  | Rebuild                           | A row is a Markdown Page selected by properties/query. Start with Table, then Board and Calendar.                           |
| Existing DatabaseBlock                                                       | Freeze and migrate                | Do not expand `extras.databases`; it cannot remain the only copy of user data.                                              |
| Markdown and Markdown-to-PDF export                                          | Keep                              | PDF is an output format, not an editable workspace type.                                                                    |
| PDF/spreadsheet/HTML files                                                   | Attachments                       | Show in the tree; preview where inexpensive; reveal or open in the system app; allow explicit one-way conversion to a Page. |
| New blank PDF/Excel                                                          | Remove now                        | The New menu and primary create model create only Page, Folder, or Template.                                                |
| PDF text editing and annotation                                              | Remove after compatibility bridge | No new feature work or new edit sidecars. Preserve export/recovery for existing sidecars first.                             |
| Excel grid, formulas, and formatting                                         | Remove after compatibility bridge | doXmind does not compete with Excel. Preserve export/recovery for existing sidecars first.                                  |
| HTML editing                                                                 | Compatibility only                | HTML is not a Page format; treat it as an attachment or explicit import source.                                             |
| PDF/Excel-specific settings and release expansion                            | Remove                            | Compatibility tests may remain until legacy recovery is complete.                                                           |
| Graph view                                                                   | Later                             | Build only after link identity, backlink indexing, and rename behavior are reliable.                                        |
| Plugin API and marketplace                                                   | Later                             | First stabilize commands, storage, and extension boundaries; do not make plugins the architecture.                          |
| Accounts, cloud sync, sharing, comments, permissions, realtime collaboration | Out                               | These conflict with the fully local single-user product.                                                                    |
| Built-in AI runtime, providers, billing, telemetry                           | Out                               | Not part of this product boundary.                                                                                          |

## Navigation contract

The main navigation has one editing destination: Page.

```text
Welcome
├── New Page
├── Open Workspace
└── Recent Workspaces / Pages

Workspace sidebar
├── Search
├── Daily Note                 # after the Daily Notes milestone
├── Pages and folders
└── Attachments

New (+)
├── Page
├── Folder
└── From Template

Page context
├── Outline
├── Properties
└── Backlinks
```

An Attachment click opens a read-only preview or offers **Open Externally**.
It must not switch the application into a second document editor with its own
creation, save, formatting, and export model.

The visible tree continues to mirror the real filesystem. Notion-style manual
sibling ordering is not part of the current boundary; folders, names, and a
deterministic sort remain authoritative.

## Data model

```text
Workspace/
├── Project Plan.md                 # Page body + frontmatter properties + links
├── .Project Plan.doxmind           # disposable editor HTML/cache/UI state
├── Research/
│   └── Source Notes.md
├── attachments/
│   ├── spec.pdf                    # attachment; no new editor state
│   └── budget.xlsx
└── .doxmind/
    ├── index.json                  # disposable search/link/backlink index
    └── workspace.json              # workspace UI and saved-view configuration
```

### Page

- Body: Markdown.
- Properties, tags, aliases, dates, and collection fields: YAML frontmatter.
- Stable identity: frontmatter `id`, used internally by the index.
- Links: visible `[[target]]` or standard Markdown links, never a sidecar-only
  relationship.
- Rich editor state: same-name hidden sidecar. It may improve fidelity and
  speed but cannot be required to recover the Page's meaning.

### Attachment

- The original file is the only authoritative attachment content.
- The workspace may index filename, path, MIME type, and extractable text as a
  disposable cache.
- New PDF/Excel edit state is not written.
- Legacy PDF/Excel sidecars stay readable for recovery until their removal gate
  is satisfied.

### Collection

- A collection is a query over Pages and their frontmatter properties.
- A row is a Page, not a record stored only in `extras.databases`.
- Table, Board, and Calendar are views over the same Pages.
- Saved view configuration may live in workspace state, but deleting it may
  lose only the view layout—not rows, properties, or Page content.

### Derived indexes

Search, backlinks, unresolved links, graph edges, and collection membership are
derived from workspace files. Deleting `.doxmind/index.json` must be safe; a
full scan recreates it without changing any Page or Attachment.

## Transition policy for PDF and Excel

Scope reduction is intentionally two-stage:

1. **Freeze and hide:** remove blank creation and primary navigation; stop all
   new editor work; classify the formats as Attachments in the shared model.
2. **Recover and remove:** add a compatibility surface that detects legacy
   sidecar edits, lets the user export/recover them, and opens the source in the
   system application. Only then remove the dedicated editors, write APIs,
   parsers, caches, and dependencies.

The removal gate is satisfied only when all of the following are true:

- New workspaces cannot create a PDF or spreadsheet editor state.
- An existing edited sidecar is detected without mutating the source file.
- The user has an explicit export/recovery path.
- Opening a normal attachment creates no sidecar.
- Automated tests prove that sources, sidecars, `.bak`, and `.lock` files are
  not silently deleted or overwritten.

## Roadmap

### Delivery status — 2026-07-20

| ID        | Status      | Current state                                                                                                                       |
| --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| DIR-01    | Complete    | The product direction and ADR-0012 define Markdown Page as the only primary content type.                                           |
| NAV-01    | Complete    | New creates only Page, Folder, or Template; PDF/Excel creation is absent from primary navigation.                                   |
| MODEL-01  | Complete    | Primary create input is Markdown/folder-only; binary formats enter the workspace only as existing files or imports.                 |
| ATTACH-01 | Complete    | PDF, spreadsheet, and HTML default to one read-only Attachment surface; Page save/export actions are hidden.                        |
| LEGACY-01 | In progress | Main sidecars are inspected through a zero-write path; malformed, mixed, future, or backup-bearing state is conservatively flagged. |
| LEGACY-02 | In progress | A deliberately entered compatibility bridge can invoke the old exporters; zero-write backup-aware recovery is not complete.         |
| LEGACY-03 | Not started | Dedicated editor bundles and write endpoints stay in place until the recovery gate is proven.                                       |

The compatibility bridge is not a reason to continue investing in PDF or
spreadsheet editing. It exists only to keep previously saved user edits
reachable while LEGACY-02 is completed.

### Phase 0 — Boundary and investment freeze

- Publish this direction and ADR-0012.
- Remove PDF/Excel from New menus and the primary create contract.
- Remove PDF/Excel-specific future settings and roadmap promises.
- Mark old Synthetic Document and DatabaseBlock work as compatibility-only.

Exit: every product document names Markdown Page as the only primary content
type, and no user-facing flow creates a blank PDF or spreadsheet.

### Phase 1 — Attachment compatibility bridge

- Add a generic Attachment surface with preview where practical, Reveal, and
  Open Externally.
- Detect legacy PDF/Excel sidecars and expose recovery/export without new edits.
- Stop creating attachment sidecars and remove attachment editing from normal
  navigation.
- Delete dedicated PDF/Excel editor code and write endpoints after the removal
  gate passes.

Exit: existing edits are recoverable; ordinary attachments are read-only and
produce no doXmind state.

### Phase 2 — Local Notion foundation

- Add frontmatter-backed Properties, tags, and aliases.
- Make templates create ordinary Pages with properties.
- Add Daily Notes and the Page context panel.
- Define the portable Collection query/view format before expanding databases.

Exit: deleting sidecars preserves every Page property and all user knowledge.

### Phase 3 — Obsidian knowledge layer

- Implement `[[Wiki Links]]` and standard-link indexing.
- Add backlinks, unresolved links, unlinked mentions, rename repair, and
  transclusion.
- Rebuild the complete knowledge index from files on demand.

Exit: deleting the index and rebuilding it reproduces links, backlinks, and
collection membership from workspace files.

### Phase 4 — Local Collections

- Ship Table first, then Board, then Calendar.
- Treat each row/card/event as a Page selected by frontmatter properties.
- Migrate or export the old DatabaseBlock before deleting it.

Exit: collection views can disappear without losing a row or property, and all
rows remain individually readable Markdown files.

### Phase 5 — Extension surface

- Add graph view after link correctness is stable.
- Stabilize command, template, importer, and theme extension points.
- Consider a sandboxed plugin API only after the storage and command contracts
  have proven stable.

## Dependency-aware delivery backlog

Priority uses P0 (blocking), P1 (important), and P2 (later). A task is done only
when its verification statement passes.

| ID        | Priority | Task                                               | Depends on           | Verification                                                                    |
| --------- | -------- | -------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| DIR-01    | P0       | Adopt the new boundary and superseding ADR         | —                    | Product, architecture, and contributor docs agree on one primary type.          |
| NAV-01    | P0       | Limit New to Page, Folder, and Template            | DIR-01               | No PDF/Excel item exists in header or tree context menus.                       |
| MODEL-01  | P0       | Make primary create input Page/folder-only         | DIR-01               | Frontend create APIs have no PDF/Excel discriminator or binary payload.         |
| LEGACY-01 | P0       | Inventory legacy PDF/Excel sidecars and edits      | DIR-01               | A read-only report distinguishes untouched attachments from recoverable edits.  |
| ATTACH-01 | P0       | Build the generic Attachment surface               | NAV-01               | PDF/spreadsheet/HTML opens without an editable document toolbar.                |
| LEGACY-02 | P0       | Add explicit legacy export/recovery                | LEGACY-01, ATTACH-01 | Fixture edits export successfully while source and sidecar remain unchanged.    |
| LEGACY-03 | P1       | Remove dedicated PDF/Excel editing paths           | LEGACY-02            | No new edit sidecar/write endpoint/editor bundle remains.                       |
| PAGE-01   | P1       | Specify frontmatter properties and aliases         | MODEL-01             | ADR plus round-trip fixtures cover external edits.                              |
| LINK-01   | P1       | Specify and parse portable Page links              | PAGE-01              | Markdown round-trip retains link target and visible label.                      |
| INDEX-01  | P1       | Build rebuildable link/search/property index       | LINK-01              | Delete-index/rebuild tests reproduce the same results.                          |
| LINK-02   | P1       | Add backlinks, unresolved links, and rename repair | INDEX-01             | Rename and external-edit fixtures retain or explicitly flag every relationship. |
| COLL-01   | P1       | Specify portable Collection semantics              | PAGE-01, INDEX-01    | No row or property exists only in sidecar/workspace view state.                 |
| COLL-02   | P1       | Ship Table collection view                         | COLL-01              | Query results match frontmatter fixtures and survive sidecar deletion.          |
| COLL-03   | P2       | Add Board and Calendar views                       | COLL-02              | All views show the same underlying Page set.                                    |
| EXT-01    | P2       | Add graph and stable extension points              | LINK-02, COLL-02     | Extensions consume public commands/indexes without private storage access.      |

Critical path:

```text
DIR-01 → NAV-01 / MODEL-01 → LEGACY-01 → ATTACH-01 → LEGACY-02
       → PAGE-01 → LINK-01 → INDEX-01 → LINK-02 / COLL-01 → COLL-02
```

Current delivery focus: finish `LEGACY-01`/`LEGACY-02` without weakening the
zero-write inspection contract, then remove the legacy editors in `LEGACY-03`.
`PAGE-01` can proceed in parallel because it touches the Markdown Page model,
not the Attachment compatibility bridge.
