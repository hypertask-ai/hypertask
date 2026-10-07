const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const { apiResolver } = require("next/dist/server/api-utils/node/api-resolver");
const { load } = require("./task-route-loader.cjs");
const { projectViewRoutes } = require("./htpr-6923-verify.cjs");

const legacySource = execFileSync("git", ["show", "d08ea2a01:src/pages/api/projects/views/delete-rename-view.ts"], { encoding: "utf8" });
assert.equal(crypto.createHash("sha256").update(legacySource).digest("hex"), projectViewRoutes["delete-rename-view"].hash);
const actor = { userId: 985, source: "better-auth" };
const query = { viewId: "deleted-view", projectId: "7641" };

function fixture({ active = false, unsaved = false, last = false, payloadUndefined = false } = {}, flag = true) {
  const effects = [], caught = [];
  const projectView = { id: "project-view", projectId: 7641, default_view_id: last ? query.viewId : "default-view" };
  const view = { id: query.viewId, project_view_id: projectView.id, project_view: projectView, title: "Zeta renamed", board_filters: { addedFilters: [] } };
  const defaultView = { ...view, id: "default-view", title: "Default" };
  const userView = { userId: actor.userId, project_view_id: projectView.id, appliedViewId: active ? view.id : null, unsavedViewId: unsaved ? "unsaved-view" : null };
  const views = new Map([[view.id, view], ...(!last ? [[defaultView.id, defaultView]] : []), ...(unsaved ? [["unsaved-view", { ...view, id: "unsaved-view" }]] : [])]);
  const prisma = {
    view: {
      findUnique: async ({ where }) => { effects.push(["lookup", where.id]); return views.get(where.id) ?? null; },
      delete: async ({ where }) => {
        effects.push(["delete", where.id]);
        const deleted = views.get(where.id);
        assert.ok(deleted, "delete only an existing view");
        views.delete(where.id);
        if (userView.appliedViewId === where.id) userView.appliedViewId = null;
        if (userView.unsavedViewId === where.id) userView.unsavedViewId = null;
        if (projectView.default_view_id === where.id) projectView.default_view_id = null;
        return deleted;
      },
    },
    view_Last_Used: { deleteMany: async ({ where }) => { effects.push(["last-used", where.viewId]); return { count: 1 }; } },
    user_Project_View: { findUnique: async () => { effects.push(["user-view"]); return userView; } },
    project_View: { findUnique: async () => {
      effects.push(["payload"]);
      if (payloadUndefined) return undefined;
      return { ...projectView, default_view: views.get(projectView.default_view_id) ?? null, allViews: [...views.values()], user_project_views: [{ ...userView, appliedView: views.get(userView.appliedViewId) ?? null, unsavedView: views.get(userView.unsavedViewId) ?? null }] };
    } },
    $transaction: async operation => { effects.push(["transaction"]); const result = await operation(prisma); effects.push(["commit"]); return result; },
  };
  class ManagedSmartSplitMutationError extends Error {}
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => actor },
    "@/lib/flags": { isFeatureEnabled: async () => flag },
    "@/lib/flags/keys": { HTPR_6923_APP_ROUTER_WRITES_FLAG: "htpr-6923-app-router-writes" },
    "@/lib/realtime/server": { broadcastBoardChange: (...args) => effects.push(["broadcast", ...args]) },
    "@/utils/controllers/projects/views/boardFilterWriteLock": {
      ManagedSmartSplitMutationError,
      acquireBoardFilterWriteLock: async (_tx, id) => effects.push(["lock", id]),
      assertViewIsNotManagedSmartSplit: async (_tx, id, viewId) => effects.push(["guard", id, viewId]),
    },
  };
  const compiled = ts.transpileModule(legacySource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "console", compiled)(specifier => {
    if (Object.hasOwn(mocks, specifier)) {
      const mock = mocks[specifier];
      return Object.hasOwn(mock, "default") ? { __esModule: true, ...mock } : mock;
    }
    if (specifier.startsWith("@/")) return load(`src/${specifier.slice(2)}.ts`, mocks);
    return require(specifier);
  }, mod, mod.exports, { log: (...args) => caught.push(args) });
  const current = load("src/pages/api/projects/views/delete-rename-view.ts", mocks).default;
  return { legacy: mod.exports.default, current, effects, views, caught };
}

