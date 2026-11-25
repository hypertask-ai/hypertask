const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");
const flagKey = "htpr-7848-summary-on-view";
const queuePath = "/api/queues/FAST/generateSummaryQueue";

function memoryRedis() {
  const values = new Map();
  const bump = (key) => {
    const next = (Number(values.get(key)) || 0) + 1;
    values.set(key, String(next));
    return next;
  };
  return {
    values,
    pipeline: () => ({
      keys: [],
      incr(key) { this.keys.push(key); return this; },
      exec() { return Promise.resolve(this.keys.map((key) => [null, bump(key)])); },
    }),
    incr: async (key) => bump(key),
    get: async (key) => values.get(key) ?? null,
    set: async (key, value, ...options) => {
      if (options.includes("NX") && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    del: async (key) => (values.delete(key) ? 1 : 0),
    eval: async (_script, _keys, key, expected) => {
      if (values.get(key) !== expected) return 0;
      values.delete(key);
      return 1;
    },
  };
}

function harness({ enabledFor = [], extraFlags = [], owners = {} } = {}) {
  const jobs = [];
  const redis = memoryRedis();
  const flags = {
    isFeatureEnabled: async (key, userId) =>
      key === flagKey ? enabledFor.includes(userId) : extraFlags.includes(key),
  };
  const prisma = {
    __esModule: true,
    default: {
      task: {
        findFirst: async ({ where }) =>
          owners[where.id] === undefined ? null : { userId: owners[where.id] },
        findMany: async ({ where }) => where.project.teamId === "team-fail"
          ? Promise.reject(new Error("db down"))
          : Object.entries(owners).map(([id, userId]) => ({ id: Number(id), userId })),
      },
    },
  };
  const stubs = {
    "@/lib/qstash": { scheduleJobById: async (job) => { jobs.push(job); return { messageId: "job" }; } },
    "@/lib/redis": { getRedis: async () => redis },
    "@/lib/flags": flags,
    "@/lib/prisma": prisma,
    "@/lib/flags/definitions/htpr-7848-summary-on-view": { HTPR_7848_SUMMARY_ON_VIEW_FLAG: flagKey },
  };
  const freshness = loadModule("src/app/api/ai/_lib/taskSummaryFreshness.ts", stubs);
  const scheduler = loadModule("src/pages/api/queues/FAST/generateSummary.ts", {
    ...stubs,
    "@/app/api/ai/_lib/taskSummaryFreshness": freshness,
  }).default;
  const seed = loadModule("src/app/api/ai/_lib/taskSummaryCheckoutSeed.ts", {
    "@/lib/prisma": prisma,
    "@/app/api/ai/_lib/taskSummaryFreshness": freshness,
  });
  return { freshness, scheduler, seed, jobs, redis };
}

test("a burst of changes marks one record and starts no AI run", async () => {
  const h = harness({ enabledFor: [6], owners: { 42: 6 } });
  for (let i = 0; i < 10; i += 1) await h.scheduler({ taskId: 42 });
  assert.equal(h.jobs.length, 0);
  assert.equal(h.redis.values.get("ai-summary:stale:42"), "10");
  const started = await h.freshness.readTaskSummaryStaleMarker(42);
  await h.scheduler({ taskId: 42 });
  await h.freshness.clearTaskSummaryStaleMarker(42, started);
  assert.equal(h.redis.values.get("ai-summary:stale:42"), "11");
});

test("the switch follows the ticket owner, not the caller, and agent changes count", async () => {
  const h = harness({
    enabledFor: [6],
    extraFlags: ["htpr-8904-agent-automatic-ai"],
    owners: { 45: 6, 46: 7, 47: 6 },
  });
  await h.scheduler({ taskId: 45, ownerUserId: 7 });
  await h.scheduler({ taskId: 46, ownerUserId: 6 });
  await h.scheduler({ taskId: 47, ownerUserId: 6, agentId: "agent-1" });
  assert.equal(h.redis.values.get("ai-summary:stale:45"), "1");
  assert.equal(h.redis.values.get("ai-summary:stale:47"), "1");
  assert.equal(h.redis.values.has("ai-summary:stale:46"), false);
  assert.equal(h.jobs.length, 1);
});

test("nothing changed means no run, and many opens make exactly one", async () => {
  const quiet = harness({ enabledFor: [6] });
  assert.equal(await quiet.freshness.requestTaskSummaryRefreshOnView({ taskId: 43, ownerUserId: 6 }), "fresh");
  assert.equal(quiet.jobs.length, 0);
  const h = harness({ enabledFor: [6], owners: { 42: 6 } });
  await h.scheduler({ taskId: 42 });
  const decisions = [];
  for (let i = 0; i < 3; i += 1) {
    decisions.push(await h.freshness.requestTaskSummaryRefreshOnView({ taskId: 42, ownerUserId: 6 }));
  }
  assert.deepEqual(decisions, ["scheduled", "coalesced", "coalesced"]);
  assert.equal(h.jobs.length, 1);
  assert.equal(h.jobs[0].path, queuePath);
  assert.equal(h.jobs[0].jobId, "ai-summary-view-for-taskId:42");
});

test("a cached ticket open refreshes on the way out", async () => {
  const h = harness({ enabledFor: [6], owners: { 42: 6 } });
  const pending = [];
  const { markTaskRead } = loadModule("src/utils/controllers/tasks/markRead.ts", {
    "@/lib/prisma": { default: { taskReadState: { upsert: async () => ({ lastReadAt: new Date() }) }, task: { findFirst: async ({ where }) => where.id === 42 ? { userId: 6 } : null } } },
    "@vercel/functions": { waitUntil: (work) => pending.push(work) },
    "@/app/api/ai/_lib/taskSummaryFreshness": h.freshness,
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}) },
  });
  await h.scheduler({ taskId: 42 });
  await markTaskRead(42, 6);
  await Promise.all(pending);
  assert.equal(h.jobs.length, 1, "leaving a cached open ticket schedules the refresh");
  await markTaskRead(99, 6);
  assert.equal(h.jobs.length, 1, "a ticket the viewer cannot reach schedules nothing");
});

