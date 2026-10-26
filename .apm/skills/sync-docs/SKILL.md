---
name: sync-docs
description: After a code change, sweep the diff for documentation impact — stale gotchas/exemplars, decisions that need an ADR, specs to complete — and fix them in the same MR.
user-invocable: true
disable-model-invocation: false
---

# Sync docs with the current diff

Run before creating an MR
(or when asked). Principle: **the diff pays its doc debt in the same MR.**

## Step 1 — Get the diff

`git diff <integration-branch>...HEAD` (fall back to `git diff` + `git status` for
uncommitted work).

## Step 2 — Sweep for impact (checklist)

For each changed file, check:

1. **Gotcha constraints** — does any `.agentic/gotchas.md` entry cite a changed file
   as `evidence:`, or make a claim this diff invalidates? → correct or delete the
   entry; bump `verified:`.
2. **Exemplars** — did the diff change (or delete) a file listed in the exemplars
   table? If the canonical shape evolved, update the pointer or re-verify the entry.
3. **Decisions** — does the diff contradict an active ADR? That's an undocumented
   supersession → `/decide`. Does it *embody* a new decision with real alternatives?
   → `/decide`.
4. **Specs** — does the diff complete a plan in `.agentic/specs/`? → move it to
   `completed/`.
5. **CLAUDE.md** — did commands, ports, or hard-rule-relevant facts change? → update
   the table (and verify the new command runs). If CLAUDE.md indexes ADRs by area
   or lists manual prerequisites (secrets, external setup), add the new ADR number
   or the new step there. Never add a per-feature write-up to CLAUDE.md: that
   belongs in the ADR and in gotchas.

## Step 3 — Anti-bloat rule

While sweeping, do NOT add documentation that restates the diff. New docs are
justified only by the `/gotcha` admission test (code can't express it, agents would
trip, concrete evidence). When in doubt, write nothing — the code is the doc.

## Step 4 — Report

List what was updated, what was deleted, and what was deliberately not documented
(with the reason). Zero updates is a valid outcome for most diffs.
