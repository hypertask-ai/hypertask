const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { createJiti } = require("jiti");
const { Prisma } = require("@prisma/client");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { fsCache: false });
const flag = jiti(path.join(root, "src/lib/flags/definitions/htpr-7689-prompt-caching.ts"));
const plain = (value) => JSON.parse(JSON.stringify(value));

function load(file, stubs = {}) {
  const filename = path.join(root, file);
  const code = jiti.transform({ source: fs.readFileSync(filename, "utf8"), filename, ts: true });
  const mod = { exports: {} };
  const dependency = (id) => {
    if (Object.hasOwn(stubs, id)) return stubs[id];
    if (["node:crypto", "zod", "@prisma/client"].includes(id)) return require(id);
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, require: dependency,
    jitiImport: async (id) => dependency(id),
    AbortSignal, Date, console,
  }, { filename });
  return mod.exports;
}

function comment(id, extra = {}) {
  return {
    id, text: `<p>Human decision ${id}</p>`, activity: null,
    createdAt: new Date(Date.UTC(2026, 9, 23, 0, id)),
    agent: null, agentDisplayName: null,
    creator: { displayName: "Reader", email: "reader@example.invalid" },
    ...extra,
  };
}

function harness({ enabled = true, comments = [comment(1)] } = {}) {
  const requests = [], writes = [], checks = [], queries = [], jobs = [];
  const task = {
    id: 42, userId: 985, agentId: null, projectId: 15,
    title: "Useful ticket", ticketNumber: "HTPR-7689",
    project: { teamId: "team-fixture", team: { aiProviderSettings: {} } },
    description_: { content: "<p>Original description</p>" },
    comments,
  };
  let storedSummary = null;
  const prisma = {
    task: { findUnique: async ({ where, select }) => {
      assert.equal(where.id, 42);
      if (!select.comments) return { userId: task.userId };
      queries.push(select.comments);
      const rows = select.comments.where
        ? task.comments.filter((row) => row.activity === null)
        : task.comments;
      if (select.comments.where) assert.equal(select.comments.where.activity.equals, Prisma.DbNull);
      return {
        ...task,
        comments: [...rows].sort((a, b) => b.createdAt - a.createdAt).slice(0, select.comments.take),
        Task_Summary: storedSummary ? [{ content: storedSummary }] : [],
      };
    } },
    task_Summary: { upsert: async (args) => {
      writes.push(args);
      storedSummary = args.update.content;
    } },
    description: { updateMany: async () => ({ count: 1 }) },
    $transaction: async (operations) => Promise.all(operations),
  };
  const stubs = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      return enabled;
    } },
    "@/lib/flags/definitions/htpr-7689-prompt-caching": flag,
    "@/lib/qstash": { scheduleJobById: async (job) => {
      jobs.push(job);
      return { messageId: "fixture-job" };
    } },
    "@/lib/redis": { getRedis: async () => ({ set: async () => "OK", eval: async () => 1 }) },
    "@/lib/net/downloadWithoutBrotli": {},
    "@/lib/ai/prompts/registry": { renderPrompt: (id, ...args) => JSON.stringify([id, ...args]) },
    "@/app/api/ai/_lib/modelProvider": {
      resolveAiModel: () => "fixture-model",
      configureAiModelUsage: () => {},
      providerOptionsForAiModel: () => ({ gateway: { tags: ["summary"] } }),
    },
    "@/app/api/ai/_lib/byokKeys": { getTeamGatewayApiKey: async () => "fixture-key" },
    "@/app/api/ai/_lib/systemModelLadder": {
      resolveSystemModel: () => ({ provider: "google", model: "google/gemini-fixture" }),
    },
    "@/app/api/ai/_lib/taskContent": load("src/app/api/ai/_lib/taskContent.ts"),
    ai: {
      Output: { object: (value) => value },
      NoObjectGeneratedError: { isInstance: () => false },
      generateText: async (request) => {
        requests.push(request);
        return { output: { summary: "Fixture summary", descriptionGoodEnough: true } };
      },
    },
  };
  const api = load("src/app/api/ai/_lib/taskSummaries.ts", stubs);
  const scheduler = load("src/pages/api/queues/FAST/generateSummary.ts", stubs).default;
  return { ...api, scheduler, task, requests, writes, checks, queries, jobs, stubs };
}

