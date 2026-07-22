# Architecture

This document describes the runtime architecture of doXmind's local,
Markdown-only Page model. It is the entry point for understanding how the
source-backed block editor, storage layer, and Electron desktop shell fit together.

For the migration log that traces how we got here, see
[`MARKDOWN_FIRST_MIGRATION.md`](./MARKDOWN_FIRST_MIGRATION.md). For the product
boundary and roadmap, see [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md),
[ADR-0011](./adr/0011-local-markdown-knowledge-workspace.md), and
[ADR-0012](./adr/0012-markdown-source-block-editor.md). The Electron-only
desktop decision is recorded in
[ADR-0013](./adr/0013-electron-only-desktop-runtime.md), and the
printer-independent Page PDF pipeline is recorded in
[ADR-0014](./adr/0014-local-page-pdf-export.md).

## Product shape

doXmind is a local-first, single-user Markdown knowledge workspace. There is no
auth, sync, sharing, billing, telemetry, or AI runtime in this branch. Pages and
attachments live on the user's filesystem.

The product surface is intentionally narrow:

- A user opens a folder ("workspace") of Markdown files.
- A Page is exactly one `.md`/`.markdown` file. Markdown source is the editor
  state and block operations patch that source directly.
- Every Page uses the native source-backed block Adapter. Understood syntax has
  semantic controls; unfamiliar or complex syntax remains editable as exact raw
  Markdown instead of switching to a second editor model.
- Portable `<details>` Toggles, slash-command source insertion, scalar/list and
  exact Wiki-Link relation Properties, Daily Notes, read-only Table/Board/Calendar
  Collections with computed projections, and the Page graph all deepen that same
  Markdown/file model.
- PDF, spreadsheet, and HTML files are the currently surfaced Attachments. They
  remain locally accessible without becoming separate editing products. Images
  and other files remain ordinary assets/files but are not all shown as
  Attachment cards.
- Existing Page/PDF/Excel Sidecars, Synthetic Documents, and
  `extras.databases` are frozen legacy-recovery formats, not foundations for
  new features.
- Read-only PDF/spreadsheet parsing and import are optional local tooling paths.
  Page PDF export waits for the live native Block view, generates PDF bytes
  inside Electron with `webContents.printToPDF`, and atomically writes the
  destination selected in the main-process Save dialog. It needs no printer or
  FastAPI HTML-to-PDF service.
- A standalone relative Markdown image may preview an existing supported local
  raster asset. Reads are workspace-confined and the UI renders a temporary Blob
  URL. Electron paste/drop import is a narrow in-process asset copy into
  `assets/`; there is no image upload service, remote fetch, or binary editor.

## Source of truth: the single-file Page model

Every Page is complete in one file:

```text
~/Documents/notes/
└── Project Plan.md          # body + properties + links + collection fields
```

The file can be edited in any editor, synced via filesystem tools or git, and
read without doXmind. New doXmind Pages carry a stable `id` in YAML
frontmatter. External Markdown without an id opens without a write and uses a
workspace-relative path identity until the user explicitly adds metadata.

Old hidden `.doxmind` files may still be present. They are recovery artifacts,
not a Page cache. Normal Page open/save never trusts or updates their HTML, id,
hash, or extras. `extras.blocks` and `extras.databases` remain readable only by
legacy inventory/export paths until their recovery gates pass.

### Open

1. Read the complete raw file and separate frontmatter metadata from the exact
   Markdown body.
2. Derive source-backed block spans from the body. The current native editor
   does not expose frontmatter as an editable Block.
3. Project supported body syntax into semantic Blocks and preserve everything
   else as editable raw source Blocks in the same native Adapter.
4. Derive preview/export HTML when needed. Never hydrate current Page state
   from legacy Sidecar HTML.

### Save

1. Apply a block/text command to the canonical Markdown body.
2. Preserve untouched source bytes, unsupported raw blocks, and unknown
   frontmatter.
3. Atomically replace only the Markdown file and invalidate derived indexes.

Page reads return a SHA-256 source revision and writes reject a stale expected
revision before atomically replacing the file. The watcher then forces a source
re-read and the UI pauses saving on conflict. This is an optimistic revision
guard, not an OS-level atomic compare-and-swap; reintroducing a Sidecar hash is
not an acceptable conflict mechanism.

