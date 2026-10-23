const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { fixture, matches, hydrate } = require("./helpers/agent-board-scope.cjs");

function harness({ actor = "agent", enforce = true, grant = "none", bypassBoardProducer = false, currentRuntime = false, authenticated = true, withUsage = false } = {}) {
  const f = fixture();
  f.state.enforce = enforce;
  if (actor !== "agent") f.state.ctx.agentId = null;
  const project = f.projects[2];
  project.team = { id: "team", title: "Team" };
  const target = {
    ...f.agent,
    id: "target-agent",
    displayName: "Target",
    createdAt: new Date("2026-10-01"),
    archivedAt: null,
    heartbeatAt: null,
    runtimeType: "EXTERNAL",
    members: [{ agentId: "target-agent", status: "Accepted", project }],
  };
  project.members.push({ agentId: target.id, status: "Accepted", agent: target });
  if (actor === "member" || actor === "guest") {
    project.ownerId = 99;
    project.owner = { id: 99, agents: [] };
    project.members.push({ userId: f.user.id, agentId: null, status: "Accepted", role: actor === "guest" ? "Guest" : "Member", user: f.user });
  }
  if (grant !== "none") {
    project.members.push({ agentId: f.agent.id, status: grant === "invited" ? "Invited" : "Accepted", agent: f.agent });
    if (grant === "revoked") f.agent.revokedAt = new Date();
    if (grant === "wrong-owner") f.agent.userId = 99;
  }
  f.prisma.member.findMany = async args => f.projects
    .flatMap(board => board.members.map(member => ({ ...member, projectId: board.id, project: board })))
    .filter(member => matches(member, args.where))
    .map(member => hydrate(member, args));
  const agentQueries = [];
  f.prisma.agent.findFirst = async args => {
    agentQueries.push(args);
    const row = [f.agent, target].find(item => matches(item, args.where));
    if (!row) return null;
    if (bypassBoardProducer && args.select?.members) {
      return { ...hydrate(row, { ...args, select: { ...args.select, members: false } }), members: target.members.map(member => hydrate(member, args.select.members)) ?? [] };
    }
    return hydrate(row, args);
  };
  const baseTask = {
    ...f.tasks[2], section: "Intake", archivedAt: null, deletedAt: null,
    taskLabels: [{ label: { value: "POOL" } }], priority: { Priority_Value: "High", priority_index: 1 }, dueDate: null,
  };
  const tasks = [
    { ...baseTask, id: 1, ticketNumber: "HTPR-1", assignees: [] },
    { ...baseTask, id: 2, ticketNumber: "HTPR-2", assignees: [{ agentId: target.id }] },
    { ...baseTask, id: 3, ticketNumber: "HTPR-3", assignees: [{ agentId: "specialist-agent" }] },
    { ...baseTask, id: 4, ticketNumber: "HTPR-4", section: "Other", taskLabels: [], assignees: [{ agentId: target.id }] },
  ];
  const taskQueries = [];
  for (const method of ["count", "findMany", "groupBy"]) {
    f.prisma.task[method] = async args => {
      taskQueries.push({ method, ...args });
      const rows = tasks.filter(row => matches(row, args.where));
      if (method === "count") return rows.length;
      if (method === "groupBy") return rows.length ? [{ projectId: project.id, section: "Intake", _count: { _all: rows.length } }] : [];
      return rows.slice(0, args.take).map(row => hydrate(row, args));
    };
  }
  const activityQueries = [];
  const row = { id: 1, agentId: target.id, createdAt: new Date(), commentText: "Fixture comment", title: "Evidence", type: "link", question: "Question?", status: "Active", task: tasks[0] };
  for (const model of ["comment", "taskEvidence", "decisionRequest", "taskSession"]) {
    f.prisma[model] = { findMany: async args => {
      activityQueries.push({ model, ...args });
      return [row].filter(item => matches(item, args.where)).map(item => hydrate(item, args));
    } };
  }
  f.prisma.comment.aggregate = async args => ({ _max: { createdAt: matches(row, args.where) ? row.createdAt : null } });
  const leases = [{
    agentId: target.id, createdAt: new Date("2026-10-01"),
    expiresAt: new Date(Date.now() + 60_000), heartbeatAt: new Date(), task: tasks[1],
  }];
  const leaseQueries = [];
  f.prisma.taskLease = { findMany: async args => {
    leaseQueries.push(args);
    return leases.filter(lease => matches(lease, args.where)).map(lease => hydrate(lease, args));
  } };
  const usageRows = withUsage ? [
    { id: "board", agentId: target.id, projectId: project.id, createdAt: new Date(), model: "board-model", feature: "agent", totalTokens: 101 },
    { id: "other-board", agentId: target.id, projectId: f.projects[0].id, createdAt: new Date(), model: "other-model", feature: "agent", totalTokens: 202 },
    { id: "no-board", agentId: target.id, projectId: null, createdAt: new Date(), model: "unattributed-model", feature: "agent", totalTokens: 303 },
  ] : [];
  if (withUsage) {
    for (const board of f.projects.filter(board => board !== project)) {
      board.members = board.members.filter(member => member.agentId !== f.agent.id);
    }
  }
  const usageQueries = [];
  f.prisma.aiUsage = { findMany: async args => {
    usageQueries.push(args);
    return usageRows.filter(usage => matches(usage, args.where)).slice(0, args.take).map(usage => hydrate(usage, args));
  } };
  const projectQueries = [];
  const findProjects = f.prisma.project.findMany;
  f.prisma.project.findMany = async args => {
    projectQueries.push(args);
    return findProjects(args);
  };
  const working = f.load("src/lib/agents/working.ts");
  const runtimeState = f.load("src/lib/agents/runtimeState.ts", { "../redis": { getRedis: async () => { throw new Error("Unexpected Redis access"); } } });
  const snapshot = {
    version: 1, sequence: 1, workerId: "fixture", runtime: "external", model: null,
    heartbeatAt: currentRuntime ? new Date().toISOString() : new Date(0).toISOString(),
    lastProgressAt: new Date().toISOString(), cadenceSeconds: 30,
    sourceSections: [{ boardId: project.id, section: "Intake" }], scopeLabel: "POOL",
    processedTickets: [{ boardId: project.id, ticket: "HTPR-1" }],
    queue: [{ ticket: "HTPR-2", title: "Runtime task", boardId: project.id, state: "pending", reason: "assignment" }],
  };
  const commonMocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => {
      if (!authenticated) return null;
      await f.scope.prepareAgentScope(f.state.ctx.user.id, f.state.ctx.agentId);
      return { userId: f.state.ctx.user.id, agentId: f.state.ctx.agentId };
    } },
    "@/lib/mcp/auth": {},
    "@/lib/aiModelOptions": {},
    "@/lib/nativeAgent/modelPin": { UNPINNABLE_MODEL_OPTION_IDS: new Set() },
    "@/lib/agents/working": working,
    "@/lib/agents/ownedSlugs": { resolveOwnedAgent: async (userId, ref) => userId === target.userId && ref === target.id ? { id: target.id, slug: "target" } : null },
    "@/lib/mcp/agents/ownedAgents": {},
    "@/lib/agents/visibility": {},
    "@/lib/agents/runtimeState": { ...runtimeState, readAgentRuntimeSnapshot: async () => snapshot },
  };
  const routes = {
    activity: f.load("src/app/api/agents/[agentId]/activity/route.ts", commonMocks),
    detail: f.load("src/app/api/agents/[agentId]/route.ts", commonMocks),
  };
  async function request(area, targetId = target.id) {
    const req = new NextRequest(`https://app.hypertask.ai/api/agents/${targetId}${area === "activity" ? "/activity" : ""}?agentId=${target.id}&userId=999`);
    return routes[area].GET(req, { params: Promise.resolve({ agentId: targetId }) });
  }
  return { ...f, project, target, tasks, taskQueries, activityQueries, agentQueries, snapshot, request, leases, leaseQueries, working, usageRows, usageQueries, projectQueries };
}

