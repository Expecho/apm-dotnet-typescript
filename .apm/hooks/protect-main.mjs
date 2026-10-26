#!/usr/bin/env node
// PreToolUse hook: blocks agent-initiated git commits on protected branches and
// pushes to/from protected refs. Exit 2 = block tool call, stderr shown to Claude.
// The protected list is read from .agentic/quality-gates.yaml (branches.protected)
// — single source, shared with lefthook.yml; falls back to a safe default.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const FALLBACK = ["main", "master", "develop"];

function protectedBranches() {
  try {
    const yaml = readFileSync(join(ROOT, ".agentic", "quality-gates.yaml"), "utf8");
    const m = yaml.match(/^\s*protected:\s*\[([^\]]*)\]/m);
    if (m) {
      const list = m[1]
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
      if (list.length) return list;
    }
  } catch {}
  return FALLBACK;
}

function branchOf(dir) {
  try {
    return execSync("git branch --show-current", { cwd: dir, encoding: "utf8" }).trim();
  } catch {
    return ""; // not a checkout, or gone: nothing here can commit to a protected branch
  }
}

// Which checkout would this command actually write to? The branch used to be read from ROOT
// alone, which is wrong the moment a command names another repository — and wrong in BOTH
// directions. The visible half is the false positive: committing to a feature branch in a
// sibling repo was refused because THIS repo happened to sit on main. The half that matters
// is the mirror image, a commit landing on main here while the session is rooted elsewhere,
// which was waved through. Every candidate is collected and any one of them being protected
// blocks, so a command touching several repositories is judged on the worst of them.
function targetDirs(cmd) {
  const dirs = new Set();

  // `git -C <path>` beats the shell's directory, so it is read first and stands alone.
  for (const m of cmd.matchAll(/\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|([^\s;|&]+))/g)) {
    dirs.add(m[1] ?? m[2] ?? m[3]);
  }

  // A git call WITHOUT -C runs wherever the shell stands: a leading `cd <path>` when the
  // command opens with one, otherwise the session root. Requiring such a call is what stops a
  // pure `git -C <sibling>` command from being judged against this repo as well.
  if (/\bgit\s+(?!-C\b)/.test(cmd)) {
    const cd = cmd.match(/^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;|&]+))/);
    dirs.add(cd ? (cd[1] ?? cd[2] ?? cd[3]) : ROOT);
  }

  // Nothing parsed means nothing recognised, and the session root is the safe assumption.
  if (dirs.size === 0) dirs.add(ROOT);

  // A relative path is resolved against ROOT rather than the shell's real directory, which no
  // hook can see. Absolute paths, which is what the agent is told to prefer, are exact.
  return [...dirs].map((d) => (isAbsolute(d) ? d : resolve(ROOT, d)));
}

function protectedTargets(cmd, PROTECTED) {
  return targetDirs(cmd)
    .map((dir) => ({ dir, branch: branchOf(dir) }))
    .filter((t) => PROTECTED.includes(t.branch));
}

function block(msg) {
  console.error(msg);
  process.exit(2);
}

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    const payload = JSON.parse(input);
    if (payload.tool_name !== "Bash") process.exit(0);
    cmd = String(payload.tool_input?.command ?? "");
  } catch {
    process.exit(0); // never break the session on malformed input
  }

  const isCommit = /\bgit\b[^\n;|&]*\bcommit\b/.test(cmd);
  const isPush = /\bgit\b[^\n;|&]*\bpush\b/.test(cmd);
  if (!isCommit && !isPush) process.exit(0);

  const PROTECTED = protectedBranches();
  const P = PROTECTED.join("|");
  // (?![\w./-]) = end of the branch name: `develop` matches, `develop-x` doesn't.

  // The branch is read BEFORE the tool runs, so `git switch main && git commit`
  // would evade the current-branch checks below. Block the combination outright.
  // (`checkout|switch -b/-c <new> <start>` stays allowed — it lands on the NEW branch.)
  if (new RegExp(`\\bgit\\b[^\\n;|&]*\\b(?:checkout|switch)\\s+(?:${P})(?![\\w./-])`).test(cmd)) {
    block(
      `BLOCKED: this command switches to a protected branch (${PROTECTED.join(", ")}) ` +
        `in the same command as a commit/push. Work on a feature branch instead.`
    );
  }

  const hits = protectedTargets(cmd, PROTECTED);

  if (isCommit && hits.length) {
    block(
      `BLOCKED: '${hits[0].dir}' is on protected branch '${hits[0].branch}'. ` +
        `Create a branch first: git checkout -b feature/<description>`
    );
  }

  if (isPush) {
    // Explicit protected target: `origin main`, `HEAD:main`, `:main`.
    if (new RegExp(`\\bpush\\b[^\\n;|&]*(?:\\s|:)(?:${P})(?![\\w./-])`).test(cmd)) {
      block(
        `BLOCKED: push targets a protected branch (${PROTECTED.join(", ")}). ` +
          `Push a feature branch and open an MR instead.`
      );
    }
    // A bare `git push` (or `git push origin HEAD`) from a protected branch
    // names no ref but still targets that branch.
    if (hits.length) {
      block(
        `BLOCKED: '${hits[0].dir}' is on protected branch '${hits[0].branch}'; ` +
          `a push from there targets it. ` +
          `Move the work to a feature branch and open an MR instead.`
      );
    }
  }

  process.exit(0);
});
