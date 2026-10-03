const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const actor = { id: 7, displayName: "Test user", email: "test@example.invalid", notificationPreference: "direct" };
const cycle = { id: 11, number: 1, projectId: 15, startDate: "2026-08-17", endDate: "2026-08-31" };
const nextCycle = { ...cycle, id: 12, number: 2 };
const taskRow = { id: 50, projectId: 15, cycleId: 11, cycle, project: { cyclesEnabled: true }, description_: { content: "<p>Current &amp; text</p>" } };


function fixture(file, options = {}) {
  const calls = { queries: [], writes: [], broadcasts: [] };
  const user = options.signedOut ? null : actor;
  const task = options.task === undefined ? taskRow : options.task;
  const versions = options.versions ?? [
    { id: 31, version: 3, contentText: "Older", authorId: 7, author: { displayName: "Test user" }, agentId: null, createdAt: "2026-08-16" },
    { id: 30, version: 2, contentText: "Agent edit", authorId: null, author: null, agentId: "agent-1", createdAt: "2026-08-15" },
    { id: 29, version: 1, contentText: "Unknown", authorId: null, author: null, agentId: "missing-agent", createdAt: "2026-08-14" },
  ];
  const query = (name, result) => async (args) => {
    calls.queries.push({ name, args });
    if (options.failQuery === name) throw new Error("Test database failure");
    return result;
  };
  const mocks = {
    "@/lib/prisma": { default: {
      task: { findFirst: query("task", task) },
      docVersion: {
        findMany: query("versions", versions),
        findFirst: query("snapshot", options.snapshot === undefined ? { contentHtml: "<p>Older</p>", version: 3 } : options.snapshot),
      },
      agent: { findMany: query("agents", [{ id: "agent-1", displayName: "Test agent" }]) },
      user: { findUnique: query("user", options.missingUser ? null : actor) },
      cycle: { findMany: query("cycles", options.cycles ?? [cycle, nextCycle]) },
    } },
    "next/headers": { cookies: async () => ({ get: () => user ? { value: JSON.stringify(user) } : undefined }) },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => user ? { userId: user.id } : null },
    "@/utils/controllers/projects/getAllIncludes": {
      getProjectWhere: (userId, agentId) => ({ teamId: { not: null }, membership: userId, ...(agentId ? { agentId } : {}) }),
      taskWriteAccessWhere: (userId) => ({ writeAccessFor: userId }),
    },
    "@/lib/cycleService": { getProjectCycleOverview: async () => ({ enabled: true, current: cycle, next: nextCycle }) },
    "@/utils/controllers/tasks/single": { updateTaskSingle: async (...args) => {
      calls.writes.push(args);
      return options.writeResult ?? { status: 200, json: { id: 50 } };
    } },
    "@/lib/realtime/server": {
      broadcastBoardChange: async (...args) => { calls.broadcasts.push(["board", ...args]); },
      broadcastTaskChange: async (...args) => { calls.broadcasts.push(["task", ...args]); },
    },
    "@/utils/controllers/tasks/getAll": { default: async (...args) => {
      calls.queries.push({ name: "getAll", args });
      if (options.failQuery === "getAll") throw new Error("Test database failure");
      return options.listResult ?? { status: 200, json: [{ id: 50, title: "Task", parentTask: null, subTasks: [] }] };
    } },
  };
  return { route: load(file, mocks), calls };
}

