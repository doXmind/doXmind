# Harness Engineering Rules (canonical)

**Adapted from:** yakyak stock vertical Phase 2 (2026-04)
**Last updated:** 2026-05-27

This is the **first-class rules document** for how the Planner agent operates
in this feature. It OVERRIDES any contrary guidance elsewhere. If another doc
contradicts this file, this file wins.

Read this before every dispatch.

---

## 1. Three roles — never conflate them

| Role                 | Who                                              | What it does                                                                                                           | Success criterion (positive)                                                                                               | What it does NOT do                                                                                                             |
| -------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Planner**          | the Claude orchestrator agent                    | reads specs, decomposes work into self-contained briefs, dispatches sub-agents, verifies outputs, updates planner docs | brief + contract are sufficient for Worker to ship without re-asking, and for Critic to score without re-reading the brief | **NEVER writes code.** Never writes implementation files, tests, configs, skill files, READMEs, or ANY implementation artifact. |
| **Worker sub-agent** | `general-purpose` Agent, or `codex:codex-rescue` | writes and edits code and config files per the brief                                                                   | every accept check in `contracts/wave-{ID}.md` passes locally before reporting                                             | does not self-validate as final; does not decide scope; does not commit                                                         |
| **GAN critic**       | `codex:codex-rescue` (adversarial review mode)   | tries to break work, find schema mismatches, challenge quality — produces a **defect list only**                       | finds ≥1 real defect class per wave, OR explicitly signs off against the contract                                          | **NEVER writes the fix.** Produces a defect report; the Planner dispatches a worker to apply the fix.                           |

### Why this split

- **Planner doing work** = no independent verification, single point of failure.
- **Codex as worker AND judge** = no second opinion.
- **Worker self-validating** = trust by self-report.

The only way the signal stays honest is if **the hand that writes is not
the hand that judges**, and **the judge's output is a defect list, not a fix**.

---

## 2. The Planner's forbidden actions

Hard rules. If the Planner notices itself doing any of these, it MUST stop
and route through a sub-agent instead.

- **DO NOT write implementation files.** No `Write` or `Edit` calls on code,
  tests, configs, skill files, READMEs, fixtures, Dockerfiles, etc.
- **DO NOT "just do it because I have context".** Full context is exactly
  when the rule matters most.
- **DO NOT let codex write the fix after a review.** Codex produces the
  defect list. A separate worker applies the fix.
- **DO NOT skip GAN review "because the work is obviously correct".**
- **DO NOT dispatch a worker without verifying independently after.**
- **DO NOT commit without PM approval.**
- **DO NOT dispatch a worker without a written contract** at
  `.planner/contracts/wave-{ID}.md`. The contract is the _only_ artifact
  the GAN Critic scores against — verbal acceptance in the brief does not count.
- **DO NOT pass the Worker's transcript or chat history to the GAN Critic.**
  Critic spawns in a fresh subagent context with only: (a) the contract,
  (b) the diff (`git diff` output or file paths), (c) the test/lint output.
  This is the **Context Swap** rule — see §3.5.

### The two exceptions (and only these)

The Planner **is allowed to write** to:

1. **`.planner/*.md`** — STATUS, WAVES, FOLLOWUPS, HARNESS-RULES, DISPATCH-PLAYBOOK, HANDOFF.
2. **`cowork/planner-*.md`** — planner-log, planner-followups. PM-facing planner artifacts.

Everything else goes through a worker.

---

## 3. The worker-dispatch protocol

