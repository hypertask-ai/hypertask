const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");

const root = path.resolve(__dirname, "..");
const file = "src/utils/controllers/taskDetail/load.ts";
const jiti = require("jiti").createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const flags = jiti(path.join(root, "src/lib/flags/keys.ts"));
const { findCachedTaskDetail } = jiti(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));

function load({ enabled = [], task = null, legacy = false } = {}) {
  const queries = [], flagCalls = [];
  const mocks = {
    "@prisma/client": require("@prisma/client"),
    "@vercel/functions": {},
    "@/lib/realtime/server": {},
    "@/lib/prisma": { __esModule: true, default: { task: { findFirst: async query => { queries.push(query); return task; } } } },
    "@/lib/mcp/tasks/resolveTask": {},
    "@/lib/cycles": { CYCLE_WINDOW_SIZE: 4 },
    "@/lib/pullRequests/taskPullRequests": {},
    "@/lib/agents/publicAgent": { publicAgentSelect: {} },
    "@/lib/flags": { ...flags, isFeatureEnabled: async (key, userId) => { flagCalls.push([key, userId]); return enabled.includes(key); } },
    "@/lib/agents/visibility": { boardAgentVisibilityWhere: () => ({}), accessibleAgentMembershipWhere: () => ({}) },
    "@/utils/controllers/notifications/visibleInboxScope": { visibleUserInboxWhere: () => ({}) },
  };
  const source = fs.readFileSync(legacy ? path.join(__dirname, "fixtures/htpr-6972/load.ts.txt") : path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  return { ...exports, queries, flagCalls };
}

function projectRelation(row, select) {
  const projected = Object.fromEntries(Object.entries(select).filter(([, value]) => value === true).map(([key]) => [key, row[key]]));
  if (select.description_) {
    projected.description_ = row.projectId === select.description_.where.task.projectId && row.description_
      ? { content: row.description_.content } : null;
  }
  return projected;
}

test("flag-off relation projections retain the compact legacy shape", () => {
  const { taskDetailInclude } = load();
  const legacy = load({ legacy: true }).taskDetailInclude(6, 15);
  for (const projection of [taskDetailInclude(6, 15), taskDetailInclude(6, 15, false)]) {
    assert.deepEqual(projection.subTasks, legacy.subTasks);
    assert.deepEqual(projection.parentTask, legacy.parentTask);
  }
});

test("flagged SSR relations carry known full and empty descriptions for cold cached opening", () => {
  const include = load().taskDetailInclude(6, 15, true);
  const client = new QueryClient();
  for (const select of [include.subTasks.select, include.parentTask.select]) {
    assert.deepEqual(select.description_, { where: { task: { projectId: 15 } }, select: { content: true } });
    assert.equal(select.status, true);
    for (const description_ of [null, { content: "" }, { content: "Child body", secretAttachment: "not selected" }]) {
      const relation = projectRelation({ id: 42, projectId: 15, uniqueIndex: 7, status: "Normal", title: "Child", description_ }, select);
      assert.deepEqual(relation.description_, description_ && { content: description_.content });
      assert.equal(findCachedTaskDetail(client, 6, 15, 7, relation)?.id, 42);
    }
  }
  client.clear();
});

test("relation body projection is source-board scoped and deleted or cross-board relations cannot open", () => {
  const { taskDetailInclude, taskWhere } = load();
  assert.deepEqual(taskWhere({ projectId: 15, uniqueIndex: 7 }, 6).project, {
    id: 15, status: { not: "Deleted" }, OR: [{ members: { some: { userId: 6 } } }, { ownerId: 6 }],
  });
  const include = taskDetailInclude(6, 15, true);
  const client = new QueryClient();
  for (const select of [include.subTasks.select, include.parentTask.select]) {
    const crossBoard = projectRelation({ id: 42, projectId: 99, uniqueIndex: 7, status: "Normal", description_: { content: "Private body" } }, select);
    assert.equal(crossBoard.description_, null);
    assert.equal(findCachedTaskDetail(client, 6, 15, 7, crossBoard), undefined);
    const deleted = projectRelation({ ...crossBoard, projectId: 15, status: "Deleted", description_: { content: "Deleted body" } }, select);
    assert.equal(findCachedTaskDetail(client, 6, 15, 7, deleted), undefined);
  }
  client.clear();
});

test("fetchTaskDetail enables cached relation projection only when both flags are enabled for the reader", async () => {
  const subtask = flags.HTPR_6972_SUBTASK_LINK_FLAG;
  const instant = flags.HTPR_6752_INSTANT_TICKET_OPEN_FLAG;
  for (const enabled of [[], [subtask], [instant], [subtask, instant]]) {
    const f = load({ enabled, task: { id: 42, projectId: 15, uniqueIndex: 7, pullRequests: [], description_: null, agent: null } });
    assert.equal((await f.fetchTaskDetail("project-15", 7, 6)).id, 42);
    assert.deepEqual(f.queries[0].where, f.taskWhere({ projectId: 15, uniqueIndex: 7 }, 6));
    assert.equal(Object.hasOwn(f.queries[0].include.subTasks.select, "description_"), enabled.length === 2);
    assert.equal(Object.hasOwn(f.queries[0].include.parentTask.select, "description_"), enabled.length === 2);
    assert.deepEqual(f.flagCalls, [[subtask, 6], ...(enabled.includes(subtask) ? [[instant, 6]] : [])]);
  }
});
