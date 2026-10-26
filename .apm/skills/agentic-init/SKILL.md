---
name: agentic-init
description: Scaffold the .agentic/ knowledge files this workflow reads (quality-gates.yaml, gotchas.md, ADR template, specs folders, doc-path check) into the current repo. Copies only missing files and never overwrites. Run once per repo, or when /plan, /execute-plan or the protect-main hook report a missing .agentic/ file.
user-invocable: true
disable-model-invocation: false
argument-hint: "[optional: repo root, defaults to cwd]"
---

# Scaffold `.agentic/`

The starter files live in `assets/` next to this SKILL.md (the installed skill folder,
e.g. `.claude/skills/agentic-init/` or `.agents/skills/agentic-init/`). Once copied they
belong to the repo: the team edits them, and package updates never touch them.

## Step 1 — Copy what's missing

| Asset | Destination |
|-------|-------------|
| `assets/quality-gates.yaml` | `.agentic/quality-gates.yaml` |
| `assets/gotchas.md` | `.agentic/gotchas.md` |
| `assets/decisions/README.md` | `.agentic/decisions/README.md` |
| `assets/decisions/0000-adr-template.md` | `.agentic/decisions/0000-adr-template.md` |
| `assets/scripts/check-doc-paths.mjs` | `.agentic/scripts/check-doc-paths.mjs` |
| `assets/scripts/check-new-code-coverage.mjs` | `.agentic/scripts/check-new-code-coverage.mjs` |

Also create `.agentic/specs/` and `.agentic/specs/completed/`, each with a `.gitkeep`.

**Never overwrite.** If a destination exists, leave it and list it as "kept" in the
report. Do not merge or "improve" an existing file.

## Step 2 — Fill `quality-gates.yaml` (only if it was just created)

- **`branches.protected`:** detect the default branch (`git symbolic-ref refs/remotes/origin/HEAD`,
  falling back to `git branch --show-current` on a fresh repo) plus any long-lived branches
  CI treats specially (`develop`, `release/*`). Confirm the list with the user.
- **`gates`:** for each gate, find the tool in this repo that measures it (CI config,
  analyzer settings, coverage tooling). Name the tool in the comment above the gate.
  **Delete every gate nothing measures** — never keep an estimated threshold. Ask the
  user only about gates whose tooling is ambiguous.
- **`coverage_new_code_pct_min`:** measured by `.agentic/scripts/check-new-code-coverage.mjs`,
  which needs a cobertura report. .NET: coverlet (`dotnet test --collect:"XPlat Code Coverage"`;
  test projects need the `coverlet.collector` package). TypeScript: Vitest
  (`--coverage --coverage.reporter=cobertura`), Jest (`--coverageReporters=cobertura`) or c8
  (`--reporter=cobertura`), with uncovered files included (`coverage.all` / `collectCoverageFrom`).
  If none of these is set up and the user doesn't want to add one, delete the gate. Otherwise
  run the tests with coverage, then the script against the base branch, to prove the gate measures.
- **`coverage_tooling`** and **`enforcement.ci`:** fill from what CI actually runs, or
  leave the placeholder with a `TODO` if there is no CI yet. Offer to add the coverage
  script to the PR pipeline after the test step.

## Step 3 — Verify and report

- Run `node .agentic/scripts/check-doc-paths.mjs` — must pass (an empty gotchas table passes).
- Report: files created, files kept, the protected-branch list, gates kept (with their
  tool) and gates deleted. Suggest `/gotcha` to record the first exemplars and `/decide`
  for the repo's first ADR.
