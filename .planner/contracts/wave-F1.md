# Wave F1 Contract — Outline stress-fixture generator

> Written by the Planner BEFORE the Worker is dispatched. This file is the
> single source of truth the GAN Critic scores against — not the brief.
> Once dispatched, this file is immutable. If the contract has to change,
> open a new wave (e.g. `wave-F1a.md`) — do not edit this one in place.

**Wave:** F1
**GitHub issue:** [#110](https://github.com/doXmind/local-desk/issues/110)
**Created:** 2026-05-27T23:10:00Z
**Branch / worktree:** `main` at `/Users/rickielin/Sandbox/doxmind/local-desk`
**Baseline tests at contract time:** 286 passing across 38 files

## Goal

Ship a deterministic Node script that generates a 900-heading Markdown stress document for outline perf testing, plus the checked-in generated fixture, so the perf acceptance ticket (and any dev work on the preceding tickets) has a reproducible target instead of an ad-hoc local file.

## Allowed paths (Worker may create or edit these)

- `/Users/rickielin/Sandbox/doxmind/local-desk/scripts/generate-outline-stress-md.mjs` (NEW — Node ESM script; CLI flags `--count`, `--levels`, `--out`)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/fixtures/outline-stress.md` (NEW — checked-in generated artifact)
- `/Users/rickielin/Sandbox/doxmind/local-desk/package.json` (MODIFY — add one `"gen:outline-stress"` entry to `scripts`; NO new dependencies)

## Forbidden paths (Worker MUST NOT touch — hard fail if diff shows changes here)

- `/Users/rickielin/Sandbox/doxmind/local-desk/src/components/**` (all editor / mindlines / TOC source — out of scope for fixture-only ticket)
- `/Users/rickielin/Sandbox/doxmind/local-desk/src/__tests__/components/**` (no test changes outside the new fixture file)
- `/Users/rickielin/Sandbox/doxmind/local-desk/.planner/**`
- `/Users/rickielin/Sandbox/doxmind/local-desk/server/**`
- `/Users/rickielin/Sandbox/doxmind/local-desk/src-tauri/**`
- `package-lock.json` (no new deps means no lockfile changes)
- Any `.md` doc under `/docs` or `CLAUDE.md`
- Any pre-existing ESLint warning fix

## Out of scope (do not implement, even if tempted)

- Adding `unified` / `remark` / any other Markdown library — fixture generation is plain string concatenation
- Running the generator in CI (no CI workflow changes)
- Any perf test code (Wave F2 / #115)
- "Improvements" to neighboring scripts in `scripts/`

## Accept checks (every command must pass; copy verbatim from here when verifying)

````bash
# 1. Lint clean (3 pre-existing warnings tolerated, 0 errors)
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm run lint
# expected: exit code 0; warnings count exactly 3 (unchanged)

# 2. Generator runs with default args, produces the checked-in fixture path
cd /Users/rickielin/Sandbox/doxmind/local-desk && node scripts/generate-outline-stress-md.mjs --out /tmp/outline-stress-check.md
# expected: exit code 0, file /tmp/outline-stress-check.md exists, contains at least 900 lines starting with "#"

# 3. Determinism: same args → byte-identical output
cd /Users/rickielin/Sandbox/doxmind/local-desk && node scripts/generate-outline-stress-md.mjs --out /tmp/det-a.md && node scripts/generate-outline-stress-md.mjs --out /tmp/det-b.md && cmp /tmp/det-a.md /tmp/det-b.md
# expected: exit code 0 (cmp returns 0 when files are identical)

# 4. Checked-in fixture matches default generator output
cd /Users/rickielin/Sandbox/doxmind/local-desk && node scripts/generate-outline-stress-md.mjs --out /tmp/regen-fixture.md && cmp /tmp/regen-fixture.md src/__tests__/fixtures/outline-stress.md
# expected: exit code 0

# 5. Heading count is exactly 900 (default)
cd /Users/rickielin/Sandbox/doxmind/local-desk && grep -cE '^#{1,6} ' src/__tests__/fixtures/outline-stress.md
# expected: 900

# 6. Fixture exercises custom node views (at least one fenced code block and one math block)
cd /Users/rickielin/Sandbox/doxmind/local-desk && grep -c '^```' src/__tests__/fixtures/outline-stress.md
# expected: ≥ 2 (a fenced code block is opened by ``` and closed by ```)
cd /Users/rickielin/Sandbox/doxmind/local-desk && grep -cE '^\$\$' src/__tests__/fixtures/outline-stress.md
# expected: ≥ 2 (display math is delimited by $$ ... $$)

# 7. package.json gained exactly one new scripts entry, nothing else changed
cd /Users/rickielin/Sandbox/doxmind/local-desk && git diff package.json
# expected: only a single added line inside the "scripts" block: '"gen:outline-stress": "node scripts/generate-outline-stress-md.mjs"' (or equivalent with same key + same command)
cd /Users/rickielin/Sandbox/doxmind/local-desk && git diff package-lock.json
# expected: empty (no dep changes)

# 8. Full suite pass→pass invariant
cd /Users/rickielin/Sandbox/doxmind/local-desk && npm test -- --run
# expected: exit code 0; ≥ 286 passing (Wave F1 does not add tests, so the count stays at 286)
````

## Pass→pass invariant

- Full vitest suite (`npm test -- --run`) reports **≥ 286 passing**. Wave F1 adds zero new tests so the count stays at exactly 286 unless other work landed in parallel.
- Lint (`npm run lint`) reports 0 errors. Pre-existing warning count is exactly 3 and unchanged.
- `package-lock.json` is unchanged (no new dependencies).
- Diff contains no changes to forbidden paths.

## What "done" looks like (for the GAN Critic)

- All eight accept checks above produce the expected results.
- Running the generator twice with the same args produces byte-identical output.
- The checked-in fixture is the exact output of `node scripts/generate-outline-stress-md.mjs` with default flags — anyone can regenerate it.
- The fixture has 900 headings AND at least one fenced code block AND at least one display-math block.
- `package.json` change is a single `"gen:outline-stress"` script entry; no new dependencies.
- Diff contains only allowed-path changes.
- Pass→pass invariant holds.

If all six are true, this wave is shippable. Anything else is a defect the Critic must surface.
