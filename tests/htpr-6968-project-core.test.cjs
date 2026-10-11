const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const http = require("node:http");
const { apiResolver } = require("next/dist/server/api-utils/node/api-resolver");
const { load } = require("./task-route-loader.cjs");
const { projectCoreRoutes, projectCoreLegacySources } = require("./htpr-6923-verify.cjs");
const clean = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const sources = projectCoreLegacySources();
const endpoints = {
  create: { controller: "create", body: { title: "Board", teamId: "team", googleAccountId: "calendar", ticketPrefix: "TEST", userId: 6 } },
  update: { controller: "update", body: { projectId: 15, title: " Board ", sorting_mode: "Manual", uniqueIdentifier: "TEST", userId: 6 } },
  archive: { controller: "archiveProject", body: { projectId: 15, userId: 6 } },
  delete: { controller: "delete", body: { projectId: 15, userId: 6 } },
  leave: { controller: "leave", body: { projectId: 15, userId: 6 } },
  removeMember: { controller: "removeMember", body: { projectId: 15, userId: 42 } },
  setMemberRole: { controller: "setMemberRole", body: { projectId: 15, targetUserId: 42, role: "Admin", userId: 6 } },
  boardTasks: { controller: "getBoardTasks", body: { projectId: "15tail", userId: 6 } },
  getAll: { controller: "getAll", body: { projectId: 15, userId: 6 } },
  getAllMinimal: { controller: "getAllMinimal", query: { mode: "ExtraMinimal", userId: "6" } },
  getArchived: { controller: "getArchived" },
  getFavorites: { controller: "getAllMinimal" },
  getFirst: { controller: "getFirst" },
  lastActivity: { controller: "lastActivity" },
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
function fixture(name, scenario = {}, mode = false, controllerFactory) {
  const effects = [], flags = [], loads = [], auth = [];
  const userId = scenario.userId ?? 985;
  const session = scenario.noAuth ? null : { userId, source: scenario.source ?? "better-auth" };
  const signed = scenario.noAuth || scenario.unsigned ? null : { id: scenario.signedUserId ?? userId };
  const actor = { id: userId, displayName: "QA" };
  const record = (label, value, fail) => async (...args) => {
    effects.push([label, ...structuredClone(args)]);
    if (fail) throw new Error(label + " unavailable");
    return value;
  };
  const mocks = {
    "@/lib/telemetry/activationOccurrences": { recordActivationOccurrence: () => {} },
    "@/lib/auth/getSessionUser": { getSessionUser: async headers => {
      auth.push(headers.get("cookie"));
      if (scenario.authThrows) throw new Error("Auth unavailable");
      return session;
    } },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: token => {
      if (scenario.signedThrows) throw new Error("Signed session unavailable");
      return token === "synthetic-signed" ? signed : null;
    } },
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: record("actor", actor, scenario.actorThrows) },
    "@/lib/flags/keys": { HTPR_6923_APP_ROUTER_WRITES_FLAG: "htpr-6923-app-router-writes" },
    "@/lib/flags": { isFeatureEnabled: async (key, id) => {
      flags.push([key, id]);
      if (mode === "outage") throw new Error("Flag unavailable");
      return mode === true;
    } },
  };
  const controller = `@/utils/controllers/projects/${endpoints[name].controller}`;
  mocks[controller] = { default: controllerFactory ? controllerFactory(effects) : record("controller", scenario.result ?? { status: 200, json: { id: 15, tasks: [{ id: 42, description: "Complete body" }], owner: actor, members: [{ userId: 42, role: "Member" }] } }, scenario.operationThrows) };
  const { module, method } = projectCoreRoutes[name];
  const web = load(`src/lib/api/project-writes/${module}.ts`, mocks)[method];
  mocks[`@/lib/api/project-writes/${module}`] = { get [method]() {
    loads.push(module);
    if (scenario.loadThrows) throw new Error("Route load unavailable");
    return web;
  } };
  return { legacy: compileOriginal(sources[name], mocks), current: load(`src/pages/api/projects/${name}.ts`, mocks).default, web, effects, flags, loads, auth };
}
function input(name, scenario = {}) {
  return {
    method: scenario.method ?? projectCoreRoutes[name].method,
    body: Object.hasOwn(scenario, "body") ? scenario.body : endpoints[name].body,
    query: scenario.query ?? endpoints[name].query ?? {},
    headers: { cookie: "ht_session=synthetic-signed; nookies_user=spoofed" },
    cookies: Object.hasOwn(scenario, "cookies") ? scenario.cookies : { ht_session: "synthetic-signed", nookies_user: '{"id":6}' },
  };
}
async function quiet(fn) {
  const saved = Object.fromEntries(["log", "error", "time", "timeEnd"].map(key => [key, console[key]]));
  for (const key of Object.keys(saved)) console[key] = () => {};
  const now = Date.now;
  Date.now = () => 1791331200000;
  try { return await fn(); } finally { Date.now = now; Object.assign(console, saved); }
}
async function invoke(fx, name, scenario, target) {
  return quiet(async () => {
    const req = input(name, scenario), headers = {};
    let result;
    try {
      if (target === "web") {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(req.query)) for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
        // GET uses a real bodyless Web Request, not a synthetic successful json().
        const request = req.method === "GET" ? new Request(`https://example.invalid/api/projects/${name}?${params}`, { headers: req.headers }) : { headers: new Headers(req.headers), json: async () => req.body };
        if (scenario.webQuery) request.query = req.query;
        if (scenario.cookies) request.cookies = scenario.cookies;
        const response = await fx.web(request);
        response.headers.forEach((value, key) => { if (key !== "content-type") headers[key] = value; });
        result = { status: response.status, body: await response.json(), headers };
      } else {
        const res = {
          setHeader: (key, value) => { headers[key.toLowerCase()] = value; },
          status: status => ({ json: value => { result = { status, body: clean(value), headers }; return result; } }),
        };
        await fx[target](req, res);
      }
    } catch (error) { result = { throws: String(error) }; }
    return result;
  });
}
const cases = [
  ["complete success", {}], ["controller validation", { result: { status: 400, json: { message: "Missing required information" } } }],
  ["permission denial", { result: { status: 403, json: { message: "No access to this board" } } }],
  ["controller exceptional status", { result: { status: 401, json: { message: "Only Board owner can change member roles." } } }],
  ["unauthenticated", { noAuth: true }], ["auth before invalid body", { noAuth: true, body: null }],
  ["missing fields", { body: {} }], ["null body", { body: null }], ["absent body", { body: undefined }],
  ["primitive body unchanged", { body: "not-an-object" }], ["controller throws", { operationThrows: true }],
  ["different signed identity", { userId: 2343 }], ["auth resolver throws", { authThrows: true }],
];
for (const name of Object.keys(endpoints)) {
  const extra = projectCoreRoutes[name].signed ? [
    ["Better Auth alone remains unauthorized", { unsigned: true }],
    ["signed actor wins over stale Better Auth", { signedUserId: 2343 }],
    ["signed verification throws", { signedThrows: true }],
    ["Pages cookies override conflicting header", { cookies: {}, webQuery: true }],
  ] : [];
  if (name === "update") extra.push(["actor load throws outside catch", { actorThrows: true }]);
  if (name === "getAllMinimal") extra.push(
    ["Calendar query", { query: { mode: "Calendar" } }],
    ["query array preserved", { query: { mode: ["ExtraMinimal", "Calendar"] } }],
    ["singleton/empty Pages array preserved", { query: { mode: [] }, webQuery: true }],
    ["unknown mode unchanged", { query: { mode: "unknown" } }],
  );
  for (const [label, scenario] of [...cases, ...extra]) test(`${name}: ${label} matches original, Off, outage, On and Web`, async () => {
    const old = fixture(name, scenario), expected = await invoke(old, name, scenario, "legacy");
    for (const mode of [false, "outage", true, "web"]) {
      // Direct signed-cookie handlers intentionally don't consult Better Auth.
      if (mode === "web" && scenario.authThrows && projectCoreRoutes[name].signed) continue;
      const fx = fixture(name, scenario, mode);
      assert.deepEqual(await invoke(fx, name, scenario, mode === "web" ? "web" : "current"), expected, `${label}: ${mode}`);
      assert.deepEqual(fx.effects, old.effects, `${label}: ${mode} effects`);
      assert.equal(fx.loads.length, mode === true && !scenario.noAuth && !scenario.authThrows ? 1 : 0);
      if (fx.flags.length) assert.deepEqual(fx.flags, [["htpr-6923-app-router-writes", scenario.userId ?? 985]]);
    }
  });
  test(`${name}: unsupported methods bypass preflight`, async () => {
    const scenario = { method: "PATCH" }, old = fixture(name, scenario), current = fixture(name, scenario, true);
    assert.deepEqual(await invoke(current, name, scenario, "current"), await invoke(old, name, scenario, "legacy"));
    assert.deepEqual(current.flags, []); assert.deepEqual(current.loads, []); assert.deepEqual(current.auth, []);
  });
  test(`${name}: load failure never retries legacy`, async () => {
    const scenario = { loadThrows: true }, fx = fixture(name, scenario, true);
    assert.deepEqual(await invoke(fx, name, scenario, "current"), { throws: "Error: Route load unavailable" });
    assert.deepEqual(fx.effects, []); assert.equal(fx.loads.length, 1);
  });
}

