# Planner Follow-ups

Issues caught during execution but deliberately NOT fixed, to keep workers
on-task. Each entry: date, wave during which found, description, fix options,
owner/priority.

Items that also matter to the PM should appear in PM-facing docs as well.

---

## Active items

- **(2026-05-27, pre-dispatch)** Three pre-existing ESLint warnings in unrelated files —
  `src/components/editor/page-link-node-view.tsx:7` (`FileText` unused),
  `src/components/editor/slash-commands.tsx:43` (`Globe` unused),
  `src/components/excel-editor/excel-editor-workspace.tsx:2008` (missing `computedValueAt` dep).
  Not caused by this PRD. Workers may NOT fix as part of any wave in this feature.
- **(2026-05-27, pre-dispatch)** Inline TOC `maxShowCount` default value: bound to 50 in the
  #113 issue body. If a future design pass picks a different number, update the issue
  and the Wave E contract; no PM decision currently outstanding.
- **(2026-05-27, post-F1 GAN, for Wave F2)** F1 GAN flagged that the stress fixture only
  contains TS code blocks (every 50 headings) and display-math blocks (every 75 headings).
  PRD #108 User Story 14 names _mermaid charts_ and _callouts_ as additional custom-block
  shapes the outline must remain navigable through. Wave F2's contract MUST decide one of:
  (a) accept the current fixture as sufficient for perf acceptance — and document why
  mermaid/callouts wouldn't move the perf signal in the F2 test env, OR
  (b) request a fixture extension before running F2 — which would re-byte
  `src/__tests__/fixtures/outline-stress.md` and require regen-fixture `cmp` to be re-run.
  Recommended path: (a), because mermaid rendering and callout layout depend on browser
  paint paths that vitest's jsdom/happy-dom environment doesn't exercise; adding them to
  the fixture would add bytes without changing measured DOM-rect / row-mount counts.
- **(2026-05-27, post-F1 GAN, contract-template improvement)** F1 GAN flagged that the
  `grep -c '^```'` and `grep -cE '^\$\$'` accept checks count delimiter lines, not paired
  blocks. A correctly-generated fixture happens to satisfy them; a malformed one could
  too. For future fixture-generation contracts, use `awk` or a small Node check to
  verify _paired_ delimiters (e.g. `awk '/^```/{n++} END{exit n%2}'` returns 0 only when
  the count is even — closest available trivial pair check). Not a defect in F1 output.

- **(2026-05-28, post-Wave-A GAN, future test improvement)** A GAN flagged that the
  negative swap test in `canonical-outline.test.ts:306-326` (`produces a new headings
reference across an editor swap when content differs`) does not distinguish the fixed
  code from the buggy pre-fix code — the buggy `setHeadings(swapSnapshot)` would also
  always produce a new reference. The positive test locks the invariant; the negative
  one is only a sanity check. Not a defect that justifies re-dispatch. Future
  enhancement: strengthen by asserting subscribe-path emission semantics on the
  post-swap editor (trigger an `editor.on("update")` on editorB after swap, assert
  listener fires).

- **(2026-05-28, post-Wave-A GAN, cosmetic)** `desktop-editor.tsx:96-191` — the inner
  `<div className="desktop-window-shell …">` is not re-indented one level deeper after
  being wrapped by `<OutlineProvider>`. Type-check passes; JSX is valid. A future reader
  might be momentarily confused by the dedented child. Cosmetic; not worth a re-dispatch
  cycle.

