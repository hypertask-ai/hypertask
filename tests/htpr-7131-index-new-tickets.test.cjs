const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7131-index-new-tickets";
const noop = async () => undefined;

function harness(enabled, { failIndex = false, denied = false } = {}) {
  const indexed = [], flags = [], background = [];
  let committed = false, descriptionSaved = false, releaseIndex;
  const indexFinished = new Promise((resolve) => { releaseIndex = resolve; });
  const actor = { id: 985 };
  const section = { id: 9, section_title: "Todo", projectId: 7049 };
  let task;
  const db = {
    project: {
      findFirst: async () => denied ? null : { id: 7049 },
      findUnique: async () => ({ uniqueIdentifier: "QASA" }),
    },
    section: { findFirst: async () => section },
    task: {
      count: async () => 1,
      aggregate: async () => ({ _max: { uniqueIndex: 0 } }),
      findFirst: async () => ({ ranking: "a", section: "Todo" }),
      findUnique: async () => task,
      create: async ({ data }) => {
        task = { ...data, id: 42, project: { teamId: 2 }, priority: null, status: "Normal", dueDate: null, startDate: null };
        return task;
      },
    },
    description: { findUnique: async () => ({ content: "" }) },
    team_Activity: { update: noop },
    drafts: { create: noop, createMany: noop },
    $executeRaw: noop,
  };
  const mocks = {
    "@/lib/prisma": { default: db },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      flags.push([key, userId]);
      assert.equal(key, flagKey);
      return enabled;
    } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: actor.id }) },
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: async () => actor },
    "@/utils/generateRank": { default: () => "b" },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "@/utils/controllers/description/common-description-create": { default: async () => { descriptionSaved = true; return { content: "" }; } },
    "../description/common-description-create": { default: async () => { descriptionSaved = true; return { content: "" }; } },
    "@/lib/mcp/webhooks/taskEvents": { createTaskWithBoardWebhookOutbox: async (_db, _actor, callback) => {
      const created = await callback(db);
      committed = true;
      return { result: created.result, boardWebhookDeliveryIds: [] };
    } },
    "@/lib/mcp/webhooks/outbox": { publishBoardWebhookDeliveries: noop },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskCreatedPending: noop, markAgentTaskCreatedReady: noop, emitAgentTaskCreatedWebhook: noop },
    "@/utils/controllers/assignees/autoAssignForSection": { autoAssignForSection: async () => "ready" },
    "@/lib/ai/labelClassifier": { scheduleClassifyTaskAiLabels: noop, classifyTaskAiLabels: noop },
    "@/lib/realtime/server": { broadcastBoardChange: noop },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { upsertTaskToTurbopuffer: async (taskId) => {
      assert.ok(committed, "search reads must run after commit");
      assert.ok(descriptionSaved, "search must include the saved description");
      indexed.push(taskId);
      await indexFinished;
      if (failIndex) throw new Error("Search unavailable");
    } },
    "@/pages/api/queues/FAST/generateSummary": { default: noop },
    "@/utils/controllers/activities/createAssignedActivity": { assignmentActivityUserSelect: {} },
    "@vercel/functions": { waitUntil: (promise) => background.push(promise) },
    "@/lib/api/task-writes/route": {
      withTaskWriteFlag: (handler) => handler,
      taskWriteRoute: ({ prepare, operation }) => async (request) => operation(await request.json(), await prepare({ userId: actor.id })),
    },
  };
  const body = { title: "uniqueword title", description: "", projectId: 7049, sectionId: 9, section: "Todo", ranking: "a", userId: actor.id };
  async function create(kind, extra = {}) {
    if (kind === "core") {
      return load("src/utils/controllers/tasks/createTaskCore.ts", mocks).createTaskCore({ ...body, sectionTitle: "Todo", projectIdentifier: "QASA", ...extra });
    }
    if (kind === "global-effects") {
      // Both global routes already commit their nested description before
      // scheduling this same Vercel-lifetime-protected indexing work.
      committed = descriptionSaved = true;
      task = { ...body, id: 42, project: { teamId: 2 } };
      load("src/lib/api/task-writes/create-global-effects.ts", mocks).schedulePostCreateWork({ task, userId: actor.id, projectId: 7049, originUserId: actor.id });
      await Promise.all(background);
      return { status: 200 };
    }
    if (kind === "app-router") {
      const response = await load("src/lib/api/task-writes/create.ts", mocks).POST({ json: async () => ({ ...body, ...extra }) });
      return { status: response.status, json: await response.json() };
    }
    let response;
    await load("src/pages/api/tasks/create.ts", mocks).default(
      { method: "POST", headers: {}, body: { ...body, ...extra } },
      { status: (status) => ({ json: (json) => { response = { status, json }; return response; } }) },
    );
    return response;
  }
  return { create, indexed, flags, releaseIndex, background };
}

