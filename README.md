# doXmind Mini

Local sidecar edition of doXmind: a single-user desktop document editor built around clean Markdown files plus hidden sidecar metadata.

## Product Shape

doXmind Mini is an offline-first writing workspace. The visible document should stay as a normal `.md` file that works in Git, VS Code, Typora, iCloud, and any plain Markdown tool. doXmind-specific fidelity lives next to it in a hidden `.doxmind` sidecar file.

There is no authentication, cloud sync, sharing, community feed, billing, credits, telemetry, or AI runtime in this branch. The backend binds to localhost and exists as a local sidecar for file IO, import/export, versions, images, and editor data.

## Target Storage Model

```text
~/Documents/notes/
├── Project Plan.md
├── .Project Plan.doxmind
└── assets/
    └── diagram.png
```

The Markdown file is the portable facade. The sidecar is the lossless doXmind state:

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

`markdown_hash` decides freshness. If the `.md` hash matches, doXmind opens `sidecar.html` and preserves rich editor-only features. If the hash differs, the user changed Markdown outside doXmind, so the `.md` wins and the sidecar is regenerated on the next save.

## Current Runtime

The sidecar storage layer is the direction of travel, but the current checked-in runtime still uses SQLite for documents, versions, and database blocks. Keep API code store-oriented while migrating so `.md + .doxmind` does not get hard-coded into route handlers.

Planned storage ownership:

- Documents: clean Markdown file plus hidden `.doxmind` sidecar.
- Rich HTML: sidecar `html`.
- Database blocks: sidecar `extras.databases` as the source of truth.
- SQLite: runtime cache and compatibility during migration, not the long-term source of truth for user documents.

## Tech Stack

- Frontend: Next.js 15 App Router, React 19, TipTap, Zustand, Tailwind CSS
- Backend: FastAPI, Python 3.12, SQLAlchemy 2.0 async
- Current database: local SQLite at `~/.doxmind/doxmind.db`
- Desktop shell: Tauri
- External services: none

## Development

```bash
npm run dev:all       # frontend + backend with auto-port discovery
npm run dev           # Next.js only
npm run server        # FastAPI only
npm run build
npm run lint
npm run type-check
npm test
```

Backend commands from `server/`:

```bash
python main.py
pytest
ruff check .
ruff format .
```

First run:

1. `npm run dev:all`
2. Open `http://localhost:3000`
3. Start writing. There is no sign-in or API key setup.

## Backend API

`server/main.py` currently mounts:

- `files` — local document CRUD
- `versions` — local version snapshots
- `export` — Markdown / HTML / PDF / DOCX export
- `import_file` — import PDF / DOCX / PPTX / XLSX / Markdown through local conversion
- `images` — local image upload and serving from `~/.doxmind/uploads/`
- `databases` — database-block CRUD while sidecar storage is being introduced

Swagger and ReDoc are available at `http://localhost:8000/docs` and `http://localhost:8000/redoc` in development.

## Removed Surface

Do not reintroduce the SaaS or AI product surface on this branch without an explicit decision. Removed or intentionally absent areas include JWT auth, OAuth user login, Stripe billing, credits, quotas, sharing links, community publishing, comments, follows, bookmarks, notifications, telemetry, RLHF feedback, S3, Postgres, Redis, Docker deployment, hosted cloud sync, chat, agents, providers, OpenRouter, autocomplete, quick edit, document review, prompts, and knowledge-base retrieval.

If any of these return later, they should be rebuilt deliberately around the local sidecar architecture or developed on a separate cloud edition branch.
