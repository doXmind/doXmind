# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

doXmind is a **fully-local desktop IDE** for documents. It is a Tauri shell wrapping a Next.js frontend and a localhost FastAPI sidecar. There is no auth, no cloud sync, no AI runtime, no telemetry, no billing/sharing — the user's files on disk are the source of truth.

Three document types are first-class citizens:

- **Markdown** — rich TipTap editor with custom blocks (math, mermaid, callouts, databases, …). Persisted as a portable `.md` file plus a hidden same-name `.doxmind` sidecar that stores the lossless editor HTML and doXmind-only extras.
- **PDF** — block-based annotation/edit surface. Editor state lives in a hidden sidecar next to the original PDF.
- **Excel** — workbook editor with formulas, filters, autofill, formatting, and structural row/col ops. Editor state lives in a hidden sidecar next to the original `.xlsx`.

## Tech Stack

- **Frontend:** Next.js 15 App Router, React 19, TipTap, Zustand, Tailwind CSS
- **Backend:** FastAPI, Python 3.12, SQLAlchemy 2.0 async (only for app-level metadata)
- **Local DB:** SQLite at `~/.doxmind/doxmind.db` — currently a single `app_metadata` key/value table. Documents are *not* stored in SQLite.
- **Desktop shell:** Tauri 2 (Rust)
- **External services:** none

## Commands

### Frontend

```bash
npm run dev:all       # frontend + backend with auto-port discovery
npm run dev           # Next.js only
npm run server        # FastAPI only
npm run build
npm run lint
npm run type-check
npm test
npm run test:ci
```

### Backend

Run from `server/`:

```bash
python main.py
pytest
pytest path/to/test_file.py::test_name
ruff check .
ruff format .
```

`scripts/dev.mjs` resolves Python in this order: `$DOXMIND_PYTHON`, `server/.venv/bin/python`, then `python3` / `python` on PATH.

## First Run

1. `npm run dev:all`
2. Open `http://localhost:3000` (or launch the Tauri shell)
3. Pick a workspace directory, then start opening or creating `.md` / `.pdf` / `.xlsx` files. There is no sign-in, API key, or provider selection.

## Storage Model

The user's filesystem is the source of truth. Each document is represented by the original portable file plus a hidden sidecar holding doXmind-only state.
A `<sidecar>.lock` file appears next to each sidecar during migration; these files are tiny, persist after use, and must not be deleted manually.

```text
~/Documents/notes/
├── Project Plan.md
├── .Project Plan.doxmind          # markdown sidecar (HTML + extras)
├── Q3 Forecast.xlsx
├── .Q3 Forecast.doxmind            # excel editor state
├── Spec.pdf
├── .Spec.doxmind                   # pdf editor state
└── assets/
    └── diagram.png
```

Markdown sidecar shape:

```json
{
  "version": 1,
  "id": "dfe24100-bb43-4f93-8553-2d9fdcc50172",
  "html": "<p>...</p>",
  "markdown_hash": "sha256:abc123...",
  "updated_at": "2026-04-29T17:38:00Z",
  "extras": {
    "databases": {}
  }
}
```

Markdown open algorithm:

1. Read `.md` and split frontmatter/body.
2. Find the same-name hidden `.doxmind` sidecar.
3. If missing, import Markdown into editor HTML.
4. If present and `markdown_hash` matches, use `sidecar.html`.
5. If present and the hash differs, treat external Markdown edits as authoritative and regenerate the sidecar on save.

Markdown save algorithm:

1. Write `.md = editor.getMarkdown()`.
2. Hash the just-written Markdown.
3. Write `.doxmind = { html, markdown_hash, id, extras }`.

PDF and Excel follow the same hidden-sidecar pattern; their state schemas are owned by `services/pdf_blocks.py` and `services/excel_workbook.py` respectively.

## Architecture

### Frontend