function source(row, index) {
  return {
    index,
    creator: row.agent?.displayName || row.agentDisplayName || row.creator?.displayName || row.creator?.email || (row.activity ? "Activity Log" : "Unknown"),
    createdAt: row.createdAt.toISOString(),
    text: (row.text || JSON.stringify(row.activity)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  };
}

function legacyFingerprint(task, sources) {
  return createHash("sha256").update(JSON.stringify({
    promptVersion: "task-summary-v2-one-call-2026-08-08",
    teamId: task.project.teamId,
    title: task.title,
    ticketNumber: task.ticketNumber,
    description: "Original description",
    sources,
    provider: "google",
    model: "google/gemini-fixture",
  })).digest("hex");
}

function formattedSources(sources) {
  return sources.map((row) => `[${row.index}] comment_creator: ${row.creator}\ncreated_at: ${row.createdAt}\ntext: ${row.text}`).join("\n\n");
}

const activity = (id, type = "TaskMove", agent = false) => comment(id, {
  text: "",
  activity: { type, data: { fromUserId: 6 } },
  creator: null,
  ...(agent ? { agent: { displayName: "Runner" }, agentDisplayName: "Runner" } : {}),
});

test("Off preserves exact legacy sources, fingerprint and duplicate detection, including agent activity", async () => {
  const h = harness({ enabled: false, comments: [comment(1), activity(2, "TaskAssigned", true), activity(3)] });
  assert.equal(await h.generateAndStoreTaskSummary(42), "Fixture summary");
  const sources = [...h.task.comments].reverse().map((row, index) => source(row, index + 1));
  assert.equal(Object.hasOwn(h.queries[0], "where"), false);
  assert.equal(h.queries[0].take, 200);
  assert.equal(h.requests[0].prompt, JSON.stringify([
    "task-summaries-prompt-3", h.task.title, h.task.ticketNumber,
    "Original description", formattedSources(sources),
  ]));
  assert.equal(h.writes[0].update.content, `Fixture summary\n\n[hypertask-summary-fingerprint]: # (${legacyFingerprint(h.task, sources)})`);
  await h.generateAndStoreTaskSummary(42);
  assert.equal(h.requests.length, 1);
  h.task.comments.push(activity(4, "TaskPriority", true));
  await h.generateAndStoreTaskSummary(42);
  assert.equal(h.requests.length, 2);
  assert.match(h.requests[1].prompt, /TaskPriority/);
});

test("On filters agent and human activity before the 200-source limit and ignores later activity", async () => {
  const h = harness({ comments: [comment(1), ...Array.from({ length: 201 }, (_, i) => activity(i + 2, "TaskMove", true))] });
  await h.generateAndStoreTaskSummary(42);
  assert.deepEqual(JSON.parse(h.requests[0].prompt), [
    "task-summaries-prompt-3", h.task.title, h.task.ticketNumber,
    "Original description", formattedSources([source(comment(1), 1)]),
  ]);
  const persisted = h.writes[0].update.content;
  h.task.comments.push(activity(203, "TaskEstimate"));
  assert.equal(await h.generateAndStoreTaskSummary(42), "Fixture summary");
  assert.equal(h.requests.length, 1);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].update.content, persisted);
  assert.deepEqual(h.checks, Array(2).fill([flag.HTPR_7689_PROMPT_CACHING_FLAG, 985]));
});

for (const enabled of [false, true]) {
  test(`${enabled ? "On" : "Off"} still regenerates for human comments, descriptions and titles`, async () => {
    const h = harness({ enabled });
    await h.generateAndStoreTaskSummary(42);
    h.task.comments.push(comment(2));
    await h.scheduler({ taskId: 42, agentId: null });
    await h.generateAndStoreTaskSummary(42);
    assert.equal(h.requests.length, 2);
    assert.match(h.requests[1].prompt, /Human decision 2/);
    h.task.description_.content = "<p>Changed description</p>";
    await h.scheduler({ taskId: 42, activityOnlyOwnerId: null });
    await h.generateAndStoreTaskSummary(42);
    assert.equal(h.requests.length, 3);
    assert.match(h.requests[2].prompt, /Changed description/);
    h.task.title = "Changed title";
    await h.generateAndStoreTaskSummary(42);
    assert.equal(h.requests.length, 4);
    assert.match(h.requests[3].prompt, /Changed title/);
    assert.notEqual(h.writes[0].update.content, h.writes[1].update.content);
    assert.notEqual(h.writes[1].update.content, h.writes[2].update.content);
    assert.equal(h.jobs.length, 2);
    assert.deepEqual(plain(h.jobs[0].body), { taskId: 42, agentId: null });
  });

  test(`${enabled ? "On skips" : "Off keeps"} activity scheduling for the task owner, not the actor`, async () => {
    const h = harness({ enabled });
    h.task.userId = 123;
    const pending = [];
    const schedule = (input) => {
      const promise = h.scheduler(input);
      pending.push(promise);
      return promise;
    };
    const createActivity = load("src/utils/controllers/activities/createActivity.ts", {
      ...h.stubs,
      "@/lib/prisma": { __esModule: true, default: {
        comment: { create: async ({ data }) => ({ id: 1, ...data }) },
        task: { findUnique: async () => ({ updatedByUserIds: [6], userId: 123 }) },
      } },
      "@/pages/api/queues/FAST/generateSummary": { __esModule: true, default: schedule },
      "@/lib/agents/publicAgent": { sanitizeAgentCredentials: (value) => value },
      "@/lib/agents/activityAttribution": load("src/lib/agents/activityAttribution.ts"),
    }).default;
    for (const type of ["TaskMove", "TaskAssigned", "TaskPriority", "TaskEstimate"]) {
      await createActivity({ taskId: 42, activityBody: {
        type, data: { fromUserId: 6, fromAgent: { id: "runner", displayName: "Runner" } },
      } });
    }
    await Promise.all(pending);
    assert.equal(h.jobs.length, enabled ? 0 : 4);
    assert.deepEqual(h.checks, Array(4).fill([flag.HTPR_7689_PROMPT_CACHING_FLAG, 123]));
    await createActivity({ taskId: 42, activityBody: { type: "TaskDescriptionUpdate", data: { fromUserId: 6 } } });
    await Promise.all(pending);
    assert.equal(h.jobs.length, enabled ? 1 : 5);
    for (const job of h.jobs) {
      assert.deepEqual(plain(job.body), { taskId: 42 });
      assert.equal(job.path, "/api/queues/FAST/generateSummaryQueue");
      assert.equal(job.jobId, "ai-summary-for-taskId:42");
      assert.ok(Math.abs(job.notBefore - Math.floor(Date.now() / 1000) - 300) <= 1);
    }
  });
}

test("On preserves person-facing agent comments instead of excluding every agent author", async () => {
  const h = harness();
  await h.generateAndStoreTaskSummary(42);
  h.task.comments.push(comment(2, { agent: { displayName: "Runner" }, text: "<p>Release verified; ready for you</p>" }));
  await h.generateAndStoreTaskSummary(42);
  assert.equal(h.requests.length, 2);
  assert.match(h.requests[1].prompt, /Release verified; ready for you/);
});
