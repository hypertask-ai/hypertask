const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const http = require("node:http");
const { apiResolver } = require("next/dist/server/api-utils/node/api-resolver");
const { load } = require("./task-route-loader.cjs");
const { slice5bRoutes, slice5bLegacySources } = require("./htpr-6923-verify.cjs");
const clean = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const fullTask = {
  id: 42, projectId: 15, title: "Task", ranking: "z", description: "Full body",
  description_: { content: "<p>Retained body</p>" }, priority: { id: 9 }, estimate: { id: 10 },
  subTasks: [{ id: 43, description: "child", ranking: "a", sectionId: 3, dueDate: "2026-10-08", createdAt: "2026-10-01" }],
  parentTask: { id: 41, description: "parent", sectionId: 3, subTasks: [{ id: 42, ranking: "b", title: "sibling" }] },
};
const ranked = [
  { ...fullTask, id: 70, updatedAt: "2026-10-01", title: "Exact hit" },
  { ...fullTask, id: 11, updatedAt: "2026-10-07", title: "Recent hit" },
  { ...fullTask, id: 92, updatedAt: "2026-10-06", title: "Other hit" },
];
const followers = [
  { id: 1, userId: 985, agentId: null, user: { id: 985, displayName: "Creator" } },
  { id: 2, userId: 2343, agentId: null, user: { id: 2343, displayName: "Follower" } },
  { id: 3, userId: null, agentId: "creator-agent", agent: { id: "creator-agent" } },
];
const endpoints = {
  getArchivedTasks: { query: { projectId: "15", cursor: "42", boardScope: "all", q: " term " } },
  getArchivedTasksByProject: { query: { projectId: "15" } },
  getTask: { query: { project: "project-15", uniqueIndex: "42" } },
  getTaskMinimal: { body: { id: 42 }, method: "POST", public: true },
  getUnscheduled: { query: { searchQuery: "term" } },
  detailMeta: { query: { taskId: "42" } },
  searchAll: { body: { projectIds: [15, 99], searchQuery: "HTPR-70" } },
  searchByParam: { query: { param: "all", projectId: "15" } },
  searchOrphans: { query: { projectId: "15", currentTaskId: "42", searchQuery: "term" }, public: true },
};
const sources = slice5bLegacySources();
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
function fixture(name, scenario = {}, mode = false) {
  const effects = [], flags = [], loads = [], auth = [];
  const session = scenario.noAuth ? null : { userId: scenario.userId ?? 985, source: scenario.source ?? "better-auth" };
  const actor = { id: session?.userId ?? 985, displayName: "QA", email: "qa@example.invalid", photoURL: "qa.png" };
  const record = (label, value, fail = false) => async (...args) => {
    effects.push([label, ...structuredClone(args)]);
    if (fail) throw new Error(label + " unavailable");
    return value;
  };
  const response = scenario.result ?? { status: scenario.denied ? 403 : 200, json: scenario.denied ? [] : ranked };
  const mocks = {
    "@/lib/configs/http-status.config": load("src/lib/configs/http-status.config.ts", {}),
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
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: userId => ({ ownerId: userId }) },
    "@/lib/prisma": { default: {
      project: { findMany: record("boards", scenario.denied ? [] : [{ id: 15 }], scenario.boardsThrow) },
      task: {
        findUnique: record("minimal", scenario.missingTask ? null : fullTask, scenario.operationThrows),
        findFirst: record("task-scope", scenario.denied || scenario.missingTask ? null : { userId: scenario.creatorless ? null : 985, agentId: scenario.agentCreator ? "creator-agent" : null }, scenario.operationThrows),
        findMany: async (...args) => {
          effects.push(["unscheduled", ...structuredClone(args)]);
          if (scenario.operationThrows) throw new Error("unscheduled unavailable");
          return args[0].where.projectId.in.length ? ranked : [];
        },
      },
      priority: { findFirst: record("priority", { id: 9 }, scenario.satelliteThrows) },
      estimate: { findFirst: record("estimate", { id: 10 }) },
      taskLabel: { findMany: record("labels", [{ id: 11, label: { id: 12 } }]) },
      follower: { findMany: record("followers", followers) },
    } },
    "@/utils/controllers/tasks/getArchivedTasks": {
      default: record("archive", response, scenario.operationThrows),
      tasksGetArchivedTasksMeta: record("archive-meta", scenario.result ?? { status: 200, json: { total: 3, projectIds: [15] } }, scenario.operationThrows),
    },
    "@/utils/controllers/tasks/getArchivedTasksByProject": { default: record("archive-project", response, scenario.operationThrows) },
    "@/utils/controllers/tasks/getTask": { default: record("task", scenario.result ?? { status: scenario.denied ? 500 : 200, json: scenario.denied || scenario.missingTask ? null : fullTask }, scenario.operationThrows) },
    "@/utils/controllers/tasks/searchAll": { default: record("search", scenario.denied ? { status: 200, json: [] } : response, scenario.operationThrows) },
    "@/utils/controllers/tasks/getRecentlyWorkedTasks": { default: record("recent", response, scenario.operationThrows) },
    "@/utils/controllers/tasks/taskSearchByParam": { default: record("mentions", response, scenario.operationThrows) },
    "@/utils/controllers/tasks/getOrphanTasks": { default: record("orphans", scenario.result ?? { status: 200, json: ranked }, scenario.operationThrows) },
  };
  const { module, method } = slice5bRoutes[name];
  const web = load(`src/lib/api/task-writes/${module}.ts`, mocks)[method];
  mocks[`@/lib/api/task-writes/${module}`] = { get [method]() {
    loads.push(module);
    if (scenario.loadThrows) throw new Error("Route load unavailable");
    return web;
  } };
  return { legacy: compileOriginal(sources[name], mocks), current: load(`src/pages/api/tasks/${name}.ts`, mocks).default, web, mocks, effects, flags, loads, auth };
}
function input(name, scenario) {
  return {
    method: scenario.method ?? endpoints[name].method ?? slice5bRoutes[name].method,
    query: scenario.query ?? endpoints[name].query ?? {},
    body: Object.hasOwn(scenario, "body") ? scenario.body : endpoints[name].body,
  };
}
async function invoke(fx, name, scenario, target) {
  const { method, body, query } = input(name, scenario);
  const headers = {};
  let result;
  const log = console.log;
  console.log = () => {};
  try {
    if (target === "web") {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
      const response = await fx.web({ url: `https://example.invalid/api/tasks/${name}?${params}`, ...(scenario.webQuery ? { query } : {}), headers: new Headers({ cookie: "synthetic-session" }), json: async () => body });
      response.headers.forEach((value, key) => { if (key !== "content-type") headers[key] = value; });
      result = { status: response.status, body: await response.json(), headers };
    } else {
      const res = {
        setHeader: (key, value) => { headers[key.toLowerCase()] = value; },
        status: status => ({ json: value => { result = { status, body: clean(value), headers }; return result; } }),
      };
      await fx[target]({ method, body, query, headers: { cookie: "synthetic-session" }, cookies: {} }, res);
    }
  } catch (error) { result = { throws: String(error) }; }
  finally { console.log = log; }
  return result;
}
const cases = {
  getArchivedTasks: [
    ["full tasks", {}], ["meta", { query: { mode: "meta", projectId: "15", boardScope: "archived" } }],
    ["arrays and numeric prefixes", { query: { mode: ["meta", "ignored"], projectId: ["15tail", "99"], cursor: ["42tail", "0"], boardScope: ["all", "archived"], q: ["  first  ", "second"] } }],
    ["optional invalid numbers and scope", { query: { projectId: "invalid", cursor: "Infinity", boardScope: "invalid", q: "   " } }],
    ["negative and zero accepted", { query: { projectId: "-1", cursor: "0", boardScope: "active" } }],
    ["no query validation added", { query: {} }],
    ["Pages singleton and empty query arrays", { query: { mode: ["meta"], projectId: [], cursor: ["42"], boardScope: [], q: [] }, webQuery: true }],
    ["permission delegated", { denied: true }],
    ["controller exceptional 300", { result: { status: 300, json: { message: "Failed" } }, status: 300 }],
    ["controller throws", { operationThrows: true, status: 200 }],
  ],
  getArchivedTasksByProject: [
    ["full tasks", {}], ["missing project", { query: {}, status: 400 }], ["empty project", { query: { projectId: "" }, status: 400 }],
    ["array project passed unchanged", { query: { projectId: ["15tail", "99"] } }],
    ["invalid project delegated", { query: { projectId: "invalid" } }], ["permission delegated", { denied: true }],
    ["controller throws", { operationThrows: true, status: 400 }],
  ],
  getTask: [
    ["complete parent/subtask shape and actor", {}], ["missing slug and number", { query: {}, status: 400 }],
    ["missing number", { query: { project: "project-15" }, status: 400 }],
    ["alias and numeric prefix", { query: { project: "htpr", uniqueIndex: "42tail" } }],
    ["arrays forwarded unchanged", { query: { project: ["project-15", "other"], uniqueIndex: ["42", "43"] } }],
    ["permission delegated returns null", { denied: true, status: 500 }], ["missing task", { missingTask: true }],
    ["actor fails outside catch", { actorThrows: true }], ["controller throws", { operationThrows: true, status: 500 }],
  ],
  getTaskMinimal: [
    ["full scalar row", {}], ["missing id", { body: {}, status: 400 }], ["zero id", { body: { id: 0 }, status: 400 }],
    ["null body", { body: null, status: 500 }], ["absent body", { body: undefined, status: 500 }],
    ["string id unchanged", { body: { id: "42tail" } }], ["array id unchanged", { body: { id: [42, 43] } }],
    ["missing task", { missingTask: true }], ["no permission check added", { denied: true }],
    ["GET accepts body", { method: "GET" }], ["DELETE still reads", { method: "DELETE" }],
    ["PATCH still reads", { method: "PATCH" }], ["nonstandard method still reads", { method: "CUSTOM" }],
    ["controller throws", { operationThrows: true, status: 500 }],
  ],
  getUnscheduled: [
    ["search query", {}], ["without search", { query: {} }], ["empty search", { query: { searchQuery: "" } }],
    ["array search unchanged", { query: { searchQuery: ["first", "second"] } }],
    ["no accessible boards", { denied: true }], ["membership failure remains empty", { boardsThrow: true }],
    ["controller throws", { operationThrows: true, status: 200 }], ["zero session id", { userId: 0 }],
  ],
  detailMeta: [
    ["creator filtered", {}], ["agent creator filtered", { agentCreator: true }], ["creatorless retains followers", { creatorless: true }],
    ["missing task id", { query: {}, status: 400 }], ["invalid id", { query: { taskId: "invalid" }, status: 400 }],
    ["array parseInt", { query: { taskId: ["42tail", "43"] } }], ["zero accepted", { query: { taskId: "0" } }],
    ["negative accepted", { query: { taskId: "-1" } }], ["permission denied masks existence", { denied: true, status: 404 }],
    ["missing task", { missingTask: true, status: 404 }], ["query throws", { operationThrows: true, status: 400 }],
    ["satellite throws", { satelliteThrows: true, status: 400 }],
  ],
  searchAll: [
    ["ranking retained", {}], ["missing fields string", { body: {}, status: 200 }], ["null body", { body: null, status: 200 }],
    ["absent body", { body: undefined, status: 200 }],
    ["project normalization", { body: { projectIds: ["15", 99, 0, -1, "bad", 1.5, "15"], searchQuery: "term" } }],
    ["nonarray projects", { body: { projectIds: "15", searchQuery: "term" } }],
    ["recent mode", { body: { mode: "recent", projectIds: [15, 99], currentTaskId: "42", userId: 6 } }],
    ["recent missing fields delegated", { body: { mode: "recent" } }],
    ["permission filtering", { denied: true }], ["board lookup throws", { boardsThrow: true, status: 200 }],
    ["controller throws", { operationThrows: true, status: 200 }],
  ],
  searchByParam: [
    ["ranking retained", {}], ["missing fields", { query: {}, status: 400 }],
    ["array param and numeric prefix", { query: { param: ["term", "other"], projectId: ["15tail", "99"] } }],
    ["invalid project delegated", { query: { param: "term", projectId: "bad" } }],
    ["permission denied", { denied: true, status: 403 }], ["controller throws", { operationThrows: true, status: 500 }],
  ],
  searchOrphans: [
    ["nested status envelope and ranking", {}], ["missing fields string", { query: {}, status: 200 }],
    ["arrays and numeric prefixes", { query: { projectId: ["15tail", "99"], currentTaskId: ["42tail", "43"], searchQuery: ["term", "other"] } }],
    ["invalid numbers delegated", { query: { projectId: "bad", currentTaskId: "bad" } }],
    ["no permission gate added", { denied: true }], ["controller throws", { operationThrows: true, status: 200 }],
  ],
};
for (const name of Object.keys(endpoints)) {
  for (const [label, scenario] of [...cases[name],
    ["unauthenticated", { noAuth: true, status: endpoints[name].public ? 200 : 401 }],
    ["auth resolver throws", { authThrows: true }], ["legacy session", { source: "legacy" }],
    ["different signed user", { userId: 2343 }],
    ...(!endpoints[name].public ? [["auth before validation", { noAuth: true, query: {}, body: {}, status: 401 }]] : []),
  ]) test(`${name}: ${label} matches original, Off, outage, On and Web`, async () => {
    const old = fixture(name, scenario);
    const expected = await invoke(old, name, scenario, "legacy");
    if (scenario.status) assert.equal(expected.status, scenario.status);
    for (const mode of [false, "outage", true, "web"]) {
      const fx = fixture(name, scenario, mode);
      assert.deepEqual(await invoke(fx, name, scenario, mode === "web" ? "web" : "current"), expected, `${label}: ${mode}`);
      assert.deepEqual(fx.effects, old.effects, `${label}: ${mode} effects`);
      assert.equal(fx.loads.length, mode === true && !scenario.noAuth && !scenario.authThrows ? 1 : 0);
      if (fx.flags.length) assert.deepEqual(fx.flags, [["htpr-6923-app-router-writes", scenario.userId ?? 985]]);
    }
  });
  if (name !== "getTaskMinimal") test(`${name}: unsupported methods bypass all preflight`, async () => {
    const scenario = { method: "PATCH" }, old = fixture(name, scenario), current = fixture(name, scenario, true);
    assert.deepEqual(await invoke(current, name, scenario, "current"), await invoke(old, name, scenario, "legacy"));
    assert.deepEqual(current.flags, []); assert.deepEqual(current.loads, []); assert.deepEqual(current.auth, []);
  });
  test(`${name}: load failure never retries legacy`, async () => {
    const scenario = { loadThrows: true }, fx = fixture(name, scenario, true);
    const result = await invoke(fx, name, scenario, "current");
    assert.equal(result.throws, "Error: Route load unavailable");
    assert.deepEqual(fx.effects, []); assert.equal(fx.loads.length, 1);
  });
}

