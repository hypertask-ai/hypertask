// HTPR-5809: the legacy single-comment handler exposed and updated comments by
// numeric ID without authentication or object authorization. It had no callers,
// so keep the endpoint and its dormant controller removed.
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
