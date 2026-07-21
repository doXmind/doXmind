# doXmind

<p align="center">
  <a href="https://github.com/doXmind/releases/releases/latest"><img src="https://img.shields.io/github/v/release/doXmind/releases?display_name=tag&style=flat-square&label=latest" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/local--first-local%20documents-2ea44f?style=flat-square" alt="Local-first documents" />
  <img src="https://img.shields.io/badge/desktop-Electron-47848f?style=flat-square" alt="Desktop: Electron" />
  <img src="https://img.shields.io/badge/frontend-Next.js%2015-black?style=flat-square" alt="Frontend: Next.js 15" />
  <img src="https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square" alt="Backend: FastAPI" />
</p>

<p align="center">
  <img src="docs/readme/doxmind-overview.png" width="1200" alt="doXmind local Markdown knowledge workspace" />
</p>

<h3 align="center">A fully local, Markdown-native knowledge workspace.</h3>

<p align="center">
  Write and organize Markdown Pages with rich blocks, then connect them through local files and a rebuildable knowledge layer. Supported PDF, spreadsheet, and HTML files remain ordinary attachments on disk; images inserted into Pages remain local Markdown assets. There is no account, cloud sync, telemetry, hosted parser, or built-in AI runtime.
</p>

<p align="center">
  <a href="https://github.com/doXmind/releases/releases/latest"><strong>Download the latest release</strong></a>
  ·
  <a href="docs/USER_GUIDE.md"><strong>Read the user guide</strong></a>
</p>

---

## Why doXmind

- **Your filesystem is the source of truth.** Documents stay in the folder you choose and remain usable in Finder, Git, VS Code, Obsidian, Acrobat, Excel, and other desktop tools.
- **Rich editing remains recoverable.** A hidden `.doxmind` sidecar preserves editor-only state without replacing the portable source file.
- **External edits are expected.** When Markdown changes outside doXmind, the `.md` file wins and the rich editor state is refreshed on the next save.
- **Knowledge remains portable.** Page properties and links belong in Markdown/frontmatter; search, backlinks, and collection indexes must be rebuildable.
- **Supported attachments stay ordinary files.** doXmind shows them in a read-only surface and may reference, reveal, open, or explicitly convert them, but never silently rewrites them.
- **Desktop workflows are first-class.** Mount a folder, drag supported files into a workspace, use multiple tabs, search, and reveal files in the system file manager.

## Write and connect Pages

Write in a TipTap editor while keeping a normal `.md` file on disk. The editor supports headings, lists, tasks, quotes, callouts, toggles, tables, images, templates, code blocks, KaTeX math, Mermaid diagrams, columns, a table of contents, search, an outline, focus mode, and Markdown/PDF export.

<p align="center">
  <img src="docs/readme/doxmind-editor.png" width="1200" alt="doXmind Markdown editor with tabs, file tree, tasks, a table, and a code block" />
</p>

The active roadmap adds frontmatter-backed properties, `[[Wiki Links]]`,
backlinks, Daily Notes, and Page-based Table/Board/Calendar collections. See
[Product Direction](docs/PRODUCT_DIRECTION.md) for the boundary and dependency
order.

## Keep attachments local

Supported PDF, spreadsheet, and HTML files remain visible in the workspace as
Attachments. They open in a shared read-only surface with **Open Externally**
and **Reveal**. An embedded preview may be added later where practical, but
Attachments are not separate doXmind editing
products, and the New menu does not create blank PDFs or workbooks. An unknown
format may use the shared `other` read-only fallback if it reaches this surface,
but that fallback does not add the format to workspace scanning or native file
opening. Images inserted into Pages remain Markdown assets; standalone image
files are not promised as workspace documents. While legacy recovery evidence
is still gated, Attachment sidebar actions are limited to **Open Externally**
and **Reveal**; move, rename, delete, and same-name replacement remain disabled.

When a supported legacy PDF/Excel sidecar contains edits, the Attachment
surface can make an explicit, unverified recovery attempt through an isolated,
zero-write bridge. Older builds could refresh `parsedCache.sourceHash` without
rebinding the saved editor state, so that hash is only an early mismatch guard,
not proof that edits belong to one exact file version. Recovery always creates
a new copy for comparison; it does not open the old editor or call its readers,
writers, migration, or caches. Unsupported or uncertain state remains preserved
for manual recovery.

