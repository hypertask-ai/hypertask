const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { createJiti } = require("jiti");
const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const key = "htpr-6752-instant-ticket-open";
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

for (const enabled of [false, true]) {
  test(`server board and My Tasks projections include cached bodies only with the flag ${enabled ? "on" : "off"}`, async () => {
    const flagCalls = [];
    const flagMock = { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: key, isFeatureEnabled: async (flag, userId) => {
      flagCalls.push([flag, userId]);
      return enabled;
    } };
    let boardArgs;
    const board = load("src/utils/controllers/projects/getBoardTasks.ts", {
      "@/lib/flags": flagMock,
      "@/lib/prisma": { __esModule: true, default: {
        project: { findFirst: async () => ({ id: 15 }) },
        task: { findMany: async (args) => { boardArgs = args; return []; } },
      } },
      "./getAllIncludes": includes,
      "@/utils/controllers/tasks/attachOpenBlockingTasks": { attachOpenBlockingTasks: async (tasks) => tasks },
      "@/utils/controllers/tasks/attachWaitingOnUsers": { attachWaitingOnUsers: async (tasks) => tasks },
    }).default;
    assert.equal((await board(15, 985, 985)).status, 200);
    assert.equal("description_" in boardArgs.include, enabled);
    if (enabled) assert.deepEqual(boardArgs.include.description_, { select: { content: true } });
    let myTasksArgs;
    const myTasks = load("src/utils/controllers/tasks/myTasks.ts", {
      "@/lib/flags": flagMock,
      "@/lib/prisma": { __esModule: true, default: { task: { findMany: async (args) => { myTasksArgs = args; return []; } } } },
      "../projects/getAllMinimal": { __esModule: true, default: async () => ({ json: [{ id: 15 }] }) },
    }).default;
    await myTasks(985, false, undefined, { throwOnError: true });
    assert.equal("description_" in myTasksArgs.include, enabled);
    if (enabled) assert.deepEqual(myTasksArgs.include.description_, { select: { content: true } });
    assert.deepEqual(flagCalls, [[key, 985], [key, 985]], "the signed-in account determines the rollout on the server");
  });
}

test("Inbox description projection is opt-in and retains the existing visible-account filter", async () => {
  const { getInboxNotifications, inboxTaskSelect } = load("src/utils/controllers/notifications/getAll.ts", {
    "@/lib/flags": {},
    "@/lib/prisma": { __esModule: true, default: {} },
  });
  assert.equal("description_" in inboxTaskSelect(985), false);
  for (const enabled of [false, true]) {
    let args;
    await getInboxNotifications(985, {
      $queryRaw: async () => [{ id: 1 }],
      notification: { findMany: async (value) => { args = value; return []; } },
    }, enabled);
    assert.equal("description_" in args.include.task.select, enabled);
    assert.equal(args.where.AND[1].userId, 985);
    if (enabled) assert.deepEqual(args.include.task.select.description_, { select: { content: true } });
  }
  const source = fs.readFileSync(path.join(root, "src/utils/controllers/notifications/getAll.ts"), "utf8");
  assert.match(source, /includeCachedDescription = await isFeatureEnabled\(HTPR_6752_INSTANT_TICKET_OPEN_FLAG, parsedUserId\)/);
  assert.match(source, /getInboxNotifications\(parsedUserId, prisma, includeCachedDescription\)/);
});

test("bound board and table handlers opt into cached data without changing production navigation or selection", async () => {
  const task = { id: 42, projectId: 15, uniqueIndex: 43 };
  for (const relative of [
    "src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx",
    "src/components/PageComponents/Kanban/TableView/useTableActions.ts",
  ]) {
    const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const statements = [];
    function visit(node) {
      if (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) =>
        ["openTaskWithCachedData", "openTask"].includes(item.name.getText(source)))) statements.push(node.getText(source));
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.equal(statements.length, 2);
    const js = ts.transpileModule(`${statements.join("\n")}\nreturn openTask;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    for (const instantTicketOpen of [false, true]) {
      const navigations = [];
      const selected = [];
      const playlist = [];
      const openTask = new Function("instantTicketOpen", "useCallback", "navigateToTask", "setTasksPlayList", "tasksPlayList", "setSelectedIndex", "updateActiveItemAndItemInView", "rows", "isTaskRow", js)(
        instantTicketOpen, (callback) => callback, (...args) => navigations.push(args), (value) => playlist.push(value), [{ projectId: 15, uniqueIndex: 43 }], (index) => selected.push(index), () => {}, [{ task }], () => true,
      );
      await openTask(task, 2);
      assert.deepEqual(navigations, [[15, 43, "push", undefined, instantTicketOpen ? task : undefined]]);
      assert.equal(playlist.length, 1);
      if (relative.includes("TableView")) assert.deepEqual(selected, [2]);
    }
  }
});
