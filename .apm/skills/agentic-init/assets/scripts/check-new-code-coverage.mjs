#!/usr/bin/env node
// Coverage gate for NEW CODE only (`coverage_new_code_pct_min` in .agentic/quality-gates.yaml).
//
// Whole-repo coverage is the wrong number to gate on: it moves glacially, so it neither fails when a
// change is untested nor passes meaningfully when it is. This measures the lines this branch actually
// ADDED OR CHANGED — the "clean as you code" shape — by intersecting `git diff` with cobertura reports.
//
// Works for .NET and TypeScript/JavaScript, because both toolchains can write cobertura:
//   .NET:        dotnet test --collect:"XPlat Code Coverage"                  (coverlet → **/TestResults/<guid>/coverage.cobertura.xml)
//   Vitest:      vitest run --coverage --coverage.reporter=cobertura          (→ coverage/cobertura-coverage.xml)
//   Jest:        jest --coverage --coverageReporters=cobertura                (→ coverage/cobertura-coverage.xml)
//   c8:          c8 --reporter=cobertura <test command>                       (→ coverage/cobertura-coverage.xml)
// For JS/TS, include files no test loads (Vitest `coverage.all`/`include`, Jest `collectCoverageFrom`),
// otherwise an untested new file is simply absent from the report and cannot fail the gate.
//
// Usage:
//   node .agentic/scripts/check-new-code-coverage.mjs [baseRef] [--report <path>]...
// Without --report, every cobertura report in the repo is merged (newest per .NET TestResults folder).
// baseRef defaults to $BASE_BRANCH, then origin/HEAD, then origin/main.
//
// Exit 1 (fails CI) when the ratio is under the threshold. No npm dependencies.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();

// ---- arguments ----
const args = process.argv.slice(2);
const reportArgs = [];
let baseArg = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--report") reportArgs.push(args[++i]);
  else baseArg ??= args[i];
}

