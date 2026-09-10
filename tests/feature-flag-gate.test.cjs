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

test("loose JSX UI files require a feature flag", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/features/NewView.jsx", "export const NewView = () => <div />;\n");
  const head = commit(git, "jsx feature");
  assert.equal((await evaluate("HTPR-2 [FEATURE] add view", base, head, dir)).pass, false);
});

test("App Router API changes do not need a flag", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/app/api/example/route.ts", "export function GET() { return new Response(); }\n");
  const head = commit(git, "backend");
  assert.equal((await evaluate("HTPR-2 [FEATURE] backend", base, head, dir)).pass, true);
});

test("server-side ticket gates cover related UI changes", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  writeFile(dir, "src/app/api/widget/route.ts", 'import { isFeatureEnabled } from "@/lib/flags";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport async function GET() { if (await isFeatureEnabled(OTHER_FLAG, 6)) return new Response("on"); return new Response("off"); }\n');
  const head = commit(git, "server-gated UI");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);
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

test("moving a large file into UI paths cannot evade the exemption budget", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/lib/Old.ts", Array.from({ length: 200 }, (_, i) => `export const old${i} = ${i};`).join("\n"));
  const base = commit(git, "base");
  fs.mkdirSync(path.join(dir, "src/components"), { recursive: true });
  git(["mv", "src/lib/Old.ts", "src/components/Widget.tsx"]);
  fs.appendFileSync(
    path.join(dir, "src/components/Widget.tsx"),
    `\n${Array.from({ length: 151 }, (_, i) => `export const added${i} = ${i};`).join("\n")}\n`,
  );
  const head = commit(git, "move and expand UI");
  const result = await evaluate("HTPR-3 [BUGFIX] move widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /over the 150-line budget/);
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

test("a forged revert footer with an unrelated patch is not exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  commit(git, "initial");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const base = commit(git, "HTPR-4 [FEATURE] add widget");
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <aside />;\n");
  git(["add", "-A"]);
  const title = 'Revert "HTPR-4 [FEATURE] add widget"';
  git(["commit", "-q", "-m", title, "-m", `This reverts commit ${base}.`]);
  const head = git(["rev-parse", "HEAD"]).trim();
  assert.equal((await evaluate(title, base, head, dir)).pass, false);
});

test("a one-commit git revert of production is exempt", async (t) => {
  const { dir, git } = makeRepo(t);
  commit(git, "initial");
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

test("conditional and spread definitions cannot spoof a ticket flag", async (t) => {
  const conditional = makeRepo(t);
  const conditionalBase = commit(conditional.git, "base");
  writeFile(
    conditional.dir,
    "src/lib/flags.ts",
    'import { OTHER_FLAG } from "@/lib/flags/keys";\nconst enabled = false;\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  enabled ? { key: "htpr-5-decoy" } : { key: OTHER_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n',
  );
  writeFile(conditional.dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const conditionalHead = commit(conditional.git, "conditional decoy");
  const conditionalResult = await evaluate("HTPR-5 [FEATURE] add widget", conditionalBase, conditionalHead, conditional.dir);
  assert.equal(conditionalResult.pass, false);
  assert.match(conditionalResult.reason, /direct object literals/);

  const spread = makeRepo(t);
  const spreadBase = commit(spread.git, "base");
  writeFile(
    spread.dir,
    "src/lib/flags.ts",
    'import { OTHER_FLAG } from "@/lib/flags/keys";\nconst existing = { key: OTHER_FLAG };\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: "htpr-5-decoy", ...existing },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n',
  );
  writeFile(spread.dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const spreadHead = commit(spread.git, "spread decoy");
  const spreadResult = await evaluate("HTPR-5 [FEATURE] add widget", spreadBase, spreadHead, spread.dir);
  assert.equal(spreadResult.pass, false);
  assert.match(spreadResult.reason, /cannot contain object spreads/);
});

test("compound exported constants cannot spoof their runtime flag value", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(
    dir,
    "src/lib/flags/keys.ts",
    'export const OTHER_FLAG = "htpr-1-other";\nexport const DECOY_FLAG = "htpr-5-decoy".replace("decoy", "actual");\n',
  );
  writeFile(
    dir,
    "src/lib/flags.ts",
    'import { OTHER_FLAG, DECOY_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: DECOY_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n',
  );
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "compound decoy");
  const result = await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /not an exported string constant/);
});

test("definition identifiers resolve their imports instead of matching registry names", async (t) => {
  const local = makeRepo(t);
  const localBase = commit(local.git, "base");
  writeFile(
    local.dir,
    "src/lib/flags.ts",
    'const OTHER_FLAG = "htpr-5-decoy";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n',
  );
  writeFile(local.dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const localHead = commit(local.git, "local decoy");
  const localResult = await evaluate("HTPR-5 [FEATURE] add widget", localBase, localHead, local.dir);
  assert.equal(localResult.pass, false);
  assert.match(localResult.reason, /unknown feature flag key constant/);

  const aliased = makeRepo(t);
  writeFile(aliased.dir, "src/lib/external-flags.ts", 'export const WRONG_FLAG = "htpr-9-wrong";\n');
  const aliasedBase = commit(aliased.git, "base");
  writeFile(
    aliased.dir,
    "src/lib/flags.ts",
    'import { WRONG_FLAG as OTHER_FLAG } from "@/lib/external-flags";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: "htpr-1-other" },\n  { key: OTHER_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n',
  );
  writeFile(aliased.dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const aliasedHead = commit(aliased.git, "aliased decoy");
  const aliasedResult = await evaluate("HTPR-5 [FEATURE] add widget", aliasedBase, aliasedHead, aliased.dir);
  assert.equal(aliasedResult.pass, false);
  assert.match(aliasedResult.reason, /match this pull request/);
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

test("flags added to production after a PR branches are not treated as PR removals", async (t) => {
  const { dir, git } = makeRepo(t);
  commit(git, "common base");
  const productionBranch = git(["branch", "--show-current"]).trim();
  git(["checkout", "-q", "-b", "pr"]);
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  git(["checkout", "-q", productionBranch]);
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const NEW_PRODUCTION_FLAG = "htpr-9-new";\n');
  writeFile(dir, "src/lib/flags.ts", 'import { OTHER_FLAG, NEW_PRODUCTION_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: NEW_PRODUCTION_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
  const base = commit(git, "production advances");
  assert.equal((await evaluate("HTPR-1 [FEATURE] update widget", base, head, dir)).pass, true);
});

test("a ticket-specific definition without runtime use fails", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags.ts", flagsSource(["OTHER_FLAG", '"htpr-5-widget"']));
  writeFile(dir, "src/components/Widget.tsx", "export const Widget = () => <div />;\n");
  const head = commit(git, "feature");
  const result = await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir);
  assert.equal(result.pass, false);
  assert.match(result.reason, /call useFlag\/isFeatureEnabled/);
});

test("a registered ticket-specific definition used in changed UI passes", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const WIDGET_FLAG = "htpr-5-widget";\n');
  writeFile(dir, "src/lib/flags.ts", 'import { OTHER_FLAG, WIDGET_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: WIDGET_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { WIDGET_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(WIDGET_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  const result = await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir);
  assert.equal(result.pass, true);
  assert.match(result.reason, /ticket-specific feature gate htpr-5-widget/);
});

test("an unused ticket-specific runtime call does not satisfy the gate", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const WIDGET_FLAG = "htpr-5-widget";\n');
  writeFile(dir, "src/lib/flags.ts", 'import { OTHER_FLAG, WIDGET_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: WIDGET_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { WIDGET_FLAG } from "@/lib/flags/keys";\nexport function Widget() { useFlag(WIDGET_FLAG); return <div />; }\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir)).pass, false);
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
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);
});

test("a multiline gate with a changed key argument passes", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const OLD_FLAG = "htpr-9-old";\n');
  writeFile(dir, "src/lib/flags.ts", 'import { OTHER_FLAG, OLD_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS = [\n  { key: OTHER_FLAG },\n  { key: OLD_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG, OLD_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(\n  OLD_FLAG,\n) ? <div /> : null;\n');
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG, OLD_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(\n  OTHER_FLAG,\n) ? <div /> : null;\n');
  const head = commit(git, "change gate key");
  assert.equal((await evaluate("HTPR-1 [FEATURE] update widget", base, head, dir)).pass, true);
});

test("a changed ticket-specific hook assignment used as a condition passes", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { const enabled = useFlag(OTHER_FLAG); return enabled ? <div /> : null; }\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);
});

test("typed flag registries and definition arrays are parsed", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG: FeatureFlagKey = `htpr-1-other`;\n');
  writeFile(dir, "src/lib/flags.ts", 'import { OTHER_FLAG } from "@/lib/flags/keys";\nconst FEATURE_FLAG_DEFINITIONS: FeatureFlagDefinition[] = [\n  { key: OTHER_FLAG },\n];\nconst DEFAULT_FEATURE_FLAG_MODE: FeatureFlagMode = "OWNER_AND_QA";\n');
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);
});

