const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { fixture, matches } = require("./helpers/agent-board-scope.cjs");

function harness({ actor = "agent", enforce = true, teamless = false, grant = "none" } = {}) {
  const f = fixture();
  f.state.enforce = enforce;
  const project = f.projects[2];
  Object.assign(project, { teamId: teamless ? null : "team", targetDate: null, milestones: [], statusUpdates: [] });
  if (actor !== "agent") f.state.ctx.agentId = null;
  if (actor === "member" || actor === "outsider") f.state.ctx.user = { id: 7 };
  if (actor === "member") project.members.push({ userId: 7, agentId: null, status: "Accepted", role: "Member" });
  if (grant !== "none") {
    project.members.push({ userId: 6, agentId: f.agent.id, status: grant === "invited" ? "Invited" : "Accepted", agent: f.agent });
    if (grant === "revoked") f.agent.revokedAt = new Date();
    if (grant === "wrong-owner") f.agent.userId = 9;
  }
  const queries = [];
  for (const method of ["findFirst", "update"]) {
    const original = f.prisma.project[method];
    f.prisma.project[method] = async args => {
      queries.push({ method, ...args });
      return original(args);
    };
  }
  const labelQueries = [];
  f.prisma.label = { findMany: async args => {
    labelQueries.push(args);
    return [{ id: "label", projectId: project.id, task: [], _count: { task: 0 } }];
  } };
  const route = f.load("src/app/api/projects/planning/route.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => {
      await f.scope.prepareAgentScope(f.state.ctx.user.id, f.state.ctx.agentId);
      return { userId: f.state.ctx.user.id, agentId: f.state.ctx.agentId };
    } },
    "@/lib/cycleService": { getProjectCycleOverview: async () => ({}), setProjectCyclesEnabled: async () => {} },
  });
  const labels = f.load("src/pages/api/labels/getByProject.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => {
      await f.scope.prepareAgentScope(f.state.ctx.user.id, f.state.ctx.agentId);
      return { userId: f.state.ctx.user.id, agentId: f.state.ctx.agentId };
    } },
  }).default;
  async function planning(method = "POST", action = "set_target_date", id = project.id) {
    const req = new NextRequest(`https://app.hypertask.ai/api/projects/planning?projectId=${id}`, {
      method,
      ...(method === "POST" ? { body: JSON.stringify({ projectId: id, action, targetDate: "2026-11-01", health: "OnTrack", message: "Still allowed", agentId: "forged-agent" }), headers: { "content-type": "application/json" } } : {}),
    });
    return route[method](req);
  }
  async function readLabels(id = project.id) {
    const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await labels({ url: `/api/labels/getByProject?projectId=${id}`, method: "GET", headers: {}, query: { projectId: String(id), agentId: "forged-agent" } }, res);
    return res;
  }
  return { ...f, project, queries, labelQueries, planning, readLabels };
}

for (const area of ["planning", "labels"]) {
  async function request(h) {
    const response = area === "planning" ? await h.planning() : await h.readLabels();
    return area === "planning" ? response.status : response.statusCode;
  }

  test(`${area}: ungranted agent now refused in ENFORCE`, async () => {
    const h = harness();
    assert.equal(await request(h), 404);
    assert.equal(h.state.flagReads, 1);
    assert.deepEqual(h.state.writes, []);
    assert.equal(h.labelQueries.length, 0);
  });

  test(`${area}: same ungranted agent still allowed with flag Off (WATCH)`, async () => {
    const h = harness({ enforce: false });
    assert.equal(await request(h), 200);
    assert.equal(h.state.flagReads, 1);
  });

  test(`${area}: Accepted same-owner grant still allowed in ENFORCE`, async () => {
    const h = harness({ grant: "accepted" });
    assert.equal(await request(h), 200);
  });

  for (const grant of ["invited", "revoked", "wrong-owner"]) {
    test(`${area}: ${grant} grant refused in ENFORCE`, async () => {
      const h = harness({ grant });
      assert.equal(await request(h), 404);
      assert.deepEqual(h.state.writes, []);
      assert.equal(h.labelQueries.length, 0);
    });
  }

  test(`${area}: grant on a different board does not authorize this board`, async () => {
    const h = harness();
    assert.equal(h.projects[0].members[0].status, "Accepted");
    assert.equal(await request(h), 404);
  });

  test(`${area}: human owner still allowed`, async () => {
    const h = harness({ actor: "owner" });
    assert.equal(await request(h), 200);
    assert.equal(h.state.flagReads, 0);
  });

  test(`${area}: non-member human still refused`, async () => {
    const h = harness({ actor: "outsider" });
    assert.equal(await request(h), 404);
    assert.deepEqual(h.state.writes, []);
    assert.equal(h.labelQueries.length, 0);
  });
}

test("labels: human member and teamless owner/member still allowed", async () => {
  for (const actor of ["owner", "member"]) {
    for (const teamless of [false, true]) {
      const h = harness({ actor, teamless });
      assert.equal((await h.readLabels()).statusCode, 200);
    }
  }
});

test("labels: recorded lookup and nested task/count scopes retain authenticated actor", async () => {
  const h = harness({ grant: "accepted" });
  assert.equal((await h.readLabels()).statusCode, 200);
  h.project.members = [];
  assert.equal(matches(h.project, h.queries[0].where), false);
  const query = h.labelQueries[0];
  assert.equal(matches(h.project, query.include.task.where.task.project), false);
  assert.equal(matches(h.project, query.include._count.select.task.where.task.project), false);
  assert.equal(matches(h.projects[0], h.queries[0].where), false);
});

test("planning: human member still reads and posts status but cannot change target date", async () => {
  const h = harness({ actor: "member" });
  assert.equal((await h.planning("GET")).status, 200);
  assert.equal((await h.planning()).status, 403);
  assert.equal(h.queries.some(query => query.method === "update"), false);
  const created = [];
  h.prisma.projectStatusUpdate = { create: async args => { created.push(args.data); } };
  assert.equal((await h.planning("POST", "post_status")).status, 200);
  assert.equal(created[0].authorId, 7);
});

test("planning: existing team requirement still refuses a teamless owner", async () => {
  const h = harness({ actor: "owner", teamless: true });
  assert.equal((await h.planning("GET")).status, 404);
  assert.equal((await h.planning()).status, 404);
});

test("planning: recorded update itself retains project id and authenticated scope", async () => {
  const h = harness({ grant: "accepted" });
  assert.equal((await h.planning()).status, 200);
  const query = h.queries.find(query => query.method === "update");
  assert.ok(query);
  assert.equal(query.where.id, h.project.id);
  assert.equal(query.data.targetDate.toISOString(), "2026-11-01T12:00:00.000Z");
  h.project.members = [];
  assert.equal(matches(h.project, query.where), false);
  assert.equal(matches(h.projects[0], query.where), false);
});

test("planning: GET also refuses ungranted ENFORCE agents and keeps WATCH", async () => {
  for (const enforce of [true, false]) {
    const h = harness({ enforce });
    assert.equal((await h.planning("GET")).status, enforce ? 404 : 200);
    assert.equal(h.state.flagReads, 1);
  }
});

for (const enforce of [true, false]) {
  test(`agent-only membership never widens the original human predicate (enforce=${enforce})`, async () => {
    const h = harness({ grant: "accepted", enforce });
    h.project.ownerId = 99;
    h.project.owner = { id: 99, agents: [] };
    assert.equal((await h.readLabels()).statusCode, 404);
    assert.equal((await h.planning("GET")).status, 404);
    assert.equal((await h.planning()).status, 404);
    assert.deepEqual(h.state.writes, []);
  });
}
