# Architecture

This document describes the runtime architecture of doXmind Mini, the local
sidecar edition. It is the entry point for understanding how the editor, the
storage layer, and the desktop shell fit together.

For the migration log that traces how we got here, see
[`MARKDOWN_FIRST_MIGRATION.md`](./MARKDOWN_FIRST_MIGRATION.md). For the product
boundary (what is intentionally excluded), see `README.md` and
`AGENTS.md`.

## Product shape

doXmind Mini is a local-first, single-user desktop document editor. There is
no auth, sync, sharing, billing, telemetry, or AI runtime in this branch.
Documents live on the user's filesystem; the app reads and writes them in
place.

The product surface is intentionally narrow:

- A user opens a folder ("workspace") of Markdown files.
- The editor renders each `.md` as rich content via TipTap.
- Editor-only state (block colors, embedded databases, cached HTML) is
  stored in a hidden `.doxmind` sidecar next to each `.md`.
- Import, OCR, and export run locally with no network calls.

## Source of truth: the dual-file model

Every document is two files on disk:

```text
~/Documents/notes/
├── Project Plan.md          # portable, user-facing Markdown
└── .Project Plan.doxmind    # hidden sidecar with editor HTML + extras
```

The `.md` file is the contract with the outside world. It can be edited in
any editor, synced via Dropbox or git, or read by another tool. It carries
YAML frontmatter for metadata (`id`, `updated_at`).

The `.doxmind` sidecar is JSON and stores:

```json
{
  "version": 1,
  "id": "dfe24100-bb43-4f93-8553-2d9fdcc50172",
  "html": "<p>...</p>",
  "markdown_hash": "sha256:abc123...",
  "updated_at": "2026-04-29T17:38:00Z",
  "extras": { "databases": {} }
}
```

`extras.databases` is the target home for doXmind-only block data
(database blocks, custom block extensions). Anything that does not round-trip
through Markdown belongs here.

### Open

1. Read `.md`, split frontmatter from body.
2. Look for the same-name hidden `.doxmind` sidecar.
3. If absent, import the Markdown into editor HTML.
4. If present and `markdown_hash` matches the body, use `sidecar.html`.
5. If present and the hash differs, treat external Markdown edits as
   authoritative and regenerate the sidecar on next save.

### Save

1. Write `.md` from `editor.getMarkdown()`.
2. Compute the hash of the Markdown just written.
3. Write `.doxmind` with `{ html, markdown_hash, id, extras }`.

The hash is the synchronization primitive. If a third party edits the `.md`
out from under us, the next open detects the divergence and the user's
view follows the file, not a stale sidecar.

## Three-layer architecture

The implementation is split across three layers with strict ownership:

```text
┌───────────────────────────────────────────────────────────┐
│  Frontend: Next.js 15 + React 19 + TipTap + Zustand       │
│  ─ src/                                                   │
└───────────────────────────────────────────────────────────┘
            │                                  │
            │ Tauri command bridge             │ HTTP (browser dev mode)
            ▼                                  ▼
┌─────────────────────────┐     ┌─────────────────────────────┐
│  Tauri shell (Rust)     │     │  FastAPI sidecar (Python)   │
│  ─ src-tauri/           │     │  ─ server/                  │
│  thin wrapper           │     │  workspace/invoke shim,     │
│  over the core crate    │     │  import, OCR, images        │
└─────────────────────────┘     └─────────────────────────────┘
            │                                  │
            └─────────────┬────────────────────┘
                          ▼
       ┌──────────────────────────────────────┐
       │  doxmind-sidecar core (Rust)         │
       │  ─ crates/sidecar/                   │
       │  owns .md + .doxmind I/O,            │
       │  hashing, frontmatter parsing        │
       └──────────────────────────────────────┘
                          │
                          ▼
                    User filesystem
                  (~/Documents/notes/)
```

### `crates/sidecar` — the storage core

The Rust crate `doxmind-sidecar` is the only code that knows how a
`.md + .doxmind` pair is read, hashed, written, and recovered from a partial
write. Its public surface (see `crates/sidecar/src/lib.rs`):

- `read_doc(md_path) -> ReadResult` — splits frontmatter, reads the
  sidecar if present, returns body + `DocMeta` + parsed sidecar JSON.
