const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { fixture, matches, hydrate } = require("./helpers/agent-board-scope.cjs");

function harness({ actor = "owner", enabled = true, visibility = "TEAM", agentOwner = 99, runtimeType = "EXTERNAL" } = {}) {
  const f = fixture();
  const team = { id: "team", googleAccount: { userId: 6 } };
  f.state.ctx.agentId = actor === "agent" ? f.agent.id : null;
  f.state.ctx.user.id = actor === "member" ? 7 : actor === "other-owner" ? 8 : 6;
  const target = {
    id: "target-agent", userId: agentOwner, visibility, runtimeType, displayName: "Helper",
    createdAt: new Date(), revokedAt: null, permissions: { role: "write", postsToImportant: false, extra: "kept" },
    members: [{ project: { id: 15, teamId: "team", title: "Board" } }],
  };
  const writes = [];
  const transactions = [];
  f.prisma.team.findFirst = async args => matches(team, args.where) ? hydrate(team, args) : null;
  f.prisma.agent.findFirst = async args => {
    const snapshot = matches(target, args.where) ? hydrate(target, args) : null;
    await f.state.afterAgentRead?.(args);
    return snapshot;
  };
  f.prisma.agent.findUnique = f.prisma.agent.findFirst;
  f.prisma.agent.update = async args => {
    assert.ok(matches(target, args.where));
    writes.push(args);
    Object.assign(target, args.data);
    return hydrate(target, args);
  };
  f.prisma.$executeRaw = async (strings, ...values) => {
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    const match = sql.match(/^UPDATE "Agent" SET "permissions" = \(CASE WHEN jsonb_typeof\("permissions"\) = 'object' THEN "permissions" ELSE '\{\}'::jsonb END\) \|\| jsonb_build_object\('(role|postsToImportant)', \?::(text|boolean)\) WHERE "id" = \?$/);
    assert.ok(match, `Expected a parameterized, single-key JSONB merge: ${sql}`);
    const key = match[1];
    assert.equal(match[2], key === "role" ? "text" : "boolean");
    assert.equal(values.length, 2);
    assert.equal(values[1], target.id);
    writes.push({ sql, values });
    target.permissions = { ...target.permissions, [key]: values[0] };
    return 1;
  };
  f.prisma.$transaction = async (run, options) => {
    transactions.push(options);
    return run(f.prisma);
  };
  const mocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => actor === "anonymous" ? null : {
      userId: f.state.ctx.user.id, agentId: f.state.ctx.agentId,
    } },
    "@/lib/flags": { isFeatureEnabled: async () => enabled, isOwnerOrQaUserId: async () => false },
    "@/lib/mcp/auth": {},
    "@/lib/aiModelOptions": {},
    "@/lib/nativeAgent/modelPin": { UNPINNABLE_MODEL_OPTION_IDS: new Set() },
    "@/lib/agents/working": {},
    "@/lib/agents/ownedSlugs": {
      resolveOwnedAgent: async () => null,
      ownedAgentSlugs: async () => new Map(),
    },
    "@/lib/agents/slug": { looksLikeAgentId: () => true },
    "@/lib/mcp/agents/ownedAgents": {},
    "@/lib/agents/runtimeState": {},
  };
  const route = f.load("src/app/api/agents/[agentId]/route.ts", mocks);
  async function request(body = { teamId: "team", role: "read" }, agentId = target.id) {
    return route.PATCH(new NextRequest(`https://app.hypertask.ai/api/agents/${agentId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body),
    }), { params: Promise.resolve({ agentId }) });
  }
  return { ...f, team, target, writes, transactions, request, mocks };
}

for (const role of ["read", "write", "admin"]) {
  test(`team owner now allowed to set ${role} on a team-visible member-owned agent`, async () => {
    const h = harness();
    const response = await h.request({ teamId: "team", role });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, agent: { id: h.target.id, role } });
    assert.deepEqual(h.target.permissions, { role, postsToImportant: false, extra: "kept" });
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.transactions, [undefined]);
    const scopes = h.load("src/lib/mcp/agents/scopes.ts");
    assert.equal(await scopes.getAgentRole({ agentId: h.target.id }), role);
  });
}

for (const [actor, status] of [["member", 403], ["agent", 403], ["other-owner", 403], ["anonymous", 401]]) {
  test(`${actor} still refused role changes`, async () => {
    const h = harness({ actor });
    assert.equal((await h.request()).status, status);
    assert.equal(h.writes.length, 0);
    assert.equal(h.target.permissions.role, "write");
  });
}

test("a non-owner team member still cannot change their own agent's role", async () => {
  const h = harness({ actor: "member", agentOwner: 7 });
  assert.equal((await h.request()).status, 403);
  assert.equal(h.writes.length, 0);
});

test("another team's owner is still refused even when submitting their own team", async () => {
  const h = harness({ actor: "other-owner" });
  h.team.id = "other-team";
  h.team.googleAccount.userId = 8;
  assert.equal((await h.request({ teamId: "other-team", role: "admin" })).status, 404);
  assert.equal(h.writes.length, 0);
});

test("flag Off still refuses the owner's role mutation", async () => {
  const h = harness({ enabled: false });
  assert.equal((await h.request()).status, 403);
  assert.equal(h.writes.length, 0);
  assert.equal(h.transactions.length, 0);
});

test("flag Off preserves existing owned-agent name editing", async () => {
  const h = harness({ enabled: false, agentOwner: 6 });
  assert.equal((await h.request({ displayName: "Renamed" })).status, 200);
  assert.equal(h.target.displayName, "Renamed");
  assert.equal(h.target.permissions.role, "write");
});

for (const body of [null, [], "{", { role: "owner", teamId: "team" }, { role: "read" }, { teamId: "team" }, { role: "read", teamId: " " }, { role: "read", teamId: "team", revoked: true }]) {
  test(`invalid or mixed role body is refused: ${JSON.stringify(body)}`, async () => {
    const h = harness();
    assert.equal((await h.request(body)).status, 400);
    assert.equal(h.writes.length, 0);
  });
}

test("unattached, cross-team, unknown and another user's private agents stay refused", async () => {
  for (const scenario of ["unattached", "cross-team", "unknown", "private"]) {
    const h = harness({ visibility: scenario === "private" ? "PRIVATE" : "TEAM" });
    if (scenario === "unattached") h.target.members = [];
    if (scenario === "cross-team") h.target.members.push({ project: { teamId: "other-team" } });
    assert.equal((await h.request(undefined, scenario === "unknown" ? "missing-agent" : h.target.id)).status, 404);
    assert.equal(h.writes.length, 0);
  }
});

test("owner's own private agent remains manageable and missing permissions default safely", async () => {
  const h = harness({ visibility: "PRIVATE", agentOwner: 6 });
  h.target.permissions = null;
  assert.equal((await h.request()).status, 200);
  assert.deepEqual(h.target.permissions, { role: "read" });
});

for (const enabled of [false, true]) {
  test(`team list exposes effective roles only with the role screen flag ${enabled ? "On" : "Off"}`, async () => {
    const h = harness({ enabled });
    h.target.permissions = null;
    h.prisma.agent.findMany = async () => [h.target];
    h.prisma.comment = { ...h.prisma.comment, groupBy: async () => [] };
    h.prisma.oAuthAuthorizationCode = { findMany: async () => [] };
    const route = h.load("src/app/api/agents/route.ts", {
      ...h.mocks,
      "@/utils/controllers/teams/hasTeamMembershipAccess": { hasTeamMembershipAccess: async () => true },
      "@/utils/controllers/agents/ensureDefaultTeamAgent": {},
      "@/utils/controllers/agents/boardMembers": {},
    });
    const response = await route.GET(new NextRequest("https://app.hypertask.ai/api/agents?teamId=team"));
    assert.equal(response.status, 200);
    const { agents } = await response.json();
    assert.equal(Object.hasOwn(agents[0], "role"), enabled);
    if (enabled) assert.equal(agents[0].role, "write");
    assert.equal(Object.hasOwn(agents[0], "permissions"), false);
  });
}

for (const role of ["read", "write", "admin"]) {
  test(`native agent role change to ${role} is refused without changing permissions`, async () => {
    const h = harness({ runtimeType: "NATIVE" });
    const response = await h.request({ teamId: "team", role });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      success: false, error: "This agent's role cannot be changed yet",
    });
    assert.equal(h.writes.length, 0);
    assert.equal(h.target.permissions.role, "write");
  });
}

for (const pausedWriter of ["preference", "role"]) {
  test(`a stale ${pausedWriter} request preserves the other writer's latest permission`, { timeout: 5000 }, async () => {
    const h = harness({ agentOwner: 6 });
    h.target.permissions = { role: "admin", postsToImportant: false, extra: "kept" };
    let markRead;
    const read = new Promise(resolve => { markRead = resolve; });
    let release;
    const resume = new Promise(resolve => { release = resolve; });
    h.state.afterAgentRead = async args => {
      const isPausedRead = pausedWriter === "preference" ? !args.select : Boolean(args.select);
      if (!isPausedRead) return;
      h.state.afterAgentRead = null;
      markRead();
      await resume;
    };
    const roleBody = { teamId: "team", role: "read" };
    const preferenceBody = { postsToImportant: true };
    const pending = h.request(pausedWriter === "preference" ? preferenceBody : roleBody);
    await read;
    try {
      const latest = await h.request(pausedWriter === "preference" ? roleBody : preferenceBody);
      assert.equal(latest.status, 200);
    } finally {
      release();
    }
    assert.equal((await pending).status, 200);
    assert.deepEqual(h.target.permissions, { role: "read", postsToImportant: true, extra: "kept" });
    assert.equal(h.writes.filter(write => write.sql).length, 2);
  });
}

test("preference-only editing initializes missing permissions without inventing a role", async () => {
  const h = harness({ agentOwner: 6 });
  h.target.permissions = null;
  const response = await h.request({ postsToImportant: false });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).agent.postsToImportant, false);
  assert.deepEqual(h.target.permissions, { postsToImportant: false });
});
