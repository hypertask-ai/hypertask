const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const scriptUrl = pathToFileURL(path.join(root, ".github/scripts/feature-flag-gate.mjs")).href;

function writeFile(dir, relative, content) {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function flagsSource(definitions = ["OTHER_FLAG"], mode = "OWNER_AND_QA", suffix = "") {
  const rows = definitions.map((key) => `  { key: ${key}, description: "fixture" },`).join("\n");
  return `import { OTHER_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n${rows}\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "${mode}";\n${suffix}`;
}

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flag-gate-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\n');
  writeFile(dir, "src/lib/flags.ts", flagsSource());
  return { dir, git };
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
    const { evaluate: run } = await import(scriptUrl);
    return run({ title, baseSha, headSha });
  } finally {
    process.chdir(original);
  }
}

test("non-UI changes do not need a flag", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/util.ts", "export const value = 1;\n");
  const head = commit(git, "backend");
  assert.equal((await evaluate("HTPR-2 [FEATURE] backend", base, head, dir)).pass, true);
});

test("App Router API changes do not need a flag", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/app/api/example/route.ts", "export function GET() { return new Response(); }\n");
  const head = commit(git, "backend");
  assert.equal((await evaluate("HTPR-2 [FEATURE] backend", base, head, dir)).pass, true);
});

test("App Router route handlers and spec files do not need a flag", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/app/webhooks/route.ts", "export function POST() { return new Response(); }\n");
  writeFile(dir, "src/components/Widget.spec.tsx", "export const fixture = <div />;\n");
  const head = commit(git, "non-ui files");
  assert.equal((await evaluate("HTPR-2 [FEATURE] non-ui files", base, head, dir)).pass, true);
});

test("small BUGFIX changes are exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "fix");
  assert.equal((await evaluate("HTPR-2 [BUGFIX] fix widget", base, head, dir)).pass, true);
});

test("large BUGFIX UI additions fail the cross-check", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", Array.from({ length: 151 }, (_, i) => `const line${i} = ${i};`).join("\n"));
  const head = commit(git, "large fix");
  const result = await evaluate("HTPR-3 [BUGFIX] fix widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /Retitle it as \[FEATURE\]/);
});

test("undocumented title tags are not exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "ui");
  assert.equal((await evaluate("HTPR-4 [CI] add widget", base, head, dir)).pass, false);
});

test("a forged auto-revert title is not exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "ordinary commit");
  const result = await evaluate('Revert "HTPR-4 [FEATURE] add widget"', base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /no valid HTPR ticket and tag/);
});

test("a one-commit git revert of production is exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const base = commit(git, "HTPR-4 [FEATURE] add widget");
  git(["revert", "--no-edit", base]);
  const head = git(["rev-parse", "HEAD"]).trim();
  const result = await evaluate('Revert "HTPR-4 [FEATURE] add widget"', base, head, dir);
  assert.equal(result.pass, true);
  assert.match(result.reason, /Verified auto-revert/);
});

test("FEATURE UI changes without a flag fail", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir)).pass, false);
});

test("unrelated key text outside FEATURE_FLAG_DEFINITIONS does not pass", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags.ts", flagsSource(undefined, undefined, 'const unrelated = { key: "htpr-5-widget" };\n'));
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir)).pass, false);
});

test("definitions resolve string constants imported from local modules", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/lib/external-flags.ts", 'export const EXTERNAL_FLAG =\n  "htpr-1-external";\n');
  writeFile(
    dir,
    "src/lib/flags.ts",
    'import { OTHER_FLAG } from "@/lib/flags/keys";\nimport { EXTERNAL_FLAG } from "@/lib/external-flags";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: EXTERNAL_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA";\n',
  );
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "feature");
  const result = await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /without a feature flag/);
  assert.doesNotMatch(result.reason, /could not be parsed/);
});

test("a ticket-specific definition passes with the Owner and QA default", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags.ts", flagsSource(["OTHER_FLAG", '"htpr-5-widget"']));
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "feature");
  const result = await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir);
  assert.equal(result.pass, true);
  assert.match(result.reason, /Owner \+ QA default/);
});