## Get started

### Install the desktop app

The public release channel currently provides a macOS package for Apple silicon:

1. Download the `.dmg` from [doXmind Releases](https://github.com/doXmind/releases/releases/latest).
2. Drag doXmind to Applications and open it.
3. On the welcome screen, choose **New** for an untitled Markdown Page or **Open Folder** for a workspace. Use **File → Open File…** (`Cmd+O`) for one standalone file.

See the [User Guide](docs/USER_GUIDE.md) for the complete workflow, storage behavior, shortcuts, and recovery notes.

### Run from source

Requirements:

- Node.js 22 or newer
- Python 3.11 or newer
- Rust toolchain only when using the Tauri development/build path

Install dependencies:

```bash
npm ci
python3 -m venv server/.venv
server/.venv/bin/python -m pip install --upgrade pip
server/.venv/bin/python -m pip install -r server/requirements.txt
```

Run the browser development surface and local backend:

```bash
npm run dev:all
```

The launcher prints the actual frontend URL. It starts at port `3000` and automatically chooses another free port when needed.

Desktop build paths:

```bash
npm run dist:electron   # package the current Electron release shell
npm run dev:desktop     # macOS Tauri development shell
npm run build:desktop   # local Tauri compatibility build
```

## Stable document formats

| Format                   | Product role             | Current contract                                                              |
| ------------------------ | ------------------------ | ----------------------------------------------------------------------------- |
| `.md`, `.markdown`       | Page                     | Open, edit, auto-save, and export as Markdown or PDF                          |
| `.pdf`                   | Attachment               | Read-only surface; open externally or reveal; legacy recovery is transitional |
| `.xlsx`, `.xlsm`, `.csv` | Attachment               | Read-only surface; open externally or reveal; legacy recovery is transitional |
| `.html`, `.htm`          | Attachment/import source | Read-only surface; not a first-class editable Page format                     |

Images inserted into Pages remain ordinary local assets referenced by Markdown.
Standalone image files, DOCX, PPTX, and other extensions are not supported
workspace documents merely because the shared Attachment view has an `other`
fallback.

DOCX and PPTX are not Page types. Explicit one-way conversion into Markdown may
be provided by local import tooling; the source file remains unchanged.

## Storage model

doXmind keeps each Markdown Page beside a hidden companion file:

```text
~/Documents/doXmind/
├── Project Plan.md
├── .Project Plan.doxmind
├── attachments/
│   ├── Quarterly Plan.xlsx
│   └── Research Report.pdf
└── assets/
    └── diagram.png
```

Page freshness is tracked with a hash of the current Markdown. Page sidecars
hold lossless editor HTML and replaceable state; user-authored knowledge must
remain recoverable from Markdown/frontmatter alone.

Older versions may have created sidecars next to PDF/XLSX sources. Recovery
inspects the main sidecar and `<sidecar>.bak` independently and downloads a new
`recovered.pdf` or `recovered.xlsx` without changing either candidate or the
source. The bridge does not read `<sidecar>.lock` or `<sidecar>.corrupt-*`; those
files remain recovery evidence. Keep the source, main sidecar, every
`<sidecar>.bak`, `<sidecar>.lock`, and `<sidecar>.corrupt-*` together; do not
delete any of them as cleanup or after an export.

The full wire-format contract is documented in [docs/sidecar-format.md](docs/sidecar-format.md), and migration/recovery semantics are in [ADR-0003](docs/adr/0003-explicit-sidecar-migration.md).

## Current product boundary

Included:

- Local Markdown Page editing and real-folder workspaces
- Rich blocks, templates, search, outline, tabs, and local export
- Hidden `.doxmind` sidecars with atomic local writes
- Multi-window and multi-tab desktop workflows
- Local assets and supported Attachments
- A rebuildable path toward properties, Wiki Links, backlinks, and Page-based collections
- Electron packaging and update channel; Tauri remains available as a development/compatibility shell

Intentionally not included:

- Accounts, OAuth, teams, sharing links, comments, or community publishing
- Cloud sync, S3, Postgres, Redis, or hosted document storage
- Billing, quotas, or telemetry
- Built-in chat, model providers, autocomplete, document review, or knowledge retrieval
- PDF/Excel/HTML editing stacks, blank Office/PDF creation, DOCX/PPTX editing, or Word export

## Development

Common checks:

```bash
npm run type-check
npm run lint
npm run format:check
npm run test:ci
npm run test:e2e
npm run preflight:gui
npm run preflight:excel
npm run electron:smoke
```

Backend checks from `server/`:

```bash
pytest
ruff check .
ruff format --check .
```

`scripts/dev.mjs` resolves Python in this order: `$DOXMIND_PYTHON`, `server/.venv/bin/python`, then `python3` / `python` on `PATH`.

### Environment variables

All are optional:

- `DATA_DIR` — override `~/.doxmind`
- `DOXMIND_PYTHON` — Python executable used by `npm run dev:all`
- `DEBUG`, `HOST`, `PORT` — backend configuration
- `DOXMIND_SIDECAR_MIGRATE` — controls the frozen legacy PDF/Excel migration stack documented in [ADR-0003](docs/adr/0003-explicit-sidecar-migration.md); the current Attachment recovery bridge does not invoke it
- `DOXMIND_PERF` — opt-in backend performance instrumentation
- `DOXMIND_DISABLE_DOC_CACHE`, `DOXMIND_DISABLE_PDF_CACHE`, `DOXMIND_DISABLE_XLSX_CACHE` — backend cache kill switches for debugging

There are no API keys or external service credentials.

### Repository structure

```text
src/                  Next.js UI, editors, stores, and storage adapters
server/               FastAPI sidecar, local document services, CLI, and MCP server
electron/             Current release shell and native desktop integration
src-tauri/            Tauri development/compatibility shell
crates/               Shared Rust sidecar helpers
docs/                 User, architecture, format, and decision documentation
docs/readme/          Current README screenshots
```

### Architecture

```text
Electron release shell / Tauri development shell
                       │
                       ▼
                 Next.js editor UI
                       │ localhost HTTP / native invoke
                       ▼
                 FastAPI sidecar
                       │
                       ▼
          local files + hidden .doxmind sidecars
```

The frontend owns the editing experience. The local backend owns filesystem operations, parsing, export, image storage, and workspace commands. SQLite at `~/.doxmind/doxmind.db` stores only application metadata; documents themselves do not live in SQLite.

## Optional CLI and MCP access

The standalone `doxmind` CLI and `doxmind-mcp` server expose the same local workspace to scripts or external agents. They run independently of the desktop app and are not a built-in AI runtime. See [docs/cli-and-mcp.md](docs/cli-and-mcp.md).

## FAQ

<details>
<summary>Does doXmind require an account?</summary>

No. It is a single-user local desktop editor with no login, provider selection, or API key.

</details>

<details>
<summary>Where are my documents stored?</summary>

Wherever you put them. Opening a folder mounts that folder as the workspace;
opening a standalone file does not scan its siblings. Rich editor state for a
Markdown Page stays next to that Page in its hidden sidecar. New Attachments do
not receive editor sidecars.

</details>

<details>
<summary>Can I edit Markdown outside doXmind?</summary>

Yes. If the `.md` hash no longer matches its sidecar, doXmind treats the Markdown file as authoritative and refreshes rich editor state from it.

</details>

<details>
<summary>What happens to PDF and spreadsheet files?</summary>

They remain ordinary local Attachments. doXmind does not silently rewrite them.
If supported legacy evidence is found, doXmind can attempt a new, unverified
recovery copy without mounting the old editor or changing the source, sidecar,
backup, lock file, or any `.corrupt-*` evidence. When the main sidecar and backup
contain different saved states, you choose which one to try. A missing or
mismatched cache hash blocks the attempt, and strict exporters reject any field
they cannot apply completely. Compare the new copy with the original before
using it.

</details>

<details>
<summary>How do I recover a deleted Page?</summary>

doXmind sends a deleted Markdown Page and its sidecar to the operating system
Trash/Recycle Bin as separate entries. Restore both to their original folder.
Attachment deletion is not currently offered inside doXmind.

</details>

<details>
<summary>Does my data leave my machine?</summary>

Document content, parsing, exports, sidecars, and application metadata stay local; doXmind does not upload documents to a hosted workspace. Packaged builds can contact the release service for update checks, and inserting a web bookmark can request that page and its preview image. Optional CLI/MCP access operates directly on the local filesystem.

</details>