async function exchange(fx, target, method = "DELETE") {
  const server = http.createServer((request, response) => apiResolver(request, response, query, { default: fx[target] }, {}, false));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/views/delete-rename-view?${new URLSearchParams(query)}`, { method });
    return { status: response.status, text: await response.text(), type: response.headers.get("content-type"), length: response.headers.get("content-length"), etag: response.headers.get("etag"), cacheControl: response.headers.get("cache-control") };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

for (const [label, scenario] of [
  ["QA inactive, non-default view", {}],
  ["active view with unsaved cleanup", { active: true, unsaved: true }],
  ["last saved view", { active: true, last: true }],
  ["undefined post-delete payload", { payloadUndefined: true }],
]) test(`DELETE ${label}: original/Off/On preserve wire response and ordered effects`, async () => {
  const original = fixture(scenario), expected = await exchange(original, "legacy");
  assert.equal(expected.status, 200);
  assert.equal(expected.type, "application/json; charset=utf-8");
  assert.equal(original.views.has(query.viewId), false);
  for (const flag of [false, true]) {
    const current = fixture(scenario, flag);
    assert.deepEqual(await exchange(current, "current"), expected);
    assert.deepEqual(current.effects, original.effects);
    assert.equal(current.views.has(query.viewId), false);
  }
});

test("an interrupted successful delete followed by a duplicate returns legacy 500 {} without another write", async () => {
  const original = fixture(), success = await exchange(original, "legacy");
  assert.equal(success.status, 200);
  const failed = await exchange(original, "legacy");
  assert.equal(failed.status, 500);
  assert.equal(failed.text, "{}");
  assert.ok(original.caught.some(args => args.some(value => value instanceof Error && value.message === "View does not exist")));
  assert.equal(original.effects.filter(([name]) => name === "delete").length, 1);
  for (const flag of [false, true]) {
    const current = fixture({}, flag);
    assert.deepEqual(await exchange(current, "current"), success);
    assert.deepEqual(await exchange(current, "current"), failed);
    assert.deepEqual(current.effects, original.effects);
  }
});

test("Pages dispatch preserves JSON, empty JSON, empty 204 and text wire responses without json()", async () => {
  const { withTaskWriteFlag } = load("src/lib/api/task-writes/route.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => actor },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/flags/keys": { HTPR_6923_APP_ROUTER_WRITES_FLAG: "htpr-6923-app-router-writes" },
  });
  for (const [label, body, status, type] of [
    ["JSON", { success: true }, 200, "application/json"],
    ["JSON string", "Missing Required Data", 200, "application/json"],
    ["empty JSON", undefined, 200, "application/json"],
    ["no content", undefined, 204, null],
    ["download text", "Forbidden", 403, "text/html; charset=utf-8"],
  ]) {
    const legacy = (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      return type === "application/json" || body === undefined ? res.status(status).json(body) : res.status(status).send(body);
    };
    const current = withTaskWriteFlag(legacy, "DELETE", async () => async () => ({
      status, headers: new Headers({ ...(type ? { "content-type": type } : {}), "cache-control": "no-store" }),
      text: async () => type === "application/json" ? JSON.stringify(body) ?? "" : body ?? "",
      json: async () => { throw new Error("Dispatch must not parse an empty or non-JSON response with json()"); },
    }));
    assert.deepEqual(await exchange({ legacy, current }, "current"), await exchange({ legacy, current }, "legacy"), label);
  }
});
