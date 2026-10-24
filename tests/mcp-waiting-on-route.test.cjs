const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest, NextResponse } = require("next/server");
const { load } = require("./task-route-loader.cjs");
const { loadRouteWrapper } = require("./helpers/mcp-route-wrapper.cjs");
const { access: projectAccess, matches } = require("./helpers/agent-board-scope.cjs");

function fixture(options = {}) {
  const owner = { id: 7, displayName: "Owner", email: "owner@example.invalid" };
  const ctx = { user: owner, agentId: "agent-owner", agentRole: "write", teamScope: null, ...options.ctx };
  const task = { id: 42, projectId: 15, waitingOnUserId: 8, waitingOnSetById: 7, waitingOnSetAt: new Date() };
  const writes = [], activities = [], boards = [], inboxes = [], access = [], members = [], leases = [];
  const projectWhere = projectAccess.getProjectWhere;
  const project = {
    ownerId: options.ownerDenied ? 99 : 7,
    teamId: "team-1",
    members: options.scopeDenied ? [] : [{ userId: 7, agentId: "agent-owner", status: "Accepted", agent: { userId: 7, revokedAt: null } }],
  };
  const db = {
    task: {
      findFirst: async ({ where }) => {
        access.push(where);
        assert.equal(where.id, 42);
        assert.deepEqual(where.status, { not: "Deleted" });
        const conditions = where.project.AND ?? [where.project];
        assert.deepEqual(conditions[0], projectWhere(7));
        if (conditions.length > 1) assert.deepEqual(conditions[1], projectWhere(7, ctx.agentId, ctx.teamScope));
        return matches({ ...task, status: options.deleted ? "Deleted" : "Normal", project }, where) ? { ...task } : null;
      },
      update: async (query) => {
        writes.push(query);
        assert.deepEqual(query.where, { id: 42 });
        assert.deepEqual(query.select, { id: true, waitingOnUserId: true, waitingOnSetById: true, waitingOnSetAt: true });
        Object.assign(task, query.data);
        const { id, waitingOnUserId, waitingOnSetById, waitingOnSetAt } = task;
        return { id, waitingOnUserId, waitingOnSetById, waitingOnSetAt };
      },
    },
    user: { findUnique: async ({ where }) => where.id === 7 ? owner : { displayName: "Member" } },
  };
  const mocks = {
    "@/lib/auth/agentScope": {
      withAgentScopeRequest: (_request, run) => run(),
      prepareAgentScope: async () => {},
    },
    "@/lib/prisma": { default: db },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/flags/keys": { HTPR_7665_AGENT_READ_ROLE_GUARD_FLAG: "htpr-7665-agent-read-role-guard" },
    "@/lib/mcp/auth": {
      checkMcpRateLimit: async () => options.limited ? NextResponse.json({ success: false, error: "Rate limited" }, { status: 429 }) : null,
      validateMcpAuth: async () => options.noAuth ? null : ctx,
      mcpUnauthorizedResponse: async () => NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: projectWhere },
    "@/lib/mcp/tasks/services": {
      validateProjectMemberIds: async (projectId, ids) => {
        members.push({ projectId, ids });
        return { invalidIds: options.nonMember ? ids : [], error: options.memberError ?? null };
      },
    },
    "@/utils/controllers/activities/createActivity": { default: async (activity) => { activities.push(activity); } },
    "@/lib/realtime/server": {
      broadcastBoardChange: async (...args) => { boards.push(args); },
      broadcastInboxChange: async (...args) => { inboxes.push(args); },
    },
    "@/lib/aiFeedback/automatic": { queueRestFailure: () => {} },
    "@/lib/mcp/tasks/agentMutationLeaseAdoption": {
      withAdoptedAgentMutationLease: async (client, actor, run) => {
        assert.equal(client, db);
        leases.push(actor);
        return run();
      },
    },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => options.noAuth ? null : { userId: 7 } },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => null },
  };
  mocks["@/lib/mcp/routeWrapper"] = loadRouteWrapper(mocks);
  const { POST } = load("src/app/api/mcp/tasks/waiting-on/route.ts", mocks);
  const session = load("src/lib/api/task-writes/waiting-on.ts", mocks).POST;
  const pages = load("src/pages/api/tasks/waiting-on.ts", mocks).default;
  const request = (body, raw = false) => new NextRequest("http://mcp.test/api/mcp/tasks/waiting-on", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
  return {
    owner, ctx, writes, activities, boards, inboxes, access, members, leases,
    post: (body, raw = false) => POST(request(body, raw)),
    session: (body) => session(request(body)),
    pages: async (body) => {
      let result;
      const res = {
        setHeader: () => {},
        status: (status) => ({ json: (value) => { result = { status, body: value }; } }),
      };
      await pages({ method: "POST", body, headers: {}, cookies: {}, query: {} }, res);
      return result;
    },
  };
}

test("now refused: read-role agents cannot write or look up task content", async () => {
  const f = fixture({ ctx: { agentRole: "read" } });
  const response = await f.post({ taskId: 42, userId: 9 });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "insufficient_scope");
  assert.deepEqual(f.access, []);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.activities, []);
  assert.deepEqual(f.leases, []);
});

