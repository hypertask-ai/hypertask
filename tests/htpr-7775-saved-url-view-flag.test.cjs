process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const filename = "src/lib/flags/definitions/htpr-7775-saved-url-view.ts";

test("saved URL view bugfix flag defaults to Everyone with small release risk", async () => {
  const { parseFlagFile } = await import("../.github/scripts/feature-flag-registry.mjs");
  const { definition } = parseFlagFile(fs.readFileSync(path.join(root, filename), "utf8"), filename);
  assert.equal(definition.key, "htpr-7775-saved-url-view");
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.length > 0);
});
