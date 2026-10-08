const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createRoot } = require("react-dom/client");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");
const { execFileSync } = require("node:child_process");

function load(relativePath, stubs) {
  const filename = path.join(__dirname, "..", relativePath);
  const source = process.env.VISITED_TASK_BASELINE && relativePath.endsWith("useTaskDetailState.tsx")
    ? execFileSync("git", ["show", `origin/production:${relativePath}`], { cwd: path.join(__dirname, ".."), encoding: "utf8" })
    : fs.readFileSync(filename, "utf8");
  const javascript = ts.transpileModule(source, {
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
  const queryClient = new QueryClient();
  let embedded = true;
  let authenticatedUserId = 2343;
  let subtaskLink = true;
  const cachedKey = id => ["cached-task-detail", 2343, id];
  const stubs = {
    "@/store": {},
    "@/lib/state": { useRecoilState: () => [null, noop], useSetRecoilState: () => noop },
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/hooks/General/useAuth": { useAuth: () => ({ authenticatedUserId }) },
    "@/hooks/useFlag": { useFlag: () => subtaskLink },
    "@/lib/flags/keys": { HTPR_6972_SUBTASK_LINK_FLAG: "htpr-6972-subtask-link", HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG: "htpr-7009-dedupe-task-detail-reads" },
    "@/lib/taskDetailReads": { taskDetailReadKey: (accountId, id) => ["cached-task-detail", accountId, id, "read"] },
    "@/lib/navigation/cachedTaskDetail": { cachedTaskDetailKey: (accountId, id) => ["cached-task-detail", accountId, id] },
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
    state = useTaskDetailState({ _slugs: ["project-6859", "43"], _currentUser: { id: 2343 }, embedded });
    return React.createElement("span", null, state._parsedTask.title);
  }
  const root = createRoot(dom.window.document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    queryClient.clear();
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
  const readKey = [...cachedKey(nextTask.id), "read"];
  assert.equal(queryClient.getQueryData(readKey), undefined, "embedded snapshots must not seed verified full-detail reads");
  assert.equal(queryClient.getQueryData(cachedKey(nextTask.id)), undefined, "embedded detail must not publish a native-navigation seed");
  embedded = false;
  subtaskLink = false;
  await render(nextTask);
  assert.equal(queryClient.getQueryData(cachedKey(nextTask.id)), undefined, "flag-off routes keep the original cache behavior");
  assert.equal(queryClient.getQueryData(readKey), undefined, "flag-off routes must not seed the new read cache");
  subtaskLink = true;
  authenticatedUserId = 985;
  await render(nextTask);
  assert.equal(queryClient.getQueryData(cachedKey(nextTask.id)), undefined, "an old server account cannot seed the signed-in account's cache");
  assert.equal(queryClient.getQueryData(readKey), undefined, "an old server account cannot seed the scoped full-detail read");
  authenticatedUserId = 2343;
  await render(nextTask);
  assert.deepEqual(queryClient.getQueryData(cachedKey(nextTask.id)), nextTask, "visited authorized routes remain available while Back/Forward waits for RSC");
  assert.deepEqual(queryClient.getQueryData(readKey), nextTask, "fresh authorized server data seeds the scoped full-detail read");
  const serverRefresh = { ...nextTask, title: "Fresh server refresh" };
  await render(serverRefresh);
  assert.deepEqual(queryClient.getQueryData(readKey), serverRefresh, "a fresh server refresh must replace an existing read-cache seed");
  const refreshed = { ...nextTask, title: "Newer authorized cache response" };
  queryClient.setQueryData(cachedKey(nextTask.id), refreshed);
  await render({ ...nextTask, title: "Older route snapshot" });
  assert.deepEqual(queryClient.getQueryData(cachedKey(nextTask.id)), refreshed, "mounting a visited route must not overwrite a newer query response");
  queryClient.removeQueries({ queryKey: cachedKey(nextTask.id), exact: true });
  const denied = new Error("Access denied");
  await assert.rejects(queryClient.fetchQuery({ queryKey: cachedKey(nextTask.id), retry: false, queryFn: () => { throw denied; } }));
  await render(nextTask);
  assert.equal(queryClient.getQueryState(cachedKey(nextTask.id)).error, denied, "an old route snapshot must not clear a denied task's query state");
  assert.equal(queryClient.getQueryData(cachedKey(nextTask.id)), undefined);
});
