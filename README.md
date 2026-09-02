# doXmind

<p align="center">
  <a href="https://github.com/doXmind/releases/releases/latest"><img src="https://img.shields.io/github/v/release/doXmind/releases?display_name=tag&style=flat-square&label=latest" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/local--first-local%20files-2ea44f?style=flat-square" alt="Local-first files" />
  <img src="https://img.shields.io/badge/desktop-Electron-47848f?style=flat-square" alt="Desktop: Electron" />
  <img src="https://img.shields.io/badge/editor-Markdown%20source-black?style=flat-square" alt="Editor state: Markdown source" />
</p>

<p align="center">
  <img src="docs/readme/doxmind-overview.png" width="1200" alt="doXmind local Markdown knowledge workspace" />
</p>

<h3 align="center">A fully local, Markdown-native knowledge workspace.</h3>

<p align="center">
  A Notion-style block workflow over ordinary Markdown files, with local Wiki Link navigation inspired by Obsidian. No account, cloud document store, telemetry, hosted parser, or built-in AI runtime.
</p>

<p align="center">
  <a href="https://github.com/doXmind/releases/releases/latest"><strong>Download the latest release</strong></a>
  ·
  <a href="docs/USER_GUIDE.md"><strong>Read the user guide</strong></a>
</p>

This repository is licensed under [Apache-2.0](LICENSE). The doXmind name and
logo are not granted by that license; see [TRADEMARKS.md](TRADEMARKS.md).

Contributions are welcome for bugs, documentation, tests, and local Markdown
compatibility. See [CONTRIBUTING.md](CONTRIBUTING.md) for the product boundary
and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

---

## What is ready

- **One file is the complete Page.** A Page is exactly one `.md` or `.markdown` file. Normal create, open, edit, and save operations neither require nor create a `.doxmind` companion file.
- **Markdown is the editor state.** Every Page uses the native source-backed block editor. There is no TipTap or ProseMirror runtime and no hidden HTML document model.
- **Blocks remain portable.** Paragraphs, headings, lists, tasks, quotes, callouts, dividers, tables, fenced code, math, Mermaid, and collapsible `<details>` Toggles are recognized from Markdown. Unsupported syntax remains directly editable as exact raw source.
- **Block operations edit source.** Safe whole-Block move, duplicate, delete, and undo work without converting the Page to a private format. Supported text and list Blocks additionally allow split, merge, kind changes, and task toggles; risky transforms stay disabled for raw or complex syntax.
- **Slash commands insert Markdown.** Type `/` in a paragraph to insert portable headings, lists, tasks, Toggles, callouts, tables, Collection definitions, links, embeds, and other native source forms.
- **Properties stay in frontmatter.** Page aliases, custom scalar/list fields, and Page relations are edited through revision-guarded minimal YAML patches. Relations are exact `[[Page]]` strings or string arrays, never hidden records; unrelated keys, comments, line endings, and body bytes are preserved.
- **Local links form a rebuildable knowledge layer.** Resolvable `[[Wiki Links]]` open Markdown Pages in the current workspace. Wiki and relative Markdown links, backlinks, unlinked mentions, ambiguities, and unresolved links rebuild on demand from Page files without writing workspace state. Previewed Page/Folder relocation repairs resolvable targets transactionally. Standalone `![[Page]]`, `![[Page#Heading]]`, and `![[Page#^block-id]]` paragraph Blocks project recursively from the same Markdown sources, while the Page graph is a zero-write projection of resolved links.
- **Daily Notes and Collections are ordinary Pages.** Today's note is created at `Daily Notes/YYYY-MM-DD.md` using the local calendar date. Strict `doxmind-collection` fenced JSON renders read-only Table, Board, and Calendar views over Page frontmatter. Version 2 can derive relations, safe formula-AST values, and rollups in memory before filtering, sorting, grouping, or scheduling; every row/card/event still opens its Markdown Page.
- **Local images stay local.** A standalone relative Markdown image previews a workspace image through a size-limited, signature-checked local read and an in-memory Blob URL. In the Electron editor, pasting or dropping a supported raster copies it to `assets/` without overwrite and inserts a portable relative Markdown image reference. Remote, absolute, escaping, and symlinked destinations are not fetched.
- **Desktop file access is in-process.** The packaged Electron app executes workspace commands inside its desktop process. It does not start or bundle Python/FastAPI.

This does not imply full Notion or Obsidian parity. Collection views are derived and read-only, formulas use a strict JSON AST rather than executable code, image handling does not fetch remote content or provide a binary editor, and there is no cloud collaboration or plugin marketplace. See [Product Direction](docs/PRODUCT_DIRECTION.md) for the exact boundary.

## Page editing

