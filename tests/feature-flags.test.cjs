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
      listedRows ?? (row ? [{ key: "htpr-6136-figma-connect", ...row }] : []),
    upsert: async ({ where, create, update }) => {
      const data = row ? update : create;
      row = { ...(row ?? {}), ...data, key: where.key, updatedAt: new Date() };
      return { ...row };
    },
  },
};

// setFeatureFlagMode decides the release date under an advisory lock, so the stub has to run the
// callback the same way Prisma would: against itself, in order.
prisma.$transaction = async (callback) => callback(prisma);
prisma.$executeRaw = async () => 0;

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
  assert.equal(await flags.isFeatureEnabled("htpr-6136-figma-connect", 985), true);
  usersById.set(985, { email: "someone@example.com" });
  assert.equal(await flags.isFeatureEnabled("htpr-6136-figma-connect", 985), false);
  usersById.set(7, { email: "valentin@hypertask.ai" });
  assert.equal(await flags.isFeatureEnabled("htpr-6136-figma-connect", 7), false);
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

test("server first-screen flag is registered but unused and scoped flag seeds reuse server evaluation", async () => {
  const key = flags.HTPR_6934_SERVER_FIRST_SCREEN_FLAG;
  assert.equal(key, "htpr-6934-server-first-screen");
  assert.equal((await flags.listFeatureFlagModes()).find(row => row.key === key).mode, "OWNER_AND_QA");
  const { getFirstScreenFlagSeed } = jiti(path.join(root, "src/lib/firstScreen/serverFlags.ts"));
  const clock = "2026-10-04T00:30:00.000Z";
  assert.deepEqual(await getFirstScreenFlagSeed(985, [key, "missing"], clock), {
    accountId: 985, evaluatedAt: clock, values: { [key]: true, missing: false },
  });
  assert.deepEqual(await getFirstScreenFlagSeed(7, [key], clock), {
    accountId: 7, evaluatedAt: clock, values: { [key]: false },
  });
  await assert.rejects(getFirstScreenFlagSeed(0, [key], clock), /scope/);
  await assert.rejects(getFirstScreenFlagSeed(985, [key], "bad"), /scope/);
});

test("stable layout has its own dated Owner + QA flag and respects OFF", async () => {
  assert.equal(flags.HTPR_6899_STABLE_LAYOUT_FLAG, "htpr-6899-stable-layout");
  const listed = await flags.listFeatureFlagModes();
  const stable = listed.find(({ key }) => key === flags.HTPR_6899_STABLE_LAYOUT_FLAG);
  assert.ok(stable);
  assert.equal(stable.mode, "OWNER_AND_QA");
  assert.equal(stable.shippedOn, "2026-10-03");
  assert.equal(stable.ticketUrl, "https://app.hypertask.ai/detail/project-15/6899");
  assert.match(stable.description, /cached tickets/);
  assert.deepEqual(await Promise.all([6, 985, 7].map(userId => flags.isFeatureEnabled(stable.key, userId))), [true, true, false]);
  row = { mode: "OFF", updatedAt: new Date() };
  assert.deepEqual(await Promise.all([6, 985, 7].map(userId => flags.isFeatureEnabled(stable.key, userId))), [false, false, false]);
});

test("app router writes key is shared and defaults to Owner + QA without a kind override", async () => {
  const { HTPR_6923_APP_ROUTER_WRITES_FLAG: key } = jiti(path.join(root, "src/lib/flags/keys.ts"));
  assert.equal(key, "htpr-6923-app-router-writes");
  assert.equal(flags.HTPR_6923_APP_ROUTER_WRITES_FLAG, key);
  const entry = (await flags.listFeatureFlagModes()).find((flag) => flag.key === key);
  assert.equal(entry.mode, "OWNER_AND_QA");
  assert.deepEqual(await Promise.all([6, 985, 7].map((userId) => flags.isFeatureEnabled(key, userId))), [true, true, false]);
  row = { mode: "OFF", updatedAt: new Date() };
  assert.deepEqual(await Promise.all([6, 985, 7].map((userId) => flags.isFeatureEnabled(key, userId))), [false, false, false]);
});

