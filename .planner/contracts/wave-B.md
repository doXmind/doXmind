# Wave B Contract — Position-model active heading resolver

> Written by the Planner BEFORE the Worker is dispatched. This file is the
> single source of truth the GAN Critic scores against — not the brief.
> Once dispatched, this file is immutable. If the contract has to change,
> open a new wave (e.g. `wave-B1.md`) — do not edit this one in place.

**Wave:** B
**GitHub issue:** [#111](https://github.com/doXmind/local-desk/issues/111)
**Created:** 2026-05-28T00:30:00Z
**Branch / worktree:** `main` at `/Users/rickielin/Sandbox/doxmind/local-desk`
**Baseline tests at contract time:** 302 passing across 39 files (Wave A landed clean)

## Goal

Replace the per-heading `getBoundingClientRect` scroll-spy in `use-headings.ts` with a ProseMirror-position-based active resolver (`editor.view.posAtCoords()` + binary search over the canonical heading list) so active-detection cost on scroll is O(1) + O(log N) rather than O(N) in heading count, while preserving the public hook shape and all existing test invariants.

## Allowed paths (Worker may create or edit these)

- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/active-resolver.ts` (NEW — pure module exporting `findActiveByPosition(headings: Heading[], probePos: number, previousActiveId: string | null): string | null` using binary search; testable without a browser)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/use-headings.ts` (MODIFY — replace the scroll-spy `useEffect` (currently lines 36-86) with a new `useEffect` that uses `editor.view.posAtCoords()` for a single viewport probe, calls `findActiveByPosition()`, and is scheduled via `requestAnimationFrame`; preserve the public hook shape `{ headings, activeId, navigateTo }` exactly)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/editor/mindlines/active-resolver.test.ts` (NEW — pure-module unit tests covering binary-search edge cases AND a hook-level integration test asserting scroll triggers RAF-scheduled active updates without per-heading `getBoundingClientRect` calls)

## Forbidden paths (Worker MUST NOT touch — hard fail if diff shows changes here)

- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/canonical-outline.ts` (Wave A landed; pure data module is locked)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/use-canonical-outline.ts` (Wave A landed; subscription surface is locked)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/outline-collapsed.tsx` (Wave C scope)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/hover-intent.ts` (untouched per PRD)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/toc-node-view.tsx` (Wave E scope)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/workspace/browsing-runtime.tsx` (out of scope — browsing runtime untouched)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/app/editor/[[...fileId]]/_components/desktop-editor.tsx` (Wave A wired the provider here; do NOT modify)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/editor/mindlines/canonical-outline.test.ts` (Wave A test file; do NOT modify)
- `/Users/rickielin/Sandbox/doxmind/local-desk/package.json` (no new dependencies)
- `/Users/rickielin/Sandbox/doxmind/local-desk/CLAUDE.md`, any `*.md` doc (no doc changes)
- `/Users/rickielin/Sandbox/doxmind/local-desk/server/**`, `/Users/rickielin/Sandbox/doxmind/local-desk/src-tauri/**` (frontend-only PRD)
- Pre-existing ESLint warning fix in `page-link-node-view.tsx` / `slash-commands.tsx` / `excel-editor-workspace.tsx` (out-of-scope cleanup)

## Out of scope (do not implement, even if tempted)

- Multi-point coordinate sampling (PRD defers this; gated on later measurement of miss rate)
- `IntersectionObserver` in the editor path (PRD forbids)
- Heading offset cache (PRD forbids)
- Touching canonical-outline / use-canonical-outline (Wave A complete)
- Touching outline-collapsed / toc-node-view (Wave C / E scopes)
- Visual or styling changes

## Accept checks (every command must pass; copy verbatim when verifying)

```bash
# 1. Lint clean (3 pre-existing warnings tolerated, 0 errors)
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm run lint
# expected: exit 0, ends with "0 errors" line; warnings count exactly 3 (unchanged)

# 2. Type check clean
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm run type-check
# expected: exit 0, no output

# 3. Pure-module unit tests pass
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run src/__tests__/components/editor/mindlines/active-resolver.test.ts
# expected: exit 0; must cover:
#   - empty heading list → null
#   - probe before first heading → null
#   - probe at exact heading position → that heading id
#   - probe between two headings → the previous (lower-pos) heading id
#   - probe after last heading → last heading id
#   - keep-previous fallback: when probePos is undefined / NaN AND previousActiveId is set, return previousActiveId
#   - keep-previous fallback: when previousActiveId is null and probe yields null, return null (do NOT fall back to first heading except when there is no previous active)
#   - binary search correctness on a 100+ heading mock list (no linear scan visible in implementation)

# 4. Hook-level scroll-spy test passes — explicit per the Wave A BQ insight
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run src/__tests__/components/editor/mindlines/active-resolver.test.ts
# expected: exit 0; the same test file must include at least one hook-level test that:
#   - mounts useHeadings(editor) with a mock editor that supplies a canonical heading list
#   - simulates a scroll event on the editor's scroll parent
#   - asserts that posAtCoords is called once per RAF tick (use a spy)
#   - asserts that nodeDOM / getBoundingClientRect are NOT called for any heading during scroll active-detection
#   - asserts activeId updates to match what findActiveByPosition would return

# 5. Existing mindlines tests stay green
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run src/__tests__/components/editor/mindlines
# expected: exit 0; canonical-outline 16/16 + hover-intent 4/4 + outline-collapsed 6/6 + new active-resolver tests; total should rise above 26

# 6. Full suite pass→pass invariant
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run
# expected: exit 0; ≥ 302 passing (was 302 at Wave A end; new active-resolver tests push it higher); no previously-green test now failing

# 7. Diff scope check
cd /Users/rickielin/Sandbox/doxmind/local-desk && git diff --name-only
# expected: tracked modifications include `src/components/editor/mindlines/use-headings.ts` and may include the new files via `??` in `git status`. NO modifications to forbidden-path files. NO modifications to package.json beyond what was already in the tree (Wave F1's `gen:outline-stress` entry).
```

## Pass→pass invariant

- Full vitest suite (`npm test -- --run`) reports **≥ 302 passing**. Test count may only go UP.
- Lint (`npm run lint`) reports 0 errors. Pre-existing warning count is exactly 3 and unchanged.
- Type check (`npm run type-check`) is clean.
- `useHeadings(editor)` public shape unchanged: returns `{ headings, activeId, navigateTo }` with the same value types.
- `navigateTo` (lines 88-124 currently) is unchanged in behavior — it may use `nodeDOM` for jump-target scrolling; that's a one-shot click handler, NOT a scroll listener, and is explicitly allowed to keep using `getBoundingClientRect`.
- No `getBoundingClientRect` calls on heading DOM nodes anywhere in the scroll-spy active-detection path.

## What "done" looks like (for the GAN Critic)

- All seven accept checks above produce the expected results.
- The scroll-spy `useEffect` in `use-headings.ts` no longer iterates `headings` calling `editor.view.nodeDOM()` / `getBoundingClientRect()` per heading. It samples one viewport probe coordinate, calls `editor.view.posAtCoords()`, and resolves the active heading via the pure `findActiveByPosition()` module.
- `findActiveByPosition` uses binary search (`O(log N)`), not a linear scan. The GAN Critic should verify by reading the implementation.
- When `posAtCoords` returns null, the previous active heading is preserved (only fall back to first heading when there is no previous active).
- Scroll handler is RAF-scheduled. No work on every scroll event.
- Diff contains only allowed-path changes. No forbidden-path changes.
- `useHeadings(editor)` public shape preserved.
- Pass→pass invariant holds.

If all eight are true, this wave is shippable. Anything else is a defect the Critic must surface.
