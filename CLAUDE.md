# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

doXmind Mini is the **local sidecar edition**: a local-first, single-user desktop document editor. The product direction is a dual-file model where a clean Markdown file is the portable facade and a hidden `.doxmind` sidecar stores lossless editor HTML plus doXmind-only block data.

There is no auth, cloud sync, sharing, community, billing, telemetry, or AI runtime in this branch. The backend is a localhost FastAPI sidecar for storage, import/export, versions, images, and database-block data during the sidecar migration.

## Tech Stack

- **Frontend:** Next.js 15 App Router, React 19, TipTap, Zustand, Tailwind CSS
- **Backend:** FastAPI, Python 3.12, SQLAlchemy 2.0 async
- **Current database:** SQLite at `~/.doxmind/doxmind.db`
- **Desktop shell:** Tauri
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
2. Open `http://localhost:3000`
3. Start writing. There is no sign-in, API key setup, or provider selection.

## Target Sidecar Model

```text
~/Documents/notes/
├── Project Plan.md
├── .Project Plan.doxmind
└── assets/
    └── diagram.png
```

Sidecar shape:

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

Open algorithm:

1. Read `.md` and split frontmatter/body.
2. Find the same-name hidden `.doxmind` sidecar.
3. If missing, import Markdown into editor HTML.
4. If present and `markdown_hash` matches, use `sidecar.html`.
5. If present and the hash differs, treat external Markdown edits as authoritative and regenerate the sidecar on save.

Save algorithm:

1. Write `.md = editor.getMarkdown()`.
2. Hash the just-written Markdown.
3. Write `.doxmind = { html, markdown_hash, id, extras }`.

## Current Architecture

The checked-in runtime has not fully migrated to sidecar storage yet. SQLite still stores files, versions, and database blocks. When implementing the sidecar migration, introduce or use a `DocumentStore` boundary instead of putting `.md + .doxmind` filesystem logic directly into FastAPI route handlers.

### Frontend

- `src/app/editor/[[...fileId]]/page.tsx` is the editor entry point.
- `src/stores/` contains local Zustand stores for files, editor state, layout, settings, outline, block selection, and database blocks.
- `src/extensions/` contains TipTap extensions for editor behavior and custom blocks.
- `src/messages/` should only describe features present in this branch.

### Backend

`server/main.py` mounts:

- `files` — document CRUD
- `versions` — local version snapshots
- `export` — Markdown / HTML / PDF / DOCX export
- `import_file` — local import and conversion (routes through `services/document_converter.py`)
- `marker` — Marker (offline OCR) model lifecycle: `/api/import/marker/status` and `/api/import/marker/download`
- `images` — local image upload and serving
- `databases` — database-block CRUD until sidecar `extras.databases` becomes the source of truth

`server/db/database.py` defines the current SQLite schema and `create_all` startup flow. There is no Alembic.

### Document import pipeline

`markitdown` was replaced with a per-format router (`services/document_converter.py`):

| Format                         | Strategy                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `.pdf` (native text)           | **PyMuPDF4LLM** — fast path, no models, milliseconds. Trips when avg chars/page ≥ 40. |
| `.pdf` (scanned / image-heavy) | **Marker** (Surya layout + OCR). Lazy-loaded on Apple Silicon via `TORCH_DEVICE=mps`. |
| `.docx`                        | **mammoth** → HTML → markdownify.                                                     |
| `.pptx`                        | **python-pptx** + a custom slide-by-slide markdown emitter.                           |
| `.md` / `.markdown`            | passthrough.                                                                          |

The Marker fallback needs ~2GB of Surya weights from HuggingFace. We do **not** pre-bundle them. The first time a scanned PDF hits the converter:

1. Backend returns `409 MARKER_MODELS_REQUIRED`.
2. Frontend (`src/stores/marker-store.ts` + `src/components/marker-download-prompt.tsx`) shows a one-time confirm modal.
3. On accept, frontend POSTs `/api/import/marker/download` and polls `/api/import/marker/status` until `installed`.
4. The original import is replayed automatically.

Install state is tracked by a sentinel file at `~/.doxmind/marker-models.json` — delete it to force a re-download.

Packaging caveat: `marker-pdf` brings in PyTorch + Surya, which inflates the PyInstaller bundle considerably. The single-file sidecar still works for dev, but the `.app` build will likely need to switch to a directory bundle (or ship a thin venv) to keep launch latency reasonable.

## Storage Ownership

- Markdown file: portable user-facing source.
- `.doxmind` sidecar: rich HTML and doXmind-only extras.
- `extras.databases`: target source of truth for database blocks.
- SQLite: current implementation detail and future runtime cache, not the long-term document source of truth.

## Environment Variables

All optional:

- `DATA_DIR` — override `~/.doxmind`
- `DOXMIND_PYTHON` — Python path for `npm run dev:all`
- `DEBUG`, `HOST`, `PORT` — backend config

There are no API keys or external service credentials.

## Removed Surface

This branch intentionally excludes JWT auth, OAuth user login, password reset, email verification, Stripe billing, credits, quotas, sharing links, community publishing, comments, follows, bookmarks, notifications, telemetry, RLHF reporting, S3, Postgres, Redis, Docker deployment, hosted cloud sync, chat, agents, providers, OpenRouter, autocomplete, quick edit, document review, prompts, and knowledge-base retrieval.

Do not rebuild these by accident. If a feature needs to return, make the product decision explicit and design it around the local sidecar edition.

`markitdown` was also dropped in this revision in favor of the per-format pipeline above (PyMuPDF4LLM + Marker + mammoth + python-pptx) — quality on scanned PDFs and complex layouts was the bottleneck. Don't reintroduce it.