test("typed settings API client defaults to Owner + QA and respects OFF", async () => {
  const key = flags.HTPR_6925_TYPED_API_CLIENT_FLAG;
  assert.equal(key, "htpr-6925-typed-api-client");
  const entry = (await flags.listFeatureFlagModes()).find((flag) => flag.key === key);
  assert.equal(entry.mode, "OWNER_AND_QA");
  assert.equal(entry.shippedOn, "2026-10-06");
  assert.equal(entry.ticketUrl, "https://app.hypertask.ai/detail/project-15/6925");
  assert.deepEqual(await Promise.all([6, 985, 7].map((userId) => flags.isFeatureEnabled(key, userId))), [true, true, false]);
  row = { mode: "OFF", updatedAt: new Date() };
  assert.deepEqual(await Promise.all([6, 985, 7].map((userId) => flags.isFeatureEnabled(key, userId))), [false, false, false]);
});

test("search Ask AI fullscreen has its own Owner + QA flag and respects OFF", async () => {
  const key = flags.HTPR_6936_ASK_AI_FULLSCREEN_FLAG;
  assert.equal(key, "htpr-6936-ask-ai-fullscreen");
  const entry = (await flags.listFeatureFlagModes()).find((flag) => flag.key === key);
  assert.ok(entry);
  assert.equal(entry.mode, "OWNER_AND_QA");
  assert.equal(entry.ticketUrl, "https://app.hypertask.ai/detail/project-15/6936");
  assert.deepEqual(await Promise.all([6, 985, 7].map((userId) => flags.isFeatureEnabled(key, userId))), [true, true, false]);
  row = { mode: "OFF", updatedAt: new Date() };
  assert.deepEqual(await Promise.all([6, 985, 7].map((userId) => flags.isFeatureEnabled(key, userId))), [false, false, false]);
});

test("per-user flag responses distinguish QA from normal members", async () => {
  const qaFlags = await flags.featureFlagsForUser(985);
  const normalFlags = await flags.featureFlagsForUser(7);
  assert.equal(qaFlags["htpr-6136-figma-connect"], true);
  assert.equal(normalFlags["htpr-6136-figma-connect"], false);
});

test("stored owner-only flags stay unavailable to QA until changed", async () => {
  row = { mode: "OWNER_ONLY", updatedAt: new Date() };
  assert.equal(await flags.isFeatureEnabled("htpr-6136-figma-connect", 6), true);
  assert.equal(await flags.isFeatureEnabled("htpr-6136-figma-connect", 985), false);
  await flags.setFeatureFlagMode("htpr-6136-figma-connect", "OWNER_AND_QA");
  assert.equal(await flags.isFeatureEnabled("htpr-6136-figma-connect", 985), true);
});

test("database failures fail closed instead of becoming the default", async () => {
  readError = new Error("database unavailable");
  await assert.rejects(flags.isFeatureEnabled("htpr-6136-figma-connect", 6), /database unavailable/);
});