Legacy Synthetic PDF/Excel `markdown_hash`, placeholder, and
`parsedCache.sourceHash` rules remain readable only by isolated recovery code.
The Attachment surface inspects them without writing and can export a Markdown
report containing the exact legacy editor-state JSON. It does not mount the old
editors or reconstruct a PDF/workbook. Source binaries and the complete legacy
Sidecar artifact family remain unchanged. New Attachments do not get editor
sidecars.

## Desktop and browser-dev architecture

The implementation is split across two runtime paths with strict ownership:

```text
┌──────────────────────────────────────────────────────────────┐
│ Frontend: React + Markdown block core + Zustand — src/       │
└──────────────────────────────────────────────────────────────┘
               │ Electron IPC             │ HTTP, browser dev only
               ▼                          ▼
┌────────────────────────────┐  ┌───────────────────────────────┐
│ Electron shell             │  │ FastAPI dev service           │
│ native Node I/O            │  │ Python command mirror         │
│ electron/                  │  │ server/                       │
└────────────────────────────┘  └───────────────────────────────┘
               │                          │
               └──────────────┬───────────┘
                              ▼
                        User filesystem
                      (~/Documents/notes/)
```

Electron executes workspace commands inside the desktop process. The packaged
app neither starts nor bundles Python/FastAPI. The Python command mirror exists
for browser development, CLI/MCP, and explicit read-only recovery/conversion
tooling; it is not a desktop lifecycle dependency. Tauri and the former Rust
Page core are retired; adding another packaged shell requires a new ADR.

### `electron/` — the desktop shell

Electron exposes the same command names through its preload IPC bridge and
implements workspace/Page operations in `electron/native-workspace.js` using
Node filesystem APIs. Page reads and writes are Markdown-only. Existing legacy
recovery artifact families travel transactionally with rename/move and are sent
to system Trash on delete; no normal Page operation creates them.

Electron exposes `workspace_read_asset`: the command accepts only an existing
workspace-relative supported raster file, rejects every symlink component,
limits the payload to 20 MiB, verifies bytes against the declared image type,
and returns Base64 plus MIME metadata. The frontend converts those bytes to a
revocable Blob URL. It never passes an authored Markdown destination to a
browser URL loader.

`workspace_import_asset` is the corresponding Electron-only write seam for an
explicit editor paste/drop. It accepts APNG, AVIF, BMP, GIF, ICO, JPEG, PNG, or
WebP bytes between 1 byte and 20 MiB, validates filename/extension/signature,
rejects symlinked destinations, and creates `assets/<name>` with exclusive-write
semantics. A collision becomes `<name> (2).<ext>` and is never overwritten. The
renderer then inserts the shortest URI-encoded relative Markdown destination;
no sidecar or asset manifest is created. Browser development intentionally has
no equivalent asset writer.

Electron exposes Page PDF generation in-process. The frontend waits until the
live source-backed Page, recursive embeds, local images, fonts, math, and
Mermaid previews are stable, then invokes a narrow `export_page_pdf` command.
The main process owns the Save dialog, calls the sender's
`webContents.printToPDF`, validates the returned PDF Buffer, and atomically
replaces only the selected `.pdf` destination. The renderer cannot supply an
arbitrary output path or PDF/HTML bytes. Browser development has no
`window.print()` fallback. The pipeline has no printer dependency, Python
lifecycle, FastAPI request, or PyMuPDF/HTML-to-PDF stage.

### `server/` — browser-dev and standalone local services

FastAPI is a localhost service mounted at two routers (see `server/main.py`):

| Router      | Purpose                                          |
| ----------- | ------------------------------------------------ |
| `images`    | Read-only recovery for pre-workspace image URLs. |
| `workspace` | Localhost mirror of the Electron command surface |
|             | browser dev mode (`POST /api/workspace/invoke`). |

Browser dev mode (`npm run dev:all`) cannot call desktop commands, so the
FastAPI workspace router exposes Page/workspace commands and the separate
zero-write legacy recovery commands over HTTP. The Python implementation in
`server/api/workspace.py` mirrors the Markdown-only Page contract.
Cross-runtime source/frontmatter fixtures keep Electron and browser-dev Python
behavior aligned without making Python a packaged dependency.

HTML/Markdown export belongs to the standalone CLI/MCP core facade, not a
FastAPI Router. It supports `html` and `md` only; Page PDF output remains the
packaged Electron app's local derived-output flow.

What FastAPI no longer does:

- No `files` / `versions` / `databases` / PDF-editor / Excel-editor routers.
- No app-managed image upload or delete API. The Electron-only paste/drop command
  is an in-process workspace file copy, while browser development remains
  read-only for assets.
