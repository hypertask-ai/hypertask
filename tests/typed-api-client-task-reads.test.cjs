const assert = require("node:assert/strict");
const test = require("node:test");
const axios = require("axios");
const { load } = require("./task-route-loader.cjs");
const fixtures = require("./fixtures/typed-api-task-reads.json");
const schemas = load("src/lib/api/contracts/taskReads.ts", {});
const client = load("src/lib/api/typedClient.ts", {});
const originalAdapter = axios.defaults.adapter;
test.beforeEach(() => { axios.defaults.adapter = async () => assert.fail("Tests must not make live HTTP requests"); });
test.afterEach(() => { axios.defaults.adapter = originalAdapter; });

for (const [name, schema, data, bad] of [
  ["versions", schemas.descriptionVersionsResponseSchema, fixtures.versions, { hasMore: "false" }],
  ["cycle", schemas.taskCycleResponseSchema, fixtures.cycle, { nextCursor: "1" }],
  ["board", schemas.boardDetailResponseSchema, fixtures.board, { tasks: null }],
]) {
  test(`${name}: real disposable-build response parses without losing fields`, () => {
    assert.deepEqual(schema.parse(data), data);
    assert.equal(schema.safeParse(Array.isArray(data) ? bad : { ...data, ...bad }).success, false);
    const expanded = Array.isArray(data) ? data.map((row) => ({ ...row, future: true })) : { ...data, future: true };
    assert.deepEqual(schema.parse(expanded), expanded);
  });
}

test("nested malformed fields and wrong nullability are rejected", () => {
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const versions = copy(fixtures.versions);
  assert.ok(versions.versions.length);
  versions.versions[0].actor.type = "robot";
  assert.equal(schemas.descriptionVersionsResponseSchema.safeParse(versions).success, false);
  const cycle = copy(fixtures.cycle);
  assert.ok(cycle.cycles.length);
  cycle.cycles[0].startDate = null;
  assert.equal(schemas.taskCycleResponseSchema.safeParse(cycle).success, false);
  cycle.cycles[0].startDate = new Date();
  assert.equal(schemas.taskCycleResponseSchema.safeParse(cycle).success, false);
  const board = copy(fixtures.board);
  const parent = board.tasks.find((task) => task.subTasks.length);
  assert.ok(parent);
  parent.subTasks[0].title = 42;
  assert.equal(schemas.boardDetailResponseSchema.safeParse(board).success, false);
});

test("descriptors expose inputs, method/path, success and actual error shapes", () => {
  assert.equal(client.descriptionVersionsRoute.method, "GET");
  assert.equal(client.descriptionVersionsRoute.path({ taskId: 12 }), "/api/tasks/12/description-versions");
  assert.deepEqual(client.descriptionVersionsRoute.pathParams.parse({ taskId: 12 }), { taskId: 12 });
  assert.equal(client.taskCycleRoute.query.safeParse({ taskId: "12" }).success, false);
  assert.equal(client.taskCycleRoute.query.safeParse({ taskId: 12, cursor: 0 }).success, false);
  assert.equal(client.taskCycleRoute.body.safeParse({}).success, false);
  assert.equal(client.boardDetailRoute.method, "POST");
  assert.equal(client.boardDetailRoute.validate, "deferred");
  assert.equal(client.descriptionVersionsRoute.validate, undefined);
  assert.equal(client.taskCycleRoute.validate, undefined);
  assert.equal(client.boardDetailRoute.path(), "/api/projects/boardTasks");
  assert.deepEqual(client.boardDetailRoute.body.parse({ projectId: 1, userId: 985 }), { projectId: 1, userId: 985 });
  for (const [name, route] of [["versions", client.descriptionVersionsRoute], ["cycle", client.taskCycleRoute], ["board", client.boardDetailRoute]]) {
    assert.ok(route.success);
    const error = fixtures.errors[name];
    assert.deepEqual(route.errors[error.status].parse(error.body), error.body);
    assert.equal(route.errors[401].safeParse({ error: 1 }).success, false);
  }
  assert.deepEqual(client.boardDetailRoute.errors[403].parse(fixtures.errors.boardDenied.body), fixtures.errors.boardDenied.body);
});

