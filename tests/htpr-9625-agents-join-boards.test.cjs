const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const AGENT = "11111111-1111-4111-8111-111111111111";
const OWNER = 6;

function matches(row, where) {
  if (!row || !where) return false;
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((part) => matches(row, part));
    if (key === "AND") return value.every((part) => matches(row, part));
    const actual = row[key];
    if (value === null || typeof value !== "object") return actual === value;
    if ("in" in value) return value.in.includes(actual);
    if ("not" in value) return actual !== value.not;
    if ("some" in value || "none" in value) {
      return (!value.some || actual.some((item) => matches(item, value.some))) &&
        (!value.none || !actual.some((item) => matches(item, value.none)));
    }
    return matches(actual, value.is ?? value);
  });
}

function harness(options = {}) {
  const state = {
    flag: options.flag !== false,
    crossTeam: options.crossTeam === true,
    agentReads: 0,
    projects: [
      { id: 1, teamId: "home", ownerId: OWNER, status: "Normal" },
      { id: 2, teamId: options.boardTeam ?? "home", ownerId: options.ownerId ?? OWNER, status: "Normal" },
      ...(options.extraBoard ? [options.extraBoard] : []),
    ],
    agents: [{
      id: AGENT,
      userId: OWNER,
      revokedAt: null,
      archivedAt: null,
      boardHomeTeamId: "home",
      credentialTeamId: null,
      credentialTeamAccessBinding: null,
      crossTeamHomeTeamId: null,
      crossTeamAccessGranted: false,
    }],
    members: [
      { id: 10, projectId: 1, agentId: AGENT, userId: OWNER, status: "Accepted" },
      ...(options.humanMember ? [options.humanMember] : []),
    ],
  };
  const projectView = (row) => row && {
    ...row,
    team: row.teamId ? { id: row.teamId } : null,
    members: state.members.filter((item) => item.projectId === row.id),
  };
  const agentView = (row) => ({
    ...row,
    members: state.members.filter((item) => item.agentId === row.id).map((item) => ({
      ...item,
      project: { teamId: state.projects.find((project) => project.id === item.projectId)?.teamId ?? null },
    })),
  });
  const prisma = {
    project: {
      findFirst: async ({ where }) => state.projects.map(projectView).find((row) => matches(row, where)) ?? null,
    },
    agent: {
      findFirst: async ({ where }) => {
        state.agentReads += 1;
        return state.agents.map(agentView).find((row) => matches(row, where)) ?? null;
      },
      findUnique: async () => ({ permissions: { role: "read" } }),
      update: async () => { throw new Error("agent provenance write"); },
    },
    member: {
      findFirst: async ({ where }) => state.members.find((row) => matches(row, where)) ?? null,
      findMany: async ({ where }) => state.members.filter((row) => matches(row, where)).map((row) => ({ projectId: row.projectId })),
      createMany: async ({ data }) => {
        for (const row of data) state.members.push({ id: 100 + state.members.length, status: "Accepted", ...row });
        return { count: data.length };
      },
      deleteMany: async () => { throw new Error("member removed"); },
    },
    $transaction: async (run, settings) => {
      assert.deepEqual(settings, { isolationLevel: "Serializable" });
      if (options.demoteOnTransaction) {
        for (const row of state.members) {
          if (row.agentId == null && row.role === "Admin") row.role = "Member";
        }
      }
      return run(prisma);
    },
  };
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      assert.equal(key, "htpr-9625-agents-join-boards");
      assert.equal(userId, OWNER);
      return state.flag;
    } },
    "@/lib/agents/crossTeam": { crossTeamAgentsEnabled: async () => state.crossTeam, ownerTeamWhere: () => ({}) },
    "@/lib/agents/publicAgent": { publicAgentSelect: { id: true } },
    "@/lib/agents/visibility": {},
    "@/lib/agents/runtimeState": {},
    "@/lib/mcp/agents/lifecycle": {},
    "@/lib/mcp/auth": {
      checkMcpRateLimit: async () => null,
      validateMcpAuth: async () => ({ user: { id: OWNER, email: "owner@example.test" }, agentId: AGENT, teamScope: null }),
      createMcpToken: () => "test-token",
      managementAgentTokenScope: (management) => management,
      agentTokenCredentialFields: () => ({ mcpTokenHash: "test-hash" }),
    },
    "@/lib/mcp/agents/scopes": { requireRole: async () => { throw new Error("self-join must not read the agent role"); } },
    "@/lib/auth/agentScope": { agentScopeEnforced: () => true, recordAgentBoardScopeMiss: () => {} },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/lib/mcp/managementKeyTeamScope": { agentWithinTeamWhere: () => ({}) },
  };
  const updates = load("src/lib/mcp/agents/lifecycleRequests.ts", mocks);
  return {
    state,
    patch: (body) => updates.handlePatchAgentRequest({ json: async () => body }, AGENT),
  };
}

