const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { __esModule: true, default: {} },
};
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { defaultFeatureFlagMode, featureFlagModeEnabled } = jiti(path.join(root, "src/lib/flags.ts"));

test("lowercase retyping is available to customers by default and can be switched off", () => {
  assert.equal(featureFlagModeEnabled(defaultFeatureFlagMode("htpr-5908-retype-lowercase"), false, false), true);
  assert.equal(featureFlagModeEnabled("OFF", false, false), false);
  assert.equal(featureFlagModeEnabled(defaultFeatureFlagMode("htpr-5908-local-writing-assistance"), false, false), false);
});
