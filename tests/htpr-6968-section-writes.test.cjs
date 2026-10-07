const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const http = require("node:http");
const { apiResolver } = require("next/dist/server/api-utils/node/api-resolver");
const { load } = require("./task-route-loader.cjs");
const { sectionRoutes, sectionLegacySources } = require("./htpr-6923-verify.cjs");
const sources = sectionLegacySources();
const clean = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const section = { id: 91, projectId: 15, section_title: "Column", ranking: "A0100", deleted: false, visibility: true, isDone: null };
const view = { id: 15, project_view: { default_view: { board_columns_view: [section] } } };
const endpoints = {
  create: { body: { projectId: 15, title: "Column", userId: 6 }, result: section },
  update: { body: { sectionId: 91, newSection: { ranking: "A0130", projectId: 15 }, userId: 6 }, result: section },
  rename: { body: { sectionId: 91, newSection: { section_title: "Renamed" }, userId: 6 }, result: view },
  resetRanks: { body: { taskIds: [42, 43, 44], agentId: "owned-agent", userId: 6 } },
  getAll: { body: { userId: 6 }, result: [section] },
  getByTaskId: { body: { taskId: 42 }, result: [section] },
  getProjectSections: { body: { projectId: 15, userId: 6 }, result: [section] },
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
  const session = scenario.noAuth ? null : { userId, source: "better-auth" };
  const record = (label, value, fail) => async (...args) => {
    effects.push([label, ...structuredClone(args)]);
    if (fail) throw new Error(label + " unavailable");
    return value;
  };
  const body = Object.hasOwn(scenario, "body") ? scenario.body : endpoints[name].body;
  const mocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: async headers => {
      auth.push(headers.get("cookie"));
      if (scenario.authThrows) throw new Error("Auth unavailable");
      return session;
    } },
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: record("actor", { id: scenario.actorId ?? userId }, scenario.actorThrows) },
    "@/lib/flags/keys": { HTPR_6923_APP_ROUTER_WRITES_FLAG: "htpr-6923-app-router-writes" },
    "@/lib/flags": { isFeatureEnabled: async (key, id) => {
      flags.push([key, id]);
      if (mode === "outage") throw new Error("Flag unavailable");
      return mode === true;
    } },
    "@/lib/realtime/server": { broadcastBoardChange: (...args) => {
      effects.push(["broadcast", ...structuredClone(args)]);
      if (scenario.broadcastThrows) throw new Error("Broadcast unavailable");
    } },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: (id, agentId) => {
      effects.push(["access", id, agentId]); return { ownerId: id, agentId };
    } },
    "@/lib/prisma": { default: { task: {
      findMany: record("scope", scenario.denied ? [] : [...new Set(body?.taskIds ?? [])].map((id, index) => ({ projectId: scenario.multipleBoards && index % 2 ? 16 : 15 }))),
      update: async args => {
        effects.push(["rank", structuredClone(args)]);
        if (scenario.operationThrows || args.where.id === scenario.missingTask) {
          const error = new Error("Rank unavailable"); error.code = scenario.operationThrows ? "P2000" : "P2025"; throw error;
        }
      },
    } } },
    "@/utils/controllers/projects/views/viewsHelperAPIfunctions": { default: record("view", view, scenario.viewThrows) },
  };
  const controller = record("controller", scenario.result ?? { status: 200, json: endpoints[name].result }, scenario.operationThrows);
  const controllers = {
    create: ["@/utils/controllers/section/sectionService", "createSection"],
    update: ["@/utils/controllers/section/update", "default"],
    rename: ["@/utils/controllers/section/rename", "default"],
    getAll: ["@/utils/controllers/section/getAll", "default"],
    getByTaskId: ["@/utils/controllers/section/getByTask", "default"],
    getProjectSections: ["@/utils/controllers/section/getProjectSections", "default"],
  };
  if (controllers[name]) {
    const [specifier, key] = controllers[name];
    mocks[specifier] = { [key]: controllerFactory ? controllerFactory(effects) : controller };
  }
  const { module } = sectionRoutes[name];
  const web = load(`src/lib/api/section-writes/${module}.ts`, mocks).POST;
  mocks[`@/lib/api/section-writes/${module}`] = { get POST() {
    loads.push(module);
    if (scenario.loadThrows) throw new Error("Route load unavailable");
    return web;
  } };
  return { legacy: compileOriginal(sources[name], mocks), current: load(`src/pages/api/section/${name}.ts`, mocks).default, web, effects, flags, loads, auth };
}
function input(name, scenario = {}) {
  return {
    method: scenario.method ?? "POST",
    body: Object.hasOwn(scenario, "body") ? scenario.body : endpoints[name].body,
    query: {}, headers: { cookie: 'ht_session=synthetic; nookies_user={"id":6}' },
    cookies: { ht_session: "synthetic", nookies_user: '{"id":6}' },
  };
}
async function quiet(fn) {
  const saved = { log: console.log, error: console.error };
  console.log = console.error = () => {};
  const random = Math.random;
  Math.random = () => 0.5;
  try { return await fn(); } finally { Math.random = random; Object.assign(console, saved); }
}
async function invoke(fx, name, scenario, target) {
  return quiet(async () => {
    const req = input(name, scenario), headers = {};
    let result;
    try {
      if (target === "web") {
        const request = scenario.realWeb
          ? new Request(`https://example.invalid/api/section/${name}`, { method: "POST", headers: { ...req.headers, "content-type": "application/json" }, body: JSON.stringify(req.body) })
          : { headers: new Headers(req.headers), json: async () => req.body };
        const response = await fx.web(request);
        if (!response) return undefined;
        response.headers.forEach((value, key) => { if (key !== "content-type") headers[key] = value; });
        const text = await response.text();
        result = { status: response.status, body: text ? JSON.parse(text) : undefined, headers };
      } else {
        await fx[target](req, {
          setHeader: (key, value) => { headers[key.toLowerCase()] = value; },
          status: status => ({ json: value => { result = { status, body: clean(value), headers }; return result; } }),
        });
      }
    } catch (error) { result = { throws: String(error) }; }
    return result;
  });
}
const cases = [
  ["complete success", {}], ["validation error", { result: { status: 400, json: { message: "Invalid section" } } }],
  ["permission denied", { result: { status: 403, json: { message: "Forbidden" } }, denied: true }],
  ["not found", { result: { status: 404, json: { message: "Section not found" } }, denied: true }],
  ["unauthenticated", { noAuth: true }], ["auth before invalid body", { noAuth: true, body: null }],
  ["missing fields", { body: {} }], ["null body", { body: null }], ["absent body", { body: undefined }],
  ["primitive body", { body: "unchanged" }], ["controller throws", { operationThrows: true }],
  ["signed actor ignores spoofed body/cookie", { userId: 2343 }], ["auth lookup throws", { authThrows: true }],
];
for (const name of Object.keys(endpoints)) {
  const extra = [];
  if (["create", "resetRanks"].includes(name)) extra.push(["actor load throws outside catch", { actorThrows: true }], ["loaded actor retained", { actorId: 42 }]);
  if (["update", "rename"].includes(name)) extra.push(["deleted 204 body", { result: { status: 204, json: { ...section, deleted: true } } }]);
  if (name === "update") extra.push(["broadcast board fallback", { result: { status: 200, json: {} } }], ["broadcast throws after write", { broadcastThrows: true }]);
  if (name === "create") extra.push(["view load failure after write", { viewThrows: true }], ["broadcast failure after view", { broadcastThrows: true }], ["string ID parsing", { body: { projectId: "15tail", title: "Column", after_section_id: "91tail", ranking: "A0200" } }]);
  for (const [label, scenario] of [...cases, ...extra]) test(`${name}: ${label} matches original, Off, outage, On and Web`, async () => {
    const old = fixture(name, scenario), expected = await invoke(old, name, scenario, "legacy");
    for (const mode of [false, "outage", true, "web"]) {
      const fx = fixture(name, scenario, mode);
      assert.deepEqual(await invoke(fx, name, scenario, mode === "web" ? "web" : "current"), expected, `${label}: ${mode}`);
      assert.deepEqual(fx.effects, old.effects, `${label}: ${mode} effects`);
      assert.equal(fx.loads.length, mode === true && !scenario.noAuth && !scenario.authThrows ? 1 : 0);
      if (fx.flags.length) assert.deepEqual(fx.flags, [["htpr-6923-app-router-writes", scenario.userId ?? 985]]);
    }
  });
  test(`${name}: a real Web Request preserves success`, async () => {
    const old = fixture(name), fx = fixture(name);
    assert.deepEqual(await invoke(fx, name, { realWeb: true }, "web"), await invoke(old, name, {}, "legacy"));
    assert.deepEqual(fx.effects, old.effects);
  });
  test(`${name}: unsupported methods bypass preflight`, async () => {
    const scenario = { method: "PATCH" }, old = fixture(name, scenario), fx = fixture(name, scenario, true);
    assert.deepEqual(await invoke(fx, name, scenario, "current"), await invoke(old, name, scenario, "legacy"));
    assert.deepEqual(fx.flags, []); assert.deepEqual(fx.loads, []); assert.deepEqual(fx.auth, []);
  });
  test(`${name}: route load failure never retries legacy`, async () => {
    const fx = fixture(name, { loadThrows: true }, true);
    assert.deepEqual(await invoke(fx, name, {}, "current"), { throws: "Error: Route load unavailable" });
    assert.deepEqual(fx.effects, []); assert.equal(fx.loads.length, 1);
  });
}

