const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { QueryClient } = require("@tanstack/react-query");
const { refreshTaskDetailReadAfterWrite } = require("jiti")(__filename, { alias: { "@": path.resolve(__dirname, "../src") }, interopDefault: true })(path.resolve(__dirname, "../src/lib/taskDetailReads.ts"));
const test = require("node:test");
const ts = require("typescript");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createRoot } = require("react-dom/client");
const hotToast = require("react-hot-toast");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7185-delete-task-undo";
const mobileContext = React.createContext(false);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
function load(file, mocks) {
  const mod = { exports: {} };
  new Function("require", "module", "exports", compile(read(file)))(
    (key) => {
      if (Object.hasOwn(mocks, key)) return { __esModule: true, ...mocks[key] };
      if (key.startsWith("@/lib/flags/")) return require("./helpers/flag-files.cjs").load(`src/${key.slice(2)}.ts`);
      if (key.startsWith("@/")) throw new Error(`Unstubbed dependency: ${key}`);
      return require(key);
    }, mod, mod.exports,
  );
  return mod.exports;
}
function boardActions(env) {
  const file = "src/hooks/MultiPages/useUpdateTaskInBoards.tsx";
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ["undoHandler", "deleteTodo", "removeFromListWithStatus"];
  const found = new Map();
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && names.includes(node.name?.getText(source))) {
      found.set(node.name.getText(source), ts.isFunctionDeclaration(node) ? node.getText(source) : `const ${node.getText(source)};`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(found.size, names.length);
  return new Function(...Object.keys(env), compile(names.map(name => found.get(name)).join("\n")) + `\nreturn {${names.join(",")}};`)(...Object.values(env));
}
const undoToast = load("src/components/undoToast/index.tsx", {
  "@/lib/contexts/mobileContext": { MobileViewContext: mobileContext },
  "@/lib/configs/general.config": { MOBILE_TARGET: "min-h-[44px] min-w-[44px]" },
  "@/hooks/useFlag": { useFlag: () => false },
  "@/lib/flags/definitions/htpr-8097-mobile-undo-toast": { HTPR_8097_MOBILE_UNDO_TOAST_FLAG: "htpr-8097-mobile-undo-toast" },
  "@/lib/flags/keys": { HTPR_7657_ONE_TOAST_FLAG: "htpr-7657-one-toast" },
  "@/lib/toastIdsToDismiss": { toastIdsToDismiss: () => [] },
  "@/lib/constants/appShellRail": { APP_SHELL_RAIL_OFFSET: "48px" },
});
const undoWindow = load("src/hooks/General/undoWindow.ts", {});
const taskConfig = load("src/lib/configs/taskDetail.config.ts", {
  "@/utils/htmlEscape": load("src/utils/htmlEscape.ts", {}),
}).default;

async function fixture(t, flagOn, failDelete = false) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-42/7" });
  const previous = {};
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, KeyboardEvent: dom.window.KeyboardEvent, IS_REACT_ACT_ENVIRONMENT: true, matchMedia: () => ({ matches: false }) })) {
    previous[key] = global[key]; global[key] = value;
  }
  hotToast.toast.removeAll(); hotToast.toast.removeAll(undoToast.SINGLE_UNDO_TOASTER_ID);
  const row = { id: 101, projectId: 42, sectionId: 9, uniqueIndex: 7, status: "Normal", subTasks: [] };
  const section = { sectionId: 9, items: [{ ...row }] };
  const project = { id: 42, tasks: section.items, sections: [section], filteredSections: [section] };
  const navigations = [];
  const navigate = (page, payload) => navigations.push({ page, payload });
  const refreshBoard = () => {
    section.items = row.status === "Normal" ? [{ ...row }] : [];
    project.tasks = section.items;
    project.sections = [section]; project.filteredSections = [section];
  };
  const queryClient = {
    refetchQueries: async () => refreshBoard(),
    cancelQueries: async () => {},
    fetchQuery: async ({ queryFn }) => queryFn(),
  };
  const globalAPIHandlers = {
    deleteTaskAPI: async (id) => { assert.equal(id, 101); if (failDelete) throw new Error("Deletion refused"); row.status = "Deleted"; return { ...row }; },
    archiveTask: async (id, status) => { assert.equal(id, 101); row.status = status; },
  };
  const actions = load("src/utils/undoActions/helperFuncs.ts", {
    "@/lib/constants/APIRouteConstants": {},
    "@/lib/realtime/client": { realtimeEchoHeaders: () => ({}) },
    "../api/global": { default: globalAPIHandlers },
  });
  const { UndoProvider, useUndoContext } = load("src/hooks/General/useUndo.tsx", {
    "@/utils/undoActions": { default: actions },
    "@/components/undoToast": undoToast,
    "./undoWindow": undoWindow,
    "@/lib/contexts/mobileContext": { MobileViewContext: mobileContext },
  });
  const { reconcileActiveBoardTasks } = load("src/lib/boardSync/reconcileActiveBoardQuery.ts", {
    "@/utils/api/Homepage": {
      BOARD_TASKS_KEY: (projectId, userId) => ["boardTasks", userId, projectId],
      fetchBoardTasks: async () => ({ tasks: row.status === "Normal" ? [{ ...row }] : [] }),
      patchProjectIntoCache: (_, projectId, payload, userId) => {
        assert.equal(projectId, 42); assert.equal(userId, 985);
        section.items = payload.tasks; project.tasks = payload.tasks;
        project.sections = [section]; project.filteredSections = [section];
        return true;
      },
    },
  });
  let undo, detail, palette, modalOpen = true, modalClosures = 0;
  const context = {
    currentTask: { ...row }, currentUser: { id: 985 }, queryClient,
    toggleDeleteModal: () => { modalOpen = !modalOpen; },
    setCurrentTask: (update) => { context.currentTask = update(context.currentTask); },
    onGoback: () => navigate("Back"), navigate,
  };
  const useFlag = (key) => key === flagKey && flagOn;
  let shared;
  const detailModule = load("src/app/detail/[...slug]/useTaskDetailModalActions.tsx", {
    "@/utils/api/global": { default: globalAPIHandlers },
    "@/lib/configs/taskDetail.config": { default: taskConfig },
    "@/hooks/useFlag": { useFlag },
    "@/lib/taskDetailReads": { refreshTaskDetailReadAfterWrite: () => {} },
    "@/hooks/MultiPages/useUpdateTaskInBoards": { default: () => shared },
    "@/components/undoToast": undoToast,
  });
  const paletteModule = load("src/hooks/MultiPages/HTC/useHTCTaskAndComments.ts", {
    "@/hooks/Task Detail/useStarAndPin": { useStarAndPin: () => ({}) },
    "@/hooks/General/useCopyURL": { default: () => ({}) },
    "next/navigation": { usePathname: () => "/detail/project-42/7" },
    "../useUpdateTaskInBoards": { default: () => shared },
    "@/components/undoToast": undoToast,
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "../Route/useHypertasksNavigate": { default: () => ({ navigate }) },
    "@/lib/constants/APIRouteConstants": {},
    "./useCreateTask": { default: () => ({}) },
    "@/hooks/General/useFollowerKanban": { default: () => ({}) },
    "../Tasks": { useRemoveParentTask: () => ({}) },
    "@/hooks/General/useProjectQuery": { useProjectQuery: () => ({}) },
    "@/hooks/useFlag": { useFlag },
  });
  const keymap = load("src/app/detail/[...slug]/taskDetailNavigationKeymap.ts", {
    "@/lib/configs/taskDetail.config": { default: taskConfig },
    "@/lib/keyboard/archiveShortcutGuard": {},
    "@/lib/taskDetailArchiveNavigation": {},
    "@/lib/notifications/archiveShortcutNudge": {},
    "@/models/enums": load("src/models/enums.ts", {}),
    "@/lib/constants/keyboard-handler": { KeyCodes: { THREE: 51 } },
  }).taskDetailNavigationKeymap;
  function Harness() {
    undo = useUndoContext();
    shared = boardActions({
      ...undo, toast: hotToast.toast,
      globalAPIHandlers, queryClient: Object.assign(new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }), queryClient), refreshTaskDetailReadAfterWrite,
      _currentProject: { id: 42 }, _currentUser: { id: 985 }, router: { replace: url => navigate("Replace", url) },
      reconcileActiveBoardTasks,
      getProjectIdxAndAllData: async () => ({ allData: { updatedProjects: [project] }, projectToUpdateIndex: 0 }),
      returnSortedItems: items => items, reAdjustFocusFromCurrContext: () => {},
      mutationHandler: (_, sections, __, tasks) => { project.sections = sections; project.filteredSections = sections; project.tasks = tasks; },
    });
    detail = detailModule.useTaskDetailModalActions(() => context);
    palette = paletteModule.default({
      inViewObject: { taskId: 101, sectionId: 9, taskProjectId: 42 }, _currentProject: { id: 42 }, currentUser: { id: 985 },
      callbackHandler: () => {}, boardCloseHandler: () => { modalClosures++; },
    });
    return React.createElement(React.Fragment, null, React.createElement(hotToast.Toaster), React.createElement(undoToast.SingleUndoToaster, { mobile: false, appShellRailOn: false }));
  }
  const app = createRoot(document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => { hotToast.toast.removeAll(); hotToast.toast.removeAll(undoToast.SINGLE_UNDO_TOASTER_ID); app.unmount(); });
    dom.window.close(); Object.assign(global, previous);
  });
  await React.act(async () => app.render(React.createElement(UndoProvider, null, React.createElement(Harness))));
  return {
    row, project, navigations, context, undo: () => undo,
    async delete(entry, confirmed = true) {
      await React.act(async () => {
        if (entry === "palette") await palette.confirmDelete(confirmed);
        else {
          modalOpen = false;
          const command = keymap({ ...context, toggleDeleteModal: context.toggleDeleteModal }, { keyCode: 51, shiftKey: true }, false).find(item => item.action === "deleteTask");
          assert.equal(command.matches(), true); command.run(); assert.equal(modalOpen, true);
          await detail.deleteTask(confirmed);
        }
      });
    },
    async restore(trigger) {
      await React.act(async () => {
        if (trigger === "click") document.querySelector('button[aria-label="Undo"]').click();
        else document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
        await new Promise(resolve => setImmediate(resolve));
      });
    },
    modalClosures: () => modalClosures,
  };
}

