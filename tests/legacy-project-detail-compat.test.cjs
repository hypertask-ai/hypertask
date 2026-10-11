const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");
const { pages } = require("./legacy-task-relations-fixture.cjs");
const frozen = require("./htpr-6509-query-contracts.json").project;

function fixture({ enabled = false, compat, userId = 7, failFlag = false, failAuth = false, project = frozen.json.json, failQuery = false } = {}) {
  const calls = { flags: [], queries: [], auth: [] };
  const handler = load("src/pages/api/projects/detail.ts", {
    "@/lib/prisma": { default: { project: { findFirst: async (args) => {
      calls.queries.push(args);
      if (failQuery) throw new Error("synthetic project failure");
      return project;
    } } } },
    "@/lib/auth/getSessionUser": { getSessionUser: async (headers) => {
      assert.ok(headers instanceof Headers);
      calls.auth.push(true);
      if (failAuth) throw new Error("synthetic auth failure");
      return userId == null ? null : { userId };
    } },
    "@/lib/flags": { HTPR_6924_REST_COMPAT_FLAG: "htpr-6924-rest-compat", isFeatureEnabled: async (...args) => {
      calls.flags.push(args);
      if (failFlag) throw new Error("synthetic flag failure");
      return enabled;
    } },
  }).default;
  const invoke = (body = { projectId: 15 }, method = "POST") => pages(handler, { method, body, headers: {}, query: compat === undefined ? {} : { compat } });
  return { invoke, calls };
}

for (const [name, options] of [
  ["OFF with opt-in", { compat: "htpr-6924" }],
  ["ON without opt-in", { enabled: true }],
  ["ON with wrong opt-in", { enabled: true, compat: "other" }],
  ["ON with duplicate opt-in", { enabled: true, compat: ["htpr-6924", "htpr-6924"] }],
  ["flag lookup failure", { enabled: true, compat: "htpr-6924", failFlag: true }],
  ["identity lookup failure", { enabled: true, compat: "htpr-6924", failAuth: true }],
  ["unsigned user", { enabled: true, compat: "htpr-6924", userId: null }],
  ["ordinary audience", { enabled: false, compat: "htpr-6924", userId: 99 }],
]) {
  test(`${name} keeps frozen full-project bytes, statuses, headers and query`, async () => {
    const f = fixture(options);
    const response = await f.invoke({ projectId: 15, userId: 7, compat: "htpr-6924" });
    assert.equal(response.status, frozen.json.status);
    assert.equal(response.text, JSON.stringify(frozen.json.json));
    assert.deepEqual(response.headers, {});
    const { relationLoadStrategy, ...args } = f.calls.queries[0];
    assert.equal(relationLoadStrategy, "join");
    assert.deepEqual(args, frozen.args);
    if (options.userId === null || options.failAuth) assert.deepEqual(f.calls.flags, []);
  });
}

for (const userId of [6, 985]) {
  test(`allowed audience ${userId} plus explicit opt-in receives only negotiated 410`, async () => {
    const f = fixture({ userId, enabled: true, compat: "htpr-6924" });
    const response = await f.invoke({ projectId: 15, userId: 999 });
    assert.equal(response.status, 410);
    assert.equal(response.text, '{"error":"Legacy project detail has been retired","replacement":"/api/projects/boardTasks"}');
    assert.deepEqual(response.headers, {});
    assert.deepEqual(f.calls.flags, [["htpr-6924-rest-compat", userId]]);
    assert.deepEqual(f.calls.queries, []);
  });
}

for (const options of [{}, { compat: "htpr-6924" }, { enabled: true }, { enabled: true, compat: "htpr-6924", failFlag: true }]) {
  test(`legacy project errors remain byte-identical: ${JSON.stringify(options)}`, async () => {
    const missing = await fixture(options).invoke({});
    assert.equal(missing.status, 400);
    assert.equal(missing.text, '{"message":"Project id is required"}');
    const absent = await fixture({ ...options, project: null }).invoke();
    assert.equal(absent.status, 400);
    assert.equal(absent.text, '{"message":"Project not found"}');
    const failure = await fixture({ ...options, failQuery: true }).invoke();
    assert.equal(failure.status, 400);
    assert.equal(failure.text, '{"message":"{}"}');
  });
}

test("project retirement preserves POST-only method handling before probes", async () => {
  const f = fixture({ enabled: true, compat: "htpr-6924" });
  const response = await f.invoke({}, "GET");
  assert.equal(response.status, 405);
  assert.equal(response.text, '{"message":"Method not allowed"}');
  assert.deepEqual(f.calls, { flags: [], queries: [], auth: [] });
});


test("real signed-session resolver cannot retire project detail for forged or disallowed identity", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "isolated-project-detail-test-secret";
  try {
    const { signSession } = load("src/lib/auth/session.ts", {});
    for (const [token, flagUser] of [["forged", null], [signSession({ id: 6 }, -1), null], [signSession({ id: 99 }), 99], [signSession({ id: 6 }), 6]]) {
      const retired = flagUser === 6;
      const flags = [];
      const handler = load("src/pages/api/projects/detail.ts", {
        "@/lib/prisma": { default: { project: { findFirst: async () => frozen.json.json } } },
        "@/lib/auth/betterAuth": { auth: { api: { getSession: async () => null } } },
        "@/lib/flags": { HTPR_6924_REST_COMPAT_FLAG: "htpr-6924-rest-compat", isFeatureEnabled: async (...args) => { flags.push(args); return args[1] === 6; } },
      }).default;
      const result = await pages(handler, { method: "POST", body: { projectId: 15, userId: 6 }, query: { compat: "htpr-6924" }, headers: { cookie: `ht_session=${token}` } });
      assert.equal(result.status, retired ? 410 : 200);
      assert.deepEqual(flags, flagUser === null ? [] : [["htpr-6924-rest-compat", flagUser]]);
      if (!retired) assert.equal(result.text, JSON.stringify(frozen.json.json));
    }
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});
