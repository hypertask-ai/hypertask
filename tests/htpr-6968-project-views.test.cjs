const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const http = require("node:http");
const { apiResolver } = require("next/dist/server/api-utils/node/api-resolver");
const { load } = require("./task-route-loader.cjs");
const { projectViewRoutes, projectViewLegacySources } = require("./htpr-6923-verify.cjs");
const sources = projectViewLegacySources();
const clean = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const settings = { board_columns_view: [{ id: 2 }, { id: 1 }], board_filters: { addedFilters: [] }, board_sorting_mode: "Manual", board_sorting_order: "Ascending", board_empty_sections: "Show", board_subtask_setting: "Show" };
const endpoints = Object.entries(projectViewRoutes).flatMap(([name, { methods }]) => methods.map(method => ({ name, method })));
class MissingBoardFilterLabelError extends Error { constructor() { super("Missing label"); this.status = 409; } }
class ManagedSmartSplitMutationError extends Error { constructor() { super("Manage this smart split from Manage views"); this.status = 409; } }
function compileOriginal(source, mocks) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(specifier => {
    if (!Object.hasOwn(mocks, specifier)) return require(specifier);
    const mock = mocks[specifier];
    return Object.hasOwn(mock, "default") ? { __esModule: true, ...mock } : mock;
  }, mod, mod.exports);
  return mod.exports.default;
}
function bodyFor(name) {
  if (name === "create-view") return { projectId: 15, viewTitle: " QA view ", visibility: "Public", view_settings: settings };
  if (name === "update-view") return { projectId: 15, viewId: "view", view_settings: settings };
  if (name === "unsaved-view") return { projectId: 15, ...settings };
  if (name === "delete-rename-view") return { viewId: "view", title: "Renamed" };
  if (name === "switch-view") return { projectId: 15, newViewId: "view" };
  if (name === "reset-to-default") return { projectId: 15, mode: "ResetCurrent" };
  if (name === "smart-split") return { projectId: 15, viewId: "view", name: "Renamed", prompt: "Changed prompt" };
  return { projectId: "15", viewOrder: ["view", "view", "missing", "builtin-overdue"] };
}
function fixture(endpoint, scenario = {}, mode = false) {
  const { name, method } = endpoint, effects = [], flags = [], loads = [], auth = [];
  const userId = scenario.userId ?? 985, signedId = scenario.signedUserId ?? userId;
  const session = scenario.noAuth ? null : { userId, source: "better-auth" };
  const view = { id: "view", userId, title: "QA view", visibility: "Public", slug: "qa-view", project_view_id: "pv", project_view: { id: "pv", projectId: 15, default_view_id: "default", default_view_order: ["view"] }, ...settings };
  const defaultView = { ...view, id: "default", board_columns_view: [{ id: 1 }, { id: 2 }] };
  const projectView = { id: "pv", projectId: 15, default_view_id: "default", default_view: scenario.noDefault ? null : defaultView };
  const userView = { id: "uv", project_view_id: "pv", appliedViewId: "view", appliedView: view, unsavedViewId: scenario.unsaved ? "unsaved" : null, unsavedView: scenario.unsaved ? { ...view, id: "unsaved" } : null };
  const record = (label, operation) => async (...args) => {
    effects.push([label, ...structuredClone(args)]);
    if (scenario.dbThrows) throw new Error("Database unavailable");
    return typeof operation === "function" ? operation(...args) : operation;
  };
  const prisma = {
    project: {
      findFirst: record("access", scenario.denied ? null : { id: 15, section: [{ id: 1 }, { id: 2 }] }),
      findUnique: record("admin", { ownerId: scenario.denied ? 99 : signedId, members: [] }),
    },
    project_View: {
      upsert: record("project-view", projectView), findUnique: record("project-view-read", scenario.noProjectView ? null : projectView),
      update: record("write-project-view", projectView),
    },
    view: {
      findFirst: record("view-read", args => {
        if (name === "smart-split") {
          if (args.where.title || args.where.slug) return scenario.duplicate && args.where.title ? { id: "other" } : null;
          return scenario.missingView ? null : view;
        }
        if (name === "create-view") return scenario.existing ? view : null;
        return scenario.denied || scenario.missingView ? null : view;
      }),
      findUnique: record("view-read", scenario.missingView ? null : view),
      findMany: record("views-read", args => args.where.userId?.not ? [] : args.select?.id && !args.select?.board_filters ? [{ id: "view" }] : [view]),
      create: record("write-view-create", args => ({ ...view, ...args.data })),
      update: record("write-view-update", args => ({ ...view, ...args.data })),
      delete: record("write-view-delete", view), deleteMany: record("write-view-delete-many", { count: 1 }),
    },
    user_Project_View: {
      findUnique: record("user-view", scenario.noUserView ? null : userView), findMany: record("user-orders", []),
      create: record("write-user-view-create", userView), upsert: record("write-user-view-upsert", userView),
      update: record("write-user-view-update", userView), updateMany: record("write-user-view-update-many", { count: 1 }),
    },
    view_Last_Used: { upsert: record("write-last-used", {}), deleteMany: record("write-last-used-delete", { count: 1 }) },
    label: {
      findFirst: record("label-read", null),
      findMany: record("labels-read", [{ id: "view", projectId: 15, value: "QA view", ai_prompt: "Old prompt" }]),
      create: record("write-label-create", args => args.data), update: record("write-label-update", {}), delete: record("write-label-delete", {}),
    },
    taskLabel: { deleteMany: record("write-task-label-delete", { count: 1 }) },
    $queryRaw: record("lock-user-view", [{ unsavedViewId: scenario.unsaved ? "unsaved" : null }]),
  };
  let attempts = 0;
  prisma.$transaction = async (operation, options) => {
    effects.push(["transaction", options]);
    if (attempts++ < (scenario.conflicts ?? 0)) throw Object.assign(new Error("Serialization conflict"), { code: "P2034" });
    const result = await operation(prisma);
    effects.push(["committed"]);
    return result;
  };
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/auth/getSessionUser": { getSessionUser: async headers => {
      auth.push(headers.get("cookie"));
      if (scenario.authThrows) throw new Error("Auth unavailable");
      return session;
    } },
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: async id => {
      effects.push(["actor", id]);
      if (scenario.actorThrows) throw new Error("Actor unavailable");
      return { id };
    } },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: token => {
      if (scenario.signedThrows) throw new Error("Signed session unavailable");
      return token === "synthetic-signed" && !scenario.noAuth && !scenario.unsigned ? { id: signedId } : null;
    } },
    "@/lib/flags/keys": { HTPR_6923_APP_ROUTER_WRITES_FLAG: "htpr-6923-app-router-writes" },
    "@/lib/flags": { isFeatureEnabled: async (key, id) => { flags.push([key, id]); if (mode === "outage") throw new Error("Flag unavailable"); return mode === true; } },
    "@/lib/realtime/server": { broadcastBoardChange: (...args) => { effects.push(["broadcast", ...args]); if (scenario.broadcastThrows) throw new Error("Broadcast unavailable"); } },
    "@/lib/ai/labelClassifier": { scheduleBackfillAiLabel: id => { effects.push(["backfill", id]); if (scenario.backfillThrows) throw new Error("Backfill unavailable"); } },
    "node:crypto": { randomUUID: () => "synthetic-split" },
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: id => ({ ownerId: id }), getProjectWhere: id => ({ ownerId: id }) },
    "@/utils/controllers/projects/views/viewsHelperAPIfunctions": { default: record("payload", scenario.payloadUndefined ? undefined : scenario.noPayload ? null : { ...projectView, allViews: [view], user_project_views: [userView] }), getUniqueSlug: record("slug", "renamed") },
    "@/utils/controllers/projects/views/boardFilterWriteLock": {
      MissingBoardFilterLabelError, ManagedSmartSplitMutationError,
      acquireBoardFilterWriteLock: async (_tx, id) => { effects.push(["filter-lock", id]); },
      assertViewIsNotManagedSmartSplit: async (...args) => { effects.push(["smart-guard", ...args.slice(1)]); if (scenario.managed) throw new ManagedSmartSplitMutationError(); },
      withBoardFilterWriteLock: async (id, filters, operation) => { effects.push(["filter-lock", id, structuredClone(filters)]); if (scenario.missingLabel) throw new MissingBoardFilterLabelError(); return operation(prisma); },
    },
    "@/utils/helperFunctions/Views/BoardFilterSanitizer": { sanitizeBoardFilters: value => value, sanitizeViewBoardFilters: value => value },
    "@/utils/helperFunctions/helperFunctions": { isDeepEqual: () => !!scenario.equal },
    "@/utils/helperFunctions/Views/EmptySectionsHelperFunction": { defaultEmptySections: "Show" },
    "@/utils/helperFunctions/Views/FilterHelperFunctions": { defaultFilterSettings: {} },
    "@/utils/helperFunctions/Views/SubtaskHelperFunction": { defaultSubtaskSettings: "Show" },
    "@/utils/helperFunctions/Views/TransientTabView": { canUseViewAsTabBase: () => !scenario.privateBase, shouldUseTransientTabSettings: () => !!scenario.transient, applyTransientTabSettings: (payload, id, base, incoming, dirty) => ({ ...payload, transient: { id, base, incoming, dirty } }) },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": {
      sanitizeTableSort: () => ({ column: null, direction: null }), sanitizeBoardLayout: value => ["Table", "Kanban"].includes(value) ? value : null,
      getBoardLayoutRequestUpdate: body => Object.hasOwn(body, "board_layout") ? { board_layout: body.board_layout } : {},
      getSavedBoardLayoutFromActiveView: () => "Table", resolveBoardLayoutRequest: body => Object.hasOwn(body, "board_layout") ? body.board_layout : "Table",
      resolveShowArchivedRequest: body => Object.hasOwn(body, "board_show_archived") ? body.board_show_archived : null,
      defaultBoardSortingOrder: "Ascending", defaultBoardSortingSettings: "Manual",
    },
  };
  mocks["@/models/Views/model"] = load("src/models/Views/model.ts", mocks);
  mocks["@/lib/smartSplits"] = load("src/lib/smartSplits.ts", mocks);
  // Keep real view-order validation, availability filtering and permission checks.
  mocks["@/utils/controllers/projects/views/viewOrder"] = load("src/utils/controllers/projects/views/viewOrder.ts", mocks);
  // The smart split's managed pair uses real label-reference parsing.
  if (name === "smart-split") view.board_filters = { addedFilters: [{ type: "Labels", searchPayload: [{ id: "view", value: "QA view" }] }] };
  const web = load(`src/lib/api/project-writes/views/${name}.ts`, mocks)[method];
  mocks[`@/lib/api/project-writes/views/${name}`] = { get [method]() { loads.push(method); if (scenario.loadThrows) throw new Error("Route load unavailable"); return web; } };
  return { legacy: compileOriginal(sources[name], mocks), current: load(`src/pages/api/projects/views/${name}.ts`, mocks).default, web, effects, flags, loads, auth };
}
function input(endpoint, scenario) {
  return {
    method: scenario.method ?? endpoint.method,
    body: clean(Object.hasOwn(scenario, "body") ? scenario.body : { ...bodyFor(endpoint.name), userId: 6 }),
    query: scenario.query ?? { viewId: "view", projectId: "999", userId: "6" },
    cookies: Object.hasOwn(scenario, "cookies") ? scenario.cookies : { ht_session: "synthetic-signed", nookies_user: '{"id":6}' },
    headers: { cookie: "ht_session=synthetic-signed; nookies_user=spoofed" },
  };
}
async function invoke(fx, endpoint, scenario, target) {
  const saved = Object.fromEntries(["log", "error"].map(key => [key, console[key]])), RealDate = global.Date;
  console.log = console.error = () => {};
  global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [1791331200000])); } };
  try {
    const req = input(endpoint, scenario); let result;
    if (target === "web") {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(req.query)) for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
      const options = { method: req.method, headers: { ...req.headers, "content-type": "application/json" } };
      if (req.body !== undefined && !(endpoint.name === "delete-rename-view" && endpoint.method === "DELETE")) options.body = JSON.stringify(req.body);
      // Undefined is a Pages parser value, not valid Web JSON. Test it through Pages.
      const request = req.body === undefined && !(endpoint.name === "delete-rename-view" && endpoint.method === "DELETE") ? { headers: new Headers(req.headers), json: async () => undefined } : new Request(`https://example.invalid/api/projects/views/${endpoint.name}?${params}`, options);
      if (scenario.cookies) request.cookies = scenario.cookies;
      const response = await fx.web(request);
      const text = await response.text();
      result = { status: response.status, body: text ? JSON.parse(text) : undefined };
    } else {
      const res = { setHeader: () => {}, status: status => ({ json: value => { result = { status, body: clean(value) }; return result; } }) };
      await fx[target](req, res);
    }
    return result;
  } catch (error) { return { throws: String(error) }; }
  finally { global.Date = RealDate; Object.assign(console, saved); }
}
async function parity(endpoint, scenario) {
  const old = fixture(endpoint, scenario), expected = await invoke(old, endpoint, scenario, "legacy");
  for (const mode of [false, "outage", true, "web"]) {
    if (mode === "web" && scenario.authThrows && endpoint.name.endsWith("order")) continue;
    const fx = fixture(endpoint, scenario, mode);
    assert.deepEqual(await invoke(fx, endpoint, scenario, mode === "web" ? "web" : "current"), expected, `${mode} response`);
    assert.deepEqual(clean(fx.effects), clean(old.effects), `${mode} ordered effects`);
    assert.equal(fx.loads.length, mode === true && !scenario.noAuth && !scenario.authThrows ? 1 : 0);
    if (fx.flags.length) assert.deepEqual(fx.flags, [["htpr-6923-app-router-writes", scenario.userId ?? 985]]);
  }
  return { expected, effects: old.effects };
}
const cases = [
  ["success", {}], ["missing fields", { body: {} }], ["null body", { body: null }], ["absent body", { body: undefined }],
  ["primitive body", { body: "unchanged" }], ["unauthenticated", { noAuth: true }], ["auth before invalid body", { noAuth: true, body: null }],
  ["permission/missing accessible view", { denied: true }], ["database failure", { dbThrows: true }],
  ["auth resolver failure", { authThrows: true }], ["signed identity not body actor", { userId: 2343 }],
  ["missing view", { missingView: true }], ["unsaved cleanup", { unsaved: true }],
  ["post-write broadcast failure", { broadcastThrows: true }], ["undefined payload stays empty JSON response", { payloadUndefined: true }],
];
for (const endpoint of endpoints) {
  const extra = endpoint.name.endsWith("order") ? [
    ["Better Auth alone remains unauthorized", { unsigned: true }], ["signed identity wins", { signedUserId: 2343 }],
    ["explicit Pages cookies override header", { cookies: {} }], ["signed verification throws outside catch", { signedThrows: true }],
    ["invalid order", { body: { projectId: 15, viewOrder: [42] } }], ["missing project view", { noProjectView: true }],
  ] : [];
  if (["update-view", "unsaved-view"].includes(endpoint.name)) extra.push(["actor load throws outside catch", { actorThrows: true }]);
  if (endpoint.name === "create-view") extra.push(["overwrite saved view", { existing: true }], ["managed overwrite", { existing: true, managed: true }], ["missing filter label", { missingLabel: true }], ["default view", { body: { ...bodyFor(endpoint.name), setAsDefault: true } }], ["empty title", { body: { ...bodyFor(endpoint.name), viewTitle: " " } }]);
  if (endpoint.name === "update-view") extra.push(["managed view", { managed: true }], ["missing label", { missingLabel: true }], ["layout-only", { body: { ...bodyFor(endpoint.name), updateMode: "layout", view_settings: { board_layout: "Table" } } }], ["invalid layout", { body: { ...bodyFor(endpoint.name), updateMode: "layout", view_settings: {} } }], ["personal empty sections", { body: { ...bodyFor(endpoint.name), updateMode: "personal-empty-sections" } }]);
  if (endpoint.name === "unsaved-view") extra.push(["new user view", { noUserView: true }], ["equal settings detach unsaved", { unsaved: true, equal: true }], ["tab transient", { transient: true, body: { ...bodyFor(endpoint.name), baseViewId: "view" } }], ["private tab base", { privateBase: true, body: { ...bodyFor(endpoint.name), baseViewId: "view" } }], ["missing transient payload", { transient: true, noPayload: true }], ["missing filter label", { missingLabel: true }]);
  if (endpoint.name === "reset-to-default") extra.push(["ResetToDefault", { unsaved: true, body: { projectId: 15, mode: "ResetToDefault" } }], ["serialization retry", { conflicts: 2 }], ["serialization exhaustion", { conflicts: 3 }]);
  if (endpoint.name === "delete-rename-view") extra.push(["managed split guard", { managed: true }], ["query arrays unchanged", { query: { viewId: ["view", "other"] } }]);
  if (endpoint.name === "smart-split") extra.push(["duplicate name", { duplicate: true }], ["no default view", { noDefault: true }], ["serialization retry", { conflicts: 2 }], ["serialization exhaustion", { conflicts: 3 }], ["post-commit backfill failure", { backfillThrows: true }], ["empty prompt", { body: { ...bodyFor(endpoint.name), prompt: " " } }]);
  for (const [label, scenario] of [...cases, ...extra]) test(`${endpoint.name} ${endpoint.method}: ${label} original/Off/outage/On/Web parity`, async () => {
    const { expected } = await parity(endpoint, scenario);
    if (label === "success") assert.equal(expected.status, endpoint.name === "smart-split" && endpoint.method === "POST" ? 201 : 200);
  });
  test(`${endpoint.name} ${endpoint.method}: unsupported method stays legacy and bypasses preflight`, async () => {
    const scenario = { method: "OPTIONS" }, old = fixture(endpoint, scenario), fx = fixture(endpoint, scenario, true);
    assert.deepEqual(await invoke(fx, endpoint, scenario, "current"), await invoke(old, endpoint, scenario, "legacy"));
    assert.deepEqual(fx.flags, []); assert.deepEqual(fx.loads, []); assert.deepEqual(fx.auth, old.auth);
  });
  test(`${endpoint.name} ${endpoint.method}: route load failure never retries legacy`, async () => {
    const fx = fixture(endpoint, { loadThrows: true }, true);
    assert.deepEqual(await invoke(fx, endpoint, { loadThrows: true }, "current"), { throws: "Error: Route load unavailable" });
    assert.deepEqual(fx.effects, []); assert.equal(fx.loads.length, 1);
  });
}
for (const [name, body, status, message] of [
  ["switch-view", {}, 101, "Missing required information"], ["delete-rename-view", {}, 101, "Missing required information"],
  ["update-view", {}, 401, "Authentication required"], ["update-view", { projectId: 15, viewId: "view" }, 500, undefined],
  ["create-view", {}, 400, "Missing required information!"], ["unsaved-view", {}, 400, "Missing required information!"],
  ["reset-to-default", {}, 400, "A valid board and reset mode are required"],
]) test(`${name}: explicit historical status ${status}`, async () => {
  const { expected } = await parity({ name, method: "POST" }, { body });
  assert.equal(expected.status, status); if (message) assert.equal(expected.body.message, message);
});
for (const [name, method, status] of [["create-view", "POST", 403], ["unsaved-view", "POST", 403], ["update-view", "POST", 404], ["reset-to-default", "POST", 403], ["update-order", "POST", 403], ["reset-order", "POST", 403], ["set-default-order", "POST", 403], ["smart-split", "POST", 403], ["smart-split", "PATCH", 403], ["smart-split", "DELETE", 403]]) test(`${name} ${method}: denial stops mutation`, async () => {
  const { expected, effects } = await parity({ name, method }, { denied: true });
  assert.equal(expected.status, status); assert.ok(!effects.some(([label]) => label.startsWith("write-") || ["backfill", "broadcast"].includes(label)));
});
for (const name of ["switch-view", "delete-rename-view"]) test(`${name}: retain historical lack of board permission check rather than tightening this refactor`, async () => {
  const { expected } = await parity({ name, method: "POST" }, { denied: true });
  assert.equal(expected.status, 200);
});
test("smart split retries preserve 409 and success preserves 201/backfill after commit", async () => {
  const endpoint = { name: "smart-split", method: "POST" };
  assert.equal((await parity(endpoint, { conflicts: 3 })).expected.status, 409);
  const { expected, effects } = await parity(endpoint, {});
  assert.equal(expected.status, 201);
  assert.ok(effects.findIndex(([label]) => label === "backfill") > effects.findIndex(([label]) => label === "committed"));
});
test("101 response facade is only used for the unsupported Web status", async () => {
  const { viewWriteJson } = load("src/lib/api/project-writes/views/response.ts", {});
  const unusual = viewWriteJson({ message: "Missing required information" }, 101);
  assert.equal(unusual.status, 101); assert.equal(await unusual.text(), '{"message":"Missing required information"}');
  assert.equal(unusual.headers.get("content-type"), "application/json");
  assert.ok(viewWriteJson({}, 200) instanceof Response);
  assert.throws(() => new Response("", { status: 101 }), RangeError);
});
test("actual Pages resolver preserves serialized success, error and unauthorized bytes", async () => {
  for (const [endpoint, scenario] of [[{ name: "create-view", method: "POST" }, {}], [{ name: "update-view", method: "POST" }, { body: {} }], [{ name: "smart-split", method: "POST" }, { noAuth: true }], [{ name: "delete-rename-view", method: "DELETE" }, {}]]) {
    async function exchange(target, mode) {
      const fx = fixture(endpoint, scenario, mode), req = input(endpoint, scenario);
      const saved = console.log; console.log = () => {};
      const server = http.createServer((request, response) => apiResolver(request, response, req.query, { default: fx[target] }, {}, false));
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      try {
        const result = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/views/${endpoint.name}`, { method: endpoint.method, headers: { ...req.headers, "content-type": "application/json" }, body: JSON.stringify(req.body) });
        return { status: result.status, text: await result.text(), type: result.headers.get("content-type") };
      } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); console.log = saved; }
    }
    const original = await exchange("legacy", false);
    for (const mode of [false, "outage", true]) assert.deepEqual(await exchange("current", mode), original);
  }
});
