const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const protectedKey = "htpr-6072-shallow-board-switch";
const dueFlags = [
  { key: "htpr-6193-flag-removal-countdown", releasedAt: new Date("2026-09-01") },
  { key: "htpr-6653-admin-team-comp", releasedAt: new Date("2026-09-01") },
  { key: protectedKey, releasedAt: new Date("2026-09-01") },
  { key: "htpr-1234-other", releasedAt: new Date("2026-09-01") },
];
let candidates = [];
let filed = [];
const prisma = {
  featureFlag: {
    findUnique: async () => { throw new Error("retired countdown must not be read"); },
    updateMany: async () => ({ count: 1 }),
    findMany: async ({ where, take }) => {
      candidates = dueFlags.filter((flag) =>
        !where.key.notIn.includes(flag.key) && flag.releasedAt <= where.releasedAt.lte,
      ).slice(0, take);
      return candidates;
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
const { GET } = jiti(path.join(root, "src/app/api/cron/feature-flag-removals/route.ts"));

test("the removal sweep skips the legacy shallow-switch flag without blocking other due flags", async () => {
  candidates = [];
  filed = [];
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-cron-secret";
  try {
    const response = await GET(new NextRequest("https://app.hypertask.ai/api/cron/feature-flag-removals", {
      headers: { authorization: "Bearer test-cron-secret" },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { filed: 1, keys: ["htpr-1234-other"], failed: [] });
    assert.deepEqual(candidates.map(({ key }) => key), ["htpr-1234-other"]);
    assert.deepEqual(filed.map(({ title }) => title), ["Remove feature flag htpr-1234-other"]);
    assert.equal(filed[0].userId, 6);
    assert.equal(filed[0].agentId, "85b985ac-afe8-41a3-a1ac-d9549a9310c7");
    assert.equal(filed[0].assignees, undefined);
    assert.equal(filed[0].assigneeId, undefined);
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});
