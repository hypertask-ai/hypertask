const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

const actingAgentId = "11111111-1111-4111-8111-111111111111";
const siblingAgentId = "22222222-2222-4222-8222-222222222222";
const owner = { id: 6, email: "owner@example.test", displayName: "Owner" };
const person = { id: 7, email: "person@example.test", displayName: "Person" };
const outsideScope = /This agent is not a member of project 15, so it cannot grant or remove access there/;
const selfRefusal = /cannot change (?:its|their) own board access/i;
const insufficientScope = /requires 'admin' or higher/;

function harness(mode, options = {}) {
  const state = {
    agentId: options.human ? null : actingAgentId,
    role: options.role ?? "admin",
    member: options.member !== false,
    membership: { status: "Accepted", userId: owner.id, revokedAt: null, ...options.membership },
    writes: [],
    outsideQueries: [],
    transactionQueries: [],
    transactions: [],
    misses: [],
    sent: [],
    pendingInvite: null,
    addedPerson: null,
  };
  const board = {
    id: 15, title: "Board", name: "Board", status: "Normal", teamId: "team",
    ownerId: options.humanAdmin ? 99 : owner.id, owner, members: [],
    team: {
      id: "team", title: "Team", googleAccountId: "account",
      googleAccount: { userId: owner.id }, stripe_customer_id: options.needsSeat ? "cus_test" : null,
    },
  };
  const targetAgent = { id: siblingAgentId, userId: owner.id, displayName: "Sibling", members: [] };
  const membership = async (args, inTransaction) => {
    const queries = inTransaction ? state.transactionQueries : state.outsideQueries;
    queries.push(args);
    assert.deepEqual(args, {
      where: {
        agentId: actingAgentId, projectId: { in: [15] },
        ...(mode === "ENFORCE" ? { status: "Accepted", agent: { userId: owner.id, revokedAt: null } } : {}),
      },
      select: { projectId: true },
    });
    const accepted = mode === "WATCH" || (
      state.membership.status === "Accepted" && state.membership.userId === owner.id && state.membership.revokedAt === null
    );
    return state.member && accepted ? [{ projectId: 15 }] : [];
  };
  const memberStore = (inTransaction) => ({
    findMany: (args) => membership(args, inTransaction),
    findFirst: async ({ where }) => {
      if (where.agentId) return null;
      if (where.userId === owner.id && options.humanAdmin) return { id: 30, role: "Admin" };
      return state.addedPerson;
    },
    create: async ({ data }) => {
      state.writes.push({ kind: "member.create", inTransaction, data });
      const row = { id: 40, ...data, agent: data.agentId ? { ...targetAgent, id: data.agentId } : null, user: person };
      if (!data.agentId) state.addedPerson = row;
      return row;
    },
  });
  const inviteStore = (inTransaction) => ({
    findMany: async () => [],
    findFirst: async () => state.pendingInvite,
    create: async ({ data }) => {
      state.writes.push({ kind: "invite.create", inTransaction, data });
      state.pendingInvite = { id: "pending-invite", ...data, invitedBy: owner, project: board };
      return state.pendingInvite;
    },
    updateMany: async () => {
      state.writes.push({ kind: "invite.updateMany", inTransaction });
      return { count: 0 };
    },
    deleteMany: async () => {
      state.writes.push({ kind: "invite.deleteMany", inTransaction });
      return { count: 0 };
    },
  });
  const prisma = {
    project: { findFirst: async () => board },
    agent: {
      findUnique: async () => ({ permissions: { role: state.role } }),
      findFirst: async ({ where }) => ({ ...targetAgent, id: where.id }),
    },
    user: {
      findUnique: async ({ where }) => where.id === owner.id ? owner : person,
      findFirst: async () => options.teammate ? person : null,
    },
    member: memberStore(false),
    invite: inviteStore(false),
    member_Team: {
      findFirst: async () => options.needsSeat ? null : { status: "Accepted" },
      findUnique: async () => ({ status: "Accepted" }),
    },
    team: {
      findFirst: async () => ({ googleAccount: { userId: owner.id }, members: options.teammate ? [{ user: person }] : [] }),
      update: async () => {
        state.writes.push({ kind: "team.update", inTransaction: true });
        return { title: "Team", totalSeats: 2 };
      },
    },
  };
  prisma.$transaction = async (run, transactionOptions) => {
    state.transactions.push(transactionOptions);
    if (options.removeInTransaction) state.member = false;
    return run({ ...prisma, member: memberStore(true), invite: inviteStore(true) });
  };
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/auth/agentScope": {
      agentScopeEnforced: () => mode === "ENFORCE",
      agentScopeMode: async () => mode,
      recordAgentBoardScopeMiss: (projectId, action) => state.misses.push({ projectId, action }),
    },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (run) => run,
      validateMcpRouteAuth: async () => ({ user: owner, agentId: state.agentId }),
      checkMcpRouteRateLimit: async () => null,
      readMcpRouteJsonBody: async (request) => ({ ok: true, body: await request.json() }),
    },
    "@/lib/mcp/operationCrashReport": { reportMcpOperationCrash: (_request, error) => { throw error; } },
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async (_projectId, userId, agentId) => {
        assert.equal(userId, owner.id);
        assert.equal(agentId ?? null, state.agentId);
        return {};
      },
    },
    "@/utils/controllers/projects/isProjectAdmin": { default: async () => options.boardAdmin !== false },
    "@/utils/controllers/projects/getProjectMembers": {},
    "@/lib/agents/publicAgent": { publicAgentSelect: { id: true, displayName: true } },
    "@/lib/agents/visibility": { boardAgentVisibilityWhere: () => ({}) },
    "@/lib/telemetry/analyticsIntents": {
      processAnalyticsIntentSoon: () => {},
      enqueueOutsideSaveAndProcessSoon: async (enqueue) => enqueue(),
    },
    "@/lib/telemetry/inviteAnalytics": { enqueueInviteSent: async () => null, enqueueMemberJoined: async () => null },
    "@/utils/controllers/logs/createLog": { default: () => {} },
    "@/utils/controllers/projects/getAll": { getProjectViewInclude: () => ({}) },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getViewFromProject: () => undefined },
    "@/utils/controllers/notifications/sendNotification": {
      sendEmailNotification: async (...args) => { state.sent.push(args); return true; },
    },
    "@/lib/demo/guestGuard": {},
    "@/lib/auth/getSessionUser": {},
    "@/utils/controllers/getMemberAndOwnerForBoard": {},
    "@/lib/seatBillingLock": { withTeamSeatBillingLock: async (_teamId, run) => run(() => {}) },
    "@/lib/syncSeatBilling": { mutateAndSyncSeatBilling: async (_teamId, run) => run(() => {}) },
    "@/lib/teamMembership": {
      ensureTeamMembership: async () => {
        state.writes.push({ kind: "team.ensure", inTransaction: true });
        return { member: { user: person }, created: true };
      },
    },
    "@/utils/controllers/members/updateTrial": { updateTrial: async () => {} },
    ai: { tool: (definition) => definition },
    "@/lib/ai/bulkConfirmation": {},
    "@/lib/ai/tools/execution": {
      withToolErrors: (run) => async (...args) => {
        try { return await run(...args); }
        catch (error) { return { success: false, error: error.message }; }
      },
    },
    "@/lib/ai/tools/helpers": { sanitizeForJson: (value) => value },
  };
  async function request(userToAdd = siblingAgentId) {
    const { POST } = load("src/lib/mcp/operations/projects/[projectId]/members/operation.ts", mocks);
    return POST(new NextRequest("https://app.hypertask.ai/api/mcp/projects/15/members", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userToAdd }),
    }), { params: Promise.resolve({ projectId: "15" }) });
  }
  async function aiRequest(userToAdd = siblingAgentId) {
    const { createProjectAdminTool } = load("src/lib/ai/tools/projectAdmin.ts", mocks);
    const tool = createProjectAdminTool({
      user: owner, actingAgentId: state.agentId, sendStatus: () => {}, bulkPreviewsIssued: new Set(), confirmationSessionId: "test",
    }).hypertask_project_admin;
    return tool.execute({ action: "invite_member", project_id: 15, userToAdd });
  }
  return { ...state, state, request, aiRequest };
}