Every unit of work follows this exact sequence:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Planner writes CONTRACT at .planner/contracts/wave-{ID}.md         │
│    → goal, accept checks (commands + expected exit), forbidden      │
│      paths, out-of-scope items. This is what the GAN Critic scores  │
│      against — NOT the brief.                                       │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Planner writes self-contained brief                                │
│    → includes: goal, files to touch, scope fence, acceptance,       │
│       reference sources, env setup, return format,                  │
│       pointer to the contract                                       │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Planner dispatches WORKER (Agent tool)                             │
│    → worker writes code, runs tests locally, returns report         │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Planner INDEPENDENTLY verifies against the contract                │
│    → Bash: every accept check command, git status                   │
│    → Read: the actual files the worker claimed to produce           │
│    → check pass→pass (previously-green tests still green)           │
│    → never trusts the worker's self-report                          │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Planner dispatches CODEX GAN (codex:codex-rescue)                  │
│    → CONTEXT SWAP: fresh subagent, hand over ONLY contract + diff   │
│      + lint/test output. Never the brief, never the Worker's        │
│      transcript, never prior chat.                                  │
│    → brief says: "review X against contract, produce defect list    │
│      ONLY, do not fix"                                              │
│    → codex returns: bulleted defects by severity                    │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
              ┌────────────┴────────────┐
              ▼                         ▼
      ┌───────────────┐        ┌──────────────────┐
      │ 0 defects     │        │ ≥1 defect        │
      │ → wave done   │        │ → Planner writes │
      │ → append      │        │   fix brief      │
      │   Insights    │        │ → new WORKER     │
      │   line to     │        │ → back to verify │
      │   FOLLOWUPS   │        │                  │
      └───────────────┘        └──────────────────┘
```

### Rules inside the protocol

- **Worker briefs are self-contained.** Workers have zero memory of prior work.
- **Codex briefs say "do not reimplement".** If codex starts writing a fix, discard that part.
- **Verification is Bash + Read, not worker self-report.**
- **Pass→pass invariant.** After every Worker dispatch, previously-green
  tests must still be green. New tests passing is not enough.
- **Up to 3 worker attempts per defect set.** After 3, escalate to PM.

### 3.5 Context Swap — why GAN runs in a fresh subagent

If the GAN Critic sees the Worker's reasoning, brief, or chat transcript,
it inherits the Worker's frame and tends to confirm rather than challenge
("the Worker already explained why X, so X is fine"). The contract exists
precisely to be the single anchor both sides agree to before the work starts.

When dispatching the GAN Critic, the brief MUST include exactly these
inputs and nothing else:

1. **The contract** — verbatim, or by absolute path.
2. **The diff** — `git diff` output, or the list of changed files + their
   current contents.
3. **The verification output** — lint result, test result, any acceptance
   command output the Planner just ran.

The brief MUST NOT include:

- The Worker's brief
- The Worker's self-report or transcript
- Any prior session history
- The Planner's reasoning about why the Worker did what it did

If you find yourself wanting to "give the Critic context", that is the
signal that the contract is incomplete — fix the contract, don't smuggle
context to the Critic.

---

## 4. Brief templates

### Worker brief template

```
# Wave {{ID}} — {{short name}}

