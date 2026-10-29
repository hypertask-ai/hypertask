const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { fixture, matches, hydrate } = require("./helpers/agent-board-scope.cjs");

function harness(area, { actor = "agent", enforce = true, teamless = false, grant = "none", bypassProjectGate = false, empty = false, authenticated = true } = {}) {
  const f = fixture();
  f.state.enforce = enforce;
  const project = f.projects[2];
  Object.assign(project, { teamId: teamless ? null : "team", team: { id: "team", aiProviderSettings: {} }, staleWarnDays: 7, staleHotDays: 14 });
  if (actor !== "agent") f.state.ctx.agentId = null;
  if (actor === "member" || actor === "outsider") f.state.ctx.user = { id: 7 };
  if (actor === "member") project.members.push({ userId: 7, agentId: null, status: "Accepted", user: { id: 7, displayName: "Member", email: "member@example.invalid" } });
  if (grant !== "none") {
    project.members.push({ userId: 6, agentId: f.agent.id, status: grant === "pending" ? "Pending" : "Accepted", agent: f.agent });
    if (grant === "revoked") f.agent.revokedAt = new Date();
    if (grant === "wrong-owner") f.agent.userId = 9;
  }
  for (const task of f.tasks) Object.assign(task, { deletedAt: null, createdAt: new Date(), updatedAt: new Date(), sectionChangedAt: new Date(), lastCommentAt: null });
  if (empty) f.tasks.splice(0);
  const projectQueries = [], taskQueries = [], taskResults = [], generated = [], saved = [];
  const findProject = f.prisma.project.findFirst;
  f.prisma.project.findFirst = async args => {
    projectQueries.push(args);
    return bypassProjectGate ? hydrate(project, args) : findProject(args);
  };
  const findTasks = f.prisma.task.findMany;
  f.prisma.task.findMany = async args => {
    taskQueries.push(args);
    const rows = await findTasks(args);
    taskResults.push(rows);
    return rows;
  };
  f.prisma.comment = { groupBy: async () => [] };
  const getSessionUser = async () => {
    if (!authenticated) return null;
    await f.scope.prepareAgentScope(f.state.ctx.user.id, f.state.ctx.agentId);
    return { userId: f.state.ctx.user.id, agentId: f.state.ctx.agentId };
  };
  const route = f.load(`src/app/api/reports/${area}/route.ts`, {
    "@/lib/auth/getSessionUser": { getSessionUser },
    "@/lib/auth/currentUser": { loadCurrentUser: async () => {
      const session = await getSessionUser();
      return session ? { userId: session.userId, user: { id: session.userId } } : null;
    } },
    "next/headers": { cookies: async () => ({ get: () => authenticated ? { value: JSON.stringify({ id: f.state.ctx.user.id }) } : undefined }) },
    "@/app/api/ai/_lib/byokKeys": { getAiDefaultModelContext: async () => ({ haiku55Enabled: false }), getTeamGatewayApiKey: async () => "fixture-key" },
    "@/app/api/ai/_lib/modelProvider": { resolveAiModel: () => ({}), configureAiModelUsage: () => {}, providerOptionsForAiModel: () => ({}) },
    "@/lib/systemModelLadder": { resolveSystemModel: () => ({ model: "fixture-model", provider: "gateway" }) },
    "@/utils/controllers/reports/reportService": {
      getReport: async () => null,
      createReport: async payload => { saved.push(payload); },
      updateReport: async payload => { saved.push(payload); },
      getReportUrl: () => "/fixture-report",
      ReportValidationError: class extends Error {},
    },
    ai: { Output: { object: () => ({}) }, generateText: async args => {
      generated.push(args);
      return { output: { headline: "Fixture status", shipped: [], inFlight: [], risks: [] } };
    } },
  });
  async function request(id = project.id) {
    const method = area === "velocity" ? "GET" : "POST";
    const req = new NextRequest(`https://app.hypertask.ai/api/reports/${area}?projectId=${id}&range=7d&agentId=forged-agent&userId=999`, {
      method,
      ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: id, range: "7d", agentId: "forged-agent", userId: 999 }) } : {}),
    });
    return route[method](req);
  }
  return { ...f, project, projectQueries, taskQueries, taskResults, generated, saved, request };
}

