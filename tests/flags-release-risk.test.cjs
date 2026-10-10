const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
for (const [relative, exports] of [
  ["src/lib/prisma.ts", { __esModule: true, default: { featureFlag: { findMany: async () => [] } } }],
  ["src/lib/auth/getSessionUser.ts", { getSessionUser: async () => null }],
]) {
  const filename = path.join(root, relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src"), react: require.resolve("react") }, interopDefault: true });
const { FEATURE_FLAG_KEYS, listFeatureFlagModes } = jiti(path.join(root, "src/lib/flags.ts"));
const { FEATURE_FLAG_RELEASE_RISKS: risks, RELEASE_RISK_REQUIRED_FROM } = jiti(path.join(root, "src/lib/flags/releaseRisk.ts"));

function missingRiskEntries(definitions, risks) {
  return definitions.filter(flag => flag.shippedOn >= RELEASE_RISK_REQUIRED_FROM && !risks[flag.key]).map(flag => flag.key);
}

test(`every declared flag first shipped from ${RELEASE_RISK_REQUIRED_FROM} has a release-risk entry`, async () => {
  const definitions = await listFeatureFlagModes();
  assert.ok(definitions.length > 0);
  assert.deepEqual(new Set(definitions.map(flag => flag.key)), new Set(FEATURE_FLAG_KEYS));
  assert.deepEqual(missingRiskEntries(definitions, risks), []);
  assert.ok(risks["htpr-7058-flags-page-url-filters"]);
});

test("required-entry check rejects a new flag without metadata, not an older flag", () => {
  const fixtures = [{ key: "old", shippedOn: "2026-10-09" }, { key: "pending", shippedOn: "2026-10-10" }, { key: "new", shippedOn: RELEASE_RISK_REQUIRED_FROM }];
  assert.deepEqual(missingRiskEntries(fixtures, {}), ["new"]);
  assert.deepEqual(missingRiskEntries(fixtures, { new: { risk: "small", reason: "Changes an existing screen." } }), []);
});

test("release-risk metadata uses declared keys, the three labels and plain one-line reasons", async () => {
  const keys = new Set((await listFeatureFlagModes()).map(flag => flag.key));
  for (const [key, entry] of Object.entries(risks)) {
    assert.ok(keys.has(key), `Unknown flag ${key}`);
    assert.ok(["none", "small", "new"].includes(entry.risk), key);
    assert.equal(typeof entry.reason, "string", key);
    assert.ok(entry.reason.trim().length > 0, key);
    assert.doesNotMatch(entry.reason, /[\r\n\u2014]/, key);
  }
});
