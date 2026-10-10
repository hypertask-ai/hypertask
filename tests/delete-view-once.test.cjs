const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const flag = "htpr-6985-delete-view-once";

function component(file, mocks, source = fs.readFileSync(path.join(root, file), "utf8")) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)((specifier) => {
    if (!Object.hasOwn(mocks, specifier)) return require(specifier);
    const mock = mocks[specifier];
    return Object.hasOwn(mock, "default") ? { __esModule: true, ...mock } : mock;
  }, mod, mod.exports);
  return mod.exports.default;
}

async function clickDelete(enabled, status = 200, repeated = false, baseline = false) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://example.test/project?id=15" });
  const globals = new Map();
  let reactRoot;
  const calls = [];
  const errors = [];
  let settle;
  const pending = new Promise((resolve, reject) => { settle = status === 200 ? resolve : () => reject({ response: { status } }); });
  const view = { id: "saved", title: "Saved view" };
  const views = [view];
  const updatedProjectView = { id: "pv", projectId: 15, allViews: [], user_project_views: [] };
  const project = { id: 15, ownerId: 6, project_view: { id: "pv", allViews: [view], default_view_id: "default", user_project_views: [] } };
  const atoms = Object.fromEntries(["appShellRailAtom", "currentProjectAtom", "currentUserAtom", "hiddenViewTabIdsAtom", "showEmptyViewTabsAtom", "activeBuiltinViewsAtom", "boardLayoutAtom", "boardLayoutPreferenceAtom"].map(key => [key, key]));
  const values = { currentProjectAtom: project, currentUserAtom: { id: 6 }, hiddenViewTabIdsAtom: {}, activeBuiltinViewsAtom: {}, boardLayoutAtom: "kanban", boardLayoutPreferenceAtom: "kanban" };
  const queryClient = { refetchQueries: async () => {}, invalidateQueries: async () => {} };
  try {
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, getComputedStyle: dom.window.getComputedStyle, React, IS_REACT_ACT_ENVIRONMENT: true })) {
      globals.set(key, Object.getOwnPropertyDescriptor(global, key));
      Object.defineProperty(global, key, { configurable: true, writable: true, value });
    }
    const { Modal, ModalBody, ModalFooter, ModalHeader } = require("reactstrap");
    const mocks = {
      "@/store": atoms,
      "@/lib/state": { useRecoilState: atom => React.useState(values[atom]), useRecoilValue: atom => values[atom], useSetRecoilState: () => () => {} },
      "@/hooks/useFlag": { useFlag: key => key === flag && enabled },
      "@/lib/flags/keys": { HTPR_6985_DELETE_VIEW_ONCE_FLAG: flag },
      "@tanstack/react-query": { useQueryClient: () => queryClient },
      "@/lib/boardSync/reconcileActiveBoardQuery": { reconcileActiveBoardQuery: async (client) => { await client.invalidateQueries(); await client.refetchQueries({ queryKey: ["projectsAll"] }); } },
      "next/navigation": { useRouter: () => ({ refresh() {}, replace() {} }) },
      "@/components/Common/CommonModalComponents": {
        ModalContainerCustom: ({ children, show, ...props }) => React.createElement(Modal, props, children),
        ModalInput: props => React.createElement("input", props),
      },
      "reactstrap": { ModalBody, ModalFooter, ModalHeader },
      "@/hooks/Homepage/Views/useRenderedViews": { default: () => ({ views, orderedViews: views, renderedViews: views, viewTaskCounts: new Map() }) },
      "@/hooks/Homepage/Views/useViewOrderActions": { default: () => ({}) },
      "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
      "@/hooks/MultiPages/useGetAllProjectLabels": { useGetAllProjectLabels: () => ({ data: [], isFetched: true, isError: false }) },
      "@/lib/smartSplits": { getSmartSplitLabel: () => null },
      "./SmartSplitModal": { default: () => null },
      "@/utils/helperFunctions/Views/ViewOrderHelperFunctions": { asViewOrder: () => undefined },
      "@/lib/constants/builtinViews": { BUILTIN_VIEWS: [], isBuiltinView: () => false, viewTabPreferenceKey: (id, viewId) => `${id}:${viewId}` },
      "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
      "@/utils/helperFunctions/Views/ProjectViewState": load("src/utils/helperFunctions/Views/ProjectViewState.ts", {}),
      "@/hooks/MultiPages/useUpdateTaskInBoards": { default: () => ({ getProjectIdxAndAllData: () => ({ allData: null, projectToUpdateIndex: 0 }) }) },
      "@/lib/constants/APIRouteConstants": { deleteRenameViewAPIRoute: "/api/projects/views/delete-rename-view" },
      "@/models/Views/model": {},
      "@/utils/helperFunctions/helperFunctions": { deepCopy: value => value },
      "nookies": { destroy() {}, set() {} },
      "react-hot-toast": { default: Object.assign(() => {}, { success() {}, error: message => errors.push(message) }) },
      "axios": { default: { delete: url => { calls.push(url); return pending; }, isAxiosError: error => !!error.response } },
      "@hello-pangea/dnd": {
        DragDropContext: ({ children }) => children,
        Droppable: ({ children }) => children({ droppableProps: {}, innerRef() {}, placeholder: null }),
        Draggable: ({ children }) => children({ draggableProps: {}, dragHandleProps: {}, innerRef() {} }),
      },
    };
    mocks["@/hooks/Homepage/Views/useKanbanViews"] = { default: component("src/hooks/Homepage/Views/useKanbanViews.ts", mocks) };
    mocks["@/components/Modals/Common Modals/ConfirmDialog"] = { default: component("src/components/Modals/Common Modals/ConfirmDialog.tsx", mocks) };
    const file = "src/components/Modals/ViewModals/ManageViewsModals.tsx";
    let source = fs.readFileSync(path.join(root, file), "utf8");
    if (baseline) {
      const guard = "if (deleteViewOnce && deleteInFlightRef.current) return false";
      assert.ok(source.includes(guard), "the negative control removes the synchronous guard");
      source = source.replace(guard, "");
    }
    const ManageViews = component(file, mocks, source);
    reactRoot = require("react-dom/client").createRoot(document.getElementById("root"));
    await React.act(async () => reactRoot.render(React.createElement(ManageViews, { toggle() {} })));
    await React.act(async () => document.querySelector('[aria-label="Settings for Saved view"]').click());
    await React.act(async () => [...document.querySelectorAll("button")].find(button => button.textContent === "DELETE VIEW").click());
    const confirm = document.querySelector("#confirm-delete-view li");
    assert.ok(confirm, "the real confirmation dialog is mounted");
    await React.act(async () => {
      confirm.click();
      if (repeated) document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    const count = calls.length;
    await React.act(async () => settle({ status: 200, data: updatedProjectView }));
    const closed = !document.querySelector("#confirm-delete-view");
    return { count, calls, errors, closed };
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
    dom.window.close();
  }
}

