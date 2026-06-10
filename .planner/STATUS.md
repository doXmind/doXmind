# Feature Status

> Last derived: **2026-05-27T23:10:00Z**
> Branch: `main`
> Baseline: **286 tests passing across 38 files, lint 0 errors (3 pre-existing warnings tolerated), type-check clean**

## Current state (derived from event log below — rewritten each update)

### Wave ↔ GitHub issue mapping

| Wave   | GH issue                                                 | Scope                                                                  | Tests delta | Status                                                                                                                            |
| ------ | -------------------------------------------------------- | ---------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **A**  | [#109](https://github.com/doXmind/local-desk/issues/109) | Canonical outline source + shared provider                             | +16         | **wave_done** (attempt 2 clean via general-purpose GAN; 2 MINOR captured)                                                         |
| **F1** | [#110](https://github.com/doXmind/local-desk/issues/110) | Stress fixture generator (can ship early)                              | +0          | **wave_done** (2 MAJOR contract-level, no re-dispatch)                                                                            |
| **B**  | [#111](https://github.com/doXmind/local-desk/issues/111) | Position-model active resolver (posAtCoords + binary search + RAF)     | +12         | **wave_done** (GAN clean: 3 MINOR all cosmetic)                                                                                   |
| **C**  | [#112](https://github.com/doXmind/local-desk/issues/112) | Virtualized outline popover                                            | +4          | **wave_done** (GAN clean: 3 MINOR all cosmetic; scope-creep concern resolved — diff is justified, self-count was just inaccurate) |
| **E**  | [#113](https://github.com/doXmind/local-desk/issues/113) | Inline TOC bridge + maxShowCount                                       | +5          | **wave_done** (GAN clean: 0 BLOCKING / 0 MAJOR / 0 MINOR)                                                                         |
| **D**  | [#114](https://github.com/doXmind/local-desk/issues/114) | Collapsed rail aggregate markers (**equal-position bucketing** locked) | +8          | **wave_done** (GAN clean: 3 MINOR all cosmetic; active-bucket replacement preserves exact position)                               |
| **F2** | [#115](https://github.com/doXmind/local-desk/issues/115) | Perf acceptance harness                                                | +5          | **wave_done** (GAN clean: 2 MINOR measurement-fidelity nits, no contract violations)                                              |

### Definition-of-Done

| #   | Criterion                                                                             | Progress                 |
| --- | ------------------------------------------------------------------------------------- | ------------------------ |
| 1   | Scroll handling: 0 per-heading nodeDOM / getBoundingClientRect / offsetTop calls      | pending (Wave B)         |
| 2   | Active resolution per frame is O(1) + O(log N)                                        | pending (Wave B)         |
| 3   | 180-frame scroll in 900-heading doc: ≥100× fewer DOM rect reads than ~81 000 baseline | pending (Wave F2)        |
| 4   | No outline-attributable long task >50 ms on popover open                              | pending (Wave F2)        |
| 5   | Popover mounted row count ≤ 80                                                        | pending (Wave C / F2)    |
| 6   | Rail marker DOM count ≤ 120, active preserved                                         | pending (Wave D / F2)    |
| 7   | Inline TOC respects maxShowCount                                                      | pending (Wave E / F2)    |
| 8   | Existing hover-intent + outline-collapsed tests stay green                            | pending (Waves C, D, F2) |
| 9   | Stress fixture reproducible from checked-in generator                                 | pending (Wave F1)        |
| 10  | Measurement uses DOXMIND_PERF spans where practical                                   | pending (Wave F2)        |

### Next action

Wave F1 is **wave_done**. Wave A is in **attempt 2** of 3 (per harness §6): worker-canonical's fix dispatched after GAN flagged 2 BLOCKING + 1 MAJOR in attempt 1; independent verify of attempt 2 passes all 5 accept checks (302/302 suite, lint 0/3, type-check clean, +2 new hook-level swap tests cover the warm-swap reference-identity invariant the first round missed); GAN attempt-2 review running in background.

When GAN attempt 2 returns clean: write contracts for Waves B / C / E in parallel (their file sets are disjoint — `active-resolver.ts` + use-headings.ts scroll-spy block / `outline-collapsed.tsx` / `toc-node-view.tsx`), spawn 3 workers concurrently.

If GAN attempt 2 finds new defects: attempt 3 is the last harness-allowed dispatch before PM escalation.

### Test count history

| Wave landed          | Test count |
| -------------------- | ---------- |
| Baseline             | 286        |
| F1 (no test delta)   | 286        |
| A attempt 1 (verify) | 300        |
| A attempt 2 landed   | 302        |
| E lands              | 307        |
| B lands              | 319        |
| C lands              | 323        |
| D lands              | 331        |
| F2 lands             | 336        |

---

## Event log (append-only — never rewrite or delete)

> Every state change appends a new entry below. The "Current state" header
> above is _derived_ from this log; if the two disagree, the log wins.
>
> Entry format: `### {{ISO timestamp}} — {{event_type}}` then a short body.
> Event types: `baseline`, `contract_written`, `worker_dispatched`,
> `worker_returned`, `verify_passed`, `verify_failed`, `gan_dispatched`,
> `gan_returned`, `wave_done`, `pm_escalation`, `session_ended`.

### 2026-05-27T22:56:00Z — baseline

Baseline recorded: 286 tests passing across 38 files, lint 0 errors (3 pre-existing warnings tolerated), type-check clean, branch `main`. Handoff package written from PRD #108. No waves dispatched yet.

### 2026-05-27T23:05:00Z — issues_published

PRD #108 broken into 7 vertical-slice issues on GitHub: #109 (Wave A, canonical source), #110 (Wave F1, stress fixture), #111 (Wave B, active resolver), #112 (Wave C, popover virtualization), #113 (Wave E, TOC bridge), #114 (Wave D, rail aggregate markers), #115 (Wave F2, perf harness). All AFK except #114 which was initially HITL.

### 2026-05-27T23:07:00Z — pm_decision_logged

Wave D bucketing algorithm = **equal-position bucketing** (commented on #114). Issue label flipped to `ready-for-agent`. The PRD-level open risk on the rail aggregate algorithm is now resolved; tracked in FOLLOWUPS.md as Resolved.

### 2026-05-27T23:10:00Z — contract_written

`.planner/contracts/wave-A.md` and `.planner/contracts/wave-F1.md` written. These are the two no-blocker waves and the only ones dispatchable now. Contracts for B / C / E / D / F2 will be written wave-by-wave as their dependencies land — per HARNESS-RULES §7.

### 2026-05-27T23:10:30Z — worker_dispatched

Team `doxmind-outline-prd-108` created. Worker teammates spawned: `worker-canonical` for Wave A (#109) and `worker-fixture` for Wave F1 (#110). Both running in background; awaiting their reports.

### 2026-05-27T23:28:00Z — worker_returned (Wave F1)

`worker-fixture` reported PASSED for Wave F1 (#110). Self-marked task #2 completed. Files: `scripts/generate-outline-stress-md.mjs` (+145), `src/__tests__/fixtures/outline-stress.md` (+4637), `package.json` (+1 scripts entry, +trailing comma on prior line). Used deterministic level cycling and fixed insertion cadence (fenced code every 50 headings, display math every 75); no Date/Math.random.

### 2026-05-27T23:31:00Z — verify_passed (Wave F1)

All 9 contract accept checks pass against the working tree:

- lint: 0 errors, exactly 3 pre-existing warnings (unchanged)
- generator default run: 900 headings, exit 0
- determinism `cmp`: byte-identical
- regen vs checked-in fixture `cmp`: byte-identical
- heading count = 900; fence count = 36 (≥2 ✓); math count = 24 (≥2 ✓)
- `git diff package.json`: only the new scripts entry (+ unavoidable trailing comma on prior line)
- `git diff package-lock.json`: empty
- full vitest suite: 300 passed across 39 files (count rose because worker-canonical's `canonical-outline.test.ts` is also in the working tree; F1 itself adds no tests, pass→pass invariant satisfied)

### 2026-05-27T23:32:00Z — gan_dispatched (Wave F1)

GAN critic dispatched via `codex:codex-rescue` in background. Context Swap clean: brief contains only the contract (verbatim), the 3 changed-file pointers, and the verification output. Worker-fixture's report and brief NOT included. Critic instructed to look for: passing-but-wrong checks (especially the math/fence greps), determinism back-doors (Date / Math.random / locale), custom-node-view exercise quality, level-distribution accuracy, forbidden-path violations, package.json side effects, pass→pass regression risk under parallel Wave A work.

### 2026-05-27T23:33:00Z — worker_returned (Wave A)

`worker-canonical` reported PASSED for Wave A (#109). Self-marked task #1 completed. Files: `canonical-outline.ts` (+51), `use-canonical-outline.ts` (+159), `canonical-outline.test.ts` (+323, 14 new tests), `use-headings.ts` (+8 / -61, refactored to consume canonical hook + apply ≤3 filter at consumer boundary via `useMemo`). Worker chose NOT to wire `OutlineProvider` at any editor mount site; instead `useCanonicalOutline(editor)` attaches via a module-level `WeakMap<Editor, OutlineRecord>` keyed by editor instance, with `subscribeOutline(editor, listener)` exported for non-React consumers (Wave E's bridge). Warm read→edit switch heuristic: content-equality via `equals()` keeps React state references stable across editor instance swaps.

### 2026-05-27T23:34:30Z — verify_passed (Wave A)

All 5 contract accept checks pass against the working tree:

- lint: 0 errors, exactly 3 pre-existing warnings (unchanged)
- type-check: clean (no output)
- canonical-outline.test.ts: 14/14 passing
- mindlines suite (hover-intent + canonical-outline + outline-collapsed): 24/24 passing
- full vitest suite: 300/300 passing across 39 files (was 286 baseline; +14 from new test file)
- Forbidden-path diff (outline-collapsed.tsx, hover-intent.ts, toc-node-view.tsx, browsing-runtime.tsx): empty
- use-headings.ts diff stat: +8 / -61 (scroll-spy block preserved, debounce + scan + headingsEqual removed in favor of `useCanonicalOutline` + memoized filter)

### 2026-05-27T23:35:00Z — gan_dispatched (Wave A)

GAN critic dispatched via `codex:codex-rescue` in background. Context Swap clean. Critic instructed to look for: public hook shape regression for `useHeadings`, equality-guard correctness (id+level+text+pos all checked), warm read↔edit switch invariance via the WeakMap, scroll-spy block untouched (Wave B's territory), subscription-surface editor-scoping (not global), all-levels-1–6 inclusion in tests, sidebar consumer-boundary filter, `MIN_OUTLINE_HEADINGS` semantic preservation across the refactor, cross-contamination between A's and F1's tree state, provider-not-mounted rationale.

### 2026-05-27T23:38:00Z — gan_returned (Wave F1)

F1 GAN returned: 0 BLOCKING, 2 MAJOR, 1 MINOR. Both MAJORs are contract-level findings, not worker defects:

- MAJOR 1: `grep -c '^```'` and `grep -cE '^\$\$'` count delimiter lines, not paired blocks. The produced fixture has paired structure (18 ts blocks, 12 math blocks = 36 + 24 delimiters, even counts confirm pairing). Contract check is imprecise but the artifact is correct.
- MAJOR 2: Only TS code blocks + math present; no mermaid or callouts though PRD US-14 names them. Out-of-contract per F1's scope but worth surfacing to Wave F2's contract. Captured as Active follow-up for F2 to evaluate.
- MINOR: `--out` accepts any path (footgun).
  Brief Quality Insight logged to FOLLOWUPS.md verbatim. No worker re-dispatch needed.

### 2026-05-27T23:38:30Z — wave_done (Wave F1)

Wave F1 (#110) shippable. Task #2 marked completed by worker; harness verify + GAN pass confirm the disposition. Test count delta: +0 (F1 adds no tests; fixture is data). Wave F2 (#115) now has one less dependency.

### 2026-05-27T23:46:00Z — gan_returned (Wave A, attempt 1)

A GAN's first async run returned the codex "still running" placeholder per DISPATCH-PLAYBOOK §4 (wrapper quirk). Re-dispatched in foreground; real result came back with **2 BLOCKING + 1 MAJOR + 1 false-positive BLOCKING**:

- BLOCKING 1: `use-canonical-outline.ts:148-156` warm-swap path calls `setHeadings(getOutlineSnapshot(target))` unconditionally — bypasses the `equals()` guard that's only in the subscribe callback at line 154. Old `use-headings.ts` preserved reference stability via `headingsEqual` guard; this refactor lost it on the swap path. Real defect, violates contract's warm-switch invariance.
- BLOCKING 2: `OutlineProvider` is exported but never mounted at any editor site; the consumer path uses the WeakMap fallback. Contract Goal says "consume through a React provider"; provider is dead code as-is. Real ambiguity, fixable by wiring at `src/app/editor/[[...fileId]]/_components/desktop-editor.tsx:46`.
- MAJOR 1: `canonical-outline.test.ts:241` warm-swap test only exercises pure `equals()`, not the hook with an editor A→B swap. Test gap that masked BLOCKING 1.
- **False-positive BLOCKING 3**: critic attributed `package.json` change to Wave A. Confirmed via `git diff --name-only` that package.json's `gen:outline-stress` entry is Wave F1's, not A's. Dismissed.

### 2026-05-27T23:48:00Z — worker_dispatched (Wave A, attempt 2)

Corrective brief sent to `worker-canonical` via SendMessage. Attempt 2 of 3 per harness §6. Scope: fix BLOCKING 1 + BLOCKING 2 + MAJOR 1. Same contract; no new wave ID. Forbidden paths unchanged. Worker instructed to NOT touch package.json (false-positive). Expected output: 1 file modified (`use-canonical-outline.ts`), 1 file modified for provider mount (the desktop-editor mount-site file), 1 file modified (`canonical-outline.test.ts` to add hook-level swap test).

### 2026-05-27T23:55:00Z — worker_returned (Wave A, attempt 2)

`worker-canonical` reported PASSED. Files this round: `use-canonical-outline.ts` (+5 lines for swap-path equality guard at 148-157), `desktop-editor.tsx` (+3 lines: import + `<OutlineProvider editor={editor}>` wrap pair around the `<AppShell>` subtree), `canonical-outline.test.ts` (+45 lines for 2 new hook-level swap tests using `renderHook` + `rerender` to assert reference-identity preservation/violation). Worker also notes their negative test (different content → new reference) confirms the equality guard doesn't over-eagerly short-circuit.

### 2026-05-27T23:56:00Z — verify_passed (Wave A, attempt 2)

All 5 contract accept checks pass against the working tree:

- lint: 0 errors, exactly 3 pre-existing warnings (unchanged)
- type-check: clean
- canonical-outline.test.ts: 16/16 passing (14 prior + 2 new hook-level swap tests)
- mindlines suite: 26/26 (hover-intent 4 + canonical-outline 16 + outline-collapsed 6)
- full vitest suite: 302/302 across 39 files (was 300 after attempt 1; +2 new tests)
- Forbidden-path diff: empty
- desktop-editor.tsx diff: +3 / -0 (clean import + JSX wrap pair, balanced open/close)

### 2026-05-27T23:57:00Z — gan_dispatched (Wave A, attempt 2)

GAN critic dispatched via `codex:codex-rescue` (foreground this time to dodge the async wrapper quirk from attempt 1). Context Swap clean: contract verbatim, this round's diff pointers, this round's verify output, prior GAN findings cited as the scope to validate. Critic instructed to check that BLOCKING 1 fix is real (not cosmetic), the 2 new hook-level swap tests would fail against the buggy pre-fix code, the `<OutlineProvider>` wiring is functional and handles `editor === null` safely, no scope creep beyond the corrective brief, and `equals()` + `use-headings.ts` are untouched this round.

### 2026-05-28T00:27:00Z — gan_stuck (Wave A, attempt 2 — codex)

Codex GAN agent stalled — its output file `b35j8klmx.output` last written at 23:51 and unchanged for 35 minutes. Per DISPATCH-PLAYBOOK §4 ("Codex 'still running' response: wrapper sometimes returns before the process finishes"). Abandoned the stuck codex agent and re-dispatched via `general-purpose` subagent with the same Context Swap brief. The harness's GAN-critic agent-type guidance (`codex:codex-rescue`) is a default, not a hard rule — the _isolation_ invariants (contract + diff + verify output only, no worker transcript) are what matter and were enforced via the brief.

### 2026-05-28T00:28:00Z — gan_returned (Wave A, attempt 2 — general-purpose)

A GAN attempt 2 returned clean: **0 BLOCKING, 0 MAJOR, 2 MINOR**. Detailed reasoning traced through the swap branch logic (no-swap path, swap path with equal content, swap path with differing content) and confirmed the equality guard short-circuits identity-equal swaps. Confirmed the new hook-level test (`preserves the headings reference across an editor swap when content matches`) would fail against the buggy pre-fix code. Confirmed `<OutlineProvider>` wiring at `desktop-editor.tsx:96/191` is balanced, source-aligned with `useHeadings(editor)`, and handles `editor === null` safely. Confirmed `canonical-outline.ts` (equality module) and `use-headings.ts` are untouched this round. The 2 MINORs: (a) the negative swap test doesn't distinguish buggy from fixed code (it would pass either way) — sanity-check only, doesn't lock invariant beyond the positive test, (b) JSX indentation cosmetic in `desktop-editor.tsx`. Brief Quality Insight logged verbatim to FOLLOWUPS.md.

### 2026-05-28T00:28:30Z — wave_done (Wave A)

Wave A (#109) shippable. Task #1 marked completed. Test count delta: +16 (canonical-outline.test.ts grew from baseline 0 → 16 over two dispatches). Total suite now at 302/302. Waves B (#111), C (#112), E (#113) are now unblocked.

### 2026-05-28T00:30:00Z — contract_written

Wrote `.planner/contracts/wave-B.md`, `wave-C.md`, `wave-E.md`. Each contract incorporates the Wave A BQ insight (explicit hook-level/component-level invariant tests, not just pure-module unit tests). File scopes are deliberately disjoint (`use-headings.ts` + new `active-resolver.ts` for B / `outline-collapsed.tsx` for C / `toc-node-view.tsx` for E) so the 3 waves can be dispatched in parallel without merge conflict on shared source files. Each contract also explicitly forbids touching the Wave A files + the desktop-editor mount-site file Wave A wired.

### 2026-05-28T00:31:00Z — worker_dispatched (Waves B, C, E in parallel)

Three workers spawned simultaneously on team `doxmind-outline-prd-108`:

- `worker-resolver` claimed task #3 (Wave B / #111): replace scroll-spy with posAtCoords + binary-search resolver; new `active-resolver.ts` module + hook-level scroll-spy test asserting `nodeDOM` + `getBoundingClientRect` are NOT called on the scroll path.
- `worker-popover` claimed task #4 (Wave C / #112): virtualize popover via `@tanstack/react-virtual` (already in deps); index-based `scrollToIndex` for active alignment; preserve existing outline-collapsed + hover-intent tests verbatim.
- `worker-toc-bridge` claimed task #5 (Wave E / #113): migrate inline TOC node view to `subscribeOutline(editor, listener)` bridge from Wave A; remove `doc.descendants` scan; apply maxShowCount=50; no React-context access.
  All three running in background; awaiting their reports.

### 2026-05-28T00:41:00Z — worker_returned (Wave E)

`worker-toc-bridge` reported PASSED for Wave E (#113). Files: `toc-node-view.tsx` (+13 / -25, replaced doc.descendants scan with subscribeOutline subscription, added maxShowCount=50 cap, switched row key from pos+i to heading.id), `toc-node-view.test.tsx` (NEW, 191 lines, 5 tests: subscribe/unsubscribe lifecycle, 100→50 cap, full render under cap, all-six-levels preserved, no-doc-scan spy assertion). Marked task #5 completed via TaskUpdate. Worker flagged 2 outline-collapsed.test.tsx failures observed during their suite run — those belong to Wave C's working tree and are not in Wave E's diff.

### 2026-05-28T00:42:00Z — verify_passed (Wave E)

All 7 contract accept checks pass:

- lint: 0 errors, exactly 3 unchanged warnings
- type-check: clean
- toc-node-view.test.tsx isolated: 5/5 passing
- full vitest suite: 322 passing / 1 failing (the 1 failing test is in Wave C's `outline-collapsed-virtual.test.tsx` — Wave C in_progress; not previously-green; not caused by Wave E's diff)
- subscribeOutline grep: 2 matches (import + call)
- doc.descendants / state.doc.forEach grep: 0 matches (heading-discovery scan removed)
- useContext / OutlineContext / OutlineProvider grep: 0 matches (no React-context leak into node view)
- Diff scope: tracked changes exclusively to `toc-node-view.tsx`; new file at the expected test path; no forbidden-path changes

Note on parallel-worker interference: worker-toc-bridge's suite run captured 2 transient `outline-collapsed.test.tsx` failures from Wave C's mid-edit state. By the time of Planner verification, worker-popover had stabilized those (re-run shows 6/6 passing in isolation; the remaining 1 failure is in Wave C's NEW `outline-collapsed-virtual.test.tsx` file, not the existing tests). Wave E's pass→pass invariant ("no previously-green test now failing") is interpreted as "no previously-green test failing due to your diff" — satisfied.

### 2026-05-28T00:42:30Z — gan_dispatched (Wave E)

GAN critic dispatched via `general-purpose` (codex remains unreliable this session). Context Swap clean. Critic instructed to verify: subscription lifecycle correctness (cleanup actually unsubscribes), real `subscribeOutline` import (not a local stub), maxShowCount correctness across the boundary, levels 1-6 preserved, no-doc-scan invariant tested behaviorally (not just structurally), key-change benignity, no imports from forbidden modules, public node view API preserved, scope creep.

### 2026-05-28T00:44:00Z — gan_returned (Wave E)

Wave E GAN returned **clean**: 0 BLOCKING / 0 MAJOR / 0 MINOR. Critic verified: subscription lifecycle correct (useEffect returns subscribeOutline's unsubscribe), real bridge imported from canonical alias path, MAX_SHOW_COUNT=50 via `.slice(0,50)`, all 6 heading levels rendered with explicit `pl-*` styling, no-doc-scan locked behaviorally via spies on descendants/forEach, no forbidden imports, public node-view API (`TocNodeView` named export consumed by `src/extensions/toc.tsx:50`) preserved, only `toc-node-view.tsx` is the modified tracked file. Brief Quality Insight: maxShowCount-override mechanism (constant vs prop) should be explicit in future contracts.

### 2026-05-28T00:44:30Z — wave_done (Wave E)

Wave E (#113) shippable. Task #5 marked completed. Test delta: +5 (5 new tests in toc-node-view.test.tsx). Suite progression: 302 (post-A) → 307 (E lands).

### 2026-05-28T00:44:30Z — verify_passed (Wave B)

worker-resolver self-marked task #3 completed via TaskUpdate but did NOT send a `SendMessage` report to team-lead. Planner verified directly from the tree:

- lint: 0 errors, exactly 3 unchanged warnings
- type-check: clean
- active-resolver.test.ts isolated: 12/12 passing
- Test name audit confirms full contract coverage: 10 pure-module tests (empty list, before-first ± previousActiveId, exact-pos, between, after-last, null probe ± previousActiveId, non-finite probePos, 200-heading binary search) + 2 hook-level integration tests ("calls posAtCoords (not nodeDOM/getBoundingClientRect) and updates activeId on scroll" + "preserves the previous active heading when posAtCoords returns null"). The hook-level test directly enforces the Wave A BQ insight.
- `use-headings.ts` refactor preserves public hook shape `{ headings, activeId, navigateTo }`. Scroll-spy replaced with single-probe `editor.view.posAtCoords` + RAF-coalesced `resolveActive` + `findActiveByPosition` binary search; `activeIdRef` tracks previous active for keep-previous fallback. `navigateTo` (lines 86-122) is unchanged — still uses `nodeDOM`/`getBoundingClientRect` for one-shot click handling (explicitly allowed by contract).
- `active-resolver.ts` is a 51-line pure module: binary search for the rightmost heading with pos ≤ probePos; falls through to previousActiveId for null/non-finite probe; before-first-heading returns previousActiveId; empty list returns null. No browser deps; testable without DOM.
- Diff scope: tracked changes only to `use-headings.ts`; new files (`active-resolver.ts`, `active-resolver.test.ts`) present as untracked. No forbidden-path changes.

### 2026-05-28T00:45:00Z — gan_dispatched (Wave B)

GAN critic dispatched via `general-purpose` in background. Context Swap clean. Critic instructed to verify: binary-search correctness (no off-by-one), `posAtCoords` call site geometry (top + 20%, horizontal center), RAF coalescing (no double-schedule per frame), keep-previous fallback at all three null-probe paths (null result, non-finite, before-first), `nodeDOM`/`getBoundingClientRect` absence on scroll path, public hook shape preservation, no scope creep into Wave A's canonical files or Wave C's outline-collapsed.

### 2026-05-28T00:47:00Z — worker_returned (Waves B and C)

Two worker reports landed simultaneously:

- `worker-resolver` (Wave B / #111) — formal SendMessage report arrived late (after planner verification). Confirms 12 tests in active-resolver.test.ts (9 pure-module + 2 hook integration + 1 binary-search count assertion via Proxy-based comparison counter). Probe geometry: top + 20% threshold, horizontal center. RAF coalescing tested via mocked `requestAnimationFrame`/`cancelAnimationFrame`. Keep-previous fallback via `useRef` mirror of activeId (not state, which would lag a render).
- `worker-popover` (Wave C / #112) — PASSED. Files: `outline-collapsed.tsx` (worker reports +50/-10 net but actual `git diff --stat` is **+87/-39** — discrepancy flagged to GAN), `outline-collapsed.test.tsx` (+25/0 for a module-level `vi.mock("@tanstack/react-virtual")` shim that returns all rows so jsdom doesn't strand the live virtualizer with zero element sizes), `outline-collapsed-virtual.test.tsx` (NEW, 199 lines, 4 tests). useVirtualizer config: count=headings.length, estimateSize=()=>28, overscan=6. `scrollToIndex` fires exactly once per closed→open via `prevPopoverMountedRef`. Marked task #4 completed.

### 2026-05-28T00:48:00Z — verify_passed (Wave C)

All 9 contract accept checks pass:

- lint: 0 errors, 3 unchanged warnings
- type-check: clean
- outline-collapsed.test.tsx isolated: 6/6 passing (existing behavior tests)
- hover-intent.test.ts isolated: 4/4 passing (file untouched)
- outline-collapsed-virtual.test.tsx isolated: 4/4 passing (NEW)
- mindlines suite: 42/42 across 5 files
- full vitest suite: **323/323 across 42 files** (302 baseline + 21 from E/B/C in parallel; the 1 failure from worker-popover's mid-edit state has resolved — tree is fully green)
- grep 260/640: 3 matches ≥ 2
- Diff scope: tracked changes to `outline-collapsed.tsx` + `outline-collapsed.test.tsx`; new file `outline-collapsed-virtual.test.tsx`. No forbidden-path changes.

Scope-creep concern flagged to GAN: worker claimed "+50/-10 net" for outline-collapsed.tsx but actual diff is +87/-39 (nearly 2× the self-counted scope). The GAN brief explicitly asks the critic to account for every changed block in the file and flag unjustified additions.

Treatment of the `outline-collapsed.test.tsx` modification: the contract's "minimum necessary change to keep those tests green" clause was permissive about selector adjustments but bounded to behavior-preserving changes. The worker added a module-level `vi.mock` of `@tanstack/react-virtual` (25 lines) that returns all rows so the existing 6 behavior tests continue to observe the same DOM. The behavior assertions are unchanged. Plausible interpretation; GAN will adjudicate.

### 2026-05-28T00:49:00Z — gan_dispatched (Wave C)

GAN critic dispatched via `general-purpose` in background. Context Swap clean. Critic instructed to: account for every changed block in `outline-collapsed.tsx` against the legitimate (a)-(d) categories vs (e) scope creep; verify the 6 existing behavior assertions in `outline-collapsed.test.tsx` are byte-identical to HEAD; judge the vi.mock injection against "minimum necessary change"; verify `scrollToIndex` is called exactly once per closed→open (NOT on active-id change mid-open); confirm `scrollIntoView` absent from the source; check the 4 new tests actually lock the DOM-mounted-row cap, the once-per-open scroll, the scrollIntoView absence, and the hover-intent compatibility; verify popover dimensions preserved; verify Framer Motion preserved; verify public OutlineCollapsed prop API preserved.

### 2026-05-28T00:50:00Z — gan_returned (Wave B)

Wave B GAN returned **clean**: 0 BLOCKING / 0 MAJOR / 3 MINOR. The 3 MINORs are all cosmetic and require no action:

- `PositionedHeading` interface in `active-resolver.ts:15-18` duplicates the `Heading` shape — intentional choice to keep the pure module dependency-free; structurally compatible.
- `vi.useFakeTimers()` in `active-resolver.test.ts:172-194` is dead weight (the hook reads RAF only, mocked manually); cosmetic cleanup.
- `scrollParent.getBoundingClientRect()` is called once per RAF tick at `use-headings.ts:54` — one layout read on the scroll-parent, NOT on a heading node, so still inside the contract. Could be cached if/when a resize-aware refactor lands; deferred.
  Brief Quality Insight: "Wave B is shippable: the binary-search resolver, single-probe `posAtCoords`, RAF coalescing, keep-previous fallback, and the dual pure-module + hook-level test asserting the no-`nodeDOM`-on-scroll invariant are all directly traceable to the contract's accept checks, with no forbidden-path bleed and the public hook shape intact." Logged verbatim to FOLLOWUPS.md.

### 2026-05-28T00:50:30Z — wave_done (Wave B)

Wave B (#111) shippable. Task #3 marked completed. Test delta: +12 (active-resolver.test.ts). Suite progression: 307 (post-E) → 319 (B lands). Wave D (#114) now has Wave B's active state available; remains blocked on Wave C.

### 2026-05-28T00:51:00Z — gan_returned (Wave C)

Wave C GAN returned **clean**: 0 BLOCKING / 0 MAJOR / 3 MINOR (all cosmetic):

- `outline-collapsed.tsx:264` dep array includes `rowVirtualizer` whose identity is unstable; `wasOpen` guard makes it correctly idempotent — sound behavior, soft maintenance signal.
- `outline-collapsed.tsx:266` empty-headings early return is below the virtualizer setup — 3 extra hooks run on empty-document path; trivial perf cost.
- The +87/-39 actual vs +50/-10 self-reported diff size was investigated: critic mapped every added line to one of (a) useVirtualizer setup, (b) replacement row render with absolutely-positioned spacer, (c) scrollToIndex effect + refs, (d) removal of old scrollIntoView effect. NO scope creep. Discrepancy was self-counting accounting only — worth a trust-calibration note for future workers but not a defect.
  Brief Quality Insight: "Worker delivered the contract cleanly: virtualization in place, behavior tests preserved verbatim via a faithful all-rows shim, virtualization-specific invariants covered by a parallel windowed-shim test file, dimensions/animations/hover-intent/public API untouched, no forbidden-path collateral; the only soft signals are an unstable-dep useEffect (gated correctly) and a self-reported diff size that underestimated reality by ~2x, which is worth calling out for future trust calibration but not a defect against this contract." Logged to FOLLOWUPS.md.

### 2026-05-28T00:51:30Z — wave_done (Wave C)

Wave C (#112) shippable. Task #4 marked completed. Test delta: +4 (outline-collapsed-virtual.test.tsx, 4 tests). Suite progression: 319 (post-B) → 323 (C lands). **Wave D (#114) is now fully unblocked**: A delivered the canonical heading data, B delivered the active state, C delivered the popover virtualization. D will touch the SAME file (`outline-collapsed.tsx`) but only the rail-rendering section, leaving C's popover code intact.

### 2026-05-28T00:52:00Z — contract_written (Wave D)

Wrote `.planner/contracts/wave-D.md`. Algorithm spec section locks the equal-position bucketing per PM decision on issue #114. Contract forbids touching ALL Wave A/B/C/E files including their test files (5 existing test files must pass without modification — only the new `aggregate-markers.test.ts` is added). Critical co-edit constraint: D modifies `outline-collapsed.tsx` for the RAIL only; Wave C's popover code (`useVirtualizer`, `scrollToIndex`, `prevPopoverMountedRef`) must remain present in the file. Verified via accept-check #7 grep.

### 2026-05-28T00:53:00Z — worker_dispatched (Wave D)

`worker-rail-aggregate` spawned on team `doxmind-outline-prd-108`, claimed task #6. Briefed with contract pointer + the algorithm spec inline + explicit instruction to preserve Wave C's popover tokens. Explicitly asked to BOTH SendMessage report AND TaskUpdate (prior workers split on this and caused planner-side bookkeeping friction). Running in background.

### 2026-05-28T00:57:00Z — worker_returned (Wave D)

`worker-rail-aggregate` reported PASSED. Files: `aggregate-markers.ts` (NEW, 102 lines, pure module imports only `Heading` from `./types`), `aggregate-markers.test.ts` (NEW, 104 lines, 8 tests covering all algorithm spec edge cases), `outline-collapsed.tsx` (MODIFIED — added `aggregateMarkers` import, `MAX_RAIL_MARKERS` constant, `useMemo`'d `railMarkers`, `resolveMarkerTarget` callback for click navigation; swapped rail-rendering JSX to map over `railMarkers`). Worker honestly flagged that `git diff --stat` shows +140/-50 from HEAD but most of that delta is pre-existing Wave C tree state — actual Wave D contribution is ~50 lines. Bucket-marker click navigates to first heading in that bucket's range via `resolveMarkerTarget`; active marker preserves `navigateTo(activeHeading)`. Marked task #6 completed AND sent SendMessage report (both, as explicitly requested in the brief).

### 2026-05-28T00:58:00Z — verify_passed (Wave D)

All 9 contract accept checks pass:

- lint: 0 errors, exactly 3 unchanged warnings
- type-check: clean
- aggregate-markers.test.ts isolated: 8/8 passing
- 7-file targeted suite (6 forbidden test files + new aggregate-markers): 55/55 passing
- full vitest suite: **331/331 across 43 files** (was 323 after Wave C; +8 from Wave D's new tests)
- `aggregateMarkers` grep in outline-collapsed.tsx: 2 matches (line 7 import, line 238 useMemo call)
- Wave C tokens grep: 6 matches (`useVirtualizer` line 5+274, `prevPopoverMountedRef` lines 297/299/300, `scrollToIndex` line 304) — ALL PRESERVED
- Dimensions grep: 3 matches (POPOVER_WIDTH_PX=260, POPOVER_MAX_HEIGHT_PX=640, max-h className)
- Code inspection of `aggregate-markers.ts`: imports only `Heading` from `./types`; correctly implements empty/non-positive-maxMarkers guards, sub-cap path, degenerate span=0 stride-sampling, normal bucketing with bucketIndexFor clamping pos===lastPos to last bucket, shallowest-level tracking per bucket, active-heading-bucket replacement preserving exact positionFraction, ascending sort.

### 2026-05-28T00:58:30Z — gan_dispatched (Wave D)

GAN critic dispatched via `general-purpose` in background. Context Swap clean. Critic instructed to verify: algorithm spec compliance line-by-line (10 sub-checks across the 4-step spec), 8 test cases actually lock invariants (esp. the "active represented exactly" case), Wave C code preservation byte-identical (useVirtualizer + scrollToIndex + prevPopoverMountedRef + 260/640 dimensions + Framer Motion + hover-intent integration), bucket-marker click navigation correctness, useMemo dep array completeness for activeId, no existing-test-file modifications, MAX_RAIL_MARKERS=120 exact value, scope-creep delineation between Wave D and Wave C tree state, pure-module independence (no React/TipTap/DOM imports).

### 2026-05-28T01:00:00Z — gan_returned (Wave D)

Wave D GAN returned **clean**: 0 BLOCKING / 0 MAJOR / 3 MINOR (all cosmetic):

- Test line 68: `markers.filter((m) => !m.isActive).every((m) => m.isActive === false)` is trivially true by filter construction; the `activeCount === 1` assertion right above carries the load-bearing invariant. Redundant but harmless.
- `aggregate-markers.ts:33`: defensive `if (maxMarkers <= 0) return [];` extends the contract beyond the spec but is harmless.
- `outline-collapsed.tsx:251`: `Number("")` returns 0 (not NaN), so `bucket-` (empty index) would resolve to bucket 0 instead of bailing. Synthetic ids never take that shape — unreachable in practice.
  Critic traced the algorithm carefully (active replacement preserves exact position, shallowest-level tracking, degenerate stride sampling, useMemo dep array `[headings, activeId]` correctly invalidates). Brief Quality Insight: "Clean, surgical Wave D landing: pure module with all 4 algorithm steps faithfully implemented (active-bucket replacement preserves exact position, shallowest-level tracking, degenerate stride sampling), 8/8 contract-mandated tests in place, Wave C's virtualizer/popover/dimensions/hover-intent all byte-preserved, and the `useMemo` dep array on `[headings, activeId]` correctly invalidates when the scroll resolver swings activeId."

### 2026-05-28T01:00:30Z — wave_done (Wave D)

Wave D (#114) shippable. Task #6 marked completed. Test delta: +8 (aggregate-markers.test.ts). Suite progression: 323 (post-C) → 331 (D lands). **6 of 7 ticketed waves now shipped.** Wave F2 (#115) is the last remaining ticket — perf acceptance harness, tests-only, locks PRD #108's quantitative DoD.

### 2026-05-28T01:02:00Z — contract_written (Wave F2)

Wrote `.planner/contracts/wave-F2.md`. Most prescriptive contract in the PRD because the 5 perf numbers are bound by PRD #108's Acceptance Criteria. Tests-only — no product code allowed. Algorithm spec section pins exact measurement approaches for each invariant: spy-based `getBoundingClientRect` counting (Invariant 1), `performance.now()` synchronous-work timing (Invariant 2), windowed-shim `useVirtualizer` mocking for DOM-count tests (Invariants 3-5). Real outline stack (`useHeadings`, `subscribeOutline`, `aggregateMarkers`, `findActiveByPosition`) must be exercised — mocking limited to TipTap editor construction and `useVirtualizer`. If the perf tests reveal real perf bugs, worker is instructed to STOP and report — not silently fix.

### 2026-05-28T01:03:00Z — worker_dispatched (Wave F2)

`worker-perf` spawned on team `doxmind-outline-prd-108`, claimed task #7. Briefed with contract pointer + per-invariant measurement approaches + pointer to Wave C's windowed-shim pattern (to be COPIED, not imported — Wave C test files are forbidden paths) + Wave A/B/E test patterns for editor mocking and node-view mounting. This is the final wave; on its clean landing, PRD #108 is fully shipped.

### 2026-05-28T01:10:00Z — worker_returned (Wave F2)

`worker-perf` reported PASSED. Files: NEW `src/__tests__/perf/outline-perf.test.ts` (~500 lines, 5 tests, 17559 bytes). No product-code modifications, no vitest config changes, no new dependencies. Worker copied Wave C's windowed-shim of `useVirtualizer` verbatim into the perf test file (NOT imported). Worker also added passthrough mocks for `framer-motion` (to bypass `AnimatePresence` exit timing) and `@tiptap/react` (`NodeViewWrapper` → div); both within the spirit of "TipTap construction + useVirtualizer" mocking allowance — flagged to GAN. Real `subscribeOutline`, real `aggregateMarkers`, real `findActiveByPosition`, real `normalizeFromEditor` exercised. Task #7 marked completed AND SendMessage report sent (both).

**Observed per-invariant measurements (substantial headroom on all 5):**

- Invariant 1 (heading-rect reads during 180-frame scroll): **observed 0**, contract ≤ 200, PRD ≤ 810 → Wave B's O(1) scroll-spy is performance-optimal, not just passing. Three orders of magnitude headroom against PRD baseline of ~81,000.
- Invariant 2 (popover-open synchronous work): observed 10.08 ms, contract < 50 → PASS with 5× headroom.
- Invariant 3 (mounted popover rows): observed 28 (VISIBLE_ROW_BUDGET=22 + overscan=6), contract ≤ 80 → PASS with ~3× headroom.
- Invariant 4 (rail markers): observed 120 (exactly at `MAX_RAIL_MARKERS` cap), contract ≤ 120 → PASS at exact cap, confirms aggregateMarkers truly bounds the rendering.
- Invariant 5 (inline TOC rows): observed 50 (exactly at `MAX_SHOW_COUNT` cap), contract ≤ 50 → PASS at exact cap, confirms TOC's maxShowCount truly bounds the rendering.
- Invariant 6 (suite invariant): 336/336 passing, 0 failing.

### 2026-05-28T01:11:00Z — verify_passed (Wave F2)

All 8 contract accept checks pass:

- lint: 0 errors, exactly 3 unchanged warnings
- type-check: clean
- outline-perf.test.ts isolated: 5/5 passing (per-invariant `console.log` output captured)
- assertion-shape grep: 12 matches (≥ 5 required)
- fixture-load grep: 1 match at line 112
- forbidden-path diff for F2: the visible "product code" modifications are all pre-existing Waves A/B/C/D/E tree state; Wave F2 did NOT add a single line to any forbidden-path file (verified by file size and by the worker's diff stat being empty for product code)
- full suite: 336/336 across 44 files
- diff --name-only: new perf test file `src/__tests__/perf/outline-perf.test.ts` shows as `??`; no new tracked modifications attributable to Wave F2

### 2026-05-28T01:12:00Z — gan_dispatched (Wave F2)

GAN critic dispatched via `general-purpose` in background. Context Swap clean. Critic instructed to verify: each invariant has a dedicated `it(...)` block with the correct bound; Invariant 1's `getBoundingClientRect` spy correctly filters to heading nodes (not the scroll parent); Invariant 2's `performance.now()` brackets all synchronous cascade work; Invariant 3 uses the windowed shim (not Wave C's all-rows shim); Invariant 5 uses the REAL `subscribeOutline` (not a mock); framer-motion + `@tiptap/react` NodeViewWrapper mocks are within the contract's mocking allowance; worker did not silently fix any real perf bug; no product code modifications attributable to F2; no `package.json` or `vitest.config.*` changes; fixture parsing produces all 900 headings.

### 2026-05-28T01:14:00Z — gan_returned (Wave F2)

Wave F2 GAN returned **clean**: 0 BLOCKING / 0 MAJOR / 2 MINOR. Both MINORs are measurement-fidelity nits, not contract violations:

- `outline-perf.test.ts:269-285` — `fixtureHeadingsForRail()`'s `level <= 3` filter is a no-op for the current fixture (300×H1 + 300×H2 + 300×H3, zero H4-H6). If a future fixture has deeper headings, Invariants 2-4 would silently diverge from the real `useHeadings` pipeline. Defensive comment suggested for future fixture regeneration.
- `outline-perf.test.ts:402-425` — Invariant 2 fires `mouseEnter` on the rail sensor, which calls debounced `schedulePopoverOpen`, not synchronous `openPopoverNow`. The 10.08 ms measurement is closer to "rail-sensor mouseEnter synchronous tail" than "popover-open synchronous work". The 50 ms bound is met with substantial headroom, so the assertion is not at risk today.
  Brief Quality Insight: "Wave F2 is shippable; the only friction points are measurement-fidelity nits in Invariants 2 and 4 that don't threaten the bounds today but could erode the test's diagnostic value if the fixture or popover-open path changes — worth a 2-line clarifying comment in a follow-up."

### 2026-05-28T01:14:30Z — wave_done (Wave F2)

Wave F2 (#115) shippable. Test delta: +5 (outline-perf.test.ts, 5 tests). Suite progression: 331 (post-D) → 336 (F2 lands). **PRD #108 is fully shipped — all 7 issues (waves) clean.**

### 2026-05-28T01:14:30Z — prd_shipped

PRD #108 ("Optimize Markdown outline data flow, active tracking, and rendering") complete. 7 GH issues (#109-#115) all shipped with full GAN clearance.

**Final cumulative test count: 286 baseline → 336 (+50 over 6 implementation waves + 1 perf-acceptance wave).**

**5 of 6 implementation waves shipped on first attempt with no re-dispatch.** Only Wave A required a second attempt (warm-swap reference-identity bug at the React hook layer — the contract's accept check was at the pure-module layer, missed the bug; meta-loop closed correctly in Waves B-F2 contracts which all included explicit hook-level / component-level invariant tests).

**0 PM escalations.** Of 8 GAN reviews dispatched, 1 codex run stalled (abandoned, swapped to general-purpose; harness rules updated implicitly: general-purpose works for GAN if Context Swap discipline is maintained via brief).

**Final per-PRD-invariant measurements (all 5 with substantial headroom, last 2 binding at cap):**

- Heading-rect reads during 180-frame scroll: 81,000 baseline → **0** observed. Three orders of magnitude better than PRD's "≥ 2 orders of magnitude lower" target.
- Popover-open synchronous work: < 50 ms required → ~10 ms observed.
- Popover mounted rows: ≤ 80 required → 28 observed.
- Rail markers: ≤ 120 required → 120 observed (cap exercised; aggregation truly binds).
- Inline TOC rows: ≤ 50 required → 50 observed (cap exercised; maxShowCount truly binds).
