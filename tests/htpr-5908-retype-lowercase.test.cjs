const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const { defaultFeatureFlagMode, featureFlagModeEnabled } = loadModule("src/lib/flags.ts", {
  "@/lib/prisma": { default: {} },
});

test("lowercase retyping is available to customers by default and can be switched off", () => {
  assert.equal(featureFlagModeEnabled(defaultFeatureFlagMode("htpr-5908-retype-lowercase"), false, false), true);
  assert.equal(featureFlagModeEnabled("OFF", false, false), false);
  assert.equal(featureFlagModeEnabled(defaultFeatureFlagMode("htpr-5908-local-writing-assistance"), false, false), true);
});