test("client flag on: one confirmation click sends one DELETE", async () => {
  const result = await clickDelete(true);
  assert.equal(result.count, 1);
  assert.deepEqual(result.calls, ["/api/projects/views/delete-rename-view?viewId=saved&projectId=15"]);
  assert.deepEqual(result.errors, []);
});

test("client flag off: one confirmation click retains legacy behavior", async () => {
  const result = await clickDelete(false);
  assert.equal(result.count, 1);
});

for (const enabled of [true, false]) {
  test(`client flag ${enabled ? "on" : "off"}: simultaneous click and Enter ${enabled ? "send one DELETE" : "retain two legacy DELETEs"}`, async () => {
    const result = await clickDelete(enabled, 200, true);
    assert.equal(result.count, enabled ? 1 : 2);
  });
}

for (const enabled of [true, false]) {
  test(`client flag ${enabled ? "on" : "off"}: already-deleted 404 ${enabled ? "closes without an error toast" : "retains the legacy error toast"}`, async () => {
    const result = await clickDelete(enabled, 404);
    assert.equal(result.count, 1);
    assert.deepEqual(result.errors, enabled ? [] : ["Error deleting view"]);
    assert.equal(result.closed, enabled);
  });
}

test("regression control: removing the synchronous guard restores duplicate DELETEs", async () => {
  const result = await clickDelete(true, 200, true, true);
  assert.equal(result.count, 2);
  assert.throws(() => assert.equal(result.count, 1), { code: "ERR_ASSERTION" });
});

