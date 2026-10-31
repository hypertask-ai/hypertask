const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti").createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const flags = jiti(path.join(root, "src/lib/flags/keys.ts"));

const READER = 6;
const boards = { 15: { ownerId: 1, members: [READER] }, 99: { ownerId: 2, members: [READER] } };
const tasks = {
  1: { id: 1, uniqueIndex: 7, title: "Open task", ticketNumber: null, projectId: 15 },
  2: { id: 2, uniqueIndex: 3, title: "Private title on board 99", ticketNumber: null, projectId: 99 },
};
const relations = [{ id: 1, sourceTaskId: 1, targetTaskId: 2 }, { id: 2, sourceTaskId: 2, targetTaskId: 1 }];

function canOpen(projectWhere, projectId) {
  const board = boards[projectId];
  return projectWhere.OR.some((branch) =>
    branch.ownerId === board.ownerId ||
    (branch.members && branch.members.some.agentId === null && board.members.includes(branch.members.some.userId)));
}

function relationRows(spec, key, otherKey, taskKey) {
  return relations
    .filter((relation) => relation[key] === 1)
    .filter((relation) => !spec.where || canOpen(spec.where[taskKey].project, tasks[relation[otherKey]].projectId))
    .map((relation) => ({ ...relation, [taskKey]: tasks[relation[otherKey]] }));
}

function load() {
  const mocks = {
    "@/lib/tasks/sameBoardRelations": jiti(path.join(root, "src/lib/tasks/sameBoardRelations.ts")),
    "@prisma/client": require("@prisma/client"),
    "@vercel/functions": {},
    "@/lib/realtime/server": {},
    "@/lib/prisma": {
      __esModule: true,
      default: {
        task: {
          findFirst: async ({ include }) => ({
            ...tasks[1], pullRequests: [], description_: null, agent: null,
            relatedToTasks: relationRows(include.relatedToTasks, "targetTaskId", "sourceTaskId", "sourceTask"),
            relatedFromTasks: relationRows(include.relatedFromTasks, "sourceTaskId", "targetTaskId", "targetTask"),
          }),
        },
      },
    },
    "@/lib/mcp/tasks/resolveTask": {},
    "@/lib/cycles": { CYCLE_WINDOW_SIZE: 4 },
    "@/lib/pullRequests/taskPullRequests": {},
    "@/lib/agents/publicAgent": { publicAgentSelect: {} },
    "@/lib/flags/keys": flags,
    "@/lib/flags": { ...flags, isFeatureEnabled: async () => false },
    "@/lib/agents/visibility": { boardAgentVisibilityWhere: () => ({}), accessibleAgentMembershipWhere: () => ({}) },
    "@/utils/controllers/notifications/visibleInboxScope": { visibleUserInboxWhere: () => ({}) },
  };
  mocks["@/utils/controllers/projects/getAllIncludes"] = require("./task-route-loader.cjs").load("src/utils/controllers/projects/getAllIncludes.ts", mocks);
  const source = fs.readFileSync(path.join(root, "src/utils/controllers/taskDetail/load.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

const relatedTitles = (task) => [
  ...task.relatedToTasks.map((relation) => relation.sourceTask.title),
  ...task.relatedFromTasks.map((relation) => relation.targetTask.title),
];

test("related tasks from a board the reader can open keep showing, across boards", async () => {
  const task = await load().fetchTaskDetail("project-15", 7, READER);
  assert.deepEqual(relatedTitles(task), ["Private title on board 99", "Private title on board 99"]);
});

test("related tasks disappear once the reader loses access to their board", async () => {
  boards[99].members = [];
  try {
    const task = await load().fetchTaskDetail("project-15", 7, READER);
    assert.deepEqual(relatedTitles(task), []);
  } finally {
    boards[99].members = [READER];
  }
});
