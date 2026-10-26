#!/usr/bin/env node
// Mechanical drift check: every repo path referenced in agent docs must exist.
// Scans CLAUDE.md, .agentic/gotchas.md (plus .agentic/gotchas/*.md if split by
// area), and .agentic/decisions/*.md for `evidence:` lines, exemplar-table paths,
// and inline code-quoted paths. Exit 1 (fails CI) when a referenced path is missing.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const files = ["CLAUDE.md", ".agentic/gotchas.md"];
for (const dir of [join(".agentic", "gotchas"), join(".agentic", "decisions")]) {
  const abs = join(root, dir);
  if (!existsSync(abs)) continue;
  for (const f of readdirSync(abs)) {
    if (f.endsWith(".md") && !f.startsWith("0000")) files.push(join(dir, f));
  }
}

// Path-looking tokens quoted in backticks. PATH_RE (any line) requires a slash +
// dot-extension; ROOT_RE additionally catches root-level files (`lefthook.yml`,
// `Directory.Packages.props`) but only on evidence lines and table rows, where a
// bare filename is a claim rather than prose. Skip URLs, globs, and placeholders.
//
// The extension must START WITH A LOWERCASE LETTER (then lowercase letters/digits).
// Real file extensions are lowercase (`.cs`, `.md`, `.mjs`, `.props`, `.yaml`); this
// deliberately excludes two non-path shapes that are legitimately backticked in these
// docs and were being misread as missing paths: `Type.Member` refs (`ModelId.Parse`,
// `Provider.Foundry` — a PascalCase "extension") and `publisher/model.version` ids
// (`openai/gpt-4.1` — a numeric "extension"). The regexes are case-sensitive (no `i`)
// so the extension test is meaningful; base names keep uppercase via the negated class.
const PATH_RE = /`([^`\s]+\/[^`\s]+\.[a-z][a-z0-9]{0,9})`/g;
const ROOT_RE = /`([^`\s/\\]+\.[a-z][a-z0-9]{0,9})`/g;
const SKIP = /^(https?:|.*(\*|\{|<|TODO|EXAMPLE))/i;

// A TOTALLY superseded ADR is a historical record: paths naming code that has since been deleted are
// accurate history, and editing them would both corrupt the record and breach decisions/README.md's
// "never edit an accepted ADR's decision content". So such a file is skipped.
//
// Keyed on `status: superseded`, deliberately NOT on the presence of `superseded_by:`. A partially
// superseded ADR carries `superseded_by: NNNN  # partial` while remaining `status: accepted` and
// authoritative; keying on the tag would silently stop checking it. A partial supersession stays fully checked.
// Scoped to the leading `---` front-matter block ON PURPOSE, not tested against the whole file: this
// directory also holds README.md, which DOCUMENTS this very key, and a fenced example or a reflow that
// put `status: superseded` at the start of a line anywhere in any scanned file would otherwise switch
// path checking off for that whole file — failing open, silently.
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const isTotallySuperseded = (text) => {
  const fm = FRONT_MATTER_RE.exec(text);
  return fm !== null && /^status:\s*superseded\s*$/m.test(fm[1]);
};

let missing = 0;
for (const rel of files) {
  const abs = join(root, rel);
  if (!existsSync(abs)) continue;
  const text = readFileSync(abs, "utf8");
  if (rel.includes("decisions") && isTotallySuperseded(text)) continue;
  // Ignore EXAMPLE-marked lines AND whole sections whose heading says EXAMPLE,
  // so template placeholders don't fail the check.
  let inExampleSection = false;
  for (const line of text.split("\n")) {
    if (/^#{1,6}\s/.test(line)) inExampleSection = /EXAMPLE/i.test(line);
    if (inExampleSection || /EXAMPLE/i.test(line)) continue;
    const isClaimLine = /\bevidence\b/i.test(line) || /^\s*\|/.test(line);
    const tokens = [...line.matchAll(PATH_RE)].map((m) => m[1]);
    if (isClaimLine) tokens.push(...[...line.matchAll(ROOT_RE)].map((m) => m[1]));
    for (const p of tokens) {
      if (SKIP.test(p)) continue;
      if (!existsSync(join(root, p))) {
        console.error(`MISSING: ${p}  (referenced in ${rel})`);
        missing++;
      }
    }
  }
}

if (missing > 0) {
  console.error(`\n${missing} referenced path(s) no longer exist. Run /audit-docs to fix the docs.`);
  process.exit(1);
}
console.log("check-doc-paths: all referenced paths exist.");
