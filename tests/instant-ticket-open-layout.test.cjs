const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const query = require("@tanstack/react-query");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const task = { id: 42, projectId: 15, uniqueIndex: 42, title: "Cached title", description_: { content: "Cached description" } };

test("pages query never fires must not block opening a cached ticket", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-15/42" });
  const previous = new Map(["window", "document", "fetch", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let pagesRequests = 0;
  global.fetch = async (url) => {
    if (url.startsWith("/api/pages/list")) {
      pagesRequests++;
      return new Promise(() => {});
    }
    assert.match(url, /^\/api\/tasks\/getTask/);
    return { ok: true, status: 200, json: async () => task };
  };
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pagesKey = ["task-pages", 2343, task.id];
  const observer = new query.QueryObserver(client, { queryKey: pagesKey, enabled: false });
  const unsubscribe = observer.subscribe(() => {});
  const container = document.getElementById("root");
  const renderer = createRoot(container);
  t.after(async () => {
    await React.act(async () => renderer.unmount());
    unsubscribe();
    client.clear();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  const mocks = {
    "@tanstack/react-query": {
      ...query,
      useQuery: (options) => query.useQuery(options.queryKey[0] === "task-pages" ? { ...options, enabled: false } : options),
    },
    "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
    "@/store": { currentUserAtom: {} },
    "@/hooks/useFlag": { useFlag: () => true },
    "@/lib/flags/keys": { HTPR_6899_STABLE_LAYOUT_FLAG: "htpr-6899-stable-layout" },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: { commentsStacked: false, scrollSetting: "None" } }) },
    "@/lib/constants": { default: { CommentsTQPrefixKey: "comments" } },
    "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: ({ children }) => children },
    "@/lib/contexts/TaskDetail/TaskProvider": {
      TasksProvider: ({ children }) => children,
      useTaskContext: () => ({ setCurrentTask() {}, setDescription() {} }),
    },
    "@/lib/navigation/cachedTaskDetail": { cachedTaskDetailKey: (userId, taskId) => ["cached-task-detail", userId, taskId], TaskAccessDeniedError: class extends Error {} },
    "@/lib/realtime/taskDetailRefresh": { shouldPreserveTaskEditorContent: () => false, mergeRealtimeTaskDetail: (_, refreshed) => refreshed },
    "@/app/unauthorized/page": { default: () => React.createElement("div", null, "No access") },
    "@/utils/api/Task Detail": { fetchCommentsHelper: async () => ({ comments: [] }) },
    "@/app/detail/[...slug]/TaskDetailComp": { default: () => React.createElement("article", null, task.title, " ", task.description_.content) },
  };
  const source = fs.readFileSync(path.join(root, "src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (name === "@/lib/taskDetailReads") return {};
    if (name === "@/hooks/useFlag") return { ...mocks[name], useFlagReady: () => true, useFlag: key => key !== "htpr-7009-dedupe-task-detail-reads" };
    if (name === "@/lib/flags/keys") return { ...mocks[name], HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG: "htpr-7009-dedupe-task-detail-reads" };
    if (name in mocks) return { __esModule: true, ...mocks[name] };
    assert.ok(["react", "react/jsx-runtime"].includes(name), `Unexpected dependency: ${name}`);
    return require(name);
  }, exports);
  await React.act(async () => renderer.render(React.createElement(query.QueryClientProvider, { client },
    React.createElement(exports.default, { taskId: task.id, projectId: task.projectId, uniqueIndex: task.uniqueIndex, initialTask: task, embedded: false }))));
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(pagesRequests, 0, "the pages query must never have fired");
  assert.equal(client.getQueryState(pagesKey).status, "pending");
  assert.equal(client.getQueryState(pagesKey).fetchStatus, "idle");
  assert.match(container.textContent, /Cached title Cached description/, "a never-firing pages query cannot hold the ticket behind its board");
});
