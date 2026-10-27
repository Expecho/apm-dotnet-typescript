# dotnet-ts-agentic-workflow

A spec-driven agentic development workflow for .NET and TypeScript repos, packaged for APM.

```bash
apm install Expecho/apm-dotnet-typescript#^1.0.0
```

## What's inside

**Skills**

| Skill | Purpose |
|-------|---------|
| `agentic-init` | Scaffold the `.agentic/` files below into a repo (copies missing files only, never overwrites) |
| `plan` | Write an implementation plan to `.agentic/specs/` |
| `execute-plan` | Execute a plan step by step with test gating, quality gates and an MR at the end |
| `decide` | Record an ADR in `.agentic/decisions/` |
| `gotcha` | Capture a constraint or canonical exemplar in `.agentic/gotchas.md` |
| `sync-docs` | Sweep a diff for documentation impact |
| `audit-docs` | Verify `CLAUDE.md` and `.agentic/` claims against the code |
| `spike-dotnet` | Validate an assumption with a throwaway .NET file-based app |
| `dotnet-complexity` / `ts-complexity` | Report cyclomatic complexity of changed files |
| `add-aspire` | Add Aspire orchestration to a repo |
| `switch-to-main-and-pull` | Switch to main and pull |

**Agents**: `scout` (cheap read-only fact-finder), `critic` (fresh-context adversarial reviewer of plans and diffs), `step-implementer` (implements one plan step).

**Hook**: `protect-main`, a pre-tool-use hook that blocks agent commits and pushes on protected branches. It checks the `Bash` and `PowerShell` tools.

- **Claude Code:** installed to `.claude/settings.json`. Cursor runs it through its default Claude-hook import.
- **GitHub Copilot (CLI and cloud agent):** installed to `.github/hooks/`.
- **Windows:** Copilot CLI also runs the Claude hook from `.claude/settings.json`, through PowerShell. The Claude command is wrapped in `bash -c '…'` so it still finds its script there ([github/copilot-cli#4001](https://github.com/github/copilot-cli/issues/4001)). That `bash` must resolve to Git Bash, not the WSL launcher in `System32`.

**Instructions**: `hard-rules`, `knowledge-map` and `working-agreement`, the workflow's always-on rules. They apply globally (no `applyTo`).

## Consumer setup

Instructions deploy on `apm install` to `.claude/rules/`, `.github/instructions/` and `.cursor/rules/`. Tools that only read `AGENTS.md`, such as Codex, get them after `apm compile`.

To keep your own `AGENTS.md`, add this to **your** `apm.yml`. A dependency's `compilation` settings don't apply to you.

```yaml
compilation:
  agents_md:
    mode: managed_section
```

Then put the markers where the generated rules should go, and run `apm install && apm compile`:

```markdown
<!-- apm:start -->
<!-- apm:end -->
```

Without `managed_section`, compile leaves an `AGENTS.md` you wrote yourself untouched and skips generating it.

## Expected repo layout

The skills and agents read and write these files in the consuming repo. Run `/agentic-init` once to create them from starter templates. After that they're your files: package updates never touch them.

- `CLAUDE.md`
- `.agentic/gotchas.md`
- `.agentic/decisions/` (ADRs; `0000-adr-template.md`)
- `.agentic/specs/` (plans)
- `.agentic/quality-gates.yaml`: `branches.protected` is read by the hook. Without it the hook falls back to `main`, `master` and `develop`.

The `execute-plan` skill has an `<!-- onboard:mr-command -->` marker. Replace it with your platform's MR/PR command (`gh pr create`, `glab mr create`, `az repos pr create`).

The `critic`, `scout` and `step-implementer` agents assume a Claude model tier (`sonnet` / `haiku`). Other harnesses may ignore the `model` field.

## APM vs Claude Code plugins

See [docs/apm-vs-claude-plugins.md](docs/apm-vs-claude-plugins.md): what each covers, versioning, governance, security, and the plugin standards landscape.

## APM policy and alternatives

See [docs/apm-policy-and-alternatives.md](docs/apm-policy-and-alternatives.md): what `apm-policy.yml` can enforce at install time, how discovery behaves outside GitHub, and how APM compares with other agent-config tools.

## Security demo: hidden text in a skill

See [docs/security-demo/README.md](docs/security-demo/README.md): a harmless skill carrying an instruction hidden in invisible Unicode, and how `apm audit` detects and strips it.

## Develop

```bash
apm compile --validate
apm install --dry-run
apm pack
```