test("declared flags remain listed with ticket details and can be changed", async () => {
  const listed = await flags.listFeatureFlagModes();
  assert.deepEqual(
    listed.map(({ key, mode, updatedAt }) => ({ key, mode, updatedAt })),
    [
      { key: "htpr-3533-google-calendar", mode: "OWNER_AND_QA", updatedAt: null },
      {
        key: "htpr-4228-admin-only-time-reports",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      { key: "htpr-4857-add-to-slack", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-5898-page-mentions", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-5906-shortcut-nudges", mode: "OWNER_AND_QA", updatedAt: null },
      {
        key: "htpr-5908-local-writing-assistance",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-5913-consistent-comment-shortcuts",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-5937-show-column-in-all-views",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      { key: "htpr-5993-optimistic-task-uploads", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6002-shared-agent-chat", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6006-chat-confirm-ticket", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6059-lazy-emoji-list", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6094-agent-activity-rows", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6112-copy-current-url", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6115-agent-sdk", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6122-agent-run-activities", mode: "OWNER_AND_QA", updatedAt: null },
      {
        key: "htpr-6129-mobile-agent-chat-viewport",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      { key: "htpr-6130-mobile-reminder-safe-area", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6136-figma-connect", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6141-ai-first-task-writer", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6154-chat-stop-and-timeout", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6155-chat-agent-brief", mode: "OWNER_AND_QA", updatedAt: null },
      {
        key: "htpr-6166-scoped-board-refetch",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      { key: "htpr-6175-quick-entry-cards", mode: "OWNER_AND_QA", updatedAt: null },
      {
        key: "htpr-6177-auto-task-descriptions",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6197-confirmed-proposal-heading",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6215-my-tasks-cross-board-priority-sort",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6238-posthog-error-alert",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6243-manager-loop-activity",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6278-chat-turn-failure-state",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6283-agent-chat-live-sort",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6284-agent-mention-routing",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6287-agent-chat-roster-status",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6312-my-tasks-priority-filter",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6354-ai-chat-alerts",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6363-task-writer-research",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6369-search-operators",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6370-search-chips",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6372-search-ranking",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6407-mobile-agent-chat-layout",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6421-my-tasks-shortcuts-width",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6422-my-tasks-views",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6427-row-shortcuts",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6444-my-tasks-bulk-selection",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6447-my-tasks-filter-parity",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6455-my-tasks-time-group",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6456-my-tasks-table-columns",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6457-my-tasks-scopes",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6458-my-tasks-live-updates",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6459-my-tasks-overdue-badges",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6460-my-tasks-quick-add",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6461-my-tasks-snooze",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6470-project-delete",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6476-mobile-agent-chat-fullscreen",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6512-seed-team-agent",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6516-agent-attribution",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6533-mcp-client-eval",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6536-qa-login",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6542-team-scoped-management-keys",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6551-quiet-run-activity",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6553-agent-chat-polling",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6554-light-comment-separation",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6555-idle-comment-mic",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6556-mobile-description-first",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6557-agent-rooms",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6559-keep-direct-task-open-after-comment",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6561-preserve-ai-edited-description-structure",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      { key: "htpr-6567-command-scope-picker", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6662-agent-log-name", mode: "OWNER_AND_QA", updatedAt: null },
      {
        key: "htpr-6688-search-autocomplete",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      {
        key: "htpr-6722-latest-models",
        mode: "OWNER_AND_QA",
        updatedAt: null,
      },
      { key: "htpr-6752-instant-ticket-open", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6804-mcp-tools", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6817-slack-app", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6860-mobile-page-hide-dock", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6861-mobile-page-back-row", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6865-search-layout", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6868-ticket-prefix", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6872-page-image-gallery", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6873-quick-entry-grow", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6878-search-label-scope", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6879-search-esc-back", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6880-search-commenter", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6881-search-fuzzy-person", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6882-search-match-highlights", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6885-single-undo-toast", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6892-cmdk-version", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6899-stable-layout", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6902-n-quick-add", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6909-search-one-board-tabs", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6911-search-row-highlight", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6914-shift-c-quick-add", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6921-slack-marketplace", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6923-app-router-writes", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6924-rest-compat", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6925-typed-api-client", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6927-mcp-v2", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6929-compose-task-writer", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6930-my-tasks-kanban-reuse", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6934-server-first-screen", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6936-ask-ai-fullscreen", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6937-new-task-window", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6938-my-tasks-icon-controls", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6950-tooltip-top-layer", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6951-task-writing-progress", mode: "OWNER_AND_QA", updatedAt: null },
      { key: "htpr-6964-flags-page-type-search", mode: "OWNER_AND_QA", updatedAt: null },
    ],
  );
  listed.forEach(({ key, description, ticketUrl, shippedOn }) => {
    assert.ok(description.length > 20, `${key} needs a useful description`);
    // The flags admin page clusters on this day, so a typo would silently create a
    // one-flag heading instead of failing.
    assert.match(shippedOn, /^\d{4}-\d{2}-\d{2}$/, `${key} needs a shippedOn day`);
    const ticketNumber = key.match(/^htpr-(\d+)-/)?.[1];
    assert.equal(
      ticketUrl,
      ticketNumber ? `https://app.hypertask.ai/detail/project-15/${ticketNumber}` : null,
    );
  });

  const changed = await flags.setFeatureFlagMode("htpr-6136-figma-connect", "EVERYONE");
  assert.equal(changed.mode, "EVERYONE");
  assert.match(changed.description, /Figma/);
  assert.equal(changed.ticketUrl, "https://app.hypertask.ai/detail/project-15/6136");
  assert.equal(await flags.isFeatureEnabled("htpr-6136-figma-connect", 7), true);
});

test("switching to Everyone starts a fresh removal countdown", async () => {
  const before = Date.now();
  const released = await flags.setFeatureFlagMode("htpr-6136-figma-connect", "EVERYONE");
  // The countdown has to start from the switch, not from whenever the row was last written.
  assert.ok(released.releasedAt.getTime() >= before);

  // Re-pressing Everyone must not extend the deadline of a flag already released.
  row.releasedAt = new Date("2026-01-01T00:00:00.000Z");
  row.removalTaskId = 4242;
  const again = await flags.setFeatureFlagMode("htpr-6136-figma-connect", "EVERYONE");
  assert.equal(again.releasedAt.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(again.removalTaskId, 4242);

  // Leaving Everyone and coming back is a new release, so it earns its own countdown and ticket.
  await flags.setFeatureFlagMode("htpr-6136-figma-connect", "OWNER_ONLY");
  const rereleased = await flags.setFeatureFlagMode("htpr-6136-figma-connect", "EVERYONE");
  assert.ok(rereleased.releasedAt.getTime() >= before);
  assert.equal(rereleased.removalTaskId, null);
});

test("Keep pauses removal without moving the release date", async () => {
  const released = await flags.setFeatureFlagMode("htpr-6136-figma-connect", "EVERYONE");
  const kept = await flags.setFeatureFlagKeep("htpr-6136-figma-connect", true);
  assert.equal(kept.keep, true);
  assert.equal(kept.mode, "EVERYONE");
  assert.equal(kept.releasedAt.toISOString(), released.releasedAt.toISOString());

  const resumed = await flags.setFeatureFlagKeep("htpr-6136-figma-connect", false);
  assert.equal(resumed.keep, false);
  assert.equal(resumed.releasedAt.toISOString(), released.releasedAt.toISOString());

  await assert.rejects(flags.setFeatureFlagKeep("not a valid key!", true), /Invalid feature flag/);
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

test("the retired factory flag remains off for old deployments but disappears from this app", async () => {
  listedRows = [
    {
      key: "hyfa-43-factory-owner-preview",
      mode: "OFF",
      updatedAt: new Date("2026-09-11T09:10:03.975Z"),
    },
  ];
  row = { mode: "EVERYONE", updatedAt: new Date() };

  assert.equal(await flags.isFeatureEnabled("hyfa-43-factory-owner-preview", 6), false);
  assert.equal(
    (await flags.listFeatureFlagModes()).some(
      ({ key }) => key === "hyfa-43-factory-owner-preview",
    ),
    false,
  );
  await assert.rejects(
    flags.setFeatureFlagMode("hyfa-43-factory-owner-preview", "EVERYONE"),
    /Unknown feature flag/,
  );
});

test("the retired infra board-check flag is hidden and not editable", async () => {
  const key = "yper4-123-board-check";
  listedRows = [{ key, mode: "OWNER_AND_QA", updatedAt: new Date() }];
  row = { mode: "OWNER_AND_QA", updatedAt: new Date() };

  assert.equal(flags.FEATURE_FLAG_KEYS.includes(key), false);
  assert.equal((await flags.listFeatureFlagModes()).some((flag) => flag.key === key), false);
  await assert.rejects(flags.setFeatureFlagMode(key, "OFF"), /Unknown feature flag/);
});

test("the retired core-actions smoke flag is hidden and not editable", async () => {
  const key = "htpr-6236-core-actions-smoke";
  listedRows = [{ key, mode: "EVERYONE", updatedAt: new Date() }];
  row = { mode: "EVERYONE", updatedAt: new Date() };

  assert.equal(flags.FEATURE_FLAG_KEYS.includes(key), false);
  assert.equal((await flags.listFeatureFlagModes()).some((flag) => flag.key === key), false);
  await assert.rejects(flags.setFeatureFlagMode(key, "OFF"), /Unknown feature flag/);
});

test("the retired infra flag-pages key is hidden and cannot be re-enabled", async () => {
  const key = "yper4-160-flag-pages";
  listedRows = [{ key, mode: "EVERYONE", updatedAt: new Date() }];
  row = { mode: "EVERYONE", updatedAt: new Date() };

  assert.equal(flags.FEATURE_FLAG_KEYS.includes(key), false);
  assert.equal((await flags.listFeatureFlagModes()).some((flag) => flag.key === key), false);
  for (const userId of [6, 985, 42]) {
    assert.equal(await flags.isFeatureEnabled(key, userId), false);
    assert.equal((await flags.featureFlagsForUser(userId))[key], undefined);
  }
  await assert.rejects(flags.setFeatureFlagMode(key, "EVERYONE"), /Unknown feature flag/);
  await assert.rejects(flags.setFeatureFlagKeep(key, true), /Unknown feature flag/);
});

for (const key of ["htpr-6072-shallow-board-switch", "htpr-6254-heic-heif-attachments", "htpr-6035-agent-chat-skills"]) test(`the retired ${key} stays on in client payloads but is not editable`, async () => {
  listedRows = [{ key, mode: "OFF", updatedAt: new Date() }];
  row = { mode: "OFF", updatedAt: new Date() };

  assert.equal(flags.FEATURE_FLAG_KEYS.includes(key), false);
  assert.equal((await flags.listFeatureFlagModes()).some((flag) => flag.key === key), false);
  for (const userId of [6, 985, 42]) {
    assert.equal((await flags.featureFlagsForUser(userId))[key], true);
  }
  await assert.rejects(flags.setFeatureFlagMode(key, "OFF"), /Unknown feature flag/);
  listedRows = [];
  assert.equal((await flags.featureFlagsForUser(42))[key], true);
});

test("ticket titles are only fetched when requested, and cover undeclared stored keys too", async () => {
  listedRows = [{ key: "htpr-1111-aaa", mode: "OFF", updatedAt: null }];
  taskRows = [
    { uniqueIndex: 6136, title: "Connect Figma" },
    { uniqueIndex: 1111, title: "Some legacy ticket" },
  ];

  const withoutTitles = await flags.listFeatureFlagModes();
  withoutTitles.forEach(({ ticketTitle }) => assert.equal(ticketTitle, null));

  const withTitles = await flags.listFeatureFlagModes({ includeTicketTitles: true });
  const declared = withTitles.find(({ key }) => key === "htpr-6136-figma-connect");
  assert.equal(declared.ticketTitle, "Connect Figma");
  const undeclaredStored = withTitles.find(({ key }) => key === "htpr-1111-aaa");
  assert.equal(undeclaredStored.ticketTitle, "Some legacy ticket");
});

test("unknown flags fail closed and cannot create rows", async () => {
  assert.equal(await flags.isFeatureEnabled("unknown-flag", 6), false);
  await assert.rejects(flags.setFeatureFlagMode("unknown-flag", "OFF"), /Unknown feature flag/);
  await assert.rejects(flags.setFeatureFlagMode("Bad Flag", "OFF"), /Invalid feature flag/);
});

const retiredInfraKeys = [
  "htpr-6091-feature-flags",
  "htpr-6133-feature-flag-details",
  "htpr-6176-flag-ticket-title",
  "htpr-6179-flag-sort-filter",
  "htpr-6191-flag-ship-date-clusters",
  "htpr-6193-flag-removal-countdown",
  "htpr-6800-flag-ticket-id",
  "htpr-6653-admin-team-comp",
  "htpr-6118-comment-reactions-api",
  "htpr-6123-add-typescript-agent-sdk",
  "htpr-6124-agent-dev-loop",
  "htpr-6348-agent-access-delegation",
  "htpr-6473-get-agent",
  "htpr-6530-mcp-list-query",
  "htpr-6531-deferred-mcp-tools",
  "htpr-6532-stateless-mcp",
  "htpr-6268-agent-visibility",
  "htpr-6320-ai-observability",
  "htpr-6673-capture-user-signed-up-in-posthog"
];

test("the 19 retired infra flags are hidden, immutable and enabled for old tabs", async () => {
  listedRows = retiredInfraKeys.map((key) => ({ key, mode: "OFF", updatedAt: new Date() }));
  listedRows.push({ key: "htpr-6536-qa-login", mode: "OWNER_AND_QA", updatedAt: null });
  const listed = await flags.listFeatureFlagModes();
  const listedKeys = new Set(listed.map(({ key }) => key));
  assert.ok(listedKeys.has("htpr-6536-qa-login"), "positive control remains listed");
  for (const key of retiredInfraKeys) {
    assert.equal(flags.FEATURE_FLAG_KEYS.includes(key), false, key);
    assert.equal(listedKeys.has(key), false, key);
    await assert.rejects(flags.setFeatureFlagMode(key, "OFF"), /Unknown feature flag/);
    await assert.rejects(flags.setFeatureFlagKeep(key, true), /Unknown feature flag/);
  }
  for (const userId of [6, 985, 42]) {
    const clientFlags = await flags.featureFlagsForUser(userId);
    for (const key of retiredInfraKeys) assert.equal(clientFlags[key], true, key);
  }
});

test("the removed inbox archive flag is hidden, disabled and cannot be restored", async () => {
  const key = "htpr-6160-inbox-archive-cluster";
  listedRows = [{ key, mode: "EVERYONE", updatedAt: new Date() }];
  row = { mode: "EVERYONE", updatedAt: new Date() };

  assert.equal(flags.RETIRED_FEATURE_FLAG_KEYS.has(key), true);
  assert.equal(flags.FEATURE_FLAG_KEYS.includes(key), false);
  assert.equal((await flags.listFeatureFlagModes()).some((flag) => flag.key === key), false);
  for (const userId of [6, 985, 42]) {
    assert.equal(await flags.isFeatureEnabled(key, userId), false);
    assert.equal((await flags.featureFlagsForUser(userId))[key], undefined);
  }
  await assert.rejects(flags.setFeatureFlagMode(key, "EVERYONE"), /Unknown feature flag/);
  await assert.rejects(flags.setFeatureFlagKeep(key, true), /Unknown feature flag/);
});

test("the removed new-task draft flag is hidden, disabled and cannot be restored", async () => {
  const key = "htpr-6157-new-task-auto-description";
  listedRows = [{ key, mode: "EVERYONE", updatedAt: new Date() }];
  row = { mode: "EVERYONE", updatedAt: new Date() };

  assert.equal(flags.FEATURE_FLAG_KEYS.includes(key), false);
  assert.equal((await flags.listFeatureFlagModes()).some((flag) => flag.key === key), false);
  for (const userId of [6, 985, 42]) {
    assert.equal(await flags.isFeatureEnabled(key, userId), false);
    assert.equal((await flags.featureFlagsForUser(userId))[key], undefined);
  }
  await assert.rejects(flags.setFeatureFlagMode(key, "EVERYONE"), /Unknown feature flag/);
  await assert.rejects(flags.setFeatureFlagKeep(key, true), /Unknown feature flag/);
});

test("bugfix defaults enable everyone, respect stored Off and list the same runtime mode", async (t) => {
  const fs = require("node:fs");
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bugfix-flags-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixture = path.join(dir, "flags.ts");
  // Classify one real definition only in this module fixture, not in the production registry.
  fs.writeFileSync(fixture, fs.readFileSync(path.join(root, "src/lib/flags.ts"), "utf8")
    .replace("key: HTPR_6950_TOOLTIP_TOP_LAYER_FLAG,", 'key: HTPR_6950_TOOLTIP_TOP_LAYER_FLAG, kind: "bugfix",'));
  const bugfixFlags = jiti(fixture);
  const key = "htpr-6950-tooltip-top-layer";
  assert.equal(await bugfixFlags.isFeatureEnabled(key, 2343), true);
  assert.equal(await bugfixFlags.featureFlagCandidateUserIds(key), null);
  assert.equal((await bugfixFlags.listFeatureFlagModes()).find(entry => entry.key === key).mode, "EVERYONE");
  assert.equal(await bugfixFlags.isFeatureEnabled("htpr-6136-figma-connect", 2343), false);
  row = { key, mode: "OFF" };
  assert.equal(await bugfixFlags.isFeatureEnabled(key, 2343), false);
  assert.deepEqual(await bugfixFlags.featureFlagCandidateUserIds(key), []);
  row = null;
  const released = await bugfixFlags.setFeatureFlagMode(key, "EVERYONE");
  assert.equal(released.mode, "EVERYONE");
  assert.ok(released.releasedAt instanceof Date, "persisting the release starts the normal cleanup countdown");
});

test("historical Bug labels are display-only and preserve Owner + QA defaults and stored modes", async () => {
  const key = flags.HTPR_6951_TASK_WRITING_PROGRESS_FLAG;
  assert.equal((await flags.listFeatureFlagModes()).find(entry => entry.key === key).kind, "bugfix");
  assert.deepEqual(await flags.featureFlagCandidateUserIds(key), [6, 985]);
  for (const mode of [null, "OFF", "OWNER_ONLY", "OWNER_AND_QA", "EVERYONE"]) {
    row = mode ? { mode } : null;
    listedRows = row ? [{ key, ...row }] : [];
    const entry = (await flags.listFeatureFlagModes()).find(entry => entry.key === key);
    assert.equal(entry.kind, "bugfix");
    assert.equal(entry.mode, mode ?? "OWNER_AND_QA");
    assert.deepEqual(await Promise.all([6, 985, 7].map(id => flags.isFeatureEnabled(key, id))),
      [6, 985, 7].map(id => flags.featureFlagModeEnabled(mode ?? "OWNER_AND_QA", id === 6, id === 985)));
  }
});

test("listed related keys cannot mutate registered flag metadata", async () => {
  const key = flags.HTPR_6951_TASK_WRITING_PROGRESS_FLAG;
  const first = (await flags.listFeatureFlagModes()).find(entry => entry.key === key);
  const expected = [...first.related];
  first.related.length = 0;
  const second = (await flags.listFeatureFlagModes()).find(entry => entry.key === key);
  assert.deepEqual(second.related, expected);
  assert.notEqual(second.related, first.related);
});

test("every registered flag has a valid kind and only registered explicit related keys", async () => {
  const rows = await flags.listFeatureFlagModes();
  assert.equal(rows.length, flags.FEATURE_FLAG_KEYS.length);
  for (const entry of rows) {
    assert.ok(["bugfix", "feature", "improvement"].includes(entry.kind), entry.key);
    for (const key of entry.related ?? []) {
      assert.ok(flags.FEATURE_FLAG_KEYS.includes(key), `${entry.key} relates to ${key}`);
      assert.notEqual(entry.key, key);
    }
  }
  const entry = rows.find(({ key }) => key === flags.HTPR_6964_FLAGS_PAGE_TYPE_SEARCH_FLAG);
  assert.equal(entry.kind, "feature");
  assert.equal(entry.mode, "OWNER_AND_QA");
  assert.equal(entry.ticketId, "HTPR-6964");
  assert.deepEqual(await Promise.all([6, 985, 7].map(id => flags.isFeatureEnabled(entry.key, id))), [true, true, false]);
  row = { mode: "OFF", updatedAt: new Date() };
  assert.equal(await flags.isFeatureEnabled(entry.key, 6), false);
});