for (const scenario of [
  {}, { multipleBoards: true }, { missingTask: 43 }, { denied: true }, { operationThrows: true },
  { body: { taskIds: [42, 42, 43], agentId: "owned-agent" } }, { body: { taskIds: [] } },
]) test(`resetRanks: batch authorization, duplicates, A0100 +30, concurrent deletion and fan-out ${JSON.stringify(scenario)}`, async () => {
  const old = fixture("resetRanks", scenario), expected = await invoke(old, "resetRanks", scenario, "legacy");
  const ranks = old.effects.filter(([label]) => label === "rank").map(([, args]) => args);
  if (scenario.denied) {
    assert.equal(expected.status, 404); assert.deepEqual(ranks, []);
  } else if (!scenario.operationThrows) {
    assert.equal(expected.status, 200);
    const ids = scenario.body?.taskIds ?? [42, 43, 44];
    assert.deepEqual(ranks, ids.map((id, index) => ({ where: { id }, data: { ranking: `A${String(100 + 30 * index).padStart(4, "0")}` } })));
    assert.deepEqual(old.effects.filter(([label]) => label === "broadcast"), ids.length ? (scenario.multipleBoards ? [["broadcast", 15], ["broadcast", 16]] : [["broadcast", 15]]) : []);
  } else { assert.equal(expected.status, 500); assert.equal(ranks.length, 1); }
  const scope = old.effects.find(([label]) => label === "scope");
  assert.deepEqual(scope[1].where.id.in, [...new Set(scenario.body?.taskIds ?? [42, 43, 44])]);
  assert.deepEqual(old.effects.find(([label]) => label === "access"), ["access", 985, Object.hasOwn(scenario, "body") ? scenario.body.agentId : "owned-agent"]);
  for (const mode of [false, "outage", true, "web"]) {
    const fx = fixture("resetRanks", scenario, mode);
    assert.deepEqual(await invoke(fx, "resetRanks", scenario, mode === "web" ? "web" : "current"), expected);
    assert.deepEqual(fx.effects, old.effects);
  }
});