for (const area of ["activity", "detail"]) {
  async function visible(h) {
    const response = await h.request(area);
    assert.equal(response.status, 200);
    const body = await response.json();
    return area === "activity" ? body.items : body.agent.boards;
  }

  test(`${area}: ungranted agent now refused board data in ENFORCE`, async () => {
    const h = harness();
    assert.deepEqual(await visible(h), []);
    assert.equal(h.state.flagReads, 1);
  });

  test(`${area}: same ungranted agent still allowed with flag Off (WATCH)`, async () => {
    const h = harness({ enforce: false });
    assert.equal((await visible(h)).length, area === "activity" ? 4 : 1);
    assert.equal(h.state.flagReads, 1);
    assert.notEqual(h.agent.id, h.target.id);
  });

  test(`${area}: Accepted acting-agent grant still allowed independently of target agent`, async () => {
    const h = harness({ grant: "accepted" });
    assert.equal((await visible(h)).length, area === "activity" ? 4 : 1);
    assert.notEqual(h.agent.id, h.target.id);
    assert.equal(h.state.flagReads, 1);
  });

  for (const grant of ["invited", "revoked", "wrong-owner"]) {
    test(`${area}: ${grant} acting-agent grant still refused in ENFORCE`, async () => {
      const h = harness({ grant });
      assert.deepEqual(await visible(h), []);
    });
  }

  for (const actor of ["owner", "member", "guest"]) {
    test(`${area}: human ${actor} of target agent still sees eligible boards`, async () => {
      const h = harness({ actor });
      assert.equal((await visible(h)).length, area === "activity" ? 4 : 1);
      assert.equal(h.state.flagReads, 0);
      if (actor !== "owner") assert.notEqual(h.project.ownerId, h.user.id);
    });

    test(`${area}: human ${actor} cannot inspect another user's agent`, async () => {
      const h = harness({ actor });
      h.target.userId = 99;
      assert.equal((await h.request(area)).status, 404);
      assert.equal(h.taskQueries.length, 0);
      assert.equal(h.activityQueries.length, 0);
    });
  }

  test(`${area}: agent grant does not widen original human board access in either flag mode`, async () => {
    for (const enforce of [true, false]) {
      const h = harness({ grant: "accepted", enforce });
      h.project.ownerId = 99;
      h.project.owner = { id: 99, agents: [] };
      assert.deepEqual(await visible(h), []);
    }
  });

  test(`${area}: missing session and unknown target still refused`, async () => {
    const anonymous = harness({ authenticated: false });
    assert.equal((await anonymous.request(area)).status, 401);
    assert.equal(anonymous.agentQueries.length, 0);
    const h = harness({ actor: "owner" });
    assert.equal((await h.request(area, "missing-agent")).status, 404);
  });

  test(`${area}: existing team requirement and target membership status remain intact`, async () => {
    const h = harness({ actor: "owner" });
    h.project.teamId = null;
    assert.deepEqual(await visible(h), []);
    if (area === "detail") {
      h.project.teamId = "team";
      h.target.members[0].status = "Invited";
      assert.deepEqual(await visible(h), []);
    }
  });
}

