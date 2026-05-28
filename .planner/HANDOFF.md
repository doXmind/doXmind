# Planner Handoff — Markdown outline data flow & active tracking

**Date:** 2026-05-27
**Branch:** `main`
**Baseline:** 286 vitest tests passing across 38 files; ESLint 0 errors / 3 pre-existing warnings (unrelated files); type-check clean.

## Problem

doXmind's Markdown outline scales linearly with heading count: in a 900-heading stress document, scroll handling issues ~81,000 `getBoundingClientRect` reads per scroll (one per heading per frame), and opening the outline popover mounts a row per heading, producing a long task. Inline TOC blocks also independently scan the document, so there are multiple sources of outline truth. This PRD centralizes heading extraction behind one shared source, replaces DOM-rect scroll-spy with ProseMirror's `posAtCoords` + binary search, virtualizes the popover, bounds the collapsed rail, and bounds the inline TOC. Browsing/read-only runtime is explicitly out of scope.

## Locked Decisions

1. Default to the current lightweight `doc.forEach` scan, **centralized**. TipTap's official TOC extension is _not_ default; gated on later measurement.
2. Active detection uses `editor.view.posAtCoords()` + binary search on a position-sorted heading list. No per-heading `getBoundingClientRect`.
3. Canonical outline = levels 1–6 unfiltered. Sidebar applies ≤3 filter; inline TOC stays 1–6; browsing untouched.
4. Inline TOC node view consumes shared data through an **explicit editor-scoped bridge** (not the app React tree, not a global store).
5. Active resolver uses **single probe + keep-previous fallback**. Multi-point sampling gated on measured miss rate.
6. Scroll → RAF-scheduled active recompute. Scroll never rebuilds heading data.
7. Collapsed rail aggregate markers, target ≤120, active marker preserved. **Algorithm TBD — PM decision pending; blocks Wave D.**
8. Popover virtualized via `@tanstack/react-virtual` (already in deps). Index-based `scrollToIndex` for active alignment, not `scrollIntoView`.
9. Inline TOC respects `maxShowCount` cap (default ~50).
10. Hover-intent contract preserved; existing tests stay green.
11. Browsing runtime out of scope.
12. No heading offset caches. No IntersectionObserver in the editor path.

Full text and code grounding: `.planner/design/project-status.md`.

## Design Documents

- `.planner/design/project-status.md` — locked decisions, scope, codebase grounding, acceptance.

## Constraints

- Frontend-only changes (no FastAPI / Tauri surface).
- No new npm dependencies. `@tanstack/react-virtual@3.13` already available.
- Three pre-existing ESLint warnings in `page-link-node-view.tsx`, `slash-commands.tsx`, and `excel-editor-workspace.tsx` are NOT in scope — workers may not fix them.
- This PRD is editor-path only. Read-mode/browsing runtime keeps its current `file.outline` + `getBoundingClientRect` scroll-spy.
- Sidebar level cap `OUTLINE_MAX_LEVEL = 3` and rail width `MINDLINES_WIDTH` are stable contracts.

## Scope

- **In:** canonical outline source + provider/bridge (Wave A); position-model active resolver (Wave B); virtualized popover (Wave C); aggregate rail markers (Wave D, gated); inline TOC bridge + maxShowCount (Wave E); perf fixture + acceptance harness (Wave F).
- **Deferred:** browsing/read-only runtime, TipTap official TOC extension, multi-point coordinate sampling, heading offset caches, IntersectionObserver path, Markdown storage / sidecar format changes, PDF / Excel outline changes.

## Definition of Done

- [ ] Scroll handling makes zero per-heading `nodeDOM` / `getBoundingClientRect` / `offsetTop` calls for active detection.
- [ ] Active resolution per scroll frame is O(1) + O(log N).
- [ ] In the 900-heading stress doc, a 180-frame scroll issues ≥100× fewer DOM rect reads than the ~81,000 baseline.
- [ ] No outline-attributable long task > 50 ms when opening the popover in the stress doc.
- [ ] Mounted popover row count ≤ 80 (visible + overscan).
- [ ] Rail marker DOM node count ≤ 120 while preserving the active marker.
- [ ] Inline TOC respects `maxShowCount` instead of rendering all headings.
- [ ] Existing hover-intent and outline-collapsed tests stay green; coverage extended to rail↔popover transitions after virtualization.
- [ ] Stress fixture is reproducible from a checked-in generator/script.
- [ ] Measurement uses `DOXMIND_PERF` JSON spans where practical.

## Open Risks / PM Decisions Needed

1. ~~Wave D — rail aggregate marker bucketing algorithm.~~ **Resolved 2026-05-27:** equal-position bucketing chosen, see #114.
2. **Wave E — `maxShowCount` default value for inline TOC.** Bound to 50 in #113. Change requires updating the issue + contract; no PM decision currently outstanding.
3. **Read↔edit runtime switch behavior.** Wave A contract (`.planner/contracts/wave-A.md`) explicitly requires the canonical source to survive warm read→edit transitions without re-extracting. Verification will confirm.

## Wave ↔ GitHub issue mapping

| Wave | Issue                                                    | Status                                      |
| ---- | -------------------------------------------------------- | ------------------------------------------- |
| A    | [#109](https://github.com/doXmind/local-desk/issues/109) | dispatched 2026-05-27                       |
| F1   | [#110](https://github.com/doXmind/local-desk/issues/110) | dispatched 2026-05-27                       |
| B    | [#111](https://github.com/doXmind/local-desk/issues/111) | pending (blocked by A)                      |
| C    | [#112](https://github.com/doXmind/local-desk/issues/112) | pending (blocked by A)                      |
| E    | [#113](https://github.com/doXmind/local-desk/issues/113) | pending (blocked by A)                      |
| D    | [#114](https://github.com/doXmind/local-desk/issues/114) | pending (blocked by A, B; algorithm locked) |
| F2   | [#115](https://github.com/doXmind/local-desk/issues/115) | pending (blocked by A, B, C, D, E, F1)      |

## Environment

- CWD: `/Users/rickielin/Sandbox/doxmind/local-desk`
- Lint: `npm run lint` (0 errors, 3 pre-existing warnings tolerated)
- Type check: `npm run type-check`
- Test: `npm test -- --run` (always include `--run`; bare `npm test` enters watch mode)
- Build (only if a wave touches Tauri/server, which this PRD shouldn't): see `package.json` scripts.

## Session Log

### Session 1 — 2026-05-27 (handoff written, issues published, first 2 waves dispatched)

Handoff package written from PRD #108. Baseline captured. PRD broken into 7 GitHub issues (#109–#115). Wave D bucketing algorithm decided (equal-position).

Contracts written for Waves A and F1 (the no-blocker waves). Team `doxmind-outline-prd-108` created with `worker-canonical` (Wave A / #109) and `worker-fixture` (Wave F1 / #110) running in background.

When their reports return: verify against the contracts, dispatch GAN critics, then write the next round of contracts (B / C / E) and dispatch their workers in parallel since they only conflict with each other through `use-canonical-outline.ts` once (and only #112 touches `outline-collapsed.tsx`, so #111 + #112 + #113 are safe to parallelize).

Subsequent ordering:

- After A lands clean: dispatch B (#111), C (#112), E (#113) in parallel
- After B + C land clean: dispatch D (#114) — note D and C both touch `outline-collapsed.tsx`, so D goes after C, not parallel
- After all of A, B, C, D, E, F1 land clean: dispatch F2 (#115)