async function refused(h, target, message, code) {
  const response = await h.request(target);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.match(body.error, message);
  if (code) assert.equal(body.code, code);
  assert.deepEqual(h.writes, [], "No member, invite, cleanup or seat write may run on refusal");
  assert.deepEqual(h.sent, []);
  return body;
}

async function allowed(h, target = siblingAgentId) {
  const response = await h.request(target);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.projectId, 15);
  assert.equal(body.error, undefined);
  assert.ok(h.writes.length > 0);
  if (h.state.agentId) {
    assert.ok(h.outsideQueries.length > 0);
    assert.ok(h.transactionQueries.length > 0);
    assert.ok(h.transactions.every((options) => options.isolationLevel === "Serializable"));
    assert.ok(h.writes.every((write) => write.inTransaction));
    assert.ok(h.misses.some(({ projectId, action }) => projectId === 15 && action === "write"));
  }
  return body;
}

for (const mode of ["WATCH", "ENFORCE"]) {
  test(`${mode}: now refused write-role agent inviting itself`, async () => {
    const h = harness(mode, { role: "write" });
    const body = await refused(h, actingAgentId, /cannot change (?:its|their) own board access|requires 'admin' or higher/i);
    if (!selfRefusal.test(body.error)) assert.equal(body.code, "insufficient_scope");
  });
  test(`${mode}: still allowed human board owner adding their own agent`, async () => {
    await allowed(harness(mode, { human: true }), actingAgentId);
  });

  test(`${mode}: now refused write-role agent inviting a same-owner sibling`, async () => {
    await refused(harness(mode, { role: "write" }), siblingAgentId, insufficientScope, "insufficient_scope");
  });
  test(`${mode}: still allowed admin agent adding a same-owner sibling on its board`, async () => {
    await allowed(harness(mode));
  });

  test(`${mode}: now refused admin agent inviting itself`, async () => {
    await refused(harness(mode), actingAgentId, selfRefusal);
  });
  test(`${mode}: still allowed human owner adding the agent that cannot self-grant`, async () => {
    await allowed(harness(mode, { human: true }), actingAgentId);
  });

  test(`${mode}: now refused admin agent delegating outside its own board membership`, async () => {
    const h = harness(mode, { member: false });
    await refused(h, siblingAgentId, outsideScope);
    assert.equal(h.transactions.length, 0);
  });
  test(`${mode}: still allowed admin agent delegating within its own board membership`, async () => {
    await allowed(harness(mode));
  });

  test(`${mode}: now refused admin agent after membership disappears before agent-add transaction`, async () => {
    const h = harness(mode, { removeInTransaction: true });
    await refused(h, siblingAgentId, outsideScope);
    assert.equal(h.outsideQueries.length, 1);
    assert.equal(h.transactionQueries.length, 1);
    assert.deepEqual(h.transactions, [{ isolationLevel: "Serializable" }]);
  });
  test(`${mode}: still allowed admin agent when membership survives agent-add transaction`, async () => {
    await allowed(harness(mode));
  });

  test(`${mode}: now refused write-role agent inviting a person by email`, async () => {
    await refused(harness(mode, { role: "write" }), person.email, insufficientScope, "insufficient_scope");
  });
  test(`${mode}: still allowed human board admin inviting a person by email`, async () => {
    const h = harness(mode, { human: true, humanAdmin: true });
    const body = await allowed(h, person.email);
    assert.equal(body.status, "pending_invite");
    assert.equal(h.sent.length, 1);
  });

  test(`${mode}: now refused write-role agent inviting a person by user ID`, async () => {
    await refused(harness(mode, { role: "write" }), person.id, insufficientScope, "insufficient_scope");
  });
  test(`${mode}: still allowed admin agent inviting a person by user ID`, async () => {
    const body = await allowed(harness(mode), person.id);
    assert.equal(body.status, "added");
    assert.equal(body.member.userId, person.id);
  });

  test(`${mode}: now refused admin agent inviting a person outside its board`, async () => {
    await refused(harness(mode, { member: false }), person.email, outsideScope);
  });
  test(`${mode}: still allowed admin agent inviting a person on its board`, async () => {
    const h = harness(mode);
    const body = await allowed(h, person.email);
    assert.equal(body.status, "pending_invite");
    assert.equal(h.sent.length, 1);
  });

  for (const [label, target, options] of [
    ["email pending invite", person.email, {}],
    ["email existing teammate", person.email, { teammate: true }],
    ["user ID existing teammate", person.id, {}],
    ["user ID new team seat", person.id, { needsSeat: true }],
  ]) {
    test(`${mode}: now refused removed acting-agent membership inside ${label} write`, async () => {
      const h = harness(mode, { ...options, removeInTransaction: true });
      await refused(h, target, outsideScope);
      assert.equal(h.outsideQueries.length, 1);
      assert.equal(h.transactionQueries.length, 1);
      assert.deepEqual(h.transactions, [{ isolationLevel: "Serializable" }]);
    });
    test(`${mode}: still allowed retained acting-agent membership inside ${label} write`, async () => {
      await allowed(harness(mode, options), target);
    });
  }

  for (const membership of [
    { status: "Pending" }, { userId: 99 }, { revokedAt: new Date("2026-01-01") },
  ]) {
    test(`${mode}: ${mode === "ENFORCE" ? "now refused" : "still allowed in WATCH"} legacy membership ${JSON.stringify(membership)}`, async () => {
      const h = harness(mode, { membership });
      if (mode === "ENFORCE") await refused(h, siblingAgentId, outsideScope);
      else await allowed(h);
    });
    test(`${mode}: still allowed accepted owned non-revoked membership beside legacy case ${JSON.stringify(membership)}`, async () => {
      await allowed(harness(mode));
    });
  }

  test(`${mode}: now refused human without board owner or admin authority`, async () => {
    await refused(harness(mode, { human: true, boardAdmin: false }), person.email, /Only the board owner or a project admin can add members/);
  });
  test(`${mode}: still allowed human board admin under unchanged invitation authority`, async () => {
    await allowed(harness(mode, { human: true, humanAdmin: true }), person.email);
  });

  for (const [label, target, options, message] of [
    ["self invitation", actingAgentId, {}, selfRefusal],
    ["write-role sibling invitation", siblingAgentId, { role: "write" }, insufficientScope],
    ["outside-board sibling invitation", siblingAgentId, { member: false }, outsideScope],
    ["write-role person invitation", person.email, { role: "write" }, insufficientScope],
    ["removed membership during sibling invitation", siblingAgentId, { removeInTransaction: true }, outsideScope],
    ["removed membership during person invitation", person.email, { removeInTransaction: true }, outsideScope],
  ]) {
    test(`${mode}: AI now refused ${label}`, async () => {
      const h = harness(mode, options);
      const result = await h.aiRequest(target);
      assert.equal(result.success, false);
      assert.match(result.error, message);
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.sent, []);
    });
    test(`${mode}: AI still allowed scoped admin ${target === person.email ? "person" : "sibling"} invitation beside ${label}`, async () => {
      const h = harness(mode);
      const result = await h.aiRequest(target === person.email ? person.email : siblingAgentId);
      assert.equal(result.success, true);
      assert.equal(result.projectId, 15);
      assert.ok(h.writes.length > 0);
      assert.ok(h.transactionQueries.length > 0);
      assert.ok(h.writes.every((write) => write.inTransaction));
    });
  }
}
