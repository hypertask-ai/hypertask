const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const projects = [
  { id: 15, ownerId: 42, members: [] },
  { id: 16, ownerId: 99, members: [{ userId: 42, agentId: null }] },
  { id: 17, ownerId: 99, members: [] },
  { id: 18, ownerId: 99, members: [{ userId: 42, agentId: "agent-only" }] },
];
function harness(userId = 42) {
  const calls = [];
  function accessible(projectId, where) {
    const project = projects.find(p => p.id === projectId);
    return where.OR.some(branch => branch.ownerId === project.ownerId ||
      (branch.members && project.members.some(member =>
        member.userId === branch.members.some.userId && member.agentId === branch.members.some.agentId)));
  }
  const read = async (query) => { calls.push(["content", query]); return [{ id: 1 }]; };
  const mocks = {
    "@/lib/prisma": { default: {
      task: { findUnique: async query => { calls.push(["content", query]); return { id: query.where.id }; }, findFirst: async query => {
        calls.push(["task", query]);
        const taskId = query.where.id;
        if (!projects.some(p => p.id === taskId) ||
          (query.where.projectId !== undefined && taskId !== query.where.projectId) ||
          (query.where.project && !accessible(taskId, query.where.project))) return null;
        return { id: taskId, title: `task ${taskId}` };
      } },
      comment: { findMany: async query => { calls.push(["content", query]); return []; } },
      priority: { findFirst: read }, estimate: { findFirst: read }, taskLabel: { findMany: read },
      reminder: { findMany: async query => {
        calls.push(["content", query]);
        return projects.filter(p => !query.where.task?.project || accessible(p.id, query.where.task.project))
          .map(p => ({ taskId: p.id }));
      } },
    } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => { calls.push(["session"]); return userId === null ? null : { userId }; } },
    "@/lib/api/task-writes/route": { withTaskWriteFlag: handler => handler },
    "@/utils/controllers/tasks/getTask": {},
    "@/utils/controllers/tasks/getOrphanTasks": { default: async (...args) => { calls.push(["content", args]); return { status: 200, json: [] }; } },
    "@/utils/controllers/urls/fetchUrls": { default: async (...args) => { calls.push(["content", args]); return { status: 200, json: [] }; } },
    "@/utils/controllers/drafts/getDraftsController": { default: async (...args) => { calls.push(["content", args]); return []; } },
    "@/lib/flags": { HTPR_7050_CTRL_O_LINKS_FLAG: "htpr-7050-ctrl-o-links", isFeatureEnabled: async () => false },
    "@/lib/errors/reportError": { reportError: async () => {} },
    "@/utils/helperFunctions/multiPages": {},
    "@/utils/controllers/ai/task/generateCommentsController": {},
    "@/utils/controllers/ai/task/buildTaskPayloadForAI": { buildTaskPayloadForAI: task => task },
    "@/lib/agents/publicAgent": {}, "@/lib/cycles": {}, "@/lib/agents/visibility": {},
    "@/utils/controllers/notifications/visibleInboxScope": {},
  };
  async function request(route, body) {
    const handler = load(`src/pages/api/${route}.ts`, mocks).default;
    const res = { status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    const method = ["drafts/getDrafts", "tasks/getTaskMinimal", "ai/generateComments"].includes(route) ? "POST" : "GET";
    await handler({ method, query: body, body, headers: {} }, res);
    return res;
  }
  async function typed(route, body) {
    const handler = load(`src/lib/api/task-writes/${route === "tasks/getTaskMinimal" ? "minimal-read" : "search-orphans"}.ts`, mocks);
    const response = await (handler.READ ?? handler.GET)({ headers: new Headers(), json: async () => body,
      url: `https://example.test/api?${new URLSearchParams(body)}` });
    return { statusCode: response.status, body: await response.json() };
  }
  return { request, typed, calls };
}

for (const route of ["priority/getByTask", "estimate/getByTask", "labels/getByTask", "urls/fetchUrls", "drafts/getDrafts", "tasks/getTaskMinimal", "tasks/searchOrphans", "ai/generateComments"]) {
  const modes = route.startsWith("tasks/") ? ["request", "typed"] : ["request"];
  for (const mode of modes) {
    for (const taskId of [15, 16, 17, 18, 999]) {
      test(`${route} ${mode}: task ${taskId} requires owner or human board membership`, async () => {
        const h = harness();
        const res = await h[mode](route, { taskId, id: taskId, projectId: taskId, currentTaskId: taskId, userId: 99 });
        assert.equal(res.statusCode, taskId < 17 ? 200 : 404);
        assert.deepEqual(h.calls.slice(0, 2).map(([kind]) => kind), ["session", "task"]);
        if (taskId >= 17) assert.equal(h.calls.length, 2, "Denied before protected reads");
        if (route === "drafts/getDrafts" && taskId < 17) assert.deepEqual(h.calls.at(-1), ["content", [taskId, 42]]);
      });
    }
    test(`${route} ${mode}: anonymous requests do not read ticket content`, async () => {
      const h = harness(null);
      const res = await h[mode](route, { taskId: 17, id: 17, projectId: 17, currentTaskId: 17, userId: 99 });
      assert.equal(res.statusCode, 401);
      assert.deepEqual(h.calls.map(([kind]) => kind), ["session"]);
    });
  }
}

for (const mode of ["request", "typed"]) {
  test(`searchOrphans ${mode}: readable current task does not authorize another project`, async () => {
    const h = harness();
    const res = await h[mode]("tasks/searchOrphans", { projectId: 17, currentTaskId: 15 });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(h.calls.map(([kind]) => kind), ["session", "task"]);
  });
}

test("reminders/getAll: losing board access hides reminder task content", async () => {
  const h = harness();
  const res = await h.request("reminders/getAll", {});
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, [{ taskId: 15 }, { taskId: 16 }]);
  assert.equal(h.calls[1][1].where.userId, 42);
});
