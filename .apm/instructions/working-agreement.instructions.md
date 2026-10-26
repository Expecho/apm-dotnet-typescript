---
description: The plan / execute / document loop - choosing a workflow, before and after a change, parallel subagents, convention enforcement
---
## Working agreement (the loop)

**Choosing a workflow:** nontrivial change → `/plan`, then `/execute-plan` (per-step
test gating) — each in a fresh session (`/clear`); the spec in `.agentic/specs/` is
the complete handoff between them. Small urgent fixes go direct — minimal diff,
regression test mandatory, always a `fix/*` or `hotfix/*` branch. Run `/audit-docs`
periodically and after large refactors.

**Before a change:** read `gotchas.md` entries for the touched area → open the relevant
exemplar file → validate assumptions with search, not memory.

**After a change:** made a decision with alternatives? → `/decide`. Hit a trap the code
can't express? → `/gotcha`. Diff invalidates a doc claim? → fix it in the same MR
(`/sync-docs`). Then run test + lint before reporting completion.

**Parallel subagents:** for read-only fan-out (verifying claims, locating shapes,
mining history) dispatch `scout` subagents (cheap model tier, evidence-or-unverified
discipline) and keep judgment in the main session. Dispatching two or more
write-capable subagents concurrently requires worktree isolation — or run them
sequentially. Parallel writers in one checkout corrupt each other's edits. For plan
steps, dispatch `step-implementer` subagents — they carry the per-step discipline;
plain subagents don't.

**Convention enforcement:** conventions are enforced by tooling (formatters and
analyzers checked in CI, git hooks and the `protect-main` agent hook for branch
protection). If you find yourself about to document a mechanical rule, add a lint
rule instead.