function policyController(name, role, effects, options = {}) {
  const userId = 985, ownerId = role === "Owner" ? userId : 99;
  const members = role === "Non-member" ? [] : [{ id: 1, userId, role, status: "Accepted", agentId: null }];
  const board = { id: 15, ownerId, teamId: "team", status: "Normal", members, tasks: [] };
  const record = (label, value) => async (...args) => { effects.push([label, ...structuredClone(args)]); return value; };
  const access = load("src/utils/controllers/projects/getAllIncludes.ts", {
    "@/lib/agents/publicAgent": {}, "@/lib/cycles": {}, "@/lib/agents/visibility": {},
    "@/utils/controllers/notifications/visibleInboxScope": {},
  });
  function matches(row, where) {
    if (row == null) return false;
    return Object.entries(where).every(([key, expected]) => {
      if (key === "OR") return expected.some(branch => matches(row, branch));
      if (key === "AND") return (Array.isArray(expected) ? expected : [expected]).every(branch => matches(row, branch));
      if (expected && typeof expected === "object") {
        if ("not" in expected) return row[key] !== expected.not;
        if ("some" in expected) return (row[key] ?? []).some(item => matches(item, expected.some));
        return matches(row[key], expected);
      }
      return row[key] === expected;
    });
  }
  const prisma = {
    project: {
      findUnique: record("board", board),
      findFirst: async args => { effects.push(["board-scope", structuredClone(args)]); return matches(board, args.where) ? board : null; },
      update: record("write-board", board),
    },
    user: { findUnique: record("user", { id: 42 }) },
    member: {
      findFirst: record("member", options.noMember ? null : { id: 2, userId: 42 }),
      findMany: record("agents", []), deleteMany: record("write-members", { count: 0 }),
      delete: async args => {
        effects.push(["write-member", structuredClone(args)]);
        if (!args.where.id) throw new Error("Missing member id");
        return { id: args.where.id };
      },
      update: record("write-role", { id: 2, userId: 42, role: "Admin" }),
    },
    notification: { updateMany: record("write-notifications", { count: 2 }) },
    favorites: { deleteMany: record("write-favorites", { count: 1 }) },
    task: { updateMany: record("write-tasks", { count: 2 }), findMany: record("tasks", [{ id: 42, title: "Task" }]) },
  };
  const mocks = {
    "@/lib/telemetry/activationOccurrences": { recordActivationOccurrence: () => {} },
    "@/lib/prisma": { default: prisma }, "@/lib/subscription": { stripe: {} },
    "./getFirst": { default: record("first-board", { status: 200, json: { id: 16 } }) },
    "./getAllIncludes": { ...access, getProjectIncludeWithoutTasks: () => ({}), getProjectViewInclude: () => ({}), getBoardTaskInclude: () => ({}) },
    "@/lib/flags": { isFeatureEnabled: async () => false },
    "@/lib/projectPrefix": {}, "@vercel/functions": { waitUntil: () => {} },
    "../turbopuffer/turbopufferHelper": {},
    "@/lib/ai/teamBillingSnapshotSelect": { teamBillingSnapshotSelect: {} },
    "@/utils/helperFunctions/Views/BoardFilterSanitizer": { sanitizeProjectBoardFilters: value => value },
    "@/utils/controllers/tasks/attachWaitingOnUsers": { attachWaitingOnUsers: async value => value },
    "@/utils/controllers/tasks/attachOpenBlockingTasks": { attachOpenBlockingTasks: async value => value },
  };
  mocks["./isProjectAdmin"] = load("src/utils/controllers/projects/isProjectAdmin.ts", mocks);
  return load(`src/utils/controllers/projects/${endpoints[name].controller}.ts`, mocks).default;
}
for (const name of ["archive", "delete", "removeMember", "setMemberRole", "update", "boardTasks"]) {
  for (const role of ["Owner", "Admin", "Member", "Non-member"]) test(`${name}: real controller preserves ${role} policy and effects`, async () => {
    const scenario = name === "update" ? { body: { projectId: 15, title: " Board " } } : {};
    const factory = effects => policyController(name, role, effects);
    const old = fixture(name, scenario, false, factory), expected = await invoke(old, name, scenario, "legacy");
    const allowed = name === "setMemberRole" ? role === "Owner" : ["update", "boardTasks"].includes(name) ? role !== "Non-member" : ["Owner", "Admin"].includes(role);
    assert.equal(expected.status, allowed ? 200 : ["update", "boardTasks"].includes(name) ? 403 : 401);
    assert.equal(old.effects.some(([label]) => label.startsWith("write-")), allowed && name !== "boardTasks");
    if (name === "boardTasks") assert.equal(old.effects.some(([label]) => label === "tasks"), allowed);
    for (const mode of [false, "outage", true, "web"]) {
      const fx = fixture(name, scenario, mode, factory);
      assert.deepEqual(await invoke(fx, name, scenario, mode === "web" ? "web" : "current"), expected);
      assert.deepEqual(fx.effects, old.effects);
    }
  });
}
for (const noMember of [false, true]) test(`leave: real controller retains self-removal and missing-member error (${noMember})`, async () => {
  const factory = effects => policyController("leave", "Member", effects, { noMember });
  const old = fixture("leave", {}, false, factory), expected = await invoke(old, "leave", {}, "legacy");
  assert.equal(expected.status, noMember ? 400 : 200);
  assert.deepEqual(old.effects.find(([label]) => label === "member")[1].where, { userId: 985, projectId: 15, agentId: null });
  for (const mode of [false, "outage", true, "web"]) {
    const fx = fixture("leave", {}, mode, factory);
    assert.deepEqual(await invoke(fx, "leave", {}, mode === "web" ? "web" : "current"), expected);
    assert.deepEqual(fx.effects, old.effects);
  }
});