- `write_doc(md_path, payload)` — atomic write of the pair via
  temporary siblings, ensuring the `.md` and `.doxmind` either both
  update or neither does.
- `sidecar_path_for(md_path)` — canonical sidecar location.
- `hash_markdown(content)` — the SHA-256 used for `markdown_hash`.
- `markdown_to_html(body)` — the import path used when no sidecar exists.

Anything outside this crate that touches `.doxmind` files directly is a
bug. The Tauri shell and FastAPI server are required to call into this
crate (or its mirror) for all document I/O.

### `src-tauri` — the desktop shell

The Tauri app (`src-tauri/src/lib.rs`) exposes the storage core to the
frontend as Tauri commands:

- `doc_read(path)`, `doc_write(path, payload)` — single-file operations.
- `doc_create`, `doc_rename`, `doc_delete` — manage `.md + .doxmind`
  pairs together.
- `workspace_scan(root)`, `workspace_index_rebuild(root)`,
  `workspace_index_read(root)`, `workspace_markdown_search(root, query)`
  — folder-level operations.
- `workspace_default_root()` — default workspace location.

In the desktop build, the frontend talks directly to these commands. The
FastAPI sidecar still runs (for import / OCR / images) but is _not_ on
the document storage path.

### `server/` — the FastAPI sidecar

FastAPI is a localhost service mounted at four routers (see
`server/main.py`):

| Router        | Purpose                                               |
| ------------- | ----------------------------------------------------- |
| `import_file` | Convert PDFs, DOCX, PPTX, scanned images to Markdown. |
| `marker`      | Lifecycle for the optional Marker OCR models.         |
| `images`      | Local image upload and serving.                       |
| `workspace`   | Localhost mirror of the Tauri command surface for     |
|               | browser dev mode (`POST /api/workspace/invoke`).      |

Browser dev mode (`npm run dev`) cannot call Tauri commands, so the
FastAPI workspace router exposes the same command names over HTTP. The
Python implementation in `server/api/workspace.py` performs the same
`.md + .doxmind` operations as the Rust core; the long-term direction is
to have it shell out to the Rust crate or a sidecar binary so there is
exactly one implementation.

What FastAPI no longer does:

- No `files` / `versions` / `export` / `databases` routers — all four
  were removed when the dual-file model became the source of truth.
- No JWT, OAuth, or session middleware.
- No multi-user query layer.

### SQLite, currently

`server/db/database.py` retains a single table — `AppMetadata` — used
for app-level key/value storage (last opened workspace, schema version
sentinel). It is _not_ a document store. There is no Alembic; the table
is created via `Base.metadata.create_all` on startup.

This row of state is a candidate for replacement by
`~/.doxmind/config.json` once the workspace boot path no longer needs
SQLite at all.

## Frontend

Next.js 15 App Router, React 19, TipTap, Zustand, Tailwind. Source under
`src/`.

### Editor entry

`src/app/editor/[[...fileId]]/page.tsx` is the editor route. It dispatches
to `desktop-editor.tsx` or `mobile-editor-layout.tsx` based on the layout
store.

### Stores

Each Zustand store owns a single concern (see `src/stores/`):

| Store                 | Owns                                                 |
| --------------------- | ---------------------------------------------------- |
| `file-store`          | Workspace tree, current document, save lifecycle.    |
| `editor-store`        | Editor instance reference, dirty state, undo state.  |
| `editor-ref-store`    | Imperative editor handle for cross-component calls.  |
| `layout-store`        | Sidebar, focus mode, command palette, mobile gates.  |
| `outline-store`       | Heading outline derived from the current document.   |
| `block-selection`     | Multi-block selection range.                         |
| `database-store`      | Database-block rendering state.                      |
| `appearance-store`    | Theme, font, density.                                |
| `settings-store`      | User settings persisted to `~/.doxmind/config.json`. |
| `marker-store`        | Marker OCR model download / install state.           |
| `folder-import-store` | Folder import progress (shared across surfaces).     |

The boundary rule: stores hold UI and ephemeral state; the on-disk truth
is owned by the Rust core. Stores ask for documents and react to writes;
they never persist editor HTML themselves.

### Editor extensions

TipTap extensions live under `src/extensions/`. Each extension is a
self-contained block or behavior:

- Custom blocks: `callout`, `columns`, `database`, `mermaid`, `math`,
  `code-block`, `toggle`, `toc`, `web-bookmark`, `resizable-image`.