- No attachment create, edit, editor-state write, parsed-cache write, or
  Synthetic Document migration command.
- No JWT, OAuth, or session middleware.
- No multi-user query layer.

### No document database

The active product has no SQLite, Postgres, or other document database. Desktop
preferences remain replaceable WebView-profile state; workspace identity maps
are rebuildable app-private indexes. Neither is a second copy of Page content.

## Frontend

Next.js 15 App Router, React 19, Zustand, Tailwind, and a source-backed
Markdown block core. There is no TipTap/ProseMirror runtime or dependency.
Source lives under `src/`.

### Editor entry

`src/app/editor/[[...fileId]]/page.tsx` is the editor route. It mounts the one
source-backed Page workspace through `editor-client.tsx` and
`desktop-editor.tsx`; responsive chrome does not select a second editor.

### Stores

Each Zustand store owns a single concern (see `src/stores/`):

| Store                | Owns                                                 |
| -------------------- | ---------------------------------------------------- |
| `file-store`         | Workspace tree, current document, save lifecycle.    |
| `editor-store`       | Dirty/saving state and current text selection.       |
| `editor-ref-store`   | Awaitable save command for application chrome.       |
| `layout-store`       | Sidebar, focus mode, command palette, responsive UI. |
| `page-session-store` | Adapter-neutral live outline and Page navigation.    |
| `appearance-store`   | Theme, font, density.                                |
| `notification-store` | Ephemeral errors, notices, and progress state.       |

`layout-store` preferences and `file-store` recents persist through Zustand in
the desktop WebView's local application profile. There is no current
standalone settings file under `~/.doxmind`.

The boundary rule: stores hold UI and ephemeral state; canonical block-editor
content is the Markdown body, while frontmatter remains canonical in the same
file. Stores ask the Page storage Interface to write Markdown and supported
metadata patches; they never persist editor HTML, editor JSON, or Extras.

The Page Properties Module projects only top-level string, finite-number,
boolean, or string-array values. A Relation control writes one or more exact,
extension-free `[[workspace/path]]` strings using that same string-array grammar;
relation identity never lives in a UI record. Generic key patches use the same
optimistic revision guard as tags and aliases. Unknown or unsupported frontmatter
remains exact source rather than becoming a second metadata store.

The old mounted DatabaseBlock component tree and writable `database-store` are
physically removed. PAGELEG-1 exports the complete legacy Page artifact family
as exact raw bytes, including any `extras.databases` payload, but no production
UI parses, mounts or mutates it.

### Page editor Seam

`DocumentWorkspace` mounts `PageEditorHost`, which always mounts one native Adapter:

- `MarkdownBlockRuntime` owns a `MarkdownBlockDocument` containing canonical
  Markdown, revision, source spans, commands, undo/redo, autosave, outline and
  local find. Paragraphs, headings, lists, tasks, quotes, fenced code, dividers,
  GFM tables, block math, Mermaid, callouts, portable `<details>` Toggles,
  `doxmind-collection` fences, and standalone relative local images have native
  semantics; common inline Markdown uses a safe React projection. Math and
  Mermaid are rendered from source with local KaTeX/Mermaid libraries.
- The slash menu is an Adapter over source commands: a slash-only paragraph is
  replaced by a portable Markdown template. It does not persist a command node.
- Collection, transclusion, graph, and image projections are read-only. Their
  loading/error/print-ready state is ephemeral and cannot become Page content.
- Block rows expose keyboard focus independently of edit mode. Boundary Arrow
  navigation, `Alt+Arrow` movement, duplicate/delete shortcuts, CRLF-preserving
  multi-Block paste, and one-step undo all dispatch source commands rather than
  browser rich-text operations.
- Unsupported or complex structures remain exact, editable raw Blocks. Safe
  whole-Block move/duplicate/delete remains available, while structural
  transforms that could corrupt unknown grammar are disabled.

There is no whole-Page eligibility gate and no second editor. New syntax slices
deepen a raw Block only after exact-source fixtures and safe commands exist.

### Native syntax extensions

No feature may introduce a second document tree. A structure that carries user
semantics first needs a portable Markdown grammar, source-preservation tests and
native block commands. Legacy DatabaseBlock UI/store code is absent; the
`extras.databases` and PDF/Excel recovery readers stay isolated from Page
editing until their explicit export gates are complete.

The current portable extension grammars are deliberately narrow:

