const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

test("release watch offline suite covers continued PATCH processing and notification failures", () => {
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", path.join(__dirname, "../.github/scripts/flag-release-watch.test.mjs")], { encoding: "utf8", timeout: 30_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const scenario of [
    "HTTP failure is logged and remaining flags and release groups are still attempted",
    "notification failure is logged and remaining flags and release groups are still attempted",
    "multiple failed PATCHes are all collected after every flag is attempted",
  ]) assert.ok(result.stdout.includes(scenario), result.stdout + result.stderr);
});
