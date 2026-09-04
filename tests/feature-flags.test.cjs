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
  usersById = new Map([
    [6, { email: "valentin.yeo@gmail.com" }],
    [985, { email: "valentin@hypertask.ai" }],
  ]);
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

test("QA access requires both the approved id and login identity", async () => {
  assert.equal(await flags.isFeatureEnabled("htpr-6091-feature-flags", 985), true);
  usersById.set(985, { email: "someone@example.com" });
  assert.equal(await flags.isFeatureEnabled("htpr-6091-feature-flags", 985), false);
  usersById.set(7, { email: "valentin@hypertask.ai" });
  assert.equal(await flags.isFeatureEnabled("htpr-6091-feature-flags", 7), false);
});

test("feature flag modes enforce owner, QA, everyone, and off access", () => {
  assert.equal(flags.featureFlagModeEnabled("OWNER_ONLY", true, false), true);
  assert.equal(flags.featureFlagModeEnabled("OWNER_ONLY", false, true), false);
  assert.equal(flags.featureFlagModeEnabled("OWNER_AND_QA", true, false), true);
  assert.equal(flags.featureFlagModeEnabled("OWNER_AND_QA", false, true), true);
  assert.equal(flags.featureFlagModeEnabled("OWNER_AND_QA", false, false), false);
  assert.equal(flags.featureFlagModeEnabled("EVERYONE", false, false), true);
  assert.equal(flags.featureFlagModeEnabled("OFF", true, true), false);
});

test("the mobile All Tasks redesign starts with owner and QA access", async () => {
  assert.equal(await flags.isFeatureEnabled("htpr-5992-mobile-all-tasks", 6), true);
  assert.equal(await flags.isFeatureEnabled("htpr-5992-mobile-all-tasks", 985), true);
  assert.equal(await flags.isFeatureEnabled("htpr-5992-mobile-all-tasks", 7), false);
});

test("background task uploads start with owner and QA access", async () => {
  assert.equal(
    await flags.isFeatureEnabled("htpr-5993-optimistic-task-uploads", 6),
    true,
  );
  assert.equal(
    await flags.isFeatureEnabled("htpr-5993-optimistic-task-uploads", 985),
    true,
  );
  assert.equal(
    await flags.isFeatureEnabled("htpr-5993-optimistic-task-uploads", 7),
    false,
  );
});

test("copy current URL starts with owner and QA access", async () => {
  assert.equal(await flags.isFeatureEnabled("htpr-6112-copy-current-url", 6), true);
  assert.equal(await flags.isFeatureEnabled("htpr-6112-copy-current-url", 985), true);
  assert.equal(await flags.isFeatureEnabled("htpr-6112-copy-current-url", 7), false);
});

test("comment reaction API starts with owner and QA access", async () => {
  assert.equal(await flags.isFeatureEnabled("htpr-6118-comment-reactions-api", 6), true);
  assert.equal(await flags.isFeatureEnabled("htpr-6118-comment-reactions-api", 985), true);
  assert.equal(await flags.isFeatureEnabled("htpr-6118-comment-reactions-api", 7), false);
});

test("mobile Agent Chat viewport fix starts owner-only", async () => {
  assert.equal(
    await flags.isFeatureEnabled("htpr-6129-mobile-agent-chat-viewport", 6),
    true,
  );
  assert.equal(
    await flags.isFeatureEnabled("htpr-6129-mobile-agent-chat-viewport", 985),
    false,
  );
  assert.equal(
    await flags.isFeatureEnabled("htpr-6129-mobile-agent-chat-viewport", 7),
    false,
  );
});

test("declared flags without rows default to owner and QA", async () => {
  for (const key of [
    "htpr-5913-consistent-comment-shortcuts",
    "htpr-6091-feature-flags",
    "htpr-6115-agent-sdk",
    "htpr-6116-figma-node-preview",
  ]) {
    assert.equal(await flags.isFeatureEnabled(key, 6), true);
    assert.equal(await flags.isFeatureEnabled(key, 985), true);
    assert.equal(await flags.isFeatureEnabled(key, 7), false);
  }
});

test("the mobile reminder safe-area fix starts owner-only", async () => {
  assert.equal(await flags.isFeatureEnabled("htpr-6130-mobile-reminder-safe-area", 6), true);
  assert.equal(await flags.isFeatureEnabled("htpr-6130-mobile-reminder-safe-area", 985), false);
  assert.equal(await flags.isFeatureEnabled("htpr-6130-mobile-reminder-safe-area", 7), false);
});

test("the AI-first task writer starts owner-only", async () => {
  assert.equal(await flags.isFeatureEnabled("htpr-6141-ai-first-task-writer", 6), true);
  assert.equal(await flags.isFeatureEnabled("htpr-6141-ai-first-task-writer", 985), false);
  assert.equal(await flags.isFeatureEnabled("htpr-6141-ai-first-task-writer", 7), false);
});

test("per-user flag responses distinguish QA from normal members", async () => {
  const qaFlags = await flags.featureFlagsForUser(985);
  const normalFlags = await flags.featureFlagsForUser(7);
  assert.equal(qaFlags["htpr-6116-figma-node-preview"], true);
  assert.equal(normalFlags["htpr-6116-figma-node-preview"], false);
});

test("stored owner-only flags stay unavailable to QA until changed", async () => {
  row = { mode: "OWNER_ONLY", updatedAt: new Date() };
  assert.equal(await flags.isFeatureEnabled("htpr-6091-feature-flags", 6), true);
  assert.equal(await flags.isFeatureEnabled("htpr-6091-feature-flags", 985), false);
  await flags.setFeatureFlagMode("htpr-6091-feature-flags", "OWNER_AND_QA");
  assert.equal(await flags.isFeatureEnabled("htpr-6091-feature-flags", 985), true);
});

test("database failures fail closed instead of becoming the default", async () => {
  readError = new Error("database unavailable");
  await assert.rejects(flags.isFeatureEnabled("htpr-6091-feature-flags", 6), /database unavailable/);
});

test("declared flags remain listed without a row and can be changed", async () => {
  assert.deepEqual(await flags.listFeatureFlagModes(), [
    {
      key: "htpr-5913-consistent-comment-shortcuts",
      mode: "OWNER_AND_QA",
      updatedAt: null,
    },
    { key: "htpr-5992-mobile-all-tasks", mode: "OWNER_AND_QA", updatedAt: null },
    { key: "htpr-5993-optimistic-task-uploads", mode: "OWNER_AND_QA", updatedAt: null },
    { key: "htpr-6091-feature-flags", mode: "OWNER_AND_QA", updatedAt: null },
    { key: "htpr-6112-copy-current-url", mode: "OWNER_AND_QA", updatedAt: null },
    { key: "htpr-6115-agent-sdk", mode: "OWNER_AND_QA", updatedAt: null },
    { key: "htpr-6116-figma-node-preview", mode: "OWNER_AND_QA", updatedAt: null },
    { key: "htpr-6118-comment-reactions-api", mode: "OWNER_AND_QA", updatedAt: null },
    {
      key: "htpr-6129-mobile-agent-chat-viewport",
      mode: "OWNER_ONLY",
      updatedAt: null,
    },
    { key: "htpr-6130-mobile-reminder-safe-area", mode: "OWNER_ONLY", updatedAt: null },
    { key: "htpr-6141-ai-first-task-writer", mode: "OWNER_ONLY", updatedAt: null },
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
