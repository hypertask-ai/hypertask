const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7585-ctrlj-waits-for-flags";
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });

test("Ctrl+J loading bugfix defaults to Everyone and is discovered by the flag registry", async () => {
  const filename = `src/lib/flags/definitions/${flagKey}.ts`;
  const { parseFlagFile } = await import("../.github/scripts/feature-flag-registry.mjs");
  const { definition } = parseFlagFile(fs.readFileSync(path.join(root, filename), "utf8"), filename);
  const flag = jiti(path.join(root, filename));
  const keys = jiti(path.join(root, "src/lib/flags/keys.ts"));
  const { FEATURE_FLAG_DEFINITIONS } = jiti(path.join(root, "src/lib/flags/definitions.ts"));
  assert.equal(flag.HTPR_7585_CTRLJ_WAITS_FOR_FLAGS_FLAG, flagKey);
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-22");
  assert.deepEqual(definition.related, ["htpr-6929-compose-task-writer"]);
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason.trim());
  assert.equal(keys.HTPR_7585_CTRLJ_WAITS_FOR_FLAGS_FLAG, flagKey);
  assert.deepEqual(FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === flagKey), flag.default ?? flag);
});
