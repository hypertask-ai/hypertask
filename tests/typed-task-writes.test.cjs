const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const axios = require("axios");
const { load } = require("./task-route-loader.cjs");
const fixtures = require("./fixtures/typed-task-writes.json");
const root = path.resolve(__dirname, "..");
const key = "htpr-6975-typed-writes";
const schemas = load("src/lib/api/contracts/taskWrites.ts", {});
const wrappedAxios = load("src/utils/axiosClient.ts", {}).default;
const client = load("src/lib/api/typedClient.ts", { "@/utils/axiosClient": { default: wrappedAxios } });
const operations = [
  ["setTaskPriority", "taskPriorityRoute", "priority"],
  ["setTaskEstimate", "taskEstimateRoute", "estimate"],
  ["assignTaskUser", "taskAssigneeRoute", "assignee"],
  ["assignTaskLabel", "taskLabelRoute", "label"],
  ["setTaskDueDate", "taskDueDateRoute", "dueDate"],
  ["setTaskStartDate", "taskStartDateRoute", "startDate"],
  ["setTaskWaitingOn", "taskWaitingOnRoute", "waitingOn"],
];
const originalAdapter = axios.defaults.adapter;
const originalWrappedAdapter = wrappedAxios.instance.defaults.adapter;
test.beforeEach(() => { axios.defaults.adapter = wrappedAxios.instance.defaults.adapter = async () => assert.fail("No live HTTP allowed"); });
test.afterEach(() => { axios.defaults.adapter = originalAdapter; wrappedAxios.instance.defaults.adapter = originalWrappedAdapter; });

for (const [name, descriptor, fixtureName] of [...operations, ["moveTask", "moveTaskRoute", "move"]]) {
  test(`${name}: real local wire fixtures, descriptor and negative controls`, () => {
    const route = client[descriptor];
    for (const fixture of fixtures[fixtureName]) {
      assert.deepEqual(route.body.parse(fixture.body), fixture.body);
      const schema = fixture.status === 200 ? route.success : route.errors[fixture.status];
      assert.deepEqual(schema.parse(fixture.data), fixture.data);
    }
    const good = fixtures[fixtureName].find((fixture) => fixture.status === 200);
    assert.ok(good);
    assert.equal(route.body.safeParse({ ...good.body, taskId: "wrong" }).success, false);
    assert.equal(route.success.safeParse({ broken: true }).success, false);
    assert.equal(route.errors[401].safeParse({ message: 123 }).success, false);
    assert.equal(route.query.safeParse({}).success, false);
    assert.equal(route.pathParams.safeParse({}).success, false);
    assert.equal(route.path(), good.path);
    assert.equal(route.method, fixtureName === "move" ? "PUT" : "POST");
  });
}

test("nested types, nullable dates, people and agents are validated without dropping future fields", () => {
  const clone = (value) => structuredClone(value);
  const data = clone(fixtures.assignee.find((fixture) => fixture.data.body?.length).data);
  data.body[0].userId = "wrong";
  assert.equal(schemas.assigneeResponseSchema.safeParse(data).success, false);
  const labels = clone(fixtures.label.find((fixture) => fixture.data.length).data);
  labels[0].label.value = 42;
  assert.equal(schemas.labelResponseSchema.safeParse(labels).success, false);
  const task = clone(fixtures.dueDate[0].data);
  task.dueDate = new Date();
  assert.equal(schemas.taskPropertyResponseSchema.safeParse(task).success, false);
  const waiting = clone(fixtures.waitingOn[0].data);
  waiting.waitingOnUserId = "985";
  assert.equal(schemas.waitingOnResponseSchema.safeParse(waiting).success, false);
  const priority = { ...fixtures.priority[0].data, future: { retained: true } };
  assert.deepEqual(schemas.priorityResponseSchema.parse(priority), priority);
});

