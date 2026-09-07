const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let row = null;
let listedRows = null;
let readError = null;
let sessionUserId = 6;
let usersById = new Map();
let taskRows = [];
const prisma = {
  user: { findUnique: async ({ where }) => usersById.get(where.id) ?? null },
  task: { findMany: async ({ where }) => taskRows.filter(({ uniqueIndex }) => where.uniqueIndex.in.includes(uniqueIndex)) },
  featureFlag: {
    findUnique: async () => {
      if (readError) throw readError;
      return row;
    },
    findMany: async () =>
      listedRows ?? (row ? [{ key: "htpr-6091-feature-flags", ...row }] : []),
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
  listedRows = null;
  readError = null;
  sessionUserId = 6;
  taskRows = [];
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

test("every declared flag without a stored row is on for the owner and QA, nobody else", async () => {
  // HTPR-6192: this is the point of the ticket. A flag whose rollout was never chosen must not be
  // owner-only, or the QA account cannot verify the feature before Valentin looks at it.
  assert.ok(flags.FEATURE_FLAG_KEYS.length > 0);
  for (const key of flags.FEATURE_FLAG_KEYS) {
    assert.deepEqual(
      await Promise.all([6, 985, 7].map((userId) => flags.isFeatureEnabled(key, userId))),
      [true, true, false],
      `${key} should default to owner and QA`,
    );
  }
});

test("per-user flag responses distinguish QA from normal members", async () => {
  const qaFlags = await flags.featureFlagsForUser(985);
  const normalFlags = await flags.featureFlagsForUser(7);
  assert.equal(qaFlags["htpr-6118-comment-reactions-api"], true);
  assert.equal(normalFlags["htpr-6118-comment-reactions-api"], false);
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

test("declared flags remain listed with ticket details and can be changed", async () => {
  const listed = await flags.listFeatureFlagModes();
  assert.deepEqual(
    listed.map(({ key, mode, updatedAt }) => ({ key, mode, updatedAt })),
    [
      { key: "htpr-5898-page-mentions", mode: "OWNER_AND_QA", updatedAt: null },
      {
        key: "htpr-5913-consistent-comment-shortcuts",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      { key: "htpr-5992-mobile-all-tasks", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-5993-optimistic-task-uploads", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6006-chat-confirm-ticket", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6072-shallow-board-switch", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6091-feature-flags", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6094-agent-activity-rows", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6112-copy-current-url", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6115-agent-sdk", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6118-comment-reactions-api", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6122-agent-run-activities", mode: "OWNER_AND_QA", updatedAt: null },
      {
        key: "htpr-6123-add-typescript-agent-sdk",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      { key: "htpr-6124-agent-dev-loop", mode: "OWNER_AND_QA", updatedAt: null },
      {
        key: "htpr-6129-mobile-agent-chat-viewport",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      { key: "htpr-6130-mobile-reminder-safe-area", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6133-feature-flag-details", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6136-figma-connect", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6141-ai-first-task-writer", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6154-chat-stop-and-timeout", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6155-chat-agent-brief", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6160-inbox-archive-cluster", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6176-flag-ticket-title", mode: "OWNER_AND_QA", updatedAt: null },
      {
        key: "htpr-6177-auto-task-descriptions",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      { key: "htpr-6179-flag-sort-filter", mode: "OWNER_AND_QA", updatedAt: null },
      {
        key: "htpr-6191-flag-ship-date-clusters",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
    ],
  );
  listed.forEach(({ key, description, ticketUrl, shippedOn }) => {
    assert.ok(description.length > 20, `${key} needs a useful description`);
    // The flags admin page clusters on this day, so a typo would silently create a
    // one-flag heading instead of failing.
    assert.match(shippedOn, /^\d{4}-\d{2}-\d{2}$/, `${key} needs a shippedOn day`);
    assert.equal(
      ticketUrl,
      `https://app.hypertask.ai/detail/project-15/${key.match(/^htpr-(\d+)-/)[1]}`,
    );
  });

  const changed = await flags.setFeatureFlagMode("htpr-6091-feature-flags", "EVERYONE");
  assert.equal(changed.mode, "EVERYONE");
  assert.match(changed.description, /feature flag controls/);
  assert.equal(changed.ticketUrl, "https://app.hypertask.ai/detail/project-15/6091");
  assert.equal(await flags.isFeatureEnabled("htpr-6091-feature-flags", 7), true);
});

test("legacy database flags stay visible, safe, and updateable", async () => {
  const updatedAt = new Date("2026-09-04T12:00:00.000Z");
  listedRows = [
    { key: "htpr-1111-aaa", mode: "OFF", updatedAt },
    { key: "legacy-rollout", mode: "OWNER_ONLY", updatedAt },
  ];

  const listed = await flags.listFeatureFlagModes();
  const ticketNamed = listed.find(({ key }) => key === "htpr-1111-aaa");
  assert.equal(ticketNamed.description, "This older feature flag has no description in this version of the app.");
  assert.equal(ticketNamed.ticketUrl, "https://app.hypertask.ai/detail/project-15/1111");
  const malformed = listed.find(({ key }) => key === "legacy-rollout");
  assert.equal(malformed.ticketUrl, null);

  row = { mode: "OFF", updatedAt };
  const changed = await flags.setFeatureFlagMode("htpr-1111-aaa", "OWNER_ONLY");
  assert.equal(changed.mode, "OWNER_ONLY");
  assert.equal(changed.ticketUrl, "https://app.hypertask.ai/detail/project-15/1111");
});

test("ticket titles are only fetched when requested, and cover undeclared stored keys too", async () => {
  listedRows = [{ key: "htpr-1111-aaa", mode: "OFF", updatedAt: null }];
  taskRows = [
    { uniqueIndex: 6091, title: "Add owner-controlled feature flags" },
    { uniqueIndex: 1111, title: "Some legacy ticket" },
  ];

  const withoutTitles = await flags.listFeatureFlagModes();
  withoutTitles.forEach(({ ticketTitle }) => assert.equal(ticketTitle, null));

  const withTitles = await flags.listFeatureFlagModes({ includeTicketTitles: true });
  const declared = withTitles.find(({ key }) => key === "htpr-6091-feature-flags");
  assert.equal(declared.ticketTitle, "Add owner-controlled feature flags");
  const undeclaredStored = withTitles.find(({ key }) => key === "htpr-1111-aaa");
  assert.equal(undeclaredStored.ticketTitle, "Some legacy ticket");
});

test("unknown flags fail closed and cannot create rows", async () => {
  assert.equal(await flags.isFeatureEnabled("unknown-flag", 6), false);
  await assert.rejects(flags.setFeatureFlagMode("unknown-flag", "OFF"), /Unknown feature flag/);
  await assert.rejects(flags.setFeatureFlagMode("Bad Flag", "OFF"), /Invalid feature flag/);
});