for (const [name, method, path, data, invoke] of [
  ["versions", "get", `/api/tasks/${fixtures.taskId}/description-versions`, fixtures.versions, (signal) => client.getDescriptionVersions(fixtures.taskId, signal)],
  ["board", "post", "/api/projects/boardTasks", fixtures.board, (signal) => client.getBoardDetail({ projectId: fixtures.projectId, userId: 985 }, signal)],
]) {
  test(`${name}: preserves bare Axios transport, signal, rejection and drift data`, async (t) => {
    const signal = new AbortController().signal;
    const seen = [];
    const checks = [];
    const previousWindow = global.window;
    global.window = { requestIdleCallback: (check) => { checks.push(check); } };
    t.after(() => { if (previousWindow === undefined) delete global.window; else global.window = previousWindow; });
    t.mock.method(axios.defaults, "adapter", async (config) => {
      seen.push(config);
      return { data: JSON.stringify(data), status: 200, statusText: "OK", headers: {}, config };
    });
    assert.deepEqual((await invoke(signal)).data, data);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, method);
    assert.equal(seen[0].url, path);
    assert.equal(seen[0].signal, signal);
    assert.equal(seen[0].headers.get("X-Hypertask-Client"), "htpr-6925");
    assert.equal(seen[0].baseURL, undefined);
    assert.equal(seen[0].timeout, 0);
    if (method === "post") assert.deepEqual(JSON.parse(seen[0].data), { projectId: fixtures.projectId, userId: 985 });
    const error = new axios.AxiosError("denied", "ERR_BAD_REQUEST", {}, null, { status: 403, data: { error: "denied" } });
    t.mock.method(axios.defaults, "adapter", async () => { throw error; });
    await assert.rejects(invoke(signal), (caught) => caught === error);
    const canceled = new axios.CanceledError();
    t.mock.method(axios.defaults, "adapter", async () => { throw canceled; });
    await assert.rejects(invoke(signal), (caught) => caught === canceled && axios.isCancel(caught));
    const warnings = [];
    t.mock.method(console, "warn", (...args) => warnings.push(args));
    const drift = { future: true };
    t.mock.method(axios.defaults, "adapter", async (config) => ({ data: drift, status: 200, headers: {}, config }));
    assert.equal((await invoke(signal)).data, drift);
    assert.equal(warnings.length, name === "board" ? 0 : 1);
    checks.forEach((check) => check());
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0][0], `Typed API contract mismatch: ${name === "board" ? "getBoardDetail" : "getDescriptionVersions"}`);
  });
}

test("cycle keeps native fetch, paging/query encoding, HTTP and AbortError semantics", async (t) => {
  const signal = new AbortController().signal;
  const calls = [];
  t.mock.method(global, "fetch", async (...args) => { calls.push(args); return Response.json(fixtures.cycle); });
  assert.deepEqual(await client.getTaskCycle({ taskId: fixtures.taskId, query: "Cycle 2", cursor: 3 }, signal), fixtures.cycle);
  assert.deepEqual(calls, [[`/api/tasks/cycle?taskId=${fixtures.taskId}&query=Cycle+2&cursor=3`, { signal, headers: { "X-Hypertask-Client": "htpr-6925" } }]]);
  t.mock.method(global, "fetch", async () => Response.json({ error: "denied" }, { status: 403 }));
  await assert.rejects(client.getTaskCycle({ taskId: fixtures.taskId }), /Unable to load cycles/);
  const aborted = new DOMException("aborted", "AbortError");
  t.mock.method(global, "fetch", async () => { throw aborted; });
  await assert.rejects(client.getTaskCycle({ taskId: fixtures.taskId }), (caught) => caught === aborted);
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  t.mock.method(global, "fetch", async () => Response.json({ future: true }));
  assert.deepEqual(await client.getTaskCycle({ taskId: fixtures.taskId }), { future: true });
  assert.equal(warnings.length, 1);
});

