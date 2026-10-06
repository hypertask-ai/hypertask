const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const http = require("node:http");
const { apiResolver } = require("next/dist/server/api-utils/node/api-resolver");
const { load } = require("./task-route-loader.cjs");
const { slice5Routes, slice5LegacySources } = require("./htpr-6923-verify.cjs");
const clean = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const fullTask = {
  id: 42, projectId: 15, title: "Task", description_: { content: "<p>Retained body</p>" },
  priority: { id: 9 }, estimate: { id: 10 }, taskLabels: [{ label: { id: 11 } }],
  subTasks: [{ id: 43, projectId: 15, description: "child", ranking: "a", dueDate: "2026-10-08", createdAt: "2026-10-01" }],
  parentTask: { id: 41, description: "parent", sectionId: 3, subTasks: [{ id: 42, ranking: "b", title: "sibling" }] },
};
const endpoints = {
  read: { page: "single", method: "GET", query: { id: "42" } },
  delete: { page: "single", method: "DELETE", query: { id: "42" } },
  mark: { page: "markRead", method: "POST", body: { taskId: 42 } },
  move: { page: "move-task-to-different-board", method: "POST", body: { id: 42, projectId: 99, sectionId: 8, currentProjectId: 15 } },
};
function compileOriginal(source, mocks) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(specifier => {
    assert.ok(Object.hasOwn(mocks, specifier), `Unexpected original dependency: ${specifier}`);
    const mock = mocks[specifier];
    return Object.hasOwn(mock, "default") ? { __esModule: true, ...mock } : mock;
  }, mod, mod.exports);
  return mod.exports.default;
}
function fixture(kind, scenario, mode) {
  const effects = [], flags = [], loads = [], auth = [];
  const { page, method } = endpoints[kind];
  const session = scenario.noAuth ? null : { userId: scenario.userId ?? 985, source: scenario.source ?? "better-auth" };
  const actor = { id: session?.userId ?? 985, displayName: "QA", email: "qa@example.invalid", photoURL: "qa.png" };
  const record = (label, value, fail = false) => async (...args) => {
    effects.push([label, ...clean(args)]);
    if (fail) throw new Error(label + " unavailable");
    return value;
  };
  const mocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: async headers => {
      auth.push(headers.get("cookie"));
      if (scenario.authThrows) throw new Error("Auth unavailable");
      return session;
    } },
    "@/lib/flags/keys": { HTPR_6923_APP_ROUTER_WRITES_FLAG: "htpr-6923-app-router-writes" },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      flags.push([key, userId]);
      if (mode === "outage") throw new Error("Flag unavailable");
      return mode === true;
    } },
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: record("actor", actor, scenario.actorThrows) },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: (userId, agentId) => ({ ownerId: userId, agentId }) },
    "@/lib/prisma": { default: {
      task: { findUnique: record("task-lookup", scenario.missingTask ? null : { projectId: 15 }, scenario.lookupThrows) },
      project: { findFirst: record("access", scenario.denied ? null : { id: 15 }, scenario.accessThrows) },
    } },
    "@/utils/controllers/tasks/single": {
      getTaskSingle: record("read", scenario.result ?? { status: 200, json: fullTask }, scenario.operationThrows),
      deleteTaskSingle: record("delete", scenario.result ?? { status: 200, json: { id: 42 } }, scenario.operationThrows),
      updateTaskSingle: record("update", { status: 200, json: fullTask }),
    },
    "@/utils/controllers/tasks/markRead": { markTaskRead: record("mark", scenario.result ?? { status: 200, json: { lastReadAt: new Date("2026-10-06T12:00:00Z") } }, scenario.operationThrows) },
    "@/utils/controllers/tasks/moveToDifferentBoard": { moveTaskToDifferentBoard: record("move", scenario.moveResult ?? { success: true, task: fullTask }, scenario.operationThrows) },
    "@/lib/realtime/server": { broadcastBoardChange: (...args) => {
      effects.push(["board", ...clean(args)]);
      if (scenario.broadcastThrows) throw new Error("Broadcast unavailable");
    }, broadcastTaskChange: record("detail", undefined) },
    "@/utils/controllers/comments/extractTaskReferences": { extractTaskReferencesFromCommentText: () => [] },
    "@/utils/controllers/tasks/addRelatedTasks": { addRelatedTasks: record("relations", undefined) },
  };
  const operation = slice5Routes[page].module;
  const web = load(`src/lib/api/task-writes/${operation}.ts`, mocks)[method];
  mocks[`@/lib/api/task-writes/${operation}`] = { get [method]() {
    loads.push(operation);
    if (scenario.loadThrows) throw new Error("Route load unavailable");
    return web;
  } };
  return {
    legacy: compileOriginal(slice5LegacySources()[page], mocks),
    current: load(`src/pages/api/tasks/${page}.ts`, mocks).default,
    web, effects, flags, loads, auth,
  };
}
async function invoke(fx, kind, scenario, target, method = endpoints[kind].method) {
  const { page } = endpoints[kind];
  const body = Object.hasOwn(scenario, "body") ? scenario.body : endpoints[kind].body;
  const query = scenario.query ?? endpoints[kind].query ?? {};
  const headers = {};
  let result;
  const log = console.log, error = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    if (target === "web") {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
      const request = new Request(`https://example.invalid/api/tasks/${page}?${params}`, { method, headers: { cookie: "synthetic-session" } });
      const response = await fx.web({ url: request.url, headers: request.headers, json: async () => body });
      response.headers.forEach((value, key) => { if (key !== "content-type") headers[key] = value; });
      result = { status: response.status, body: await response.json(), headers };
    } else {
      const res = { setHeader: (key, value) => { headers[key.toLowerCase()] = value; }, status: status => ({
        json: value => { result = { status, body: clean(value), headers }; return result; },
      }) };
      await fx[target]({ method, body, query, headers: { cookie: "synthetic-session" }, cookies: { ht_session: "synthetic-session" } }, res);
    }
  } catch (error) { result = { throws: String(error) }; }
  finally { console.log = log; console.error = error; }
  return result;
}
const cases = {
  read: [
    ["full task and parent/subtask fields", {}], ["missing id", { query: {}, status: 400 }],
    ["auth before validation", { noAuth: true, query: {}, status: 401 }],
    ["permission denied", { denied: true, status: 403 }], ["access failure", { accessThrows: true, status: 500 }],
    ["query arrays retain parseInt", { query: { id: ["42", "43"] } }], ["prefix parseInt", { query: { id: "42tail" } }],
    ["invalid id is delegated", { query: { id: "invalid" } }], ["zero id is delegated", { query: { id: "0" } }],
    ["missing task returns null", { result: { status: 200, json: null } }],
    ["non-success bypasses access", { denied: true, result: { status: 500, json: { message: "Failed to load task" } }, status: 500 }],
    ["projectless task", { denied: true, result: { status: 200, json: { id: 42, projectId: null } } }],
    ["zero session id", { userId: 0, status: 401 }], ["read failure", { operationThrows: true, status: 500 }],
  ],
  delete: [
    ["success", {}], ["missing id", { query: {}, status: 400 }],
    ["validation before auth", { noAuth: true, query: {}, status: 400 }],
    ["permission denied", { denied: true, status: 403 }], ["lookup failure", { lookupThrows: true, status: 500 }],
    ["access failure", { accessThrows: true, status: 500 }], ["missing task still delegates", { missingTask: true }],
    ["query arrays retain parseInt", { query: { id: ["42", "43"] } }], ["prefix parseInt", { query: { id: "42tail" } }],
    ["invalid id is delegated", { query: { id: "invalid" } }],
    ["conflict", { result: { status: 409, json: { message: "Task is being restored or permanently deleted" } }, status: 409 }],
    ["controller error", { result: { status: 500, json: { message: "Failed to delete task" } }, status: 500 }],
    ["delete failure", { operationThrows: true, status: 500 }],
  ],
  mark: [
    ["success with Date serialization", {}], ["missing id", { body: {}, status: 400 }],
    ["auth before validation", { noAuth: true, body: {}, status: 401 }],
    ["beacon JSON", { body: '{"taskId":42,"userId":6}' }], ["beacon malformed JSON", { body: "{", status: 400 }],
    ["null body", { body: null, status: 500 }], ["missing body", { body: undefined, status: 500 }],
    ["JSON null", { body: "null", status: 500 }], ["primitive body", { body: 1, status: 400 }],
    ["invalid id", { body: { taskId: "invalid" }, status: 400 }], ["prefix parseInt", { body: { taskId: "42tail" } }],
    ["zero id", { body: { taskId: 0 } }], ["negative id", { body: { taskId: -1 } }],
    ["controller not found", { result: { status: 404, json: { message: "Task not found" } }, status: 404 }],
    ["controller failure", { operationThrows: true, status: 500 }],
    ["forged actor ignored", { body: { taskId: 42, userId: 6, currentUser: { id: 6 } } }],
    ["no board permission gate added", { denied: true }],
  ],
  move: [
    ["full task and nested subtasks", {}], ["missing fields", { body: {}, status: 400 }],
    ["auth before validation", { noAuth: true, body: {}, status: 401 }],
    ["null body", { body: null, status: 500 }], ["missing body", { body: undefined, status: 500 }],
    ["truthiness validation", { body: { ...endpoints.move.body, sectionId: 0 }, status: 400 }],
    ["accepted string IDs", { body: { id: "42", projectId: "99", sectionId: "8", currentProjectId: "15" } }],
    ["same board broadcast deduplicates", { body: { ...endpoints.move.body, projectId: 15 } }],
    ["actor failure propagates", { actorThrows: true }], ["service failure", { operationThrows: true, status: 500 }],
    ["source board denied", { moveResult: { success: false, statusCode: 403, error: "Source denied" }, status: 403 }],
    ["target board denied", { moveResult: { success: false, statusCode: 403, error: "Destination denied" }, status: 403 }],
    ["missing task", { moveResult: { success: false, statusCode: 404, error: "Task not found" }, status: 404 }],
    ["invalid destination section", { moveResult: { success: false, statusCode: 400, error: "Invalid section" }, status: 400 }],
    ["failure fallbacks", { moveResult: { success: false }, status: 500 }],
    ["nested error retains JSON", { moveResult: { success: false, statusCode: 409, error: { message: "Conflict", code: "lease" } }, status: 409 }],
    ["empty error retains JSON", { moveResult: { success: false, error: "" }, status: 500 }],
    ["broadcast failure after mutation", { broadcastThrows: true, status: 500 }],
    ["body actor ignored", { body: { ...endpoints.move.body, currentUser: { id: 6 }, userId: 6, agentId: "borrowed" } }],
  ],
};
for (const kind of Object.keys(endpoints)) {
  for (const [label, scenario] of [...cases[kind],
    ["unauthenticated", { noAuth: true, status: 401 }], ["auth resolver throws", { authThrows: true }],
    ["legacy session", { source: "legacy" }], ["different signed user", { userId: 2343 }],
  ]) test(`${kind}: ${label} matches original, Off, outage, On and Web`, async () => {
    const baseline = fixture(kind, scenario, false);
    const expected = await invoke(baseline, kind, scenario, "legacy");
    if (scenario.status) assert.equal(expected.status, scenario.status);
    for (const mode of [false, "outage", true, "web"]) {
      const fx = fixture(kind, scenario, mode);
      assert.deepEqual(await invoke(fx, kind, scenario, mode === "web" ? "web" : "current"), expected, `${label}: ${mode}`);
      assert.deepEqual(fx.effects, baseline.effects, `${label}: ${mode} effects`);
      assert.equal(fx.loads.length, mode === true && !scenario.noAuth && !scenario.authThrows ? 1 : 0);
      if (fx.flags.length) assert.deepEqual(fx.flags, [["htpr-6923-app-router-writes", scenario.userId ?? 985]]);
    }
  });
  test(`${kind}: other methods bypass preflight and preserve 405`, async () => {
    const old = fixture(kind, {}, false), current = fixture(kind, {}, true);
    assert.deepEqual(await invoke(current, kind, {}, "current", "PATCH"), await invoke(old, kind, {}, "legacy", "PATCH"));
    assert.deepEqual(current.flags, []); assert.deepEqual(current.loads, []); assert.deepEqual(current.auth, []);
  });
  test(`${kind}: loading failure never retries legacy`, async () => {
    const scenario = { loadThrows: true }, fx = fixture(kind, scenario, true);
    assert.deepEqual(await invoke(fx, kind, scenario, "current"), { throws: "Error: Route load unavailable" });
    assert.deepEqual(fx.effects, []); assert.equal(fx.loads.length, 1);
  });
}

