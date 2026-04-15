# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

doXmind Mini is a **local-first, single-user** AI writing assistant ("Cursor for Writing"). It pairs a TipTap-based WYSIWYG editor with an OpenRouter-powered AI agent — chat, quick edits, autocomplete, document review, and a knowledge base — all running on the user's own machine. There is no auth, no cloud sync, no sharing, no billing. All data lives in `~/.doxmind/`.

## Tech Stack

- **Frontend:** Next.js 15 (App Router), React 19, TipTap, Zustand, Tailwind CSS
- **Backend:** FastAPI, Python 3.12, SQLAlchemy 2.0 (async)
- **Database:** SQLite (single file at `~/.doxmind/doxmind.db`)
- **LLM:** OpenRouter (OpenAI-compatible client) — user supplies their key in the in-app Settings page

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
3. Open the Settings page (`/settings`) and paste your OpenRouter API key. It's persisted to `~/.doxmind/config.json`.
4. Start writing. Chat / autocomplete / quick edits will use that key automatically.

## Architecture

### Local data directory

Everything user-owned lives under `~/.doxmind/`:

- `doxmind.db` — SQLite database (files, conversations, messages, KB attachments, database blocks)
- `config.json` — User-supplied API keys and feature toggles (managed via `/settings`)
- `uploads/` — Local image uploads (cover images, inline images)

The `DATA_DIR` environment variable can override this path.

### Frontend Structure

- **Stores** (`src/stores/`): Zustand global state — files, chat, editor, KB, layout, API settings.
- **Hooks** (`src/hooks/`): Business logic encapsulation (chat streaming, edit operations, autocomplete, diff review).
- **Extensions** (`src/extensions/`): Custom TipTap extensions (diff-review, search, autocomplete, spellcheck).

Stub modules in `src/stores/{auth-store,billing-store,notification-store,demo-store}.ts` exist purely so legacy components keep compiling — they always report a single fixed local user with no quotas.

Entry point: `src/app/editor/[[...fileId]]/page.tsx` (the root `/` redirects here).

### Backend Structure

- **API routes** (`server/api/`): Thin FastAPI routers handling HTTP.
- **Services** (`server/services/`): LLM, export, file conversion, etc.
  - `local_config.py` — read/write `~/.doxmind/config.json`
  - `auth_service.py`, `credit_service.py`, `usage_tracker.py`, `storage_tracker.py`, `api_key_service.py`, `middleware/rate_limit.py` — **stubs** that preserve old call signatures (no auth, unlimited credits, no quota tracking)
- **Agents** (`server/agents/`): Writing agent / KB agent / global agent. They call OpenRouter via the OpenAI-compatible client; the API key is resolved in this order: explicit arg → env var (`OPENROUTER_API_KEY`) → `local_config.json`.
- **Database** (`server/db/database.py`): SQLAlchemy models. `init_db()` runs `create_all` against SQLite — no Alembic.

Entry point: `server/main.py`. The lifespan handler creates `~/.doxmind/` and the SQLite file on first boot.

### AI Integration

- **Chat streaming:** Server-Sent Events (SSE) via FastAPI.
- **Tool system:** Document tools (`str_replace`, `insert`, `replace_all`), KB tools (`search_documents`, `read_document`), web search (Serper, optional), code execution (optional, off by default).
- **Models:** Configured in `server/config.py` and overridable per-request via the user's `preferred_model` in local_config.

## Database

There is no Alembic. Schema is defined in `server/db/database.py` and applied with `Base.metadata.create_all` on startup. To change the schema:

1. Edit the model in `server/db/database.py`.
2. Delete `~/.doxmind/doxmind.db` (or migrate by hand) — single-user local app, your call.
3. Restart the server.

The `user_id` columns on `File`, `Conversation`, and `DatabaseBlock` are kept as plain (non-FK) strings defaulting to `"local"` purely to keep legacy queries compatible.

## Environment Variables

Everything is optional; the GUI settings page is the canonical source.

- `OPENROUTER_API_KEY` — fallback if the GUI doesn't have one
- `SERPER_API_KEY` — optional, enables web search tool
- `DATA_DIR` — override `~/.doxmind`
- `DEBUG`, `HOST`, `PORT`

## Code Quality

- **Pre-commit hooks:** ESLint + Prettier via Husky
- **Frontend:** TypeScript strict mode, `@/*` path aliases
- **Backend:** Ruff (line length 100, double quotes)

## API Documentation

The backend always exposes:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## What was removed

This is the local desktop edition. The following SaaS features have been stripped from the codebase: authentication (JWT, OAuth, password reset, email verification), Stripe billing, credits / usage quotas, document sharing, community feed, comments, follows / bookmarks, notifications, telemetry / RLHF reporting, AWS S3 storage, Notion / Google Drive OAuth import, Postgres, Redis, Docker, Heroku release config, all multi-user data isolation. Don't try to reintroduce any of these without explicit instructions — and if you do, do it through the cloud edition rather than this branch.