async function httpInvoke(handler, name, scenario) {
  const { query, body, method } = input(name, scenario);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const server = http.createServer((req, res) => {
    res.sendDate = false;
    void apiResolver(req, res, query, { default: handler }, { dev: false }, false);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    return await new Promise((resolve, reject) => {
      const request = http.request({ host: "127.0.0.1", port: server.address().port, path: `/api/tasks/${name}`, method,
        headers: { cookie: "synthetic-session", "content-type": "application/json", "content-length": Buffer.byteLength(payload ?? ""), connection: "close" },
      }, response => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { text += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, text, headers: response.headers }));
        response.on("error", reject);
      });
      request.on("error", reject);
      request.end(payload);
    });
  } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
for (const name of Object.keys(endpoints)) test(`${name}: real Pages resolver preserves JSON bytes, cache headers, ETag and lengths`, async () => {
  const log = console.log;
  console.log = () => {};
  try {
    for (const scenario of [{}, { noAuth: true }, { denied: true }, { query: {}, body: {} }, { operationThrows: true }]) {
      const old = fixture(name, scenario), expected = await httpInvoke(old.legacy, name, scenario);
      assert.ok(expected.headers["content-type"]?.includes("application/json"), JSON.stringify({ name, scenario, expected }));
      assert.equal(Number(expected.headers["content-length"]), Buffer.byteLength(expected.text));
      for (const mode of [false, "outage", true]) {
        const fx = fixture(name, scenario, mode);
        assert.deepEqual(await httpInvoke(fx.current, name, scenario), expected);
        assert.deepEqual(fx.effects, old.effects);
      }
    }
  } finally { console.log = log; }
});