function serviceController(name, effects, options = {}) {
  const record = (label, value) => async (...args) => { effects.push([label, ...structuredClone(args)]); return value; };
  const tx = {
    section: { update: async args => { effects.push(["write-section", structuredClone(args)]); return { ...section, ...args.data }; } },
    task: { updateManyAndReturn: record("rename-tasks", [{ id: 42 }]) },
    taskSectionEvent: { createMany: async args => { effects.push(["history", args.data.map(({ timestamp, ...rest }) => rest)]); } },
  };
  const prisma = {
    project: { findUnique: record("board", { id: 15 }), findFirst: record("board-access", options.denied ? null : { id: 15 }) },
    section: {
      findFirst: async args => { effects.push(["last-or-access", structuredClone(args)]); return options.denied ? null : section; },
      findUnique: record("section", section), findMany: record("ordered-sections", [section, { ...section, id: 92, ranking: "A0200" }]),
      create: async args => { effects.push(["write-section", structuredClone(args)]); return { ...section, ...args.data }; },
    },
    $transaction: async fn => fn(tx),
  };
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: id => ({ ownerId: id }) },
    "@/utils/generateRank": load("src/utils/generateRank.ts", {}),
    "./viewHelpers": {
      appendSectionToAllViews: record("append-views"), updateSectionInAllViews: record("update-views"), removeSectionFromAllViews: record("remove-views"),
    },
    "../projects/views/viewsHelperAPIfunctions": { default: record("view", view) },
  };
  const service = load("src/utils/controllers/section/sectionService.ts", mocks);
  mocks["./sectionService"] = service;
  if (name === "create") return service.createSection;
  return load(`src/utils/controllers/section/${name}.ts`, mocks).default;
}
for (const [name, label, scenario, options] of [
  ["create", "append rank", {}, {}],
  ["create", "rank between sections", { body: { projectId: 15, title: "Column", after_section_id: 91 } }, {}],
  ["create", "explicit ranking", { body: { projectId: 15, title: "Column", ranking: "A0300" } }, {}],
  ["create", "missing predecessor", { body: { projectId: 15, title: "Column", after_section_id: 999 } }, {}],
  ["update", "access and explicit ranking", {}, {}],
  ["update", "permission denial", {}, { denied: true }],
  ["rename", "task history and view refresh", {}, {}],
  ["rename", "permission denial", {}, { denied: true }],
  ["update", "delete and remove from views", { body: { sectionId: 91, newSection: { deleted: true } } }, {}],
]) test(`${name}: real service ${label}`, async () => {
  const factory = effects => serviceController(name, effects, options);
  const old = fixture(name, scenario, false, factory), expected = await invoke(old, name, scenario, "legacy");
  const writes = old.effects.filter(([label]) => label === "write-section");
  if (name !== "create") {
    const gate = old.effects.find(([label]) => label === (name === "update" ? "last-or-access" : "board-access"));
    assert.deepEqual(gate[1].where, name === "update"
      ? { id: 91, project: { status: "Normal", ownerId: 985 } }
      : { id: 15, status: "Normal", ownerId: 985 });
    assert.ok(!writes.length || old.effects.indexOf(gate) < old.effects.indexOf(writes[0]));
  }
  if (options.denied) { assert.equal(expected.status, 403); assert.deepEqual(writes, []); }
  else if (label === "missing predecessor") { assert.equal(expected.status, 404); assert.deepEqual(writes, []); }
  else {
    assert.equal(expected.status, label.startsWith("delete") ? 204 : 200);
    assert.equal(writes.length, 1);
    if (name === "create") {
      const generateRank = load("src/utils/generateRank.ts", {}).default;
      const expectedRank = label === "explicit ranking" ? "A0300" : await quiet(() => generateRank("A0100", label === "rank between sections" ? "A0200" : undefined));
      assert.equal(writes[0][1].data.ranking, expectedRank);
      assert.equal(old.effects.find(([label]) => label === "append-views")[3], 985);
    }
    if (name === "rename") {
      assert.deepEqual(old.effects.find(([label]) => label === "history")[1], [{ taskId: 42, from: "Column", to: "Renamed", userId: 985 }]);
      assert.deepEqual(old.effects.find(([label]) => label === "view"), ["view", 15, 985]);
    }
  }
  for (const mode of [false, "outage", true, "web"]) {
    const fx = fixture(name, scenario, mode, factory);
    assert.deepEqual(await invoke(fx, name, scenario, mode === "web" ? "web" : "current"), expected);
    assert.deepEqual(fx.effects, old.effects);
  }
});

