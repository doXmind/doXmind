# Wave D Contract — Collapsed rail aggregate markers (equal-position bucketing)

> Written by the Planner BEFORE the Worker is dispatched. This file is the
> single source of truth the GAN Critic scores against — not the brief.
> Once dispatched, this file is immutable. If the contract has to change,
> open a new wave (e.g. `wave-D1.md`) — do not edit this one in place.

**Wave:** D
**GitHub issue:** [#114](https://github.com/doXmind/local-desk/issues/114)
**Created:** 2026-05-28T00:52:00Z
**Branch / worktree:** `main` at `/Users/rickielin/Sandbox/doxmind/local-desk`
**Baseline tests at contract time:** 323 passing across 42 files (Waves A, B, C, E, F1 landed clean)
**Algorithm choice (PM-decided, locked on issue #114):** equal-position bucketing.

## Goal

Replace the one-marker-per-heading rendering on the collapsed outline rail with a bounded set of aggregate markers (target ≤ 120 marker DOM nodes), using equal-position bucketing: divide the document position range `[firstHeadingPos, lastHeadingPos]` into `maxMarkers` equal buckets and render one marker per non-empty bucket. The active heading's bucket is replaced by the heading's own marker so the active row stays exact.

## Allowed paths (Worker may create or edit these)

- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/aggregate-markers.ts` (NEW — pure module exporting a function `aggregateMarkers(headings: Heading[], activeId: string | null, maxMarkers: number) → Marker[]` that implements equal-position bucketing per the algorithm spec below; testable without a browser; no React, no TipTap, no DOM imports)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/outline-collapsed.tsx` (MODIFY — replace one-marker-per-heading rendering on the COLLAPSED RAIL ONLY with `aggregateMarkers(...).map(...)`; do NOT touch popover code or its `useVirtualizer` setup from Wave C; preserve `MINDLINES_WIDTH` and rail width; preserve hover-intent integration)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/editor/mindlines/aggregate-markers.test.ts` (NEW — pure-module unit tests covering: empty input, sub-cap input (no aggregation, one marker per heading), over-cap input (exactly `maxMarkers` markers when buckets are dense, fewer when buckets are sparse — but ALWAYS ≤ maxMarkers), active heading always represented exactly (not aggregated into a bucket marker), stable output ordering)

## Forbidden paths (Worker MUST NOT touch — hard fail if diff shows changes here)

- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/canonical-outline.ts` (Wave A landed)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/use-canonical-outline.ts` (Wave A landed)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/use-headings.ts` (Wave A + Wave B landed)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/active-resolver.ts` (Wave B landed)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/hover-intent.ts` (untouched per PRD)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/toc-node-view.tsx` (Wave E landed)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/workspace/browsing-runtime.tsx`
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/app/editor/[[...fileId]]/_components/desktop-editor.tsx` (Wave A wired the provider; do NOT modify)
- All existing test files in `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/editor/mindlines/` EXCEPT the new `aggregate-markers.test.ts`. Specifically: `canonical-outline.test.ts`, `hover-intent.test.ts`, `outline-collapsed.test.tsx`, `outline-collapsed-virtual.test.tsx`, `active-resolver.test.ts` are all forbidden.
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/editor/toc-node-view.test.tsx` (Wave E)
- `/Users/rickielin/Sandbox/doxmind/local-desk/package.json` (no new dependencies)
- `/Users/rickielin/Sandbox/doxmind/local-desk/CLAUDE.md`, any `*.md` doc
- `/Users/rickielin/Sandbox/doxmind/local-desk/server/**`, `/Users/rickielin/Sandbox/doxmind/local-desk/src-tauri/**`
- Pre-existing ESLint warning fixes

### Special note on `outline-collapsed.tsx`

This file is shared with Wave C. Your edits must be confined to **the rail-rendering code path** (the JSX block that maps the sidebar's `headings` list to individual `<button>` or `<div>` marker elements in the collapsed-state rail). Do NOT touch:

- The `useVirtualizer` setup, `getVirtualItems` mapping, or `rowVirtualizer` ref — those are Wave C's popover code.
- The `scrollToIndex` effect or `prevPopoverMountedRef` — Wave C's scroll-on-open behavior.
- The popover dimensions (260 × 640 constants).
- The Framer Motion enter/exit transitions.
- The hover-intent integration / safe-area polygon coordinate computation.

If you find yourself rewriting any of the above to "make the rail work", STOP and report it as a question.

## Out of scope (do not implement, even if tempted)

- Level-weighted sampling (PM decided equal-position; option (b) explicitly rejected)
- Reservoir sampling (option (c) explicitly rejected)
- Multiple active heading markers
- Visual style changes (marker color, size, hover effect) beyond what's structurally required by the aggregate vs one-per-heading swap
- Touching anything in the popover (Wave C scope)
- New dependencies

## Algorithm spec (equal-position bucketing)

`aggregateMarkers(headings, activeId, maxMarkers)`:

1. If `headings.length === 0`, return `[]`.
2. If `headings.length <= maxMarkers`, return one `Marker` per heading (no aggregation). Each Marker carries the heading's id, level, and position-fraction (`(pos - firstPos) / (lastPos - firstPos)`, or `0` if `firstPos === lastPos`).
3. Else (aggregation path):
   - Compute `firstPos = headings[0].pos`, `lastPos = headings[headings.length - 1].pos`. If `firstPos === lastPos` (degenerate single-position case), return at most `maxMarkers` markers — pick by sampling stride.
   - Otherwise: divide `[firstPos, lastPos]` into `maxMarkers` equal buckets. For each non-empty bucket, emit ONE marker representing that bucket. The marker should carry a synthetic id (e.g. `bucket-${index}`), a level (use the SHALLOWEST level among headings in the bucket — i.e., the smallest level number), and the bucket's position fraction (the bucket's midpoint normalized to [0, 1]).
   - Find which bucket contains the active heading (if `activeId !== null` and the active heading is in `headings`). Replace that bucket's marker with the active heading's own marker (carrying the active heading's real id, real level, and exact position fraction).
4. Output ordering: markers MUST be sorted by their position fraction ascending. The active marker, if present, sits at its real position (not at its bucket's center).

`Marker` type: `{ id: string; level: 1|2|3; positionFraction: number; isActive: boolean }`. (Sidebar level cap is 1-3 since the rail consumes the level-filtered `headings` from `useHeadings`, NOT the canonical 1-6 list.)

## Accept checks (every command must pass)

```bash
# 1. Lint clean
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm run lint
# expected: 0 errors, exactly 3 unchanged warnings

# 2. Type check clean
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm run type-check
# expected: exit 0, no output

# 3. Pure-module unit tests pass
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run src/__tests__/components/editor/mindlines/aggregate-markers.test.ts
# expected: exit 0; must cover:
#   - empty input → empty array
#   - sub-cap input (e.g. 5 headings, maxMarkers=10) → 5 markers, one per heading, NOT aggregated
#   - over-cap input (e.g. 200 headings, maxMarkers=120) → ≤ 120 markers
#   - active heading is ALWAYS represented exactly: with a 200-heading list + active heading at index 87, the output contains a marker with id matching that heading's id AND positionFraction matching that heading's exact pos
#   - active marker has isActive=true; other markers have isActive=false
#   - degenerate single-position case (all headings at same pos) → ≤ maxMarkers markers, no division-by-zero
#   - output is sorted by positionFraction ascending
#   - stability: calling aggregateMarkers twice with the same input returns structurally-equal output

# 4. Existing tests stay green (the 5 forbidden test files: canonical-outline, hover-intent, outline-collapsed, outline-collapsed-virtual, active-resolver, toc-node-view)
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run src/__tests__/components/editor/mindlines src/__tests__/components/editor/toc-node-view.test.tsx
# expected: exit 0; canonical-outline 16 + hover-intent 4 + outline-collapsed 6 + outline-collapsed-virtual 4 + active-resolver 12 + toc-node-view 5 = 47 tests across 6 files all pass, NO modification needed to any of these

# 5. Full suite pass→pass invariant
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run
# expected: exit 0; ≥ 323 passing (was 323 after Wave C; your new aggregate-markers tests push it higher)

# 6. Rail rendering uses aggregateMarkers
cd /Users/rickielin/Sandbox/doxmind/local-desk && grep -n 'aggregateMarkers' src/components/editor/mindlines/outline-collapsed.tsx
# expected: ≥ 1 match (the import) + ≥ 1 match (the call)

# 7. Popover code from Wave C is untouched
cd /Users/rickielin/Sandbox/doxmind/local-desk && grep -n 'useVirtualizer\|scrollToIndex\|prevPopoverMountedRef' src/components/editor/mindlines/outline-collapsed.tsx
# expected: ≥ 3 matches (these tokens from Wave C must still be present)

# 8. Diff scope
cd /Users/rickielin/Sandbox/doxmind/local-desk && git diff --name-only
# expected: tracked modifications include `outline-collapsed.tsx`. New files: aggregate-markers.ts, aggregate-markers.test.ts. NO modifications to forbidden-path files.

# 9. Rail width (MINDLINES_WIDTH) constant preserved
cd /Users/rickielin/Sandbox/doxmind/local-desk && grep -n 'MINDLINES_WIDTH\|260\|640' src/components/editor/mindlines/outline-collapsed.tsx
# expected: ≥ 3 matches (rail width + popover dimensions still referenced)
```

## Pass→pass invariant

- Full vitest suite reports **≥ 323 passing**. Test count may only go UP.
- Lint 0 errors, exactly 3 unchanged warnings.
- Type check clean.
- All 6 existing test files (canonical-outline, hover-intent, outline-collapsed, outline-collapsed-virtual, active-resolver, toc-node-view) pass WITHOUT MODIFICATION.
- No `package.json` change beyond Wave F1's pre-existing entry.
- Popover code from Wave C remains untouched (`useVirtualizer`, `scrollToIndex`, `prevPopoverMountedRef` all still present).

## What "done" looks like (for the GAN Critic)

- All 9 accept checks pass.
- `aggregate-markers.ts` is a pure module: no React, no TipTap, no DOM. The GAN Critic should verify by reading the imports section.
- The rail rendering in `outline-collapsed.tsx` calls `aggregateMarkers(headings, activeId, MAX_RAIL_MARKERS)` where `MAX_RAIL_MARKERS` is 120 (or a closely-related semantic constant like `RAIL_MARKER_CAP`, named obviously).
- The active heading's bucket is replaced by the heading's own marker — verified by the test "active heading is ALWAYS represented exactly".
- The popover code from Wave C is byte-identical to its post-Wave-C state (no incidental changes).
- Hover-intent integration is preserved — the `outline-collapsed.test.tsx` and `hover-intent.test.ts` files pass unmodified.
- Diff contains only allowed-path changes.
- Pass→pass invariant holds.

If all eight are true, this wave is shippable. Anything else is a defect the Critic must surface.
