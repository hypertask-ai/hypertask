const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { createJiti } = require("jiti");
const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const includes = jiti(path.join(root, "src/utils/controllers/projects/getAllIncludes.ts"));

function load(relative, mocks) {
  const exports = {};
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", js)((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) return jiti(path.join(root, "src", name.slice(2)));
    return require(name);
  }, exports);
  return exports;
}

test("server board and My Tasks always include cached bodies after their authorized first read", async () => {
  let firstRead = Promise.withResolvers();
  let boardArgs;
  const board = load("src/utils/controllers/projects/getBoardTasks.ts", {
    "@/lib/flags": { isFeatureEnabled: () => assert.fail("board data must not read a feature flag") },
    "@/utils/controllers/tasks/attachAgentStatus": { attachAgentStatus: async (tasks) => tasks },
    "@/lib/prisma": { __esModule: true, default: {
      project: { findFirst: () => firstRead.promise },
      task: { findMany: async (args) => { boardArgs = args; return []; } },
    } },
    "./getAllIncludes": includes,
    "@/utils/controllers/tasks/attachOpenBlockingTasks": { attachOpenBlockingTasks: async (tasks) => tasks },
    "@/utils/controllers/tasks/attachWaitingOnUsers": { attachWaitingOnUsers: async (tasks) => tasks },
  }).default;
  const boardResult = board(15, 985, 985);
  assert.equal(boardArgs, undefined, "board authorization must finish before reading tasks");
  firstRead.resolve({ id: 15 });
  assert.equal((await boardResult).status, 200);
  assert.deepEqual(boardArgs.include.description_, { select: { content: true } });

  firstRead = Promise.withResolvers();
  let myTasksArgs;
  const myTasks = load("src/utils/controllers/tasks/myTasks.ts", {
    "@/lib/flags": { isFeatureEnabled: () => assert.fail("My Tasks must not read a feature flag") },
    "@/lib/prisma": { __esModule: true, default: { task: { findMany: async (args) => { myTasksArgs = args; return []; } } } },
    "../projects/getAllMinimal": { __esModule: true, default: () => firstRead.promise },
  }).default;
  const myTasksResult = myTasks(985, false, undefined, { throwOnError: true });
  assert.equal(myTasksArgs, undefined, "authorized projects must finish before reading tasks");
  firstRead.resolve({ json: [{ id: 15 }] });
  await myTasksResult;
  assert.deepEqual(myTasksArgs.omit, { description: true, descriptionJson: true }, "YPER4-388: My Tasks must not load every task description");
  assert.deepEqual(myTasksArgs.include.description_, { select: { content: true } });
});

test("Inbox bodies are included after ID selection while preserving the visible-account filter", async () => {
  const selectedRead = Promise.withResolvers();
  const { getInboxNotifications, inboxTaskSelect } = load("src/utils/controllers/notifications/getAll.ts", {
    "@/lib/flags": { isFeatureEnabled: () => assert.fail("Inbox must not read a feature flag") },
    "@/lib/prisma": { __esModule: true, default: {} },
  });
  assert.equal("description_" in inboxTaskSelect(985), false, "explicit compact projections remain available");
  let args;
  const result = getInboxNotifications(985, {
    $queryRaw: () => selectedRead.promise,
    notification: { findMany: async (value) => { args = value; return []; } },
  });
  assert.equal(args, undefined, "ID selection must finish before reading task bodies");
  selectedRead.resolve([{ id: 1 }]);
  await result;
  assert.equal(args.where.AND[1].userId, 985);
  assert.deepEqual(args.include.task.select.description_, { select: { content: true } });
});

test("board and table handlers always use cached data without changing production navigation or selection", async () => {
  const task = { id: 42, projectId: 15, uniqueIndex: 43 };
  for (const relative of [
    "src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx",
    "src/components/PageComponents/Kanban/TableView/useTableActions.ts",
  ]) {
    const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const statements = [];
    function visit(node) {
      if (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) =>
        item.name.getText(source) === "openTask")) statements.push(node.getText(source));
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.equal(statements.length, 1);
    const js = ts.transpileModule(`${statements.join("\n")}\nreturn openTask;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    {
      const navigations = [];
      const selected = [];
      const playlist = [];
      const openTask = new Function("useCallback", "navigateToTask", "setTasksPlayList", "tasksPlayList", "setSelectedIndex", "updateActiveItemAndItemInView", "rows", "isTaskRow", js)(
        (callback) => callback, (...args) => navigations.push(args), (value) => playlist.push(value), [{ projectId: 15, uniqueIndex: 43 }], (index) => selected.push(index), () => {}, [{ task }], () => true,
      );
      await openTask(task, 2);
      assert.deepEqual(navigations, [[15, 43, "push", undefined, task]]);
      assert.equal(playlist.length, 1);
      if (relative.includes("TableView")) assert.deepEqual(selected, [2]);
    }
  }
});