test("archive query parsing, full actor preparation and scoped metadata filters have independent expectations", async () => {
  const archive = fixture("getArchivedTasks", {}, true);
  await invoke(archive, "getArchivedTasks", { query: { projectId: ["15tail", "99"], cursor: ["42", "43"], q: [" first ", "second"], boardScope: ["all", "archived"], mode: ["meta"] } }, "current");
  assert.deepEqual(archive.effects, [["archive", 985, 42, 15, "all", "first"]]);
  const task = fixture("getTask", {}, true);
  const result = await invoke(task, "getTask", {}, "current");
  assert.deepEqual(result.body, fullTask);
  assert.deepEqual(task.effects, [["actor", 985], ["task", "project-15", "42", { id: 985, displayName: "QA", email: "qa@example.invalid", photoURL: "qa.png" }]]);
  const meta = fixture("detailMeta", { agentCreator: true }, true);
  const detail = await invoke(meta, "detailMeta", {}, "current");
  assert.deepEqual(detail.body.followers.map(row => row.id), [1, 2]);
  assert.deepEqual(meta.effects[0], ["task-scope", { where: { id: 42, project: { ownerId: 985 } }, select: { userId: true, agentId: true } }]);
});

test("search adapters never reorder or narrow ranked fixtures, and normalize scope exactly", async () => {
  for (const name of ["searchAll", "searchByParam", "searchOrphans"]) {
    const fx = fixture(name, {}, true), result = await invoke(fx, name, {}, "current");
    const rows = name === "searchOrphans" ? result.body.json : result.body;
    assert.deepEqual(rows.map(row => row.id), [70, 11, 92]);
    assert.equal(JSON.stringify(rows), JSON.stringify(ranked));
    assert.ok(rows[0].subTasks[0].description); assert.ok(rows[0].parentTask.subTasks);
  }
  const fx = fixture("searchAll", {}, true);
  await invoke(fx, "searchAll", { body: { projectIds: ["15", 99, 0, -1, "bad", 1.5, "15"], searchQuery: "term" } }, "current");
  assert.deepEqual(fx.effects, [["boards", { where: { id: { in: [15, 99, 15] }, ownerId: 985 }, select: { id: true } }], ["search", [15], "term"]]);
});

