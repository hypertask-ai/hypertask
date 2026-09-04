const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let row = null;
let readError = null;
let sessionUserId = 6;
let usersById = new Map();
const prisma = {
  user: { findUnique: async ({ where }) => usersById.get(where.id) ?? null },
  featureFlag: {
    findUnique: async () => {
      if (readError) throw readError;
      return row;
    },
    findMany: async () => (row ? [{ key: "htpr-6091-feature-flags", ...row }] : []),
    upsert: async ({ where, create, update }) => {
      row = { mode: row ? update.mode : create.mode, updatedAt: new Date() };
      return { key: where.key, ...row };
    },
  },
};

const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { __esModule: true, default: prisma },
};
const authPath = path.join(root, "src/lib/auth/getSessionUser.ts");
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: { getSessionUser: async () => ({ userId: sessionUserId }) },
};
const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const flags = jiti(path.join(root, "src/lib/flags.ts"));

test.beforeEach(() => {
  row = null;
  readError = null;
  sessionUserId = 6;
  usersById = new Map([[6, { email: "valentin.yeo@gmail.com" }]]);
});

test("admin access requires the signed, active owner", async () => {
  assert.equal(await flags.isFeatureFlagOwner(new Headers()), true);
  sessionUserId = 7;
  assert.equal(await flags.isFeatureFlagOwner(new Headers()), false);
  sessionUserId = 6;
  usersById.clear();
  assert.equal(await flags.isFeatureFlagOwner(new Headers()), false);
});

test("owner access requires both the approved id and login identity", async () => {
  usersById.set(6, { email: "someone@example.com" });
  assert.equal(await flags.isFeatureFlagOwner(new Headers()), false);
  usersById.set(6, { email: "VALENTIN.YEO@GMAIL.COM" });
  assert.equal(await flags.isFeatureFlagOwner(new Headers()), true);
  sessionUserId = 42;
  usersById.set(42, { email: "valentin.yeo@gmail.com" });
  assert.equal(await flags.isFeatureFlagOwner(new Headers()), false);
});

test("feature flag modes enforce owner-only, everyone, and off", () => {
  assert.equal(flags.featureFlagModeEnabled("OWNER_ONLY", true), true);
  assert.equal(flags.featureFlagModeEnabled("OWNER_ONLY", false), false);
  assert.equal(flags.featureFlagModeEnabled("EVERYONE", false), true);
  assert.equal(flags.featureFlagModeEnabled("OFF", true), false);
});

test("the mobile All Tasks redesign starts owner-only", async () => {
  assert.equal(await flags.isFeatureEnabled("htpr-5992-mobile-all-tasks", 6), true);
  assert.equal(await flags.isFeatureEnabled("htpr-5992-mobile-all-tasks", 7), false);
});

test("copy current URL starts owner-only", async () => {
  assert.equal(await flags.isFeatureEnabled("htpr-6112-copy-current-url", 6), true);
  assert.equal(await flags.isFeatureEnabled("htpr-6112-copy-current-url", 7), false);
});

test("a missing row defaults to owner only", async () => {
  assert.equal(await flags.isFeatureEnabled("htpr-6091-feature-flags", 6), true);
  assert.equal(await flags.isFeatureEnabled("htpr-6091-feature-flags", 7), false);
});

test("database failures fail closed instead of becoming the default", async () => {
  readError = new Error("database unavailable");
  await assert.rejects(flags.isFeatureEnabled("htpr-6091-feature-flags", 6), /database unavailable/);
});

test("declared flags remain listed without a row and can be changed", async () => {
  assert.deepEqual(await flags.listFeatureFlagModes(), [
    { key: "htpr-5992-mobile-all-tasks", mode: "OWNER_ONLY", updatedAt: null },
    { key: "htpr-6091-feature-flags", mode: "OWNER_ONLY", updatedAt: null },
    { key: "htpr-6112-copy-current-url", mode: "OWNER_ONLY", updatedAt: null },
  ]);
  const changed = await flags.setFeatureFlagMode("htpr-6091-feature-flags", "EVERYONE");
  assert.equal(changed.mode, "EVERYONE");
  assert.equal(await flags.isFeatureEnabled("htpr-6091-feature-flags", 7), true);
});

test("unknown flags fail closed and cannot create rows", async () => {
  assert.equal(await flags.isFeatureEnabled("unknown-flag", 6), false);
  await assert.rejects(flags.setFeatureFlagMode("unknown-flag", "OFF"), /Unknown feature flag/);
  await assert.rejects(flags.setFeatureFlagMode("Bad Flag", "OFF"), /Invalid feature flag/);
});
