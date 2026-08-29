const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");

async function loadInventory() {
  return import(
    pathToFileURL(path.join(root, "scripts/test-inventory.mjs")).href
  );
}

test("unsupported committed test conventions fail inventory classification", async () => {
  const { classifyTestFiles } = await loadInventory();
  const inventory = classifyTestFiles([
    "tests/behavior.test.cjs",
    "tests/security/access.test.ts",
    "tests/browser.spec.ts",
    "tests/helper.types.ts",
  ]);

  assert.deepEqual(inventory.supported, [
    "tests/behavior.test.cjs",
    "tests/security/access.test.ts",
  ]);
  assert.deepEqual(inventory.unsupported, ["tests/browser.spec.ts"]);
});

test("the real inventory includes nested TypeScript security tests", async () => {
  const { discoverTestFiles } = await loadInventory();
  const { supported, unsupported } = await discoverTestFiles({
    root,
    testsRoot: path.join(root, "tests"),
  });

  const previouslySkippedTests = [
    "tests/archive-draft-api.test.ts",
    "tests/security/generatePublicInvite.test.ts",
    "tests/security/getCount.test.ts",
  ];
  for (const file of previouslySkippedTests) {
    assert.ok(supported.includes(file), `${file} is present in the inventory`);
  }
  assert.deepEqual(unsupported, []);
});
