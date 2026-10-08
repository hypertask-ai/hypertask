const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createRoot } = require("react-dom/client");
const hotToast = require("react-hot-toast");

const root = path.resolve(__dirname, "..");
const mobileContext = React.createContext(false);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const undoModule = { exports: {} };
new Function("require", "module", "exports", compile(read("src/components/undoToast/index.tsx")))(
  (key) => ({
    "@/lib/contexts/mobileContext": { MobileViewContext: mobileContext },
    "@/lib/configs/general.config": { MOBILE_TARGET: "min-h-[44px] min-w-[44px]" },
    "@/lib/constants/appShellRail": { APP_SHELL_RAIL_OFFSET: "48px" },
  }[key] ?? require(key)), undoModule, undoModule.exports,
);
const undo = undoModule.exports;

// Extract declarations with the TypeScript parser, not a copied implementation.
// External I/O is stubbed; notification rendering uses real react-hot-toast stores.
function declaration(file, name) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(source) === name) found ??= node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `${file}: ${name} exists`);
  return ts.isFunctionDeclaration(found) ? found.getText(source) : `const ${found.getText(source)};`;
}
function load(file, names, env) {
  return new Function(...Object.keys(env), compile(names.map((name) => declaration(file, name)).join("\n")) + `\nreturn {${names.join(",")}};`)(...Object.values(env));
}
async function fixture(t, single) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://example.test" });
  const previous = {};
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, MutationObserver: dom.window.MutationObserver, matchMedia: () => ({ matches: false }), IS_REACT_ACT_ENVIRONMENT: true })) {
    previous[key] = global[key]; global[key] = value;
  }
  hotToast.toast.removeAll(); hotToast.toast.removeAll(undo.SINGLE_UNDO_TOASTER_ID);
  undo.undoToastSettings.single = single;
  const app = createRoot(document.getElementById("root"));
  let defaultStore, singleStore;
  function Toasts() {
    defaultStore = hotToast.useToasterStore();
    singleStore = hotToast.useToasterStore({}, undo.SINGLE_UNDO_TOASTER_ID);
    return React.createElement(React.Fragment, null,
      React.createElement(hotToast.Toaster),
      single && React.createElement(undo.SingleUndoToaster, { mobile: false, appShellRailOn: false }));
  }
  await React.act(async () => app.render(React.createElement(Toasts)));
  t.after(async () => {
    await React.act(async () => { hotToast.toast.removeAll(); hotToast.toast.removeAll(undo.SINGLE_UNDO_TOASTER_ID); app.unmount(); });
    undo.undoToastSettings.single = false; dom.window.close(); Object.assign(global, previous);
  });
  return {
    async run(fn) { await React.act(fn); },
    counts() {
      const named = singleStore.toasts.filter((toast) => toast.visible).length;
      assert.equal(document.querySelectorAll(`[data-rht-toaster="${undo.SINGLE_UNDO_TOASTER_ID}"] [aria-label="Undo"]`).length, singleStore.toasts.length);
      return { old: defaultStore.toasts.filter((toast) => toast.visible).length, single: named };
    },
    register(data, text, handler = async (_, id) => hotToast.toast.dismiss(id)) {
      return undo.UndoToaster(text, data, handler, false);
    },
  };
}
const boardFile = "src/hooks/MultiPages/useUpdateTaskInBoards.tsx";
function boardRemoval(f, subtasks = false) {
  const task = { id: 1, projectId: 2, sectionId: 3, subTasks: subtasks ? [{ id: 4 }] : [] };
  const section = { sectionId: 3, items: [task] };
  const project = { sections: [section], filteredSections: [section], tasks: [task] };
  const env = {
    toast: hotToast.toast, undoToastSettings: undo.undoToastSettings,
    _currentProject: { id: 2 }, _currentUser: { id: 985 }, dedupe: false,
    getProjectIdxAndAllData: async () => ({ allData: { updatedProjects: [project] }, projectToUpdateIndex: 0 }),
    reAdjustFocusFromCurrContext() {}, returnSortedItems: (items) => items, mutationHandler() {},
    globalAPIHandlers: { deleteTaskAPI: async () => {}, archiveTask: async () => {} },
    deleteTodo: (text, data) => f.register(data, text),
    queryClient: { refetchQueries: async () => {} },
  };
  return load(boardFile, ["removeFromListWithStatus"], env).removeFromListWithStatus;
}