function createController(effects, quota = false) {
  const board = { id: 15, owner: { displayName: "QA" }, team: { title: "Team" }, title: "Board", uniqueIdentifier: "TEST", tasks: [] };
  const record = (label, value) => async (...args) => { effects.push([label, ...structuredClone(args)]); return value; };
  const tx = { $executeRaw: record("lock", undefined), project: { findFirst: record("prefix-clash", null), create: record("write-board", board) } };
  const mocks = {
    "@/lib/telemetry/activationOccurrences": { recordActivationOccurrence: () => {} },
    "@/lib/prisma": { default: {
      user: { findUnique: record("user", { id: 985 }) },
      $transaction: async fn => fn(tx), project: { update: record("write-name", board) },
      project_View: { upsert: record("default-view", { default_view_id: "default" }) },
    } },
    "../logs/createLog": { default: record("log", undefined) },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/projectPrefix": { normalizeProjectPrefix: value => value },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
    "@/utils/helperFunctions/Views/FilterHelperFunctions": {},
    "./boardQuota": { isBoardLimitReached: async () => quota, FREE_BOARD_LIMIT_MESSAGE: "Board quota reached" },
  };
  return load("src/utils/controllers/projects/create.ts", mocks).default;
}
for (const [name, label, scenario, status, factory] of [
  ["create", "success", {}, 200, effects => createController(effects)],
  ["create", "missing title", { body: { teamId: "team", googleAccountId: "calendar" } }, 400, effects => createController(effects)],
  ["create", "quota denial", {}, 403, effects => createController(effects, true)],
  ["update", "numeric string id remains invalid", { body: { projectId: "15", title: "Board" } }, 400],
  ["update", "empty title", { body: { projectId: 15, title: " " } }, 400],
  ["archive", "missing id", { body: {} }, 400],
  ["delete", "missing id", { body: {} }, 400],
  ["leave", "missing id", { body: {} }, 400],
  ["setMemberRole", "invalid role", { body: { projectId: 15, targetUserId: 42, role: "Owner" } }, 400],
  ["setMemberRole", "missing target", { body: { projectId: 15, role: "Admin" } }, 400],
  ["setMemberRole", "cannot change own role", { body: { projectId: 15, targetUserId: 985, role: "Admin" } }, 400],
  ["removeMember", "cannot remove owner", { body: { projectId: 15, userId: 985 } }, 400],
  ["boardTasks", "invalid id", { body: { projectId: "invalid" } }, 400],
]) test(`${name}: real controller ${label} matches every path`, async () => {
  const controllerFactory = factory ?? (effects => policyController(name, "Owner", effects));
  const old = fixture(name, scenario, false, controllerFactory), expected = await invoke(old, name, scenario, "legacy");
  assert.equal(expected.status, status);
  if (status !== 200) assert.equal(old.effects.some(([label]) => label.startsWith("write-")), false);
  for (const mode of [false, "outage", true, "web"]) {
    const fx = fixture(name, scenario, mode, controllerFactory);
    assert.deepEqual(await invoke(fx, name, scenario, mode === "web" ? "web" : "current"), expected);
    assert.deepEqual(fx.effects, old.effects);
  }
});

