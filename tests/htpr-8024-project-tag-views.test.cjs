const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");

test("project tag merges stay limited to owner and QA until approved", async () => {
  const { parseFlagFile } = await import("../.github/scripts/feature-flag-registry.mjs");
  const file = "src/lib/flags/definitions/htpr-8024-project-tag-views.ts";
  const { definition: flag } = parseFlagFile(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), file);
  assert.equal(flag.key, "htpr-8024-project-tag-views");
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.highRisk, "data-deletion");
});
