const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
const key = "htpr-3533-google-calendar";
let state;
const prisma = {
  featureFlag: {
    findUnique: async () => ({ mode: "OFF" }),
    findMany: async () => [state.flag],
    updateMany: async ({ where, data }) => {
      if ("removalTaskId" in where && where.removalTaskId !== state.flag.removalTaskId) return { count: 0 };
      Object.assign(state.flag, data);
      return { count: 1 };
    },
  },
  project: { findFirst: async () => ({ uniqueIdentifier: "HTPR", section: [{ id: 1, section_title: "Bugs" }] }) },
  label: { findFirst: async () => null },
  task: {
    findFirst: async () => null,
    findUnique: async ({ where }) => state.task?.id === where.id ? state.task : null,
    create: async ({ data }) => {
      state.task = { id: 99, ...data, project: { teamId: null, firstTaskPointerTaskId: null }, priority: null };
      return state.task;
    },
  },
  agent: {
    findFirst: async ({ where }) => where.id === FEATURE_FLAG_SWEEP_AGENT_ID &&
      where.userId === FEATURE_FLAG_OWNER_USER_ID && where.revokedAt === null ? { id: where.id } : null,
  },
  description: {
    findUnique: async () => state.description,
    upsert: async ({ create }) => {
      assert.ok(state.lease, "description must be written while holding the adopted lease");
      assert.equal(state.lease.taskId, create.taskId);
      assert.equal(state.lease.agentId, FEATURE_FLAG_SWEEP_AGENT_ID);
      assert.equal(state.lease.holder, FEATURE_FLAG_OWNER_USER_ID);
      state.description = create;
      return create;
    },
  },
  drafts: { create: async () => ({}) },
  $transaction: async (callback) => callback(prisma),
  $queryRaw: async (strings, ...values) => {
    const sql = Array.from(strings).join("");
    if (sql.includes("pg_try_advisory_xact_lock")) return [{ acquired: true }];
    if (sql.includes('INSERT INTO "TaskLease"')) {
      if (state.lease && state.lease.expiresAt > new Date()) return [];
      const [taskId, holder, agentId, token, referenceToken, ttlSeconds] = values;
      state.lease = {
        taskId, holder, agentId, token, adoptionRefs: [referenceToken], adoptionCount: 1,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      };
      state.adoptions += 1;
      return [{ taskId }];
    }
    if (sql.includes('FROM "TaskLease"')) {
      return state.lease?.taskId === values[0] && state.lease.expiresAt > new Date() ? [state.lease] : [];
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
  $executeRaw: async (strings, ...values) => {
    const sql = Array.from(strings).join("");
    if (sql.includes("pg_advisory_xact_lock")) return 1;
    if (sql.includes('UPDATE "TaskLease"')) {
      const [referenceToken, taskId, holder, agentId, token] = values;
      const lease = state.lease;
      if (lease?.taskId !== taskId || lease.holder !== holder || lease.agentId !== agentId ||
        lease.token !== token || !lease.adoptionRefs.includes(referenceToken) || lease.adoptionCount <= 0) return 0;
      lease.adoptionRefs = lease.adoptionRefs.filter((reference) => reference !== referenceToken);
      lease.adoptionCount -= 1;
      if (lease.adoptionCount === 0) lease.expiresAt = new Date();
      return 1;
    }
    if (sql.includes('DELETE FROM "TaskLease"')) {
      const [taskId, holder, agentId, token] = values;
      const lease = state.lease;
      if (lease?.taskId !== taskId || lease.holder !== holder || lease.agentId !== agentId ||
        lease.token !== token || lease.adoptionCount !== 0) return 0;
      state.lease = null;
      state.releases += 1;
      return 1;
    }
    throw new Error(`Unexpected statement: ${sql}`);
  },
};

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
stubModule("src/lib/prisma.ts", { __esModule: true, default: prisma });
stubModule("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => null });
stubModule("src/utils/controllers/tasks/create.ts", { getUniqueTaskCount: async () => 10 });
stubModule("src/utils/generateRank.ts", { __esModule: true, default: () => "a" });
stubModule("src/lib/mcp/webhooks/taskEvents.ts", {
  createProvisionedTaskWithBoardWebhookOutbox: async (db, _actor, callback) => ({
    ...await callback(db), boardWebhookDeliveryIds: [],
  }),
});
stubModule("src/lib/mcp/webhooks/outbox.ts", { publishBoardWebhookDeliveries: async () => {} });
stubModule("src/lib/agentWebhooks/outbox.ts", {
  persistAgentTaskCreatedPending: async () => {},
  markAgentTaskCreatedReady: async () => {},
  emitAgentTaskCreatedWebhook: async () => {},
});
stubModule("src/utils/controllers/assignees/autoAssignForSection.ts", { autoAssignForSection: async () => "ready" });
const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { FEATURE_FLAG_OWNER_USER_ID, FEATURE_FLAG_SWEEP_AGENT_ID } = jiti(path.join(root, "src/lib/flags.ts"));
const { AgentMutationLeaseMissingError } = jiti(path.join(root, "src/lib/mcp/tasks/agentMutationFence.ts"));
const { default: upsertTaskDescription } = jiti(path.join(root, "src/utils/controllers/description/common-description-create.ts"));
const { GET } = jiti(path.join(root, "src/app/api/cron/feature-flag-removals/route.ts"));

let previousSecret;
test.beforeEach(() => {
  state = {
    flag: { key, mode: "EVERYONE", keep: false, removalTaskId: null, releasedAt: new Date("2026-01-01T00:00:00Z") },
    task: null, description: null, lease: null, adoptions: 0, releases: 0,
  };
  previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-cron-secret";
});
test.afterEach(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

test("the real sweep saves the removal description under an adopted lease and releases it", async (t) => {
  const errors = [];
  t.mock.method(console, "error", (...args) => errors.push(args));
  assert.equal(state.lease, null);
  const response = await GET(new NextRequest("https://app.hypertask.ai/api/cron/feature-flag-removals", {
    headers: { authorization: "Bearer test-cron-secret" },
  }));
  if (errors.length) {
    assert.ifError(errors[0][1]);
    assert.equal(state.task.description, "");
    assert.equal(state.description, null);
    assert.equal(state.lease, null);
    console.log("Missing lease left the created ticket description unwritten");
    throw errors[0][1];
  }
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { filed: 1, keys: [key], failed: [], deferred: 0 });
  assert.equal(state.task.agentId, FEATURE_FLAG_SWEEP_AGENT_ID);
  assert.equal(state.task.userId, FEATURE_FLAG_OWNER_USER_ID);
  assert.equal(state.description.taskId, state.task.id);
  assert.equal(state.description.creatorId, FEATURE_FLAG_OWNER_USER_ID);
  assert.equal(state.description.agentId, FEATURE_FLAG_SWEEP_AGENT_ID);
  assert.ok(state.description.content.includes(`<code>${key}</code>`));
  assert.ok(state.description.content.includes("Everyone"));
  assert.ok(state.description.content.includes("2026-01-01"));
  assert.equal(state.flag.removalTaskId, state.task.id);
  assert.equal(state.adoptions, 1);
  assert.equal(state.releases, 1);
  assert.equal(state.lease, null);
});

test("a direct sweep-agent description write without an adoption scope is still refused", async () => {
  state.task = { id: 99, status: "Normal", description: "" };
  await assert.rejects(upsertTaskDescription({
    taskId: state.task.id,
    creatorId: FEATURE_FLAG_OWNER_USER_ID,
    actingUserId: FEATURE_FLAG_OWNER_USER_ID,
    agentId: FEATURE_FLAG_SWEEP_AGENT_ID,
    content: "<p>Must not be saved.</p>",
  }), AgentMutationLeaseMissingError);
  assert.equal(state.description, null);
  assert.equal(state.adoptions, 0);
  assert.equal(state.lease, null);
});