for (const name of Object.keys(endpoints).filter(name => projectCoreRoutes[name].method === "POST")) test(`${name}: direct Web handler accepts a real JSON Request`, async () => quiet(async () => {
  const old = fixture(name), expected = await invoke(old, name, {}, "legacy"), fx = fixture(name);
  const request = new Request(`https://example.invalid/api/projects/${name}`, { method: "POST", headers: input(name).headers, body: JSON.stringify(endpoints[name].body) });
  const response = await fx.web(request);
  assert.deepEqual({ status: response.status, body: await response.json(), headers: {} }, expected);
  assert.deepEqual(fx.effects, old.effects);
}));

async function httpInvoke(handler, name) {
  const req = input(name), payload = req.body === undefined ? undefined : JSON.stringify(req.body);
  const server = http.createServer((request, response) => {
    response.sendDate = false;
    void apiResolver(request, response, req.query, { default: handler }, { dev: false }, false);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    return await new Promise((resolve, reject) => {
      const request = http.request({ host: "127.0.0.1", port: server.address().port, path: `/api/projects/${name}`, method: req.method, headers: { ...req.headers, "content-type": "application/json", connection: "close" } }, response => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { text += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, text, headers: response.headers }));
        response.on("error", reject);
      });
      request.on("error", reject); request.end(payload);
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
}
for (const name of Object.keys(endpoints)) test(`${name}: actual Pages resolver preserves HTTP bytes and headers`, async () => quiet(async () => {
  const old = fixture(name), expected = await httpInvoke(old.legacy, name);
  for (const mode of [false, "outage", true]) {
    const fx = fixture(name, {}, mode);
    assert.deepEqual(await httpInvoke(fx.current, name), expected);
    assert.deepEqual(fx.effects, old.effects);
  }
}));
