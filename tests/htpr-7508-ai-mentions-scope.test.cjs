const assert = require("node:assert/strict");
const test = require("node:test");
const { fixture, matches, hydrate } = require("./helpers/agent-board-scope.cjs");

function harness({ actor = "agent", enforce = true, grant = "none", teamless = false, authenticated = true, bypassProducer = false, bypassGate = false, bypassPayload = false } = {}) {
  const f = fixture();
  f.user.displayName = "Board Owner";
  f.state.enforce = enforce;
  if (actor !== "agent") f.state.ctx.agentId = null;
  f.projects.forEach(project => {
    project.members = [];
    project.team = null;
    project.uniqueIdentifier = `B${project.id}`;
  });
  const project = f.projects[2];
  if (teamless) project.teamId = null;
  if (actor === "member" || actor === "guest" || actor === "outsider") {
    project.ownerId = 99;
    project.owner = { id: 99, displayName: "Other owner", agents: [] };
    if (actor !== "outsider") project.members.push({ userId: f.user.id, agentId: null, status: "Accepted", role: actor === "guest" ? "Guest" : "Member", user: f.user });
  }
  if (grant !== "none") {
    const board = grant === "wrong-board" ? f.projects[0] : project;
    board.members.push({ userId: f.user.id, agentId: f.agent.id, status: grant === "invited" ? "Invited" : "Accepted", agent: f.agent, user: f.user });
    if (grant === "revoked") f.agent.revokedAt = new Date();
    if (grant === "wrong-owner") f.agent.userId = 99;
  }
  f.tasks.forEach(task => Object.assign(task, { deletedAt: null, updatedAt: new Date("2026-10-03"), totalComments: 2 }));
  const task = f.tasks[2];
  const comments = [
    { id: 10, taskId: task.id, task, creatorId: f.user.id, creator: f.user, agent: null, agentDisplayName: null, activity: null, text: "Older comment", createdAt: new Date("2026-10-01"), reactions: [] },
    { id: 11, taskId: task.id, task, creatorId: 7, creator: { displayName: "Member" }, agent: null, agentDisplayName: null, activity: null, text: "Newer comment", createdAt: new Date("2026-10-02"), reactions: [] },
    { id: 12, taskId: f.tasks[0].id, task: f.tasks[0], creatorId: f.user.id, creator: f.user, agent: null, text: "Other task comment", createdAt: new Date("2026-10-03"), reactions: [] },
  ];
  const queries = [];
  const searches = [];
  const agentLookups = [];
  function read(model, method, args, bypass = false) {
    queries.push({ model, method, ...args });
    const rows = model === "project" ? f.projects : model === "task" ? f.tasks : comments;
    let selected = rows.filter(row => bypass ? model === "project" || row.id === args.where.id : matches(row, args.where));
    if (args.orderBy?.createdAt === "desc") selected = selected.toSorted((a, b) => b.createdAt - a.createdAt);
    selected = selected.slice(0, args.take ?? selected.length).map(row => hydrate(row, args));
    return method === "findMany" ? selected : selected[0] ?? null;
  }
  f.prisma.project.findMany = async args => read("project", "findMany", args, bypassProducer && args.select?.id);
  f.prisma.project.findFirst = async args => read("project", "findFirst", args);
  f.prisma.task.findMany = async args => read("task", "findMany", args);
  f.prisma.task.findFirst = async args => read("task", "findFirst", args, bypassGate);
  f.prisma.task.findUnique = async args => read("task", "findUnique", args, bypassPayload);
  f.prisma.comment = { findMany: async args => read("comment", "findMany", args) };
  const mocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => {
      if (!authenticated) return null;
      await f.scope.prepareAgentScope(f.user.id, f.state.ctx.agentId);
      return { userId: f.user.id, agentId: f.state.ctx.agentId };
    } },
    "@/lib/errors/reportError": { reportError: async report => { throw new Error(`Unexpected report: ${report.message}`); } },
    "@/utils/controllers/agents/boardMembers": { getBoardAgentMembers: async (projectId, userId) => {
      agentLookups.push({ projectId, userId });
      return [{ agent: { id: "suggested-agent", displayName: "Board agent", photoURL: null } }];
    } },
    "@/utils/helperFunctions/multiPages": { extractTipTapContent: () => ({ mentions: [], src: [] }) },
    "@/utils/controllers/ai/task/generateCommentsController": {},
  };
  mocks["@/utils/controllers/search/document"] = f.load("src/utils/controllers/search/document.ts", {
    "@/lib/configs/search.config": {},
    "@/utils/controllers/search/rankHits": {},
    "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async args => {
      searches.push(args);
      return f.tasks.filter(task => args.projectIds.includes(task.projectId)).map(task => ({ ...task, id: String(task.id) }));
    } },
  });
  const handlers = {};
  async function request(area, overrides = {}) {
    const file = area === "mention" ? "ai/chat/mention" : "ai/generateComments";
    handlers[area] ??= f.load(`src/pages/api/${file}.ts`, mocks).default;
    const method = area === "mention" ? "GET" : "POST";
    const req = {
      method, headers: {}, url: `/api/${file}?userId=999&agentId=forged-agent`,
      query: { param: "all", projectId: String(project.id), userId: "999", actingAgentId: "forged-agent", ...overrides },
      body: { taskId: task.id, commentIds: [], userId: 999, agentId: "forged-agent", ...overrides },
    };
    const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handlers[area](req, res);
    return res;
  }
  return { ...f, project, task, comments, queries, searches, agentLookups, request };
}