for (const area of ["status-update", "velocity"]) {
  test(`${area}: ungranted agent now refused in ENFORCE`, async () => {
    const h = harness(area);
    assert.equal((await h.request()).status, 404);
    assert.equal(h.taskQueries.length, 0);
    assert.equal(h.generated.length, 0);
    assert.equal(h.saved.length, 0);
    assert.equal(h.state.flagReads, 1);
  });

  test(`${area}: same ungranted agent still allowed with flag Off (WATCH)`, async () => {
    const h = harness(area, { enforce: false });
    assert.equal((await h.request()).status, 200);
    assert.equal(h.state.flagReads, 1);
    assert.ok(h.taskResults.every(rows => rows.length === 1));
  });

  test(`${area}: Accepted same-owner agent grant still allowed in ENFORCE`, async () => {
    const h = harness(area, { grant: "accepted" });
    assert.equal((await h.request()).status, 200);
    assert.ok(h.taskResults.every(rows => rows.length === 1));
  });

  for (const grant of ["pending", "revoked", "wrong-owner"]) {
    test(`${area}: ${grant} agent grant still refused`, async () => {
      const h = harness(area, { grant });
      assert.equal((await h.request()).status, 404);
      assert.equal(h.taskQueries.length, 0);
    });
  }

  for (const actor of ["owner", "member"]) {
    test(`${area}: human ${actor} still allowed`, async () => {
      const h = harness(area, { actor });
      assert.equal((await h.request()).status, 200);
      assert.equal(h.state.flagReads, 0);
      assert.ok(h.taskResults.every(rows => rows.length === 1));
    });
  }

  test(`${area}: non-member human and teamless owner still refused`, async () => {
    for (const options of [{ actor: "outsider" }, { actor: "owner", teamless: true }]) {
      const h = harness(area, { ...options });
      assert.equal((await h.request()).status, 404);
      assert.equal(h.taskQueries.length, 0);
    }
  });

  test(`${area}: empty report still allowed for a human owner`, async () => {
    const h = harness(area, { actor: "owner", empty: true });
    const response = await h.request();
    assert.equal(response.status, 200);
    assert.ok(h.taskResults.every(rows => rows.length === 0));
    if (area === "velocity") assert.equal((await response.json()).now.openTotal, 0);
    else assert.equal(h.saved.length, 1);
  });

  test(`${area}: recorded task queries independently refuse ungranted agent data in ENFORCE`, async () => {
    const h = harness(area, { bypassProjectGate: true });
    assert.equal((await h.request()).status, 200);
    assert.equal(h.taskQueries.length, area === "velocity" ? 1 : 2);
    assert.ok(h.taskResults.every(rows => rows.length === 0));
    for (const query of h.taskQueries) assert.equal(matches(h.tasks[2], query.where), false);
  });

  test(`${area}: recorded queries retain project, deletion, status, history and movement predicates`, async () => {
    const h = harness(area, { grant: "accepted" });
    assert.equal((await h.request()).status, 200);
    for (const [index, query] of h.taskQueries.entries()) {
      const task = h.tasks[2];
      assert.equal(matches(task, query.where), true);
      assert.equal(matches({ ...task, projectId: h.projects[0].id, project: h.projects[0] }, query.where), false);
      assert.equal(matches({ ...task, deletedAt: new Date() }, query.where), false);
      assert.equal(matches({ ...task, status: "Deleted" }, query.where), false);
      assert.equal(matches({ ...task, status: "Archive", updatedAt: new Date(), sectionChangedAt: new Date() }, query.where), true);
      assert.equal(matches({ ...task, status: "Archive", updatedAt: new Date(0), sectionChangedAt: new Date(0) }, query.where), false);
      if (index === 0) {
        assert.equal(matches({ ...task, status: "Normal", updatedAt: new Date(0), sectionChangedAt: new Date(0) }, query.where), true);
        assert.equal(matches({ ...task, status: "Archive", updatedAt: new Date(), sectionChangedAt: new Date(0) }, query.where), true);
      } else {
        assert.equal(query.take, 60);
        assert.deepEqual(query.orderBy, { sectionChangedAt: "desc" });
        assert.equal(matches({ ...task, sectionChangedAt: new Date(0) }, query.where), false);
      }
      assert.equal(matches({ ...task, project: { ...h.project, teamId: null } }, query.where), false);
      const members = h.project.members;
      h.project.members = [];
      assert.equal(matches(task, query.where), false);
      h.project.members = members;
    }
  });

  test(`${area}: agent grant alone never widens the original human predicate`, async () => {
    for (const enforce of [true, false]) {
      const h = harness(area, { grant: "accepted", enforce });
      h.project.ownerId = 99;
      h.project.owner = { id: 99, agents: [] };
      assert.equal((await h.request()).status, 404);
      assert.equal(h.taskQueries.length, 0);
    }
  });

  test(`${area}: missing identity and invalid board ids still refused`, async () => {
    const anonymous = harness(area, { authenticated: false });
    assert.equal((await anonymous.request()).status, 401);
    const h = harness(area, { actor: "owner" });
    assert.equal((await h.request(0)).status, 400);
    assert.equal(h.projectQueries.length, 0);
  });
}
