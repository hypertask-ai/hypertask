const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const { shouldRenderGlobalCommandMenu, isCommandCenterShortcut, isComposePaletteShortcut } = jiti("../src/lib/constants/commandCenterShortcut.ts");
const { default: flag, HTPR_7569_MY_TASKS_SINGLE_COMMAND_CENTER_FLAG } = jiti("../src/lib/flags/definitions/htpr-7569-my-tasks-single-command-center.ts");
const provider = "src/components/ProviderGlobal/GloablProviders.tsx";
const table = "src/components/PageComponents/Kanban/TableView/TableView.tsx";

function source(file) {
  return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function find(file, predicate) {
  const parsed = source(file);
  const matches = [];
  function visit(node) {
    if (predicate(node, parsed)) matches.push(node.getText(parsed));
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(matches.length, 1, `Expected one production expression in ${file}`);
  return matches[0];
}

function initializer(file, name) {
  const declaration = find(file, (node, parsed) => ts.isVariableDeclaration(node) && node.name.getText(parsed) === name);
  return declaration.slice(declaration.indexOf("=") + 1);
}

function evaluate(expression, bindings) {
  const js = ts.transpileModule(`const result = (${expression});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function("require", "exports", ...Object.keys(bindings), `${js}; return result;`)((id) => {
    assert.equal(id, "react/jsx-runtime");
    const jsx = (type, props) => ({ type, props });
    return { jsx, jsxs: jsx };
  }, {}, ...Object.values(bindings));
}

function commandHostExpressions(file) {
  const expressions = [];
  const parsed = source(file);
  function hasHost(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "HypertasksCommands") return true;
    return ts.forEachChild(node, hasHost);
  }
  function visit(node) {
    if (ts.isJsxExpression(node) && node.expression && ts.isBinaryExpression(node.expression) && hasHost(node.expression)) {
      expressions.push(node.expression.getText(parsed));
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(expressions.length, `Missing command host in ${file}`);
  return expressions;
}

function hosts(file, bindings) {
  const commands = [];
  function collect(element) {
    if (!element || typeof element !== "object") return;
    if (element.type === "commands") commands.push(element.props);
    for (const child of [element.props?.children].flat()) collect(child);
  }
  for (const expression of commandHostExpressions(file)) {
    collect(evaluate(expression, { HypertasksCommands: "commands", Suspense: "suspense", ...bindings }));
  }
  return commands;
}

function shellHosts(pathname, enabled, show = true, authenticatedUserId = 985) {
  const myTasksSingleCommandCenter = evaluate(initializer(provider, "myTasksSingleCommandCenter"), {
    useFlag: (key) => {
      assert.equal(key, HTPR_7569_MY_TASKS_SINGLE_COMMAND_CENTER_FLAG);
      return enabled;
    },
    HTPR_7569_MY_TASKS_SINGLE_COMMAND_CENTER_FLAG,
  });
  return hosts(provider, {
    pathname, myTasksSingleCommandCenter, shouldRenderGlobalCommandMenu,
    showCommands: { show }, authenticatedUserId, composeTaskWriterEnabled: false,
  });
}

function tableContext(selected, project = null) {
  const task = { id: 7, projectId: 15, sectionId: 3, status: "Todo" };
  return evaluate(initializer("src/components/PageComponents/Kanban/TableView/useTableRows.ts", "buildCommandContext"), {
    useCallback: (callback) => callback,
    persistedActiveItem: selected ? task.id : null,
    rows: [{ type: "task", task }],
    isTaskRow: (row) => row.type === "task",
    _currentProject: project, isApple: false, myTasksSnoozeEnabled: true, showArchivedOnBoard: false,
  })();
}

test("ticket flag is a client-safe, Everyone bugfix with a small release risk", () => {
  assert.equal(HTPR_7569_MY_TASKS_SINGLE_COMMAND_CENTER_FLAG, "htpr-7569-my-tasks-single-command-center");
  assert.equal(flag.key, HTPR_7569_MY_TASKS_SINGLE_COMMAND_CENTER_FLAG);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.ok(flag.releaseRisk.reason);
});

for (const enabled of [false, true]) {
  for (const selected of [false, true]) {
    test(`My Tasks flag ${enabled}, selected task ${selected}: actual shell/table expressions keep the table context`, () => {
      const context = tableContext(selected);
      const local = hosts(table, { showCommands: { show: true }, buildCommandContext: () => context });
      assert.equal(local.length, 1);
      assert.equal(local[0].contextOptions, context);
      assert.equal(context.context, selected ? "Task" : "Others");
      assert.deepEqual(context.task, selected ? { taskId: 7, projectId: 15, sectionId: 3 } : undefined);
      if (selected) assert.equal(context.taskOptions.isMyTasks, true);
      assert.equal(shellHosts("/my-tasks", enabled).length + local.length, enabled ? 1 : 2);
      assert.equal(shellHosts("/my-tasks", enabled, false).length, 0);
      assert.equal(hosts(table, { showCommands: { show: false }, buildCommandContext: () => context }).length, 0);
    });
  }
}

test("only My Tasks route ownership changes; omitted/false flag keeps the legacy result", () => {
  for (const pathname of ["/my-tasks", "/my-tasks/", "/my-tasks/view"]) {
    assert.equal(shouldRenderGlobalCommandMenu(pathname), true);
    assert.equal(shouldRenderGlobalCommandMenu(pathname, false), true);
    assert.equal(shouldRenderGlobalCommandMenu(pathname, true), false);
  }
  for (const pathname of [
    "/project", "/project/15", "/detail/project-15/7569", "/page/example", "/search", "/search/results",
    "/inbox", "/inbox/agent", "/all-tasks", "/calendar", "/scheduled", "/reminders", "/report/15/velocity",
    "/starred", "/pinned", "/archived", "/login", "/qa/login", "/invite/abc", "/share/abc", "/new", null, "",
  ]) {
    assert.equal(shouldRenderGlobalCommandMenu(pathname, true), false, String(pathname));
    assert.equal(shouldRenderGlobalCommandMenu(pathname, false), false, String(pathname));
    assert.equal(shellHosts(pathname, true).length, shellHosts(pathname, false).length, String(pathname));
  }
  for (const pathname of ["/settings", "/settings/profile", "/agents", "/agents/1", "/my-tasks-extra", "/unknown"]) {
    assert.equal(shouldRenderGlobalCommandMenu(pathname, true), true, pathname);
    assert.equal(shouldRenderGlobalCommandMenu(pathname, false), true, pathname);
    assert.equal(shellHosts(pathname, true).length, 1, pathname);
    assert.equal(shellHosts(pathname, true, true, null).length, 0, pathname);
  }
  assert.equal(tableContext(false, { id: 15 }).context, "Kanban");
  assert.equal(tableContext(true, { id: 15 }).context, "Task");
});

test("board table/kanban, ticket, inbox and search retain one host and their original context", () => {
  const callback = () => {};
  const context = { context: "Task", task: { taskId: 7, projectId: 15, sectionId: 3 } };
  const cases = [
    ["/project/15", table, { buildCommandContext: () => context }, context],
    ["/project/15", "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx", {
      React: { Suspense: "suspense" }, createContextOptionsForHTC: () => context,
    }, context],
    ["/detail/project-15/7569", "src/app/detail/[...slug]/TaskDetailPanels.tsx", {
      embedded: false, callback, commandContextOptions: context,
    }, context],
    ["/inbox", "src/app/inbox/Inbox.tsx", { htcCallbackHandler: callback, commandFocusProxy: {} }, undefined],
    ["/search", "src/app/search/SearchComp.tsx", { handleCommand: callback, includeArchived: true, commandFocusProxy: {} }, {
      context: "Others", searchOptions: { includeArchived: true },
    }],
  ];
  for (const enabled of [false, true]) {
    for (const [pathname, file, bindings, expectedContext] of cases) {
      const local = hosts(file, { showCommands: { show: true }, ...bindings });
      assert.equal(shellHosts(pathname, enabled).length + local.length, 1, file);
      assert.deepEqual(local[0].contextOptions, expectedContext, file);
      if (bindings.callback || bindings.htcCallbackHandler || bindings.handleCommand) {
        assert.equal(local[0].callbackHandler, callback, file);
      }
      assert.equal(hosts(file, { showCommands: { show: false }, ...bindings }).length, 0, file);
    }
  }
});

test("host selection leaves Ctrl+K, Cmd+K and compose shortcuts unchanged on every affected surface", () => {
  for (const pathname of ["/my-tasks", "/project/15", "/detail/project-15/7569", "/inbox", "/search", "/settings"]) {
    const ctrlK = { code: "KeyK", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
    const cmdK = { ...ctrlK, ctrlKey: false, metaKey: true };
    for (const enabled of [false, true]) {
      shouldRenderGlobalCommandMenu(pathname, enabled);
      assert.equal(isCommandCenterShortcut(ctrlK, false, pathname), true);
      assert.equal(isCommandCenterShortcut(cmdK, true, pathname), true);
      assert.equal(isCommandCenterShortcut(cmdK, false, pathname), false);
      assert.equal(isCommandCenterShortcut({ ...ctrlK, shiftKey: true }, false, pathname), false);
      assert.equal(isCommandCenterShortcut({ ...ctrlK, altKey: true }, false, pathname), false);
      assert.equal(isComposePaletteShortcut(ctrlK, false, pathname), true);
      assert.equal(isComposePaletteShortcut({ ...ctrlK, code: "KeyJ" }, false, pathname), true);
    }
  }
});