for (const [name, descriptor, fixtureName] of operations) {
  test(`${name}: original Axios transport, one request, header, raw drift and rejection`, async (t) => {
    const fixture = fixtures[fixtureName][0];
    const requests = [], checks = [], warnings = [];
    const previousWindow = global.window;
    global.window = { requestIdleCallback: (callback) => checks.push(callback) };
    t.after(() => { if (previousWindow === undefined) delete global.window; else global.window = previousWindow; });
    t.mock.method(console, "warn", (...args) => warnings.push(args));
    let data = fixture.data, failure;
    const adapter = async (config) => {
      requests.push(config);
      if (failure) throw failure;
      return { data: JSON.stringify(data), status: 200, statusText: "OK", headers: {}, config };
    };
    t.mock.method(axios.defaults, "adapter", adapter);
    t.mock.method(wrappedAxios.instance.defaults, "adapter", adapter);
    const result = await client[name](fixture.body);
    assert.deepEqual(result.data, data);
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.method, "post");
    assert.equal(request.headers.get("X-Hypertask-Client"), "htpr-6925");
    assert.deepEqual(JSON.parse(request.data), fixture.body);
    assert.equal(request.baseURL, name === "assignTaskLabel" ? "/api" : undefined);
    assert.equal(request.timeout, name === "assignTaskLabel" ? 30000 : 0);
    assert.equal(request.url, name === "assignTaskLabel" ? fixture.path.slice(4) : fixture.path);
    for (const check of checks.splice(0)) check();
    assert.equal(warnings.length, 0);
    data = { schemaDrift: true };
    assert.deepEqual((await client[name](fixture.body)).data, data);
    for (const check of checks.splice(0)) check();
    assert.equal(warnings.length, 1);
    failure = new axios.AxiosError("denied", "ERR_BAD_REQUEST", {}, null, { status: 403, data: { message: "Forbidden" } });
    await assert.rejects(client[name](fixture.body), (error) => error === failure);
    assert.equal(requests.length, 3, "never retry a write");
  });
}

test("native move retains fetch status and JSON semantics with deferred diagnostics", async (t) => {
  const fixture = fixtures.move[0];
  const calls = [], checks = [], warnings = [];
  let response = Response.json(fixture.data);
  t.mock.method(global, "fetch", async (...args) => { calls.push(args); return response; });
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const previous = global.window;
  global.window = { requestIdleCallback: (check) => checks.push(check) };
  t.after(() => { if (previous === undefined) delete global.window; else global.window = previous; });
  assert.equal(await client.moveTask(fixture.body), response);
  assert.deepEqual(calls, [[fixture.path, { method: "PUT", headers: { "Content-Type": "application/json", "X-Hypertask-Client": "htpr-6925" }, body: JSON.stringify(fixture.body) }]]);
  assert.deepEqual(await client.readMoveTaskResponse(response), fixture.data);
  assert.equal(checks.length, 1); checks.shift()(); assert.equal(warnings.length, 0);
  response = Response.json({ message: "Forbidden" }, { status: 403 });
  assert.equal((await client.moveTask(fixture.body)).status, 403);
  assert.deepEqual(await response.json(), { message: "Forbidden" });
  assert.equal(checks.length, 0);
});

