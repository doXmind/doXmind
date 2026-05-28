# Wave C Contract — Virtualized outline popover

> Written by the Planner BEFORE the Worker is dispatched. This file is the
> single source of truth the GAN Critic scores against — not the brief.
> Once dispatched, this file is immutable. If the contract has to change,
> open a new wave (e.g. `wave-C1.md`) — do not edit this one in place.

**Wave:** C
**GitHub issue:** [#112](https://github.com/doXmind/local-desk/issues/112)
**Created:** 2026-05-28T00:30:00Z
**Branch / worktree:** `main` at `/Users/rickielin/Sandbox/doxmind/local-desk`
**Baseline tests at contract time:** 302 passing across 39 files (Wave A landed clean)

## Goal

Replace the eager `.map(...)` row rendering in the expanded outline popover with `@tanstack/react-virtual` (already a project dependency) so mounted row DOM count is bounded regardless of heading count, while preserving the rail↔popover hover-intent contract and the existing `outline-collapsed.test.tsx` behavior verbatim.

## Allowed paths (Worker may create or edit these)

- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/outline-collapsed.tsx` (MODIFY — replace the popover row `.map(...)` with `useVirtualizer` from `@tanstack/react-virtual`; on initial popover open with `activeId` set, call `rowVirtualizer.scrollToIndex(activeIndex, { align: 'center' })` — NOT `scrollIntoView` on a queried DOM node)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/editor/mindlines/outline-collapsed-virtual.test.tsx` (NEW — virtualization-specific tests covering: mounted row count bound, rail-to-popover pointer movement after virtualization, active-row scroll-to-index on open)

If the existing `outline-collapsed.test.tsx` requires a tiny adjustment to _coexist_ with virtualization (e.g., DOM-query selectors that broke due to virtual scrollers wrapping content), the Worker MAY make the minimum necessary change to keep those tests green — but the _behavior_ assertions in the existing tests MUST NOT be relaxed or removed. If you find yourself wanting to remove a test, that's a scope violation.

## Forbidden paths (Worker MUST NOT touch — hard fail if diff shows changes here)

- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/canonical-outline.ts` (Wave A landed)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/use-canonical-outline.ts` (Wave A landed)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/use-headings.ts` (Wave A + Wave B territory)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/hover-intent.ts` (PRD locks hover-intent contract)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/editor/mindlines/hover-intent.test.ts` (existing tests must stay green AS-IS; do NOT edit)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/toc-node-view.tsx` (Wave E scope)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/workspace/browsing-runtime.tsx`
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/app/editor/[[...fileId]]/_components/desktop-editor.tsx` (Wave A wired the provider; do NOT modify)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/editor/mindlines/canonical-outline.test.ts` (Wave A test file)
- `/Users/rickielin/Sandbox/doxmind/local-desk/package.json` (no new dependencies — `@tanstack/react-virtual@3.13` is already in the tree)
- `/Users/rickielin/Sandbox/doxmind/local-desk/CLAUDE.md`, any `*.md` doc
- `/Users/rickielin/Sandbox/doxmind/local-desk/server/**`, `/Users/rickielin/Sandbox/doxmind/local-desk/src-tauri/**`
- Pre-existing ESLint warning fixes

## Out of scope (do not implement, even if tempted)

- Collapsed rail aggregate markers (Wave D — separate ticket, same file but different concern)
- Active-state changes (Wave B owns scroll-spy; C consumes whatever `activeId` `useHeadings` returns)
- Hover-intent geometry changes (PRD-locked)
- Rail width (`MINDLINES_WIDTH`) or popover dimensions (260 px × ≤ 640 px) changes
- Framer Motion replacement
- New dependencies — `@tanstack/react-virtual` is already in `package.json`

## Accept checks (every command must pass)

```bash
# 1. Lint clean
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm run lint
# expected: 0 errors, exactly 3 unchanged warnings

# 2. Type check clean
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm run type-check
# expected: exit 0, no output

# 3. Existing outline-collapsed tests stay green — verbatim, no behavior assertion relaxed
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run src/__tests__/components/editor/mindlines/outline-collapsed.test.tsx
# expected: exit 0; all 6 existing tests pass

# 4. Existing hover-intent tests stay green
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run src/__tests__/components/editor/mindlines/hover-intent.test.ts
# expected: exit 0; all 4 existing tests pass

# 5. New virtualization tests pass — DOM-level invariants
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run src/__tests__/components/editor/mindlines/outline-collapsed-virtual.test.tsx
# expected: exit 0; must cover:
#   - mounted-row DOM count ≤ 30 (visible + overscan) for a synthetic 200-heading mock outline
#   - on initial popover open with activeId set, the virtualizer's scrollToIndex API is called (use a spy or mock) — NOT scrollIntoView on a DOM node
#   - rail-to-popover pointer transition: hover-intent safe-area corridor still prevents flicker when the popover internally scrolls (re-test the existing flicker scenarios but with a virtualized popover)

# 6. Mindlines suite all green
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run src/__tests__/components/editor/mindlines
# expected: exit 0; total count rises above current 26

# 7. Full suite pass→pass invariant
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run
# expected: exit 0; ≥ 302 passing

# 8. Diff scope check
cd /Users/rickielin/Sandbox/doxmind/local-desk && git diff --name-only
# expected: tracked modifications include `outline-collapsed.tsx`; new file appears in `git status` via `??`. NO modifications to forbidden-path files. NO modifications to `package.json` beyond Wave F1's pre-existing entry.

# 9. Visual sanity — no broken popover dimensions
cd /Users/rickielin/Sandbox/doxmind/local-desk && grep -c '260\|640' src/components/editor/mindlines/outline-collapsed.tsx
# expected: ≥ 2 (the 260 px width and 640 px max-height constants are still referenced in the file; do NOT remove them)
```

## Pass→pass invariant

- Full vitest suite (`npm test -- --run`) reports **≥ 302 passing**. Test count may only go UP.
- Lint (`npm run lint`) reports 0 errors. 3 unchanged warnings.
- Type check clean.
- The 6 existing outline-collapsed.test.tsx tests + 4 existing hover-intent.test.ts tests pass without modification.
- Popover renders rows via `useVirtualizer`. Mounted row DOM count is bounded.
- Active row is brought into view via `scrollToIndex` (index-based), not via DOM-query + `scrollIntoView`.
- Hover-intent safe-area polygon behavior is unchanged for the user.
- Popover dimensions (260 × ≤ 640 px) preserved.

## What "done" looks like (for the GAN Critic)

- All 9 accept checks pass.
- `outline-collapsed.tsx` uses `useVirtualizer` from `@tanstack/react-virtual` for popover row rendering. Estimated row height: 28 px (current value in the file). Overscan: 6 (reasonable default; worker may use 4-8).
- On initial popover open with `activeId` non-null, `rowVirtualizer.scrollToIndex(activeIndex, { align: 'center' })` is called once. No `scrollIntoView` on a queried DOM node.
- Hover-intent contract preserved: pointer can move from rail to popover without flicker, with or without internal popover scrolling. Existing hover-intent tests are unmodified and green.
- The 6 existing `outline-collapsed.test.tsx` tests are either unmodified OR have only minimal selector adjustments (no behavior assertion relaxed/removed).
- No new dependencies. No forbidden-path changes. Pass→pass invariant holds.

If all four are true, this wave is shippable. Anything else is a defect the Critic must surface.
