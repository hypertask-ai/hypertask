const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const policyMocks = {
  "@/lib/agents/publicAgent": {}, "@/lib/cycles": {},
  "@/lib/agents/visibility": {},
  "@/utils/controllers/notifications/visibleInboxScope": {},
};
const { projectContentAccessWhere } = load("src/utils/controllers/projects/getAllIncludes.ts", policyMocks);

function matches(project, where) {
  if (where.id !== undefined && project.id !== where.id) return false;
  if (where.status?.not === project.status) return false;
  if (where.ownerId !== undefined && project.ownerId !== where.ownerId) return false;
  if (where.members?.some && !project.members.some(member =>
    Object.entries(where.members.some).every(([key, value]) => member[key] === value))) return false;
  return !where.OR || where.OR.some(branch => matches(project, branch));
}

for (const method of ["POST", "GET"]) {
function harness({ userId = 42, ownerId = 99, members = [], status = "Normal", teamId = 7, empty = false, failure = false } = {}) {
  const project = { id: 17, ownerId, members, status, teamId };
  const calls = { queries: [], protectedReads: 0, rendered: [] };
  const tasks = [
    { id: 101, status: "Deleted", deletedAt: 2, user: { email: "private-sentinel@example.test" } },
    { id: 102, status: "Deleted", deletedAt: 1, user: { email: "private-sentinel@example.test" } },
    { id: 103, status: "Normal", deletedAt: null },
    { id: 104, status: "Archive", deletedAt: null },
  ];
  const read = async query => {
    calls.queries.push(query);
    if (failure) throw new Error("synthetic database failure");
    if (!matches(project, query.where)) return null;
    calls.protectedReads++;
    const selectedTasks = (empty ? [] : tasks).filter(task => task.status === query.include.tasks.where.status);
    if (query.include.tasks.orderBy.deletedAt === "desc") selectedTasks.sort((a, b) => b.deletedAt - a.deletedAt);
    return { ...project, tasks: selectedTasks };
  };
  const mocks = {
    ...policyMocks,
    "@/lib/prisma": { default: { project: { findFirst: read, findUnique: read } } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => userId === null ? null : { userId } },
    "@/lib/auth/serverUser": { requireServerCookieUser: async () => {
      if (userId === null) throw new Error("LOGIN_REDIRECT");
      return { id: userId };
    } },
  };
  const controller = load("src/utils/controllers/trash/getByProjectId.ts", mocks).default;
  const handler = load("src/app/api/trash/getTrashByProjectId/route.ts", mocks)[method];
  async function request(projectId = "17") {
    const url = new URL("https://app.test/api/trash/getTrashByProjectId?userId=99");
    if (projectId !== null) url.searchParams.set("projectId", projectId);
    const res = await handler(new Request(url, {
      method,
      ...(method === "POST" ? { body: JSON.stringify({ userId: 99 }) } : {}),
    }));
    return { statusCode: res.status, body: await res.json() };
  }
  const pageModule = load("src/app/trash/[projectId]/page.tsx", {
    ...mocks,
    "react/jsx-runtime": { jsx: (component, props) => component(props) },
    "@/components/PageComponents/Trash/TrashComp": { default: props => { calls.rendered.push(props); return props; } },
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); } },
    "@/utils/controllers/trash/getByProjectId": { default: controller },
  });
  const page = projectId => pageModule.default({ params: Promise.resolve({ projectId }) });
  return { request, page, controller, project, calls };
}

for (const [name, options] of [
  ["other-team outsider", {}],
  ["same-team nonmember", { teamId: 42 }],
  ["agent-only member", { members: [{ userId: 42, agentId: "agent-only" }] }],
  ["deleted project owner", { ownerId: 42, status: "Deleted" }],
]) {
  test(`${method}: trash API and page deny ${name} before loading tasks or creator profiles`, async () => {
    const h = harness(options);
    const res = await h.request();
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { message: "Project not found" });
    assert.equal(await h.controller({ projectId: 17, userId: 42 }), null);
    await assert.rejects(h.page("17"), /NOT_FOUND/);
    assert.equal(h.calls.protectedReads, 0);
    assert.deepEqual(h.calls.rendered, []);
  });
}

for (const [name, options] of [
  ["owner", { ownerId: 42 }],
  ["member", { members: [{ userId: 42, agentId: null, role: "Member" }] }],
  ["admin", { members: [{ userId: 42, agentId: null, role: "Admin" }] }],
  ["teamless owner", { ownerId: 42, teamId: null }],
  ["teamless member", { teamId: null, members: [{ userId: 42, agentId: null }] }],
  ["archived board owner", { ownerId: 42, status: "Archive" }],
]) {
  test(`${method}: trash preserves deleted-task results and rendering for ${name}`, async () => {
    const h = harness(options);
    const res = await h.request();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.tasks.map(task => task.id), [101, 102]);
    assert.equal(res.body.tasks[0].user.email, "private-sentinel@example.test");
    const rendered = await h.page("17");
    assert.deepEqual(rendered.project, res.body);
    assert.deepEqual(h.calls.queries[0].where, { id: 17, status: { not: "Deleted" }, ...projectContentAccessWhere(42) });
    assert.deepEqual(h.calls.queries[0].include.tasks.include, { priority: true, estimate: true, user: true });
  });
}

test(`${method}: missing project and inaccessible project have the same 404`, async () => {
  const h = harness();
  const missing = await h.request("999");
  const denied = await h.request();
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.body, denied.body);
  await assert.rejects(h.page("999"), /NOT_FOUND/);
  assert.equal(h.calls.protectedReads, 0);
});

test(`${method}: membership removal takes effect on the next trash read`, async () => {
  const h = harness({ members: [{ userId: 42, agentId: null }] });
  assert.equal((await h.request()).statusCode, 200);
  h.project.members.length = 0;
  assert.equal((await h.request()).statusCode, 404);
  await assert.rejects(h.page("17"), /NOT_FOUND/);
  assert.equal(h.calls.protectedReads, 1);
});

test(`${method}: anonymous API and page requests never read projects`, async () => {
  const h = harness({ userId: null });
  assert.deepEqual(await h.request(), { statusCode: 401, body: { message: "Unauthorized" } });
  assert.equal(await h.controller({ projectId: 17, userId: 0 }), null);
  await assert.rejects(h.page("17"), /LOGIN_REDIRECT/);
  assert.deepEqual(h.calls.queries, []);
});

for (const projectId of [undefined, "", "abc", "17tail", "17.5", "0", "-17", "17,18", "9007199254740992"]) {
  test(`${method}: invalid project id ${JSON.stringify(projectId)} is rejected before queries`, async () => {
    const h = harness({ ownerId: 42 });
    assert.deepEqual(await h.request(projectId === undefined ? null : projectId), {
      statusCode: 400, body: { message: "Missing Required information" },
    });
    await assert.rejects(h.page(["17"]), /NOT_FOUND/);
    await assert.rejects(h.page(projectId), /NOT_FOUND/);
    assert.deepEqual(h.calls.queries, []);
  });
}

test(`${method}: authorized empty trash is successful, not not-found`, async () => {
  const h = harness({ ownerId: 42, empty: true });
  const res = await h.request();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.tasks, []);
});

test(`${method}: database failures remain errors rather than not-found`, async () => {
  const h = harness({ ownerId: 42, failure: true });
  assert.deepEqual(await h.request(), { statusCode: 500, body: {} });
  await assert.rejects(h.controller({ projectId: 17, userId: 42 }), /synthetic database failure/);
  await assert.rejects(h.page("17"), /synthetic database failure/);
});
}
