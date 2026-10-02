const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const ts = require("typescript");
require("tsx/cjs");

const root = path.resolve(__dirname, "..");
function loadModule(relativePath, stubs) {
  const filename = path.join(root, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (specifier) => stubs[specifier] ?? createRequire(filename)(specifier), loaded, loaded.exports,
  );
  return loaded.exports;
}

// No network or realtime: exercise the real hooks, toast, API wrappers, and
// React Query caches against an isolated task store.
test("archive Undo restores Todo after detail unmounts despite a warm archived board snapshot", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/project?id=6646",
  });
  const previous = {
    window: global.window,
    document: global.document,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const user = { id: 985 };
  const task = { id: 6646, projectId: 6646, sectionId: 10, title: "Undo fixture", status: "Normal", ranking: "a", subTasks: [], assignees: [{ userId: user.id }] };
  const project = { id: task.projectId, title: "Undo board", section: [{ id: 10, section_title: "Todo", visibility: true }] };
  const requests = [];
  const api = {
    post: async (url, body) => {
      requests.push([url, body]);
      if (url === "/api/tasks/(un)archive") {
        task.status = body.status;
        return { data: structuredClone(task) };
      }
      if (url === "/api/projects/boardTasks") {
        return { data: { project: structuredClone(project), tasks: task.status === "Normal" ? [structuredClone(task)] : [], allViews: [] } };
      }
      if (url === "/api/projects/getAll") return { data: [structuredClone(project)] };
      throw new Error(`Unexpected request: ${url}`);
    },
  };
  const homepage = loadModule("src/utils/api/Homepage/index.ts", { axios: api });
  const archiveTask = loadModule("src/utils/api/global/apiHelpers/archiveTask.ts", { axios: api }).default;
  const globalAPI = { archiveTask };
  const { undoTaskDelete } = loadModule("src/utils/undoActions/helperFuncs.ts", { "../api/global": globalAPI });
  let toastContent;
  const dismissed = [];
  const toast = Object.assign(() => {}, {
    custom: (render) => { toastContent = render({ id: "archive-undo", visible: true }); return "archive-undo"; },
    dismiss: (id) => dismissed.push(id),
    error: (message) => { throw new Error(message); },
  });
  const undoToast = loadModule("src/components/undoToast/index.tsx", { "react-hot-toast": { toast } });
  const undoModule = loadModule("src/hooks/General/useUndo.tsx", {
    "@/utils/undoActions": { undoTaskDelete },
    "@/components/undoToast": undoToast,
    "react-hot-toast": toast,
    "./undoWindow": require("../src/hooks/General/undoWindow.ts"),
  });
  const boards = loadModule("src/hooks/Homepage/useGetBoards.ts", { "@/utils/api/Homepage": homepage });
  const reconcile = loadModule("src/lib/boardSync/reconcileActiveBoardQuery.ts", { "@/utils/api/Homepage": homepage });
  const store = require("../src/store");
  const redirects = [];
  const router = { replace: (href) => redirects.push(href) };
  const UpdateKanban = loadModule("src/hooks/MultiPages/useUpdateTaskInBoards.tsx", {
    "@/utils/api/global": globalAPI,
    "@/lib/state": {
      useRecoilState: (atom) => [atom === store.currentProjectAtom ? project : user, () => {}],
      useRecoilValue: () => ({}),
      useSetRecoilState: () => () => {},
    },
    "next/navigation": { useRouter: () => router },
    "react-hot-toast": toast,
    "../General/useUndo": undoModule,
    "../Inbox/useGlobalFocusHandler": () => ({ archiveNotificationGetter: () => {} }),
    "@/lib/boardSync/reconcileActiveBoardQuery": reconcile,
  }).default;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let boardQuery;
  let archive;
  const Board = () => {
    boardQuery = boards.useGetAllBoards(user, String(project.id));
    return React.createElement("div", { id: "todo" }, boardQuery.data?.updatedProjects[0]?.sections[0]?.items.map((item) => React.createElement("span", { key: item.id }, item.title)));
  };
  const Detail = () => { archive = UpdateKanban().removeFromListWithStatus; return null; };
  const Toast = () => toastContent ?? null;
  const reactRoot = createRoot(document.getElementById("root"));
  const render = (showDetail) => reactRoot.render(React.createElement(QueryClientProvider, { client: queryClient },
    React.createElement(undoModule.UndoProvider, null, React.createElement(Board), showDetail && React.createElement(Detail), React.createElement(Toast)),
  ));
  try {
    await React.act(async () => { render(true); });
    await React.act(async () => { await boardQuery.refetch(); });
    assert.equal(document.getElementById("todo").textContent, task.title);
    await React.act(async () => {
      await archive(task.sectionId, task.projectId, task.id, "Archive", undefined, { undoRedirectPath: `/detail/project-${project.id}/1` });
      // The archive event/poll completes before Undo. This is a fresh, empty
      // side cache, not an expired snapshot that a normal refetch would repair.
      await queryClient.fetchQuery({ queryKey: homepage.BOARD_TASKS_KEY(project.id, user.id), queryFn: () => homepage.fetchBoardTasks(project.id, user.id), staleTime: 0 });
      render(false);
    });
    assert.equal(task.status, "Archive");
    assert.equal(queryClient.getQueryData(["projectsAll"]).updatedProjects[0].sections[0].items.length, 0);
    assert.equal(queryClient.getQueryData(homepage.BOARD_TASKS_KEY(project.id, user.id)).tasks.length, 0);
    assert.equal(document.getElementById("todo").textContent, "", "archive removes the rendered card");
    const undoButton = document.querySelector("button[aria-label='Undo']");
    assert.ok(undoButton, "the real toast retains its Undo button after detail unmounts");
    const requestsBeforeUndo = requests.length;
    await React.act(async () => {
      undoButton.click();
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.deepEqual(requests[requestsBeforeUndo], ["/api/tasks/(un)archive", { taskId: task.id, status: "Normal" }]);
    assert.equal(task.status, "Normal", "the restore API succeeded");
    assert.equal(task.sectionId, 10);
    assert.deepEqual(task.assignees, [{ userId: user.id }]);
    assert.deepEqual(dismissed, ["archive-undo"]);
    assert.equal(queryClient.getQueryData(["projectsAll"]).updatedProjects[0].sections[0].items[0]?.id, task.id, "Undo must refresh the board, not republish its cached archived snapshot");
    assert.deepEqual(redirects, [`/detail/project-${project.id}/1`]);
    await React.act(async () => { render(false); });
    assert.equal(document.getElementById("todo").textContent, task.title);
    await React.act(async () => { await boardQuery.refetch(); render(false); });
    assert.equal(queryClient.getQueryData(homepage.BOARD_TASKS_KEY(project.id, user.id)).tasks[0]?.id, task.id, "later hydration must also retain the restored task");
  } finally {
    await React.act(async () => reactRoot.unmount());
    queryClient.clear();
    dom.window.close();
    Object.assign(global, previous);
  }
});