test("still allowed: an owner agent sets a board member then clears through the shared write", async () => {
  const f = fixture();
  const response = await f.post({ taskId: 42, userId: 9 });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.deepEqual({ ...result.task, waitingOnSetAt: null }, { id: 42, waitingOnUserId: 9, waitingOnSetById: 7, waitingOnSetAt: null });
  assert.ok(Number.isFinite(Date.parse(result.task.waitingOnSetAt)));
  assert.ok(f.writes[0].data.waitingOnSetAt instanceof Date);
  assert.deepEqual(f.members, [{ projectId: 15, ids: [9] }]);
  assert.deepEqual(f.leases, [{ agentId: "agent-owner", userId: 7 }]);
  assert.equal(f.access[0].project.AND.length, 2);
  assert.deepEqual(f.activities, [{ taskId: 42, activityBody: { type: "TaskWaitingOn", data: { fromUserId: 7, fromUser: f.owner, waitingOnDisplayName: "Member" } } }]);
  assert.deepEqual(f.boards, [[15, { originUserId: 7 }]]);
  assert.deepEqual(f.inboxes, [[8, { originUserId: 7 }], [9, { originUserId: 7 }]]);

  const cleared = await f.post({ taskId: 42, userId: null });
  assert.equal(cleared.status, 200);
  assert.deepEqual(await cleared.json(), { success: true, task: { id: 42, waitingOnUserId: null, waitingOnSetById: null, waitingOnSetAt: null } });
  assert.equal(f.members.length, 1);
  assert.equal(f.activities[1].activityBody.data.waitingOnDisplayName, null);
  assert.deepEqual(f.inboxes.slice(2), [[9, { originUserId: 7 }]]);
});

for (const option of ["ownerDenied", "scopeDenied", "deleted"]) {
  test(`now refused: ${option} returns 404 without mutation or side effects`, async () => {
    const f = fixture({ [option]: true, ctx: { teamScope: { teamId: "team-1", accessBinding: "binding" } } });
    const response = await f.post({ taskId: 42, userId: 9 });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { success: false, error: "Task not found" });
    assert.deepEqual(f.members, []);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.activities, []);
    assert.deepEqual(f.boards, []);
    assert.deepEqual(f.inboxes, []);
  });
}

test("now refused: a target outside board membership returns 400", async () => {
  const f = fixture({ nonMember: true });
  const response = await f.post({ taskId: 42, userId: 9 });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: "User 9 is not a member of this project." });
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.activities, []);
  assert.deepEqual(f.inboxes, []);
});

test("still allowed: the existing session and Pages route retain coercion, raw receipts, activity and broadcasts", async () => {
  const f = fixture();
  const response = await f.session({ taskId: "42", userId: "9" });
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.waitingOnUserId, 9);
  assert.equal(receipt.waitingOnSetById, 7);
  assert.equal(receipt.success, undefined);
  assert.deepEqual(f.access[0].project, projectAccess.getProjectWhere(7));
  const cleared = await f.pages({ taskId: 42, userId: null });
  assert.deepEqual(cleared, { status: 200, body: { id: 42, waitingOnUserId: null, waitingOnSetById: null, waitingOnSetAt: null } });
  assert.equal(f.writes.length, 2);
  assert.equal(f.activities.length, 2);
  assert.equal(f.boards.length, 2);
  assert.deepEqual(f.inboxes.map(([id]) => id), [8, 9, 9]);
  assert.deepEqual(f.leases, []);
});

for (const body of [null, [], {}, { taskId: "42", userId: 9 }, { taskId: 42, userId: "9" }, { taskId: 42.5, userId: null }, { taskId: 42, userId: 2 ** 40 }]) {
  test(`invalid MCP body is refused before domain reads: ${JSON.stringify(body)}`, async () => {
    const f = fixture();
    assert.equal((await f.post(body)).status, 400);
    assert.deepEqual(f.access, []);
    assert.deepEqual(f.writes, []);
  });
}

test("malformed JSON, unauthorized and rate-limited requests do not write", async () => {
  const malformed = fixture();
  assert.equal((await malformed.post("{bad", true)).status, 400);
  const unauthorized = fixture({ noAuth: true });
  assert.equal((await unauthorized.post({ taskId: 42, userId: null })).status, 401);
  assert.equal((await unauthorized.session({ taskId: 42, userId: null })).status, 401);
  const limited = fixture({ limited: true });
  assert.equal((await limited.post({ taskId: 42, userId: null })).status, 429);
  for (const f of [malformed, unauthorized, limited]) assert.deepEqual(f.writes, []);
});

test("membership service errors retain their status and no duplicate inbox broadcast is emitted", async () => {
  const denied = fixture({ memberError: { status: 403, message: "Forbidden members" } });
  const refused = await denied.post({ taskId: 42, userId: 9 });
  assert.equal(refused.status, 403);
  assert.deepEqual(await refused.json(), { success: false, error: "Forbidden members" });
  assert.deepEqual(denied.writes, []);
  const allowed = fixture();
  assert.equal((await allowed.post({ taskId: 42, userId: 8 })).status, 200);
  assert.deepEqual(allowed.inboxes, [[8, { originUserId: 7 }]]);
});