const variants = [
  { name: "mention all", area: "mention", input: { param: "all" } },
  { name: "mention named", area: "mention", input: { param: "Board" } },
  { name: "comments full", area: "comments", input: { commentIds: [] } },
  { name: "comments selected", area: "comments", input: { commentIds: [10] } },
];

async function allowed(h, variant) {
  const res = await h.request(variant.area, variant.input);
  assert.equal(res.statusCode, 200);
  if (variant.area === "mention") {
    assert.ok(res.body.some(item => item.type === "project" && item.id === h.project.id));
    assert.ok(res.body.some(item => item.type === "task" && item.id === h.task.id));
    assert.deepEqual(res.body.filter(item => item.type === "agent").map(item => item.id), ["suggested-agent"]);
    assert.deepEqual(h.agentLookups, [{ projectId: h.project.id, userId: h.user.id }]);
  } else {
    assert.equal(res.body.task.taskId, h.task.id);
    assert.equal(res.body.task.projectId, h.project.id);
    assert.deepEqual(res.body.comments.map(comment => comment.commentId), variant.input.commentIds.length ? [10] : [11, 10]);
  }
  return res;
}

for (const variant of variants) {
  test(`${variant.name}: zero-grant internal agent refused in ENFORCE`, async () => {
    const h = harness();
    const res = await h.request(variant.area, variant.input);
    assert.equal(res.statusCode, variant.area === "mention" ? 400 : 404);
    assert.equal(h.searches.length, 0);
    assert.equal(h.queries.length, 1);
    assert.equal(h.state.flagReads, 1);
  });

  test(`${variant.name}: same ungranted internal agent retains WATCH access`, async () => {
    const h = harness({ enforce: false });
    await allowed(h, variant);
    assert.equal(h.state.flagReads, 1);
  });

  test(`${variant.name}: Accepted same-owner authenticated agent allowed in ENFORCE`, async () => {
    const h = harness({ grant: "accepted" });
    await allowed(h, variant);
    assert.equal(h.state.flagReads, 1);
  });

  for (const grant of ["invited", "revoked", "wrong-owner", "wrong-board"]) {
    test(`${variant.name}: ${grant} agent cannot read the target board`, async () => {
      const h = harness({ grant });
      const res = await h.request(variant.area, variant.input);
      if (variant.area === "comments") assert.equal(res.statusCode, 404);
      else if (res.statusCode === 200) {
        assert.equal(grant, "wrong-board");
        assert.equal(res.body.some(item => (item.type === "project" && item.id === h.project.id) || (item.type === "task" && item.id === h.task.id)), false);
        assert.deepEqual(h.agentLookups, []);
      } else assert.equal(res.statusCode, 400);
    });
  }

  for (const actor of ["owner", "member", "guest"]) {
    for (const teamless of [false, true]) {
      test(`${variant.name}: human ${actor}, teamless=${teamless}, remains allowed`, async () => {
        const h = harness({ actor, teamless });
        await allowed(h, variant);
        assert.equal(h.state.flagReads, 0);
      });
    }
  }

  test(`${variant.name}: unauthenticated request never reads content`, async () => {
    const h = harness({ authenticated: false });
    const res = await h.request(variant.area, variant.input);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { message: "Unauthorized" });
    assert.deepEqual(h.queries, []);
  });
}