test("runtime gate calls inside template expressions are parsed", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => `${useFlag(OTHER_FLAG) ? "on" : "off"}`;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);
});

test("JSX apostrophes do not break runtime gate parsing", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", `import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <p>\nUsers' settings don't load\n</p> : null;\n`);
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);
});

test("an unrelated existing runtime gate does not cover changed UI", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div>old</div> : null;\n');
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div>new</div> : null;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] update widget", base, head, dir)).pass, false);
});

test("a deleted UI file does not abort scanning another gated file", async (t) => {
  const { dir, git } = makeRepo(t);
  writeFile(dir, "src/components/ADeleted.tsx", "export const Deleted = () => null;\n");
  writeFile(dir, "src/components/ZWidget.tsx", "export const Widget = () => null;\n");
  const base = commit(git, "base");
  fs.rmSync(path.join(dir, "src/components/ADeleted.tsx"));
  writeFile(dir, "src/components/ZWidget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] update widget", base, head, dir)).pass, true);
});

test("CSS and other non-code UI files do not abort runtime-call scanning", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Theme.css", ".widget { color: red; }\n");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);
});

test("a key added only to the registry cannot count as an existing runtime gate", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/lib/flags/keys.ts", 'export const OTHER_FLAG = "htpr-1-other";\nexport const DECOY_FLAG = "htpr-5-decoy";\n');
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { DECOY_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(DECOY_FLAG) ? <div /> : null;\n');
  const head = commit(git, "registry-only decoy");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir)).pass, false);
});