function hookMocks(flag, calls, data = { body: [] }) {
  const write = async (transport, ...args) => { calls.push([transport, ...args]); return { data }; };
  return {
    react: { useCallback: (fn) => fn },
    "@/hooks/useFlag": { useFlag: (requested) => { assert.equal(requested, key); return flag; } },
    "@/lib/flags/keys": { HTPR_6975_TYPED_WRITES_FLAG: key },
    "@/lib/api/typedClient": Object.fromEntries(operations.map(([name]) => [name, (...args) => write(name, ...args)])),
    axios: { default: { post: (...args) => write("legacy", ...args) } },
    "@/lib/state": { useRecoilValue: () => ({ taskId: 12 }) },
    "@tanstack/react-query": { useQueryClient: () => ({ refetchQueries: (...args) => calls.push(["refetch", ...args]) }) },
    "@/hooks/MultiPages/useGetPriorityForTask": { useGetPriorityForTask: () => ({ data: { priority_index: 1 } }) },
    "@/hooks/MultiPages/useGetEstimateForTask": { useGetEstimateForTask: () => ({ data: { estimate_index: 1 } }) },
    "@/store": {}, "@/lib/constants": { default: { CommentsTQPrefixKey: "comments" } },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
  };
}
for (const flag of [false, undefined, true]) {
  for (const [property, fn, route, selection] of [
    ["Priority", "setTaskPriority", "/api/priority/setPriority", { priority_index: 2, Priority_Value: "High" }],
    ["Estimate", "setTaskEstimate", "/api/estimate/setEstimate", { estimate_index: 2, estimate_value: "M" }],
  ]) {
    test(`${property} adoption ${flag}: same callback/refetches and single selected write`, async () => {
      const calls = [], mocks = hookMocks(flag, calls);
      const api = load(`src/hooks/MultiPages/Tasks/use${property}Modal.ts`, mocks);
      const result = api[`use${property}Modal`]("Task", (...args) => calls.push(["close", ...args]));
      await result.EnterOnClickHandler(selection);
      const body = { taskId: 12, ...selection };
      assert.deepEqual(calls[0], flag ? [fn, body] : ["legacy", route, body]);
      assert.equal(calls.filter((call) => call[0] === "refetch").length, property === "Priority" ? 2 : 1);
      assert.deepEqual(calls.at(-1), ["close", true]);
    });
  }
  test(`assignee adoption ${flag}: intent, people, agents, cache updates and rejection`, async () => {
    const calls = [], mocks = hookMocks(flag, calls, { body: [{ id: 1 }] });
    const api = load("src/hooks/Task Detail/useAssignTaskUser.ts", mocks);
    const write = api.useAssignTaskUser();
    for (const user of [{ id: 985 }, { id: "agent-id", userId: 985 }]) {
      calls.length = 0;
      assert.deepEqual(await write(user, 12, "unassign"), [{ id: 1 }]);
      const body = { userId: 985, taskId: 12, agentId: typeof user.id === "string" ? user.id : undefined, intent: "unassign" };
      assert.deepEqual(calls[0], flag ? ["assignTaskUser", body] : ["legacy", "/api/assignees/assign", body]);
      assert.equal(calls.length, 3);
    }
  });
  test(`dates adoption ${flag}: legacy helper error swallowing, clear and Date serialization preserved`, async () => {
    const calls = [], mocks = hookMocks(flag, calls);
    mocks["@/utils/axiosClient"] = {};
    mocks["@/utils/helperFunctions/helperFunctions"] = {};
    mocks["@/hooks/General/useGetUserPreferences"] = {};
    mocks["@/utils/api/global/apiHelpers/getTaskDetailMeta"] = {};
    mocks["@/lib/storage/uploadViaApi"] = {};
    // Other imports are harmless dependency stubs; tests call only the existing date helpers.
    const api = load("src/utils/api/Task Detail/index.ts", mocks);
    for (const [helper, name, property, route] of [["setDueDateApiHandler", "setTaskDueDate", "dueDate", "/api/tasks/setDueDate"], ["setStartDateApiHandler", "setTaskStartDate", "startDate", "/api/tasks/setStartDate"]]) {
      for (const date of [new Date("2026-10-08T09:00:00Z"), undefined]) {
        calls.length = 0;
        const body = { taskId: 12, [property]: property === "startDate" ? date ?? null : date };
        await api[helper](date, 12, flag ? mocks["@/lib/api/typedClient"][name] : undefined);
        assert.deepEqual(calls, [flag ? [name, body] : ["legacy", route, body]]);
        assert.equal(await api[helper](date, 12, async () => { throw new Error("failure"); }), undefined);
      }
    }
  });
  test(`move adoption ${flag}: optimistic task/board first, same rollback and settling on rejection`, async (t) => {
    const calls = [], originalTask = { id: 12, sectionId: 1, section: "Todo" };
    const originalProjects = { updatedProjects: [] };
    const cache = new Map([[JSON.stringify(["task-", 12]), originalTask], [JSON.stringify(["projectsAll"]), originalProjects]]);
    let mutation;
    const queryClient = {
      getQueryData: (key) => cache.get(JSON.stringify(key)),
      setQueryData: (key, value) => { const k = JSON.stringify(key); cache.set(k, typeof value === "function" ? value(cache.get(k)) : value); },
      cancelQueries: async (...args) => calls.push(["cancel", ...args]),
      invalidateQueries: async (...args) => calls.push(["invalidate", ...args]),
    };
    const error = new Error("Unable to move task");
    t.mock.method(global, "fetch", async (...args) => { calls.push(["fetch", ...args]); return Response.json({ message: error.message }, { status: 403 }); });
    const api = load("src/hooks/MultiPages/useMoveTaskToSection.ts", {
      ...hookMocks(flag, calls),
      "@tanstack/react-query": { useQueryClient: () => queryClient, useMutation: (config) => { mutation = config; return config; } },
      "@/hooks/MultiPages/useUpdateTaskInBoards": { default: () => ({ moveItem: async (...args) => calls.push(["optimistic-board", ...args]) }) },
      "@/lib/api/typedClient": { moveTask: async (...args) => { calls.push(["typed", ...args]); return Response.json({ message: error.message }, { status: 403 }); }, readMoveTaskResponse: async () => assert.fail("Do not validate failed writes") },
      "react-hot-toast": { default: Object.assign(() => {}, { error: (...args) => calls.push(["toast-error", ...args]) }) },
    });
    api.default();
    const input = { projectId: 15, taskId: 12, sourceSectionId: 1, destinationSectionId: 2, destinationSectionTitle: "Doing" };
    const context = await mutation.onMutate(input);
    assert.equal(cache.get(JSON.stringify(["task-", 12])).section, "Doing");
    assert.ok(calls.some((call) => call[0] === "optimistic-board"));
    assert.ok(!calls.some((call) => ["typed", "fetch"].includes(call[0])), "no request before optimistic update");
    await assert.rejects(mutation.mutationFn(input), error);
    assert.equal(calls.filter((call) => ["typed", "fetch"].includes(call[0])).length, 1);
    assert.equal(calls.find((call) => ["typed", "fetch"].includes(call[0]))[0], flag ? "typed" : "fetch");
    mutation.onError(error, input, context);
    assert.equal(cache.get(JSON.stringify(["task-", 12])), originalTask);
    assert.equal(cache.get(JSON.stringify(["projectsAll"])), originalProjects);
    await mutation.onSettled(undefined, error, input, context);
    assert.equal(calls.filter((call) => call[0] === "invalidate").length, 2);
  });
}

