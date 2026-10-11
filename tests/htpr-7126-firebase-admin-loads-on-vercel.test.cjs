const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

// HTPR-7126: Vercel's runtime cannot require() an ES module. firebase-admin 14
// pulled in jwks-rsa 4, which require()s the ESM-only jose 6, so every route
// that loads Firebase Admin crashed before its handler ran. Newer local Node
// hides this, so load the auth path with require(esm) switched off.
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
