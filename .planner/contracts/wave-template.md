# Wave {{ID}} Contract — {{short name}}

> Written by the Planner BEFORE the Worker is dispatched. This file is the
> single source of truth the GAN Critic scores against — not the brief.
> Once dispatched, this file is immutable. If the contract has to change,
> open a new wave (e.g. `wave-A1.md`) — do not edit this one in place.

**Wave:** {{ID}}
**Created:** {{ISO timestamp}}
**Branch / worktree:** {{path}}
**Baseline tests at contract time:** {{N}} passing

## Goal

{{one sentence, imperative voice — single deliverable, no alternatives}}

## Allowed paths (Worker may create or edit these)

- `{{absolute path 1}}`
- `{{absolute path 2}}`

## Forbidden paths (Worker MUST NOT touch — hard fail if diff shows changes here)

- `{{absolute path}}`
- `{{glob}}`

## Out of scope (do not implement, even if tempted)

- {{e.g. refactoring adjacent code}}
- {{e.g. adding new dependencies}}
- {{e.g. unrelated cleanup}}

## Accept checks (every command must pass; copy verbatim from here when verifying)

```bash
# 1. {{description}}
{{exact command}}
# expected: {{exit code, output substring, etc.}}

# 2. {{description}}
{{exact command}}
# expected: {{...}}
```

## Pass→pass invariant

- The full test suite (`npm test -- --run`) must report at least
  `{{N}}` passing — same as baseline. Test count may only go UP.
- Lint (`npm run lint`) must report 0 errors (3 pre-existing warnings tolerated).
- Type check (`npm run type-check`) must be clean.

## What "done" looks like (for the GAN Critic)

- All accept checks above produce the expected results.
- Diff contains only allowed-path changes.
- No forbidden-path changes.
- Pass→pass invariant holds.

If all four are true, this wave is shippable. Anything else is a defect
the Critic must surface.
