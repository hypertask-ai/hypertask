const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { fixture, matches, hydrate } = require("./helpers/agent-board-scope.cjs");

const areas = ["field", "restore", "versions", "cycle-get", "cycle-post", "defaults"];

function harness({ actor = "agent", enforce = true, grant = "none", teamless = false, profile = true, authenticated = true, bypassProject = false } = {}) {
  const f = fixture();
  f.state.enforce = enforce;
  if (actor !== "agent") f.state.ctx.agentId = null;
  const project = f.projects[2];
  const task = f.tasks[2];
  project.cyclesEnabled = true;
  if (teamless) project.teamId = null;
  if (["member", "guest", "outsider"].includes(actor)) {
    project.ownerId = 99;
    project.owner = { id: 99, agents: [] };
    if (actor !== "outsider") project.members.push({ userId: f.user.id, agentId: null, status: "Accepted", role: actor === "guest" ? "Guest" : "Member", user: f.user });
  }
  if (grant !== "none") {
    const board = grant === "wrong-board" ? f.projects[0] : project;
    board.members.push({ agentId: f.agent.id, status: grant === "invited" ? "Invited" : "Accepted", agent: f.agent });
    if (grant === "revoked") f.agent.revokedAt = new Date();
    if (grant === "wrong-owner") f.agent.userId = 99;
  }
  task.ranking = "A0100";
  const currentCycle = { id: 11, projectId: project.id, number: 1, startDate: "2026-10-01" };
  const nextCycle = { ...currentCycle, id: 12, number: 2, startDate: "2026-10-15" };
  task.cycleId = currentCycle.id;
  task.cycle = currentCycle;
  const sections = [
    { id: project.id, projectId: project.id, visibility: true, deleted: false, section_title: "Todo", ranking: "A0100" },
    { id: 999, projectId: 999, visibility: true, deleted: false, section_title: "Foreign", ranking: "A0001" },
  ];
  const snapshot = { id: 31, entityType: "task_description", entityId: task.id, contentHtml: "<p>Previous</p>", contentText: "Previous", version: 2, authorId: f.user.id, author: { displayName: f.user.displayName }, agentId: null, createdAt: "2026-10-01" };
  const queries = [], writes = [], ranks = [], broadcasts = [];
  function reader(rows, model) {
    return async args => {
      queries.push({ model, ...args });
      return hydrate(rows.find(row => matches(row, args.where)), args);
    };
  }
  f.prisma.task.findUnique = reader(f.tasks, "task");
  f.prisma.task.findFirst = reader(f.tasks, "task");
  f.prisma.project.findFirst = bypassProject
    ? async args => { queries.push({ model: "project", ...args }); return { id: project.id }; }
    : reader(f.projects, "project");
  f.prisma.section.findFirst = reader(sections, "section");
  f.prisma.docVersion = {
    findFirst: reader([snapshot], "snapshot"),
    findMany: async args => { queries.push({ model: "versions", ...args }); return [snapshot].filter(row => matches(row, args.where)).map(row => hydrate(row, args)); },
  };
  f.prisma.cycle = { findMany: async args => { queries.push({ model: "cycles", ...args }); return [currentCycle, nextCycle].filter(row => matches(row, args.where)); } };
  const session = async () => {
    if (!authenticated) return null;
    await f.scope.prepareAgentScope(f.user.id, f.state.ctx.agentId);
    return { userId: f.user.id, agentId: f.state.ctx.agentId, source: "legacy", needsBridge: true };
  };
  class CustomFieldValidationError extends Error {}
  const mocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: session },
    "next/headers": { cookies: async () => ({ get: () => profile ? { value: JSON.stringify({ id: f.user.id }) } : undefined }) },
    "@/utils/edgeHelpers": { isValidUser: value => ({ isValid: !!value, user: value ? f.user : null }) },
    "@/utils/controllers/customFields": {
      CustomFieldValidationError,
      getCustomFieldForProjectById: async (projectId, fieldId) => projectId === project.id && fieldId === "field-1" ? { id: "field-1" } : null,
      upsertCustomFieldValue: async (...args) => { writes.push(["field", ...args]); return { id: "value-1", value: args[2] }; },
    },
    "@/utils/controllers/tasks/single": { updateTaskSingle: async (...args) => { writes.push(["task", ...args]); return { status: 200, json: { id: task.id } }; } },
    "@/lib/cycleService": { getProjectCycleOverview: async () => ({ current: currentCycle, next: nextCycle }) },
    "@/lib/realtime/server": {
      broadcastBoardChange: async (...args) => broadcasts.push(["board", ...args]),
      broadcastTaskChange: async (...args) => broadcasts.push(["task", ...args]),
    },
    "@/utils/generateRank": { default: (...args) => { ranks.push(args); return "new-rank"; } },
  };
  const routes = {};
  const paths = { field: "customFields/value", restore: "tasks/[taskId]/description-restore", versions: "tasks/[taskId]/description-versions", "cycle-get": "tasks/cycle", "cycle-post": "tasks/cycle" };
  async function request(area, overrides = {}) {
    if (area === "defaults") {
      routes.defaults ??= f.load("src/pages/api/tasks/createGlobally.ts", mocks).default;
      const req = { method: "GET", url: "/api/tasks/createGlobally", headers: {}, query: { projectId: String(project.id), sectionId: String(sections[0].id), position: "top", userId: "999", agentId: "forged-agent", ...overrides } };
      let response;
      const headers = {};
      const res = { setHeader: (key, value) => { headers[key] = value; }, status: status => ({ json: body => { response = { status, headers, json: async () => body }; return response; } }) };
      await routes.defaults(req, res);
      return response;
    }
    routes[area] ??= f.load(`src/app/api/${paths[area]}/route.ts`, mocks);
    const method = ["versions", "cycle-get"].includes(area) ? "GET" : "POST";
    const body = { field: { fieldId: "field-1", taskId: task.id, value: "Changed" }, restore: { version_id: snapshot.id }, "cycle-post": { taskId: task.id, cycleId: nextCycle.id } }[area];
    const req = new NextRequest(`https://app.hypertask.ai/api/${paths[area]}?taskId=${task.id}&agentId=forged-agent&userId=999`, {
      method,
      ...(method === "GET" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, userId: 999, agentId: "forged-agent", ...overrides }) }),
    });
    return routes[area][method](req, { params: Promise.resolve({ taskId: String(task.id) }) });
  }
  return { ...f, project, task, snapshot, sections, queries, writes, ranks, broadcasts, request };
}