for (const scheduler of ["idle", "timer"]) {
  for (const valid of [true, false]) {
    test(`board returns raw ${valid ? "valid" : "drift"} data before ${scheduler} validation and warns only later`, async (t) => {
      const data = valid ? structuredClone(fixtures.board) : { future: true };
      const previousWindow = global.window;
      const scheduled = [];
      global.window = scheduler === "idle" ? {
        requestIdleCallback(check, options) { scheduled.push({ check, options }); return 1; },
        setTimeout() { assert.fail("Idle-capable browsers must not use timers"); },
      } : { setTimeout(check, delay) { scheduled.push({ check, delay }); return 1; } };
      t.after(() => { if (previousWindow === undefined) delete global.window; else global.window = previousWindow; });
      const schema = client.boardDetailRoute.success;
      const safeParse = schema.safeParse.bind(schema);
      let parsed = 0;
      t.mock.method(schema, "safeParse", (answer) => { parsed++; assert.equal(answer, data); return safeParse(answer); });
      const warnings = [];
      t.mock.method(console, "warn", (...args) => warnings.push(args));
      t.mock.method(axios.defaults, "adapter", async (config) => ({ data, status: 200, headers: {}, config }));
      const response = await client.getBoardDetail({ projectId: fixtures.projectId, userId: 985 });
      assert.equal(response.data, data);
      assert.equal(parsed, 0);
      assert.deepEqual(warnings, []);
      assert.equal(scheduled.length, 1);
      if (scheduler === "idle") assert.deepEqual(scheduled[0].options, { timeout: 1000 });
      else assert.equal(scheduled[0].delay, 0);
      scheduled[0].check();
      assert.equal(parsed, 1);
      assert.equal(response.data, data);
      assert.equal(warnings.length, valid ? 0 : 1);
      if (!valid) {
        assert.equal(warnings[0][0], "Typed API contract mismatch: getBoardDetail");
        assert.deepEqual(warnings[0][1], safeParse(data).error.issues);
      }
    });
  }
}

test("board diagnostics do not run or schedule in a non-browser", async (t) => {
  assert.equal(typeof window, "undefined");
  const data = { future: true };
  t.mock.method(client.boardDetailRoute.success, "safeParse", () => assert.fail("Server must not validate deferred diagnostics"));
  t.mock.method(global, "setTimeout", () => assert.fail("Server must not schedule browser diagnostics"));
  t.mock.method(console, "warn", () => assert.fail("Server must not warn on deferred diagnostics"));
  t.mock.method(axios.defaults, "adapter", async (config) => ({ data, status: 200, headers: {}, config }));
  assert.equal((await client.getBoardDetail({ projectId: fixtures.projectId, userId: 985 })).data, data);
});

test("board HTTP rejection and cancellation never schedule deferred validation", async (t) => {
  const previousWindow = global.window;
  global.window = {
    requestIdleCallback() { assert.fail("Rejected reads must not schedule"); },
    setTimeout() { assert.fail("Rejected reads must not schedule"); },
  };
  t.after(() => { if (previousWindow === undefined) delete global.window; else global.window = previousWindow; });
  t.mock.method(client.boardDetailRoute.success, "safeParse", () => assert.fail("Rejected reads must not validate"));
  for (const error of [new axios.AxiosError("denied"), new axios.CanceledError()]) {
    t.mock.method(axios.defaults, "adapter", async () => { throw error; });
    await assert.rejects(client.getBoardDetail({ projectId: fixtures.projectId, userId: 985 }), (caught) => caught === error);
  }
});