- `src/app/page.tsx` — welcome screen with recents.
- `src/app/editor/[[...fileId]]/page.tsx` — main editor entry point.
- `src/app/settings/page.tsx` — settings.
- `src/components/editor/` — Markdown editor surface and toolbar.
- `src/components/excel-editor/` — Excel workspace, sheet view, formula bar, filters.
- `src/components/pdf-editor/` — PDF block editor.
- `src/components/welcome-screen.tsx`, `src/components/home/` — welcome / recents UI.
- `src/components/sidebar/`, `src/components/layout/` — workspace shell, multi-window chrome.
- `src/extensions/` — TipTap extensions (custom blocks: math, mermaid, callout, database, page-link, …).
- `src/lib/excel/` — Excel workbook state + serialization.
- `src/lib/pdf/` — PDF state + export.
- `src/lib/storage/` — sidecar read/write boundary.
- `src/lib/markdown.ts`, `src/lib/markdown-selection.ts` — Markdown helpers.
- `src/stores/` — Zustand stores (file, editor, layout, settings, outline, block selection, database blocks, appearance, editor-ref).

### Backend

`server/main.py` mounts four routers:

- `images` (`/api/images`) — local image upload/serve, used by the Markdown editor.
- `workspace` (`/api/workspace/invoke`) — single dispatch endpoint that mirrors the Tauri filesystem command surface for plain-browser dev. Commands include `workspace_scan`, `doc_read`, `doc_write_workspace`, `workspace_read_pdf_editor_state` / `workspace_write_pdf_editor_state`, `workspace_read_excel_editor_state` / `workspace_write_excel_editor_state`, `doc_create`, `doc_create_pdf`, `doc_rename`, `doc_move`, `doc_delete`, etc.
- `pdf` (`/api/pdf`) — `parse-blocks` (PyMuPDF-based block extraction) and `export-edited`.
- `excel` (`/api/excel`) — `parse-workbook` (openpyxl) and `export-edited`.

`server/db/database.py` defines a single `AppMetadata` key/value table and the async engine. There is no Alembic. Document content never lands in SQLite.

### Document import / parse pipeline

| Format        | Strategy                                          |
| ------------- | ------------------------------------------------- |
| `.md` / `.markdown` | Direct read; rendered via `markdown` (`tables`, `fenced_code`) into TipTap HTML. |
| `.pdf`        | **PyMuPDF** block extraction in `services/pdf_blocks.py`. |
| `.xlsx`       | **openpyxl** in `services/excel_workbook.py`.     |
| `.docx`       | **mammoth** → HTML → markdownify (kept available; not currently surfaced as an import flow). |
| `.pptx`       | **python-pptx** + per-slide markdown emitter (kept available; not currently surfaced). |

Marker / Surya OCR is intentionally excluded from the runtime and from the PyInstaller bundle (`server/doxmind-server.spec`) — the model weights and PyTorch dependency made the bundle unshippable for a desktop IDE. If scanned-PDF support comes back, it must be designed as an optional, lazily-installed add-on.

## Environment Variables

All optional:

- `DATA_DIR` — override `~/.doxmind`
- `DOXMIND_PYTHON` — Python path for `npm run dev:all`
- `DEBUG`, `HOST`, `PORT` — backend config
- `DOXMIND_SIDECAR_MIGRATE` — controls one-shot migration of legacy PDF/Excel sidecars (`{pdf_editor, excel_editor, …}` shape) to the markdown sidecar shape on first open. Default on. Set to `0` (also accepted: `false`/`no`/`off`) to suppress migration; legacy sidecars then open in read-only mode and any save raises `ReadOnlyDocumentError`. Migration writes the original sidecar to `<sidecar>.bak` before rewriting; recovery is `mv .foo.doxmind.bak .foo.doxmind`. See [docs/adr/0003-explicit-sidecar-migration.md](docs/adr/0003-explicit-sidecar-migration.md).

There are no API keys or external service credentials.

## Removed Surface — Do Not Reintroduce

This product intentionally excludes JWT auth, OAuth user login, password reset, email verification, Stripe billing, credits, quotas, sharing links, community publishing, comments, follows, bookmarks, notifications, telemetry, RLHF reporting, S3, Postgres, Redis, Docker deployment, hosted cloud sync, chat, agents, providers, OpenRouter, autocomplete, quick edit, document review, prompts, knowledge-base retrieval, and `markitdown`.

Do not rebuild these by accident. If a feature needs to return, make the product decision explicit and design it around the local desktop IDE model.

## Agent skills

### Issue tracker

Issues live in GitHub Issues at `doXmind/local-desk` (uses the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root (neither exists yet; created lazily by `/grill-with-docs`). See `docs/agents/domain.md`.