test("real searchAll ranking keeps exact first, descending recency, stable ties and deduplication through old/new handlers", async () => {
  const row = (id, updatedAt) => ({ ...fullTask, id, updatedAt });
  const exact = [row(70, "2026-01-01")];
  const mentions = [row(11, "2026-10-07"), row(92, "2026-10-06"), row(70, "2026-01-01")];
  const matches = [row(93, "2026-10-06"), row(11, "2026-10-07"), row(99, null)];
  for (const target of ["legacy", "current", "web"]) {
    const fx = fixture("searchAll", {}, true);
    const controller = load("src/utils/controllers/tasks/searchAll.ts", {
      "@/lib/prisma": { default: { task: { findMany: async args => args.where.uniqueIndex ? exact : matches } } },
      "./taskMentionSearch": { default: async () => mentions },
    }).default;
    fx.mocks["@/utils/controllers/tasks/searchAll"] = { default: controller };
    const web = load("src/lib/api/task-writes/search-all.ts", fx.mocks).POST;
    fx.web = web;
    fx.mocks["@/lib/api/task-writes/search-all"] = { POST: web };
    fx.legacy = compileOriginal(sources.searchAll, fx.mocks);
    fx.current = load("src/pages/api/tasks/searchAll.ts", fx.mocks).default;
    const result = await invoke(fx, "searchAll", { body: { projectIds: [15], searchQuery: "70" } }, target);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.map(item => item.id), [70, 11, 92, 93, 99]);
    assert.equal(JSON.stringify(result.body), JSON.stringify([exact[0], mentions[0], mentions[1], matches[0], matches[2]]));
  }
});

