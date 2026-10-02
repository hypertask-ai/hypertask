const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createRoot } = require("react-dom/client");
const ts = require("typescript");

function load(relativePath, stubs) {
  const filename = path.join(__dirname, "..", relativePath);
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (request) => {
    if (request in stubs) return { __esModule: true, ...stubs[request] };
    assert.ok(["react", "react/jsx-runtime"].includes(request), `Unstubbed import: ${request}`);
    return require(request);
  };
  new Function("module", "exports", "require", javascript)(loaded, loaded.exports, localRequire);
  return loaded.exports;
}

test("real task detail reads the provider snapshot without duplicate props and reuses decoded data on rerender", async (t) => {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  }
  const noop = () => {};
  const emptyHook = () => ({});
  const providerInputs = [];
  const provider = load("src/lib/contexts/TaskDetail/TaskProvider.tsx", {
    "@/hooks/Task Detail/useTaskDetailGlobalStates": {
      default: (task, comments) => {
        providerInputs.push({ task, comments });
        return { currentTask: task, setEditMode: noop };
      },
    },
  });
  const seeds = [];
  const stubs = {
    "@/store": {},
    "@/lib/state": { useRecoilState: () => [null, noop], useSetRecoilState: () => noop },
    "@tanstack/react-query": { useQueryClient: emptyHook },
    "next/navigation": { useRouter: emptyHook, useSearchParams: emptyHook },
    "@/hooks/MultiPages/useGetPriorityForTask": {
      useGetPriorityForTask: (...args) => { seeds.push(args); return {}; },
    },
    "@/hooks/MultiPages/useGetEstimateForTask": { useGetEstimateForTask: emptyHook },
    "@/hooks/MultiPages/useGetAllTaskLabels": { useGetAllTaskLabels: emptyHook },
    "@/hooks/General/useUndo": { useUndoContext: emptyHook },
    "@/hooks/MultiPages/useUpdateTaskInBoards": { default: emptyHook },
    "@/lib/contexts/TaskDetail/TaskProvider": provider,
    "@/hooks/Task Detail/useArchiveAndNavigate": { default: emptyHook },
    "@/hooks/Task Detail/useTimeTracking": { useTaskTime: emptyHook },
    "@/hooks/Task Detail/useSetStickyHeight": { default: emptyHook },
    "@/lib/contexts/TaskDetail/FollowersProvider": { useFollowersContext: emptyHook },
    "@/hooks/MultiPages/Route/useHypertasksNavigate": { default: emptyHook },
    "@/lib/configs/taskDetail.config": { default: { queryKeys: {} } },
    "@/hooks/Task Detail/useUpdateSubtask": { default: emptyHook },
    "@/hooks/General/useCopyURL": { default: emptyHook },
    "@/hooks/Task Detail/usePreventEmbedReload": { usePreventFigmaReload: emptyHook },
    "@/hooks/Task Detail/useGetShareLinks": { useGetTaskShareLinks: emptyHook },
    "@/hooks/Task Detail/useTaskRelations": { useTaskRelations: emptyHook },
    "@/hooks/MultiPages/useGetSectionsMoveTask": { useGetSectionsMoveTask: emptyHook },
    "@/lib/taskDetailInitialScroll": { createTaskDetailInitialScrollGuard: emptyHook },
    "@/lib/analytics/taskDetailPhaseTimings": { markTaskDetailPhase: noop },
  };
  const { useTaskDetailState } = load("src/app/detail/[...slug]/useTaskDetailState.tsx", stubs);
  let state;
  function Consumer() {
    state = useTaskDetailState({ _slugs: ["project-6859", "43"], _currentUser: { id: 2343 }, embedded: true });
    return React.createElement("span", null, state._parsedTask.title);
  }
  const root = createRoot(dom.window.document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  const comments = JSON.stringify({ comments: [{ id: 1 }], updatedAt: 1234 });
  async function render(task) {
    await React.act(async () => root.render(React.createElement(provider.TasksProvider, {
      parsedTask: JSON.stringify(task), _comments: comments, _initialStacked: {}, stack: { stack: false },
      allowPerks: true, scrollSetting: "Bottom",
    }, React.createElement(Consumer))));
  }
  const task = { id: 42, title: "Long task", projectId: 6859, uniqueIndex: 43, priority: 2 };
  await render(task);
  const firstStateTask = state._parsedTask;
  const firstProviderTask = providerInputs.at(-1).task;
  assert.deepEqual(firstStateTask, task);
  assert.equal(dom.window.document.querySelector("span").textContent, task.title);
  assert.deepEqual(state.currentItemInTasksPlaylist, { projectId: 6859, uniqueIndex: 43 });
  assert.equal(state.embedded, true);
  assert.equal(providerInputs.at(-1).comments, comments);
  assert.deepEqual(seeds.at(-1).slice(1), [42, 2]);

  await render(task);
  assert.equal(state._parsedTask, firstStateTask, "detail must not decode the same task again");
  assert.equal(providerInputs.at(-1).task, firstProviderTask, "provider must not decode the same task again");

  const nextTask = { ...task, id: 43, title: "Updated snapshot", uniqueIndex: 44, priority: 3 };
  await render(nextTask);
  assert.notEqual(state._parsedTask, firstStateTask);
  assert.deepEqual(state._parsedTask, nextTask);
  assert.deepEqual(providerInputs.at(-1).task, nextTask);
  assert.deepEqual(seeds.at(-1).slice(1), [43, 3]);
  assert.equal(dom.window.document.querySelector("span").textContent, nextTask.title);
});
