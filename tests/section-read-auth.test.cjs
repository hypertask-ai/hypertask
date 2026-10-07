const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const projects = [
  { id: 15, teamId: 1, ownerId: 42, members: [] },
  { id: 16, teamId: 1, ownerId: 99, members: [{ userId: 42, agentId: null }] },
  { id: 17, teamId: 2, ownerId: 99, members: [] },
  { id: 18, teamId: 2, ownerId: 99, members: [{ userId: 42, agentId: "agent-only" }] },
];
const sections = projects.map(({ id }) => ({ id: id * 10, projectId: id, deleted: false, ranking: id }));

function harness({ userId = 42 } = {}) {
  const calls = [];
  const mocks = {
    "@/lib/prisma": { default: {
      section: { findMany: async (query) => {
        calls.push(["sections", query]);
        return sections.filter((section) => {
          const where = query?.where;
          return (!where?.project || accessible(section.projectId, where.project)) &&
            (where?.projectId === undefined || section.projectId === where.projectId);
        });
      } },
      task: { findFirst: async (query) => {
        calls.push(["task", query]);
        const projectId = query.where.id;
        if (!projects.some(({ id }) => id === projectId)) return null;
        if (query.where.project && !accessible(projectId, query.where.project)) return null;
        return { id: projectId, projectId };
      } },
    } },
    "@/lib/auth/getSessionUser": { getSessionUser: async (headers) => {
      assert.ok(headers instanceof Headers);
      calls.push(["session"]);
      return userId === null ? null : { userId, source: "better-auth" };
    } },
    // Load the real read-access predicate; mock only its unrelated dependencies.
    "@/lib/agents/publicAgent": {},
    "@/lib/cycles": {},
    "@/lib/agents/visibility": {},
    "@/utils/controllers/notifications/visibleInboxScope": {},
  };
  function accessible(projectId, where) {
    const project = projects.find(({ id }) => id === projectId);
    return where.OR.some((branch) =>
      branch.ownerId === project.ownerId ||
      (branch.members && project.members.some((member) =>
        member.userId === branch.members.some.userId && member.agentId === branch.members.some.agentId)));
  }
  async function request(route, body = {}) {
    const handler = load(`src/pages/api/section/${route}.ts`, mocks).default;
    const res = { status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method: "POST", headers: {}, body }, res);
    return res;
  }
  return { request, calls };
}

for (const route of ["getAll", "getByTaskId"]) {
  test(`${route}: rejects logged-out requests before validation or data reads`, async () => {
    for (const body of [{}, { userId: 99, taskId: 17 }]) {
      const h = harness({ userId: null });
      const res = await h.request(route, body);
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.body, { message: "Unauthorized" });
      assert.deepEqual(h.calls.map(([kind]) => kind), ["session"]);
    }
  });
}

test("getAll: session scopes results to owned and human-member boards, ignoring body userId", async () => {
  for (const body of [{}, { userId: 99 }, { userId: 99, projectId: 17, teamId: 2 }]) {
    const h = harness();
    const res = await h.request("getAll", body);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, sections.slice(0, 2));
    assert.deepEqual(h.calls.at(-1)[1].where.project, {
      OR: [{ ownerId: 42 }, { members: { some: { userId: 42, agentId: null } } }],
    });
  }
});

for (const taskId of [15, 16]) {
  test(`getByTaskId: readable task ${taskId} preserves section JSON and ordering`, async () => {
    const h = harness();
    const res = await h.request("getByTaskId", { taskId, userId: 99 });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, [sections.find(({ projectId }) => projectId === taskId)]);
    assert.deepEqual(h.calls.at(-1)[1], { where: { projectId: taskId, deleted: false }, orderBy: { ranking: "asc" } });
  });
}

for (const taskId of [17, 18, 999]) {
  test(`getByTaskId: inaccessible or missing task ${taskId} returns 404 without section reads`, async () => {
    const h = harness();
    const res = await h.request("getByTaskId", { taskId, userId: 99, teamId: 2 });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { message: "Task not found" });
    assert.ok(!h.calls.some(([kind]) => kind === "sections"));
  });
}

test("getByTaskId: signed-in callers still need a taskId", async () => {
  const h = harness();
  const res = await h.request("getByTaskId");
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: "Missing TaskId" });
  assert.deepEqual(h.calls.map(([kind]) => kind), ["session"]);
});
