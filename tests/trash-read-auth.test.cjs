const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");

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
  const handler = load("src/pages/api/trash/getTrashByProjectId.ts", mocks).default;
  async function request(projectId = "17") {
    const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ headers: {}, query: { projectId, userId: 99 }, body: { userId: 99 } }, res);
    return res;
  }
  const filename = path.resolve(__dirname, "../src/app/trash/[projectId]/page.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const pageModule = { exports: {} };
  new Function("require", "module", "exports", compiled)(specifier => {
    if (specifier === "react/jsx-runtime") return { jsx: (component, props) => component(props) };
    if (specifier === "@/components/PageComponents/Trash/TrashComp") return { __esModule: true, default: props => { calls.rendered.push(props); return props; } };
    if (specifier === "next/navigation") return { notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("LOGIN_REDIRECT"); } };
    if (specifier === "@/utils/controllers/trash/getByProjectId") return { __esModule: true, default: controller };
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    return load(`src/${specifier.slice(2)}.ts`, mocks);
  }, pageModule, pageModule.exports);
  const page = projectId => pageModule.exports.default({ params: Promise.resolve({ projectId }) });
  return { request, page, controller, project, calls };
}

for (const [name, options] of [
  ["other-team outsider", {}],
  ["same-team nonmember", { teamId: 42 }],
  ["agent-only member", { members: [{ userId: 42, agentId: "agent-only" }] }],
  ["deleted project owner", { ownerId: 42, status: "Deleted" }],
]) {
  test(`trash API and page deny ${name} before loading tasks or creator profiles`, async () => {
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
  test(`trash preserves deleted-task results and rendering for ${name}`, async () => {
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

test("missing project and inaccessible project have the same 404", async () => {
  const h = harness();
  const missing = await h.request("999");
  const denied = await h.request();
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.body, denied.body);
  await assert.rejects(h.page("999"), /NOT_FOUND/);
  assert.equal(h.calls.protectedReads, 0);
});

test("membership removal takes effect on the next trash read", async () => {
  const h = harness({ members: [{ userId: 42, agentId: null }] });
  assert.equal((await h.request()).statusCode, 200);
  h.project.members.length = 0;
  assert.equal((await h.request()).statusCode, 404);
  await assert.rejects(h.page("17"), /NOT_FOUND/);
  assert.equal(h.calls.protectedReads, 1);
});

test("anonymous API and page requests never read projects", async () => {
  const h = harness({ userId: null });
  assert.equal((await h.request()).statusCode, 401);
  assert.equal(await h.controller({ projectId: 17, userId: 0 }), null);
  await assert.rejects(h.page("17"), /LOGIN_REDIRECT/);
  assert.deepEqual(h.calls.queries, []);
});

for (const projectId of [undefined, "", "abc", "17tail", "17.5", "0", "-17", ["17"], "9007199254740992"]) {
  test(`invalid project id ${JSON.stringify(projectId)} is rejected before queries`, async () => {
    const h = harness({ ownerId: 42 });
    assert.equal((await h.request(projectId === undefined ? null : projectId)).statusCode, 400);
    await assert.rejects(h.page(projectId), /NOT_FOUND/);
    assert.deepEqual(h.calls.queries, []);
  });
}

test("authorized empty trash is successful, not not-found", async () => {
  const h = harness({ ownerId: 42, empty: true });
  const res = await h.request();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.tasks, []);
});

test("database failures remain errors rather than not-found", async () => {
  const h = harness({ ownerId: 42, failure: true });
  assert.equal((await h.request()).statusCode, 500);
  await assert.rejects(h.controller({ projectId: 17, userId: 42 }), /synthetic database failure/);
  await assert.rejects(h.page("17"), /synthetic database failure/);
});
