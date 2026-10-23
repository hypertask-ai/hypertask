const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

test("release watch offline script suite", () => {
  const result = spawnSync(process.execPath, ["--test", path.join(__dirname, "../.github/scripts/flag-release-watch.test.mjs")], { encoding: "utf8", timeout: 30_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
