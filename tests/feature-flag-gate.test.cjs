const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const scriptUrl = pathToFileURL(
  path.resolve(__dirname, "../.github/scripts/feature-flag-gate.mjs"),
).href;

// Builds a throwaway git repo with a base commit and a head commit so the
// script's real `git diff`/`git show` calls run against fixture content,
// not the actual hypertasks history.
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flag-gate-"));
  const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  return { dir, git };
}

function writeFile(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function commit(git, message) {
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message]);
  return git(["rev-parse", "HEAD"]).trim();
}

async function evaluate(title, baseSha, headSha, cwd) {
  const original = process.cwd();
  process.chdir(cwd);
  try {
    const { evaluate } = await import(scriptUrl);
    return evaluate({ title, baseSha, headSha });
  } finally {
    process.chdir(original);
  }
}

test("non-UI change passes with no flag needed", async () => {
  const { dir, git } = makeRepo();
  writeFile(dir, "src/lib/util.ts", "export const x = 1;\n");
  const base = commit(git, "base");
  writeFile(dir, "src/lib/util.ts", "export const x = 2;\n");
  const head = commit(git, "backend change");
  const result = await evaluate("HTPR-1 [FEATURE] backend only", base, head, dir);
  assert.equal(result.pass, true);
});

test("[BUGFIX] touching UI files passes without a flag", async () => {
  const { dir, git } = makeRepo();
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div/>;\n");
  const head = commit(git, "fix");
  const result = await evaluate("HTPR-2 [BUGFIX] fix widget", base, head, dir);
  assert.equal(result.pass, true);
});

test("[BUGFIX] smuggling a big UI change fails the cross-check", async () => {
  const { dir, git } = makeRepo();
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  const bigContent = Array.from({ length: 200 }, (_, i) => `const line${i} = ${i};`).join("\n");
  writeFile(dir, "src/components/Widget.tsx", bigContent);
  const head = commit(git, "fix");
  const result = await evaluate("HTPR-3 [BUGFIX] fix widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /retitle as \[FEATURE\]/);
});

test("auto-revert title is exempt regardless of tag", async () => {
  const { dir, git } = makeRepo();
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div/>;\n");
  const head = commit(git, "revert");
  const result = await evaluate('Revert "HTPR-4 [FEATURE] add widget"', base, head, dir);
  assert.equal(result.pass, true);
});

test("[FEATURE] touching UI files without a flag fails", async () => {
  const { dir, git } = makeRepo();
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\n');
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div>new</div>;\n");
  const head = commit(git, "feature");
  const result = await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /without adding or referencing a feature flag/);
});

test("[FEATURE] passes when it adds a FEATURE_FLAG_DEFINITIONS entry", async () => {
  const { dir, git } = makeRepo();
  writeFile(dir, "src/lib/flags.ts", "const FEATURE_FLAG_DEFINITIONS = [];\n");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  writeFile(
    dir,
    "src/lib/flags.ts",
    'const FEATURE_FLAG_DEFINITIONS = [{ key: "htpr-5-widget", shippedOn: "2026-09-08" }];\n',
  );
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div>new</div>;\n");
  const head = commit(git, "feature");
  const result = await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir);
  assert.equal(result.pass, true);
  assert.match(result.reason, /adds a FEATURE_FLAG_DEFINITIONS entry/);
});

test("[FEATURE] passes when it references an existing flag key in a UI file", async () => {
  const { dir, git } = makeRepo();
  writeFile(dir, "src/lib/flags/keys.ts", 'export const WIDGET_FLAG = "htpr-5-widget";\n');
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  writeFile(
    dir,
    "src/components/Widget.tsx",
    'import { WIDGET_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(WIDGET_FLAG) ? <div/> : null;\n',
  );
  const head = commit(git, "feature");
  const result = await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir);
  assert.equal(result.pass, true);
  assert.match(result.reason, /references an existing flag/);
});

test("[SPEED] (a non-exempt tag) touching UI files also requires a flag", async () => {
  const { dir, git } = makeRepo();
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div>fast</div>;\n");
  const head = commit(git, "speed");
  const result = await evaluate("HTPR-6 [SPEED] speed up widget", base, head, dir);
  assert.equal(result.pass, false);
});