test("the discovered bugfix is enabled for ordinary customers by default with a release risk", () => {
  const flags = load("src/lib/flags.ts", { "@/lib/prisma": { default: {} } });
  assert.equal(flags.featureFlagModeEnabled(flags.defaultFeatureFlagMode(flagKey), false, false), true);
  assert.equal(flags.featureFlagModeEnabled("OFF", false, false), false);
  const definition = require("./helpers/flag-files.cjs").definitions().find(item => item.key === flagKey);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.match(definition.releaseRisk.reason, /restore/);
});

for (const entry of ["palette", "hash"]) {
  for (const trigger of ["click", "shortcut"]) {
    test(`${entry} delete offers Undo and ${trigger} restores its original column`, async t => {
      const f = await fixture(t, true);
      await f.delete(entry);
      assert.equal(f.row.status, "Deleted");
      assert.deepEqual(f.project.sections.flatMap(section => section.items), []);
      assert.match(document.body.textContent, /Undo task delete/);
      assert.equal(f.undo().undoData.length, 1);
      assert.deepEqual(f.navigations, [{ page: "Replace", payload: "/project?id=42" }], "deep-link deletion must not unload the global undo provider via history Back");
      await f.restore(trigger);
      assert.equal(f.row.status, "Normal");
      assert.deepEqual(f.project.sections.flatMap(section => section.items.map(task => [task.id, task.sectionId, task.status])), [[101, 9, "Normal"]]);
      assert.equal(f.undo().undoData.length, 0);
      await f.restore("shortcut");
      assert.equal(f.row.status, "Normal");
      assert.match(document.body.textContent, /Nothing to undo/);
    });
  }
  test(`${entry} flag off keeps the existing delete behavior`, async t => {
    const f = await fixture(t, false);
    await f.delete(entry);
    assert.equal(f.row.status, "Deleted");
    assert.deepEqual(f.navigations, [{ page: "Back", payload: undefined }]);
    assert.equal(f.undo().undoData.length, entry === "palette" ? 1 : 0);
    if (entry === "palette") assert.match(document.body.textContent, /Undo task delete/);
    else assert.match(document.body.textContent, /Task deleted/);
  });
  test(`${entry} refusal or cancellation never registers a deletion undo`, async t => {
    const f = await fixture(t, true, true);
    await f.delete(entry, false);
    assert.equal(f.row.status, "Normal");
    assert.equal(f.undo().undoData.length, 0);
    if (entry === "palette") await assert.rejects(() => f.delete(entry), /Deletion refused/);
    else await f.delete(entry);
    assert.equal(f.row.status, "Normal");
    assert.equal(f.undo().undoData.length, 0);
    assert.deepEqual(f.project.sections.flatMap(section => section.items.map(task => task.id)), [101]);
  });
}
