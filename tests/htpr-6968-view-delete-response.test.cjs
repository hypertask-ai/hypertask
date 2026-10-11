const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { apiResolver } = require("next/dist/server/api-utils/node/api-resolver");
const { load } = require("./task-route-loader.cjs");
const { pins } = require("./helpers/htpr-6992-pins.cjs");
const rawPin = pins("a2-view-delete-response");
// Pins group by route so the fixture holds one digest per route.
const groupOf = () => "delete-rename-view";
const pin = (key, value) => rawPin(groupOf(key), key, value);
const actor = { userId: 985, source: "better-auth" };
const query = { viewId: "deleted-view", projectId: "7641" };

function fixture({ active = false, unsaved = false, last = false, payloadUndefined = false } = {}) {
  const effects = [];
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
    "@/lib/realtime/server": { broadcastBoardChange: (...args) => effects.push(["broadcast", ...args]) },
    "@/utils/controllers/projects/views/boardFilterWriteLock": {
      ManagedSmartSplitMutationError,
      acquireBoardFilterWriteLock: async (_tx, id) => effects.push(["lock", id]),
      assertViewIsNotManagedSmartSplit: async (_tx, id, viewId) => effects.push(["guard", id, viewId]),
    },
  };
  const current = load("src/pages/api/projects/views/delete-rename-view.ts", mocks).default;
  return { current, effects, views };
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
]) test(`DELETE ${label}: pins wire response and ordered effects`, async () => {
  const current = fixture(scenario), wire = await exchange(current, "current");
  assert.equal(wire.status, 200);
  assert.equal(wire.type, "application/json; charset=utf-8");
  assert.equal(current.views.has(query.viewId), false);
  pin(`DELETE ${label}`, { wire, effects: current.effects });
});

test("an interrupted successful delete followed by a duplicate returns 404 View does not exist without another write", async () => {
  const current = fixture(), success = await exchange(current, "current");
  assert.equal(success.status, 200);
  const failed = await exchange(current, "current");
  assert.equal(failed.status, 404);
  assert.equal(failed.text, '{"message":"View does not exist"}');
  assert.equal(current.effects.filter(([name]) => name === "delete").length, 1);
  pin("duplicate delete", { success, failed, effects: current.effects });
});

test("Pages dispatch preserves JSON, empty JSON, empty 204 and text wire responses without json()", async () => {
  const { taskWriteHandler } = load("src/lib/api/task-writes/route.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => actor },
  });
  for (const [label, body, status, type] of [
    ["JSON", { success: true }, 200, "application/json"],
    ["JSON string", "Missing Required Data", 200, "application/json"],
    ["empty JSON", undefined, 200, "application/json"],
    ["no content", undefined, 204, null],
    ["download text", "Forbidden", 403, "text/html; charset=utf-8"],
  ]) {
    // Reference: what a hand-written Pages handler sends for the same response.
    const reference = (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      return type === "application/json" || body === undefined ? res.status(status).json(body) : res.status(status).send(body);
    };
    const current = taskWriteHandler({ DELETE: async () => async () => ({
      status, headers: new Headers({ ...(type ? { "content-type": type } : {}), "cache-control": "no-store" }),
      text: async () => type === "application/json" ? JSON.stringify(body) ?? "" : body ?? "",
      json: async () => { throw new Error("Dispatch must not parse an empty or non-JSON response with json()"); },
    }) });
    assert.deepEqual(await exchange({ reference, current }, "current"), await exchange({ reference, current }, "reference"), label);
  }
});