async function allowed(h, area, overrides) {
  const response = await h.request(area, overrides);
  assert.equal(response.status, 200);
  const body = await response.json();
  if (area === "field") assert.deepEqual(body, { id: "value-1", value: "Changed" });
  if (area === "restore") assert.deepEqual(body, { ok: true, restored_from_version: 2 });
  if (area === "versions") { assert.equal(body.versions[0].actor.displayName, h.user.displayName); assert.equal(body.current.contentText, "scope fixture"); }
  if (area === "cycle-get") { assert.equal(body.cycles.length, 2); assert.ok(body.cycles.every(cycle => cycle.assignable)); }
  if (area === "cycle-post") assert.equal(body.cycleId, 12);
  if (area === "defaults") assert.deepEqual(body, { section: "Todo", ranking: "new-rank", sectionId: h.sections[0].id });
}

for (const area of areas) {
  test(`${area}: ungranted internal agent is refused in ENFORCE`, async () => {
    const h = harness();
    assert.equal((await h.request(area)).status, area === "defaults" ? 403 : 404);
    assert.equal(h.state.flagReads, 1);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.ranks, []);
    assert.deepEqual(h.broadcasts, []);
    assert.ok(!h.queries.some(query => ["versions", "snapshot", "cycles"].includes(query.model)));
  });
  test(`${area}: same ungranted internal agent remains allowed in WATCH`, async () => {
    const h = harness({ enforce: false });
    await allowed(h, area);
    assert.equal(h.state.flagReads, 1);
  });
  test(`${area}: Accepted same-owner active agent remains allowed in ENFORCE`, async () => {
    const h = harness({ grant: "accepted" });
    await allowed(h, area);
    assert.equal(h.state.flagReads, 1);
  });
  for (const grant of ["invited", "revoked", "wrong-board", "wrong-owner"]) {
    test(`${area}: ${grant} grant cannot authorize ENFORCE access`, async () => {
      const h = harness({ grant });
      assert.equal((await h.request(area)).status, area === "defaults" ? 403 : 404);
      assert.deepEqual(h.writes, []);
    });
  }
  for (const actor of ["owner", "member", "guest"]) {
    test(`${area}: human ${actor} remains allowed without reading enforce flag`, async () => {
      const h = harness({ actor });
      await allowed(h, area);
      assert.equal(h.state.flagReads, 0);
    });
    test(`${area}: teamless human ${actor} retains existing eligibility and response`, async () => {
      const h = harness({ actor, teamless: true });
      if (["cycle-get", "cycle-post", "defaults"].includes(area)) await allowed(h, area);
      else assert.equal((await h.request(area)).status, area === "field" ? 403 : 404);
    });
  }
  test(`${area}: unrelated human remains refused without business effects`, async () => {
    const h = harness({ actor: "outsider" });
    assert.equal((await h.request(area)).status, ["field", "defaults"].includes(area) ? 403 : 404);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.ranks, []);
  });
  test(`${area}: agent grant cannot widen original human access`, async () => {
    const h = harness({ grant: "accepted" });
    h.project.ownerId = 99;
    h.project.owner = { id: 99, agents: [] };
    assert.equal((await h.request(area)).status, ["field", "defaults"].includes(area) ? 403 : 404);
    assert.deepEqual(h.writes, []);
  });
}

