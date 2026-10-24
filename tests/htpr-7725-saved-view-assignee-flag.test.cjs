process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const filename = "src/lib/flags/definitions/htpr-7725-saved-view-assignee.ts";
const source = fs.readFileSync(path.join(__dirname, "..", filename), "utf8");

test("saved-view human assignee bugfix defaults to Everyone", async () => {
  const { parseFlagFile } = await import("../.github/scripts/feature-flag-registry.mjs");
  const { definition } = parseFlagFile(source, filename);

  assert.equal(definition.key, "htpr-7725-saved-view-assignee");
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.length > 0);
});
