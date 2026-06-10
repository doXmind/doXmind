# Wave F2 Contract — Outline perf acceptance harness (cumulative PRD #108 DoD)

> Written by the Planner BEFORE the Worker is dispatched. This file is the
> single source of truth the GAN Critic scores against — not the brief.
> Once dispatched, this file is immutable. If the contract has to change,
> open a new wave (e.g. `wave-F2a.md`) — do not edit this one in place.

**Wave:** F2
**GitHub issue:** [#115](https://github.com/doXmind/local-desk/issues/115)
**Created:** 2026-05-28T01:02:00Z
**Branch / worktree:** `main` at `/Users/rickielin/Sandbox/doxmind/local-desk`
**Baseline tests at contract time:** 331 passing across 43 files (all preceding waves landed clean)

## Goal

Lock PRD #108's quantitative Definition of Done with a vitest perf suite that loads the F1 stress fixture (900 headings) and exercises the full outline stack end-to-end, asserting all six measurable invariants. This wave adds **tests only — no new product code**. If the perf assertions fail, the test fails; the implementation does not change.

## Allowed paths (Worker may create or edit these)

- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/perf/outline-perf.test.ts` (NEW — vitest perf suite asserting the 6 cumulative PRD invariants against the 900-heading fixture; the file may pull together mocks/setup helpers inline)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/perf/outline-perf-helpers.ts` (OPTIONAL NEW — if the perf test needs reusable fixture-loading or DOM-instrumentation helpers, extract them here; do not create unless the inline approach hurts readability)

## Forbidden paths (Worker MUST NOT touch — hard fail if diff shows changes here)

- All existing files in `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/**`
- All existing files in `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/toc-node-view.tsx`
- All existing test files in `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/editor/**`
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/fixtures/outline-stress.md` (F1 fixture; read-only here)
- `/Users/rickielin/Sandbox/doxmind/local-desk/scripts/generate-outline-stress-md.mjs` (F1 generator; read-only here)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/app/editor/[[...fileId]]/_components/desktop-editor.tsx` (Wave A wiring)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/workspace/browsing-runtime.tsx`
- `/Users/rickielin/Sandbox/doxmind/local-desk/package.json` (no new dependencies — vitest, happy-dom/jsdom, @testing-library/react are all already in the tree)
- `/Users/rickielin/Sandbox/doxmind/local-desk/CLAUDE.md`, any `*.md` doc
- `/Users/rickielin/Sandbox/doxmind/local-desk/server/**`, `/Users/rickielin/Sandbox/doxmind/local-desk/src-tauri/**`
- Pre-existing ESLint warning fixes
- `vitest.config.ts` or `vitest.config.mts` (only modify if absolutely required to make perf tests run; if you do modify, document why and keep the change minimal — see "Perf-test environment configuration" below)

### Why product code is in the forbidden list

This is the cumulative acceptance ticket. If a perf assertion fails, the failure is the test result — not a signal to modify the implementation. If you find a real perf bug while writing the test, STOP and report it as a separate follow-up; do NOT silently fix it in this wave.

## Out of scope

- Changing PRD #108's numeric targets (those are bound by the contract below)
- Adding playwright / browser-based perf measurement (vitest + happy-dom or jsdom is sufficient; the contract's numbers are calibrated for that environment)
- Mocking out the editor stack so heavily that the perf measurement loses meaning — the test must use the real `useHeadings`, real `subscribeOutline`, real `aggregateMarkers`, real `findActiveByPosition`. Mocking is acceptable ONLY for: TipTap editor construction (use the project's existing editor-test helpers if any, or a minimal real-TipTap mount with the loaded markdown), and `useVirtualizer` (per Wave C, jsdom-zero-size mocking is established — use the windowed-shim pattern, NOT the all-rows shim)
- Performance optimization to make tests pass — those are out of scope by definition

## Perf-test environment configuration

The test must run in vitest's default test environment (happy-dom or jsdom — whichever the project already uses; check `vitest.config.*`). If the editor stack requires a TipTap-compatible DOM environment, use it as-is.

If you discover that perf measurement requires a vitest config tweak (e.g., a new `testTimeout`, a `hooks: setup` to install perf hooks before each test), make the MINIMUM necessary change and document it in your report. Do NOT add a brand-new test environment (e.g., `vitest-environment-playwright`).

## Algorithm spec (the 6 perf invariants)

The test file must contain at least one `it(...)` block per invariant. Each invariant is bound to a specific PRD acceptance criterion:

### Invariant 1: scroll path issues ≤ 200 `getBoundingClientRect` calls on heading nodes

**Setup:** mount `useHeadings(editor)` (or the full DesktopEditor / OutlineCollapsed composition — worker's choice) with the 900-heading stress fixture loaded into a real TipTap editor instance.
**Action:** spy on `Element.prototype.getBoundingClientRect`. Filter spy calls to those targeting elements whose closest heading ancestor matches a heading in the document (i.e., calls on heading nodes, not on container rects or other elements). Simulate 180 scroll events on the editor's scroll parent, flushing RAF after each event group (e.g., flush every 30 events).
**Assert:** the filtered call count is ≤ 200.
**Rationale:** PRD requires "at least 2 orders of magnitude lower than ~81,000" (i.e., ≤ 810). This contract sets a tighter target (≤ 200) to ensure Wave B's O(1) shape actually landed and is not undermined by stray callers.

### Invariant 2: synchronous popover-open work block is < 50 ms

**Setup:** mount `OutlineCollapsed` with the 900-heading fixture loaded into `useHeadings`. Popover initially closed.
**Action:** wrap the popover-open action (e.g., setting popoverMounted state or firing the open trigger) with `const start = performance.now(); ... ; const elapsed = performance.now() - start;`. Flush microtasks and one RAF tick to capture any cascading synchronous work.
**Assert:** `elapsed < 50` ms.
**Rationale:** PRD requires no outline-attributable long task > 50 ms. happy-dom and jsdom don't expose the Long Task API, so we measure synchronous render work via `performance.now()` deltas. A test on a fast machine will measure significantly less than 50 ms; the bound is a generous ceiling.

### Invariant 3: mounted popover row DOM count is ≤ 80

**Setup:** mount `OutlineCollapsed` with the 900-heading fixture loaded. Open the popover. Wait one RAF tick for the virtualizer to settle.
**Action:** query the popover's row container for child elements (the rendered virtual rows). Use a stable selector — either a `data-testid` already in the file, or the same selector pattern Wave C used for its own DOM-count test.
**Assert:** the rendered row count is ≤ 80 (visible + overscan).
**Note:** for this test you MUST use the windowed-shim of `useVirtualizer` (Wave C pattern in `outline-collapsed-virtual.test.tsx`) — the all-rows shim from Wave C's `outline-collapsed.test.tsx` would defeat the cap. If you import the windowed-shim setup, it should be a copy or a referenced helper, NOT a new export from Wave C's test file (forbidden path).

### Invariant 4: rail marker DOM count is ≤ 120

**Setup:** mount `OutlineCollapsed` with the 900-heading fixture loaded. Rail is the collapsed-state visible without opening the popover.
**Action:** query the rail's marker container for child elements (the rendered aggregate markers). Use a stable selector consistent with the file's structure.
**Assert:** the rendered marker count is ≤ 120.
**Rationale:** Wave D's `MAX_RAIL_MARKERS = 120` is the bound; this test verifies the bound holds end-to-end with the real `aggregateMarkers` consuming real canonical-source data.

### Invariant 5: inline TOC renders ≤ `maxShowCount` rows (default 50)

**Setup:** mount the TOC node view (or its rendered output via a simulated insertion into the editor — use the same pattern as `src/__tests__/components/editor/toc-node-view.test.tsx`) with the 900-heading fixture loaded.
**Action:** query the rendered TOC's row container.
**Assert:** the rendered row count is ≤ 50.
**Rationale:** Wave E's `MAX_SHOW_COUNT = 50` is the cap; this test verifies it holds end-to-end with the real bridge subscription and real canonical-source data.

### Invariant 6: full-stack composition does not regress the suite

**Setup:** the perf test file is part of the regular vitest run; no opt-in flag required.
**Action:** the test runs to completion in the standard `npm test -- --run` invocation.
**Assert:** the full vitest suite reports ≥ 331 passing (the post-Wave-D baseline) plus the new perf tests, with 0 failing.
**Rationale:** Worker must not introduce flakiness that causes other tests to fail when perf tests are co-resident in the suite.

## Accept checks (every command must pass)

```bash
# 1. Lint clean
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm run lint
# expected: 0 errors, exactly 3 unchanged warnings

# 2. Type check clean
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm run type-check
# expected: exit 0, no output

# 3. New perf tests pass
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run src/__tests__/perf/outline-perf.test.ts
# expected: exit 0; the test must include at least one `it(...)` block per Invariant 1-5 (Invariant 6 is implicit via the full-suite check below)

# 4. Each invariant is structurally present — grep for the assertion shape
cd /Users/rickielin/Sandbox/doxmind/local-desk && grep -cE 'getBoundingClientRect|toBeLessThan|toBeLessThanOrEqual' src/__tests__/perf/outline-perf.test.ts
# expected: ≥ 5 matches (one per invariant)

# 5. The fixture is actually loaded
cd /Users/rickielin/Sandbox/doxmind/local-desk && grep -n 'outline-stress.md\|outline-stress' src/__tests__/perf/outline-perf.test.ts
# expected: ≥ 1 match (the fixture is loaded via fs.readFileSync or similar)

# 6. Pure-product code is unchanged
cd /Users/rickielin/Sandbox/doxmind/local-desk && git diff --name-only -- src/components/editor src/__tests__/components/editor src/__tests__/fixtures
# expected: empty (no changes to forbidden paths)

# 7. Full suite pass→pass invariant
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run
# expected: exit 0; ≥ 331 passing (baseline + new perf tests; the new tests should add 5+ to the count, pushing total to 336+); 0 failing

# 8. Diff scope check
cd /Users/rickielin/Sandbox/doxmind/local-desk && git diff --name-only
# expected: new test file appears via `??` in `git status`; no tracked modifications to product code or other test files
```

## Pass→pass invariant

- Full vitest suite reports **≥ 331 passing**. Test count goes UP (≥ 5 new tests).
- Lint 0 errors, exactly 3 unchanged warnings.
- Type check clean.
- All existing 47 mindlines + TOC + perf-adjacent tests pass without modification.
- No `package.json` change beyond Wave F1's pre-existing entry.
- No product code modifications.

## What "done" looks like (for the GAN Critic)

- All 8 accept checks pass.
- The new test file lives at `src/__tests__/perf/outline-perf.test.ts` and loads `src/__tests__/fixtures/outline-stress.md` via `fs.readFileSync` (or an equivalent ESM `readFile`).
- Each of the 5 numbered invariants (1-5) has at least one dedicated `it(...)` block. The block's assertion uses `toBeLessThanOrEqual` or `toBeLessThan` against the bound stated in this contract.
- The test mounts the REAL outline stack: `useHeadings`, `subscribeOutline`, `aggregateMarkers`, `findActiveByPosition`. Mocking is limited to TipTap editor construction (if necessary) and `useVirtualizer` (windowed-shim per Wave C pattern).
- Where `performance.now()` is used to time synchronous work, the worker has noted the measurement caveats in a comment in the test file (e.g., "happy-dom doesn't expose Long Task API; we measure synchronous render work as a proxy").
- Where mock helpers from Wave C are needed (windowed `useVirtualizer` shim), the worker has COPIED the helper into the perf test file or a new `outline-perf-helpers.ts` — NOT modified Wave C's test files.
- Diff contains only allowed-path changes.
- Pass→pass invariant holds.

If all seven are true, this wave is shippable and PRD #108 is done. Anything else is a defect the Critic must surface.