for (const single of [false, true]) {
  for (const status of ["Archive", "Deleted"]) {
    test(`${status} shared board path, flag ${single ? "on" : "off"}`, async (t) => {
      const f = await fixture(t, single);
      await f.run(async () => { assert.equal(await boardRemoval(f)(3, 2, 1, status), true); });
      assert.deepEqual(f.counts(), single ? { old: 0, single: 1 } : { old: status === "Deleted" ? 2 : 1, single: 0 });
    });
  }
  test(`delete with subtasks retains its non-undo confirmation, flag ${single ? "on" : "off"}`, async (t) => {
    const f = await fixture(t, single);
    await f.run(async () => { assert.equal(await boardRemoval(f, true)(3, 2, 1, "Deleted"), false); });
    assert.deepEqual(f.counts(), { old: 1, single: 0 });
  });
  for (const hasUndo of [true, false]) {
    test(`palette/card menu archive, flag ${single ? "on" : "off"}, undo ${hasUndo}`, async (t) => {
      const f = await fixture(t, single);
      const remove = boardRemoval(f, !hasUndo);
      const { archiveTaskHandler } = load("src/hooks/MultiPages/HTC/useHTCTaskAndComments.ts", ["archiveTaskHandler"], {
        toast: hotToast.toast, undoToastSettings: undo.undoToastSettings,
        inViewObject: { sectionId: 3, taskId: 1 }, _currentProject: { id: 2 }, callbackHandler: undefined,
        removeFromListWithStatus: remove, navigate() {}, boardCloseHandler() {},
      });
      await f.run(archiveTaskHandler);
      assert.deepEqual(f.counts(), single && hasUndo ? { old: 0, single: 1 } : { old: hasUndo ? 2 : 1, single: 0 });
    });
    test(`detail archive navigation, flag ${single ? "on" : "off"}, undo ${hasUndo}`, async (t) => {
      const f = await fixture(t, single);
      const { markAsDone } = load("src/hooks/Task Detail/useArchiveAndNavigate.ts", ["markAsDone"], {
        toast: hotToast.toast, undoToastSettings: undo.undoToastSettings,
        currentTask: { id: 1, projectId: 2, sectionId: 3, status: "Normal", uniqueIndex: 1 }, _mbl: false,
        removeFromListWithStatus: boardRemoval(f, !hasUndo), setCurrentTask() {},
        navigateToNextTask() {}, shouldApplyLocalArchivedStatus: () => false, navigate() {},
      });
      await f.run(markAsDone);
      assert.deepEqual(f.counts(), single && hasUndo ? { old: 0, single: 1 } : { old: hasUndo ? 3 : 2, single: 0 });
    });
  }
  test(`bulk archive suppresses only duplicate success, flag ${single ? "on" : "off"}`, async (t) => {
    const f = await fixture(t, single);
    const env = {
      useCallback: (fn) => fn, isProcessing: false, selectedTasks: [{ id: 1 }, { id: 2 }],
      toast: hotToast.toast, undoToastSettings: undo.undoToastSettings,
      setIsProcessing() {}, setSelectedIds() {}, setFailedIds() {},
    };
    const { runTaskOperation } = load("src/lib/contexts/Kanban/BulkSelectionContext.tsx", ["runTaskOperation"], env);
    await f.run(async () => runTaskOperation(async (task) => { f.register(task, "Undo task archive"); return true; }, "2 tasks archived"));
    assert.deepEqual(f.counts(), single ? { old: 0, single: 1 } : { old: 3, single: 0 });
  });
  test(`bulk non-undo actions and parent-only archives keep success, flag ${single ? "on" : "off"}`, async (t) => {
    const f = await fixture(t, single);
    const { runTaskOperation } = load("src/lib/contexts/Kanban/BulkSelectionContext.tsx", ["runTaskOperation"], {
      useCallback: (fn) => fn, isProcessing: false, selectedTasks: [{ id: 1 }],
      toast: hotToast.toast, undoToastSettings: undo.undoToastSettings,
      setIsProcessing() {}, setSelectedIds() {}, setFailedIds() {},
    });
    await f.run(async () => runTaskOperation(async () => {}, "Task moved"));
    assert.deepEqual(f.counts(), { old: 1, single: 0 });
  });
  for (const file of ["src/app/inbox/Inbox.tsx", "src/app/detail/[...slug]/useTaskDetailNavigationActions.tsx"]) {
    test(`post-undo confirmation ${file}, flag ${single ? "on" : "off"}`, async (t) => {
      const f = await fixture(t, single);
      const { undoHandler } = load(file, ["undoHandler"], {
        toast: hotToast.toast, undoToastSettings: undo.undoToastSettings,
        undoAction: async () => {}, queryClient: { refetchQueries() {} }, navigate() {}, navigateToPreviousTask() {},
        restoreInboxAfterUndo: async () => {}, inboxDataQueryKey: () => [], currentUser: { id: 985 },
        taskDetailConfig: { queryKeys: { inbox: "inbox" }, toastMessages: { undoNotificationArchive: "Undo notification archive" } },
      });
      await f.run(async () => { const id = f.register({}, "Undo notification archive"); await undoHandler({}, id); });
      assert.deepEqual(f.counts(), { old: single ? 0 : 1, single: 0 });
    });
  }
  test(`plain Z uses registered undo and dismisses the named card, flag ${single ? "on" : "off"}`, async (t) => {
    const f = await fixture(t, single);
    const source = ts.createSourceFile("keyboard.ts", read("src/hooks/Homepage/useHandleKeyDownOperations.ts"), ts.ScriptTarget.Latest, true);
    let branch;
    function visit(node) {
      if (ts.isIfStatement(node) && /e\.keyCode === 90\s*&&\s*undoData\.length/.test(node.expression.getText(source))) branch = node.getText(source);
      ts.forEachChild(node, visit);
    }
    visit(source); assert.ok(branch);
    let registeredCalls = 0; let legacyCalls = 0;
    await f.run(async () => {
      const id = f.register({ id: 1 }, "Undo task archive");
      const handler = new Function("e", "undoData", "undoLatest", "undoHandler", "undoToastSettings", compile(branch));
      handler({ keyCode: 90 }, [{ id: 1, toastId: id }], async () => { registeredCalls++; hotToast.toast.dismiss(id); }, async () => { legacyCalls++; hotToast.toast("Undo remove"); }, undo.undoToastSettings);
      await Promise.resolve();
    });
    assert.equal(registeredCalls, single ? 1 : 0);
    assert.equal(legacyCalls, single ? 0 : 1);
    assert.deepEqual(f.counts(), single ? { old: 0, single: 0 } : { old: 2, single: 0 });
  });
}