test("a definition for another ticket or a changed default fails", async (t) => {
  const wrongTicket = makeRepo(t);
  const wrongTicketBase = commit(wrongTicket.git, "base");
  writeFile(wrongTicket.dir, "src/lib/flags.ts", flagsSource(["OTHER_FLAG", '"htpr-9-widget"']));
  writeFile(wrongTicket.dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const wrongTicketHead = commit(wrongTicket.git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", wrongTicketBase, wrongTicketHead, wrongTicket.dir)).pass, false);

  const wrongDefault = makeRepo(t);
  const wrongDefaultBase = commit(wrongDefault.git, "base");
  writeFile(wrongDefault.dir, "src/lib/flags.ts", flagsSource(["OTHER_FLAG", '"htpr-5-widget"'], "EVERYONE"));
  writeFile(wrongDefault.dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const wrongDefaultHead = commit(wrongDefault.git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", wrongDefaultBase, wrongDefaultHead, wrongDefault.dir)).pass, false);
});

test("an imported registered key used by useFlag passes", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir)).pass, true);
});

test("UI changes inside a file with an existing runtime gate pass", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div>old</div> : null;\n');
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div>new</div> : null;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] update widget", base, head, dir)).pass, true);
});

test("a deleted UI file does not abort scanning another gated file", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/ADeleted.tsx", "export const Deleted = () => null;\n");
  writeFile(dir, "src/components/ZWidget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  fs.rmSync(path.join(dir, "src/components/ADeleted.tsx"));
  writeFile(dir, "src/components/ZWidget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] update widget", base, head, dir)).pass, true);
});

test("comments, strings, and identifier substrings do not count as gate calls", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\n// useFlag(OTHER_FLAG)\nconst note = "useFlag(OTHER_FLAG)";\nconst OTHER_FLAG_SUFFIX = true;\nexport const Widget = () => <div />;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir)).pass, false);
});

test("a registered literal passed to isFeatureEnabled counts", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/app/page.tsx", 'import { isFeatureEnabled } from "@/lib/flags";\nexport async function Page() { return await isFeatureEnabled("htpr-1-other", 6) ? <div /> : null; }\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir)).pass, true);
});

test("missing tags produce a useful failure instead of [null]", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "feature");
  const result = await evaluate("add widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /no valid HTPR ticket and tag/);
  assert.doesNotMatch(result.reason, /\[null\]/);
});

test("workflow covers metadata changes, uses trusted code, and reconciles old PRs", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/feature-flag-gate.yml"), "utf8");
  assert.match(workflow, /pull_request_target:/);
  assert.doesNotMatch(workflow, /^  pull_request:$/m);
  assert.match(workflow, /types: \[opened, synchronize, reopened, edited, ready_for_review\]/);
  assert.match(workflow, /push:\s+branches: \[production\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /gh api "repos\/\$REPO\/pulls\/\$PR_NUMBER"/);
  assert.match(workflow, /git fetch --no-tags origin production "refs\/pull\/\$PR_NUMBER\/head"/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /statuses: write/);
  assert.match(workflow, /statuses\/\$head_sha/);
  assert.match(workflow, /gh api --paginate --slurp/);
  assert.equal((workflow.match(/elif node \.github\/scripts\/feature-flag-gate\.mjs/g) || []).length, 2);
  assert.doesNotMatch(workflow, /^\s+node \.github\/scripts\/feature-flag-gate\.mjs/m);
  assert.match(workflow, /head_pr_count.*flatten\[\].*\.head\.sha == \$sha/);
  assert.match(workflow, /fresh_head_pr_count/);
  assert.match(workflow, /shared by multiple open production pull requests/);
  assert.match(workflow, /jq -c 'flatten\[\]' \"\$pages\"/);
  assert.doesNotMatch(workflow, /jq -ce 'flatten\[\]'/);
  assert.match(workflow, /changed during evaluation/);
  assert.doesNotMatch(workflow, /pull-requests: write/);
});
