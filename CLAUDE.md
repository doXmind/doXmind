# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

doXmind is a **fully-local desktop IDE** for documents. It is a Tauri shell wrapping a Next.js frontend and a localhost FastAPI sidecar. There is no auth, no cloud sync, no AI runtime, no telemetry, no billing/sharing — the user's files on disk are the source of truth.

Three document types are first-class citizens:

- **Markdown** — rich TipTap editor with custom blocks (math, mermaid, callouts, databases, …). Persisted as a portable `.md` file plus a hidden same-name `.doxmind` sidecar that stores the lossless editor HTML and doXmind-only extras.
- **PDF** — block-based annotation/edit surface. Editor state lives in a hidden sidecar next to the original PDF.
- **Excel** — workbook editor with formulas, filters, autofill, formatting, and structural row/col ops. Editor state lives in a hidden sidecar next to the original `.xlsx`.

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

## Environment Variables

All optional:

- `DATA_DIR` — override `~/.doxmind`
- `DOXMIND_PYTHON` — Python path for `npm run dev:all`
- `DEBUG`, `HOST`, `PORT` — backend config
- `DOXMIND_SIDECAR_MIGRATE` — controls one-shot migration of legacy PDF/Excel sidecars (`{pdf_editor, excel_editor, …}` shape) to the markdown sidecar shape on first open. Default on. Accepted enabled values: `1`/`true`/`yes`/`on`. Accepted disabled values: `0`/`false`/`no`/`off`; disabled mode opens legacy sidecars read-only and any save raises `ReadOnlyDocumentError`. Migration writes the original sidecar to `<sidecar>.bak` before rewriting; recovery is `mv .foo.doxmind.bak .foo.doxmind`. See [docs/adr/0003-explicit-sidecar-migration.md](docs/adr/0003-explicit-sidecar-migration.md).
- `DOXMIND_PERF` — opt-in performance instrumentation. Enabled values (`1`/`true`/`yes`/`on`) make the backend write a JSON line per span to `~/.doxmind/perf.log` (override path with `DOXMIND_PERF_LOG`); the frontend has a parallel flag (`localStorage.DOXMIND_PERF=1` or URL `?perf=1`) that turns on a fixed-position dev overlay. Default off. Caveat: the log file is unbounded and grows by hundreds of bytes per HTTP request — leaving perf on for a multi-hour session can produce many MB. Truncate manually (`> ~/.doxmind/perf.log`) between bench runs; rotation is intentionally not implemented since this is a debug-only path. Aggregate with `node scripts/perf-summary.mjs`.
- `DOXMIND_DISABLE_DOC_CACHE` / `DOXMIND_DISABLE_PDF_CACHE` / `DOXMIND_DISABLE_XLSX_CACHE` — kill switches for the three backend process-local LRUs in `services/markdown_document_state.py`, `services/pdf_blocks.py`, and `services/excel_workbook.py`. Use during benchmarking or when isolating a stale-cache hypothesis. Default all enabled.

There are no API keys or external service credentials.

## Removed Surface — Do Not Reintroduce

This product intentionally excludes JWT auth, OAuth user login, password reset, email verification, Stripe billing, credits, quotas, sharing links, community publishing, comments, follows, bookmarks, notifications, telemetry, RLHF reporting, S3, Postgres, Redis, Docker deployment, hosted cloud sync, chat, agents, providers, OpenRouter, autocomplete, quick edit, document review, prompts, knowledge-base retrieval, and `markitdown`.

Do not rebuild these by accident. If a feature needs to return, make the product decision explicit and design it around the local desktop IDE model.

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
