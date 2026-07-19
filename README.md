# doXmind

<p align="center">
  <a href="https://github.com/doXmind/releases/releases/latest"><img src="https://img.shields.io/github/v/release/doXmind/releases?display_name=tag&style=flat-square&label=latest" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/local--first-local%20documents-2ea44f?style=flat-square" alt="Local-first documents" />
  <img src="https://img.shields.io/badge/desktop-Electron-47848f?style=flat-square" alt="Desktop: Electron" />
  <img src="https://img.shields.io/badge/frontend-Next.js%2015-black?style=flat-square" alt="Frontend: Next.js 15" />
  <img src="https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square" alt="Backend: FastAPI" />
</p>

<p align="center">
  <img src="docs/readme/doxmind-overview.png" width="1200" alt="doXmind workspace with local Markdown, PDF, and spreadsheet documents" />
</p>

<h3 align="center">A local-first desktop workspace for Markdown, PDF, and spreadsheets.</h3>

<p align="center">
  Open a folder and work directly with the files already on your disk. There is no account, cloud sync, telemetry, hosted parser, or built-in AI runtime. Document editing and parsing stay local; update checks and user-requested web bookmark previews may use the internet.
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
- **PDF and workbook sources stay untouched.** Save records edits in the sidecar; Export creates a new PDF or XLSX with those edits applied.
- **Desktop workflows are first-class.** Open one file, mount an entire folder, drag files into a workspace, use multiple tabs, search, and reveal documents in the system file manager.

## Work across document types

### Markdown

Write in a TipTap editor while keeping a normal `.md` file on disk. The editor supports headings, lists, tasks, quotes, callouts, toggles, tables, images, page links, bookmarks, code blocks, KaTeX math, Mermaid diagrams, columns, a table of contents, document search, an outline, focus mode, and Markdown/PDF export.

<p align="center">
  <img src="docs/readme/doxmind-editor.png" width="1200" alt="doXmind Markdown editor with tabs, file tree, tasks, a table, and a code block" />
</p>

### PDF

Read PDFs with thumbnails, single-page, continuous, or two-page views. Edit extracted text blocks, add free text, create highlights, adjust text styling, and export a new PDF. Opening or saving never silently rewrites the original PDF.

<p align="center">
  <img src="docs/readme/doxmind-pdf.png" width="1200" alt="doXmind PDF editor with thumbnails, view controls, and an editable local PDF" />
</p>

### Spreadsheets

Edit `.xlsx` workbooks with multiple sheets, formulas, number and cell formatting, filters, sorting, autofill, freeze controls, conditional formatting, data validation, comments, and structural row/column operations. Save keeps the edit model in the sidecar; Export writes a new `.xlsx` file.

<p align="center">
  <img src="docs/readme/doxmind-excel.png" width="1200" alt="doXmind spreadsheet editor with formatting tools, formula bar, workbook grid, and sheet tabs" />
</p>

## Get started

### Install the desktop app

The public release channel currently provides a macOS package for Apple silicon:

1. Download the `.dmg` from [doXmind Releases](https://github.com/doXmind/releases/releases/latest).
2. Drag doXmind to Applications and open it.
3. Choose **Open Folder** to mount an existing workspace, **Open File** to work with one standalone document, or start a new Markdown document.

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

| Format             | Current behavior                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `.md`, `.markdown` | Open, edit, auto-save, and export as Markdown or PDF                                     |
| `.pdf`             | Read, edit extracted text, add text/highlights, save sidecar state, and export a new PDF |
| `.xlsx`            | Edit workbook content and formatting, save sidecar state, and export a new XLSX          |
| `.xlsm`            | Opens through the workbook path; VBA preservation is not guaranteed on export            |

CSV entry points exist in the current development branch, but CSV is not yet in the stable format list: opening it from a mounted folder can still reach the XLSX parser and fail. Convert CSV files to `.xlsx` until that end-to-end path is fixed.

There is no OCR pipeline. Image-only/scanned PDFs can be viewed, but doXmind cannot turn their pixels into editable text. DOCX and PPTX are not supported document types in the current desktop edition.

## Storage model

doXmind keeps each portable file beside a hidden companion file:

```text
~/Documents/doXmind/
├── Project Plan.md
├── .Project Plan.doxmind
├── Quarterly Plan.xlsx
├── .Quarterly Plan.xlsx.doxmind
├── Research Report.pdf
├── .Research Report.pdf.doxmind
└── assets/
    └── diagram.png
```

| Document    | Portable source  | What Save writes                                    | What Export writes              |
| ----------- | ---------------- | --------------------------------------------------- | ------------------------------- |
| Markdown    | `.md`            | Markdown plus rich editor HTML/extras in `.doxmind` | A selected `.md` or `.pdf` copy |
| PDF         | Original `.pdf`  | PDF edit state in `.pdf.doxmind`                    | A new edited `.pdf`             |
| Spreadsheet | Original `.xlsx` | Workbook edit state in `.xlsx.doxmind`              | A new edited `.xlsx`            |

Markdown freshness is tracked with a hash of the current `.md`. PDF and spreadsheet parser caches track the corresponding source binary. A small `<sidecar>.lock` file can persist after a legacy sidecar migration and must not be deleted manually. Migration also keeps the original sidecar as `<sidecar>.bak` before rewriting it.

The practical rule is simple: keep a source file and its sidecar together. Restoring only a PDF/XLSX source loses the edits held in its sidecar; restoring only Markdown text can lose rich editor-only state.

The full wire-format contract is documented in [docs/sidecar-format.md](docs/sidecar-format.md), and migration/recovery semantics are in [ADR-0003](docs/adr/0003-explicit-sidecar-migration.md).

## Current product boundary

Included:

- Local Markdown, PDF, and XLSX editing
- Hidden `.doxmind` sidecars with atomic local writes
- Multi-window and multi-tab desktop workflows
- Local image storage for Markdown documents
- PDF and workbook parse/export through a localhost FastAPI sidecar
- Electron packaging and update channel; Tauri remains available as a development/compatibility shell

Intentionally not included:

- Accounts, OAuth, teams, sharing links, comments, or community publishing
- Cloud sync, S3, Postgres, Redis, or hosted document storage
- Billing, quotas, or telemetry
- Built-in chat, model providers, autocomplete, document review, or knowledge retrieval
- OCR, DOCX/PPTX editing, or Word export

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
- `DOXMIND_SIDECAR_MIGRATE` — enable or disable one-shot legacy PDF/Excel sidecar migration; see [ADR-0003](docs/adr/0003-explicit-sidecar-migration.md)
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

Wherever you put them. Opening a folder mounts that folder as the workspace; opening a standalone file does not scan its siblings. Rich editor state stays next to each document in its hidden sidecar.

</details>

<details>
<summary>Can I edit Markdown outside doXmind?</summary>

Yes. If the `.md` hash no longer matches its sidecar, doXmind treats the Markdown file as authoritative and refreshes rich editor state from it.

</details>

<details>
<summary>Does Save overwrite my PDF or workbook?</summary>

No. Save updates the hidden sidecar. Use Export when you want a new PDF or XLSX with the current edits applied.

</details>

<details>
<summary>How do I recover a deleted document?</summary>

doXmind sends the source file and its sidecar to the operating system Trash/Recycle Bin as separate entries. Restore both to their original folder.

</details>

<details>
<summary>Does my data leave my machine?</summary>

Document content, parsing, exports, sidecars, and application metadata stay local; doXmind does not upload documents to a hosted workspace. Packaged builds can contact the release service for update checks, and inserting a web bookmark can request that page and its preview image. Optional CLI/MCP access operates directly on the local filesystem.

</details>
