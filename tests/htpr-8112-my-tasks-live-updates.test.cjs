const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { NextRequest, NextResponse } = require("next/server");

const root = path.resolve(__dirname, "..");
const scopesModule = { exports: {} };
new Function("exports", ts.transpileModule(
  fs.readFileSync(path.join(root, "src/lib/myTasksScopes.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText)(scopesModule.exports);
const scopes = scopesModule.exports;
const keys = {
  MY_TASKS_LIVE_UPDATES_FLAG: "htpr-6458-my-tasks-live-updates",
  MY_TASKS_SCOPES_FLAG: "scopes",
  MY_TASKS_SNOOZE_FLAG: "snooze",
  MY_TASKS_VIEWS_FLAG: "views",
};

function fixture(userId = 985) {
  const calls = [];
  const payload = { sections: [{ id: 1, items: [] }], tabs: ["All"], boards: [] };
  const stubs = {
    "next/server": { NextResponse },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => userId ? { userId } : null },
    "@/lib/flags": { isFeatureEnabled: async (key) => {
      calls.push(["flag", key]);
      return false;
    } },
    "@/lib/flags/keys": keys,
    "@/lib/myTasksScopes": scopes,
    "@/utils/controllers/tasks/myTasks": { default: async (...args) => {
      calls.push(["tasks", ...args]);
      return payload;
    } },
    "@/utils/controllers/projects/getAllMinimal": { default: async (...args) => {
      calls.push(["projects", ...args]);
      return { json: [{ id: 7049 }, { id: 7283 }] };
    } },
  };
  const filename = path.join(root, "src/app/api/my-tasks/route.ts");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("module", "exports", "require", compiled)(loadedModule, loadedModule.exports, (name) => {
    assert.ok(name in stubs, `Unexpected dependency: ${name}`);
    return stubs[name];
  });
  return { GET: loadedModule.exports.GET, calls, payload };
}

test("My Tasks GET always returns authorized realtime boards without the retired flag", async () => {
  const f = fixture();
  const response = await f.GET(new NextRequest("https://app.hypertask.ai/api/my-tasks?scopes=created"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ...f.payload, accessibleProjectIds: [7049, 7283] });
  assert.deepEqual(f.calls.filter(([kind]) => kind === "projects"), [["projects", 985, "Calendar", false]]);
  assert.ok(f.calls.every(([kind, key]) => kind !== "flag" || key !== "htpr-6458-my-tasks-live-updates"));
});

test("My Tasks GET still refuses unauthenticated callers before loading boards", async () => {
  const f = fixture(null);
  const response = await f.GET(new NextRequest("https://app.hypertask.ai/api/my-tasks"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.deepEqual(f.calls, []);
});
