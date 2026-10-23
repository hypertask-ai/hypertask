const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

// HTPR-7169: /api/labels/getByProject listed labels and labeled task titles of
// any board to anyone, even logged out.
const projects = [
  { id: 15, ownerId: 42, members: [] },
  { id: 16, ownerId: 99, members: [{ userId: 42, agentId: null }] },
  { id: 17, ownerId: 99, members: [] },
];
function accessible(projectId, where) {
  const project = projects.find(p => p.id === projectId);
  return Boolean(project) && where.OR.some(branch => branch.ownerId === project.ownerId ||
    (branch.members && project.members.some(member =>
      member.userId === branch.members.some.userId && member.agentId === branch.members.some.agentId)));
}

function harness(userId) {
  const calls = [];
  const mocks = {
    "@/lib/prisma": { default: {
      project: { findFirst: async query => {
        calls.push(["project", query]);
        const [{ id }, access] = query.where.AND;
        return accessible(id, access) ? { id } : null;
      } },
      label: { findMany: async query => {
        calls.push(["labels", query]);
        const rows = [15, 17].map((projectId, i) => ({ id: i + 1, task: { id: projectId, projectId, title: `task on ${projectId}`, status: "Normal" } }));
        const visible = rows.filter(row => accessible(row.task.projectId, query.include.task.where.task.project));
        return [{ id: "label-1", projectId: query.where.projectId, task: visible, _count: { task: visible.length } }];
      } },
    } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => (userId === null ? null : { userId }) },
    "@/lib/agents/publicAgent": {}, "@/lib/cycles": {}, "@/lib/agents/visibility": {},
    "@/utils/controllers/notifications/visibleInboxScope": {},
  };
  async function request(projectId) {
    const handler = load("src/pages/api/labels/getByProject.ts", mocks).default;
    const res = { status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method: "GET", query: { projectId }, headers: {} }, res);
    return res;
  }
  return { calls, request };
}

test("logged-out callers get 401 and nothing is read", async () => {
  const { calls, request } = harness(null);
  const res = await request("15");
  assert.equal(res.statusCode, 401);
  assert.deepEqual(calls, []);
});

test("signed-in caller cannot read a foreign board's labels", async () => {
  const { calls, request } = harness(42);
  const res = await request("17");
  assert.equal(res.statusCode, 404);
  assert.equal(calls.some(([kind]) => kind === "labels"), false);
});

test("owner and member read labels, with foreign-board tasks filtered out", async () => {
  for (const projectId of ["15", "16"]) {
    const { calls, request } = harness(42);
    const res = await request(projectId);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body[0].task.length, 1);
    assert.equal(res.body[0].task[0].task.projectId, 15);
    const labelsQuery = calls.find(([kind]) => kind === "labels")[1];
    assert.ok(labelsQuery.include._count.select.task.where.task.project.OR);
  }
});

test("a bad project id is rejected before any read", async () => {
  const { calls, request } = harness(42);
  const res = await request("abc");
  assert.equal(res.statusCode, 400);
  assert.deepEqual(calls, []);
});
