const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");
const { pages } = require("./legacy-task-relations-fixture.cjs");
const frozen = require("./htpr-6509-query-contracts.json").project;
const { projectContentAccessWhere } = load("src/utils/controllers/projects/getAllIncludes.ts", {
  "@/lib/agents/publicAgent": {}, "@/lib/cycles": {}, "@/lib/agents/visibility": {},
  "@/utils/controllers/notifications/visibleInboxScope": {},
});
const savedEnv = Object.fromEntries(["SESSION_SECRET", "BETTER_AUTH_ENABLED", "AUTH_LEGACY_FAST_PATH"].map((name) => [name, process.env[name]]));
process.env.SESSION_SECRET = "isolated-project-detail-test-secret";
process.env.BETTER_AUTH_ENABLED = "1";
process.env.AUTH_LEGACY_FAST_PATH = "0";
test.after(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
const { signSession } = load("src/lib/auth/session.ts", {});

function fixture({ enabled = false, compat, userId = 7, failFlag = false, failAuth = false, project = frozen.json.json, failQuery = false, realAuth = false, token } = {}) {
  const calls = { flags: [], queries: [], auth: [] };
  const handler = load("src/pages/api/projects/detail.ts", {
    "@/lib/prisma": { default: { project: { findFirst: async (args) => {
      calls.queries.push(args);
      if (failQuery) throw new Error("synthetic project failure");
      return project;
    } } } },
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere },
    "@/lib/auth/betterAuth": { auth: { api: { getSession: async () => { calls.auth.push(true); return null; } } } },
    ...(!realAuth ? { "@/lib/auth/getSessionUser": { getSessionUser: async (headers) => {
      assert.ok(headers instanceof Headers);
      calls.auth.push(true);
      if (failAuth) throw new Error("synthetic auth failure");
      return userId == null ? null : { userId };
    } } } : {}),
    "@/lib/flags": { HTPR_6924_REST_COMPAT_FLAG: "htpr-6924-rest-compat", isFeatureEnabled: async (...args) => {
      calls.flags.push(args);
      if (failFlag) throw new Error("synthetic flag failure");
      return enabled;
    } },
  }).default;
  const invoke = (body = { projectId: 15 }, method = "POST") => pages(handler, { method, body, headers: token === undefined ? {} : { cookie: `ht_session=${token}` }, query: compat === undefined ? {} : { compat } });
  return { invoke, calls };
}