test("real orphan query preserves createdAt ranking, full subtasks and the nested response envelope", async () => {
  const queries = [];
  for (const target of ["legacy", "current", "web"]) {
    const fx = fixture("searchOrphans", {}, true);
    const controller = load("src/utils/controllers/tasks/getOrphanTasks.ts", {
      "@/lib/prisma": { default: { task: { findMany: async query => { queries.push(query); return ranked; } } } },
    }).default;
    fx.mocks["@/utils/controllers/tasks/getOrphanTasks"] = { default: controller };
    fx.web = load("src/lib/api/task-writes/search-orphans.ts", fx.mocks).GET;
    fx.mocks["@/lib/api/task-writes/search-orphans"] = { GET: fx.web };
    fx.legacy = compileOriginal(sources.searchOrphans, fx.mocks);
    fx.current = load("src/pages/api/tasks/searchOrphans.ts", fx.mocks).default;
    const result = await invoke(fx, "searchOrphans", {}, target);
    assert.equal(JSON.stringify(result.body), JSON.stringify({ status: 200, json: ranked }));
    assert.deepEqual(queries.at(-1).orderBy, { createdAt: "desc" });
    assert.equal(queries.at(-1).select.subTasks, true);
  }
  assert.deepEqual(queries[0], queries[1]); assert.deepEqual(queries[0], queries[2]);
});

