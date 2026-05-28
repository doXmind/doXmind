# Wave Decomposition & Briefs

Atomic task breakdown for PRD #108 — _Optimize Markdown outline data flow, active tracking, and rendering_.

**Dependency order:** **A → B → C → D → E → F**

- **A** establishes the canonical heading source. **B** depends on A's data shape.
- **C** depends on the shared source from A (popover rows come from it).
- **D** can technically run in parallel with C but is **blocked on PM decision** for the bucketing algorithm — keep it sequential after C.
- **E** depends on A's bridge surface and is unblocked once A lands; can dispatch in parallel with C or D if PM wants to shorten cycle time.
- **F** is the acceptance harness — naturally last because it asserts the cumulative behavior, but the **fixture generator script** inside F can be split off and shipped early as F1 if it helps the worker test their own work in A–E.

Each brief below is a _draft_. The Planner must (a) write the wave's contract at `.planner/contracts/wave-{ID}.md` first, then (b) expand the brief with concrete file paths, current line numbers (re-checked, code may have drifted), and per-wave forbidden paths before dispatching.

---

## Wave A — Canonical outline source + shared provider

**Scope:** Introduce one editor-scoped canonical heading source (levels 1–6, normalized shape) and a React provider/hook that consumers can subscribe to. Refactor `use-headings.ts` to **consume** the canonical source and apply the existing level ≤3 filter for sidebar use. Inline TOC and active-resolver wiring come in later waves (B, E).

**Design refs:** `.planner/design/project-status.md` — locked decision 1, 3, 6. PRD #108 Implementation Decisions items 1–4, 8–9.

### Brief (expand before dispatch)

```
Goal: introduce a shared canonical outline source for the markdown editor and refactor the sidebar outline hook to consume it.

Working directory: /Users/rickielin/Sandbox/doxmind/local-desk

State you inherit:
- src/components/editor/mindlines/use-headings.ts:43-87 — current heading extraction (via editor.state.doc.forEach, 200ms debounced). KEEP this scan style, just MOVE ownership.
- src/components/editor/mindlines/use-headings.ts:89-139 — scroll-spy via getBoundingClientRect. DO NOT touch — Wave B replaces this.
- src/components/editor/toc-node-view.tsx — inline TOC. DO NOT touch — Wave E migrates it.
- Existing constant OUTLINE_MAX_LEVEL = 3 controls sidebar filter.

Files to create:
- src/components/editor/mindlines/canonical-outline.ts — pure module: Heading shape (id, level: 1-6, text, pos), normalize(editor) → Heading[] sorted by pos, equality helper.
- src/components/editor/mindlines/use-canonical-outline.ts — hook: subscribes to editor transactions, debounced 200ms, exposes { headings: Heading[], editorId: string }. Editor-scoped React context provider in same file (OutlineProvider).

Files to modify:
- src/components/editor/mindlines/use-headings.ts — refactor to consume useCanonicalOutline() and apply the level ≤ 3 filter for the sidebar. Keep the same public hook shape so the sidebar component does not change.

Scope fence:
- Do NOT change scroll-spy / active-detection code (Wave B).
- Do NOT modify toc-node-view.tsx (Wave E).
- Do NOT install @tiptap/extension-table-of-contents.
- Do NOT add new dependencies.
- Do NOT change sidebar component code; the existing hook shape is preserved.

Reference sources (read for grounding, do not modify):
- src/components/editor/mindlines/outline-collapsed.tsx — consumer of useHeadings, do not break it.

Environment:
  cd /Users/rickielin/Sandbox/doxmind/local-desk
  # no install needed

Acceptance criteria:
  npm run lint                                                            # 0 errors, 3 pre-existing warnings tolerated
  npm run type-check                                                       # clean
  npm test -- --run                                                        # ≥286 tests passing
  npm test -- --run src/__tests__/components/editor/mindlines              # all green (hover-intent, outline-collapsed)
  # plus a new unit test for canonical-outline normalization + equality

Rollback rule: if any acceptance command fails, revert and report FAILED.

Report format: files created/modified with line counts, verbatim test output, PASSED/FAILED.
```

---

## Wave B — Position-model active resolver