test("single GET and DELETE use the real controller's full relation query and permanent-delete contract", async () => {
  const source = fs.readFileSync("src/utils/controllers/tasks/single.ts", "utf8");
  const parsed = ts.createSourceFile("single.ts", source, ts.ScriptTarget.Latest, true);
  const functions = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && ["getTaskSingle", "deleteTaskSingle"].includes(node.name?.text));
  assert.equal(functions.length, 2);
  const compiled = ts.transpileModule(functions.map(node => node.getText(parsed)).join("\n"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const queries = [], deletes = [], exports = {};
  let deletion = "success";
  new Function("prisma", "permanentlyDeleteTask", "exports", compiled)(
    { task: { findUnique: async query => { queries.push(query); return fullTask; } } },
    async (...args) => { deletes.push(args); return deletion; }, exports,
  );
  assert.deepEqual(await exports.getTaskSingle(42), { status: 200, json: fullTask });
  assert.deepEqual(queries, [{ where: { id: 42 }, include: {
    taskLabels: { select: { label: true, labelId: true, id: true, taskId: true } }, estimate: true, priority: true,
    description_: { select: { content: true } },
    subTasks: { where: { status: { not: "Deleted" } }, orderBy: { createdAt: "asc" } },
    parentTask: { include: { subTasks: { where: { status: { not: "Deleted" } } } } },
  } }]);
  assert.deepEqual(await exports.deleteTaskSingle(42, 985), { status: 200, json: { id: 42 } });
  deletion = "conflict";
  assert.deepEqual(await exports.deleteTaskSingle(42, 985), { status: 409, json: { message: "Task is being restored or permanently deleted" } });
  assert.deepEqual(deletes, [[42, 985], [42, 985]]);
});

async function httpInvoke(handler, kind, scenario) {
  const endpoint = endpoints[kind];
  const query = scenario.query ?? endpoint.query ?? {};
  const server = http.createServer((req, res) => {
    res.sendDate = false;
    void apiResolver(req, res, query, { default: handler }, { dev: false }, false);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    return await new Promise((resolve, reject) => {
      const request = http.request({
        host: "127.0.0.1", port: server.address().port, path: `/api/tasks/${endpoint.page}`,
        method: endpoint.method,
        headers: { cookie: "synthetic-session", "content-type": scenario.beacon ? "text/plain" : "application/json", connection: "close" },
      }, response => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { text += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, text, headers: response.headers }));
        response.on("error", reject);
      });
      request.on("error", reject);
      const body = scenario.body ?? endpoint.body;
      request.end(body === undefined ? undefined : scenario.beacon ? body : JSON.stringify(body));
    });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
for (const kind of Object.keys(endpoints)) test(`${kind}: real Pages resolver preserves exact bytes, Content-Type, Content-Length and ETag`, async () => {
  const scenarios = [{}, { noAuth: true },
    kind === "read" || kind === "delete" ? { query: {} } : { body: {} },
    ...(kind === "read" || kind === "delete" ? [{ denied: true }] : kind === "move"
      ? [{ moveResult: { success: false, statusCode: 403, error: "Forbidden" } }]
      : [{ beacon: true, body: '{"taskId":42}' }, { beacon: true, body: "{" }]),
  ];
  for (const scenario of scenarios) {
    const baseline = fixture(kind, scenario, false);
    const expected = await httpInvoke(baseline.legacy, kind, scenario);
    assert.ok(expected.headers["content-type"].includes("application/json"));
    assert.equal(Number(expected.headers["content-length"]), Buffer.byteLength(expected.text));
    for (const mode of [false, "outage", true]) {
      const fx = fixture(kind, scenario, mode);
      assert.deepEqual(await httpInvoke(fx.current, kind, scenario), expected);
      assert.deepEqual(fx.effects, baseline.effects);
    }
  }
});
