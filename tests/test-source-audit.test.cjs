const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");

async function loadAudit() {
  return import(pathToFileURL(path.join(root, "scripts/test-source-audit.mjs")).href);
}

const sourceOnlyFile = [
  'const test = require("node:test");',
  'const assert = require("node:assert/strict");',
  'const { readFileSync } = require("node:fs");',
  'const { join } = require("node:path");',
  'test("route exports GET", () => {',
  '  const source = readFileSync(join(__dirname, "../src/app/route.ts"), "utf8");',
  "  assert.match(source, /export const GET/);",
  "});",
].join("\n");

const behaviourFile = [
  'const test = require("node:test");',
  'const assert = require("node:assert/strict");',
  'const { add } = require("../src/arithmetic.js");',
  'test("adds", () => {',
  "  assert.equal(add(1, 2), 3);",
  "});",
].join("\n");

test("a file that reads source as text and asserts on it is source-text", async () => {
  const { classifyTestSource } = await loadAudit();
  const row = classifyTestSource("tests/route-guard.test.cjs", sourceOnlyFile);
  assert.equal(row.class, "source-text");
  assert.equal(row.sourceTests, 1);
  assert.equal(row.behaviourTests, 0);
  assert.deepEqual(row.targets, ["src/app/route.ts"]);
});

test("a file that calls code and asserts the result is behaviour", async () => {
  const { classifyTestSource } = await loadAudit();
  const row = classifyTestSource("tests/arithmetic.test.cjs", behaviourFile);
  assert.equal(row.class, "behaviour");
  assert.equal(row.sourceTests, 0);
});

test("a file with both kinds of test is mixed", async () => {
  const { classifyTestSource } = await loadAudit();
  const row = classifyTestSource("tests/mixed.test.cjs", [sourceOnlyFile, behaviourFile].join("\n"));
  assert.equal(row.class, "mixed");
  assert.equal(row.sourceTests, 1);
  assert.equal(row.behaviourTests, 1);
});

test("test blocks split on every top level test call", async () => {
  const { splitTestBlocks } = await loadAudit();
  const blocks = splitTestBlocks([sourceOnlyFile, behaviourFile].join("\n"));
  assert.deepEqual(
    blocks.map((block) => block.title),
    ["route exports GET", "adds"],
  );
});

test("module specifiers resolve to source keys and skip builtins", async () => {
  const { moduleKey } = await loadAudit();
  assert.equal(moduleKey("@/lib/flags", "tests/a.test.cjs"), "src/lib/flags");
  assert.equal(moduleKey("../src/lib/flags.ts", "tests/a.test.cjs"), "src/lib/flags");
  assert.equal(moduleKey("../../../src/lib/flags", "tests/app/api/a.test.ts"), "src/lib/flags");
  assert.equal(moduleKey("node:fs", "tests/a.test.cjs"), null);
});

test("a behaviour test importing the guarded module counts as coverage", async () => {
  const { importIndex, coveringTests } = await loadAudit();
  const index = importIndex([
    { file: "tests/route.test.cjs", class: "behaviour", imports: ["src/app/route"] },
    { file: "tests/other.test.cjs", class: "source-text", imports: [] },
  ]);
  const coverage = coveringTests({ file: "tests/route-guard.test.cjs", targets: ["src/app/route.ts"] }, index);
  assert.deepEqual(coverage, ["tests/route.test.cjs"]);
  const none = coveringTests({ file: "tests/route-guard.test.cjs", targets: ["src/unused/module.ts"] }, index);
  assert.deepEqual(none, []);
});

test("ticket and access markers keep a source-text test, before any delete call", async () => {
  const { decideRow, RULES } = await loadAudit();
  const base = { file: "tests/route-guard.test.cjs", targets: ["src/app/route.ts"], titles: [], class: "source-text", behaviourTests: 0 };
  const ticket = decideRow({ ...base, titles: ["route lives HTPR-6138"] }, ["tests/route.test.cjs"]);
  assert.equal(ticket.decision, "keep");
  assert.equal(ticket.rule, RULES.ticket);
  assert.equal(ticket.evidence, "HTPR-6138");
  const access = decideRow({ ...base, file: "tests/security/revocation.test.cjs" }, ["tests/security.test.cjs"]);
  assert.equal(access.rule, RULES.access);
});

test("policy guards stay, mixed files are rewritten, covered files are deleted, sole guards are ported", async () => {
  const { decideRow, RULES } = await loadAudit();
  const base = { file: "tests/route-guard.test.cjs", targets: ["src/app/route.ts"], titles: [], class: "source-text", behaviourTests: 0 };
  assert.equal(decideRow({ ...base, targets: [".github/workflows/ci-tests.yml"] }, []).rule, RULES.policy);
  assert.equal(decideRow({ ...base, targets: [], class: "mixed", behaviourTests: 3 }, []).rule, RULES.mixed);
  assert.equal(decideRow(base, ["tests/route.test.cjs"]).decision, "delete");
  assert.equal(decideRow(base, []).rule, RULES.soleGuard);
  assert.equal(decideRow(base, []).decision, "rewrite");
});

test("cost attribution counts untimed files and shares the measured total", async () => {
  const { costOf } = await loadAudit();
  const cost = costOf(
    { provenance: { runId: 1, sha: "abc" }, files: [["tests/a.test.cjs", 2000]] },
    [
      { file: "tests/a.test.cjs", class: "source-text" },
      { file: "tests/b.test.cjs", class: "behaviour" },
    ],
  );
  assert.equal(cost.measuredSeconds, 2);
  assert.equal(cost.untimedFiles, 1);
  assert.equal(cost.classes["source-text"].seconds, 2);
  assert.equal(cost.classes["source-text"].share, 100);
  assert.equal(cost.classes.behaviour.untimed, 1);
});

test("the audit's own test stays a behaviour test and off the allowlist", async () => {
  const { classifyTestSource } = await loadAudit();
  const source = require("node:fs").readFileSync(__filename, "utf8");
  assert.equal(classifyTestSource("tests/test-source-audit.test.cjs", source).class, "behaviour");
});