**Scope:** Replace per-heading `getBoundingClientRect` scroll-spy with a `posAtCoords()` + binary-search resolver. Single viewport probe point + keep-previous fallback. Scroll handler scheduled via `requestAnimationFrame`. The resolver itself is a small pure module testable without a browser.

**Design refs:** Decisions 2, 5, 6, 12. PRD Implementation Decisions items 10–17.

### Brief (expand before dispatch)

```
Goal: replace DOM-rect scroll-spy with a ProseMirror-position-based active resolver fed by the canonical outline source.

Working directory: /Users/rickielin/Sandbox/doxmind/local-desk

State you inherit:
- Wave A landed: src/components/editor/mindlines/use-canonical-outline.ts exposes a sorted Heading[] with .pos values.
- src/components/editor/mindlines/use-headings.ts currently still owns scroll-spy (lines 89-139 in the pre-Wave-A version) — replace its scroll handler entirely.
- editor.view.posAtCoords({left, top}) returns { pos, inside } | null.

Files to create:
- src/components/editor/mindlines/active-resolver.ts — pure module: findActiveByPosition(headings: Heading[], pos: number) → string | null using binary search. Exported for direct unit testing.

Files to modify:
- src/components/editor/mindlines/use-headings.ts (or move active-state into use-canonical-outline.ts if that is cleaner — Planner decides at contract time) — wire scroll listener through requestAnimationFrame, sample a single viewport probe point (top of editor content + small offset), call posAtCoords, then findActiveByPosition. If posAtCoords returns null OR pos resolves outside heading range AND no previous active is set, fall back to the first heading; otherwise keep the previous active heading.

Scope fence:
- Do NOT add multi-point sampling. Single probe + keep-previous fallback only. (PRD locks this — multi-point is gated on later measurement.)
- Do NOT touch popover virtualization (Wave C).
- Do NOT add IntersectionObserver in the editor path.
- Do NOT cache heading offsets.

Reference sources:
- src/components/editor/mindlines/canonical-outline.ts (Wave A)
- TipTap/ProseMirror docs already in code: editor.view.posAtCoords usage in src/components/editor/toc-node-view.tsx for navigation.

Acceptance criteria:
  npm run lint
  npm run type-check
  npm test -- --run
  npm test -- --run src/__tests__/components/editor/mindlines/active-resolver  # NEW unit tests
  # active-resolver tests must cover:
  #   - before-first-heading: returns null (or first heading if no previous)
  #   - exact heading position: returns that heading
  #   - between headings: returns nearest previous heading
  #   - after-last-heading: returns last heading
  #   - empty heading list: returns null
  #   - keep-previous fallback when probe resolves to null
```

---

## Wave C — Virtualized outline popover

**Scope:** Replace eager map-render in the outline popover with TanStack React Virtual. Active-row alignment uses index-based `scrollToIndex`, not DOM-query + `scrollIntoView`. Preserve hover-intent behavior — existing tests must stay green.

**Design refs:** Decisions 8, 10. PRD Implementation Decisions items 18–20.

### Brief (expand before dispatch)

```
Goal: virtualize the expanded outline popover so mounted row count is bounded regardless of heading count.

Working directory: /Users/rickielin/Sandbox/doxmind/local-desk

State you inherit:
- Wave A landed: canonical outline source supplies Heading[].
- @tanstack/react-virtual ^3.13 is already in package.json (used by Excel sheet view — read src/components/excel-editor/* for an in-repo virtualization example).
- src/components/editor/mindlines/outline-collapsed.tsx renders the popover with .map(...). Compact-mode threshold sits around 30 headings.
- src/components/editor/mindlines/hover-intent.ts defines the safe-area polygon between rail and popover. Existing tests at src/__tests__/components/editor/mindlines/hover-intent.test.ts and outline-collapsed.test.tsx MUST stay green.

Files to modify:
- src/components/editor/mindlines/outline-collapsed.tsx — replace popover row .map(...) with useVirtualizer. Estimated row height: 28px (current value). Overscan: 6. When the popover opens, call rowVirtualizer.scrollToIndex(activeIndex, { align: 'center', behavior: 'auto' }) on the initial render — not via scrollIntoView on a DOM node.

Files to create:
- (probably none — virtualization is a localized refactor)

Scope fence:
- Do NOT touch the collapsed rail rendering (Wave D).
- Do NOT change hover-intent geometry or its tests.
- Do NOT replace Framer Motion.
- Do NOT change popover dimensions (260px × ≤640px).

Reference sources:
- src/components/excel-editor/excel-editor-workspace.tsx — existing useVirtualizer call site for shape reference.

Acceptance criteria:
  npm run lint
  npm run type-check
  npm test -- --run
  npm test -- --run src/__tests__/components/editor/mindlines  # hover-intent + outline-collapsed all green
  # Add at least one new test verifying that with a synthetic 200-heading mock, mounted row count stays ≤ ~30 (visible + overscan).
```