The user's filesystem is the source of truth. The storage layer reads the complete file, separates YAML frontmatter from the Markdown body, and rebuilds the native block view from that body. Unknown frontmatter and unsupported body syntax remain in the same file and are preserved unless the user invokes a supported edit for that exact source; opening an external Markdown file does not add metadata merely because it lacks an id.

<p align="center">
  <img src="docs/readme/doxmind-editor.png" width="1200" alt="doXmind source-backed Markdown block editor" />
</p>

Autosave and explicit save atomically write only the Markdown file. Revision checks stop a stale editor session from silently overwriting an external change.

Page PDF output also stays local: **Export as PDF** asks for a destination and then generates the PDF directly inside Electron. The live native Block view is the layout authority; no printer, driver, FastAPI service, or second Markdown renderer is involved. Cancelling the Save dialog writes nothing, while success produces a concrete `.pdf` file without modifying the Page or any legacy sidecar.

## Attachments and legacy sidecars

The currently surfaced Attachment types are PDF, Excel-family/CSV, and HTML. They open read-only, with actions to use their normal desktop application or reveal them in the file manager. Images and other files remain ordinary local assets/files but are not all surfaced as Attachment cards. doXmind does not create blank PDFs/workbooks or write new attachment sidecars.

The former PDF/Excel editor bundles, attachment create/write/cache commands, sidecar inspection/recovery commands, and Synthetic Document migration writers have been removed. Only legacy-family move/trash behavior remains in the app. Optional CLI/MCP conversion may still parse PDF or workbook input read-only; those parsers are not attachment editors.

doXmind never opens a hidden sidecar. If an old PDF or spreadsheet sidecar holds edits you still need, read it outside doXmind — it is a JSON file — or recover them in the application that produced the source.

Keep the source attachment and its legacy sidecar family together until those old edits no longer matter.

## Get started

### Install the desktop app

The public release channel currently provides a macOS package for Apple silicon:

