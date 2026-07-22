# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

doXmind is a **fully-local, Markdown-native knowledge workspace**. Its single Electron desktop shell wraps a Next.js frontend and executes workspace commands in-process; packaged desktop builds do not start or bundle a Python/FastAPI service. FastAPI remains only for browser development and standalone local tooling. There is no auth, no cloud sync, no AI runtime, no telemetry, no billing/sharing — the user's files on disk are the source of truth. Tauri and the former Rust Page core are retired and must not be reintroduced as a second desktop/runtime path.

There is one first-class content type:

- **Page** — one portable `.md` or `.markdown` file edited through source-backed block operations. Markdown is the editor state; normal Page operations do not create or require a same-name `.doxmind` file. Every Page uses the native editor; unsupported structures remain editable as exact raw Markdown. TipTap and ProseMirror runtimes, source imports, and package dependencies are removed. Resolvable local `[[Wiki Links]]` navigate without rewriting the source.

PDF, spreadsheet, HTML, image, and other non-Markdown files are **Attachments**. Their normal workspace is read-only and offers reveal/open-externally actions, not independent create/edit/save stacks. Legacy PDF/Excel sidecars are inspected without writing and can be exported as a Markdown recovery report containing the exact old editor-state JSON. Dedicated attachment editors, create/write/cache endpoints, and Synthetic Document migration writers are physically removed. Preserve source files and the complete legacy artifact family.

Page PDF export is a fully local derived-output pipeline. The renderer waits for the source-backed Page view to settle, Electron generates PDF bytes in-process with `webContents.printToPDF`, and the main process atomically writes the user-selected destination from a native Save dialog. It must not depend on an installed printer/driver or add a Python/FastAPI lifecycle, server HTML-to-PDF path, or PyMuPDF Page-export dependency. Exported PDFs are derived files, not editable Page or Attachment state, and never receive sidecars.

The active product boundary and roadmap live in [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md), [ADR-0011](docs/adr/0011-local-markdown-knowledge-workspace.md), [ADR-0012](docs/adr/0012-markdown-source-block-editor.md), and [ADR-0013](docs/adr/0013-electron-only-desktop-runtime.md).

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Storage Model

The user's filesystem is the source of truth. Each Markdown Page is exactly one portable file. Attachments remain ordinary source files; new Page or Attachment sidecars must not be created.
Legacy Page/PDF/Excel sidecars may still exist. Page and Attachment recovery reports provide explicit read-only export paths, but they do not authorize deletion or mutation of those bytes. Preserve the source plus `.doxmind`, `.bak`, `.lock`, and `.corrupt-*` artifacts as one family. A `<sidecar>.lock` file may appear next to a legacy sidecar; it is tiny, may persist after use, and must not be deleted manually.

```text
~/Documents/notes/
├── Project Plan.md
├── attachments/
│   ├── Q3 Forecast.xlsx
│   └── Spec.pdf
└── assets/
    └── diagram.png
```

Markdown open algorithm:

1. Read the complete raw `.md` source and parse frontmatter/body views.
2. Build source-backed block spans; preserve unsupported syntax as raw blocks.
3. Derive preview/export HTML only when needed. Never hydrate Page state from legacy sidecar HTML.
4. Do not modify an external Markdown file merely because it lacks a frontmatter id.

Markdown save algorithm:

1. Apply block commands to canonical Markdown source.
2. Preserve untouched source bytes and unknown frontmatter.
3. Atomically write only the `.md`/`.markdown` file.

Legacy Page/PDF/Excel sidecars may still exist. Do not delete, overwrite, or strand them. Attachment state remains readable only through zero-write inspection/recovery. Page recovery inventories the complete legacy artifact family and exports each member as exact raw bytes; it never parses legacy HTML/Extras into Page state.

## Environment Variables

All optional:

- `DATA_DIR` — override `~/.doxmind`
- `DOXMIND_PYTHON` — Python path for `npm run dev:all`
- `DEBUG`, `HOST`, `PORT` — backend config; `HOST` accepts loopback addresses only
- `DOXMIND_PERF` — opt-in performance instrumentation. Enabled values (`1`/`true`/`yes`/`on`) make the backend write a JSON line per span to `~/.doxmind/perf.log` (override path with `DOXMIND_PERF_LOG`); the frontend has a parallel flag (`localStorage.DOXMIND_PERF=1` or URL `?perf=1`) that turns on a fixed-position dev overlay. Default off. Caveat: the log file is unbounded and grows by hundreds of bytes per HTTP request — leaving perf on for a multi-hour session can produce many MB. Truncate manually (`> ~/.doxmind/perf.log`) between bench runs; rotation is intentionally not implemented since this is a debug-only path. Aggregate with `node scripts/perf-summary.mjs`.
- `DOXMIND_DISABLE_PDF_CACHE` / `DOXMIND_DISABLE_XLSX_CACHE` — kill switches for the two read-only attachment-parser LRUs in `services/pdf_blocks.py` and `services/excel_workbook.py`. Use during benchmarking or when isolating a stale-cache hypothesis. Default both enabled.

There are no API keys or external service credentials.

## Removed Surface — Do Not Reintroduce

This product intentionally excludes JWT auth, OAuth user login, password reset, email verification, Stripe billing, credits, quotas, sharing links, community publishing, comments, follows, bookmarks, notifications, telemetry, RLHF reporting, S3, Postgres, Redis, Docker deployment, hosted cloud sync, chat, agents, providers, OpenRouter, autocomplete, quick edit, document review, prompts, knowledge-base retrieval, and `markitdown`.

Do not rebuild these by accident. If a feature needs to return, make the product decision explicit and design it around the local desktop IDE model.

Do not add blank PDF/Excel creation, PDF/Excel/HTML editing features, or new attachment sidecar writers. Reading existing legacy state and exporting exact recovery bytes/JSON in a Markdown report are permitted only as recovery. Dedicated PDF/Excel editor modules and write APIs have been deleted; do not recreate or mount them. Retained `pdf_blocks`/`excel_workbook` parsing is read-only CLI/MCP conversion support, not an editor boundary.

Do not add Page sidecar writers or TipTap-only Page semantics. New block behavior must round-trip through canonical Markdown and the native `MarkdownBlockDocument` Interface.

There is no Page sidecar writer or legacy Page HTML reader. `workspace_inspect_page_recovery` and `workspace_read_page_recovery` are isolated raw-byte recovery commands; keep them zero-write and separate from normal Page I/O.

## Commit hygiene

Commits and pull-request descriptions in this repo must read as if a human authored them. Do **not** leave AI attribution anywhere in commit subjects, commit bodies, or PR descriptions. Concretely:

- No `Co-Authored-By: Claude ...` (or any other AI co-author) trailer at the bottom of commit messages.
- No `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer in PR bodies.
- No "Generated by AI", "Authored with Claude / Codex / etc.", or similar markers anywhere in the commit subject, body, or PR description.

Lead the commit message with the *what* and *why* of the change. The body should explain the trade-offs or context a future reader needs; nothing else. PR descriptions follow the same rule — keep summaries factual and let the diff speak.

This rule does **not** apply to triage notes posted as issue comments. The triage workflow explicitly requires a `> *This was generated by AI during triage.*` disclaimer on those comments because triage is an explicitly AI-driven step. The commit-hygiene rule above governs commits and PR descriptions only.

## Agent skills

### Issue tracker

Issues live in GitHub Issues at `doXmind/local-desk` (uses the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root (neither exists yet; created lazily by `/grill-with-docs`). See `docs/agents/domain.md`.