test("private headers survive auth and actor failures through the real Pages resolver", async () => {
  const error = console.error;
  console.error = () => {};
  try {
    for (const name of ["getTask", "detailMeta"]) {
      for (const scenario of [{ authThrows: true }, ...(name === "getTask" ? [{ actorThrows: true }] : [])]) {
        const expected = await httpInvoke(fixture(name, scenario).legacy, name, scenario);
        assert.equal(expected.status, 500);
        assert.equal(expected.headers["cache-control"], "private, no-store");
        assert.equal(expected.headers.vary, "Cookie");
        for (const mode of [false, "outage", true]) {
          assert.deepEqual(await httpInvoke(fixture(name, scenario, mode).current, name, scenario), expected);
        }
      }
    }
  } finally { console.error = error; }
});

test("unscheduled query retains membership, limits, saved content and the search/nonsearch ordering", async () => {
  for (const query of [{ searchQuery: "term" }, {}]) {
    const fx = fixture("getUnscheduled", {}, true);
    await invoke(fx, "getUnscheduled", { query }, "current");
    assert.deepEqual(fx.effects[0], ["boards", { where: { OR: [{ members: { some: { userId: 985 } } }, { ownerId: { in: [985] } }] }, select: { id: true } }]);
    const args = fx.effects[1][1];
    assert.equal(args.take, 10);
    assert.deepEqual(args.orderBy, query.searchQuery ? { createdAt: "desc" } : { updatedAt: "desc" });
    assert.deepEqual(args.include, { project: { select: { id: true, title: true } }, savedContent: { where: { userId: 985, commentId: null } } });
    assert.deepEqual(args.where.projectId, { in: [15] });
    assert.equal(args.where.deletedAt, null); assert.equal(args.where.dueDate, null);
    if (query.searchQuery) assert.deepEqual(args.where.OR, [{ title: { contains: "term", mode: "insensitive" } }, { ticketNumber: { contains: "term", mode: "insensitive" } }]);
    else assert.equal(args.where.OR, undefined);
  }
});
