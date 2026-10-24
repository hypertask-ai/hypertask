const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const flag = "htpr-7740-create-response";

function harness({ enabled = true, tasks = [], section = { id: 9, section_title: "Todo" }, createError } = {}) {
  const created = [];
  const broadcasts = [];
  const flagReads = [];
  const sharedRoute = load("src/lib/api/task-writes/route.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 985 }) },
    "@/lib/auth/agentScope": {
      withAgentScopeRequest: (_request, run) => run(),
      prepareAgentScope: async () => {},
    },
    "@/lib/auth/session": {},
  });
  const { POST } = load("src/lib/api/task-writes/create.ts", {
    "./route": sharedRoute,
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: async () => ({ id: 985 }) },
    "@/lib/auth/resolveActingAgent": { resolveActingAgent: () => ({ ok: true, agentId: null }) },
    "@/lib/media/inlineAgentImages.server": {},
    "./create-fullscreen": { createFullScreenTaskAndReturn: async () => ({ id: 42 }) },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => { flagReads.push([key, userId]); return enabled; } },
    "@/lib/flags/keys": { HTPR_7740_CREATE_RESPONSE_FLAG: flag },
    "@/lib/prisma": { default: {
      task: { findFirst: async () => tasks.at(-1) ?? null },
      section: { findFirst: async () => section },
    } },
    "@/utils/controllers/tasks/create": { default: async (data) => {
      if (createError) throw createError;
      const row = { ...data, id: 42 + created.length };
      created.push(row);
      tasks.push(row);
      return { status: 200, json: row };
    } },
    "@/lib/realtime/server": { broadcastBoardChange: async (...args) => { broadcasts.push(args); } },
  });
  const handler = sharedRoute.taskWriteHandler({ POST: async () => POST });
  async function request(extra = {}) {
    let response;
    await handler({ method: "POST", headers: {}, body: { title: "New task", projectId: 15, sectionId: 9, ...extra } }, {
      setHeader() {},
      status: (status) => ({ json: (body) => { response = { status, body }; } }),
    });
    return response;
  }
  return { request, created, broadcasts, flagReads };
}

test("HTPR-7740: two creates without section name or ranking both answer with valid positions", async () => {
  const { request, created, flagReads } = harness();
  const first = await request();
  assert.equal(first?.status, 200);
  assert.equal(first.body.ranking, "A0100");
  const second = await request();
  assert.equal(second?.status, 200);
  assert.equal(second.body.ranking, "A0190.000000000000000");
  assert.equal(created.length, 2);
  assert.deepEqual(flagReads, [[flag, 985], [flag, 985]]);
});

for (const ranking of ["", null, undefined]) {
  test(`HTPR-7740: existing ${String(ranking)} position cannot leave the response unsent`, async () => {
    const { request } = harness({ tasks: [{ ranking, section: "Todo" }] });
    const response = await request();
    assert.equal(response?.status, 200);
    assert.equal(response.body.ranking, "A0100");
  });
}

test("HTPR-7740: a missing or deleted section answers 400 without creating a task", async () => {
  const { request, created, broadcasts } = harness({ section: null });
  assert.deepEqual(await request(), { status: 400, body: { message: "Missing Required Information" } });
  assert.equal(created.length, 0);
  assert.equal(broadcasts.length, 0);
});

for (const sectionId of [undefined, null, "", 0]) {
  test(`HTPR-7740: missing section ID ${String(sectionId)} answers 400`, async () => {
    const { request, created } = harness();
    assert.deepEqual(await request({ sectionId }), { status: 400, body: { message: "Missing Required Information" } });
    assert.equal(created.length, 0);
  });
}

test("HTPR-7740: valid explicit positioning and fullscreen creation keep answering", async () => {
  const { request, broadcasts, flagReads } = harness();
  const explicit = await request({ section: "Todo", ranking: "A0200", userId: 985 });
  assert.equal(explicit.status, 200);
  assert.equal(explicit.body.ranking, "A0200");
  assert.deepEqual(await request({ fullScreenTask: true }), { status: 200, body: { newTask: { id: 42 } } });
  assert.equal(broadcasts.length, 2);
  assert.deepEqual(flagReads, []);
});

test("HTPR-7740: controller errors still answer 500", async () => {
  const { request } = harness({ createError: new Error("Database unavailable") });
  assert.deepEqual(await request(), { status: 500, body: { message: "Internal server error" } });
});

test("HTPR-7740: flag off restores the legacy empty-position fallthrough", async () => {
  const { request } = harness({ enabled: false, tasks: [{ ranking: "", section: "Todo" }] });
  assert.equal(await request(), undefined);
  const healthy = harness({ enabled: false, tasks: [{ ranking: "A0100", section: "Todo" }] });
  const response = await healthy.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.ranking, "A0190.000000000000000");
});