test("activity: each feed query retains target identity and scoped board relation", async () => {
  const h = harness({ grant: "accepted" });
  assert.equal((await h.request("activity")).status, 200);
  assert.equal(h.activityQueries.length, 4);
  for (const query of h.activityQueries) {
    const row = { agentId: h.target.id, task: h.tasks[0] };
    assert.equal(matches(row, query.where), true);
    assert.equal(matches({ ...row, agentId: h.agent.id }, query.where), false);
    assert.equal(query.take, 40);
    const members = h.project.members;
    h.project.members = members.filter(member => member.agentId !== h.agent.id);
    assert.equal(matches(row, query.where), false);
    h.project.members = members;
  }
});

test("detail: recorded counts and queue independently refuse ungranted ENFORCE data", async () => {
  const h = harness({ bypassBoardProducer: true });
  const response = await h.request("detail");
  assert.equal(response.status, 200);
  const { agent } = await response.json();
  assert.deepEqual(agent.operations.queue, []);
  for (const key of ["sourceTotal", "assigned", "unowned", "specialistOwned", "processedUnowned", "eligiblePool", "workerQueue"]) {
    assert.equal(agent.operations.counts[key], 0, key);
  }
  const queries = h.taskQueries.filter(query => query.method !== "groupBy");
  assert.equal(queries.length, 7);
  for (const query of queries) {
    assert.ok(h.tasks.every(task => !matches(task, query.where)));
  }
});

