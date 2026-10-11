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

test("a test importing a changed file by relative path is selected (YPER4-238)", async () => {
  // ai-chat-cancellation.test.ts imports "../src/app/api/ai/chat/stream/streamLease"
  // with no extension, so the repo-relative path never appears in its text.
  const selected = await select(["src/app/api/ai/chat/stream/streamLease.ts"]);
  assert.notEqual(selected, "ALL");
  assert.ok(selected.includes("tests/ai-chat-cancellation.test.ts"));
});

test("the import graph follows aliases, relative hops, path.join and unresolvable requires", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const { execFileSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "select-graph-"));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  put("scripts/test-inventory.mjs", fs.readFileSync(path.join(root, "scripts/test-inventory.mjs"), "utf8"));
  put(".github/scripts/select-tests.mjs", fs.readFileSync(path.join(root, ".github/scripts/select-tests.mjs"), "utf8"));
  put("src/lib/leaf.ts", "export const leaf = 1;\n");
  put("src/lib/mid.ts", 'import { leaf } from "@/lib/leaf";\nexport const mid = leaf;\n');
  put("src/lib/dir/index.ts", "export const d = 1;\n");
  put("src/lib/other.ts", "export const other = 1;\n");
  put("src/lib/orphan.ts", "export const orphan = 1;\n");
  put("tests/alias.test.cjs", 'require("../src/lib/mid");\n');
  put("tests/barrel.test.ts", 'import "../src/lib/dir";\n');
  put("tests/join.test.cjs", 'const p = require("node:path").join(__dirname, "..", "src", "lib", "other.ts");\n');
  put("tests/helper.cjs", 'require("../src/lib/leaf");\n');
  put("tests/viahelper.test.cjs", 'require("./helper.cjs");\n');
  put("tests/dynamic.test.cjs", "const name = process.env.X;\nrequire(name);\n");
  put("tests/test-inventory.test.cjs", "// guard\n");
  put("tests/demo-smoke.test.cjs", "// guard\n");
  put("tests/file-size-limit.test.cjs", "// guard\n");
  const pick = (file) =>
    execFileSync(process.execPath, [".github/scripts/select-tests.mjs", file], { cwd: dir, encoding: "utf8" })
      .trim().split("\n");
  try {
    const leaf = pick("src/lib/leaf.ts");
    assert.ok(leaf.includes("tests/alias.test.cjs"), "alias + relative hop");
    assert.ok(leaf.includes("tests/viahelper.test.cjs"), "through a test helper");
    assert.ok(leaf.includes("tests/dynamic.test.cjs"), "unresolvable require widens");
    assert.ok(!leaf.includes("tests/join.test.cjs"), "unrelated test is skipped");
    assert.ok(pick("src/lib/dir/index.ts").includes("tests/barrel.test.ts"), "directory index");
    assert.ok(pick("src/lib/other.ts").includes("tests/join.test.cjs"), "path.join with __dirname");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
