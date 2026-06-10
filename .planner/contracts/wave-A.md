# Wave A Contract — Canonical outline source + shared provider

> Written by the Planner BEFORE the Worker is dispatched. This file is the
> single source of truth the GAN Critic scores against — not the brief.
> Once dispatched, this file is immutable. If the contract has to change,
> open a new wave (e.g. `wave-A1.md`) — do not edit this one in place.

**Wave:** A
**GitHub issue:** [#109](https://github.com/doXmind/local-desk/issues/109)
**Created:** 2026-05-27T23:10:00Z
**Branch / worktree:** `main` at `/Users/rickielin/Sandbox/doxmind/local-desk`
**Baseline tests at contract time:** 286 passing across 38 files

## Goal

Introduce one editor-scoped canonical source of Markdown heading data (levels 1–6, normalized shape, sorted by ProseMirror position) and refactor the sidebar outline hook to consume it through a React provider, without changing observable sidebar behavior.

## Allowed paths (Worker may create or edit these)

- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/canonical-outline.ts` (NEW — pure data module: `Heading` type, `normalizeFromEditor(editor) → Heading[]`, equality helper)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/use-canonical-outline.ts` (NEW — `useCanonicalOutline()` hook + `OutlineProvider` React context + editor-scoped subscription surface for non-React consumers like the TOC node view)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/use-headings.ts` (MODIFY — refactor to consume `useCanonicalOutline()` and apply the existing level-≤3 filter at the consumer boundary; preserve the hook's public shape so `outline-collapsed.tsx` does not change)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/editor/mindlines/canonical-outline.test.ts` (NEW — unit tests)

Worker may also wire the new provider at whatever site already mounts the markdown editor, IF and only IF that wiring is required to make the existing sidebar tests pass. Add the wire-up to allowed paths and document it in the report.

## Forbidden paths (Worker MUST NOT touch — hard fail if diff shows changes here)

- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/outline-collapsed.tsx` (Wave C scope)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/hover-intent.ts` (no behavioral change in this PRD)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/toc-node-view.tsx` (Wave E scope)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/workspace/browsing-runtime.tsx` (out of scope — browsing runtime untouched)
- `/Users/rickielin/Sandbox/doxmind/local-desk/package.json` (no new dependencies)
- `/Users/rickielin/Sandbox/doxmind/local-desk/CLAUDE.md`, `*.md` docs (no doc changes)
- `/Users/rickielin/Sandbox/doxmind/local-desk/server/**` (frontend-only PRD)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src-tauri/**` (frontend-only PRD)
- Any pre-existing ESLint warning fix in `page-link-node-view.tsx` / `slash-commands.tsx` / `excel-editor-workspace.tsx` (out-of-scope cleanup)

## Out of scope (do not implement, even if tempted)

- Scroll-spy / active-heading detection (Wave B / #111)
- Popover virtualization (Wave C / #112)
- Rail aggregate markers (Wave D / #114)
- Inline TOC migration to the bridge (Wave E / #113)
- Adopting `@tiptap/extension-table-of-contents`
- Any heading offset cache
- IntersectionObserver in the editor path
- Visual / styling changes

## Accept checks (every command must pass; copy verbatim from here when verifying)

```bash
# 1. Lint clean (3 pre-existing warnings tolerated, 0 errors)
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm run lint
# expected: exit code 0, ends with "0 errors" line; warnings count exactly 3 (unchanged)

# 2. Type check clean
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm run type-check
# expected: exit code 0, no output (or only the standard tsc banner)

# 3. New unit tests pass
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run src/__tests__/components/editor/mindlines/canonical-outline.test.ts
# expected: exit code 0, all assertions pass. Must cover:
#   - levels 1-6 included in canonical output (no filtering at the source layer)
#   - output is sorted by .pos
#   - equality guard: re-running normalize on the same document state produces a structurally-equal result that React would not consider a state change (deep-equal by id+level+text+pos)
#   - level filter applied at consumer boundary: useHeadings still returns only level ≤ 3

# 4. Existing mindlines tests stay green
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run src/__tests__/components/editor/mindlines
# expected: exit code 0; hover-intent.test.ts + outline-collapsed.test.tsx all pass

# 5. Full suite pass→pass invariant
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run
# expected: exit code 0; test count ≥ 286 (was 286 at baseline; new canonical-outline tests should push it higher); no previously-green test now failing
```

## Pass→pass invariant

- Full vitest suite (`npm test -- --run`) reports **≥ 286 passing**. Test count may only go UP.
- Lint (`npm run lint`) reports 0 errors. Pre-existing warning count is exactly 3 and unchanged.
- Type check (`npm run type-check`) is clean.
- Diff contains no changes to forbidden paths.

## What "done" looks like (for the GAN Critic)

- All five accept checks above produce the expected results.
- Sidebar outline, viewed in the editor, still shows only level ≤ 3 headings (consumer-boundary filter); but the canonical source exposes 1–6.
- Inline TOC behavior is unchanged at the user-visible level (it still scans the doc itself; its migration is Wave E). Worker MUST NOT touch `toc-node-view.tsx`.
- Warm read→edit runtime switch on the same Markdown file does NOT cause the canonical source to re-extract from scratch. The subscription surface preserves data across the switch when the underlying ProseMirror doc state is unchanged.
- Diff contains only allowed-path changes. No forbidden-path changes.
- Pass→pass invariant holds.

If all six are true, this wave is shippable. Anything else is a defect the Critic must surface.