test("detail: all seven recorded runtime queries preserve their existing predicates", async () => {
  const h = harness({ grant: "accepted" });
  const response = await h.request("detail");
  const { agent } = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(agent.operations.counts, {
    sourceTotal: 3, eligiblePool: 2, workerQueue: 2, assigned: 2, unowned: 1,
    specialistOwned: 1, processedUnowned: 1, directMentions: 0,
  });
  assert.deepEqual(agent.operations.queue.map(item => item.ticket), ["HTPR-2", "HTPR-4"]);
  const queries = h.taskQueries.filter(query => query.method !== "groupBy");
  assert.equal(queries.length, 7);
  const expected = [[true, true, true, false], [false, true, false, true], [true, false, false, false], [false, false, true, false], [true, false, false, false], [true, true, false, false], [false, true, false, true]];
  for (const [index, query] of queries.entries()) {
    assert.deepEqual(h.tasks.map(task => matches(task, query.where)), expected[index], `query ${index}`);
    const valid = h.tasks[expected[index].indexOf(true)];
    for (const mutation of [
      { status: "Archive" }, { archivedAt: new Date() }, { deletedAt: new Date() },
      { projectId: 15, project: h.projects[0] },
      { project: { ...h.project, teamId: null } },
    ]) assert.equal(matches({ ...valid, ...mutation }, query.where), false, `query ${index}: ${Object.keys(mutation)}`);
    if (![1, 6].includes(index)) {
      assert.equal(matches({ ...valid, section: "Other" }, query.where), false);
      assert.equal(matches({ ...valid, taskLabels: [] }, query.where), false);
    }
    if (index === 4) assert.equal(matches({ ...valid, ticketNumber: "HTPR-999" }, query.where), false);
    const members = h.project.members;
    h.project.members = members.filter(member => member.agentId !== h.agent.id);
    assert.equal(matches(valid, query.where), false);
    h.project.members = members;
  }
  assert.equal(queries[6].take, 50);
  assert.deepEqual(queries[6].orderBy, [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: { priority_index: "asc" } }, { uniqueIndex: "asc" }]);
});

test("detail: board producer filters runtime snapshot and board access by acting agent", async () => {
  for (const enforce of [true, false]) {
    const h = harness({ enforce, currentRuntime: true });
    const response = await h.request("detail");
    const { agent } = await response.json();
    assert.equal(agent.boards.length, enforce ? 0 : 1);
    assert.equal(agent.boardAccess.some(board => board.id === h.project.id), !enforce);
    assert.equal(agent.operations.snapshot.queue.length, enforce ? 0 : 1);
    assert.equal(agent.operations.snapshot.sourceSections.length, enforce ? 0 : 1);
    assert.equal(agent.operations.snapshot.processedTickets.length, enforce ? 0 : 1);
    assert.equal(agent.lastPostedAt === null, enforce);
  }
});

test("detail: ungranted ENFORCE actor receives no working ticket from the real helper", async () => {
  const h = harness();
  const response = await h.request("detail");
  assert.equal(response.status, 200);
  const { agent } = await response.json();
  assert.deepEqual(agent.boards, []);
  assert.equal(agent.working, null);
  assert.equal(h.leaseQueries.length, 1);
  assert.deepEqual(h.leaseQueries[0].where.agentId, { in: [h.target.id] });
  assert.equal(matches(h.leases[0], h.leaseQueries[0].where), false);
  assert.equal(h.state.flagReads, 1);
});

for (const [label, options] of [
  ["ungranted WATCH actor", { enforce: false }],
  ["human owner", { actor: "owner" }],
  ["human member", { actor: "member" }],
  ["human guest", { actor: "guest" }],
  ["Accepted ENFORCE actor", { grant: "accepted" }],
]) {
  test(`detail: ${label} still receives the working ticket from the real helper`, async () => {
    const h = harness(options);
    const response = await h.request("detail");
    assert.equal(response.status, 200);
    const { agent } = await response.json();
    assert.deepEqual(agent.working, {
      ticket: h.tasks[1].ticketNumber,
      title: h.tasks[1].title,
      url: `/detail/project-${h.project.id}/${h.tasks[1].uniqueIndex}`,
      since: h.leases[0].createdAt.toISOString(),
      expiresAt: h.leases[0].expiresAt.toISOString(),
    });
    assert.equal(matches(h.leases[0], h.leaseQueries[0].where), true);
    assert.equal(matches({ ...h.leases[0], agentId: h.agent.id }, h.leaseQueries[0].where), false);
    assert.equal(matches({ ...h.leases[0], expiresAt: new Date(0) }, h.leaseQueries[0].where), false);
  });
}