- Toggle is standard `<details>` with a one-line `<summary>` and Markdown body.
- Collection is exact fenced `doxmind-collection` JSON. Version 1 keeps the
  original `table` grammar. Version 2 adds `table`, `board` with `groupBy`, and
  `calendar` with `dateBy`; all share ANDed `equals`/`contains`/`exists` filters,
  explicit columns, and deterministic sorting. Calendar accepts only real
  `YYYY-MM-DD` strings and exposes an Unscheduled bucket. Rows/cards/events are
  navigable Pages and the preview is not an editor database.
- Collection v2 may contain computed-properties version 1. Relation fields
  resolve exact Wiki-Link string(s) already present in Page frontmatter.
  Formula fields use a bounded, non-executable JSON AST; rollups use
  `count`/`sum`/`min`/`max`/`join`/`unique` over a declared relation. Evaluation
  precedes filter/sort/group/date projection, emits stable fail-closed
  diagnostics, and never writes derived values.
- A block embed anchor is an authored trailing ` ^id` where `id` matches
  `[A-Za-z0-9][A-Za-z0-9_-]*`. `![[Page#^id]]` projects only one unique matching
  source Block and removes the anchor from the projection; fenced code, Mermaid,
  and block-math contents are excluded. Missing or duplicate anchors fail closed.
- Local image is one standalone CommonMark image with a relative destination.
  Schemes, absolute paths, query/fragment suffixes, workspace escape, symlinks,
  wrong signatures, and oversized files fail closed. Electron paste/drop import
  is the only binary write in this feature: a verified no-overwrite copy into
  `assets/` followed by a Markdown source insertion. Resize/crop/delete and
  remote fetch remain outside the Interface.

### Shared Page Catalog and knowledge projections

`buildWorkspacePageCatalog` lists and reads canonical Markdown Pages once
through the storage Interface. Its path-safe Page identity, title, aliases,
portable Properties, exact body, and source revision supply the knowledge index
and `doxmind-collection` evaluator. Attachments and legacy artifacts never cross
this catalog Interface.

Links, backlinks, unresolved links, unlinked mentions, transclusion sources,
Collection membership, and graph edges are deterministic projections of that
catalog. The Page graph uses a bounded neighborhood with the current Page at the
center. Collection v1/v2 evaluates relations, formulas, rollups, filters, sort,
Board groups, and Calendar days in memory; relation resolution reuses the same
path/title/alias knowledge resolver and preserves ambiguity. Neither Module
writes the workspace or owns durable Page state. Daily Notes likewise use only
normal folder/create/navigation commands to open or create
`Daily Notes/YYYY-MM-DD.md` from the local calendar date.

### Attachment recovery boundary

`AttachmentWorkspace` is the only normal PDF/spreadsheet/HTML destination. It
is read-only and offers Reveal/Open Externally. For a PDF or spreadsheet with
recoverable legacy state, it additionally:

1. inspects the legacy Sidecar and backup-bearing artifact family without
   mutation;
2. reads the old editor state through a compatibility reader; and
3. downloads a `.doxmind-recovery.md` report whose fenced JSON is the exact
   recovered state.

The old PDF and Excel editor workspaces, frontend libraries/dependencies,
desktop/server editor and write/cache/create commands, and Synthetic Document
migration writers are physically removed. Move, rename, and delete still
preserve the source and its `.doxmind`, `.bak`, `.lock`, and `.corrupt-*` family
together.

## Optional read-only CLI/MCP conversion

Standalone Python tooling can parse an explicitly selected PDF or spreadsheet
without mounting an editor or writing attachment state. `core.convert` uses:

- `services.pdf_blocks.parse_pdf_blocks` for layout-aware PDF blocks;
- `services.excel_workbook.parse_workbook` for `.xlsx`/`.xlsm`; and
- `services.excel_workbook.parse_csv_workbook_json_bytes` for `.csv`.

These are CLI/MCP read-conversion helpers only. They do not create sidecars,
update legacy caches, export edited binaries, or participate in the Electron
lifecycle.

## Repository layout

```text
local-desk/
├── src/                  Frontend + source-backed block editor
│   ├── app/              App Router routes
│   ├── components/       UI components and editor surfaces
│   ├── editor/           Markdown block core and native Page UI
│   ├── stores/           Zustand stores
│   └── lib/              Storage, export, import-policy, and UI utilities
├── server/               Optional FastAPI/browser-dev and tooling service (Python >=3.11)
│   ├── api/              Routers: images, workspace
│   ├── services/         Page storage, read-only recovery/parsing,
│   │                     image and Markdown-projection helpers
│   └── main.py           App factory
├── electron/             Electron desktop shell + Node workspace commands
├── scripts/              Local dev / build orchestration (Node)
└── docs/
    ├── ARCHITECTURE.md         (this file)
    └── MARKDOWN_FIRST_MIGRATION.md
```