function invite(projectId) {
  return `Ask a member of board ${projectId} to run: hypertask project invite ${projectId} --user ${AGENT}`;
}

async function refused(response, projectId) {
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.code, "forbidden");
  assert.equal(body.error, invite(projectId));
  assert.match(body.error, /project invite/);
  assert.equal(body.error.includes("home"), false);
  assert.equal(body.error.includes("other"), false);
}

test("flag off keeps today's refusal and names project invite", async () => {
  const h = harness({ flag: false });
  const before = h.state.members.map((row) => row.projectId);
  await refused(await h.patch({ add_project_ids: [2] }), 2);
  assert.deepEqual(h.state.members.map((row) => row.projectId), before);
  assert.equal(h.state.agentReads, 0);
});

test("refuses a board in another team even when the owner could invite", async () => {
  const h = harness({ boardTeam: "other", crossTeam: true });
  const before = h.state.members.map((row) => row.projectId);
  await refused(await h.patch({ add_project_ids: [2] }), 2);
  assert.deepEqual(h.state.members.map((row) => row.projectId), before);
});

test("refuses a board the owner cannot see", async () => {
  const h = harness({ ownerId: 99 });
  const before = h.state.members.map((row) => row.projectId);
  await refused(await h.patch({ add_project_ids: [2] }), 2);
  assert.deepEqual(h.state.members.map((row) => row.projectId), before);
});

test("refuses a same-team board the owner can see but cannot invite to", async () => {
  const h = harness({
    ownerId: 99,
    humanMember: { id: 11, projectId: 2, agentId: null, userId: OWNER, status: "Accepted", role: "Member" },
  });
  await refused(await h.patch({ add_project_ids: [2] }), 2);
  assert.deepEqual(h.state.members.filter((row) => row.agentId === AGENT).map((row) => row.projectId), [1]);
});

test("still allowed: own-team board the owner can invite to succeeds through agents update", async () => {
  const h = harness();
  const response = await h.patch({ add_project_ids: [2] });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.agent, { id: AGENT, project_ids: [1, 2] });
  assert.deepEqual(body.changes, { added_projects: 1, removed_projects: 0 });
  assert.deepEqual(body.acted_by, { agent_id: AGENT });
  assert.deepEqual(h.state.members.map((row) => row.projectId), [1, 2]);
});

test("still allowed: own-team board where the owner is a project admin succeeds through the same route", async () => {
  const h = harness({
    ownerId: 99,
    humanMember: { id: 11, projectId: 2, agentId: null, userId: OWNER, status: "Accepted", role: "Admin" },
  });
  const response = await h.patch({ add_project_ids: [2] });
  assert.equal(response.status, 200);
  assert.deepEqual(h.state.members.filter((row) => row.agentId === AGENT).map((row) => row.projectId), [1, 2]);
});

test("a demotion inside the transaction refuses the self-join and writes nothing", async () => {
  const h = harness({
    ownerId: 99,
    demoteOnTransaction: true,
    humanMember: { id: 11, projectId: 2, agentId: null, userId: OWNER, status: "Accepted", role: "Admin" },
  });
  const response = await h.patch({ add_project_ids: [2] });
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, invite(2));
  assert.match(body.error, /project invite/);
  assert.deepEqual(h.state.members.filter((row) => row.agentId === AGENT).map((row) => row.projectId), [1]);
});

test("a mixed add refuses the other-team board and writes nothing", async () => {
  const h = harness({
    crossTeam: true,
    extraBoard: { id: 3, teamId: "other", ownerId: OWNER, status: "Normal" },
  });
  await refused(await h.patch({ add_project_ids: [2, 3] }), 3);
  assert.deepEqual(h.state.members.map((row) => row.projectId), [1]);
});

test("self-remove stays refused and names project invite", async () => {
  const h = harness();
  await refused(await h.patch({ remove_project_ids: [1] }), 1);
  assert.deepEqual(h.state.members.map((row) => row.projectId), [1]);
});
