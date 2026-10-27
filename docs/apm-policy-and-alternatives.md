# APM policy and alternatives: FAQ

Questions that come up when rolling this package out across an organisation: what `apm-policy.yml` can enforce, how it behaves outside GitHub, and how APM compares with other tools that manage agent configuration. Researched in October 2026 against the APM docs (last updated 22 October 2026, policy schema v0.2 working draft) and rulesync v37. The policy features were read from the docs, not tested end to end. Both tools move fast, so check the linked docs before relying on details.

**Short answer:** `apm-policy.yml` is an **install-time gate**. It decides which packages, MCP servers and executables may reach a developer's disk, and it is the main thing APM offers that the alternatives don't. It does not control what an agent does at runtime; that stays with the harness. Auto-discovery works for GitHub and Azure DevOps remotes. On GitLab, enforce it with a CI job instead.

## Contents

- [What does apm-policy.yml govern?](#what-does-apm-policyyml-govern)
- [What doesn't it govern?](#what-doesnt-it-govern)
- [Where does the policy live, and how is it found?](#where-does-the-policy-live-and-how-is-it-found)
- [How does inheritance work?](#how-does-inheritance-work)
- [How do enforcement modes and bypasses work?](#how-do-enforcement-modes-and-bypasses-work)
- [Does it work with GitLab?](#does-it-work-with-gitlab)
- [A starter policy for consumers of this package](#a-starter-policy-for-consumers-of-this-package)
- [How do we enforce it in CI?](#how-do-we-enforce-it-in-ci)
- [What are the alternatives to APM?](#what-are-the-alternatives-to-apm)
- [How does APM compare with rulesync?](#how-does-apm-compare-with-rulesync)
- [Which should we use?](#which-should-we-use)
- [Sources](#sources)

## What does apm-policy.yml govern?

One YAML file, owned by a platform or security team, that `apm install` and `apm audit --ci` load before anything is written to disk.

| Section | What you can do | Why it matters |
|---|---|---|
| `dependencies` | `allow` / `deny` by `owner/repo` glob (deny always wins), `require` packages in every manifest, cap `max_depth`, and `require_pinned_constraint` | Only vetted sources get in; a shared baseline reaches every repo; no silent updates from a moving `main` |
| `mcp` | Allow or deny servers, restrict transports (`stdio`, `sse`, `http`, `streamable-http`), treat inline-defined servers as `allow` / `warn` / `deny`, and refuse transitive servers unless allow-listed | MCP servers are the most direct path for data to leave a machine |
| `executables` | One ceiling over hooks, `bin/`, self-defined MCP, LSP and canvas extensions: `deny_all`, `deny`, `require`, `recommend` | Stops code execution arriving inside "just a skill" |
| `compilation` | Allowed targets, enforced strategy, required source attribution in compiled output | Standardises supported harnesses; generated files are traceable |
| `manifest` | Required fields, ban `scripts:`, restrict content types, require an explicit `includes:` list | Reviewable, consistent `apm.yml` files |
| `unmanaged_files` | `ignore` / `warn` / `deny` files in target directories that aren't in `apm.lock.yaml` | Surfaces hand-dropped agent files that bypassed review |
| `security` | Content-hash requirement, drift as a failing exit code, required external scanners | Tamper detection. Requires the `external-scanners` experimental flag. |
| `registry_source` | Force every dependency through a configured registry (for example an Artifactory mirror) | Proxied or air-gapped supply chain. Experimental (`registries` flag). |

`require_pinned_constraint` accepts exact versions, `^` / `~` / bounded ranges, literal tags and SHAs. It rejects a missing ref, `*`, a bare branch and an open `>=X.Y`. The install line in this repo's README (`#^1.0.0`) passes.

## What doesn't it govern?

From the schema docs: it is not a runtime permission system. It doesn't control what an agent may read, write or call once running, sandboxing, agent behaviour, or which tools a harness exposes. Those belong to the harness, for example Claude Code managed settings (see [APM vs Claude Code plugins](apm-vs-claude-plugins.md#can-plugins-be-pinned-and-governed)).

The same split applies to this package's `protect-main` hook: policy decides whether the hook gets installed, the harness decides whether it runs, and server-side branch protection remains the real enforcement point.

## Where does the policy live, and how is it found?

Discovery order:

1. **Explicit ref**, only on `apm audit --ci --policy <ref>` and `apm policy status --policy-source <ref>`. `apm install` has no `--policy` flag.
2. **Auto-discovery from the project's git remote.** APM checks the org's policy repos in order: `.github-private`, `.github`, `.apm`, `_apm`. Azure DevOps uses repository `apm-policy` in project `apm`.

An explicit ref can be a local path, an `https://` URL (plain `http://` is rejected), `org`, `<owner>/<repo>` (defaults to github.com) or `<host>/<owner>/<repo>` for GHES and other hosts. Don't embed credentials in policy URLs; use the repository forms with normal host authentication.

Remote policies are cached for `cache.ttl` seconds (default 3600). Set `fetch_failure: block` to refuse to run when the policy can't be fetched or parsed. The default, `warn`, carries on without it.

## How does inheritance work?

A policy can `extends:` a parent (`org`, `<owner>/<repo>` or an `https://` URL), up to five levels deep; cycles are rejected. The usual chain is enterprise, then org or team, then repo.

- **Tighten-only:** `enforcement` takes the stricter value, `allow` lists intersect, `deny` and `require` lists union, `max_depth` and `cache.ttl` take the minimum, and booleans like `require_pinned_constraint` OR together, so a child can't switch them off.
- **Exception:** a child can set `deny: []` or `require: []` to explicitly clear an inherited list.
- **Tri-state lists:** omitted means "no opinion", `[]` means "nothing", a list means "only these". An `allow: []` anywhere in the chain allows nothing downstream.
- **Supply-chain safe:** parents are pinned to the leaf policy's host, and if any parent is unreachable, enforcement fails closed. APM never applies a partial chain.

`apm policy status` shows the merged result with each layer's source.

## How do enforcement modes and bypasses work?

| `enforcement` | Behaviour |
|---|---|
| `off` | Loaded and reported, never blocks. Useful while drafting. |
| `warn` (default) | Violations print `[!]`, exit code 0. |
| `block` | Violations print `[x]`, exit non-zero; `apm install` aborts before writing to disk. |

Roll out with `warn`, fix what it reports (`require_pinned_constraint` in particular will flag existing projects), then switch to `block`.

**Bypasses:** `apm install --no-policy` and `APM_POLICY_DISABLE=1` skip the install gate, and also most policy checks in `apm audit --ci` when run in the same shell. Only the baseline lockfile checks can't be bypassed. `apm install --force` downgrades an audit `block` to `warn`. The install gate is therefore a convenience for developers. The control is a required CI job that doesn't set those flags, plus branch protection on the policy repo.

## Does it work with GitLab?

Partly.

| | GitLab |
|---|---|
| Packages from GitLab (`git:` dependencies, internal marketplaces on GitLab self-managed) | ✅ |
| Policy auto-discovery from a GitLab remote | ❌ not listed; the docs name GitHub repos and Azure DevOps only |
| Install-time gate in a GitLab repo | ❌ follows from the above, since `apm install` only auto-discovers |
| `apm audit --ci --policy <local path or https URL>` | ✅ |
| `--policy gitlab.example.com/group/policy-repo` | Possibly, via the `<host>/<owner>/<repo>` form; untested |
| SARIF output | Generated; designed for GitHub code scanning, so check how your GitLab version ingests it, or rely on the exit code |

The policy fetch also doesn't go through the registry proxy, which matters for air-gapped setups.

For GitLab teams (this package's `execute-plan` skill supports `glab mr create`), the practical setup is:

1. Keep `apm-policy.yml` in a central GitLab project, protected with approval rules or CODEOWNERS.
2. Add a required pipeline job that runs `apm audit --ci --policy <ref>` (see below).
3. Accept that developers won't get install-time blocking locally; they'll find out in the merge request.

## A starter policy for consumers of this package

A starting point for an org that installs this package. Start in `warn` mode and tighten from there.

```yaml
# apm-policy.yml
name: team-baseline
version: "2026.10"
enforcement: warn          # switch to block once the reports are clean
fetch_failure: block

dependencies:
  allow:
    - expecho/apm-dotnet-typescript
    - your-org/*
  require_pinned_constraint: true

mcp:
  self_defined: warn
  trust_transitive: false
  transport:
    allow: [stdio, http, streamable-http]

executables:
  recommend:
    - expecho/apm-dotnet-typescript   # the protect-main hook

unmanaged_files:
  action: warn
  directories:
    - .claude/rules
    - .github/instructions
    - .github/hooks
```

Notes:

- **`executables`:** `protect-main` is a hook, so it's an executable primitive. `recommend` lets it deploy by default unless someone denies it locally; consumers can bulk-accept with `apm approve --recommended`. `require` would make its presence mandatory but doesn't grant execution on its own. To mandate it and deploy it, list the package under both. `recommend` and `require` are exact-match in v1; confirm the canonical identity with `apm policy status`.
- **`unmanaged_files`:** keep it at `warn` at first. Consumers may have their own rules in these directories, and `.claude/settings.json` is shared with things APM doesn't manage. The `.agentic/` files created by `agentic-init` aren't in a target directory, so this check doesn't touch them.
- **`require`:** to roll this package out to every repo, add `expecho/apm-dotnet-typescript` under `dependencies.require` and decide on `require_resolution` (`project-wins`, `policy-wins` or `block`) for version conflicts.
- **`security.integrity.require_hashes`** is worth adding once the `external-scanners` flag is in use; the `security` section is ignored without it.

## How do we enforce it in CI?

```bash
apm install --frozen          # exactly what the lockfile says; fails if apm.yml and the lockfile disagree
apm audit --ci --policy org   # baseline lockfile checks + policy checks; non-zero exit on violation
```

On GitLab, replace `org` with a local path to a checked-out copy of the policy repo, or an `https://` URL. To preview locally:

```bash
apm policy status                   # which policy applies, from where
apm install --dry-run               # what the policy would block
apm audit --ci --policy ./apm-policy.yml
```

Make the job required (branch protection on GitHub, a required pipeline on GitLab or Azure DevOps). Without that, `--no-policy` is a one-flag bypass.

## What are the alternatives to APM?

| Tool | Approach | Notes |
|---|---|---|
| [rulesync](https://github.com/dyoshikawa/rulesync) | One `.rulesync/` source, generated into each tool's config | Widest harness coverage; see below |
| [skillpm](https://skillselion.com/skills/sbroenne/skillpm) | npm-style package manager for Agent Skills, published to npmjs.org | Skills declare MCP servers in `package.json`; no policy layer |
| `npx skills add` (Vercel) | Skills-only installer | APM supports it as a drop-in (`apm install vercel-labs/agent-skills`) |
| `gh skill install` | GitHub CLI skill installer | Skills only |
| [agent-rules-sync](https://pypi.org/project/agent-rules-sync/) | Background daemon syncing rules, skills, settings and MCP across tools on one machine | Personal setup, not a repo manifest |
| Claude Code plugins | Native plugin format and marketplaces | See [APM vs Claude Code plugins](apm-vs-claude-plugins.md) |

## How does APM compare with rulesync?

APM is a dependency manager with a governance layer. Rulesync is a config generator that later gained dependency features.

| | APM | rulesync |
|---|---|---|
| Model | Packages with dependencies, like npm | One source of truth, generated per tool |
| Manifest / source | `apm.yml`, `.apm/` | `rulesync.jsonc`, `.rulesync/` |
| Lockfile | `apm.lock.yaml` | `rulesync.lock` (commit SHAs and integrity hashes); `install --frozen` restores edited curated skills |
| Remote content | Any git host, subpaths, refs, transitive dependencies | `sources` in `rulesync.jsonc`, mainly skills; local skills win over remote ones with the same name; no transitive graph |
| Harnesses | Copilot, Claude Code, Cursor, Codex, Gemini, OpenCode, Windsurf, plus Grok Build and Kiro | 30+, including JetBrains Junie, Zed, Warp, Kiro, Goose and Atlassian Rovodev |
| Features per tool | Instructions, prompts, agents, skills, hooks, commands, plugins, MCP | Rules, ignore files, MCP, commands, subagents, skills, hooks, permissions; can simulate missing features |
| Migration | Install-oriented | `rulesync import` from existing configs; `rulesync convert --from cursor --to copilot,claudecode` |
| Security | Hidden-Unicode scan on install, transitive MCP gating, executables trust | Lockfile integrity, path hardening (rejects symlinks escaping the clone) |
| Org policy | ✅ `apm-policy.yml`, tighten-only inheritance, CI audit with SARIF | ❌ |
| Runtime | Python CLI (pip, Scoop, Homebrew); a community .NET NativeAOT port exists | Node CLI (npm, Homebrew, single binary) |

They also combine: rulesync has an `apm` install mode that reads `apm.yml` and `dependencies.apm` and writes the APM v1 layout (`.github/instructions/`, `.github/skills/`), with its own `rulesync-apm.lock.yaml`.

## Which should we use?

| Situation | Better fit |
|---|---|
| Many repos and teams; allow/deny lists, MCP trust and CI gating needed | APM |
| Shared packages with versions and transitive dependencies | APM |
| Tools APM doesn't target, or ignore files and permissions per tool | rulesync |
| Migrating existing `CLAUDE.md` / `.cursor/rules` into one source | rulesync |
| Syncing a personal setup across tools on one machine | agent-rules-sync |
| Both governance and long-tail tool coverage | APM for sourcing and policy, rulesync for generating the extra tools |

## Sources

- [APM: apm-policy.yml schema](https://microsoft.github.io/apm/reference/policy-schema/)
- [APM: policy files](https://microsoft.github.io/apm/enterprise/apm-policy/)
- [APM: get started with apm-policy.yml](https://microsoft.github.io/apm/enterprise/apm-policy-getting-started/)
- [APM: governance overview](https://microsoft.github.io/apm/enterprise/governance-overview/)
- [APM: governance guide](https://microsoft.github.io/apm/enterprise/governance-guide/)
- [APM: registry proxy and air-gapped installs](https://microsoft.github.io/apm/enterprise/registry-proxy/)
- [APM: targets matrix](https://microsoft.github.io/apm/reference/targets-matrix/)
- [APM PR #851: non-GitHub remotes in policy auto-discovery listed as future work](https://github.com/microsoft/apm/pull/851)
- [rulesync repository](https://github.com/dyoshikawa/rulesync) and [documentation](https://dyoshikawa.github.io/rulesync/)
- [rulesync v37.0.0 release notes](https://github.com/dyoshikawa/rulesync/releases/tag/v37.0.0)
- [skillpm](https://skillselion.com/skills/sbroenne/skillpm)
- [agent-rules-sync](https://pypi.org/project/agent-rules-sync/)
- [APM .NET port (apm-cli on NuGet)](https://www.nuget.org/packages/apm-cli)