for (const area of ["field", "restore", "versions"]) {
  test(`${area}: profile fallback preserves owner access`, async () => {
    const h = harness({ actor: "owner", profile: false });
    await allowed(h, area);
  });
}

for (const area of ["restore", "versions", "cycle-get", "cycle-post", "defaults"]) {
  test(`${area}: archived project retains original refusal`, async () => {
    const h = harness({ actor: "owner" });
    h.project.status = "Archive";
    assert.equal((await h.request(area)).status, area === "defaults" ? 403 : 404);
  });
}

test("field: legacy archived board eligibility, missing task and missing field responses are preserved", async () => {
  const archived = harness({ actor: "owner" });
  archived.project.status = "Archive";
  await allowed(archived, "field");
  const missing = harness({ actor: "owner" });
  assert.equal((await missing.request("field", { taskId: 999 })).status, 404);
  const field = harness({ actor: "owner" });
  assert.equal((await field.request("field", { fieldId: "foreign-field" })).status, 404);
  assert.deepEqual(field.writes, []);
});

test("field: subsequent project gate independently carries the authenticated agent scope", async () => {
  const h = harness();
  h.prisma.task.findUnique = async () => ({ projectId: h.project.id });
  assert.equal((await h.request("field")).status, 403);
  assert.deepEqual(h.writes, []);
});

test("defaults: recorded rank lookup independently carries ENFORCE scope when the earlier gate is bypassed", async () => {
  for (const enforce of [true, false]) {
    const h = harness({ enforce, bypassProject: true });
    await allowed(h, "defaults");
    const query = h.queries.find(query => query.model === "task");
    assert.equal(matches(h.task, query.where), !enforce);
    assert.deepEqual(h.ranks, [[undefined, enforce ? undefined : h.task.ranking]]);
  }
});

for (const position of ["top", "bottom"]) {
  test(`defaults: ${position} ranking retains section, project, Normal status and direction`, async () => {
    const h = harness({ actor: "guest", teamless: true });
    await allowed(h, "defaults", { position });
    const query = h.queries.find(query => query.model === "task");
    assert.equal(query.where.sectionId, h.sections[0].id);
    assert.equal(query.where.projectId, h.project.id);
    assert.equal(query.where.status, "Normal");
    assert.deepEqual(query.orderBy, { ranking: position === "top" ? "asc" : "desc" });
    assert.deepEqual(h.ranks, [position === "top" ? [undefined, h.task.ranking] : [h.task.ranking, undefined]]);
    for (const mutation of [{ sectionId: 999 }, { projectId: 999 }, { status: "Archive" }]) assert.equal(matches({ ...h.task, ...mutation }, query.where), false);
  });
}

test("defaults: stale and foreign sections fall back, hidden/deleted sections never leak", async () => {
  for (const sectionId of ["missing", "999"]) {
    const h = harness({ actor: "owner" });
    await allowed(h, "defaults", { sectionId });
    assert.equal(h.queries.filter(query => query.model === "section").length, sectionId === "999" ? 2 : 1);
  }
  for (const mutation of [{ visibility: false }, { deleted: true }]) {
    const h = harness({ actor: "owner" });
    Object.assign(h.sections[0], mutation);
    assert.equal((await h.request("defaults")).status, 404);
    assert.deepEqual(h.ranks, []);
  }
});