for (const param of ["all", "Board"]) {
  test(`mentions ${param}: D57-D60 downstream predicates independently enforce scope after an overbroad producer`, async () => {
    for (const enforce of [true, false]) {
      const h = harness({ bypassProducer: true, enforce });
      const res = await h.request("mention", { param });
      assert.equal(res.statusCode, 200);
      const ownerQuery = h.queries.find(query => query.method === "findFirst");
      const projectQuery = h.queries.find(query => query.model === "project" && !query.select);
      assert.ok(ownerQuery);
      assert.ok(projectQuery);
      assert.equal(matches(h.project, ownerQuery.where), !enforce);
      assert.equal(matches(h.project, projectQuery.where), !enforce);
      assert.equal(res.body.some(item => item.type === "project" && item.id === h.project.id), !enforce);
      assert.equal(res.body.some(item => item.type === "name" && item.id === h.user.id), !enforce);
      if (param === "all") {
        const taskQuery = h.queries.find(query => query.model === "task");
        assert.ok(taskQuery);
        assert.equal(matches(h.task, taskQuery.where), !enforce);
        assert.equal(res.body.some(item => item.type === "task" && item.id === h.task.id), !enforce);
      }
    }
  });
}

for (const variant of variants.filter(variant => variant.area === "comments")) {
  test(`${variant.name}: D61 task payload independently refuses ungranted ENFORCE access`, async () => {
    const h = harness({ bypassGate: true });
    const res = await h.request("comments", variant.input);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(h.queries.map(query => query.method), ["findFirst", "findUnique"]);
    assert.equal(matches(h.task, h.queries[1].where), false);
  });

  test(`${variant.name}: D62/D63 comment query independently scopes an already-loaded task in ENFORCE and WATCH`, async () => {
    for (const enforce of [true, false]) {
      const h = harness({ bypassGate: true, bypassPayload: true, enforce });
      const res = await h.request("comments", variant.input);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.comments.map(comment => comment.commentId), enforce ? [] : variant.input.commentIds.length ? [10] : [11, 10]);
      const query = h.queries.find(query => query.model === "comment");
      assert.ok(query);
      assert.equal(matches(h.comments[0], query.where), !enforce);
    }
  });
}

for (const enforce of [true, false]) {
  test(`named mention producer IDs survive the real Turbopuffer adapter, enforce=${enforce}`, async () => {
    const h = harness({ enforce, grant: "accepted" });
    const res = await allowed(h, variants[1]);
    const projectIds = enforce ? [h.project.id] : h.projects.map(project => project.id);
    assert.deepEqual(h.searches, [{ searchQuery: "Board", projectIds, topK: 25, keywordOnly: true }]);
    assert.deepEqual(res.body.filter(item => item.type === "task").map(item => item.project_id).toSorted(), projectIds.toSorted());
  });
}

for (const variant of variants) {
  test(`${variant.name}: an Accepted grant cannot widen the original human eligibility`, async () => {
    const h = harness({ grant: "accepted" });
    h.project.ownerId = 99;
    h.project.owner = { id: 99, agents: [] };
    const res = await h.request(variant.area, variant.input);
    assert.equal(res.statusCode, variant.area === "mention" ? 400 : 404);
  });

  test(`${variant.name}: unrelated humans remain unable to read the target`, async () => {
    const h = harness({ actor: "outsider" });
    const res = await h.request(variant.area, variant.input);
    if (variant.area === "comments") assert.equal(res.statusCode, 404);
    else {
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.some(item => (item.type === "project" && item.id === h.project.id) || (item.type === "task" && item.id === h.task.id)), false);
      assert.deepEqual(h.agentLookups, []);
    }
  });
}