function declaration(file, name, env) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(tree) === name) found ??= node;
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(found, `${file}: ${name}`);
  const text = ts.isFunctionDeclaration(found) ? found.getText(tree) : `const ${found.getText(tree)};`;
  const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(env), `${compiled}\nreturn ${name};`)(...Object.values(env));
}
for (const flag of [false, undefined, true]) {
  test(`label adoption ${flag}: optimistic toggle before one write, rollback on error`, async () => {
    const calls = [], original = [{ id: "label-1", check: false }];
    let rows = original, failure = false;
    const write = async (...args) => { calls.push(["write", ...args]); assert.equal(rows[0].check, true); if (failure) throw new Error("denied"); return { data: [] }; };
    const fn = declaration("src/components/Modals/CreateLabel/CreateLabel.tsx", "toggleLabelAssignment", {
      useCallback: (fn) => fn, isLoading: false, setIsLoading: (value) => calls.push(["loading", value]),
      mode: "Task", handleToggle() {}, inViewObject: { taskId: 12 }, onBulkLabel: undefined, taskIds: undefined, refetch() {},
      updateLabelOptimistically: (label, check) => { rows = [{ ...label, check }]; calls.push(["optimistic"]); },
      revertOptimisticUpdate: () => { rows = original; calls.push(["rollback"]); },
      typedWrite: flag ? (...args) => write("typed", ...args) : undefined,
      axiosClient: { post: (...args) => write("legacy", ...args) },
      closeHandler: (...args) => calls.push(["close", ...args]), setLabel() {},
      console: { error() {} },
    });
    await fn(original[0]);
    assert.ok(calls.findIndex((call) => call[0] === "optimistic") < calls.findIndex((call) => call[0] === "write"));
    assert.deepEqual(calls.find((call) => call[0] === "write"), flag ? ["write", "typed", { taskId: 12, labelId: "label-1" }] : ["write", "legacy", "/labels/assignLabel", { taskId: 12, labelId: "label-1" }]);
    assert.equal(rows[0].check, true);
    failure = true; calls.length = 0; await fn(original[0]);
    assert.equal(rows, original);
    assert.ok(calls.some((call) => call[0] === "rollback"));
    assert.deepEqual(calls.at(-1), ["loading", false]);
  });
  test(`waiting-on adoption ${flag}: set and clear, same callbacks and errors`, async () => {
    const calls = []; let failure = false;
    const data = { id: 12, waitingOnUserId: null, waitingOnSetById: null, waitingOnSetAt: null };
    const write = async (...args) => { calls.push(["write", ...args]); if (failure) throw new Error("denied"); return { data }; };
    const fn = declaration("src/components/Modals/BlockedByPerson/BlockedByPerson.tsx", "selectUser", {
      saving: false, setSaving: (value) => calls.push(["saving", value]), taskId: 12,
      typedWrite: flag ? (...args) => write("typed", ...args) : undefined,
      axios: { post: (...args) => write("legacy", ...args) },
      queryClient: { invalidateQueries: async (...args) => calls.push(["invalidate", ...args]) },
      onClose: (...args) => calls.push(["close", ...args]), toast: { error: (...args) => calls.push(["error", ...args]) },
    });
    for (const user of [{ id: 985 }, { id: 0 }]) {
      calls.length = 0; await fn(user);
      const body = { taskId: 12, userId: user.id || null };
      assert.deepEqual(calls[1], flag ? ["write", "typed", body] : ["write", "legacy", "/api/tasks/waiting-on", body]);
      assert.ok(calls.some((call) => call[0] === "close" && call[1] === data));
      assert.equal(calls.filter((call) => call[0] === "invalidate").length, 2);
    }
    failure = true; calls.length = 0; await fn({ id: 985 });
    assert.ok(!calls.some((call) => call[0] === "close"));
    assert.deepEqual(calls.at(-1), ["saving", false]);
  });
  test(`start-date leaf adoption ${flag}: selected reader and failed writes don't close`, async () => {
    const calls = []; let result = { id: 12 };
    const typed = async () => {};
    const fn = declaration("src/components/Modals/StartDate/index.tsx", "enterHandler", {
      filteredOptions: [{ date: "2026-10-08T09:00:00Z" }, { date: undefined }],
      mode: "Update", inViewObject: { taskId: 12 }, typedWrite: flag ? typed : undefined,
      setStartDateApiHandler: async (...args) => { calls.push(["write", ...args]); return result; },
      toast: { error: (...args) => calls.push(["error", ...args]) },
      setTimeout: (fn) => fn(), closeHandler: (...args) => calls.push(["close", ...args]),
    });
    await fn(0); assert.equal(calls[0][3], flag ? typed : undefined);
    assert.deepEqual(calls.at(-1), ["close", new Date("2026-10-08T09:00:00Z")]);
    calls.length = 0; await fn(1); assert.deepEqual(calls.at(-1), ["close", null, true]);
    calls.length = 0; result = undefined; await fn(0); assert.ok(!calls.some((call) => call[0] === "close"));
  });
}

