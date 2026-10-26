---
description: Non-negotiable rules - protected branches, code over docs, measured quality gates, resolved dependency versions, no agent-run RBAC changes
---
## Hard rules

1. **Never commit or push to a protected branch.** The list lives in ONE place —
   `branches.protected` in `.agentic/quality-gates.yaml` — and is enforced from there
   by the agent hook (`protect-main.mjs`) and, where present, the human hook (`lefthook.yml`).
   Always a branch (`feature/*`, `fix/*`, `hotfix/*`) + MR.
2. **Code is the source of truth.** Docs in this repo are pointers and rationale, never
   authority on structure. On conflict, trust code and fix the doc in the same MR.
3. **Quality gates** live in `.agentic/quality-gates.yaml` — read them, never hardcode
   thresholds. Tests are written alongside implementation, never deferred.
   **Every gate there must name a measuring tool in this repo** — a threshold
   nothing measures cannot fail, so it is not a gate. Never estimate an "Actual" value
   to fill a gate table; report SKIPPED and fix the gate.
4. **Dependency versions are resolved, never recalled.** When adding a package, never
   write a version number from memory — let the tooling resolve the latest stable
   (`dotnet add package X`, `npm install X@latest`) and pin it where the repo pins
   versions (e.g. `Directory.Packages.props` under Central Package Management).
5. **Azure RBAC changes are never executed by the agent.** Prepare the exact
   `az role assignment` / `az rest` command and hand it to the user to run.