function git(...gitArgs) {
  return execFileSync("git", gitArgs, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function defaultBase() {
  try {
    return git("symbolic-ref", "--short", "refs/remotes/origin/HEAD").trim();
  } catch {
    return "origin/main";
  }
}
const base = baseArg || process.env.BASE_BRANCH || defaultBase();

// ---- threshold: read from the gate file, never hardcoded ----
const gates = readFileSync(join(root, ".agentic/quality-gates.yaml"), "utf8");
const thresholdMatch = gates.match(/^\s*coverage_new_code_pct_min:\s*(\d+(?:\.\d+)?)/m);
if (!thresholdMatch) {
  console.error("coverage_new_code_pct_min is not defined in .agentic/quality-gates.yaml — nothing to enforce.");
  process.exit(1);
}
const threshold = Number(thresholdMatch[1]);

// ---- the lines this branch added or changed ----
let mergeBase;
try {
  mergeBase = git("merge-base", "HEAD", base).trim();
} catch {
  console.error(`Cannot resolve a merge base with '${base}'. Pass one as the first argument or set BASE_BRANCH.`);
  process.exit(1);
}

// -U0 so the hunk headers bound exactly the changed lines, with no context bleeding in.
const diff = git("diff", "-U0", "--diff-filter=ACMR", `${mergeBase}...HEAD`);

// Only production code is gated. Tests are excluded on purpose: a test file's own coverage is a
// tautology (running it covers it), so including them inflates the number and hides the gap.
const SOURCE = /\.(cs|ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const GENERATED = /(\.g\.cs|\.Designer\.cs|\.d\.ts)$/;
const BUILD_DIRS = /(^|\/)(bin|obj|dist|build|out|coverage|node_modules)\//;
const TEST_PATHS = /(^|\/)(tests?|__tests__|__mocks__)\/|\.Tests?\/|Tests?\.cs$|\.(test|spec)\.[cm]?[jt]sx?$/;
const isGated = (p) => SOURCE.test(p) && !GENERATED.test(p) && !BUILD_DIRS.test(p) && !TEST_PATHS.test(p);

const changed = new Map(); // repo-relative path -> Set of 1-based line numbers
let current = null;
for (const raw of diff.split("\n")) {
  const line = raw.replace(/\r$/, "");
  if (line.startsWith("+++ ")) {
    const path = line.startsWith("+++ b/") ? line.slice(6).trim() : null;
    current = path && isGated(path) ? (changed.get(path) ?? new Set()) : null;
    if (current) changed.set(path, current);
    continue;
  }
  if (!current || !line.startsWith("@@")) continue;
  // @@ -old,count +new,count @@
  const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
  if (!hunk) continue;
  const start = Number(hunk[1]);
  const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
  for (let i = 0; i < count; i++) current.add(start + i);
}

if (changed.size === 0) {
  console.log("check-new-code-coverage: no production code changed — nothing to gate.");
  process.exit(0);
}

// ---- the cobertura reports ----
const REPORT_NAMES = new Set(["coverage.cobertura.xml", "cobertura-coverage.xml", "cobertura.xml"]);
const SKIP_DIRS = new Set([".git", "node_modules", "bin", "obj", ".agentic"]);

function findReports(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const sub = join(dir, entry.name);
      // A nested checkout (git worktree, submodule) has its own .git; its reports describe other code.
      if (!SKIP_DIRS.has(entry.name) && !existsSync(join(sub, ".git"))) findReports(sub, found);
    } else if (REPORT_NAMES.has(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

// coverlet writes a fresh TestResults/<guid>/ per run; only the newest run per TestResults folder counts,
// or stale runs would be merged in. Other reports are overwritten in place, so all of them count.
function latestReports(paths) {
  const newestPerRun = new Map();
  const result = [];
  for (const path of paths) {
    const run = path.replace(/\\/g, "/").match(/^(.*\/TestResults)\/[^/]+\/[^/]+$/);
    if (!run) {
      result.push(path);
      continue;
    }
    const at = statSync(path).mtimeMs;
    const best = newestPerRun.get(run[1]);
    if (!best || at > best.at) newestPerRun.set(run[1], { path, at });
  }
  return [...result, ...[...newestPerRun.values()].map((b) => b.path)];
}

const reports = reportArgs.length ? reportArgs.map((p) => resolve(root, p)) : latestReports(findReports(root));
const missing = reports.filter((p) => !existsSync(p));
if (reports.length === 0 || missing.length) {
  console.error(
    (missing.length ? `Coverage report not found: ${missing.join(", ")}\n` : "No cobertura coverage report found in the repo.\n") +
      'Run your tests with cobertura output first, e.g. dotnet test --collect:"XPlat Code Coverage" or vitest run --coverage --coverage.reporter=cobertura');
  process.exit(1);
}

// repo-relative path -> Map(line -> hits). A file can appear as several <class> elements (one per type)
// and in several reports (one per test project), so hits are summed rather than overwritten.
const hits = new Map();
const unresolved = new Map(); // filename as written in the report -> Map(line -> hits), matched by suffix
const toRepoPath = (abs) => relative(root, abs).replace(/\\/g, "/");

for (const report of reports) {
  const xml = readFileSync(report, "utf8");
  const sources = [...xml.matchAll(/<source>([^<]*)<\/source>/g)].map((m) => m[1].trim()).filter(Boolean);
  for (const [, filename, body] of xml.matchAll(/<class [^>]*filename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g)) {
    const candidates = isAbsolute(filename) ? [filename] : sources.map((s) => join(s, filename));
    const abs = candidates.find((c) => existsSync(c));
    const key = abs ? toRepoPath(abs) : filename.replace(/\\/g, "/");
    const target = abs ? hits : unresolved;
    const lines = target.get(key) ?? new Map();
    target.set(key, lines);
    for (const [, number, count] of body.matchAll(/<line number="(\d+)" hits="(\d+)"/g)) {
      lines.set(Number(number), (lines.get(Number(number)) ?? 0) + Number(count));
    }
  }
}

// Reports generated on another machine (CI artifact) carry foreign <source> roots, so fall back to a
// suffix match between the repo-relative path and the filename as written.
function linesFor(path) {
  if (hits.has(path)) return hits.get(path);
  for (const [filename, lines] of unresolved) {
    if (path.endsWith(filename) || filename.endsWith(path)) return lines;
  }
  return null;
}

let covered = 0;
let total = 0;
const rows = [];
for (const [path, changedLines] of [...changed].sort()) {
  const lines = linesFor(path);
  if (!lines) continue; // no coverable lines recorded (interfaces, type-only modules, pure declarations)
  let fileCovered = 0;
  let fileTotal = 0;
  for (const line of changedLines) {
    if (!lines.has(line)) continue; // not a coverable line (comment, brace, blank)
    fileTotal++;
    if (lines.get(line) > 0) fileCovered++;
  }
  if (fileTotal === 0) continue;
  covered += fileCovered;
  total += fileTotal;
  rows.push([path, fileCovered, fileTotal]);
}

if (total === 0) {
  console.log("check-new-code-coverage: no coverable new lines — nothing to gate.");
  process.exit(0);
}

const pct = (covered / total) * 100;
rows.sort((a, b) => a[1] / a[2] - b[1] / b[2]);
for (const [path, c, t] of rows) {
  console.log(`  ${((c / t) * 100).toFixed(1).padStart(5)}%  ${String(c).padStart(4)}/${String(t).padEnd(4)}  ${path}`);
}
console.log(`\nNew-code coverage: ${covered}/${total} = ${pct.toFixed(1)}% (threshold ${threshold}%, vs ${base}, ${reports.length} report(s))`);

if (pct + 1e-9 < threshold) {
  console.error(
    `\ncoverage_new_code_pct_min is ${threshold}% (.agentic/quality-gates.yaml) — this branch is at ${pct.toFixed(1)}%.`);
  process.exit(1);
}
console.log("check-new-code-coverage: PASS");
