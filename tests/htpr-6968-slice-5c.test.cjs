const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const http = require("node:http");
const { apiResolver } = require("next/dist/server/api-utils/node/api-resolver");
const { load } = require("./task-route-loader.cjs");
const { graph, getProjectWhere, projectRow, relationFields, visibility } = require("./legacy-task-relations-fixture.cjs");
const { slice5c } = require("./htpr-6923-verify.cjs");
const original = require("./fixtures/htpr-6968-slice-5c/getAll.json");
const legacyContract = require("./legacy-task-relations-contract.json");
const writeFlag = "htpr-6923-app-router-writes", compatFlag = "htpr-6924-rest-compat";
const modes = [false, "outage", true];
const savedEnv = Object.fromEntries(["SESSION_SECRET", "BETTER_AUTH_ENABLED", "AUTH_LEGACY_FAST_PATH"].map(name => [name, process.env[name]]));
process.env.SESSION_SECRET = "isolated-slice-5c-test-secret";
process.env.BETTER_AUTH_ENABLED = "1";
process.env.AUTH_LEGACY_FAST_PATH = "0";
test.after(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
const { signSession } = load("src/lib/auth/session.ts", {});
const clean = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function compileOriginal(mocks) {
  const compiled = ts.transpileModule(original, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(specifier => {
    assert.ok(Object.hasOwn(mocks, specifier), `Unexpected original dependency: ${specifier}`);
    const mock = mocks[specifier];
    return Object.hasOwn(mock, "default") ? { __esModule: true, ...mock } : mock;
  }, mod, mod.exports);
  return mod.exports.default;
}
function fixture(scenario = {}, writeMode = false, compatMode = false) {
  const effects = [], flags = [], auth = [], loads = [], inbox = [], realtime = [];
  const userId = scenario.userId ?? 7;
  const token = Object.hasOwn(scenario, "token") ? scenario.token : signSession({ id: userId });
  const headers = {
    cookie: `${token ? `ht_session=${token}; ` : ""}nookies_user=${encodeURIComponent('{"id":6}')}`,
    "x-user-id": "6", "x-socket-id": "123.456",
  };
  const record = (label, calls) => (...args) => { calls.push(clean(args)); effects.push([label, ...clean(args)]); };
  const mocks = {
    "@/lib/auth/betterAuth": { auth: { api: { getSession: async () => scenario.betterAuthId === undefined ? null : { user: { id: String(scenario.betterAuthId) } } } } },
    "@/lib/flags/keys": { HTPR_6923_APP_ROUTER_WRITES_FLAG: writeFlag },
    "@/lib/flags": { HTPR_6924_REST_COMPAT_FLAG: compatFlag, isFeatureEnabled: async (key, id) => {
      flags.push([key, id]);
      assert.ok([writeFlag, compatFlag].includes(key));
      const mode = key === writeFlag ? writeMode : compatMode;
      if (mode === "outage") throw new Error("Flag unavailable");
      return mode;
    } },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere },
    "@/lib/agents/visibility": visibility,
    "@/lib/prisma": { default: {
      task: { findMany: async args => {
        effects.push(["tasks", clean(args)]);
        if (scenario.queryThrows) throw new Error("Query unavailable");
        return scenario.denied || scenario.empty ? [] : graph().map(row => projectRow("Task", row, args));
      } },
      notification: { findMany: record("inbox-read", inbox), updateMany: record("inbox-write", inbox) },
    } },
    "@/lib/realtime/server": { broadcastInboxChange: record("inbox-realtime", realtime), broadcastProjectChange: record("project-realtime", realtime) },
  };
  const resolver = load("src/lib/auth/getSessionUser.ts", mocks).getSessionUser;
  mocks["@/lib/auth/getSessionUser"] = { getSessionUser: async requestHeaders => {
    auth.push(requestHeaders.get("cookie"));
    if (scenario.authThrows) throw new Error("Auth unavailable");
    return resolver(requestHeaders);
  } };
  mocks["@/lib/auth/currentUser"] = load("src/lib/auth/currentUser.ts", mocks);
  const controller = load("src/utils/controllers/tasks/getAll.ts", mocks).default;
  mocks["@/utils/controllers/tasks/getAll"] = { default: async (...args) => {
    effects.push(["controller", ...clean(args)]);
    if (scenario.controllerThrows) throw new Error("Controller unavailable");
    if (scenario.result) return scenario.result;
    return controller(...args);
  } };
  const web = load("src/lib/api/task-writes/getAll.ts", mocks).POST;
  mocks["@/lib/api/task-writes/getAll"] = { get POST() {
    loads.push("POST");
    if (scenario.loadThrows) throw new Error("Route load unavailable");
    return web;
  } };
  return { legacy: compileOriginal(mocks), current: load("src/pages/api/tasks/getAll.ts", mocks).default, web, effects, flags, auth, loads, inbox, realtime, headers };
}
function input(fx, scenario = {}) {
  return {
    method: Object.hasOwn(scenario, "method") ? scenario.method : "POST",
    body: Object.hasOwn(scenario, "body") ? scenario.body : { projectId: 15, userId: 6, contract: "compact", compact: true },
    query: scenario.query ?? { compat: "htpr-6924", userId: "6" },
    headers: fx.headers, cookies: { nookies_user: '{"id":6}' },
  };
}
async function quiet(fn) {
  const saved = { log: console.log, error: console.error };
  console.log = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
}
async function invoke(fx, scenario = {}, target = "current") {
  return quiet(async () => {
    const req = input(fx, scenario), headers = {};
    let result;
    try {
      if (target === "web") {
        const url = new URL("https://example.invalid/api/tasks/getAll");
        for (const [key, value] of Object.entries(req.query)) for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item);
        const request = scenario.realWeb
          ? new Request(url, { method: "POST", headers: { ...req.headers, "content-type": "application/json" }, body: scenario.malformed ? "{" : JSON.stringify(req.body) })
          : { headers: new Headers(req.headers), query: req.query, json: async () => { if (scenario.jsonThrows) throw new Error("JSON unavailable"); return req.body; } };
        const response = await fx.web(request);
        response.headers.forEach((value, name) => { if (name !== "content-type") headers[name] = value; });
        result = { status: response.status, body: await response.json(), headers };
      } else {
        await fx[target](req, {
          setHeader: (name, value) => { headers[name.toLowerCase()] = value; },
          status: status => ({ json: value => { result = { status, body: clean(value), headers }; return result; } }),
        });
      }
    } catch (error) { result = { throws: String(error) }; }
    return result;
  });
}
async function httpInvoke(fx, scenario = {}, target = "current") {
  return quiet(async () => {
    const { query, body, method, headers } = input(fx, scenario);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const server = http.createServer((req, res) => {
      res.sendDate = false;
      void apiResolver(req, res, query, { default: fx[target] }, { dev: false }, false);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      return await new Promise((resolve, reject) => {
        const request = http.request({ host: "127.0.0.1", port: server.address().port, path: "/api/tasks/getAll", method,
          headers: { ...headers, "content-type": "application/json", "content-length": Buffer.byteLength(payload ?? ""), connection: "close" },
        }, response => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", chunk => { text += chunk; });
          response.on("end", () => resolve({ status: response.statusCode, text, headers: response.headers }));
          response.on("error", reject);
        });
        request.on("error", reject); request.end(payload);
      });
    } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
}
function assertEffects(fx, old) {
  assert.deepEqual(fx.effects, old.effects, "ordered controller/storage/inbox/realtime effects");
  assert.deepEqual(fx.inbox, old.inbox);
  assert.deepEqual(fx.realtime, old.realtime);
  assert.deepEqual(fx.inbox, [], "reader never writes/reads inbox separately");
  assert.deepEqual(fx.realtime, [], "reader never broadcasts");
}
async function parity(scenario, compatMode) {
  const old = fixture(scenario, false, compatMode), expected = await invoke(old, scenario, "legacy");
  for (const writeMode of [...modes, "web"]) {
    const fx = fixture(scenario, writeMode === "web" ? false : writeMode, compatMode);
    assert.deepEqual(await invoke(fx, scenario, writeMode === "web" ? "web" : "current"), expected, `write flag ${writeMode}`);
    assertEffects(fx, old);
    const authenticated = !scenario.authThrows && !(scenario.token === null && scenario.betterAuthId === undefined);
    assert.equal(fx.loads.length, writeMode === true && authenticated ? 1 : 0);
    const compactProbes = fx.flags.filter(([key]) => key === compatFlag);
    assert.deepEqual(compactProbes, old.flags);
    const writeProbes = fx.flags.filter(([key]) => key === writeFlag);
    assert.deepEqual(writeProbes, writeMode !== "web" && authenticated ? [[writeFlag, scenario.userId ?? (scenario.token === null ? scenario.betterAuthId : 7)]] : []);
    assert.equal(fx.auth.length, writeMode === "web" || writeMode === true && authenticated ? 1 : 2, "reuse signed session only after dispatch");
  }
  return expected;
}

test("slice-5c independent legacy bytes, unchanged controller/helpers and Pages URL ownership", slice5c);
const queries = [
  ["absent", {}], ["exact scalar", { compat: "htpr-6924" }], ["wrong scalar", { compat: "other" }],
  ["empty scalar", { compat: "" }], ["singleton array", { compat: ["htpr-6924"] }],
  ["duplicate array", { compat: ["htpr-6924", "htpr-6924"] }], ["empty array", { compat: [] }],
];
for (const compatMode of modes) for (const [label, query] of queries) {
  test(`compat flag ${compatMode}, ${label}: original/Off/outage/On/Web independent matrix and full/compact shapes`, async () => {
    const result = await parity({ query }, compatMode);
    assert.equal(result.status, 200);
    const compact = compatMode === true && query.compat === "htpr-6924";
    if (!compact) assert.equal(JSON.stringify(result.body), legacyContract.text);
    else {
      const rows = result.body;
      for (const child of rows[0].subTasks) assert.deepEqual(Object.keys(child), [...relationFields, "createdAt"]);
      assert.deepEqual(Object.keys(rows[0].parentTask), [...relationFields, "subTasks"]);
      for (const child of rows[0].parentTask.subTasks) assert.deepEqual(Object.keys(child), relationFields);
      assert.deepEqual(rows[0].subTasks.map(row => row.id), [52, 53]);
      assert.deepEqual(rows[0].parentTask.subTasks.map(row => row.id), [55, 50, 51]);
      assert.equal(rows[1].parentTask, null);
      const legacy = JSON.parse(legacyContract.text);
      for (const [index, { subTasks, parentTask, ...top }] of rows.entries()) {
        const { subTasks: oldChildren, parentTask: oldParent, ...oldTop } = legacy[index];
        assert.deepEqual(top, oldTop);
      }
    }
  });
  test(`compat flag ${compatMode}, ${label}: real Pages HTTP bytes/status/headers and ordered effects for every write flag`, async () => {
    const scenario = { query }, old = fixture(scenario, false, compatMode);
    const expected = await httpInvoke(old, scenario, "legacy");
    assert.equal(expected.status, 200);
    assert.match(expected.headers["content-type"], /application\/json/);
    assert.equal(Number(expected.headers["content-length"]), Buffer.byteLength(expected.text));
    assert.ok(expected.headers.etag);
    for (const writeMode of modes) {
      const fx = fixture(scenario, writeMode, compatMode);
      assert.deepEqual(await httpInvoke(fx, scenario), expected);
      assertEffects(fx, old);
    }
  });
}
const cases = [
  ["missing project", { body: {} }], ["zero project", { body: { projectId: 0 } }],
  ["null body", { body: null }], ["undefined body", { body: undefined }], ["primitive body", { body: "15" }], ["array body", { body: [] }],
  ...["bad", "0", "-1", "1.5", "15tail", [15]].map(projectId => [`invalid project ${JSON.stringify(projectId)}`, { body: { projectId } }]),
  ["string project", { body: { projectId: "15" } }], ["empty board", { empty: true }], ["denied board", { denied: true }],
  ["query throws", { queryThrows: true }], ["controller throws", { controllerThrows: true }],
  ["controller error status", { result: { status: 403, json: { message: "Forbidden" } } }],
  ["unsigned", { token: null }], ["auth before null body", { token: null, body: null }], ["auth throws outside catch", { authThrows: true }],
  ["different signed identity", { userId: 2343 }], ["stale Better Auth identity", { betterAuthId: 6 }],
  ["Better Auth only", { token: null, betterAuthId: 7 }],
];
for (const compatMode of modes) for (const [label, scenario] of cases) {
  test(`${label}, compat flag ${compatMode}: original/Off/outage/On/Web`, () => parity(scenario, compatMode));
  test(`${label}, compat flag ${compatMode}: real Pages HTTP error/auth contract for all write modes`, async () => {
    const old = fixture(scenario, false, compatMode), expected = await httpInvoke(old, scenario, "legacy");
    for (const writeMode of modes) {
      const fx = fixture(scenario, writeMode, compatMode);
      assert.deepEqual(await httpInvoke(fx, scenario), expected);
      assertEffects(fx, old);
    }
  });
}
for (const token of ["forged", signSession({ id: 7 }, -1)]) for (const compatMode of modes) for (const writeMode of modes) {
  test(`invalid signed token, flags ${writeMode}/${compatMode}: spoofed profile/body/query/header cannot authenticate`, async () => {
    const fx = fixture({ token }, writeMode, compatMode);
    assert.deepEqual(await invoke(fx, { token }), { status: 401, body: { message: "Unauthorized" }, headers: {} });
    assert.deepEqual(fx.flags, []); assert.deepEqual(fx.effects, []); assert.deepEqual(fx.loads, []);
  });
}
for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "CUSTOM", undefined]) for (const writeMode of modes) for (const compatMode of modes) {
  test(`other method ${method}, flags ${writeMode}/${compatMode}: no auth, flag, controller or route load`, async () => {
    const scenario = { method, authThrows: true }, old = fixture(scenario, false, compatMode), fx = fixture(scenario, writeMode, compatMode);
    assert.deepEqual(await invoke(fx, scenario), await invoke(old, scenario, "legacy"));
    assert.deepEqual(fx.auth, []); assert.deepEqual(fx.flags, []); assert.deepEqual(fx.loads, []); assert.deepEqual(fx.effects, []);
  });
}
test("independent expectations: signed user controls both flags and controller scope, without duplicate auth or fan-out", async () => {
  const scenario = { userId: 2343 }, fx = fixture(scenario, true, true);
  await invoke(fx, scenario);
  assert.deepEqual(fx.flags, [[writeFlag, 2343], [compatFlag, 2343]]);
  assert.deepEqual(fx.effects[0], ["controller", 15, 2343, "compact"]);
  assert.deepEqual(fx.effects[1][1].where.project, getProjectWhere(2343));
  assert.equal(fx.effects[1][1].select.comments.select.notifications.where.userId, 2343);
  assert.equal(fx.auth.length, 1);
  assert.deepEqual(fx.inbox, []); assert.deepEqual(fx.realtime, []);
});
test("route load failure never retries the legacy controller", async () => {
  const fx = fixture({ loadThrows: true }, true, true);
  assert.deepEqual(await invoke(fx), { throws: "Error: Route load unavailable" });
  assert.deepEqual(fx.effects, []); assert.deepEqual(fx.flags, [[writeFlag, 7]]);
  assert.equal(fx.auth.length, 1); assert.equal(fx.loads.length, 1);
});
for (const compatMode of modes) for (const [label, query] of queries.filter(([, query]) => !Array.isArray(query.compat) || query.compat.length > 1)) {
  test(`real Web URL ${label}, compat flag ${compatMode}: scalar/duplicate negotiation matches original`, async () => {
    const scenario = { realWeb: true, query }, old = fixture(scenario, false, compatMode), fx = fixture(scenario, false, compatMode);
    assert.deepEqual(await invoke(fx, scenario, "web"), await invoke(old, scenario, "legacy"));
    assertEffects(fx, old);
  });
}
for (const scenario of [{ jsonThrows: true }, { realWeb: true, malformed: true }]) test("Web JSON failure preserves empty-200 catch and auth ordering", async () => {
  const fx = fixture(scenario, false, true);
  assert.deepEqual(await invoke(fx, scenario, "web"), { status: 200, body: [], headers: {} });
  assert.equal(fx.auth.length, 1); assert.deepEqual(fx.flags, []); assert.deepEqual(fx.effects, []);
  const unauthorized = fixture({ token: null }, false, true);
  assert.equal((await invoke(unauthorized, scenario, "web")).status, 401);
});
