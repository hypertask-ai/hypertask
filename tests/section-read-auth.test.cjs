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
    } },
    "@/lib/auth/getSessionUser": { getSessionUser: async (headers) => {
      assert.ok(headers instanceof Headers);
      calls.push(["session"]);
      return userId === null ? null : { userId, source: "better-auth" };
    } },
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
    const res = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method: "POST", headers: {}, body }, res);
    return res;
  }
  return { request, calls };
}

test("getAll: rejects logged-out requests before validation or data reads", async () => {
  for (const body of [{}, { userId: 99, taskId: 17 }]) {
    const h = harness({ userId: null });
    const res = await h.request("getAll", body);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { message: "Unauthorized" });
    assert.ok(h.calls.length > 0 && h.calls.every(([kind]) => kind === "session"));
  }
});

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
