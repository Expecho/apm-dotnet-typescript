# APM vs Claude Code plugins: FAQ

Questions that come up when choosing between [APM](https://microsoft.github.io/apm/) and native [Claude Code plugins](https://code.claude.com/docs/en/plugins/components.md) to share an agent setup across a team. Researched and tested in October 2026 with APM CLI 0.35.0, Claude Code 2.1.310 and Copilot CLI 1.0.103, and fact-checked against the vendors' docs. Both tools move fast, so check the linked docs before relying on details.

**Short answer:** for a Claude Code-only team, plugins cover nearly everything and add features APM lacks. APM's strengths are versioning and review **per repo** (lockfile plus PR diffs), always-on instructions, dependencies on arbitrary git content, and one source for several tools (Claude Code, Copilot, Cursor and more).

## Contents

- [What is APM?](#what-is-apm)
- [Do plugins cover the same artifacts as APM?](#do-plugins-cover-the-same-artifacts-as-apm)
- [Do plugins work per user or per repo?](#do-plugins-work-per-user-or-per-repo)
- [Can team members end up on different versions?](#can-team-members-end-up-on-different-versions)
- [Can plugins be pinned and governed?](#can-plugins-be-pinned-and-governed)
- [Security: why skills and plugins are an attack surface](#security-why-skills-and-plugins-are-an-attack-surface)
- [Can an APM package contain Claude Code plugins?](#can-an-apm-package-contain-claude-code-plugins)
- [Are plugins a vendor-neutral standard?](#are-plugins-a-vendor-neutral-standard)
- [Do a package's settings apply to the consumer?](#do-a-packages-settings-apply-to-the-consumer)
- [Which should we use?](#which-should-we-use)
- [Sources](#sources)

## What is APM?

APM (Agent Package Manager, from Microsoft) is a package manager for agent configuration, comparable to npm or NuGet. Skills, agents, hooks, instructions and MCP servers go into one versioned package described by `apm.yml`. A repo installs it with one command:

```bash
apm install Expecho/apm-dotnet-typescript#^1.0.0
```

`apm install` writes plain files into the repo (`.claude/`, `.github/`, `.cursor/` and the shared `.agents/skills/`, depending on the targets) and pins exact commits in `apm.lock.yaml`. Committing the deployed files is optional; APM only gitignores `apm_modules/`. See [`apm.yml`](../apm.yml) in this repo for a complete example.

## Do plugins cover the same artifacts as APM?

Mostly, and plugins cover more Claude Code features. The one real gap is always-on instructions.

| Artifact | Claude Code plugin | APM |
|---|---|---|
| Skills | ✅ | ✅ |
| Agents | ✅ | ✅ |
| Hooks | ✅ `hooks/hooks.json` | ✅ |
| MCP servers | ✅ `.mcp.json` | ✅ |
| LSP servers | ✅ `.lsp.json` | ✅ |
| Executables (`bin/`) | ✅ added to the shell's `PATH` | ✅ Claude Code only, user-scope installs (`apm install -g`) only. Deployed with a warning by default; an opt-in trust gate (`executables:` policy, `apm approve`) can require approval. |
| Commands / prompts | ✅ (legacy `commands/`) | ✅ |
| **Always-on instructions / rules** | ❌ no `CLAUDE.md` or rules equivalent | ✅ installed to `.claude/rules/` (and `AGENTS.md` after `apm compile`) |
| Output styles, themes | ✅ | Not in APM's primitive list |
| Monitors, workflows, channels, mods | ✅ | Not in APM's primitive list |
| User configuration prompts (`userConfig`, secrets in secure storage) | ✅ | Not in APM's primitive list |
| Third-party content as a dependency | ✅ any git repo or subfolder, via a marketplace entry that someone writes and hosts (the entry can act as the manifest). Plugin-to-plugin dependencies must be plugins. | ✅ referenced directly: any git repo, subfolder, plugin or MCP server |

From the Claude Code docs: *"To include instructions in a plugin, write them as a skill. Claude Code doesn't load a `CLAUDE.md` at the plugin root."* A skill only loads when its description matches the task, so rules that must apply every session need a workaround in a plugin:

- a `SessionStart` hook that injects them as context;
- a plugin `settings.json` that sets `agent`, running one of the plugin's agents (with its system prompt) as the main thread;
- an output style; or
- copying them into the repo's `CLAUDE.md` once, after which package updates no longer reach them.

## Do plugins work per user or per repo?

Both. Plugins have three install scopes you choose from, plus a `managed` scope set by an administrator:

| Scope | Where it's recorded | Who gets it |
|---|---|---|
| `user` | `~/.claude/settings.json` | You, in every repo |
| `project` | the repo's `.claude/settings.json` (committed) | Everyone working in that repo |
| `local` | the repo's `.claude/settings.local.json` (not committed) | Only you, only in that repo |

A repo can therefore declare which plugins it uses (`extraKnownMarketplaces` and `enabledPlugins`). But marketplace plugins are copied into each user's cache (`~/.claude/plugins/cache/`), not into the repo. Consequences:

- **Trust first:** a repo's marketplace is only registered after the user accepts the folder's trust dialog. In `-p` or CI runs, only if the folder was already trusted. Cloud sessions don't add a repo's marketplaces at all.
- **Not always installed automatically:** when a marketplace entry points at a separate repo (the common setup), each contributor sees "enabled in project settings but isn't installed here" until they run `claude plugin install <plugin>@<marketplace> --scope project`.
- **No version in the repo:** the version comes from the plugin or its marketplace entry, not from anything committed in the consuming repo.
- **Changes skip the consuming repo's review:** a plugin update doesn't appear as a diff in the repo's pull requests.
- **CI, headless and cloud runs:** need the plugin installed there too (network access to the marketplace, auth for private ones, or a pre-built seed directory).

**Plugins committed in the repo:** a plugin folder with a `.claude-plugin/plugin.json` under the repo's `.claude/skills/<name>/` (a "skills-directory plugin") loads in place from the checkout, after the folder is trusted. Its content is then committed and reviewed like any file. Limits: its MCP servers need per-server approval, monitors don't load, and you copy and update the files yourself, without a lockfile, version resolution or upstream updates. That copying and updating is what APM automates.

A marketplace kept in the same repo doesn't give you this: a git-hosted marketplace is cloned per user into `~/.claude/plugins/marketplaces/`, so plugins load from that clone, not from your current branch.

With APM, when the deployed files and the lockfile are committed, all of the above follows from the commit.

## Can team members end up on different versions?

**With plugins: yes.** Each person's copy updates on its own schedule:

- Auto-update is off by default for third-party marketplaces (on for Anthropic's official one). Someone who never updates (`claude plugin update <plugin>@<marketplace>`, or **Update** in `/plugin`) stays on what they first installed. `claude plugin marketplace update` alone only refreshes the catalog.
- If a plugin pins a `version` (in `plugin.json` or its marketplace entry), people keep their cached copy until that string changes, however many commits are pushed. Without a pinned version, git-based plugins are versioned by commit SHA, so new pushes arrive once the marketplace refreshes and the plugin updates.
- Auto-update runs in the background some minutes into a session, and the running session keeps its loaded version until `/reload-plugins` or a restart.

A managed `extraKnownMarketplaces` entry with `autoUpdate: true` narrows the gap, but there's still a window, and nothing in the repo records who runs which version.

**With APM: the version follows the commit, not the person.** Everyone on the same commit has the same files. Someone on an older branch has the older version, which is intended and recorded. Exceptions:

- **Uncommitted local changes:** someone runs `apm update` or edits a deployed file. Visible in `git status`; `apm audit` reports drift from the lockfile.
- **Deployed files gitignored:** a developer's local copy lags until they re-run `apm install` after the lockfile changes. CI is unaffected: `apm install --frozen` installs exactly what the lockfile says, and refuses to run if `apm.yml` and the lockfile disagree.
- **Personal setup on top:** APM doesn't control a user's own `~/.claude` skills, user-scope plugins or personal `CLAUDE.md`. Only managed settings can restrict those: `strictPluginOnlyCustomization` for non-plugin skills, agents, hooks and MCP servers; `strictKnownMarketplaces`, `blockedMarketplaces` and managed `enabledPlugins` for plugins; `instructionFiles: managed-only` for personal `CLAUDE.md` files.

## Can plugins be pinned and governed?

Yes. They pin and govern in a different place than APM:

| | Claude Code plugins | APM |
|---|---|---|
| Pin to a tag or commit | ✅ `ref` and `sha` on the marketplace entry; `sha256` for zip (`archive`) sources | ✅ `ref`, plus the exact commit in `apm.lock.yaml` |
| Version ranges | ✅ for dependencies between plugins (semver against git tags) | ✅ |
| Updates | Off by default; users run them, or an admin turns on auto-update | `apm update` rewrites the lockfile and deployed files; you commit them and review the change in a PR |
| Org-wide enforcement | ✅ **stronger than APM:** managed settings can force-enable plugins (users can't turn them off), allow or block marketplaces (`strictKnownMarketplaces`, `blockedMarketplaces`), and block sideloading (`disableSideloadFlags`) | An org policy (`apm-policy.yml`, schema in early preview) is discovered and enforced on every `apm install`; `apm audit --ci --policy` adds a CI gate |
| Usage tracking | ✅ OpenTelemetry events; Analytics API on Enterprise | ❌ |
| Hidden-Unicode scan | Not documented | ✅ `apm audit`, and a check during install |
| Where versions are recorded | Per plugin, in `plugin.json` or the marketplace entry (or the commit SHA when unset), outside the consuming repo | Per repo, in `apm.lock.yaml` |
| Where changes are reviewed | In the marketplace repo | In each consuming repo's pull request |

Managed settings need a Claude Team or Enterprise plan (server-managed settings) or MDM / a managed settings file.

## Security: why skills and plugins are an attack surface

Skills, agent instructions, hooks and MCP servers are code:

- Instructions steer what an agent does with your repos, credentials and shell.
- Hooks and MCP servers run on your machine with your permissions.
- A malicious or compromised skill can hide prompt injection in invisible Unicode characters, quietly change a hook in an update, or add an MCP server that sends data out.

Without central control, anyone can install these from anywhere, unreviewed.

What APM adds:

- **Pinned and locked:** `apm.lock.yaml` records the exact commit of every dependency. `apm install --frozen` reproduces it exactly in CI.
- **Reviewed:** with deployed files committed, every update is a diff in a pull request, so a changed prompt or hook gets reviewed before it runs.
- **Scanned:** `apm audit` checks installed files for hidden Unicode and for drift from the lockfile. Output can be SARIF for GitHub code scanning; `apm audit --ci` can be a pipeline gate.
- **Explicit trust:** MCP servers pulled in by a dependency's own dependencies aren't trusted unless the project declares them again (or you pass `--trust-transitive-mcp`). Executables from dependencies can be gated: once a project or org enables the `executables` policy, they need `apm approve`.
- **Org policy (early preview):** an `apm-policy.yml` is enforced on install.

What plugins offer instead: marketplace allow and block lists, force-enabled plugins and a sideloading block through managed settings, plus a trust warning before each install.

**Caveat:** the APM scanner finds hidden characters, but it can't tell whether a skill's visible text is malicious. Human review remains the main defence; APM makes sure changes actually show up for review. An agent hook like `protect-main` does block the agent's commits and pushes to protected branches, but it only runs inside the agent tool, so people and other tools bypass it. Server-side branch protection is the real enforcement point.

## Can an APM package contain Claude Code plugins?

Yes. `apm install` accepts APM packages, Claude skills (`SKILL.md`) and plugin collections (`plugin.json`). Tested with Anthropic's `hookify` plugin:

```bash
apm install anthropics/claude-code/plugins/hookify --target claude
```

APM unpacked it into plain files: 1 agent, 4 commands, 1 skill and 4 hook events registered in `.claude/settings.json`, with the commit locked. The install also warned that 3 files contained hidden characters and that the dependency was unpinned.

**Catch: plugin hooks can break.** `hookify`'s hook scripts import the plugin's own code (`from hookify.core...`) via `CLAUDE_PLUGIN_ROOT`. APM copied only the `hooks/` folder, rewrote the commands to `${CLAUDE_PROJECT_DIR}/.claude/hooks/...`, and doesn't set `CLAUDE_PLUGIN_ROOT`. The hooks would hit an import error, and `hookify` then allows the action instead of blocking it. (Read from the installed files; not confirmed in a live session.)

- **Converts well:** skills, agents, commands, and hooks whose script is self-contained, like this repo's `protect-main.mjs`. MCP servers probably too (untested with a plugin).
- **Can break:** hooks or scripts that rely on `CLAUDE_PLUGIN_ROOT`, other files in the plugin, or `bin/`. Plugin-only features (`userConfig`, monitors, output styles, themes) probably aren't converted (untested).

Pin plugin dependencies like any other:

```yaml
dependencies:
  apm:
    - anthropics/claude-code/plugins/hookify#<tag-or-sha>
```

The reverse also works: `apm pack` (default format) produces a Claude-plugin-style bundle with `plugin.json` at the bundle root, and `apm pack --format agent-plugin` produces an Agent Plugins bundle. Check the dry run: hooks and MCP config contributed by dependencies may not be packed.

## Are plugins a vendor-neutral standard?

No. The Claude Code plugin format (`.claude-plugin/plugin.json`) is Anthropic's.

| Format | Who | Covers | Notes |
|---|---|---|---|
| Claude Code plugins `.claude-plugin/plugin.json` | Anthropic | Skills, agents, hooks, MCP, LSP, `bin/`, output styles, monitors and more | |
| GitHub Copilot CLI plugins | GitHub | Agents, skills, commands, hooks, MCP, LSP | Very similar; Copilot CLI also reads `.claude-plugin/` marketplaces and plugin manifests, and supports Agent Plugins. |
| Cursor Plugins `.cursor-plugin/plugin.json` | Cursor | Rules, skills, agents, commands, hooks, MCP | Cursor also loads Agent Plugins. |
| Codex plugins, root `plugin.json` | OpenAI | Skills, MCP, apps; hooks only for plugins installed manually in Codex desktop | Uses the Agent Plugins schema; `.codex-plugin/plugin.json` remains as a compatibility fallback. |
| Agent Plugins 1.0, root `plugin.json` | Open standard; steering committee from Amazon, Cursor, Microsoft, OpenAI and Vercel | **Skills and MCP only**; hooks are a client-specific extension | Supported by Copilot, Cursor and Codex. Anthropic and Claude Code aren't listed. |

Standards inside plugins:

- **Skills (`SKILL.md`):** open standard at agentskills.io, originally developed by Anthropic and adopted by many tools (Copilot, Codex, Cursor and Gemini CLI among them, per third-party roundups). Install paths and loading behaviour still differ per tool.
- **MCP:** open and supported everywhere.
- **`AGENTS.md`:** open and widely read. Claude Code (v2.1.277+) reads it when there's no `CLAUDE.md` in the working directory or above, or together with `CLAUDE.md` via the `instructionFiles` setting; otherwise it reads `CLAUDE.md` and `.claude/rules/`.
- **Agents, hooks, rules, commands:** no shared standard. Each tool has its own frontmatter and config. This repo hit that twice: the `tools` frontmatter that broke OpenCode (so OpenCode was dropped as a target), and separate hook files for Claude Code and Copilot.

APM sits above these formats: write once, and it converts to each tool's layout. Skills move nearly unchanged; hooks and agents need per-tool care.

## Do a package's settings apply to the consumer?

No. Project-level settings such as `compilation` are read only from the `apm.yml` of the project running the command. A dependency's `compilation` block is ignored. The `compilation` block in this repo's `apm.yml` only applies when compiling this repo itself.

Tested behaviour of `apm compile` in a consumer repo:

| Consumer setup | Result |
|---|---|
| Hand-written `AGENTS.md`, no setting in the consumer's `apm.yml` | Skipped: "Protected AGENTS.md: hand-authored file will not be overwritten". The file stays safe, but the package's rules don't reach it. |
| Same, with `compilation.agents_md.mode: managed_section` in the **consumer's** `apm.yml` and `<!-- apm:start -->` / `<!-- apm:end -->` markers | Rules written between the markers; the rest untouched. |
| No `AGENTS.md` | A full `AGENTS.md` is generated. |

For Claude Code, Copilot and Cursor this hardly matters: instructions install on `apm install` to `.claude/rules/`, `.github/instructions/` and `.cursor/rules/` without any compile step. It matters for tools that read only `AGENTS.md`, such as Codex, and for Claude Code in a repo that relies on `AGENTS.md` instead of `CLAUDE.md`.

## Which should we use?

| Situation | Better fit |
|---|---|
| Claude Code only, personal toolkit or a small team that trusts the publisher | Plugins |
| Claude Code only, org with Team/Enterprise and a central platform team | Plugins plus managed settings (central enforcement, usage tracking) |
| Versions and changes must be recorded and reviewed per repo; CI must get exactly what's in the commit | APM |
| Always-on rules shared across repos | APM |
| Depending on third-party skills or repos directly, without writing marketplace entries | APM |
| Several tools (Claude Code, Copilot, Cursor) from one source | APM |

You don't have to pick one: APM can consume plugins as dependencies, and `apm pack` can produce a plugin bundle from the same source.

## Sources

- [APM documentation](https://microsoft.github.io/apm/)
- [Claude Code: plugin components](https://code.claude.com/docs/en/plugins/components.md)
- [Claude Code: plugin loading reference](https://code.claude.com/docs/en/plugins/loading.md)
- [Claude Code: create a marketplace](https://code.claude.com/docs/en/plugins/create-marketplace.md)
- [Claude Code: host and maintain a marketplace](https://code.claude.com/docs/en/plugins/host-marketplace.md)
- [Claude Code: manage plugins for your organization](https://code.claude.com/docs/en/plugins/org.md)
- [Claude Code: memory, CLAUDE.md and AGENTS.md](https://code.claude.com/docs/en/memory.md)
- [GitHub Docs: plugin marketplace for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace)
- [GitHub Docs: Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
- [Cursor Docs: plugins](https://cursor.com/docs/plugins)
- [OpenAI: build Codex plugins](https://developers.openai.com/plugins/build/plugins)
- [Agent Plugins](https://agent-plugins.org)
- [Agent Skills](https://agentskills.io)