test("statically unreachable helper calls do not count as runtime gates", async (t) => {
  const shortCircuit = makeRepo(t);
  const shortCircuitBase = commit(shortCircuit.git, "base");
  writeFile(shortCircuit.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => false && useFlag(OTHER_FLAG) ? <div /> : null;\n');
  const shortCircuitHead = commit(shortCircuit.git, "dead short circuit");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", shortCircuitBase, shortCircuitHead, shortCircuit.dir)).pass, false);

  const returned = makeRepo(t);
  const returnedBase = commit(returned.git, "base");
  writeFile(returned.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { return <div />; useFlag(OTHER_FLAG); }\n');
  const returnedHead = commit(returned.git, "dead return");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", returnedBase, returnedHead, returned.dir)).pass, false);

  const deadReference = makeRepo(t);
  const deadReferenceBase = commit(deadReference.git, "base");
  writeFile(deadReference.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport function Widget() { const enabled = useFlag(OTHER_FLAG); if (false) { if (enabled) return <div />; } return <div />; }\n');
  const deadReferenceHead = commit(deadReference.git, "dead reference");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", deadReferenceBase, deadReferenceHead, deadReference.dir)).pass, false);

  const invariant = makeRepo(t);
  const invariantBase = commit(invariant.git, "base");
  writeFile(invariant.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => useFlag(OTHER_FLAG) || true ? <div /> : null;\n');
  const invariantHead = commit(invariant.git, "invariant condition");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", invariantBase, invariantHead, invariant.dir)).pass, false);

  const nestedInvariant = makeRepo(t);
  const nestedInvariantBase = commit(nestedInvariant.git, "base");
  writeFile(nestedInvariant.dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\nexport const Widget = () => (useFlag(OTHER_FLAG) && window.ready) || true ? <div /> : null;\n');
  const nestedInvariantHead = commit(nestedInvariant.git, "nested invariant condition");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", nestedInvariantBase, nestedInvariantHead, nestedInvariant.dir)).pass, false);
});

test("comments, strings, JSX text, regexes, and shadowed helpers do not count as gate calls", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/components/Widget.tsx", 'import { useFlag } from "@/hooks/useFlag";\nimport { OTHER_FLAG } from "@/lib/flags/keys";\n// useFlag(OTHER_FLAG)\nconst note = "useFlag(OTHER_FLAG)";\nconst pattern = /useFlag(OTHER_FLAG)/;\nconst OTHER_FLAG_SUFFIX = true;\nfunction fake(useFlag) { return useFlag(OTHER_FLAG); }\nexport const Widget = () => <p>useFlag(OTHER_FLAG)</p>;\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-5 [FEATURE] add widget", base, head, dir)).pass, false);
});

test("a registered literal passed to isFeatureEnabled counts", async (t) => {
  const { dir, git } = makeRepo(t);
  const base = commit(git, "base");
  writeFile(dir, "src/app/page.tsx", 'import { isFeatureEnabled } from "@/lib/flags";\nexport async function Page() { return await isFeatureEnabled("htpr-1-other", 6) ? <div /> : null; }\n');
  const head = commit(git, "feature");
  assert.equal((await evaluate("HTPR-1 [FEATURE] add widget", base, head, dir)).pass, true);
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
  assert.doesNotMatch(workflow, /^  pull_request\s*:/m);
  assert.match(workflow, /types: \[opened, synchronize, reopened, edited, ready_for_review, closed\]/);
  assert.match(workflow, /push:\s+branches: \[production\]/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event\.action != 'closed'/);
  assert.match(workflow, /if: github\.event_name == 'push' \|\| github\.event_name == 'pull_request_target'/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.match(workflow, /Every event reconciles all open PRs/);
  assert.match(workflow, /group: feature-flag-gate-production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.equal((workflow.match(/cache: npm/g) || []).length, 2);
  assert.equal((workflow.match(/cache-dependency-path: package-lock\.json/g) || []).length, 2);
  assert.equal((workflow.match(/typescript@6\.0\.3/g) || []).length, 2);
  assert.equal((workflow.match(/FEATURE_FLAG_TYPESCRIPT_PATH/g) || []).length, 2);
  assert.equal((workflow.match(/ref: production/g) || []).length, 2);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /gh api "repos\/\$REPO\/pulls\/\$PR_NUMBER"/);
  assert.match(workflow, /git fetch --no-tags origin production "refs\/pull\/\$PR_NUMBER\/head"/);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /statuses: write/);
  assert.match(workflow, /state: "pending"/);
  assert.match(workflow, /mark feature-flag-gate pending/);
  assert.match(workflow, /publish_error_status/);
  assert.match(workflow, /publish_reconciliation_error/);
  assert.match(workflow, /could not refresh pull-request heads/);
  assert.ok(workflow.indexOf('state: "pending"') < workflow.indexOf("elif node .github/scripts/feature-flag-gate.mjs"));
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
