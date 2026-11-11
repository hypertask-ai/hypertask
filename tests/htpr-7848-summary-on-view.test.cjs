const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");
const flagKey = "htpr-7848-summary-on-view";
const queuePath = "/api/queues/FAST/generateSummaryQueue";

function memoryRedis() {
  const values = new Map();
  const ttls = new Map();
  const pipeline = () => {
    const queued = [];
    return {
      incr(key) {
        queued.push(key);
        return this;
      },
      exec: async () => {
        const results = [];
        for (const key of queued) {
          const next = (Number(values.get(key)) || 0) + 1;
          values.set(key, String(next));
          results.push([null, next]);
        }
        return results;
      },
    };
  };
  return {
    values,
    ttls,
    pipeline,
    incr: async (key) => {
      const next = (Number(values.get(key)) || 0) + 1;
      values.set(key, String(next));
      return next;
    },
    expire: async (key, seconds) => {
      ttls.set(key, seconds);
      return 1;
    },
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
  const flagChecks = [];
  const flags = {
    isFeatureEnabled: async (key, userId) => {
      flagChecks.push({ key, userId });
      if (key === flagKey) return enabledFor.includes(userId);
      return extraFlags.includes(key);
    },
  };
  const qstash = {
    scheduleJobById: async (job) => {
      jobs.push(job);
      return { messageId: `job-${jobs.length}` };
    },
  };
  redis.flags = flags;
  const freshness = loadModule("src/app/api/ai/_lib/taskSummaryFreshness.ts", {
    "@/lib/qstash": qstash,
    "@/lib/redis": { getRedis: async () => redis },
    "@/lib/flags": flags,
    "@/lib/flags/definitions/htpr-7848-summary-on-view": { HTPR_7848_SUMMARY_ON_VIEW_FLAG: flagKey },
  });
  const scheduler = loadModule("src/pages/api/queues/FAST/generateSummary.ts", {
    "@/lib/qstash": qstash,
    "@/lib/redis": { getRedis: async () => redis },
    "@/lib/flags": flags,
    "@/lib/flags/definitions/htpr-7848-summary-on-view": { HTPR_7848_SUMMARY_ON_VIEW_FLAG: flagKey },
    "@/app/api/ai/_lib/taskSummaryFreshness": freshness,
  }).default;
  return { freshness, scheduler, jobs, redis, flagChecks };
}

test("a burst of changes marks the summary out of date and starts no AI run", async () => {
  const h = harness({ enabledFor: [6] });
  for (let index = 0; index < 10; index += 1) {
    await h.scheduler({ taskId: 42, ownerUserId: 6 });
  }
  assert.equal(h.jobs.length, 0);
  assert.equal(h.redis.values.get("ai-summary:stale:42"), "10");
  assert.equal(h.redis.ttls.size, 0, "the out-of-date mark stays until a summary refreshes");
});

test("an agent-authored change still marks the summary out of date", async () => {
  const h = harness({ enabledFor: [6], extraFlags: ["htpr-8904-agent-automatic-ai"] });
  await h.scheduler({ taskId: 45, ownerUserId: 6, agentId: "agent-1" });
  assert.equal(h.jobs.length, 0);
  assert.equal(h.redis.values.get("ai-summary:stale:45"), "1");
});

test("a change that passes only the activity owner still uses the switch", async () => {
  const h = harness({ enabledFor: [6] });
  await h.scheduler({ taskId: 46, activityOnlyOwnerId: 6 });
  assert.equal(h.jobs.length, 0);
  assert.equal(h.redis.values.get("ai-summary:stale:46"), "1");
});

test("a checkout marks the team's tickets out of date and creates no summary job", async () => {
  const h = harness({ enabledFor: [6] });
  const asked = [];
  const seed = loadModule("src/app/api/ai/_lib/taskSummaryCheckoutSeed.ts", {
    "@/lib/prisma": {
      __esModule: true,
      default: {
        task: {
          findMany: async (args) => {
            asked.push(args);
            return [{ id: 51 }, { id: 52 }, { id: 53 }];
          },
        },
      },
    },
    "@/app/api/ai/_lib/taskSummaryFreshness": h.freshness,
  });
  assert.equal(await seed.seedTeamSummaryRefreshesOnCheckout("team-1"), 3);
  assert.deepEqual(asked[0].where.project, { teamId: "team-1" });
  assert.equal(h.redis.values.get("ai-summary:stale:51"), "1");
  assert.equal(h.redis.values.get("ai-summary:stale:53"), "1");
  assert.equal(h.jobs.length, 0);
});

test("opening a ticket with nothing changed starts no run", async () => {
  const h = harness({ enabledFor: [6] });
  assert.equal(await h.freshness.requestTaskSummaryRefreshOnView({ taskId: 43, ownerUserId: 6 }), "fresh");
  assert.equal(h.jobs.length, 0);
  assert.equal(h.redis.values.has("ai-summary:view-refresh:43"), false);
});

test("many opens after a burst make exactly one run for that ticket", async () => {
  const h = harness({ enabledFor: [6] });
  for (let index = 0; index < 10; index += 1) {
    await h.scheduler({ taskId: 42, ownerUserId: 6 });
  }
  const decisions = [];
  for (let index = 0; index < 5; index += 1) {
    decisions.push(await h.freshness.requestTaskSummaryRefreshOnView({ taskId: 42, ownerUserId: 6 }));
  }
  assert.deepEqual(decisions, ["scheduled", "coalesced", "coalesced", "coalesced", "coalesced"]);
  assert.equal(h.jobs.length, 1);
  assert.equal(h.jobs[0].path, queuePath);
  assert.equal(h.jobs[0].jobId, "ai-summary-view-for-taskId:42");
  assert.deepEqual(h.jobs[0].body, { taskId: 42 });
  assert.ok(h.jobs[0].notBefore - Math.floor(Date.now() / 1000) <= 5);
});

test("a run keeps a change that arrived while it was working", async () => {
  const h = harness({ enabledFor: [6] });
  await h.scheduler({ taskId: 42, ownerUserId: 6 });
  await h.scheduler({ taskId: 42, ownerUserId: 6 });
  const started = await h.freshness.readTaskSummaryStaleMarker(42);
  assert.equal(started, "2");
  await h.scheduler({ taskId: 42, ownerUserId: 6 });
  await h.freshness.clearTaskSummaryStaleMarker(42, started);
  assert.equal(h.redis.values.get("ai-summary:stale:42"), "3");
  await h.freshness.clearTaskSummaryStaleMarker(42, "3");
  assert.equal(h.redis.values.has("ai-summary:stale:42"), false);
});

test("the switch off keeps the scheduled run and marks nothing out of date", async () => {
  const h = harness({ enabledFor: [] });
  await h.scheduler({ taskId: 44, ownerUserId: 7 });
  assert.equal(h.jobs.length, 1);
  assert.equal(h.jobs[0].jobId, "ai-summary-for-taskId:44");
  assert.deepEqual(h.jobs[0].body, { taskId: 44 });
  assert.ok(Math.abs(h.jobs[0].notBefore - Math.floor(Date.now() / 1000) - 300) <= 1);
  assert.equal(h.redis.values.has("ai-summary:stale:44"), false);
  assert.equal(await h.freshness.requestTaskSummaryRefreshOnView({ taskId: 44, ownerUserId: 7 }), "off");
  assert.equal(h.jobs.length, 1);
});

test("a Stripe checkout pre-generates no summaries while the switch is on", async () => {
  const on = harness({ enabledFor: [6] });
  assert.equal(await on.freshness.shouldPregenerateTeamSummariesOnCheckout(6), false);
  const off = harness({ enabledFor: [] });
  assert.equal(await off.freshness.shouldPregenerateTeamSummariesOnCheckout(6), true);
});

test("the switch stays owner-and-QA only, reversible and marked as money", () => {
  const definition = loadModule("src/lib/flags/definitions/htpr-7848-summary-on-view.ts").default;
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.highRisk, "money");
  assert.match(definition.description, /Off restores the scheduled runs/);
});
