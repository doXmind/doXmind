# Dispatch Playbook

Operational guide for dispatching workers efficiently. Read once on first boot,
refer back when something unusual happens mid-wave.

**Prerequisite:** Read `HARNESS-RULES.md` first. It defines the role split
that this playbook operates within.

---

## 1. Principles (non-negotiable)

1. **Contract before code.** Write `.planner/contracts/wave-{ID}.md`
   _before_ the Worker brief. The contract is the only spec the GAN
   Critic will score against. Brief without a contract = scope drift.

2. **Self-contained briefs.** Workers have zero memory. If you wouldn't
   understand the brief as a stranger, neither will they. Always state:
   goal, working dir, what exists, what to create, what NOT to touch,
   env setup, acceptance commands, rollback rule, report format.

3. **Verify-or-it-didn't-happen.** Never trust a worker's self-report.
   After every dispatch, run every accept check from the contract
   yourself with Bash and read the output.

4. **Context Swap.** The GAN Critic spawns in a fresh subagent and
   receives ONLY: contract + diff + verification output. Never the
   Worker's brief, transcript, or your reasoning. See HARNESS-RULES §3.5.

5. **Bounded autonomy.** Workers don't expand scope. Any unrequested
   change in the diff is a scope violation.

6. **Failure as data.** Failed runs carry signal. If a brief was ambiguous,
   fix the brief. If three workers fail for different reasons, the task
   decomposition is wrong.

7. **Progressive disclosure.** Dispatch in dependency order. Never dispatch
   wave N+1 while wave N is unverified.

8. **Budget discipline.** 3 real attempts per atomic task. After 3,
   escalate to PM. API/infra failures don't count.

---

## 2. Worker brief template

```
Goal: {{one sentence, imperative voice}}

Working directory: /Users/rickielin/Sandbox/doxmind/local-desk

State you inherit:
- {{what already exists}}
- {{critical gotchas — inline them, don't link}}

Files to create:
- {{path}} — {{one-sentence purpose}}

Files to modify:
- {{path}} — {{what change}}

Scope fence:
- Do NOT {{specific temptation}}
- Do NOT add dependencies unless the brief lists them

Environment:
  cd /Users/rickielin/Sandbox/doxmind/local-desk
  npm install   # only if package.json changed; otherwise skip
  # no env vars needed; Markdown outline path is frontend-only

Acceptance criteria (run these, paste output verbatim):
  npm run lint              # expect: 0 errors, 3 pre-existing warnings tolerated
  npm run type-check        # expect: clean
  npm test -- --run         # expect: ≥286 tests passing (baseline)
  {{any targeted vitest pattern, e.g. npm test -- --run src/__tests__/components/editor/mindlines}}

Rollback rule: if any acceptance command fails, revert all edits
and report FAILED with stderr. Do NOT "fix forward".

Report format:
- Files created (with line counts)
- Files modified (with +/- line counts)
- Acceptance outputs (verbatim)
- Any surprises
- "PASSED" or "FAILED" as the last line
```

### Brief smells (fix before dispatching)

- "Use the existing pattern from X" without naming X — inline the path
  or quote the pattern (e.g. `src/components/editor/mindlines/use-headings.ts:43-87`).
- "Follow the same approach as Wave Y" — workers don't know Wave Y.
- Acceptance commands that depend on a running dev server — prefer in-process
  vitest. Outline work is frontend-only; no FastAPI needed.
- Scope fences as "please try not to" — use "Do NOT". Workers are literal.
- "Update the README / CLAUDE.md" mentioned incidentally — README is its own wave.

---

## 3. Verification rubric (Planner-side, after every worker)

Run IN ORDER. Don't skip. The contract at `.planner/contracts/wave-{ID}.md`
drives steps 2–4 — copy the accept-check commands verbatim from the contract,
don't reinvent them.

1. **Did the files actually appear?**
   `git status --short | grep {{expected paths}}`

2. **Run every accept check in the contract.**
   Each one must produce the expected exit code / output. Zero tolerance
   for "close enough."

3. **Pass→pass invariant.**
   `npm test -- --run` — previously-green tests must still be green.
   Test count should go UP by new tests and DOWN by zero.
   Baseline at session start: **286 tests passing across 38 files.**