- Editor behaviors: `block-handle`, `block-selection`,
  `inline-comment`, `block-color`, `link-paste`, `page-link`,
  `search`, `trailing-node`, `atom-block-lift`.

Extensions that need to round-trip through Markdown emit / parse fenced
blocks. Extensions that store doXmind-only state (e.g. database blocks)
write to `extras` in the sidecar.

## Import pipeline

`server/services/document_converter.py` routes by extension:

| Format                         | Strategy                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `.pdf` (native text)           | **PyMuPDF4LLM** — fast path, no models. Falls back when avg chars/page < 40.            |
| `.pdf` (scanned / image-heavy) | **Marker** (Surya layout + OCR). Lazy-loaded; uses `TORCH_DEVICE=mps` on Apple Silicon. |
| `.docx`                        | **mammoth** → HTML → markdownify.                                                       |
| `.pptx`                        | **python-pptx** with a custom slide-by-slide markdown emitter.                          |
| `.md` / `.markdown`            | passthrough.                                                                            |

`markitdown` was removed because of OCR and complex-layout quality
issues. Do not reintroduce it.

### Marker model lifecycle

Marker needs ~2 GB of Surya weights from HuggingFace. Models are _not_
bundled. On the first scanned PDF:

1. Backend returns `409 MARKER_MODELS_REQUIRED`.
2. Frontend (`marker-store` + `marker-download-prompt`) shows a confirm
   modal.
3. On accept, frontend POSTs `/api/import/marker/download` and polls
   `/api/import/marker/status` until `installed`.
4. The original import retries automatically.

Install state is recorded at `~/.doxmind/marker-models.json`. Delete
that file to force a re-download.

### Packaging note

`marker-pdf` brings in PyTorch + Surya, which inflates the PyInstaller
bundle. Single-file builds work for development; the macOS `.app` build
will likely move to a directory bundle (or ship a thin venv) to keep
launch latency reasonable.

## Repository layout

```text
local-desk/
├── src/                  Frontend (Next.js, React, Zustand, TipTap)
│   ├── app/              App Router routes
│   ├── components/       UI components and editor surfaces
│   ├── extensions/       TipTap extensions and custom blocks
│   ├── stores/           Zustand stores
│   └── lib/              Utilities (markdown, logger, import-folder)
├── server/               FastAPI sidecar (Python 3.12)
│   ├── api/              Routers: import_file, marker, images, workspace
│   ├── services/         Pure-Python services (converter, storage,
│   │                     export, content sanitizer)
│   ├── db/               SQLite metadata (AppMetadata only)
│   └── main.py           App factory
├── src-tauri/            Tauri desktop shell (Rust)
├── crates/sidecar/       doxmind-sidecar core crate (Rust)
├── scripts/              Local dev / build orchestration (Node)
└── docs/
    ├── ARCHITECTURE.md         (this file)
    └── MARKDOWN_FIRST_MIGRATION.md
```

## Storage ownership at a glance

| Concern                         | Owner                                   |
| ------------------------------- | --------------------------------------- |
| Document Markdown body          | `~/.../Foo.md` (user filesystem)        |
| Editor HTML, sidecar id, extras | `~/.../.Foo.doxmind` (sidecar)          |
| Database-block content          | `extras.databases` in the sidecar       |
| Workspace pointer + settings    | `~/.doxmind/config.json`                |
| Marker model install state      | `~/.doxmind/marker-models.json`         |
| App-level metadata              | `~/.doxmind/doxmind.db` (`AppMetadata`) |
| Imported images                 | Workspace `assets/` folder              |

Anything not in this table should be treated as either a bug or a new
ownership decision that needs to be added here.

## Migration state

The migration to the dual-file model is tracked in
[`MARKDOWN_FIRST_MIGRATION.md`](./MARKDOWN_FIRST_MIGRATION.md). The
high-level state at the time of writing:

- Phases 1–6 (Cargo workspace, Tauri integration, `doc_read`/`doc_write`,
  storage boundary on the frontend, sidecar extras, image path
  rewriting) — landed.
- Phase 7 (delete remaining DB-backed runtime paths) — _partially_ done:
  the `files` / `versions` / `export` / `databases` routers and their
  frontend consumers have been removed; the SQLite `AppMetadata` row
  remains as a small trailing edge.

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