for (const [name, options] of [
  ["OFF with opt-in", { compat: "htpr-6924" }],
  ["ON without opt-in", { enabled: true }],
  ["ON with wrong opt-in", { enabled: true, compat: "other" }],
  ["ON with duplicate opt-in", { enabled: true, compat: ["htpr-6924", "htpr-6924"] }],
  ["flag lookup failure", { enabled: true, compat: "htpr-6924", failFlag: true }],
  ["ordinary audience", { enabled: false, compat: "htpr-6924", userId: 99 }],
]) {
  test(`${name} keeps frozen full-project bytes, statuses, headers and query`, async () => {
    const f = fixture(options);
    const response = await f.invoke({ projectId: 15, userId: 7, compat: "htpr-6924" });
    assert.equal(response.status, frozen.json.status);
    assert.equal(response.text, JSON.stringify(frozen.json.json));
    assert.deepEqual(response.headers, {});
    assert.equal(f.calls.queries.length, 1);
    const { relationLoadStrategy, where, include } = f.calls.queries[0];
    assert.equal(relationLoadStrategy, "join");
    assert.deepEqual(where, { id: 15, status: "Normal", ...projectContentAccessWhere(options.userId ?? 7) });
    assert.deepEqual(include, frozen.args.include);
    assert.deepEqual(Object.keys(f.calls.queries[0]).sort(), ["include", "relationLoadStrategy", "where"]);
    const optedIn = options.compat === "htpr-6924";
    assert.deepEqual(f.calls.flags, optedIn ? [["htpr-6924-rest-compat", options.userId ?? 7]] : []);
    assert.deepEqual(f.calls.auth, [true]);
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


for (const compat of [undefined, "htpr-6924"]) {
  for (const [name, token] of [["cookie-less", undefined], ["forged", "forged"], ["expired", signSession({ id: 6 }, -1)]]) {
    test(`${name} POST with compat=${compat} is Unauthorized before project queries or flag probes`, async () => {
      const f = fixture({ realAuth: true, token, enabled: true, compat });
      const result = await f.invoke({ projectId: 15, userId: 6 });
      assert.equal(result.status, 401);
      assert.equal(result.text, '{"message":"Unauthorized"}');
      assert.deepEqual(result.headers, {});
      assert.deepEqual(f.calls, { flags: [], queries: [], auth: [true] });
    });
  }

  test(`identity lookup failure with compat=${compat} returns no project data`, async () => {
    const f = fixture({ failAuth: true, enabled: true, compat });
    const result = await f.invoke();
    assert.equal(result.status, 400);
    assert.equal(result.text, '{"message":"{}"}');
    assert.deepEqual(f.calls, { flags: [], queries: [], auth: [true] });
  });

  test(`resolved unrelated user with compat=${compat} gets Project not found from the scoped query`, async () => {
    const f = fixture({ realAuth: true, token: signSession({ id: 99 }), project: null, compat });
    const result = await f.invoke({ projectId: 15, userId: 7 });
    assert.equal(result.status, 400);
    assert.equal(result.text, '{"message":"Project not found"}');
    assert.equal(f.calls.queries.length, 1);
    assert.deepEqual(f.calls.queries[0].where, { id: 15, status: "Normal", ...projectContentAccessWhere(99) });
    assert.deepEqual(f.calls.queries[0].include, frozen.args.include);
    assert.deepEqual(f.calls.flags, compat ? [["htpr-6924-rest-compat", 99]] : []);
  });

  test(`resolved member with compat=${compat} gets frozen full-project bytes`, async () => {
    const f = fixture({ realAuth: true, token: signSession({ id: 7 }), compat });
    const result = await f.invoke({ projectId: 15, userId: 999 });
    assert.equal(result.status, 200);
    assert.equal(result.text, JSON.stringify(frozen.json.json));
    assert.deepEqual(result.headers, {});
    assert.equal(f.calls.queries.length, 1);
    assert.deepEqual(f.calls.queries[0].where, { id: 15, status: "Normal", ...projectContentAccessWhere(7) });
    assert.deepEqual(f.calls.queries[0].include, frozen.args.include);
    assert.equal(f.calls.queries[0].relationLoadStrategy, "join");
    assert.deepEqual(f.calls.flags, compat ? [["htpr-6924-rest-compat", 7]] : []);
  });
}

for (const userId of [6, 99]) {
  test(`real signed-session resolver uses user ${userId} for the retirement probe`, async () => {
    const f = fixture({ realAuth: true, token: signSession({ id: userId }), enabled: userId === 6, compat: "htpr-6924" });
    const result = await f.invoke({ projectId: 15, userId: 6 });
    assert.equal(result.status, userId === 6 ? 410 : 200);
    assert.deepEqual(f.calls.flags, [["htpr-6924-rest-compat", userId]]);
    if (userId === 6) {
      assert.equal(result.text, '{"error":"Legacy project detail has been retired","replacement":"/api/projects/boardTasks"}');
      assert.deepEqual(f.calls.queries, []);
    } else {
      assert.equal(result.text, JSON.stringify(frozen.json.json));
      assert.deepEqual(f.calls.queries[0].where, { id: 15, status: "Normal", ...projectContentAccessWhere(userId) });
      assert.deepEqual(f.calls.queries[0].include, frozen.args.include);
    }
  });
}

for (const project of [frozen.json.json, null]) {
  test(`signed agent session retains active-agent scope when the query ${project ? "succeeds" : "denies access"}`, async () => {
    const agentId = "fixture-agent";
    const f = fixture({ realAuth: true, token: signSession({ id: 7, agentId }), project });
    const result = await f.invoke({ projectId: 15, userId: 99, agentId: "forged-agent" });
    assert.equal(result.status, project ? 200 : 400);
    assert.equal(result.text, project ? JSON.stringify(frozen.json.json) : '{"message":"Project not found"}');
    assert.equal(f.calls.queries.length, 1);
    const { where, include } = f.calls.queries[0];
    assert.deepEqual(where, { id: 15, status: "Normal", ...projectContentAccessWhere(7, agentId) });
    assert.deepEqual(where.OR, [
      { owner: { id: 7, agents: { some: { id: agentId, userId: 7, revokedAt: null } } } },
      { members: { some: { userId: 7, agentId: null, user: { agents: { some: { id: agentId, userId: 7, revokedAt: null } } } } } },
      { members: { some: { agentId, agent: { userId: 7, revokedAt: null } } } },
    ]);
    assert.deepEqual(include, frozen.args.include);
    assert.deepEqual(f.calls.flags, []);
  });
}

test("signed agent claim for a different identity is not attached to the resolved user", async () => {
  const f = fixture({ userId: 99, token: signSession({ id: 7, agentId: "fixture-agent" }) });
  const result = await f.invoke();
  assert.equal(result.status, 200);
  assert.equal(result.text, JSON.stringify(frozen.json.json));
  assert.deepEqual(f.calls.queries[0].where, { id: 15, status: "Normal", ...projectContentAccessWhere(99) });
  assert.deepEqual(f.calls.queries[0].include, frozen.args.include);
});
