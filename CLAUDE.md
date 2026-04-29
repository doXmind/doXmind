# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

doXmind Mini is a **local-first, single-user, offline document editor**. It is a TipTap-based WYSIWYG editor with a thin FastAPI sidecar that handles file storage, version snapshots, and document import/export. There is no auth, no cloud sync, no sharing, no billing, **and no LLM / AI features**. All data lives in `~/.doxmind/`.

## Tech Stack

- **Frontend:** Next.js 15 (App Router), React 19, TipTap, Zustand, Tailwind CSS
- **Backend:** FastAPI, Python 3.12, SQLAlchemy 2.0 (async)
- **Database:** SQLite (single file at `~/.doxmind/doxmind.db`)
- **External services:** none. The backend binds to `127.0.0.1` and makes no outbound network calls.

## Commands

### Frontend (from project root)

```bash
npm run dev           # Start Next.js dev server (port 3000)
npm run build         # Production build
npm run lint          # ESLint
npm run type-check    # tsc --noEmit
npm test              # Vitest in watch mode
npm run dev:all       # Run frontend + backend together
```

### Backend (from server/ directory)

```bash
python main.py        # Run FastAPI server on 127.0.0.1:8000
pytest                # Run tests (in-memory SQLite)
ruff check .          # Lint
ruff format .         # Format
```

### First-run flow

1. `npm run dev:all` (or run backend + frontend separately).
2. Open `http://localhost:3000` — you land directly in the editor.
3. Start writing. There is no sign-in, no API key, no setup step.

## Architecture

### Local data directory

Everything user-owned lives under `~/.doxmind/`:

- `doxmind.db` — SQLite database (files, versions, database blocks)
- `uploads/` — Local image uploads (cover images, inline images)

The `DATA_DIR` environment variable can override this path.

### Frontend Structure

- **Stores** (`src/stores/`): Zustand global state — `file-store`, `editor-store`, `editor-ref-store`, `database-store`, `outline-store`, `layout-store`, `block-selection-store`, `settings-store`. All local, all single-user.
- **Hooks** (`src/hooks/`): UI-side business logic — block interaction, keyboard shortcuts, selection, mobile gestures, spellcheck, theme, etc. None of these talk to an LLM.
- **Extensions** (`src/extensions/`): Custom TipTap extensions — block handle / color / selection, callout, code-block, columns, database, inline-comment, math, mermaid, page-link, resizable-image, search, spellcheck, toc, toggle, web-bookmark.

Entry point: `src/app/editor/[[...fileId]]/page.tsx` (the root `/` redirects here). The settings page (`src/app/settings/page.tsx`) only exposes typography controls.

### Backend Structure

- **API routes** (`server/api/`): Six thin FastAPI routers, all wired up in `server/main.py`:
  - `files` — CRUD on documents
  - `versions` — per-file version snapshots
  - `export` — render documents to Markdown / HTML / PDF / DOCX
  - `import_file` — convert PDF / DOCX / PPTX / XLSX / Markdown into editor content (via `markitdown`)
  - `images` — local image upload and serving from `~/.doxmind/uploads/`
  - `databases` — database-block CRUD
- **Services** (`server/services/`): `export_service`, `document_detector`, `document_sections`, `content_sanitizer`, `default_guide`, `storage_service`. `auth_service.py` is a stub kept only so legacy imports keep resolving — it always reports a single fixed `local` user.
- **Database** (`server/db/database.py`): SQLAlchemy models. `init_db()` runs `create_all` against SQLite — no Alembic.

Entry point: `server/main.py`. The lifespan handler creates `~/.doxmind/` and the SQLite file on first boot.

## Database

There is no Alembic. Schema is defined in `server/db/database.py` and applied with `Base.metadata.create_all` on startup. To change the schema:

1. Edit the model in `server/db/database.py`.
2. Delete `~/.doxmind/doxmind.db` (or migrate by hand) — single-user local app, your call.
3. Restart the server.

The `user_id` columns on `File`, `Conversation`, and `DatabaseBlock` are kept as plain (non-FK) strings defaulting to `"local"` purely to keep legacy queries compatible.

## Environment Variables

All optional.

- `DATA_DIR` — override `~/.doxmind`
- `DEBUG`, `HOST`, `PORT` — server config

There are no API keys or external service credentials.

## Code Quality

- **Pre-commit hooks:** ESLint + Prettier via Husky
- **Frontend:** TypeScript strict mode, `@/*` path aliases
- **Backend:** Ruff (line length 100, double quotes)

## API Documentation

The backend always exposes:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## What was removed

This branch is the local desktop edition. Two waves of removals shaped it:

**SaaS features:** authentication (JWT, OAuth, password reset, email verification), Stripe billing, credits / usage quotas, document sharing, community feed, comments, follows / bookmarks, notifications, telemetry / RLHF reporting, AWS S3 storage, Notion / Google Drive OAuth import, Postgres, Redis, Docker, Heroku release config, all multi-user data isolation.

**LLM / AI features** (removed in `fd59e3b`): the writing agent, global agent, KB agent, chat streaming, autocomplete, inline edit, diff-review, text-review, knowledge base, web search (Serper), tool system, prompts, skills, OpenRouter / OpenAI integration, the `api-settings` page, and every supporting store / hook / extension on the frontend. The app is now editor-only; do **not** reintroduce LLM functionality on this branch — if it's needed, add it on the cloud edition instead.