4. **Did the worker stay in scope?**
   `git diff --stat` — anything outside the brief's file list AND outside
   the contract's allowed paths is suspect.

5. **Did the worker touch anything in the contract's forbidden paths?**
   Hard fail if so — re-dispatch with a tighter brief, do not "fix forward."

6. **Append `verify_passed` (or `verify_failed`) event to STATUS.md log.**

If 1-5 pass and the event is logged, proceed to GAN dispatch.

## 3.5 GAN dispatch checklist (Context Swap enforcement)

Before sending the GAN brief to `codex:codex-rescue`, verify the brief
contains ONLY these four blocks (see HARNESS-RULES §3.5 + §4 GAN template):

- [ ] **Role statement** — "adversarial reviewer, defect list only"
- [ ] **Contract** — verbatim contents (or path if short and stable)
- [ ] **Diff** — `git diff` output or changed-file contents
- [ ] **Verification output** — the lint/test/accept-check outputs you
      just produced in §3

The brief MUST NOT contain:

- [ ] ~~The Worker's brief~~ (would leak Worker's frame)
- [ ] ~~The Worker's self-report or PASSED/FAILED line~~
- [ ] ~~Any prior session transcript or chat history~~
- [ ] ~~Your reasoning about why the Worker did what it did~~

If you catch yourself wanting to add "context for the Critic", that is a
signal the contract is incomplete. Fix the contract for _the next_ wave;
do not smuggle context to this wave's Critic.

---

## 4. Dispatch infrastructure

### When to use each agent type

| Task type                  | Dispatch via                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Code writing               | `general-purpose` Agent (preferred for this PRD — frontend TS), or `codex:codex-rescue` |
| Adversarial review (GAN)   | `codex:codex-rescue` with review-only brief                                             |
| Broad codebase exploration | `Explore` subagent                                                                      |
| Documentation lookup       | `context7` MCP or `WebSearch` directly                                                  |

### Known quirks

- **Codex "still running" response:** wrapper sometimes returns before the
  process finishes. Files may already be written. Verify with Bash before
  deciding whether to retry.
- **Sandbox restrictions:** some worker environments block package managers
  or cache dirs. Outline work is JS/TS only — `node_modules` is checked in
  the existing venv, so `npm test -- --run` should work without extra setup.
- **CWD drift:** Bash CWD can reset between calls. Always use absolute
  paths in verification commands.
- **Vitest watch leak:** workers may run `npm test` without `--run` and hang
  in watch mode. Briefs MUST specify `npm test -- --run`.

---

## 5. Task sizing guide

Good atomic task for one dispatch:

- 1-4 files created
- 0-2 files modified
- 1 acceptance cycle (lint + targeted test + full suite)
- ~60-line brief

Split signals:

- Wave needs >4 new files -> split into sub-waves
- Brief has "Phase 1... Phase 2..." -> two briefs
- Two unrelated concerns in one brief -> two briefs

---

## 6. Handling failures

### First failure

- (a) Brief ambiguity -> rewrite brief, re-dispatch. Counts as attempt 1.
- (b) Environmental -> fix env, re-dispatch. Does NOT count.
- (c) Real code bug -> narrow corrective brief. Counts as attempt 2.
- (d) Design flaw -> STOP. Return to PM.

### Second failure

Smaller, more targeted brief.

### Third failure

Escalate to PM. The decomposition is wrong.

---

## 7. Post-wave checklist

After each wave completes the full chain (contract -> worker -> verify -> GAN -> clean):

- [ ] `STATUS.md` event log appended with `wave_done`; derived header rewritten
- [ ] `FOLLOWUPS.md` — any new issues caught added to Active items
- [ ] `FOLLOWUPS.md` — **Brief Quality Insights** section appended with the
      one-line insight the GAN Critic returned (mandatory, even if clean)
- [ ] `WAVES.md` updated (if next wave scope shifted)
- [ ] Contract at `.planner/contracts/wave-{ID}.md` left untouched as historical record
- [ ] Ready to write the _next_ wave's contract before dispatching
