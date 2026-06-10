# Wave E Contract — Inline TOC node-view bridge + maxShowCount

> Written by the Planner BEFORE the Worker is dispatched. This file is the
> single source of truth the GAN Critic scores against — not the brief.
> Once dispatched, this file is immutable. If the contract has to change,
> open a new wave (e.g. `wave-E1.md`) — do not edit this one in place.

**Wave:** E
**GitHub issue:** [#113](https://github.com/doXmind/local-desk/issues/113)
**Created:** 2026-05-28T00:30:00Z
**Branch / worktree:** `main` at `/Users/rickielin/Sandbox/doxmind/local-desk`
**Baseline tests at contract time:** 302 passing across 39 files (Wave A landed clean)

## Goal

Migrate the inline TOC custom block (currently independently scans the document via `doc.descendants()` on every transaction) to consume the canonical outline source from Wave A through the editor-scoped subscription bridge `subscribeOutline(editor, listener) → unsubscribe` (exported from `src/components/editor/mindlines/use-canonical-outline.ts:100`). Apply a `maxShowCount` cap (default 50) so the block does not render hundreds of entries in large documents. Heading levels 1–6 are preserved; the sidebar's level-≤3 filter does NOT apply here.

## Allowed paths (Worker may create or edit these)

- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/toc-node-view.tsx` (MODIFY — remove `doc.descendants()` heading scan; subscribe to `subscribeOutline(editor, listener)` for data; apply `maxShowCount` cap)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/editor/toc-node-view.test.tsx` (NEW — node-view tests for the bridge subscription path and the cap behavior; create this file if it does not already exist)

The Worker MUST NOT introduce React context or React-tree dependencies inside the node view. The node view runs outside the app's React provider tree by default; the explicit bridge (`subscribeOutline`) is the contract surface.

## Forbidden paths (Worker MUST NOT touch — hard fail if diff shows changes here)

- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/canonical-outline.ts` (Wave A landed; pure data module is locked)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/use-canonical-outline.ts` (Wave A landed; subscription surface is locked — use it, do not modify it)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/use-headings.ts` (Wave A + Wave B territory)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/outline-collapsed.tsx` (Wave C territory)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/editor/mindlines/hover-intent.ts`
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/workspace/browsing-runtime.tsx`
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/app/editor/[[...fileId]]/_components/desktop-editor.tsx` (Wave A wired the provider; do NOT modify)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/editor/mindlines/canonical-outline.test.ts` (Wave A test file)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/editor/mindlines/outline-collapsed.test.tsx` (Wave C territory)
- `/Users/rickielin/Sandbox/doxmind/local-desk/package.json` (no new dependencies)
- `/Users/rickielin/Sandbox/doxmind/local-desk/CLAUDE.md`, any `*.md` doc
- `/Users/rickielin/Sandbox/doxmind/local-desk/server/**`, `/Users/rickielin/Sandbox/doxmind/local-desk/src-tauri/**`
- Pre-existing ESLint warning fixes

## Out of scope (do not implement, even if tempted)

- React-context access from inside the node view (use the non-React `subscribeOutline` surface)
- Sidebar's level-≤3 filter (TOC keeps levels 1-6)
- Active-heading state (TOC doesn't track active)
- Aggregate rail markers (Wave D)
- Popover virtualization (Wave C)
- Touching the canonical source or subscription surface (Wave A locked them)
- New dependencies

## Accept checks (every command must pass)

```bash
# 1. Lint clean
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm run lint
# expected: 0 errors, exactly 3 unchanged warnings

# 2. Type check clean
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm run type-check
# expected: exit 0, no output

# 3. Node-view tests pass (bridge path + cap)
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run src/__tests__/components/editor/toc-node-view.test.tsx
# expected: exit 0; must cover:
#   - With 100 mock headings in the document, the rendered TOC shows at most maxShowCount (default 50) entries.
#   - When maxShowCount > total heading count, all headings render.
#   - Levels 1-6 are all preserved in the output (no filter; render at least one of each level when present in the mock).
#   - The node view subscribes to `subscribeOutline(editor, listener)` on mount and unsubscribes on unmount (verify via spy on subscribeOutline OR via testing the cleanup path).
#   - The node view does NOT call `editor.state.doc.descendants()` or `editor.state.doc.forEach()` for heading discovery — assert this with a spy on the doc method, OR with a comment in the test explaining why such a spy would mock the proxy and break the test (in which case the assertion is structural code-review only, which is acceptable).

# 4. Existing tests stay green — pass→pass invariant
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run
# expected: exit 0; ≥ 302 passing; no previously-green test now failing

# 5. Bridge usage is real, not cosmetic — explicit per the Wave A BQ insight
cd /Users/rickielin/Sandbox/doxmind/local-desk && grep -n 'subscribeOutline' src/components/editor/toc-node-view.tsx
# expected: at least one match (the node view imports and calls subscribeOutline)
cd /Users/rickielin/Sandbox/doxmind/local-desk && grep -nE 'doc\.descendants|state\.doc\.forEach' src/components/editor/toc-node-view.tsx
# expected: no match (the heading-discovery scan path is removed)

# 6. No React-context dependency leaked into the node view
cd /Users/rickielin/Sandbox/doxmind/local-desk && grep -nE 'useContext|OutlineContext|OutlineProvider' src/components/editor/toc-node-view.tsx
# expected: no match (the node view uses the non-React bridge, not the context)

# 7. Diff scope check
cd /Users/rickielin/Sandbox/doxmind/local-desk && git diff --name-only
# expected: tracked modifications include `toc-node-view.tsx`; new test file appears in `git status` via `??`. NO modifications to forbidden-path files. NO modifications to `package.json` beyond Wave F1's pre-existing entry.
```

## Pass→pass invariant

- Full vitest suite (`npm test -- --run`) reports **≥ 302 passing**. Test count may only go UP.
- Lint (`npm run lint`) reports 0 errors. 3 unchanged warnings.
- Type check clean.
- `toc-node-view.tsx` no longer scans the editor document; all heading data comes from `subscribeOutline(editor, listener)`.
- Levels 1-6 still render in TOC output.
- With more than `maxShowCount` headings, the TOC renders at most `maxShowCount` rows.

## What "done" looks like (for the GAN Critic)

- All seven accept checks pass.
- The node view imports `subscribeOutline` from `@/components/editor/mindlines/use-canonical-outline` (or the equivalent relative path) and subscribes on mount.
- No `doc.descendants()` or `state.doc.forEach()` calls for heading discovery anywhere in `toc-node-view.tsx`.
- No `useContext(OutlineContext)`, `OutlineProvider`, or any React-tree access — the bridge is the non-React surface.
- `maxShowCount` is a constant or prop, default 50. The TOC respects the cap.
- The new test file asserts the bridge subscription path AND the cap behavior.
- Diff contains only allowed-path changes.
- Pass→pass invariant holds.

If all six are true, this wave is shippable. Anything else is a defect the Critic must surface.
