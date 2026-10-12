const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const policyMocks = {
  "@/lib/agents/publicAgent": {}, "@/lib/cycles": {},
  "@/lib/agents/visibility": {},
  "@/utils/controllers/notifications/visibleInboxScope": {},
};
const { projectContentAccessWhere } = load("src/utils/controllers/projects/getAllIncludes.ts", policyMocks);

function matches(project, where = {}) {
  if (where.ownerId !== undefined && project.ownerId !== where.ownerId) return false;
  if (where.members?.some && !project.members.some(member =>
    Object.entries(where.members.some).every(([key, value]) => member[key] === value))) return false;
  return !where.OR || where.OR.some(branch => matches(project, branch));
}

function harness({ userId = 42, ownerId = 99, members = [] } = {}) {
  const project = { ownerId, members };
  const foreign = { ownerId: 99, members: [] };
  const tasks = [
    { id: 101, project, status: "Deleted", title: "private deleted parent", children: [102, 103] },
    { id: 102, project, status: "Deleted", title: "private deleted child", children: [] },
    { id: 103, project: foreign, status: "Deleted", title: "foreign child", children: [104] },
    { id: 104, project: foreign, status: "Deleted", title: "foreign grandchild", children: [] },
  ];
  const calls = { queries: [], materialized: [], sessions: 0 };
  async function read(query) {
    calls.queries.push(query);
    const task = tasks.find(task => task.id === query.where.id);
    if (!task || !matches(task.project, query.where.project)) return null;
    calls.materialized.push(task.id);
    const nested = query.select?.subTasks;
    return {
      id: task.id,
      subTasks: task.children.map(id => tasks.find(task => task.id === id))
        .filter(child => !nested?.where?.project || matches(child.project, nested.where.project))
        .map(child => nested?.select?.id ? { id: child.id } : child),
    };
  }
  const actions = load("src/app/[...boardURL]/serverActions.tsx", {
    ...policyMocks,
    "@/lib/prisma": { default: { task: { findFirst: read, findUnique: read } } },
    "next/headers": { headers: async () => new Headers() },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => {
      calls.sessions++;
      return userId === null ? null : { userId };
    } },
    "@/utils/controllers/notifications/getCount": {},
    "@/utils/controllers/projects/getAll": {},
    "@/utils/helperFunctions/helperFunctions": {},
    "@/utils/controllers/projects/getAllMinimal": {},
    "@/utils/controllers/projects/views/viewsHelperAPIfunctions": {},
    "@/utils/helperFunctions/Views/BoardFilterSanitizer": {},
  });
  return { actions, project, calls };
}

test("unused task-row server action is no longer remotely callable", () => {
  assert.equal(Object.hasOwn(harness().actions, "getTaskServer"), false);
});

for (const [name, options] of [
  ["anonymous", { userId: null }],
  ["other-team outsider", {}],
  ["agent-only member", { members: [{ userId: 42, agentId: "owned-agent" }] }],
]) {
  test(`subtask server action denies ${name} without protected rows`, async () => {
    const h = harness(options);
    assert.equal(await h.actions.getAllSubTasks(101), undefined);
    assert.deepEqual(h.calls.materialized, []);
    assert.equal(h.calls.sessions, 1);
    if (options.userId === null) assert.deepEqual(h.calls.queries, []);
  });
}

for (const [name, options] of [
  ["owner", { ownerId: 42 }],
  ["member", { members: [{ userId: 42, agentId: null }] }],
]) {
  test(`subtask server action preserves delete-modal number[] contract for ${name}`, async () => {
    const h = harness(options);
    assert.deepEqual(await h.actions.getAllSubTasks(101), [101, 102]);
    assert.deepEqual(h.calls.materialized, [101, 102]);
    assert.equal(h.calls.sessions, 1);
    for (const query of h.calls.queries) {
      assert.deepEqual(query.where.project, projectContentAccessWhere(42));
      assert.deepEqual(query.select.subTasks.where.project, projectContentAccessWhere(42));
      assert.deepEqual(query.select.subTasks.select, { id: true });
    }
  });
}

test("removed members lose subtask access on the next call", async () => {
  const h = harness({ members: [{ userId: 42, agentId: null }] });
  assert.deepEqual(await h.actions.getAllSubTasks(101), [101, 102]);
  h.project.members.length = 0;
  assert.equal(await h.actions.getAllSubTasks(101), undefined);
  assert.deepEqual(h.calls.materialized, [101, 102]);
});

test("missing task is indistinguishable from inaccessible task", async () => {
  const h = harness();
  assert.equal(await h.actions.getAllSubTasks(999), undefined);
  assert.equal(await h.actions.getAllSubTasks(101), undefined);
  assert.deepEqual(h.calls.materialized, []);
});
