const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

let mode = null;
const prisma = {
  user: { findUnique: async () => ({ email: "customer@example.test" }) },
  featureFlag: { findUnique: async () => (mode ? { mode } : null) },
};
const flags = loadModule("src/lib/flags.ts", {
  "@/lib/prisma": { default: prisma },
});
const { default: definition, HTPR_8015_AMOLED_MODE_OUTLINE_FLAG: key } = loadModule(
  "src/lib/flags/definitions/htpr-8015-amoled-mode-outline.ts",
);

test("AMOLED mode outline reaches ordinary customers by default and Off disables it", async () => {
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.equal(await flags.isFeatureEnabled(key, 2343), true);
  mode = "OFF";
  assert.equal(await flags.isFeatureEnabled(key, 2343), false);
  assert.equal(await flags.isFeatureEnabled(key, 985), false);
});
