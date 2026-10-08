const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const protectedKey = "htpr-6072-shallow-board-switch";
const registeredKey = "htpr-6136-figma-connect";
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
  if (where.releasedAt) return flag.releasedAt !== null && flag.releasedAt <= where.releasedAt.lte;
  return true;
}
const prisma = {
  featureFlag: {
    findUnique: async () => { throw new Error("retired countdown must not be read"); },
    updateMany: async ({ where, data }) => {
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
  createTaskCore: async (options) => {
    filed.push(options);
    return { task: { id: 99 } };
  },
});
const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { FEATURE_FLAG_KEYS } = jiti(path.join(root, "src/lib/flags.ts"));
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
  assert.deepEqual(await response.json(), { filed: 1, keys: [registeredKey], failed: [] });
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
  assert.deepEqual(await response.json(), { filed: 1, keys: [registeredKey], failed: [] });
  assert.deepEqual(candidates.map(({ key }) => key), [registeredKey]);
  assert.deepEqual(filed.map(({ title }) => title), [`Remove feature flag ${registeredKey}`]);
  assert.deepEqual([removed, pending], before);
  assert.deepEqual(writes, [registeredKey, registeredKey, registeredKey]);
  assert.equal(dueFlags.find(({ key }) => key === registeredKey).removalTaskId, 99);
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
  assert.deepEqual(await response.json(), { filed: 1, keys: [registeredKey], failed: [] });
  assert.deepEqual(filed.map(({ title }) => title), [`Remove feature flag ${registeredKey}`]);
  assert.deepEqual(removed, before);
  assert.deepEqual(writes, [registeredKey, registeredKey]);
});
