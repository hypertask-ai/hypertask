const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const query = require("@tanstack/react-query");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

function load(file, mocks) {
  const source = process.env.INSTANT_LAYOUT_BASELINE
    ? execFileSync("git", ["show", `origin/production:${file}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(path.join(root, file), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    if (name in mocks) return { __esModule: true, ...mocks[name] };
    assert.ok(["react", "react/jsx-runtime", "@tanstack/react-query"].includes(name), `Unexpected dependency: ${name}`);
    return require(name);
  }, exports);
  return exports;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(t, mobile = false) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-15/42" });
  const globals = ["window", "document", "fetch", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = dom.window.document.getElementById("root");
  const reactRoot = createRoot(container);
  t.after(async () => {
    await React.act(async () => reactRoot.unmount());
    client.clear();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  return {
    client, container, mobile,
    render: async (child) => React.act(async () => reactRoot.render(React.createElement(query.QueryClientProvider, { client }, child))),
    flush: async () => React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }),
  };
}

const cached = { id: 42, projectId: 15, uniqueIndex: 42, title: "Cached title", description_: { content: "<p>Description</p>" } };
const full = { ...cached, user: { id: 6, displayName: "Author" }, relatedToTasks: [{ id: 10 }], project: { id: 15 }, description_: { ...cached.description_, id: 43 } };
const comments = { comments: [{ id: 70, text: "Existing comment" }], stacked: { 0: false }, lastReadAt: null, agentRunActivities: [] };
const pages = [{ id: 80, publicId: "page-80", title: "Existing page", parentPageId: null, updatedAt: null }];

for (const mobile of [false, true]) {
  test(`instant open first mounts a complete layout snapshot, not the partial board payload (${mobile ? "phone" : "desktop"})`, async (t) => {
    const fixture = setup(t, mobile);
    const taskRequest = deferred(), commentsRequest = deferred(), pagesRequest = deferred();
    const requests = [], snapshots = [];
    global.fetch = (url) => {
      requests.push(url);
      if (url.startsWith("/api/tasks/getTask")) return taskRequest.promise;
      if (url.startsWith("/api/pages/list")) return pagesRequest.promise;
      assert.fail(`Unexpected request: ${url}`);
    };
    const Detail = load("src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx", {
      "@/lib/state": { useRecoilValue: () => ({ id: 985 }) },
      "@/store": { currentUserAtom: {} },
      "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: { commentsStacked: false, scrollSetting: "None" } }) },
      "@/lib/constants": { default: { CommentsTQPrefixKey: "comments" } },
      "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: ({ children }) => children },
      "@/lib/contexts/TaskDetail/TaskProvider": {
        TasksProvider: ({ children, parsedTask, _comments }) => {
          snapshots.push({ task: JSON.parse(parsedTask), comments: JSON.parse(_comments), pages: fixture.client.getQueryData(["task-pages", 985, 42]) });
          return children;
        },
        useTaskContext: () => ({ setCurrentTask: () => {}, setDescription: () => {} }),
      },
      "@/lib/navigation/cachedTaskDetail": { cachedTaskDetailKey: (userId, taskId) => ["cached-task-detail", userId, taskId], TaskAccessDeniedError: class extends Error {} },
      "@/lib/realtime/taskDetailRefresh": { shouldPreserveTaskEditorContent: () => false, mergeRealtimeTaskDetail: (_, task) => task },
      "@/app/unauthorized/page": { default: () => React.createElement("div", null, "No access") },
      "@/utils/api/Task Detail": { fetchCommentsHelper: () => { requests.push("comments"); return commentsRequest.promise; } },
      "@/app/detail/[...slug]/TaskDetailComp": { default: () => React.createElement("article", null, "Complete ticket") },
    }).default;
    const child = React.createElement(Detail, { ...cached, taskId: 42, initialTask: cached, embedded: false, pendingFallback: React.createElement("div", null, "Source board") });
    await fixture.render(child);
    assert.equal(fixture.container.textContent, "Source board", "keep the board visible rather than painting a ticket that will shift");
    assert.equal(snapshots.length, 0, "no task provider may initialize from incomplete layout data");
    assert.equal(requests.length, 3, "task, comments and pages must start concurrently, with no reveal timer or fetch waterfall");
    await React.act(async () => {
      commentsRequest.resolve(comments);
      taskRequest.resolve({ ok: true, status: 200, json: async () => full });
    });
    await fixture.flush();
    assert.equal(snapshots.length, 0, "pages also determine the description and comment positions");
    await React.act(async () => pagesRequest.resolve({ ok: true, json: async () => ({ pages }) }));
    await fixture.flush();
    assert.equal(fixture.container.textContent, "Complete ticket");
    assert.deepEqual(snapshots[0], { task: full, comments, pages }, "the very first provider mount must already have author, detail rows, comments and pages");
    const first = fixture.container.innerHTML;
    await fixture.render(child);
    await fixture.flush();
    assert.equal(fixture.container.innerHTML, first, "unchanged responses must not replace the initial ticket layout");
  });
}

for (const { enabled, active, accountId } of [
  { enabled: true, active: true, accountId: 985 },
  { enabled: false, active: true, accountId: 985 },
  { enabled: true, active: false, accountId: 985 },
  { enabled: true, active: true, accountId: 6 },
]) {
  test(`page snapshot reuse is limited to the active instant-open account (flag ${enabled}, active ${active}, account ${accountId})`, async (t) => {
    const fixture = setup(t);
    const key = ["task-pages", accountId, 42];
    fixture.client.setQueryData(key, pages);
    if (active) {
      const observer = new query.QueryObserver(fixture.client, { queryKey: key, queryFn: async () => pages, staleTime: Infinity });
      const unsubscribe = observer.subscribe(() => {});
      t.after(unsubscribe);
    }
    const reuse = enabled && active && accountId === 985;
    let reads = 0;
    const request = deferred();
    global.fetch = () => { reads++; return request.promise; };
    const { TaskPagesProvider, useTaskPages } = load("src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptionSubTasks/TaskPagesContext.tsx", {
      "next/navigation": { useRouter: () => ({ push() {} }) },
      "react-hot-toast": { default: {} },
      "@/lib/constants/APIRouteConstants": { listPagesRoute: "/api/pages/list", createPageRoute: "/api/pages/create" },
      "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ currentTask: cached }) },
      "@/lib/navigation/pageReturn": { createPageReturnHref: () => "" },
      "@/hooks/useFlag": { useFlag: () => enabled },
      "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "instant" },
      "@/lib/state": { useRecoilValue: () => ({ id: 985 }) },
      "@/store": { currentUserAtom: {} },
    });
    const states = [];
    let controls;
    function Consumer() {
      const state = useTaskPages();
      controls = state;
      states.push({ loading: state.loading, pages: state.pages });
      return React.createElement("div", null, state.pages.map((page) => page.title).join(""));
    }
    const child = React.createElement(TaskPagesProvider, null, React.createElement(Consumer));
    await fixture.render(child);
    assert.deepEqual(states[0], { loading: !reuse, pages: reuse ? pages : [] });
    assert.equal(reads, reuse ? 0 : 1, "only the active instant-open snapshot skips the ordinary page request");
    if (reuse) {
      assert.equal(fixture.container.textContent, "Existing page");
      await React.act(async () => controls.refetch());
      assert.equal(reads, 1, "explicit page refresh must still read the server");
      await React.act(async () => request.resolve({ ok: true, json: async () => ({ pages: [] }) }));
      await fixture.flush();
      assert.equal(fixture.container.textContent, "", "deleted pages must not be restored from the opening snapshot");
    } else {
      await React.act(async () => request.resolve({ ok: true, json: async () => ({ pages }) }));
      await fixture.flush();
      assert.equal(fixture.container.textContent, "Existing page", "the flag-off path retains its ordinary page request");
    }
  });
}