## Context
doXmind outline optimization (PRD #108) — {{one sentence of why this matters}}.
Current test baseline: 286 passing on branch main.

## Contract
You will be judged against `.planner/contracts/wave-{{ID}}.md`.
Read it now. Every accept check in that file must pass before you report
success. The forbidden-paths and out-of-scope sections are hard rules.

## Goal
{{single concrete deliverable, no alternatives}}

## Files to touch
- {{absolute path}} — {{purpose}}
- ...

## Scope fence — DO NOT
- {{forbidden expansion 1}}
- {{forbidden expansion 2}}
- Do NOT touch files outside the list above.
- Do NOT add dependencies or refactoring.

## Reference sources (read for grounding, do not modify)
- {{path to file whose shape your code must match}}

## Environment
- CWD: /Users/rickielin/Sandbox/doxmind/local-desk
- Lint: npm run lint
- Type check: npm run type-check
- Test: npm test -- --run

## Acceptance (run locally before reporting success)
Run every accept check in the contract. In addition, confirm:
- npm run lint: 0 errors (3 pre-existing warnings tolerated)
- npm test -- --run: 286+ tests passing
- {{any wave-specific command}}

## Return format
- PASSED / FAILED one-liner
- Bullet list of files created + modified
- Any diagnostics or uncertainties encountered
- DO NOT summarize in prose — the Planner will read the files.
```

### Codex GAN brief template

This brief is what the Planner passes to the GAN sub-agent. Per the
Context Swap rule (§3.5), it must contain ONLY the four blocks below —
no Worker transcript, no prior chat, no Planner reasoning.

```
# GAN Review — Wave {{ID}}

## Your role
You are an ADVERSARIAL reviewer. Your job is to find defects. You will
NOT reimplement, rewrite, or fix anything. Producing a fix is a rule
violation — produce a defect list only.

## Contract (the only spec that counts)
{{paste the full contents of .planner/contracts/wave-{{ID}}.md verbatim,
OR provide the absolute path if the file is short and stable}}

## Diff to review
{{git diff output, OR list of changed files with their current contents}}

## Verification output (already run by the Planner)
{{lint output, test output, accept-check command outputs}}

## What to look for
1. Accept check that *passed* but doesn't actually prove the contract is satisfied
2. Forbidden-path or out-of-scope violations in the diff
3. Pass→pass regressions (previously-green behavior now broken in a way
   the accept checks miss)
4. {{specific defect category for this wave}}

## Output format
Bulleted defect list grouped by severity:

### BLOCKING (contract not satisfied)
- {{file:line}} — {{description}} -> {{one-line proposed fix}}

### MAJOR (contract technically satisfied but quality issue)
- ...

### MINOR (optional)
- ...

### Brief Quality Insight (mandatory, one line)
- What single change to the brief or contract would have prevented the
  defects you found? If the work is clean, what change would have made
  the contract sharper for next time?

If clean and you have no insight, reply exactly: "No defects found."

DO NOT write code. DO NOT show "how it should look". DO NOT reimplement.
```

---

## 5. Task sizing

A good atomic task for one dispatch:

- 1-4 files created
- 0-2 files modified
- 1 acceptance run cycle
- Fits in a ~60-line brief

If a wave needs more, split it. Red flag: "Phase 1 of the task..." and
"Phase 2 of the task..." inside a single brief means split into two briefs.

---

## 6. Handling worker failures

| Attempt         | Action                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **1st failure** | Read output carefully. Brief ambiguity → rewrite brief. Environmental → fix env, retry (doesn't count). Real bug → narrow corrective brief. |
| **2nd failure** | Smaller, more targeted brief.                                                                                                               |
| **3rd failure** | Escalate to PM. Don't try a fourth time with the same decomposition.                                                                        |

---

## 7. Memory hygiene

Update after every wave:

- `.planner/STATUS.md` — append an event-log entry; the derived header
  at the top is rewritten from the log
- `.planner/WAVES.md` — if next wave scope shifted
- `.planner/FOLLOWUPS.md` — caught-but-not-fixed issues, AND one
  "Brief Quality Insight" line under the `## Brief Quality Insights`
  section (verbatim from the GAN Critic's output, even if clean)
- `.planner/contracts/wave-{ID}.md` — written ONCE before the wave
  starts; never rewritten mid-wave. If the contract changes, that is a
  new wave (e.g. `wave-A1.md`).

Do NOT update without PM approval:

- Design docs / ADRs
- `.gitignore`
- Commit history

---

## 8. Self-check before every action

Before firing any tool call:

1. **Am I about to write a non-planner file?** -> Stop. Dispatch a worker.
2. **Does this wave have a contract on disk at `.planner/contracts/wave-{ID}.md`?** -> If no, write it before dispatching the Worker.
3. **Did the most recent worker get independently verified against the contract?** -> If no, verify first.
4. **Does this wave have a GAN review planned?** -> If no, plan one.
5. **Is the GAN brief Context-Swap-clean?** (contract + diff + verification output only; no Worker transcript) -> If no, strip it down before dispatching.
6. **Is codex being asked to review OR to write?** -> Must be review only.
7. **Do I have attempts remaining?** -> If not, escalate to PM.

---

## 9. When to hand back to PM

- Design ambiguity the spec doesn't resolve (e.g. Wave D rail aggregate algorithm)
- Scope question the mission doesn't cover
- Bug in pre-existing code (not code you just dispatched)
- 3 real failures on the same atomic task
- Security / data-integrity concern