for (const enabled of [true, false]) {
  for (const [kind, variant, extra] of [
    ["legacy", "API and quick add", {}],
    ["legacy", "urgent quick add", { index: 0 }],
    ["legacy", "fullscreen", { fullScreenTask: true }],
    ["legacy", "inferred rank", { ranking: undefined, section: undefined }],
    ["app-router", "typed API and quick add", {}],
    ["app-router", "fullscreen", { fullScreenTask: true }],
    ["core", "agent creation", { agentId: "agent-1" }],
    ["core", "recurrence and internal creation", { createDrafts: false, updateTeamActivity: false }],
    ["global-effects", "MCP, REST, task writer and global modal", {}],
  ]) {
    test(`${kind} ${variant}: flag ${enabled ? "on" : "off"}`, async () => {
      const fx = harness(enabled);
      let finished = false;
      const pending = fx.create(kind, extra).then((result) => { finished = true; return result; });
      fx.releaseIndex();
      const result = await pending;
      await Promise.all(fx.background);
      assert.equal(kind === "core" ? result.task.id : result.status, kind === "core" ? 42 : 200);
      assert.ok(finished);
      assert.deepEqual(fx.indexed, enabled || kind === "global-effects" ? [42] : []);
      assert.deepEqual(fx.flags, kind === "global-effects" ? [] : [[flagKey, 985]]);
      assert.ok(fx.background.length >= 1, "indexing is protected by waitUntil");
    });
  }
}

for (const kind of ["legacy", "core"]) {
  test(`${kind} hands indexing to waitUntil instead of making creation wait`, async () => {
    const fx = harness(true);
    await fx.create(kind);
    assert.ok(fx.background.length >= 1, "indexing keeps the serverless instance alive via waitUntil");
    for (let i = 0; i < 100 && !fx.indexed.length; i++) await Promise.resolve();
    assert.deepEqual(fx.indexed, [42], "creation finished while indexing is still pending");
    fx.releaseIndex();
    await Promise.all(fx.background);
  });

  test(`${kind} search outage does not fail a committed ticket creation`, async () => {
    const fx = harness(true, { failIndex: true });
    fx.releaseIndex();
    const result = await fx.create(kind);
    await Promise.all(fx.background);
    assert.equal(kind === "core" ? result.task.id : result.status, kind === "core" ? 42 : 200);
  });
}

test("denied creation never indexes a task", async () => {
  const fx = harness(true, { denied: true });
  fx.releaseIndex();
  assert.equal((await fx.create("legacy")).status, 404);
  await Promise.all(fx.background);
  assert.deepEqual(fx.indexed, []);
  assert.deepEqual(fx.flags, []);
});

test("bugfix registry definition defaults to Everyone with a release risk", () => {
  const definition = load("src/lib/flags/definitions/htpr-7131-index-new-tickets.ts", {}).default;
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "bugfix");
  const { defaultFeatureFlagMode } = load("src/lib/flags.ts", {
    "@/lib/prisma": { default: {} },
    "@/lib/auth/getSessionUser": { getSessionUser: noop },
  });
  assert.equal(defaultFeatureFlagMode(flagKey), "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});

test("all public creation paths converge on the tested creators", () => {
  const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
  for (const file of ["src/pages/api/tasks/createGlobally.ts", "src/lib/api/task-writes/create-global.ts"]) {
    assert.match(source(file), /schedulePostCreateWork\(\{/);
  }
  assert.match(source("src/lib/mcp/operations/tasks/create/operation.ts"), /await createTask\(\{/);
  assert.match(source("src/lib/mcp/tasks/services.ts"), /\/api\/tasks\/createGlobally/);
  assert.match(source("src/lib/ai/tools/createTask.ts"), /await createTask\(\{/);
  assert.match(source("src/app/api/agent-chat/[sessionId]/proposals/[proposalId]/route.ts"), /await createTaskCore\(\{/);
  assert.match(source("src/utils/controllers/tasks/spawnRecurrence.ts"), /await createTaskCore\(\{/);
});