test("client server failure still shows an error toast with the flag on", async () => {
  const result = await clickDelete(true, 500);
  assert.equal(result.count, 1);
  assert.deepEqual(result.errors, ["Error deleting view"]);
});

function server(appRoute, scenario = {}) {
  const effects = [];
  let exists = !scenario.missing;
  const payload = { id: "pv", projectId: 15, allViews: [], user_project_views: [] };
  class ManagedSmartSplitMutationError extends Error { constructor() { super("Managed smart split"); this.status = 409; } }
  const prisma = {
    view: {
      findUnique: async () => {
        if (scenario.failure) throw new Error("Unavailable");
        return exists ? { id: "saved", project_view: { id: "pv", projectId: 15 } } : null;
      },
      delete: async () => {
        if (scenario.race) throw Object.assign(new Error("Record already deleted"), { code: "P2025" });
        effects.push("delete");
        exists = false;
      },
    },
    user_Project_View: { findUnique: async () => null },
    view_Last_Used: { deleteMany: async () => ({ count: 0 }) },
  };
  prisma.$transaction = async callback => callback(prisma);
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => scenario.noAuth ? null : { userId: 6 } },
    "@/lib/flags": { isFeatureEnabled: async () => appRoute },
    "@/lib/realtime/server": { broadcastBoardChange: () => effects.push("broadcast") },
    "@/utils/controllers/projects/views/viewsHelperAPIfunctions": { default: async () => payload },
    "@/utils/helperFunctions/Views/BoardFilterSanitizer": {},
    "@/utils/controllers/projects/views/boardFilterWriteLock": {
      ManagedSmartSplitMutationError,
      acquireBoardFilterWriteLock: async () => {},
      assertViewIsNotManagedSmartSplit: async () => { if (scenario.managed) throw new ManagedSmartSplitMutationError(); },
    },
  };
  const web = load("src/lib/api/project-writes/views/delete-rename-view.ts", mocks);
  mocks["@/lib/api/project-writes/views/delete-rename-view"] = web;
  const handler = load("src/pages/api/projects/views/delete-rename-view.ts", mocks).default;
  return {
    effects,
    payload,
    invoke: async () => {
      let result;
      await handler({ method: "DELETE", headers: {}, query: { viewId: "saved", projectId: "15" } }, {
        setHeader() {},
        status: status => ({ json: body => { result = { status, body }; } }),
      });
      return result;
    },
  };
}

for (const appRoute of [false, true]) {
  const mode = appRoute ? "App" : "Pages";
  test(`server ${mode}: missing view returns 404 without writes`, async () => {
    const fixture = server(appRoute, { missing: true });
    assert.deepEqual(await fixture.invoke(), { status: 404, body: { message: "View does not exist" } });
    assert.deepEqual(fixture.effects, []);
  });
  test(`server ${mode}: successful delete returns the board, repeated delete returns 404`, async () => {
    const fixture = server(appRoute);
    assert.deepEqual(await fixture.invoke(), { status: 200, body: fixture.payload });
    assert.deepEqual(await fixture.invoke(), { status: 404, body: { message: "View does not exist" } });
    assert.deepEqual(fixture.effects, ["delete", "broadcast"]);
  });
  test(`server ${mode}: concurrent deletion returns 404 not 500`, async () => {
    const fixture = server(appRoute, { race: true });
    assert.equal((await fixture.invoke()).status, 404);
    assert.deepEqual(fixture.effects, []);
  });
  for (const [scenario, expected] of [[{ failure: true }, 500], [{ managed: true }, 409], [{ noAuth: true }, 401]]) {
    test(`server ${mode}: real failure or denial retains ${expected}`, async () => {
      const fixture = server(appRoute, scenario);
      assert.equal((await fixture.invoke()).status, expected);
      assert.deepEqual(fixture.effects, []);
    });
  }
}
