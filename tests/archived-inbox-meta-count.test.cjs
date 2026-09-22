// HTPR-6509: the archived-inbox counter used to load every archived
// notification to count distinct (type, task) pairs per board. It now asks the
// database for the distinct pairs and looks up only their tasks. The numbers
// the archive sidebar shows must not change: one per distinct (type, task),
// grouped by the task's board, busiest board first, ties by name.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const projects = {
  10: { id: 10, name: "alpha-name", title: null, ownerId: 6, status: "Normal" },
  20: { id: 20, name: "beta-name", title: "Beta", ownerId: 6, status: "Normal" },
  30: { id: 30, name: "aardvark-name", title: "Aardvark", ownerId: 6, status: "Normal" },
  // Someone else's board, the user is not a member.
  40: { id: 40, name: "secret-name", title: "Secret", ownerId: 99, status: "Normal" },
};
let tasks = [];
const originalTasks = [
  { id: 1, projectId: 10 },
  { id: 2, projectId: 10 },
  { id: 3, projectId: 20 },
  { id: 4, projectId: 30 },
];

// Minimal evaluator for the board filter the route passes to task.findMany.
function projectMatches(project, where) {
  if (!where) return true;
  if (where.status && project.status !== where.status) return false;
  return where.OR.some((clause) => clause.ownerId === project.ownerId);
}
// Archived notifications the where clause matched. (Comment, 1) appears three
// times and (Mention, 3) twice: each pair counts once.
const archived = [
  { type: "Comment", taskId: 1 },
  { type: "Comment", taskId: 1 },
  { type: "Comment", taskId: 1 },
  { type: "Mention", taskId: 1 },
  { type: "Comment", taskId: 2 },
  { type: "Comment", taskId: 3 },
  { type: "Mention", taskId: 3 },
  { type: "Mention", taskId: 3 },
  { type: "Comment", taskId: 4 },
  { type: "Assigned", taskId: 4 },
];

function loadHandler() {
  tasks = originalTasks.map((task) => ({ ...task }));
  const calls = { groupBy: [], taskFindMany: [], notificationFindMany: 0 };
  for (const relativePath of [
    "src/pages/api/notifications/getAllInbox.ts",
    "src/lib/prisma.ts",
    "src/utils/controllers/notifications/getAll.ts",
  ]) {
    delete require.cache[path.join(root, relativePath)];
  }
  stubModule("src/utils/controllers/notifications/getAll.ts", {
    notificationInboxInclude: () => ({}),
  });
  stubModule("src/lib/prisma.ts", {
    default: {
      notification: {
        groupBy: async (args) => {
          calls.groupBy.push(args);
          const seen = new Map();
          for (const row of archived) seen.set(`${row.type}:${row.taskId}`, row);
          return [...seen.values()].map(({ type, taskId }) => ({ type, taskId }));
        },
        findMany: async () => {
          calls.notificationFindMany += 1;
          return [];
        },
      },
      task: {
        findMany: async (args) => {
          calls.taskFindMany.push(args);
          return tasks
            .filter((task) => args.where.id.in.includes(task.id))
            .filter((task) => projectMatches(projects[task.projectId], args.where.project))
            .map((task) => ({ ...task, project: projects[task.projectId] }));
        },
      },
    },
  });
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-archived-inbox-meta-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") }, cache: false },
  );
  const route = jiti(path.join(root, "src/pages/api/notifications/getAllInbox.ts"));
  return { handler: route.default ?? route, calls };
}

async function callMeta(handler, query) {
  let statusCode;
  let body;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };
  await handler(
    { query: { mode: "meta", ...query }, cookies: { nookies_user: JSON.stringify({ id: 6 }) } },
    res,
  );
  return { statusCode, body };
}

test("counts one per distinct (type, task), grouped by the task's board", async () => {
  const { handler, calls } = loadHandler();
  const { statusCode, body } = await callMeta(handler, {});

  assert.equal(statusCode, 200);
  assert.deepEqual(body, {
    total: 7,
    byProject: [
      // Title null falls back to the board name.
      { projectId: 10, name: "alpha-name", count: 3 },
      // Equal counts sort by name.
      { projectId: 30, name: "Aardvark", count: 2 },
      { projectId: 20, name: "Beta", count: 2 },
    ],
  });
  assert.equal(calls.notificationFindMany, 0, "no full notification load");
  assert.equal(calls.taskFindMany.length, 1);
  assert.deepEqual([...calls.taskFindMany[0].where.id.in].sort(), [1, 2, 3, 4]);
});

test("the grouped query keeps the archived-list filter unchanged", async () => {
  const { handler, calls } = loadHandler();
  await callMeta(handler, { projectId: "20", boardScope: "archived" });

  assert.equal(calls.groupBy.length, 1);
  assert.deepEqual(calls.groupBy[0].by, ["type", "taskId"]);
  assert.deepEqual(calls.groupBy[0].where, {
    userId: 6,
    status: "Archive",
    agentId: null,
    task: {
      project: {
        status: "Archive",
        OR: [
          { ownerId: 6 },
          { members: { some: { userId: 6, agentId: null } } },
        ],
      },
      projectId: 20,
      Reminders: { every: { status: { not: "Normal" } } },
    },
  });
});

test("a task moved to a board the user can't see is not counted or named", async () => {
  const { handler, calls } = loadHandler();
  // Task 4 moves to someone else's board between the grouped query and the
  // task lookup.
  tasks.find((task) => task.id === 4).projectId = 40;
  const { body } = await callMeta(handler, {});

  assert.deepEqual(calls.taskFindMany[0].where.project, {
    status: "Normal",
    OR: [
      { ownerId: 6 },
      { members: { some: { userId: 6, agentId: null } } },
    ],
  });
  assert.deepEqual(body, {
    total: 5,
    byProject: [
      { projectId: 10, name: "alpha-name", count: 3 },
      { projectId: 20, name: "Beta", count: 2 },
    ],
  });
  assert.ok(!JSON.stringify(body).includes("Secret"));
});