## Storage ownership at a glance

| Concern                                | Owner                                                               |
| -------------------------------------- | ------------------------------------------------------------------- |
| Page body, properties, aliases, links  | `~/.../Foo.md` (one complete user file)                             |
| Block spans, selection, undo, preview  | In-memory `MarkdownBlockDocument` / React Adapter                   |
| Surfaced Attachments                   | Workspace PDF/spreadsheet/HTML files                                |
| Current Page identity index            | Rebuilt in Electron memory; app-private in browser development      |
| Markdown search                        | On-demand, zero-write workspace scan                                |
| Preferences and recents                | Desktop WebView local application profile                           |
| Legacy Page/DatabaseBlock recovery     | Preserved Sidecars + byte-exact Markdown recovery reports           |
| Legacy PDF/Excel edit recovery state   | Preserved attachment Sidecar artifact families                      |
| Referenced/imported local image assets | Ordinary workspace files; Electron no-overwrite copy + Blob preview |

Anything not in this table should be treated as either a bug or a new
ownership decision that needs to be added here.

Workspace scan/open writes no doXmind-owned file into the mounted folder.
Browser development may persist the current frontmatter-id/path map under
`~/.doxmind/workspaces/<workspace-hash>/index.json` (`DATA_DIR` replaces
`~/.doxmind` when configured); Electron rebuilds the equivalent map in memory.
This identity map deliberately contains no backlink, property, or Collection
state. Those projections rebuild from the Page catalog, and the map itself is
safe to delete and rebuild.

## Migration state

The older dual-file transition is historical context in
[`MARKDOWN_FIRST_MIGRATION.md`](./MARKDOWN_FIRST_MIGRATION.md). ADR-0012 now
drives the active migration:

- Electron/Node, browser-dev Python, and frontend Page storage paths accept Markdown-only;
  new Page create/save/reopen produces no Sidecar.
- Page identity in scan/search/index is frontmatter-first with path fallback;
  legacy Sidecar ids cannot affect normal Page identity.
- The Electron desktop lifecycle/build path has no Python/FastAPI process or
  bundled-server dependency; FastAPI remains an explicit browser-dev
  and standalone tooling path.
- The native block core handles every Page. It supports paragraph, ATX heading,
  lists, tasks, quotes, fenced code, dividers, GFM tables, block math, Mermaid
  and callouts, portable `<details>` Toggles, slash-command source insertion,
  read-only `doxmind-collection` Table/Board/Calendar projections, safe
  relation/formula/rollup computation, block-id embeds, and local-image
  preview/import, plus exact editable raw fallback, common inline preview,
  CRLF-safe minimal patches,
  structural commands, grouped IME undo, serialized autosave, local find, live
  outline navigation, navigable local Wiki Links and external-revision conflicts.
- TipTap/ProseMirror runtimes, extensions and package dependencies are removed.
  Syntax outside the explicit native grammars continues as exact raw Blocks;
  richer controls cannot reintroduce a private editor schema.
- Legacy PDF/Excel inspection and explicit Markdown recovery-report export are
  complete. Dedicated editor bundles, attachment create/write/cache endpoints,
  Synthetic Document migration writers, and dedicated dependencies are
  physically removed. CLI/MCP retains only read-only parsing.
- Frontmatter Properties/relations, the shared zero-write Page Catalog,
  backlinks, Daily Notes, all three Collection views and computed projections,
  Page graph, Toggles, slash commands, block-id transclusion, and Electron
  local-image paste/drop import are active. Editable Collection records,
  executable formulas, remote images, and resize/crop/binary editing remain
  outside the product boundary rather than implied capabilities.

When a phase moves, update the migration doc and update the relevant
section of this file in the same PR.

## Removed surface

Per `README.md` and `AGENTS.md`, the following are intentionally absent
from this branch and should not be reintroduced without an explicit
product decision: JWT auth, OAuth, password reset, email verification,
Stripe billing, credits, quotas, sharing links, community publishing,
comments, follows, bookmarks, notifications, telemetry, RLHF reporting,
S3, Postgres, Redis, Docker deployment, hosted cloud sync, chat,
agents, providers, OpenRouter, autocomplete, quick edit, document
review, prompts, knowledge-base retrieval, and `markitdown`-based
import.
