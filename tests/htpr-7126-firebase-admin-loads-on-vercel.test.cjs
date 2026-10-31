const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("HTPR-7126: firebase-admin auth loads without require(esm)", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--no-experimental-require-module",
      "-e",
      "require('firebase-admin/app'); require('firebase-admin/auth');",
    ],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
});