for (const grant of ["invited", "revoked", "wrong-owner"]) {
  test(`detail and activity: ${grant} grant refuses working ticket and board usage in ENFORCE`, async () => {
    const h = harness({ grant, withUsage: true });
    assert.equal((await (await h.request("detail")).json()).agent.working, null);
    assert.deepEqual((await (await h.request("activity")).json()).items, []);
  });
}

test("working helper: omitted acting-agent argument preserves the owned-list caller in both modes", async () => {
  for (const enforce of [true, false]) {
    const h = harness({ enforce });
    const result = await h.run({ url: "https://example.invalid/api/agents/owned" }, () =>
      h.working.workingOnByAgent([h.target.id], h.user.id));
    assert.equal(result.get(h.target.id).ticket, h.tasks[1].ticketNumber);
    const empty = await h.working.workingOnByAgent([], h.user.id);
    assert.equal(empty.size, 0);
    assert.equal(h.leaseQueries.length, 1);
  }
});

test("detail: a grant cannot widen the working helper's existing human access in either mode", async () => {
  for (const enforce of [true, false]) {
    const h = harness({ grant: "accepted", enforce });
    h.project.ownerId = 99;
    h.project.owner = { id: 99, agents: [] };
    assert.equal((await (await h.request("detail")).json()).agent.working, null);
  }
});

test("activity: ungranted ENFORCE actor receives no board or null-project model usage", async () => {
  const h = harness({ withUsage: true });
  const response = await h.request("activity");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, []);
  assert.equal(h.projectQueries.length, 1);
  assert.deepEqual(h.projectQueries[0].select, { id: true });
  assert.deepEqual(h.usageQueries[0].where, { agentId: h.target.id, projectId: { in: [] } });
  assert.equal(h.state.flagReads, 1);
});

for (const [label, options] of [
  ["ungranted WATCH actor", { enforce: false }],
  ["human owner", { actor: "owner" }],
  ["human member", { actor: "member" }],
  ["human guest", { actor: "guest" }],
]) {
  test(`activity: ${label} retains all prior model usage including null projectId`, async () => {
    const h = harness({ ...options, withUsage: true });
    const response = await h.request("activity");
    assert.equal(response.status, 200);
    const modelItems = (await response.json()).items.filter(item => item.kind === "model");
    assert.deepEqual(modelItems.map(item => [item.id, item.detail, item.tokens]).sort(), [
      ["model-board", "board-model", 101],
      ["model-other-board", "other-model", 202],
      ["model-no-board", "unattributed-model", 303],
    ].sort());
    assert.equal(h.projectQueries.length, 0);
    assert.deepEqual(h.usageQueries[0].where, { agentId: h.target.id });
    assert.equal(h.usageQueries[0].take, 40);
    assert.deepEqual(h.usageQueries[0].orderBy, { createdAt: "desc" });
  });
}

test("activity: Accepted ENFORCE actor sees only its granted board model usage", async () => {
  const h = harness({ grant: "accepted", withUsage: true });
  const response = await h.request("activity");
  assert.equal(response.status, 200);
  const items = (await response.json()).items;
  assert.equal(items.filter(item => item.kind !== "model").length, 4);
  assert.deepEqual(items.filter(item => item.kind === "model").map(item => [item.id, item.detail, item.tokens]), [
    ["model-board", "board-model", 101],
  ]);
  assert.equal(h.projectQueries.length, 1);
  assert.deepEqual(h.usageQueries[0].where, { agentId: h.target.id, projectId: { in: [h.project.id] } });
  assert.equal(h.usageQueries[0].take, 40);
  assert.deepEqual(h.usageQueries[0].orderBy, { createdAt: "desc" });
  assert.equal(matches({ ...h.usageRows[0], agentId: h.agent.id }, h.usageQueries[0].where), false);
  assert.equal(h.state.flagReads, 1);
});

test("activity: an ENFORCE grant cannot expose usage on a board the human cannot access", async () => {
  const h = harness({ grant: "accepted", withUsage: true });
  h.project.ownerId = 99;
  h.project.owner = { id: 99, agents: [] };
  assert.deepEqual((await (await h.request("activity")).json()).items, []);
});