test("mention all: IDs, Normal people lookup, task deletion/update filters, ordering and limits remain conjunctive", async () => {
  const h = harness({ actor: "owner" });
  await allowed(h, variants[0]);
  const owner = h.queries.find(query => query.method === "findFirst");
  const projects = h.queries.find(query => query.model === "project" && !query.select);
  const tasks = h.queries.find(query => query.model === "task");
  assert.equal(matches({ ...h.project, status: "Archive" }, owner.where), false);
  assert.equal(matches({ ...h.project, id: 999 }, owner.where), false);
  assert.equal(matches({ ...h.project, id: 999 }, projects.where), false);
  assert.equal(projects.take, 5);
  assert.equal(tasks.take, 5);
  assert.deepEqual(tasks.orderBy, { updatedAt: "desc" });
  assert.equal(matches(h.task, tasks.where), true);
  assert.equal(matches({ ...h.task, projectId: 999 }, tasks.where), false);
  assert.equal(matches({ ...h.task, deletedAt: new Date() }, tasks.where), false);
  assert.equal(matches({ ...h.task, updatedAt: null }, tasks.where), false);
});

test("named mentions: title/identifier/word alternatives stay conjoined with ID and agent scope", async () => {
  const h = harness({ grant: "accepted" });
  await allowed(h, variants[1]);
  const query = h.queries.find(query => query.model === "project" && !query.select);
  assert.equal(query.take, 5);
  assert.equal(query.where.OR.length, 4);
  assert.equal(matches({ ...h.project, title: "Unrelated", uniqueIdentifier: "other" }, query.where), false);
  assert.equal(matches({ ...h.project, title: "Unrelated", uniqueIdentifier: "BOARD" }, query.where), true);
  assert.equal(matches({ ...h.project, id: 999 }, query.where), false);
  assert.equal(matches({ ...h.project, members: [] }, query.where), false);
  const multiword = await h.request("mention", { param: "Board 2128" });
  assert.equal(multiword.statusCode, 200);
  const wordsQuery = h.queries.filter(query => query.model === "project" && !query.select).at(-1);
  assert.equal(matches({ ...h.project, title: "2128 Board" }, wordsQuery.where), true);
  assert.equal(matches({ ...h.project, title: "Board" }, wordsQuery.where), false);
});

for (const selected of [false, true]) {
  test(`comments selected=${selected}: task association, selection, sort and reaction restrictions stay exact`, async () => {
    const h = harness({ actor: "guest", teamless: true });
    const res = await h.request("comments", { commentIds: selected ? [10, 12, 999] : [] });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.comments.map(comment => comment.commentId), selected ? [10] : [11, 10]);
    const query = h.queries.find(query => query.model === "comment");
    assert.deepEqual(query.orderBy, { createdAt: "desc" });
    assert.deepEqual(query.include.reactions.where, { isDeleted: false });
    assert.equal(matches(h.comments[0], query.where), true);
    assert.equal(matches({ ...h.comments[0], taskId: 999 }, query.where), false);
    if (selected) assert.equal(matches(h.comments[1], query.where), false);
  });
}

test("comments: unknown selected IDs, empty comments and missing task retain their responses", async () => {
  const h = harness({ actor: "owner" });
  const selected = await h.request("comments", { commentIds: [999] });
  assert.equal(selected.statusCode, 200);
  assert.deepEqual(selected.body.comments, []);
  h.comments.splice(0);
  const empty = await h.request("comments");
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.body.comments, []);
  const missing = await h.request("comments", { taskId: 999 });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.body, { message: "Task not found" });
});

test("mentions: empty eligible board list and empty suggestions retain their responses", async () => {
  const h = harness({ actor: "owner" });
  h.projects.splice(0);
  const empty = await h.request("mention");
  assert.equal(empty.statusCode, 400);
  assert.deepEqual(h.searches, []);
  const noMatch = harness({ actor: "owner" });
  noMatch.tasks.splice(0);
  const suggestions = await noMatch.request("mention", { param: "ZZZ" });
  assert.equal(suggestions.statusCode, 200);
  assert.deepEqual(suggestions.body.filter(item => ["project", "task", "name", "agent"].includes(item.type)), []);
});

test("HTTP tagged agent cookies remain refused on both N07 routes in WATCH and ENFORCE", async () => {
  const { harness: proxyHarness } = require("./helpers/agent-cookie-bridge.cjs");
  for (const enforce of [false, true]) {
    const h = proxyHarness({ enforce });
    for (const [route, method] of [["ai/chat/mention", "GET"], ["ai/generateComments", "POST"]]) {
      const res = await h.proxy(h.request(`/api/${route}`, { method }));
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, "AGENT_COOKIE_ROUTE");
    }
    assert.equal(h.calls.flags, 0);
  }
});