for (const name of ["getAll", "getByTaskId", "getProjectSections"]) test(`${name}: real read controller retains selection and rank order`, async () => {
  const factory = effects => {
    const record = (label, value) => async (...args) => { effects.push([label, ...structuredClone(args)]); return value; };
    const mocks = {
      "@/lib/prisma": { default: {
        task: { findFirst: record("read-task", { id: 42, projectId: 15 }) },
        project: { findFirst: record("read-project", { id: 15 }) },
        section: { findMany: record("read-sections", [section, { ...section, id: 92, ranking: "A0200" }]) },
      } },
      "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getViewFromProject: () => undefined },
      "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: id => ({ ownerId: id }) },
    };
    return load(`src/utils/controllers/section/${name === "getByTaskId" ? "getByTask" : name}.ts`, mocks).default;
  };
  const old = fixture(name, {}, false, factory), expected = await invoke(old, name, {}, "legacy");
  assert.equal(expected.status, 200); assert.deepEqual(expected.body.map(row => row.ranking), ["A0100", "A0200"]);
  const select = old.effects.find(([label]) => label === "read-sections");
  assert.deepEqual(select.slice(1), name === "getAll"
    ? [{ where: { project: { ownerId: 985 } } }]
    : [{ where: { projectId: 15, deleted: false }, orderBy: { ranking: "asc" } }]);
  if (name === "getByTaskId") assert.deepEqual(old.effects.find(([label]) => label === "read-task")[1], {
    where: { id: 42, project: { ownerId: 985 } }, include: { project: true, user: true },
  });
  if (name === "getProjectSections") assert.deepEqual(old.effects.find(([label]) => label === "read-project")[1].include.project_view.include.user_project_views.where, { userId: 985 });
  for (const mode of [false, "outage", true, "web"]) {
    const fx = fixture(name, {}, mode, factory);
    assert.deepEqual(await invoke(fx, name, {}, mode === "web" ? "web" : "current"), expected); assert.deepEqual(fx.effects, old.effects);
  }
});

