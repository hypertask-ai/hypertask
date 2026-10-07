const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");

// HTPR-6995: every page load mints a token; that must never undo "revoke all".
test("minting a page token never clears the revoke-all marker", () => {
  const source = fs.readFileSync(path.join(root, "src/app/api/mcp/token/route.ts"), "utf8");
  assert.doesNotMatch(source, /mcpTokensRevokedAt:\s*null/);
});

test("route regression: old tokens stay rejected, the new page token works", () => {
  const result = spawnSync("npx", ["tsx", "src/app/api/mcp/token/route.test.ts"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
