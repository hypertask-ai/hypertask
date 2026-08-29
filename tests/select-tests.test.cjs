// The PR lane runs only the tests this script picks. If it silently returns a
// narrow set for a wide change, a regression ships with a green PR check.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const scriptUrl = pathToFileURL(
  path.join(root, ".github/scripts/select-tests.mjs"),
).href;

async function select(changed) {
  const { selectTests } = await import(scriptUrl);
  return selectTests(changed);
}

test("a dependency or schema change runs the whole suite", async () => {
  assert.equal(await select(["package.json"]), "ALL");
  assert.equal(await select(["prisma/schema.prisma"]), "ALL");
  assert.equal(await select(["tsconfig.json"]), "ALL");
});

test("a wide fan-out across shared lib code runs the whole suite", async () => {
  const wide = Array.from({ length: 6 }, (_, i) => `src/lib/thing-${i}.ts`);
  assert.equal(await select(wide), "ALL");
});

test("a change no test references falls back to the whole suite", async () => {
  // Built at runtime so this file's own text cannot match the needle.
  const unreferenced = `src/components/${"Unref"}${"erencedWidgetQqz"}.tsx`;
  assert.equal(await select([unreferenced]), "ALL");
});

test("a referenced source file selects the tests naming it", async () => {
  const selected = await select(["src/lib/mcp/auth.ts"]);
  assert.notEqual(selected, "ALL");
  assert.ok(selected.includes("tests/account-token-revocation.test.cjs"));
});

test("nested suites are discoverable, not just the flat tests dir", async () => {
  const selected = await select([
    "tests/security/getCount.test.ts",
    "src/lib/mcp/auth.ts",
  ]);
  assert.notEqual(selected, "ALL");
  assert.ok(selected.includes("tests/security/getCount.test.ts"));
});

test("a file referenced only by name, not by path, runs the full suite", async () => {
  // A test mentioning the word is not evidence it covers the file. Built at
  // runtime so this file's own text is not the reference.
  const named = `src/lib/${"task-write"}${"-lock.ts"}`;
  assert.equal(await select([named]), "ALL");
});

test("a deleted test path never reaches the runner", async () => {
  // git diff lists deletions; run-tests.mjs rejects anything off the inventory.
  const selected = await select([
    "tests/deleted-suite-qqz.test.cjs",
    "src/lib/mcp/auth.ts",
  ]);
  assert.notEqual(selected, "ALL");
  assert.ok(!selected.includes("tests/deleted-suite-qqz.test.cjs"));
});

test("an unreferenced file forces ALL even alongside a changed test", async () => {
  const unreferenced = `src/components/${"Unref"}${"erencedWidgetQqz"}.tsx`;
  assert.equal(await select(["tests/agent-slug.test.cjs", unreferenced]), "ALL");
});

test("a changed test file is always run", async () => {
  const selected = await select(["tests/agent-slug.test.cjs"]);
  assert.ok(Array.isArray(selected));
  assert.ok(selected.includes("tests/agent-slug.test.cjs"));
});

test("selection always includes the cheap runner and demo guards", async () => {
  const selected = await select(["tests/agent-slug.test.cjs"]);
  assert.ok(selected.includes("tests/test-inventory.test.cjs"));
  assert.ok(selected.includes("tests/demo-smoke.test.cjs"));
});

test("selected paths are committed test files the runner accepts", async () => {
  const fs = require("node:fs");
  const selected = await select(["tests/agent-slug.test.cjs"]);
  for (const file of selected) {
    assert.match(file, /^tests\/[A-Za-z0-9._/-]+\.test\.(cjs|ts)$/);
    assert.ok(fs.existsSync(path.join(root, file)), `${file} does not exist`);
  }
});

test("a test added by the same PR does not count as coverage", async () => {
  // A PR could otherwise add a test naming its source file and buy its way
  // out of the full suite.
  const selected = await select([
    "tests/select-tests.test.cjs",
    "src/lib/select-tests-fixture-qqz.ts",
  ]);
  assert.equal(selected, "ALL");
});
