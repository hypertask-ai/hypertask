const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");

// HTPR-7173: /api/users/getAll returned every User row (email, uid,
// stripe_customer_id) to anyone, even logged out. Nothing called it, so it is
// gone. A global user listing must not come back.
test("HTPR-7173: the global user listing route and controller stay deleted", () => {
  for (const file of [
    "src/pages/api/users/getAll.ts",
    "src/pages/api/users/getAll.js",
    "src/pages/api/users/getAll/index.ts",
    "src/app/api/users/getAll/route.ts",
    "src/utils/controllers/users/getAll.ts",
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), false, `${file} must not exist`);
  }
});

test("HTPR-7173: no source references the removed listing", () => {
  let hits = "";
  try {
    hits = execFileSync(
      "git",
      ["grep", "-nE", "api/users/getAll\\b|controllers/users/getAll\\b|\\bgetAllUsers\\b", "--", "src"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch (error) {
    // git grep exits 1 when nothing matches.
    assert.equal(error.status, 1);
  }
  assert.equal(hits, "");
});
