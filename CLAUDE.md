# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

doXmind is a **fully-local, Markdown-native knowledge workspace**. It is a desktop shell wrapping a Next.js frontend and a localhost FastAPI sidecar. There is no auth, no cloud sync, no AI runtime, no telemetry, no billing/sharing — the user's files on disk are the source of truth.

There is one first-class content type:

- **Page** — a rich TipTap editor backed by a portable `.md` or `.markdown` file. A hidden same-name `.doxmind` sidecar stores lossless editor HTML, caches, and replaceable UI state; it must not be the only copy of user-authored knowledge.

Workspace scanning and native opening currently recognize PDF, spreadsheet (`.xlsx`, `.xlsm`, `.csv`), and HTML files as **Attachments**. They may be previewed, referenced, searched, revealed, or opened externally, but they do not get independent create/edit/save product stacks. The `other` discriminator is only a safe read-only fallback if an unknown format reaches the shared surface; it does not promise that arbitrary files are scanned, listed, or registered for native opening. Images inserted into Pages remain local Markdown assets rather than standalone workspace documents. Existing PDF/Excel editor code is frozen legacy machinery; sidecars and recovery artifacts remain user evidence after every unverified recovery attempt. Until the recovery gate passes, Attachment sidebar actions are limited to Open Externally and Reveal; do not add move, rename, delete, or replace flows that could strand evidence. Do not expand the editors or delete the evidence.

The active product boundary and roadmap live in [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md) and [ADR-0012](docs/adr/0012-local-markdown-knowledge-workspace.md).

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

The user's filesystem is the source of truth. Each Markdown Page is represented by the portable file plus a hidden sidecar holding doXmind-only state. Attachments remain ordinary source files; new attachment editor state must not be created.
A `<sidecar>.lock` file appears next to each sidecar during migration; these files are tiny, persist after use, and must not be deleted manually.

```text
~/Documents/notes/
├── Project Plan.md
├── .Project Plan.doxmind          # markdown sidecar (HTML + extras)
├── attachments/
│   ├── Q3 Forecast.xlsx
│   └── Spec.pdf
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
  "extras": {}
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

Legacy PDF/Excel sidecars may still exist. Do not delete, overwrite, or strand them; their schemas remain readable only for compatibility and recovery until the ADR-0012 removal gate is complete.

## Environment Variables

All optional:

- `DATA_DIR` — override `~/.doxmind`
- `DOXMIND_PYTHON` — Python path for `npm run dev:all`
- `DEBUG`, `HOST`, `PORT` — backend config
- `DOXMIND_SIDECAR_MIGRATE` — controls only the frozen Synthetic Document migration stack if a deprecated PDF/Excel reader is called directly. Normal Attachment open and the current recovery bridge never invoke it and never write the source, sidecar, `.bak`, or `.lock`. Default on inside that frozen stack; accepted values are `1`/`true`/`yes`/`on` and `0`/`false`/`no`/`off`. See [docs/adr/0003-explicit-sidecar-migration.md](docs/adr/0003-explicit-sidecar-migration.md).
- `DOXMIND_PERF` — opt-in performance instrumentation. Enabled values (`1`/`true`/`yes`/`on`) make the backend write a JSON line per span to `~/.doxmind/perf.log` (override path with `DOXMIND_PERF_LOG`); the frontend has a parallel flag (`localStorage.DOXMIND_PERF=1` or URL `?perf=1`) that turns on a fixed-position dev overlay. Default off. Caveat: the log file is unbounded and grows by hundreds of bytes per HTTP request — leaving perf on for a multi-hour session can produce many MB. Truncate manually (`> ~/.doxmind/perf.log`) between bench runs; rotation is intentionally not implemented since this is a debug-only path. Aggregate with `node scripts/perf-summary.mjs`.
- `DOXMIND_DISABLE_DOC_CACHE` / `DOXMIND_DISABLE_PDF_CACHE` / `DOXMIND_DISABLE_XLSX_CACHE` — kill switches for the three backend process-local LRUs in `services/markdown_document_state.py`, `services/pdf_blocks.py`, and `services/excel_workbook.py`. Use during benchmarking or when isolating a stale-cache hypothesis. Default all enabled.

There are no API keys or external service credentials.

## Removed Surface — Do Not Reintroduce

This product intentionally excludes JWT auth, OAuth user login, password reset, email verification, Stripe billing, credits, quotas, sharing links, community publishing, comments, follows, bookmarks, notifications, telemetry, RLHF reporting, S3, Postgres, Redis, Docker deployment, hosted cloud sync, chat, agents, providers, OpenRouter, autocomplete, quick edit, document review, prompts, knowledge-base retrieval, `markitdown`, and Notion-style database blocks (removed July 2026; legacy `extras.databases` sidecar data is passed through untouched, never rendered).

Do not rebuild these by accident. If a feature needs to return, make the product decision explicit and design it around the local desktop IDE model.

Do not add blank PDF/Excel creation, PDF/Excel/HTML editing features, or new attachment sidecar writers. Reading and exporting existing legacy state is permitted only as a recovery path.

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