- **(2026-05-28, contract-template insight from Wave A)** When a contract's "what done
  looks like" bullet describes a behavior that lives at multiple layers (e.g., pure-data
  module + React-hook layer), the accept-check list MUST explicitly cover each layer
  separately. Otherwise a worker can satisfy the check at the easier layer (pure-module
  unit test) while leaving the harder layer (hook-level integration test) unguarded.
  Apply this when writing Wave B/C/E contracts: each scroll-spy / virtualization /
  bridge invariant needs a hook-level OR component-level test, not only a pure-module
  test. **VALIDATED 2026-05-28 in Wave B**: the contract's mandatory hook-level test
  ("calls posAtCoords (not nodeDOM/getBoundingClientRect) and updates activeId on
  scroll") was implemented by worker-resolver as required and verified by GAN. The
  meta-loop (Wave A's GAN insight → Wave B's contract → Wave B's test coverage) closed
  correctly.

- **(2026-05-28, post-Wave-B GAN cosmetic findings, future cleanup)** Three MINOR issues
  noted by GAN that are NOT defects but could be tidied in a future pass:
  (a) `active-resolver.ts:15-18` declares a local `PositionedHeading` interface that
  duplicates the shape `Heading` already exports. The duplication keeps the module
  dependency-free (zero imports). Consolidate only if the cost outweighs the dependency
  isolation.
  (b) `active-resolver.test.ts:172-194` enables `vi.useFakeTimers()` but the hook only
  reads RAF, which is mocked separately. Dead-weight call; drop in a future cleanup.
  (c) `use-headings.ts:54` calls `scrollParent.getBoundingClientRect()` once per RAF
  tick. That's one layout read on the scroll-parent (NOT a heading node, so the
  contract holds) — could be cached across the listener lifetime if/when a resize-aware
  refactor lands.

- **(2026-05-28, post-Wave-D GAN cosmetic findings, future cleanup)**:
  (a) `aggregate-markers.test.ts:68` — redundant tautology
  `markers.filter((m) => !m.isActive).every((m) => m.isActive === false)` is true by
  filter construction; the preceding `activeCount === 1` is the load-bearing assertion.
  (b) `aggregate-markers.ts:33` — defensive `if (maxMarkers <= 0) return [];` is not in
  the spec but harmless.
  (c) `outline-collapsed.tsx:251` — `Number("")` returns 0 (not NaN), so a malformed
  `bucket-` id with no index would resolve to bucket 0 instead of bailing. Synthetic ids
  never take this shape — unreachable in practice; guard with explicit length check or
  use `parseInt(..., 10)` if hardening is desired.

- **(2026-05-28, post-Wave-F2 GAN cosmetic findings, future cleanup)**:
  (a) `outline-perf.test.ts:269-285` — `fixtureHeadingsForRail()` filters `level <= 3`
  which is a no-op for the current 300×H1 + 300×H2 + 300×H3 fixture. If the F1 stress
  fixture is ever regenerated with deeper levels, Invariants 2-4 will silently diverge
  from the real `useHeadings` pipeline. Add a defensive comment or assert
  `produced.length === parseFixtureHeadings(...).length` to lock the equivalence.
  (b) `outline-perf.test.ts:402-425` — Invariant 2 fires `mouseEnter` on the rail
  sensor, which calls debounced `schedulePopoverOpen` rather than synchronous
  `openPopoverNow`. The 10.08 ms measurement reads closer to the rail-sensor
  mouseEnter synchronous tail than the full popover-mount work. 5× headroom against
  the 50 ms bound today, but if the popover-open path grows heavier, the test could
  pass falsely. Switch to `fireEvent.click(railSensor)` or run timers inside the
  timed region.

---

## Resolved items

- **(2026-05-27)** Rail aggregate marker bucketing algorithm chosen: **equal-position
  bucketing**. Active heading's bucket is replaced by the heading's own marker so the
  active row stays exact. Decision logged on issue #114, label flipped to
  `ready-for-agent`. Wave D contract writing is now unblocked (will be written when its
  upstream dependencies — Waves A and B — land).

---

## Brief Quality Insights

> One line per wave, appended by the Planner after the GAN Critic returns.
> The content comes verbatim from the Critic's mandatory
> "Brief Quality Insight" output (see GAN brief template in HARNESS-RULES §4).
>
> Purpose: close the meta-loop on brief/contract quality across sessions.
> The next wave's Planner reads this section before writing the next contract.
>
> Entry format: `- **Wave {{ID}}** ({{date}}) — {{verbatim insight line}}`

- **Wave F1** (2026-05-27) — No determinism back-door found; no forbidden-path violations; heading distribution is perfectly balanced (300/300/300). The two MAJOR defects share the same root cause: the contract accept checks for fenced blocks and display math validate delimiter-line counts rather than structurally valid paired blocks — adding a `paired-delimiter` verification step to the contract template would catch this class of issue before Worker ships the fixture.

- **Wave A** (2026-05-28) — The contract's "What done looks like" bullet about "warm read↔edit runtime switch ... does NOT cause the canonical source to re-extract from scratch" should have been promoted to an explicit accept check covering the React hook level (not just the pure data module). The prior round's BLOCKING 1 escaped because the contract's accept check #3 only mandated "equality guard: re-running normalize on the same document state produces a structurally-equal result that React would not consider a state change" — phrased ambiguously enough that a worker could (and did) satisfy it with a pure-`equals()` unit test while leaving the hook unguarded.

- **Wave E** (2026-05-28) — The contract's accept check #3 leaves "maxShowCount as constant OR prop" ambiguous, and the worker shipped a non-overridable module-level constant — if a future caller needs a different cap (e.g. for a "show more" affordance), the surface will need a follow-up wave; specifying the desired override mechanism (or explicitly stating "constant is fine, no prop") would prevent that re-litigation.

- **Wave B** (2026-05-28) — Wave B is shippable: the binary-search resolver, single-probe `posAtCoords`, RAF coalescing, keep-previous fallback, and the dual pure-module + hook-level test asserting the no-`nodeDOM`-on-scroll invariant are all directly traceable to the contract's accept checks, with no forbidden-path bleed and the public hook shape intact.

- **Wave C** (2026-05-28) — Worker delivered the contract cleanly: virtualization in place, behavior tests preserved verbatim via a faithful all-rows shim, virtualization-specific invariants covered by a parallel windowed-shim test file, dimensions/animations/hover-intent/public API untouched, no forbidden-path collateral; the only soft signals are an unstable-dep useEffect (gated correctly) and a self-reported diff size that underestimated reality by ~2x, which is worth calling out for future trust calibration but not a defect against this contract.

- **Wave D** (2026-05-28) — Clean, surgical Wave D landing: pure module with all 4 algorithm steps faithfully implemented (active-bucket replacement preserves exact position, shallowest-level tracking, degenerate stride sampling), 8/8 contract-mandated tests in place, Wave C's virtualizer/popover/dimensions/hover-intent all byte-preserved, and the `useMemo` dep array on `[headings, activeId]` correctly invalidates when the scroll resolver swings activeId.

- **Wave F2** (2026-05-28) — Wave F2 is shippable; the only friction points are measurement-fidelity nits in Invariants 2 and 4 that don't threaten the bounds today but could erode the test's diagnostic value if the fixture or popover-open path changes — worth a 2-line clarifying comment in a follow-up.