---

## Wave D — Collapsed rail aggregate markers (GH #114)

**Scope:** Cap the number of marker DOM nodes the collapsed rail renders to ≤120 while always preserving the active marker. Replace one-button-per-heading with a bounded aggregate.

**Algorithm locked: equal-position bucketing** (PM decision logged on #114, 2026-05-27). Divide the document position range `[firstHeadingPos, lastHeadingPos]` into `maxMarkers` equal buckets; render one marker per non-empty bucket. The active heading's bucket is replaced by the heading's own marker so the active row stays exact.

**Design refs:** Decision 7. PRD Implementation Decisions item 17, Acceptance criterion 6.

### Brief (expand before dispatch)

```
Goal: bound collapsed-rail marker DOM nodes to ≤120 using equal-position bucketing, preserving the active marker.

Working directory: /Users/rickielin/Sandbox/doxmind/local-desk

State you inherit:
- Wave A landed: canonical outline source.
- Wave B landed: active heading state available via shared hook.
- Wave C landed (popover virtualization; rail is the next piece).
- src/components/editor/mindlines/outline-collapsed.tsx currently maps each heading to one rail line.

Files to create:
- src/components/editor/mindlines/aggregate-markers.ts — pure module implementing equal-position bucketing. Signature: (headings, activeId, maxMarkers) → Marker[] (≤ maxMarkers). When headings.length ≤ maxMarkers, return one marker per heading (no aggregation). Otherwise: divide [firstPos, lastPos] into maxMarkers equal buckets, emit one marker per non-empty bucket, then replace the active heading's bucket with the active heading's own marker so the active row stays exact.

Files to modify:
- src/components/editor/mindlines/outline-collapsed.tsx — render aggregate markers from the new module instead of one-per-heading.

Scope fence:
- Do NOT change popover rendering (Wave C scope, already shipped).
- Do NOT change hover-intent.
- Do NOT change rail width (MINDLINES_WIDTH).

Acceptance criteria:
  npm run lint
  npm run type-check
  npm test -- --run
  # Unit tests for aggregate-markers covering:
  #   - empty input
  #   - sub-cap input (no aggregation)
  #   - over-cap input (capped count, ≤ maxMarkers)
  #   - active heading always represented exactly (not aggregated away)
```

---

## Wave E — Inline TOC bridge

**Scope:** Migrate `toc-node-view.tsx` from independent `doc.descendants()` scanning to consuming the canonical outline via the editor-scoped subscription bridge. Add `maxShowCount` cap. Levels 1–6 preserved.

**Design refs:** Decisions 3, 4, 9. PRD Implementation Decisions items 5, 6 (explicit bridge for node views), 19.

### Brief (expand before dispatch)

```
Goal: rewire the inline TOC node view to consume the canonical outline source and respect a maxShowCount cap.

Working directory: /Users/rickielin/Sandbox/doxmind/local-desk

State you inherit:
- Wave A landed: canonical outline source + subscription surface. TipTap node views are NOT inside the app React provider tree, so the bridge cannot rely on React context — Wave A should have exposed an editor-scoped subscribable (e.g. a small EventEmitter or a snapshot getter on a TipTap extension). Confirm exact shape from Wave A diff before writing the contract for E.
- src/components/editor/toc-node-view.tsx:19-42 currently calls editor.state.doc.descendants() on every transaction. This is the path we are replacing.
- src/components/editor/toc-node-view.tsx renders all 6 heading levels — KEEP that behavior. Sidebar's level ≤ 3 cap does NOT apply here.

Files to modify:
- src/components/editor/toc-node-view.tsx — remove the local doc.descendants() scan. Subscribe to the canonical source via the bridge defined in Wave A. Apply maxShowCount = 50 (planner-pickable default; confirm at contract time).

Scope fence:
- Do NOT add React-tree access from inside the node view.
- Do NOT change the rendered TOC markup (only the data source).
- Do NOT change levels 1-6 inclusion.
- Do NOT add new deps.

Acceptance criteria:
  npm run lint
  npm run type-check
  npm test -- --run
  # Add a node-view test asserting:
  #   - With 100 headings, only the first 50 (or maxShowCount) are rendered.
  #   - The TOC no longer triggers a doc.descendants traversal (assert via a spy on editor.state.doc.descendants, OR via a marker that the bridge subscription was used).
```

---

## Wave F — Perf fixture generator + acceptance harness

**Scope:** Lock in measurable acceptance for the cumulative work. Generate a 900-heading stress Markdown document programmatically (no untracked local fixture). Add perf assertions that the scroll path issues O(1) DOM measurements per frame and that popover mount produces no long task >50ms.

**Design refs:** PRD Acceptance Criteria 3–10, "Further Notes" baseline numbers.

**Note:** the **fixture generator script** (F1 below) can be split out and shipped early — between Waves A and B — so subsequent waves' workers can test against the stress doc locally. F2 (perf acceptance) is naturally last.

### Brief F1 — fixture generator (can ship early)

```
Goal: ship a deterministic generator that emits a 900-heading stress Markdown document for outline perf testing.

Working directory: /Users/rickielin/Sandbox/doxmind/local-desk

Files to create:
- scripts/generate-outline-stress-md.mjs — Node ESM script. Args: --count (default 900), --levels (default "1,2,3"), --out (default src/__tests__/fixtures/outline-stress.md). Output: a deterministic Markdown file with the requested number of headings interspersed with short paragraphs and the occasional code block / math block so the document also exercises custom node views.
- src/__tests__/fixtures/outline-stress.md — generated artifact, checked in.
- A one-line note in package.json scripts: "gen:outline-stress": "node scripts/generate-outline-stress-md.mjs".

Scope fence:
- Do NOT add npm dependencies.
- Do NOT add a build step.
- The fixture file MUST be deterministic (same args → same bytes).

Acceptance criteria:
  npm run lint                                                            # generator script lints if it lives under src; otherwise this can be skipped
  node scripts/generate-outline-stress-md.mjs --out /tmp/check.md         # exits 0, file exists, contains 900 "#"/"##"/"###" lines
  npm test -- --run                                                        # baseline still green
```

### Brief F2 — perf acceptance

```
Goal: lock the cumulative perf acceptance with a vitest browser-environment test using the stress fixture.

Working directory: /Users/rickielin/Sandbox/doxmind/local-desk

State you inherit:
- Waves A-E landed.
- src/__tests__/fixtures/outline-stress.md exists (Wave F1).
- DOXMIND_PERF env var controls perf span logging — see CLAUDE.md.

Files to create:
- src/__tests__/perf/outline-perf.test.ts — vitest perf suite. Loads the stress fixture into the editor (jsdom/happy-dom env, or playwright if vitest-browser is set up — Planner picks the env at contract time based on what already exists in the repo). Asserts:
    a) A simulated 180-frame scroll produces ≤ N getBoundingClientRect calls on heading nodes (target N ≤ 100; PRD says "at least 2 orders of magnitude lower than ~81 000" so anything ≤ 810 passes — pick ≤ 200 as a tighter target).
    b) On programmatic popover-open, the synchronous work block on the main thread is < 50ms (measured via Date.now wrapping the render call, since long-task API is not available in jsdom).
    c) Mounted popover row count ≤ 80.
    d) Mounted rail marker count ≤ 120.
    e) Inline TOC renders ≤ maxShowCount headings even with 900 in the doc.

Scope fence:
- Do NOT change PRD acceptance numbers — only check them.
- Do NOT add real-browser playwright unless vitest-browser is already configured.

Acceptance criteria:
  npm run lint
  npm run type-check
  npm test -- --run src/__tests__/perf/outline-perf.test.ts
  npm test -- --run                                                        # full suite still green
```
