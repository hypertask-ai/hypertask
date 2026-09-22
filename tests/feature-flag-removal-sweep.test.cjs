const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const protectedKey = "htpr-6072-shallow-board-switch";
const dueFlags = [
  { key: protectedKey, releasedAt: new Date("2026-09-01") },
  { key: "htpr-1234-other", releasedAt: new Date("2026-09-01") },
];
let candidates = [];
let filed = [];
const prisma = {
  featureFlag: {
    findUnique: async () => ({ mode: "EVERYONE" }),
    updateMany: async () => ({ count: 1 }),
    findMany: async ({ where, take }) => {
      candidates = dueFlags.filter((flag) =>
        flag.key !== where.key?.not && flag.releasedAt <= where.releasedAt.lte,
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
stubModule("src/lib/flags.ts", {
  FEATURE_FLAG_ADMIN_URL: "https://app.hypertask.ai/admin/flags",
  FEATURE_FLAG_OWNER_USER_ID: 6,
  FEATURE_FLAG_TICKET_PROJECT_ID: 15,
  FLAG_REMOVAL_COUNTDOWN_FLAG: "htpr-6193-flag-removal-countdown",
});
stubModule("src/utils/controllers/tasks/createTaskCore.ts", {
  createTaskCore: async ({ title }) => {
    filed.push(title);
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
    assert.deepEqual(filed, ["Remove feature flag htpr-1234-other"]);
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});