for (const single of [false, true]) {
  test(`bulk partial failure keeps its error beside undo, flag ${single ? "on" : "off"}`, async (t) => {
    const f = await fixture(t, single);
    const { runTaskOperation } = load("src/lib/contexts/Kanban/BulkSelectionContext.tsx", ["runTaskOperation"], {
      useCallback: (fn) => fn, isProcessing: false, selectedTasks: [{ id: 1 }, { id: 2 }],
      toast: hotToast.toast, undoToastSettings: undo.undoToastSettings,
      setIsProcessing() {}, setSelectedIds() {}, setFailedIds() {},
    });
    await f.run(async () => runTaskOperation(async (task) => {
      if (task.id === 2) throw new Error("Test mutation failed");
      f.register(task, "Undo task archive"); return true;
    }, "2 tasks archived"));
    assert.deepEqual(f.counts(), single ? { old: 1, single: 1 } : { old: 2, single: 0 });
    assert.ok(!document.body.textContent.includes("2 tasks archived"));
  });
}

test("bulk archive forwards the shared undo-registration result", () => {
  const file = "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx";
  const { archiveTaskForBulk } = load(file, ["archiveTaskForBulk"], {
    useCallback: (fn) => fn, _currentProject: { id: 2 }, getBulkSourceSectionId: () => 3,
    removeFromListWithStatus: async () => true,
  });
  return archiveTaskForBulk({ id: 1 }).then((registered) => assert.equal(registered, true));
});

test("every direct Undo confirmation is flag-off-only; custom undo rendering has one owner", () => {
  function inspect(file, text) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const calls = [];
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "toast" && /undo/i.test(node.arguments[0]?.getText(source) ?? "")) {
        const message = node.arguments[0].getText(source);
        if (!/Nothing to undo|Undo failed/.test(message)) {
          let guarded = false;
          for (let parent = node.parent; parent; parent = parent.parent) {
            if (ts.isIfStatement(parent) && parent.expression.getText(source) === "!undoToastSettings.single" && parent.thenStatement.pos <= node.pos && parent.thenStatement.end >= node.end) guarded = true;
          }
          calls.push({ file, guarded });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    return calls;
  }
  // Positive control prevents an accidentally empty scan from proving absence.
  assert.deepEqual(inspect("control.ts", 'toast("Undo task archive")'), [{ file: "control.ts", guarded: false }]);
  const calls = [], customOwners = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(file)) {
        const text = read(file);
        calls.push(...inspect(file, text));
        if (/\btoast\.custom\s*\(/.test(text)) customOwners.push(file);
      }
    }
  }
  walk("src");
  assert.deepEqual(calls.map(({ file }) => file).sort(), [
    "src/app/detail/[...slug]/useTaskDetailNavigationActions.tsx",
    "src/app/inbox/Inbox.tsx",
    "src/hooks/Homepage/useHandleKeyDownOperations.ts",
  ]);
  assert.ok(calls.every(({ guarded }) => guarded));
  assert.deepEqual(customOwners, ["src/components/undoToast/index.tsx"]);
});