1. Download the `.dmg` from [doXmind Releases](https://github.com/doXmind/releases/releases/latest).
2. Drag doXmind to Applications and open it.
3. Choose **Open Folder** for a real-file workspace, **Open File** for one supported document, or create a Markdown Page.

See the [User Guide](docs/USER_GUIDE.md) for storage behavior, importing, shortcuts, local PDF export, and legacy sidecars.

### Import existing files

Dragging files into an open workspace copies these external formats without changing the originals:

- `.md`, `.markdown`
- `.pdf`
- `.xlsx`
- `.csv`

Name collisions offer Replace, Keep both, or Skip. An HTML file already inside an opened workspace remains visible as a read-only Attachment, but `.html` is not in the external drag-import whitelist.

### Run from source

Core requirement:

- Node.js 22 or newer

Install and build the Electron desktop app without Python:

```bash
npm ci
npm run dist:electron
```

Python 3.11 or newer is optional. It is used only for browser development and standalone CLI or import/conversion tooling; packaged desktop builds do not use it.

```bash
python3 -m venv server/.venv
server/.venv/bin/python -m pip install --upgrade pip
server/.venv/bin/python -m pip install -r server/requirements.txt
npm run dev:all
```

`npm run dev:all` starts the Next.js browser surface and the localhost FastAPI command mirror because a normal browser cannot invoke desktop filesystem commands.

## Stable file roles

| Format                   | Role                 | Current contract                                                                                                            |
| ------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `.md`, `.markdown`       | Page                 | Native block edit, YAML properties/relations, links/graph, Collection views, local images, exact copy, and local PDF export |
| `.pdf`                   | Read-only Attachment | Open externally/reveal; any legacy sidecar is preserved untouched and never read                                            |
| `.xlsx`, `.xlsm`, `.csv` | Read-only Attachment | Open externally/reveal; any legacy sidecar is preserved untouched and never read                                            |
| `.html`, `.htm`          | Read-only Attachment | Visible when already present in an opened workspace                                                                         |
| Images and other files   | Local asset/file     | Remain ordinary files; Electron can import supported raster images into `assets/` for Markdown references                   |

DOCX and PPTX are not Page types, stable imports, or supported inputs to the current conversion tools. Optional local Python tooling can parse explicitly selected PDF and spreadsheet sources read-only; it does not turn DOCX or PPTX files into Pages.

## Storage model

One Markdown file is a complete Page:

```text
~/Documents/doXmind/
├── Project Plan.md
├── attachments/
│   ├── Quarterly Plan.xlsx
│   └── Research Report.pdf
└── assets/
    └── diagram.png
```

Block spans, selection, undo history, previews, and rendered HTML are replaceable in-memory or derived state. Page save atomically writes only `.md`/`.markdown`.

Older versions may have created hidden `.doxmind` files beside Pages, PDFs, or workbooks. doXmind never reads their contents and never creates or rewrites one. Rename, move, and deletion inventory the existing family only to carry its bytes unchanged with the source or send the family to system Trash.

A family may include:

```text
.Research Report.pdf.doxmind
.Research Report.pdf.doxmind.bak
.Research Report.pdf.doxmind.lock
.Research Report.pdf.doxmind.corrupt-*
```

Do not manually delete the family while those old edits still matter. Deletion through doXmind sends the source and its existing sidecar artifacts to the operating system Trash/Recycle Bin.

## Desktop architecture

```text
Next.js + native blocks → Electron IPC → Node file commands → user filesystem

Browser development only: Next.js → localhost FastAPI command mirror → filesystem
```

Electron owns Page/workspace operations in-process. FastAPI is not a packaged desktop backend or sidecar; it remains an optional browser-development and standalone-tooling surface.

Repository structure:

```text
src/          Next.js UI, native Markdown block core, stores, and adapters
electron/     Electron shell and in-process Node filesystem commands
server/       Optional browser-dev, CLI, import/conversion, and local tooling
docs/         User, architecture, format, and decision documentation
```

## Current product boundary

Included now:

- Local Markdown Page editing in real folders
- Native source-backed block operations, raw-source fallback, undo/redo, autosave, find, outline, and tabs
- Portable `<details>` Toggles and slash-command insertion into canonical Markdown
- Frontmatter-backed aliases, scalar/list fields, and exact Wiki-Link relations with lossless, revision-guarded patches
- Navigable local `[[Wiki Links]]` plus a zero-write Wiki/Markdown link, backlink, unresolved-link, and unlinked-mention rebuild
- Previewed, revision-checked Page/Folder relocation with transactional link repair and rollback
- Recursive read-only `![[Page]]`, `![[Page#Heading]]`, and unique `![[Page#^block-id]]` paragraph-Block projections from canonical Markdown
- Local-date Daily Notes at `Daily Notes/YYYY-MM-DD.md`
- Read-only `doxmind-collection` Table, Board, and Calendar blocks derived from Page frontmatter, including portable relation/formula/rollup projections
- A zero-write, navigable Page knowledge graph derived from resolved links
- Safe relative local Markdown image previews plus Electron paste/drop import into workspace `assets/`
- Atomic single-file Page writes and external-change conflict detection
- Read-only Attachments beside untouched legacy PDF/Excel sidecars
- Byte-exact Markdown source copy and printer-independent Page PDF generation inside Electron
- Electron packaging without a Python process or second desktop runtime

Not included now:

- Editable Collection cells/cards/events or a hidden database record store
- Executable formula strings, relation guessing, or persisted formula/rollup results
- Remote-image fetching, image resize/crop, or a binary image editor
- PDF/Excel/HTML editing, blank Office/PDF creation, DOCX/PPTX editing, or Word export
- Accounts, teams, sharing, cloud sync, billing, telemetry, or built-in AI features

## Development

Common checks:

```bash
npm run type-check
npm run lint
npm run format:check
npm run test:ci
npm run test:e2e
npm run electron:test-native
npm run electron:smoke
```

Optional Python tooling checks from `server/`:

```bash
pytest
ruff check .
ruff format --check .
```

Optional environment variables are documented in [AGENTS.md](AGENTS.md). `DOXMIND_PYTHON` is consulted by `npm run dev:all`; it is not a packaged desktop setting. There are no API keys or external service credentials.

## Optional CLI and MCP access

The standalone `doxmind` CLI and `doxmind-mcp` server expose a selected local workspace to scripts or external agents. They run independently of the desktop app and are not a built-in AI runtime. See [CLI & MCP](docs/cli-and-mcp.md).

## FAQ

<details>
<summary>Does doXmind require an account or Python?</summary>

No account is required. The packaged Electron app does not require or launch Python; Python is optional for browser development, CLI/MCP, and import/conversion tooling.

</details>

<details>
<summary>Can I edit Markdown outside doXmind?</summary>

Yes. The Markdown file is authoritative. doXmind rebuilds the native block view from that source and detects a stale revision before saving over an external change.

</details>

<details>
<summary>Does doXmind edit PDF, Excel, or HTML files?</summary>

No. They are read-only Attachments. Open them in their normal desktop application. An old PDF/Excel sidecar left by an earlier version is preserved untouched; doXmind does not read it.

</details>

<details>
<summary>Are backlinks and Notion-style databases ready?</summary>

Backlinks, unresolved links, unlinked mentions, the Page graph, scalar/list and exact Wiki-Link relation properties, Page/heading/block-id transclusion, and read-only Table/Board/Calendar Collections are ready and derived from portable Markdown/YAML. Formula and rollup results are deterministic in-memory projections from a strict Collection v2 JSON definition; they are not executable scripts or a second persisted database.

</details>

<details>
<summary>Does my document content leave the machine?</summary>

Normal Page editing, search, PDF generation, and attachment handling stay local. Packaged builds may contact the release service for update checks; doXmind does not fetch Page or Attachment content from a remote service.

</details>
