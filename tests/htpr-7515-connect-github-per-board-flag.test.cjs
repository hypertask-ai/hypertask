process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const filename = "src/lib/flags/definitions/htpr-7515-connect-github-per-board.ts";
const source = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");

test("Connect GitHub uses the per-file registry and the approved Only me access-risk default", async () => {
  const { parseFlagFile } = await import("../.github/scripts/feature-flag-registry.mjs");
  const { definition } = parseFlagFile(source, filename);
  assert.equal(definition.key, "htpr-7515-connect-github-per-board");
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_ONLY");
  assert.equal(definition.shippedOn, "2026-10-21");
  assert.equal(definition.releaseRisk.risk, "new");
  assert.equal(definition.releaseRisk.highRisk, "access");
  assert.ok(definition.releaseRisk.reason.length > 0);
  assert.match(source, /export const HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG =/);
});