test("an unreadable owner keeps the scheduled run and writes no mark", async () => {
  const h = harness({ enabledFor: [6] });
  await h.scheduler({ taskId: 49, ownerUserId: 6 });
  assert.deepEqual(h.jobs.map((job) => job.body), [{ taskId: 49 }]);
  assert.equal(h.redis.values.size, 0);
});

test("the switch off ignores existing marks and keeps the scheduled run", async () => {
  const h = harness({ enabledFor: [], owners: { 44: 7, 48: 6 } });
  await h.freshness.markTaskSummaryStale(48);
  assert.equal(await h.freshness.requestTaskSummaryRefreshOnView({ taskId: 48, ownerUserId: 6 }), "off");
  await h.scheduler({ taskId: 44, ownerUserId: 7 });
  assert.deepEqual(h.jobs.map((job) => job.body), [{ taskId: 44 }]);
  assert.equal(h.jobs[0].jobId, "ai-summary-for-taskId:44");
  assert.equal(h.redis.values.has("ai-summary:stale:44"), false);
});

test("a checkout marks in-scope tickets and asks for the backfill otherwise", async () => {
  const inScope = harness({ enabledFor: [6], owners: { 51: 6, 52: 6 } });
  assert.equal(await inScope.seed.seedTeamSummaryRefreshesOnCheckout("team-1"), true);
  assert.equal(inScope.redis.values.get("ai-summary:stale:51"), "1");
  assert.equal(inScope.redis.values.get("ai-summary:stale:52"), "1");

  const mixed = harness({ enabledFor: [6], owners: { 53: 6, 54: 7 } });
  assert.equal(await mixed.seed.seedTeamSummaryRefreshesOnCheckout("team-1"), false);
  assert.equal(mixed.redis.values.size, 0);

  const broken = harness({ enabledFor: [6] });
  assert.equal(await broken.seed.seedTeamSummaryRefreshesOnCheckout("team-fail"), false);
});

test("the switch stays owner-and-QA only, reversible and marked as money", () => {
  const definition = loadModule("src/lib/flags/definitions/htpr-7848-summary-on-view.ts").default;
  assert.equal(definition.key, flagKey);
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.deepEqual(definition.releaseRisk.highRisk, "money");
  assert.match(definition.description, /Off restores the scheduled runs/);
});
