const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");
const flagKey = "htpr-7848-summary-on-view";
const queuePath = "/api/queues/FAST/generateSummaryQueue";

function memoryRedis() {
  const values = new Map();
  const ttls = new Map();
  const bump = (key) => {
    const next = (Number(values.get(key)) || 0) + 1;
    values.set(key, String(next));
    return next;
  };
  return {
    values, ttls, bump,
    pipeline: () => ({ keys: [], incr(key) { this.keys.push(key); return this; },
      exec: async () => this.keys.map((key) => [null, bump(key)]) }),
    incr: async (key) => bump(key),
    expire: async (key, seconds) => { ttls.set(key, seconds); return 1; },
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

function harness({ enabledFor = [], extraFlags = [] } = {}) {
  const jobs = [];
  const redis = memoryRedis();
  const flags = {
    isFeatureEnabled: async (key, userId) =>
      key === flagKey ? enabledFor.includes(userId) : extraFlags.includes(key),
  };
  const qstash = {
    scheduleJobById: async (job) => { jobs.push(job); return { messageId: "job" }; },
  };
  const stubs = {
    "@/lib/qstash": qstash,
    "@/lib/redis": { getRedis: async () => redis },
    "@/lib/flags": flags,
    "@/lib/flags/definitions/htpr-7848-summary-on-view": { HTPR_7848_SUMMARY_ON_VIEW_FLAG: flagKey },
  };
  const freshness = loadModule("src/app/api/ai/_lib/taskSummaryFreshness.ts", stubs);
  const scheduler = loadModule("src/pages/api/queues/FAST/generateSummary.ts", {
    ...stubs,
    "@/app/api/ai/_lib/taskSummaryFreshness": freshness,
  }).default;
  return { freshness, scheduler, jobs, redis };
}

function loadSeed(prisma, freshness) {
  return loadModule("src/app/api/ai/_lib/taskSummaryCheckoutSeed.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/app/api/ai/_lib/taskSummaryFreshness": freshness,
  });
}

test("a burst of changes marks one record and starts no AI run", async () => {
  const h = harness({ enabledFor: [6] });
  for (let i = 0; i < 10; i += 1) await h.scheduler({ taskId: 42, ownerUserId: 6 });
  assert.equal(h.jobs.length, 0);
  assert.equal(h.redis.values.get("ai-summary:stale:42"), "10");
  assert.equal(h.redis.ttls.size, 0, "the mark must survive until a refresh");
});

test("an agent change and an activity-only change still mark out of date", async () => {
  const h = harness({ enabledFor: [6], extraFlags: ["htpr-8904-agent-automatic-ai"] });
  await h.scheduler({ taskId: 45, ownerUserId: 6, agentId: "agent-1" });
  await h.scheduler({ taskId: 46, activityOnlyOwnerId: 6 });
  assert.equal(h.jobs.length, 0);
  assert.equal(h.redis.values.get("ai-summary:stale:45"), "1");
  assert.equal(h.redis.values.get("ai-summary:stale:46"), "1");
});

test("nothing changed means no run, and many opens make exactly one", async () => {
  const quiet = harness({ enabledFor: [6] });
  assert.equal(await quiet.freshness.requestTaskSummaryRefreshOnView({ taskId: 43 }), "fresh");
  assert.equal(quiet.jobs.length, 0);
  const h = harness({ enabledFor: [6] });
  await h.scheduler({ taskId: 42, ownerUserId: 6 });
  const decisions = [];
  for (let i = 0; i < 3; i += 1) {
    decisions.push(await h.freshness.requestTaskSummaryRefreshOnView({ taskId: 42 }));
  }
  assert.deepEqual(decisions, ["scheduled", "coalesced", "coalesced"]);
  assert.equal(h.jobs.length, 1);
  assert.equal(h.jobs[0].path, queuePath);
  assert.equal(h.jobs[0].jobId, "ai-summary-view-for-taskId:42");
});

test("a change during a run keeps its mark until the next run clears it", async () => {
  const h = harness({ enabledFor: [6] });
  await h.scheduler({ taskId: 42, ownerUserId: 6 });
  await h.scheduler({ taskId: 42, ownerUserId: 6 });
  const started = await h.freshness.readTaskSummaryStaleMarker(42);
  await h.scheduler({ taskId: 42, ownerUserId: 6 });
  await h.freshness.clearTaskSummaryStaleMarker(42, started);
  assert.equal(h.redis.values.get("ai-summary:stale:42"), "3");
  await h.freshness.clearTaskSummaryStaleMarker(42, "3");
  assert.equal(h.redis.values.has("ai-summary:stale:42"), false);
});

test("the switch off keeps the scheduled run and marks nothing", async () => {
  const h = harness({ enabledFor: [] });
  await h.scheduler({ taskId: 44, ownerUserId: 7 });
  assert.deepEqual(h.jobs.map((job) => job.body), [{ taskId: 44 }]);
  assert.equal(h.jobs[0].jobId, "ai-summary-for-taskId:44");
  assert.equal(h.redis.values.has("ai-summary:stale:44"), false);
  assert.equal(await h.freshness.requestTaskSummaryRefreshOnView({ taskId: 44 }), "fresh");
  assert.equal(h.jobs.length, 1);
});

test("a checkout marks the team's tickets instead of generating summaries", async () => {
  const h = harness({ enabledFor: [6] });
  const asked = [];
  const seed = loadSeed({ task: { findMany: async (args) => {
    asked.push(args);
    return [{ id: 51 }, { id: 52 }];
  } } }, h.freshness);
  assert.equal(await h.freshness.shouldPregenerateTeamSummariesOnCheckout(6), false);
  assert.equal(await seed.seedTeamSummaryRefreshesOnCheckout("team-1"), 2);
  assert.deepEqual(asked[0].where.project, { teamId: "team-1" });
  assert.equal(h.redis.values.get("ai-summary:stale:51"), "1");
  assert.equal(h.redis.values.get("ai-summary:stale:52"), "1");
  assert.equal((await harness({ enabledFor: [] }).freshness
    .shouldPregenerateTeamSummariesOnCheckout(6)), true);
});

test("a failed seed reports zero so the caller can ask for today's backfill", async () => {
  const h = harness({ enabledFor: [6] });
  const seed = loadSeed({ task: { findMany: async () => { throw new Error("db down"); } } }, h.freshness);
  assert.equal(await seed.seedTeamSummaryRefreshesOnCheckout("team-1"), 0);
});

test("the switch stays owner-and-QA only, reversible and marked as money", () => {
  const definition = loadModule("src/lib/flags/definitions/htpr-7848-summary-on-view.ts").default;
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.highRisk, "money");
  assert.equal(definition.releaseRisk.harmEvidence.harm, "charge");
  assert.match(definition.description, /Off restores the scheduled runs/);
});
