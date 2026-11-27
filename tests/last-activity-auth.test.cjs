const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

function harness(userId) {
  const queries = [];
  const sessionHeaders = [];
  const data = { projects: [{ id: 15, lastActivity: "2026-01-01T00:00:00.000Z" }] };
  const shared = { "next/server": { NextResponse: Response } };
  const taskWrites = loadModule("src/lib/api/task-writes/route.ts", {
    ...shared,
    "@/lib/auth/agentScope": {
      withAgentScopeRequest: (_request, operation) => operation(),
      prepareAgentScope: async () => {},
    },
    "@/lib/auth/getSessionUser": { getSessionUser: async headers => {
      sessionHeaders.push(headers);
      return userId === null ? null : { userId, source: "better-auth" };
    } },
    "better-auth/cookies": {},
    "@/lib/auth/session": {},
  });
  const { GET } = loadModule("src/lib/api/project-writes/last-activity-read.ts", {
    ...shared,
    zod: require("zod"),
    "@/lib/api/task-writes/route": taskWrites,
    "@/utils/controllers/projects/lastActivity": { __esModule: true, default: async (...args) => {
      queries.push(args);
      return { status: 200, json: data };
    } },
  });
  return { GET, queries, sessionHeaders, data };
}

for (const cookie of ["", `nookies_user=${encodeURIComponent(JSON.stringify({ id: 999 }))}`]) {
  test(`unauthenticated board activity returns 401 without querying: ${cookie ? "forged cookie" : "no cookie"}`, async () => {
    const h = harness(null);
    const request = new Request("https://app.hypertask.ai/api/projects/lastActivity", { headers: { cookie } });
    const response = await h.GET(request);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { message: "Unauthorized" });
    assert.deepEqual(h.sessionHeaders, [request.headers]);
    assert.deepEqual(h.queries, []);
  });
}

for (const userId of [23, 42]) {
  test(`board activity uses verified user ${userId}, not the legacy cookie identity`, async () => {
    const h = harness(userId);
    const cookie = `ht_session=verified; nookies_user=${encodeURIComponent(JSON.stringify({ id: 999 }))}`;
    const request = new Request("https://app.hypertask.ai/api/projects/lastActivity", { headers: { cookie } });
    const response = await h.GET(request);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), h.data);
    assert.deepEqual(h.sessionHeaders, [request.headers]);
    assert.deepEqual(h.queries, [[userId]]);
  });
}
