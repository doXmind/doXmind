# Project Status — Markdown outline data flow & active tracking

**Source PRD:** GitHub issue [#108](https://github.com/doXmind/local-desk/issues/108) — _Optimize Markdown outline data flow, active tracking, and rendering_ (updated 2026-05-27)
**Date:** 2026-05-27
**Branch:** `main`

The PRD is the canonical spec. This file restates only the locked decisions and the codebase grounding the Planner needs to dispatch waves. If this file and the PRD disagree, the PRD wins.

---

## Problem (one paragraph)

In a 900-heading stress Markdown document, scroll handling currently issues ~81,000 `getBoundingClientRect` reads (one per heading per scroll frame) and opening the outline popover mounts a row per heading, producing a long task. Heading data is also independently scanned by the inline TOC custom block, so the editor has multiple sources of outline truth. We will centralize heading extraction behind one shared source, resolve active heading via ProseMirror's position model (not DOM rect scans), virtualize the popover, cap the collapsed rail, and bound the inline TOC display count. Browsing/read-only runtime is explicitly out of scope.

---

## Locked decisions

1. **Default heading extraction stays as the current lightweight `editor.state.doc` scan, centralized into one shared source.** TipTap's official `@tiptap/extension-table-of-contents` is _not_ the default. Adopt it only if a future measurement shows synchronization benefit that outweighs typing-path transaction cost.
2. **Active heading resolution uses `editor.view.posAtCoords()` + binary search over a position-sorted heading list.** No `getBoundingClientRect` per heading, no IntersectionObserver in the editor path.
3. **Canonical heading data is unfiltered (levels 1–6).** Consumers filter for themselves: sidebar outline keeps level ≤3 behavior, inline TOC block keeps levels 1–6, browsing remains 1–6 (untouched in this PRD).
4. **Inline TOC consumes shared canonical data through an explicit editor-scoped subscription bridge**, not via the app React provider (TipTap node views are not in the app's React tree by default). The bridge is editor-scoped, not a broad global store.
5. **Single viewport probe point + keep-previous fallback** for active resolution. Multi-point coordinate sampling is _not_ implemented up-front — only added if instrumented miss rate shows a real UX problem.
6. **Scroll handlers schedule active recomputation via `requestAnimationFrame`. Scroll never rebuilds heading data.**
7. **Collapsed rail renders a bounded set of aggregate markers (target ≤120) instead of one button per heading.** Active marker is always preserved. _Bucketing algorithm is a remaining design decision — see Open Risks._
8. **Expanded outline popover is virtualized (TanStack React Virtual, already in deps via `@tanstack/react-virtual@3.13`).** Mounted row target ≤80 for default popover size. Active row alignment uses index-based virtualizer scrolling — _not_ DOM-query + `scrollIntoView`.
9. **Inline TOC respects a `maxShowCount` cap (TipTap UI pattern) instead of rendering every heading.**
10. **Hover-intent contract on the rail/popover safe-area polygon is preserved.** Existing tests in `src/__tests__/components/editor/mindlines/` must stay green after virtualization.
11. **Browsing/read-only runtime is out of scope.** Its `OutlineCollapsed` consumer keeps the pre-computed `file.outline` + `getBoundingClientRect` scroll-spy path; no position-model resolver is wired there.
12. **No heading offset caches** as a primary implementation (invalidation cost on images / custom nodes / font shifts is too high). No `IntersectionObserver` fallback in the editor path.

---

## Codebase grounding (current state, May 2026)

| File                                                                   | Lines         | Role today                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/editor/mindlines/use-headings.ts`                      | 43–87, 89–139 | Live heading extraction via `editor.state.doc.forEach()` (200 ms debounced) + scroll-spy reading `getBoundingClientRect` on each heading via `editor.view.nodeDOM(pos)`. **Hot path.** |
| `src/components/editor/toc-node-view.tsx`                              | 19–42         | Inline TOC node view — independently calls `doc.descendants()` on every transaction; renders all 1–6 levels with no max-count cap.                                                     |
| `src/components/editor/mindlines/outline-collapsed.tsx`                | —             | Sidebar rail + popover UI. Not virtualized. Compact-mode threshold at ~30 headings. Framer Motion for enter/exit.                                                                      |
| `src/components/editor/mindlines/hover-intent.ts`                      | —             | Rail↔popover safe-area polygon math. Tested in `__tests__/components/editor/mindlines/hover-intent.test.ts`.                                                                           |
| `src/components/workspace/browsing-runtime.tsx`                        | 50–178        | Browsing runtime — consumes pre-computed `file.outline`, uses `getBoundingClientRect` scroll-spy. **Out of scope.**                                                                    |
| `src/__tests__/components/editor/mindlines/outline-collapsed.test.tsx` | —             | Popover timing (instant open, 60 ms close), pointer in safe corridor, Esc to close. **Must stay green.**                                                                               |
| `src/__tests__/components/editor/mindlines/hover-intent.test.ts`       | —             | Hover-intent geometry. **Must stay green.**                                                                                                                                            |

### Available deps

- `@tanstack/react-virtual@3.13` — already in `package.json`, currently only used in Excel sheet view.
- `@tiptap/*@3.20` — extension stack already in use; `@tiptap/extension-table-of-contents` is _not_ installed and should not be added unless a wave decision requires it.

### Constants worth preserving

- `OUTLINE_MAX_LEVEL = 3` (sidebar level cap)
- `MINDLINES_WIDTH` (rail gutter width)
- Minimum headings to render outline: ≥ 2

---

## Scope

**In:**

- Centralized canonical outline source (provider + node-view bridge)
- Position-model active resolver (single probe, binary search, RAF batching)
- Virtualized popover + bounded rail aggregate markers
- Inline TOC consumes shared data + `maxShowCount`
- Stress-fixture generator + perf acceptance harness (vitest + DOXMIND_PERF spans)

**Deferred / out:**

- Browsing/read-only runtime optimization (separate future PRD)
- TipTap official TOC extension adoption (gated on measurement)
- Multi-point coordinate-sampling fallback (gated on miss-rate measurement)
- Heading offset cache
- IntersectionObserver path in editor
- Markdown storage / sidecar format changes
- PDF / Excel outline changes
- Visual redesign beyond what virtualization/bounded rendering forces

---

## Acceptance (verbatim from PRD #108 — DoD)

| #   | Criterion                                                                                                                                                                                  | Verification                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 1   | Scroll handling makes **no per-heading `nodeDOM` / `getBoundingClientRect` / `offsetTop` calls** for active detection                                                                      | code review of scroll handler diff + unit test       |
| 2   | Active resolution work per scroll frame is **O(1) + O(log N)** for the binary lookup                                                                                                       | code review + perf probe                             |
| 3   | 180-frame programmatic scroll over a 900-heading stress doc produces **heading DOM measurement count at least 100× lower** than the ~81 000 baseline (and is independent of heading count) | perf test                                            |
| 4   | Opening the outline popover in the stress doc produces **no outline-attributable long task >50 ms**                                                                                        | long-task probe in perf test                         |
| 5   | Popover mounted row count **≤ 80** (visible + overscan)                                                                                                                                    | DOM count assertion in test                          |
| 6   | Collapsed rail rendered marker DOM nodes **≤ 120** while preserving the active marker                                                                                                      | DOM count assertion                                  |
| 7   | Inline TOC respects chosen `maxShowCount` instead of rendering all 900 headings by default                                                                                                 | TOC node-view test                                   |
| 8   | Existing outline hover-intent tests stay green; coverage extended to rail↔popover transitions after virtualization                                                                         | full vitest run                                      |
| 9   | Perf evidence is **reproducible from a checked-in generator/script** (not an untracked local fixture)                                                                                      | repo file at `scripts/` or `src/__tests__/fixtures/` |
| 10  | Measurement uses `DOXMIND_PERF` JSON spans where practical, plus targeted browser-level probes                                                                                             | log inspection                                       |

---

## Open risks / PM decisions needed

These do not block dispatch of Waves A / B / C / E / F but **Wave D (rail aggregate markers) needs the algorithm decided before its contract can be written.**

1. **Rail aggregate marker bucketing algorithm.** PRD locks the cap (≤120) and the active-marker-preservation rule, but does not specify how to map 900 headings → 120 markers. Options to choose from (PM call):
   - **(a) Equal-position bucketing** — divide document position range into N buckets, render one marker per non-empty bucket. Active heading's bucket is replaced by the heading's own marker so the active row is exact.
   - **(b) Level-weighted sampling** — prefer level-1 headings, fill remainder with level-2, ignore deeper. Active heading always preserved.
   - **(c) Reservoir sample with active pinned.** Stable across heading list mutations.
   - Recommendation: **(a)** — predictable visually, trivial to test, matches user mental model of "this rail is a map of the document."
2. **Inline TOC `maxShowCount` default value.** PRD says "aligned with TipTap UI's maxShowCount pattern" but does not bind a number. Likely 50 or 100. Defer to design at Wave E.
3. **Read↔edit runtime switch invalidation.** Recent commits (`52b865f`, `365c7e3`) unified the Markdown read↔edit runtime. PRD lists "file switches" and "setContent/reload" as invalidation triggers but does not call out warm read→edit transitions. Confirm at Wave A: warm switch should **carry over** the canonical outline rather than re-extracting.