for (const name of ["getAll", "getByTaskId"]) {
  test(`${name}: HTPR-6982 rejects anonymous reads before body validation on every path`, async () => {
    for (const body of [{}, { userId: 99, taskId: 17 }, null, undefined]) {
      const scenario = { noAuth: true, body };
      for (const mode of ["legacy", false, "outage", true, "web"]) {
        const fx = fixture(name, scenario, mode);
        const target = mode === "legacy" || mode === "web" ? mode : "current";
        assert.deepEqual(await invoke(fx, name, scenario, target), { status: 401, body: { message: "Unauthorized" }, headers: {} });
        assert.deepEqual(fx.effects, []); assert.deepEqual(fx.flags, []); assert.deepEqual(fx.loads, []);
      }
    }
  });

  for (const [label, scenario] of name === "getAll" ? [
    ["no body actor", { body: {} }], ["spoofed actor", { body: { userId: 99, projectId: 17, teamId: 2 } }],
    ["null body", { body: null }],
  ] : [15, 16, 19, 17, 18, 999].map(taskId => [String(taskId), { body: { taskId, userId: 99, teamId: 2 } }])) {
    test(`${name}: HTPR-6982 real content-access policy ${label} matches legacy, Off, outage, On and Web`, async () => {
      const projects = [
        { id: 15, teamId: 1, ownerId: 985, members: [] },
        { id: 16, teamId: 1, ownerId: 99, members: [{ userId: 985, agentId: null }] },
        { id: 17, teamId: 2, ownerId: 99, members: [] },
        { id: 18, teamId: 2, ownerId: 99, members: [{ userId: 985, agentId: "agent-only" }] },
        { id: 19, teamId: null, ownerId: 985, members: [] },
      ];
      const sections = projects.map(({ id }) => ({ ...section, id: id * 10, projectId: id, ranking: "A0200" }));
      sections.push({ ...section, id: 159, ranking: "A0050", deleted: true }, { ...section, id: 151, ranking: "A0100" });
      const factory = effects => {
        const accessible = (id, where) => {
          const project = projects.find(project => project.id === id);
          return project && (!where || where.OR.some(branch => branch.ownerId === project.ownerId ||
            (branch.members && project.members.some(member => member.userId === branch.members.some.userId && member.agentId === branch.members.some.agentId))));
        };
        return load(`src/utils/controllers/section/${name === "getByTaskId" ? "getByTask" : name}.ts`, {
          "@/lib/prisma": { default: {
            task: { findFirst: async query => {
              effects.push(["read-task", structuredClone(query)]);
              const id = query.where.id;
              return accessible(id, query.where.project) ? { id, projectId: id } : null;
            } },
            section: { findMany: async query => {
              effects.push(["read-sections", structuredClone(query)]);
              const rows = sections.filter(row => (!query?.where?.project || accessible(row.projectId, query.where.project)) &&
                (query?.where?.projectId === undefined || row.projectId === query.where.projectId) &&
                (query?.where?.deleted === undefined || row.deleted === query.where.deleted));
              return query?.orderBy ? rows.sort((a, b) => a.ranking.localeCompare(b.ranking)) : rows;
            } },
          } },
          "@/lib/agents/publicAgent": {}, "@/lib/cycles": {}, "@/lib/agents/visibility": {},
          "@/utils/controllers/notifications/visibleInboxScope": {},
        }).default;
      };
      const old = fixture(name, scenario, false, factory), expected = await invoke(old, name, scenario, "legacy");
      const allowed = [15, 16, 19];
      if (name === "getByTaskId" && !allowed.includes(scenario.body.taskId)) {
        assert.deepEqual(expected, { status: 404, body: { message: "Task not found" }, headers: {} });
        assert.ok(!old.effects.some(([label]) => label === "read-sections"));
      } else {
        assert.equal(expected.status, 200);
        assert.deepEqual(expected.body, name === "getAll" ? sections.filter(row => allowed.includes(row.projectId))
          : sections.filter(row => row.projectId === scenario.body.taskId && !row.deleted).sort((a, b) => a.ranking.localeCompare(b.ranking)));
      }
      const accessRead = old.effects.find(([label]) => label === (name === "getAll" ? "read-sections" : "read-task"));
      assert.deepEqual(accessRead[1].where.project, {
        OR: [{ ownerId: 985 }, { members: { some: { userId: 985, agentId: null } } }],
      });
      for (const mode of [false, "outage", true, "web"]) {
        const fx = fixture(name, scenario, mode, factory);
        assert.deepEqual(await invoke(fx, name, scenario, mode === "web" ? "web" : "current"), expected);
        assert.deepEqual(fx.effects, old.effects);
      }
    });
  }
}

for (const name of ["rename", "update"]) test(`${name}: real Pages HTTP strips 204 body identically`, async () => {
  const scenario = { result: { status: 204, json: { ...section, deleted: true } } };
  const request = async (fx, target) => {
    const server = http.createServer((req, res) => apiResolver(req, res, {}, { default: fx[target] }, {}, false));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/section/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(endpoints[name].body) });
      return { status: response.status, body: await response.text() };
    } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
  };
  const old = await quiet(() => request(fixture(name, scenario), "legacy"));
  assert.deepEqual(old, { status: 204, body: "" });
  for (const mode of [false, "outage", true]) assert.deepEqual(await quiet(() => request(fixture(name, scenario, mode), "current")), old);
});