for (const flag of [false, undefined, true]) {
  test(`due-date leaf adoption ${flag}: natural and custom picker pass the same selected reader`, async () => {
    const calls = [], typed = async () => {}, selected = { display: "Tomorrow", date: new Date("2026-10-08T09:00:00Z") };
    const env = {
      filteredOptions: [selected], mode: "Update", inViewObject: { taskId: 12 }, typedWrite: flag ? typed : undefined,
      setDueDateApiHandler: async (...args) => { calls.push(["write", ...args]); return { id: 12 }; },
      publishDueDateSaved: (...args) => calls.push(["published", ...args]),
      setLastUsedDueDate: (...args) => calls.push(["last-used", ...args]),
      setTimeout: (fn) => fn(), closebackHandler: (...args) => calls.push(["close", ...args]),
      date: new Date(selected.date), defaultHour: 9, defaultMinutes: 0, toast() {},
    };
    declaration("src/components/Modals/DueDate/index.tsx", "enterHandler", env)(0);
    await new Promise(setImmediate);
    assert.equal(calls[0][3], flag ? typed : undefined);
    assert.ok(calls.some((call) => call[0] === "close" && call[1] === selected));
    calls.length = 0;
    declaration("src/components/Modals/DueDate/index.tsx", "onClickHandler", env)();
    await new Promise(setImmediate);
    assert.equal(calls[0][3], flag ? typed : undefined);
    assert.ok(calls.some((call) => call[0] === "published" && call[1] === 12));
  });
}

test("every adopter evaluates the ticket flag and uses its selected transport", () => {
  for (const file of [
    "src/hooks/MultiPages/Tasks/usePriorityModal.ts", "src/hooks/MultiPages/Tasks/useEstimateModal.ts",
    "src/hooks/Task Detail/useAssignTaskUser.ts", "src/hooks/MultiPages/useMoveTaskToSection.ts",
    "src/components/Modals/CreateLabel/CreateLabel.tsx", "src/components/Modals/BlockedByPerson/BlockedByPerson.tsx",
    "src/components/Modals/StartDate/index.tsx", "src/components/Modals/DueDate/index.tsx",
    "src/components/Modals/commands/moveToColumn.tsx", "src/app/detail/[...slug]/useTaskDetailNavigationActions.tsx",
  ]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /useFlag\(HTPR_6975_TYPED_WRITES_FLAG\)/, file);
    assert.match(source, /typedClient\s*\?|if \(typedClient\)/, file);
  }
});