for (const area of ["cycle-get", "cycle-post"]) {
  test(`${area}: archived task and disabled-cycle behavior remain unchanged`, async () => {
    const archived = harness({ actor: "owner" });
    archived.task.status = "Archive";
    assert.equal((await archived.request(area)).status, 404);
    const disabled = harness({ actor: "guest", teamless: true });
    disabled.project.cyclesEnabled = false;
    if (area === "cycle-get") {
      const response = await disabled.request(area);
      assert.equal(response.status, 200);
      assert.ok((await response.json()).cycles.every(cycle => !cycle.assignable));
    } else {
      assert.equal((await disabled.request(area)).status, 409);
      assert.equal((await disabled.request(area, { cycleId: null })).status, 200);
    }
  });
}

test("cycle POST: foreign and historical cycles remain refused, authorized next cycle keeps actor and broadcasts", async () => {
  const h = harness({ actor: "member" });
  for (const cycleId of [13, 999]) assert.equal((await h.request("cycle-post", { cycleId })).status, 400);
  assert.deepEqual(h.writes, []);
  await allowed(h, "cycle-post");
  assert.deepEqual(h.writes[0].slice(0, 2), ["task", { id: h.task.id, cycleId: 12 }]);
  assert.equal(h.writes[0][2].id, h.user.id);
  assert.deepEqual(h.broadcasts, [["board", h.project.id, { originUserId: h.user.id }], ["task", h.task.id, { originUserId: h.user.id }]]);
});

test("description restore: snapshot association, optimistic lock and actor remain unchanged", async () => {
  for (const mutation of [{ entityId: 999 }, { entityType: "page" }]) {
    const h = harness({ actor: "owner" });
    Object.assign(h.snapshot, mutation);
    assert.equal((await h.request("restore")).status, 404);
    assert.deepEqual(h.writes, []);
  }
  const h = harness({ actor: "guest" });
  await allowed(h, "restore");
  assert.equal(h.writes[0][2].id, h.user.id);
  assert.deepEqual(h.writes[0][4], { expectedDescription: "scope fixture" });
});

test("HTTP tagged-agent defaults GET stays refused while the task-create POST bridge stays allowed in both modes", async () => {
  const { harness: proxyHarness } = require("./helpers/agent-cookie-bridge.cjs");
  for (const enforce of [false, true]) {
    const h = proxyHarness({ enforce });
    for (const [route, method] of [["tasks/createGlobally", "GET"], ["customFields/value", "POST"], ["tasks/21280/description-restore", "POST"], ["tasks/21280/description-versions", "GET"], ["tasks/cycle", "GET"], ["tasks/cycle", "POST"]]) {
      const response = await h.proxy(h.request(`/api/${route}`, { method }));
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "AGENT_COOKIE_ROUTE");
    }
    const response = await h.proxy(h.request("/api/tasks/createGlobally", { method: "POST" }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  }
});

for (const area of areas) {
  test(`${area}: no authenticated identity and no profile keeps Unauthorized`, async () => {
    const h = harness({ actor: "owner", authenticated: false, profile: false });
    assert.equal((await h.request(area)).status, 401);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.ranks, []);
  });
  test(`${area}: teamless Accepted agent retains the route's existing team rule`, async () => {
    const h = harness({ grant: "accepted", teamless: true });
    if (["cycle-get", "cycle-post", "defaults"].includes(area)) await allowed(h, area);
    else assert.equal((await h.request(area)).status, 404);
  });
  test(`${area}: authenticated agent on a human member board remains allowed`, async () => {
    const h = harness({ grant: "accepted" });
    h.project.ownerId = 99;
    h.project.owner = { id: 99, agents: [] };
    h.project.members.push({ userId: h.user.id, agentId: null, status: "Accepted", user: h.user });
    await allowed(h, area);
  });
}

for (const area of ["restore", "versions"]) {
  test(`${area}: archived task on a Normal project retains existing description access`, async () => {
    const h = harness({ actor: "member" });
    h.task.status = "Archive";
    await allowed(h, area);
    const query = h.queries.find(query => query.model === "task");
    assert.equal(matches({ ...h.task, id: 999 }, query.where), false);
  });
}

test("request-supplied agent and owner IDs cannot borrow a different Accepted grant", async () => {
  for (const area of areas) {
    const h = harness();
    h.project.members.push({ agentId: "forged-agent", status: "Accepted", agent: { id: "forged-agent", userId: 999, revokedAt: null } });
    assert.equal((await h.request(area)).status, area === "defaults" ? 403 : 404);
    assert.deepEqual(h.writes, []);
  }
});
