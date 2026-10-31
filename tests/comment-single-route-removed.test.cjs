const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

for (const relativePath of [
  "src/pages/api/comments/single.ts",
  "src/utils/controllers/comments/single.ts",
]) {
  test(`${relativePath} remains removed`, () => {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false);
  });
}
