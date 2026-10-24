const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const protectedKey = "htpr-6072-shallow-board-switch";
const registeredKey = "htpr-3533-google-calendar";
const removedKey = "htpr-6561-preserve-ai-edited-description-structure";
let dueFlags = [];
let candidates = [];
let filed = [];
let writes = [];
let extraCandidate = null;
function matches(flag, where) {
  if (typeof where.key === "string" && flag.key !== where.key) return false;
  if (where.key?.equals && flag.key !== where.key.equals) return false;
  if (where.key?.in && !where.key.in.includes(flag.key)) return false;
  if (where.key?.notIn?.includes(flag.key)) return false;
  for (const field of ["mode", "keep", "removalTaskId"]) {
    if (field in where && flag[field] !== where[field]) return false;
  }
  if (where.releasedAt instanceof Date) return flag.releasedAt.getTime() === where.releasedAt.getTime();
  if (where.releasedAt) {
    if (flag.releasedAt == null) return false;
    if (where.releasedAt.lte && flag.releasedAt > where.releasedAt.lte) return false;
    return true;
  }
  return true;
}
const prisma = {
  featureFlag: {
    findUnique: async () => { throw new Error("retired countdown must not be read"); },
    updateMany: async ({ where, data }) => {
      assert.deepEqual(Object.keys(data).sort(), ["removalTaskId"]);
      const matched = dueFlags.filter((flag) => matches(flag, where));
      for (const flag of matched) {
        writes.push(flag.key);
        Object.assign(flag, data);
      }
      return { count: matched.length };
    },
    findMany: async ({ where, take }) => {
      candidates = dueFlags.filter((flag) => matches(flag, where)).slice(0, take);
      return extraCandidate ? [...candidates, extraCandidate] : candidates;
    },
  },
  project: { findFirst: async () => ({ uniqueIdentifier: "HTPR", section: [{ id: 1, section_title: "Bugs" }] }) },
  label: { findFirst: async () => null },
  task: { findFirst: async () => null },
  $transaction: async (callback) => callback(prisma),
  $queryRaw: async () => [{ acquired: true }],
};
function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stubModule("src/lib/prisma.ts", { __esModule: true, default: prisma });
stubModule("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => null });
stubModule("src/utils/controllers/tasks/createTaskCore.ts", {
  createProvisionedTaskCore: async (options) => {
    filed.push(options);
    return { task: { id: 99 } };
  },
});
const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { FEATURE_FLAG_KEYS, RETIRED_FEATURE_FLAG_KEYS } = jiti(path.join(root, "src/lib/flags.ts"));
const { FEATURE_FLAG_REMOVAL_DAYS, PENDING_REMOVAL_TASK_ID } = jiti(path.join(root, "src/lib/flags/removal.ts"));
const { GET } = jiti(path.join(root, "src/app/api/cron/feature-flag-removals/route.ts"));

let previousSecret;
test.beforeEach(() => {
  dueFlags = ["htpr-6193-flag-removal-countdown", "htpr-6653-admin-team-comp", protectedKey, registeredKey].map((key) => ({
    key,
    mode: "EVERYONE",
    keep: false,
    removalTaskId: null,
    releasedAt: new Date(Date.now() - (FEATURE_FLAG_REMOVAL_DAYS + 1) * 24 * 60 * 60 * 1000),
  }));
  candidates = [];
  filed = [];
  writes = [];
  extraCandidate = null;
  previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-cron-secret";
});
test.afterEach(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

test("the removal sweep skips the legacy shallow-switch flag without blocking other due flags", async () => {
  const response = await GET(new NextRequest("https://app.hypertask.ai/api/cron/feature-flag-removals", {
    headers: { authorization: "Bearer test-cron-secret" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { filed: 1, keys: [registeredKey], failed: [], deferred: 0 });
  assert.deepEqual(candidates.map(({ key }) => key), [registeredKey]);
  assert.deepEqual(filed.map(({ title }) => title), [`Remove feature flag ${registeredKey}`]);
  assert.equal(filed[0].userId, 6);
  assert.equal(filed[0].agentId, "85b985ac-afe8-41a3-a1ac-d9549a9310c7");
  assert.equal(filed[0].assignees, undefined);
  assert.equal(filed[0].assigneeId, undefined);
});

test("the removal sweep leaves overdue unregistered rows unchanged and tickets a registered flag", async () => {
  assert.ok(FEATURE_FLAG_KEYS.includes(registeredKey));
  assert.ok(!FEATURE_FLAG_KEYS.includes(removedKey));
  const removed = { ...dueFlags[3], key: removedKey };
  const pending = { ...removed, key: "htpr-1234-other", removalTaskId: PENDING_REMOVAL_TASK_ID };
  dueFlags[3].removalTaskId = PENDING_REMOVAL_TASK_ID;
  dueFlags.unshift(removed, pending);
  const before = structuredClone([removed, pending]);
  const response = await GET(new NextRequest("https://app.hypertask.ai/api/cron/feature-flag-removals", {
    headers: { authorization: "Bearer test-cron-secret" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { filed: 1, keys: [registeredKey], failed: [], deferred: 0 });
  assert.deepEqual(candidates.map(({ key }) => key), [registeredKey]);
  assert.deepEqual(filed.map(({ title }) => title), [`Remove feature flag ${registeredKey}`]);
  assert.deepEqual([removed, pending], before);
  assert.deepEqual(writes, [registeredKey, registeredKey, registeredKey]);
  assert.equal(dueFlags.find(({ key }) => key === registeredKey).removalTaskId, 99);
});

test("bugfix flags are due after 7 days while money and data-deletion stay at 14, and Keep files nothing", async () => {
  const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  dueFlags = [
    { key: "htpr-3533-google-calendar", mode: "EVERYONE", keep: false, removalTaskId: null, releasedAt: daysAgo(8) },
    { key: "htpr-7324-plan-ai-caps", mode: "EVERYONE", keep: false, removalTaskId: null, releasedAt: daysAgo(8) },
    { key: "htpr-7350-card-title-wrap", mode: "EVERYONE", keep: true, removalTaskId: null, releasedAt: daysAgo(30) },
    { key: "htpr-7702-phone-chat-list", mode: "EVERYONE", keep: false, removalTaskId: null, releasedAt: daysAgo(8) },
    { key: "htpr-7755-bulk-preview-confirmation", mode: "EVERYONE", keep: false, removalTaskId: null, releasedAt: daysAgo(8) },
    { key: "yper4-651-self-follow-quiet", mode: "EVERYONE", keep: false, removalTaskId: null, releasedAt: daysAgo(8) },
  ];
  const response = await GET(new NextRequest("https://app.hypertask.ai/api/cron/feature-flag-removals", {
    headers: { authorization: "Bearer test-cron-secret" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    filed: 2,
    keys: ["htpr-7702-phone-chat-list", "yper4-651-self-follow-quiet"],
    failed: [],
    deferred: 0,
  });
  assert.deepEqual(filed.map(({ title }) => title), [
    "Remove feature flag htpr-7702-phone-chat-list",
    "Remove feature flag yper4-651-self-follow-quiet",
  ]);
  assert.ok(filed.every((ticket) => ticket.description.includes("more than 7 days")));
  assert.ok(filed.every((ticket) => ticket.mode === undefined));
});

test("money and data-deletion flags file after 14 days and a 6 day bugfix does not", async () => {
  const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  dueFlags = [
    { key: "htpr-3533-google-calendar", mode: "EVERYONE", keep: false, removalTaskId: null, releasedAt: daysAgo(15) },
    { key: "htpr-7324-plan-ai-caps", mode: "EVERYONE", keep: false, removalTaskId: null, releasedAt: daysAgo(15) },
    { key: "htpr-7702-phone-chat-list", mode: "EVERYONE", keep: false, removalTaskId: null, releasedAt: daysAgo(6) },
    { key: "htpr-7755-bulk-preview-confirmation", mode: "EVERYONE", keep: false, removalTaskId: null, releasedAt: daysAgo(15) },
  ];
  const response = await GET(new NextRequest("https://app.hypertask.ai/api/cron/feature-flag-removals", {
    headers: { authorization: "Bearer test-cron-secret" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).keys, [
    "htpr-3533-google-calendar",
    "htpr-7324-plan-ai-caps",
    "htpr-7755-bulk-preview-confirmation",
  ]);
  assert.ok(filed.every((ticket) => ticket.description.includes("more than 14 days")));
  assert.equal(filed.some((ticket) => ticket.title.includes("htpr-7702-phone-chat-list")), false);
});

test("a recorded removal ticket is not filed again", async () => {
  dueFlags = [{
    key: "htpr-7702-phone-chat-list",
    mode: "EVERYONE",
    keep: false,
    removalTaskId: 99,
    releasedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  }];
  const response = await GET(new NextRequest("https://app.hypertask.ai/api/cron/feature-flag-removals", {
    headers: { authorization: "Bearer test-cron-secret" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { filed: 0, failed: [], deferred: 0 });
  assert.deepEqual(filed, []);
});

test("an existing open removal ticket is reused and no second task is created", async () => {
  const original = prisma.task.findFirst;
  prisma.task.findFirst = async () => ({ id: 42 });
  try {
    dueFlags = [{
      key: registeredKey,
      mode: "EVERYONE",
      keep: false,
      removalTaskId: null,
      releasedAt: new Date(Date.now() - (FEATURE_FLAG_REMOVAL_DAYS + 1) * 24 * 60 * 60 * 1000),
    }];
    const response = await GET(new NextRequest("https://app.hypertask.ai/api/cron/feature-flag-removals", {
      headers: { authorization: "Bearer test-cron-secret" },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { filed: 1, keys: [registeredKey], failed: [], deferred: 0 });
    assert.deepEqual(filed, []);
    assert.equal(dueFlags[0].removalTaskId, 42);
  } finally {
    prisma.task.findFirst = original;
  }
});

test("the conditional claim rejects an unregistered key returned in the candidate list", async () => {
  const removed = { ...dueFlags[3], key: removedKey };
  dueFlags.unshift(removed);
  extraCandidate = removed;
  const before = structuredClone(removed);
  const response = await GET(new NextRequest("https://app.hypertask.ai/api/cron/feature-flag-removals", {
    headers: { authorization: "Bearer test-cron-secret" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { filed: 1, keys: [registeredKey], failed: [], deferred: 0 });
  assert.deepEqual(filed.map(({ title }) => title), [`Remove feature flag ${registeredKey}`]);
  assert.deepEqual(removed, before);
  assert.deepEqual(writes, [registeredKey, registeredKey]);
});

test("44 eligible flags file the 10 oldest and the rest stay eligible next run", async () => {
  const retired = new Set(RETIRED_FEATURE_FLAG_KEYS);
  const keys = FEATURE_FLAG_KEYS.filter((key) => !retired.has(key)).slice(0, 44);
  assert.equal(keys.length, 44);
  const start = Date.UTC(2026, 0, 1);
  dueFlags = keys.map((key, index) => ({
    key,
    mode: "EVERYONE",
    keep: false,
    removalTaskId: null,
    releasedAt: new Date(start + index * 60 * 60 * 1000),
  }));
  const call = () => GET(new NextRequest("https://app.hypertask.ai/api/cron/feature-flag-removals", {
    headers: { authorization: "Bearer test-cron-secret" },
  }));
  const first = await (await call()).json();
  const oldest = keys.slice(0, 10);
  assert.deepEqual(first, { filed: 10, keys: oldest, failed: [], deferred: 34 });
  const second = await (await call()).json();
  const next = keys.slice(10, 20);
  assert.deepEqual(second, { filed: 10, keys: next, failed: [], deferred: 24 });
  assert.equal(next.some((key) => oldest.includes(key)), false);
  assert.deepEqual(
    filed.map(({ title }) => title),
    [...oldest, ...next].map((key) => `Remove feature flag ${key}`),
  );
  assert.deepEqual(new Set(filed.map(({ title }) => title)).size, 20);
});