function request(method, body, query = "taskId=50") {
  return new NextRequest(`https://app.hypertask.ai/api/tasks/cycle?${query}`, {
    method,
    headers: { cookie: `nookies_user=${encodeURIComponent(JSON.stringify(actor))}` },
    ...(body === undefined || method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

async function responseEquals(response, status, body) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), body);
}

const versionsPath = "src/app/api/tasks/[taskId]/description-versions/route.ts";
const restorePath = "src/app/api/tasks/[taskId]/description-restore/route.ts";
const cyclePath = "src/app/api/tasks/cycle/route.ts";
const context = (taskId = "50") => ({ params: Promise.resolve({ taskId }) });

for (const [file, method] of [[versionsPath, "GET"], [restorePath, "POST"], [cyclePath, "GET"], [cyclePath, "POST"]]) {
  test(`${file} ${method} keeps unauthorized and inaccessible responses`, async () => {
    for (const [options, status, body] of [
      [{ signedOut: true }, 401, { error: "Unauthorized" }],
      [{ task: null }, 404, { error: "Task not found" }],
    ]) {
      const { route, calls } = fixture(file, options);
      await responseEquals(await route[method](request(method, { version_id: 31, taskId: 50, cycleId: 11 }), context()), status, body);
      assert.equal(calls.writes.length, 0);
      assert.equal(calls.broadcasts.length, 0);
      assert.equal(calls.queries.filter(({ name }) => ["versions", "snapshot", "agents", "cycles"].includes(name)).length, 0);
    }
  });
}

for (const file of [versionsPath, restorePath]) {
  test(`${file} preserves strict path parsing and project scope`, async () => {
    const { route, calls } = fixture(file);
    const method = file === versionsPath ? "GET" : "POST";
    for (const id of ["0", "-1", "1.2", "50junk", "", "9007199254740992"]) {
      await responseEquals(await route[method](request(method, { version_id: 31 }), context(id)), 400, { error: "taskId must be a positive integer" });
    }
    assert.equal(calls.queries.length, 0);
    await route[method](request(method, { version_id: 31 }), context());
    assert.deepEqual(calls.queries[0].args.where, { id: 50, project: { status: "Normal", teamId: { not: null }, membership: 7 } });
  });
}

test("description versions retain content, actor fallbacks, pagination, and one batched agent lookup", async () => {
  const { route, calls } = fixture(versionsPath);
  await responseEquals(await route.GET(request("GET"), context()), 200, {
    current: { contentText: "Current & text" },
    hasMore: false,
    versions: [
      { id: 31, version: 3, contentText: "Older", authorId: 7, agentId: null, createdAt: "2026-08-16", actor: { displayName: "Test user", type: "user" } },
      { id: 30, version: 2, contentText: "Agent edit", authorId: null, agentId: "agent-1", createdAt: "2026-08-15", actor: { displayName: "Test agent", type: "agent" } },
      { id: 29, version: 1, contentText: "Unknown", authorId: null, agentId: "missing-agent", createdAt: "2026-08-14", actor: { displayName: "Unknown agent", type: "agent" } },
    ],
  });
  assert.equal(calls.queries[1].args.take, 101);
  assert.deepEqual(calls.queries[2].args.where, { id: { in: ["agent-1", "missing-agent"] } });
  const many = fixture(versionsPath, { versions: Array.from({ length: 101 }, (_, id) => ({ id, agentId: null, author: null })) });
  const body = await (await many.route.GET(request("GET"), context())).json();
  assert.equal(body.hasMore, true);
  assert.equal(body.versions.length, 100);
  assert.deepEqual(body.versions[0].actor, { displayName: "Unknown user", type: "user" });
  assert.deepEqual(many.calls.queries.map(({ name }) => name), ["task", "versions"]);
});

test("description restore pins all body, snapshot, conflict, and controller error shapes", async () => {
  for (const [body, expected] of [
    ["{", "Request body must be valid JSON"],
    ["null", "Request body must be a JSON object"],
    ["[]", "Request body must be a JSON object"],
    ["7", "Request body must be a JSON object"],
    [{}, "version_id must be a positive integer"],
    [{ version_id: "31" }, "version_id must be a positive integer"],
    [{ version_id: 0 }, "version_id must be a positive integer"],
    [{ version_id: 1.5 }, "version_id must be a positive integer"],
  ]) {
    const { route, calls } = fixture(restorePath);
    await responseEquals(await route.POST(request("POST", body), context()), 400, { error: expected });
    assert.equal(calls.queries.length, 0);
  }
  for (const [options, status, error] of [
    [{ snapshot: null }, 404, "Version not found"],
    [{ snapshot: { contentHtml: taskRow.description_.content } }, 409, "This version already matches the current description"],
    [{ writeResult: { status: 409, json: { message: "Changed concurrently" } } }, 409, "Changed concurrently"],
    [{ writeResult: { status: 500, json: null } }, 500, "Unable to restore description"],
  ]) {
    const { route, calls } = fixture(restorePath, options);
    await responseEquals(await route.POST(request("POST", { version_id: 31 }), context()), status, { error });
    assert.equal(calls.broadcasts.length, 0);
  }
});

test("description restore keeps success, cookie actor, optimistic lock, and realtime effects", async () => {
  const { route, calls } = fixture(restorePath);
  await responseEquals(await route.POST(request("POST", { version_id: 31 }), context()), 200, { ok: true, restored_from_version: 3 });
  assert.deepEqual(calls.queries[1].args.where, { id: 31, entityType: "task_description", entityId: 50 });
  assert.deepEqual(calls.writes, [[{ id: 50, description: "<p>Older</p>" }, actor, undefined, { expectedDescription: taskRow.description_.content }]]);
  assert.deepEqual(calls.broadcasts, [["board", 15, { originUserId: 7 }], ["task", 50, { originUserId: 7 }]]);
  const unsafe = fixture(restorePath);
  assert.equal((await unsafe.route.POST(request("POST", { version_id: 9007199254740992 }), context())).status, 200);
});

test("cycle GET pins success, scope, pagination, and validation", async () => {
  const { route, calls } = fixture(cyclePath);
  await responseEquals(await route.GET(request("GET")), 200, { enabled: true, assignedCycle: cycle, cycles: [{ ...cycle, assignable: true }, { ...nextCycle, assignable: true }], nextCursor: null });
  assert.deepEqual(calls.queries[0].args.where, { id: 50, status: "Normal", project: { status: "Normal", writeAccessFor: 7 } });
  for (const id of ["", "0", "1a", "2147483648"]) {
    await responseEquals(await route.GET(request("GET", undefined, `taskId=${id}`)), 400, { error: "A valid taskId is required" });
  }
  const page = fixture(cyclePath, { cycles: Array.from({ length: 21 }, (_, index) => ({ ...cycle, id: index + 1 })) });
  const response = await page.route.GET(request("GET", undefined, "taskId=50&cursor=10&query=Cycle%202"));
  const body = await response.json();
  assert.equal(body.cycles.length, 20);
  assert.equal(body.nextCursor, 20);
  assert.deepEqual(page.calls.queries[1].args.cursor, { id: 10 });
  assert.equal(page.calls.queries[1].args.where.number, 2);
});

test("cycle POST pins malformed bodies, assignment, clearing, and every conflict shape", async () => {
  for (const body of ["{", "null", "[]", {}, { taskId: "50", cycleId: 11 }, { taskId: 50, cycleId: "11" }, { taskId: 50, cycleId: 2147483648 }]) {
    const { route } = fixture(cyclePath);
    await responseEquals(await route.POST(request("POST", body)), 400, { error: "taskId and a valid cycleId or null are required" });
  }
  for (const [options, payload, status, expected] of [
    [{}, { taskId: 50, cycleId: 11 }, 200, { cycle, cycleId: 11 }],
    [{}, { taskId: 50, cycleId: null }, 200, { cycle: null, cycleId: null }],
    [{ task: { ...taskRow, project: { cyclesEnabled: false } } }, { taskId: 50, cycleId: 11 }, 409, { error: "Cycles are disabled for this board" }],
    [{}, { taskId: 50, cycleId: 99 }, 400, { error: "Only the current or next cycle can be assigned" }],
    [{ missingUser: true }, { taskId: 50, cycleId: 11 }, 401, { error: "Unauthorized" }],
    [{ writeResult: { status: 409, json: { message: "Conflict" } } }, { taskId: 50, cycleId: 11 }, 409, { error: "Conflict" }],
    [{ writeResult: { status: 500, json: null } }, { taskId: 50, cycleId: 11 }, 500, { error: "Unable to update cycle" }],
  ]) {
    const { route, calls } = fixture(cyclePath, options);
    await responseEquals(await route.POST(request("POST", payload)), status, expected);
    assert.equal(calls.broadcasts.length, status === 200 ? 2 : 0);
  }
});

for (const [file, method, error] of [[versionsPath, "GET", "Internal server error"], [restorePath, "POST", "Internal server error"], [cyclePath, "GET", "Unable to load cycles"], [cyclePath, "POST", "Unable to update cycle"]]) {
  test(`${file} ${method} retains server failure response`, async () => {
    const { route } = fixture(file, { failQuery: "task" });
    await responseEquals(await route[method](request(method, { version_id: 31, taskId: 50, cycleId: null }), context()), 500, { error });
  });
}

test("legacy getAll retains POST-only status and JSON contract", async () => {
  async function invoke(options, method, body) {
    const { route, calls } = fixture("src/pages/api/tasks/getAll.ts", options);
    const result = {};
    const response = { status(status) { result.status = status; return this; }, json(json) { result.json = json; return this; } };
    await route.default({ method, body, headers: {} }, response);
    return { result, calls };
  }
  for (const [options, method, body, expected] of [
    [{}, "GET", {}, { status: 405, json: { message: "Method not allowed" } }],
    [{ signedOut: true }, "POST", { projectId: 15 }, { status: 401, json: { message: "Unauthorized" } }],
    [{}, "POST", {}, { status: 200, json: "Missing Required Data" }],
    [{}, "POST", { projectId: 15 }, { status: 200, json: [{ id: 50, title: "Task", parentTask: null, subTasks: [] }] }],
    [{ listResult: { status: 403, json: { message: "Denied" } } }, "POST", { projectId: 15 }, { status: 403, json: { message: "Denied" } }],
    [{ failQuery: "getAll" }, "POST", { projectId: 15 }, { status: 200, json: [] }],
  ]) {
    assert.deepEqual((await invoke(options, method, body)).result, expected);
  }
  assert.deepEqual((await invoke({}, "POST", { projectId: 15 })).calls.queries[0].args, [15, 7]);
});

module.exports = { load, fixture, request, root };
