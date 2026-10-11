const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createRoot } = require("react-dom/client");
const ts = require("typescript");
const { QueryClient, QueryClientProvider, useQuery, notifyManager, defaultScheduler } = require("@tanstack/react-query");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const reads = jiti(path.join(root, "src/lib/taskDetailReads.ts"));
const task = { id: 42, projectId: 15, uniqueIndex: 7, status: "Active", title: "Server copy" };
const seed = (updatedAt = Date.now()) => ({ userId: 985, taskId: 42, projectId: 15, uniqueIndex: 7, updatedAt });

function load(file, mocks) {
  const source = process.env.HTPR_7009_SEED_BASELINE === "1" && file.endsWith("TaskProvider.tsx")
    ? execFileSync("git", ["show", `origin/production:${file}`], { cwd: root, encoding: "utf8" })
    : fs.readFileSync(path.join(root, file), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function("require", "exports", js)(name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) return jiti(path.join(root, "src", name.slice(2)));
    return require(name);
  }, exports);
  return exports;
}

async function mount(t, { enabled = true, ready = true, userId = 985, serverTaskSeed = seed() } = {}) {
  const dom = new JSDOM("<div id='root'></div>");
  const previous = { window: global.window, document: global.document, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT, fetch: global.fetch };
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  // Let act drain query notifications before teardown restores the DOM globals.
  notifyManager.setScheduler(queueMicrotask);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const flags = { enabled, ready }, auth = { userId };
  const reactRoot = createRoot(dom.window.document.getElementById("root"));
  let requests = 0, query, version = "Refetched copy", readerKey = 0;
  global.fetch = async () => { requests++; return { ok: true, status: 200, json: async () => ({ ...task, title: version }) }; };
  const mocks = {
    "@/hooks/Task Detail/useTaskDetailGlobalStates": { __esModule: true, default: initialTask => ({ currentTask: initialTask }) },
    "@/hooks/useFlag": { useFlag: () => flags.enabled, useFlagReady: () => flags.ready },
    "@/hooks/General/useAuth": { useAuth: () => ({ authenticatedUserId: auth.userId }) },
    "@/lib/taskDetailReads": reads,
  };
  const { TasksProvider: Provider } = load("src/lib/contexts/TaskDetail/TaskProvider.tsx", mocks);
  const { default: Reader } = load("src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx", {
    ...mocks,
    "@tanstack/react-query": { ...require("@tanstack/react-query"), useQuery: options => {
      const result = useQuery(options);
      if (options.queryKey[0] === "cached-task-detail") query = result;
      return result;
    } },
    "@/lib/state": { useRecoilValue: () => ({ id: auth.userId }) },
    "@/store": { currentUserAtom: {} },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: { commentsStacked: false } }) },
    "@/app/unauthorized/page": { __esModule: true, default: () => null },
    "@/app/detail/[...slug]/TaskDetailComp": { __esModule: true, default: () => null },
    "@/lib/contexts/TaskDetail/TaskProvider": { TasksProvider: ({ children }) => children, useTaskContext: () => ({ currentTask: task, setCurrentTask() {}, setDescription() {} }) },
    "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: ({ children }) => children },
    "@/utils/api/Task Detail": { fetchCommentsHelper: async () => ({ comments: [] }) },
  });
  async function render() {
    await React.act(async () => {
      reactRoot.render(React.createElement(QueryClientProvider, { client }, React.createElement(Provider, {
        parsedTask: JSON.stringify(task), serverTaskSeed, _comments: "{}", _initialStacked: {}, stack: {}, allowPerks: true, scrollSetting: "Bottom",
      }, React.createElement(Reader, { key: readerKey, taskId: task.id, projectId: task.projectId, uniqueIndex: task.uniqueIndex, initialTask: task, embedded: false }))));
      for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve));
    });
  }
  t.after(async () => { await React.act(async () => reactRoot.unmount()); client.clear(); notifyManager.setScheduler(defaultScheduler); dom.window.close(); Object.assign(global, previous); });
  await render();
  return { client, flags, auth, render, remount: async () => { readerKey++; await render(); }, query: () => query, requests: () => requests };
}

test("fresh matching server seed is adopted before a stale-initial-data observer mounts", async t => {
  const serverTaskSeed = seed(Date.now() - 1000);
  const h = await mount(t, { serverTaskSeed });
  assert.equal(h.requests(), 0, "hydration must not repeat the authorized server task read");
  assert.deepEqual(h.client.getQueryData(reads.taskDetailReadKey(985, 42)), task);
  assert.equal(h.client.getQueryState(reads.taskDetailReadKey(985, 42)).dataUpdatedAt, serverTaskSeed.updatedAt, "use server read time, not hydration time");
});

test("stale server seed refetches within the existing freshness policy", async t => {
  const h = await mount(t, { serverTaskSeed: seed(Date.now() - reads.TASK_DETAIL_READ_FRESH_MS) });
  assert.equal(h.requests(), 1);
  assert.equal(h.client.getQueryData(reads.taskDetailReadKey(985, 42)).title, "Refetched copy");
});

for (const [name, options] of [
  ["different user", { userId: 986 }],
  ["missing seed", { serverTaskSeed: null }],
  ["flag off", { enabled: false }],
]) test(`${name} cannot suppress the original mount refetch`, async t => {
  const h = await mount(t, options);
  assert.equal(h.requests(), 1);
  if (name === "different user" || name === "flag off") assert.equal(h.client.getQueryData(reads.taskDetailReadKey(985, 42)), undefined);
  else assert.equal(h.client.getQueryData(reads.taskDetailReadKey(985, 42)).title, "Refetched copy");
});

test("an unresolved flag cannot adopt a server seed until flag-on resolves", async t => {
  const serverTaskSeed = seed(Date.now() - 1000);
  const h = await mount(t, { enabled: false, ready: false, serverTaskSeed });
  assert.equal(h.requests(), 0);
  assert.equal(h.client.getQueryState(reads.taskDetailReadKey(985, 42)), undefined);
  h.flags.enabled = true;
  h.flags.ready = true;
  await h.render();
  assert.equal(h.requests(), 0);
  assert.equal(h.client.getQueryState(reads.taskDetailReadKey(985, 42)).dataUpdatedAt, serverTaskSeed.updatedAt);
});

test("edit after seed adoption invalidates it and explicit refresh still reads the server", async t => {
  const h = await mount(t);
  const key = reads.taskDetailReadKey(985, 42);
  await React.act(async () => reads.refreshTaskDetailReadAfterWrite(h.client, 985, 42, { title: "Edited copy" }));
  await h.render();
  assert.equal(h.client.getQueryData(key).title, "Edited copy");
  assert.equal(h.client.getQueryState(key).isInvalidated, true, "rerender must not re-adopt the old seed and erase invalidation");
  await h.remount();
  assert.equal(h.requests(), 1, "reopening after an edit must refetch even inside the freshness budget");
  assert.equal(h.client.getQueryData(key).title, "Refetched copy");
  await React.act(async () => h.query().refetch());
  assert.equal(h.requests(), 2, "explicit refresh must refetch a fresh adopted query too");
});

test("fresh adopted seed still refetches on browser reconnect and focus", async t => {
  const { onlineManager, focusManager } = require("@tanstack/react-query");
  const h = await mount(t);
  assert.equal(h.requests(), 0);
  for (const manager of [onlineManager, focusManager]) {
    await React.act(async () => {
      if (manager === onlineManager) { manager.setOnline(false); manager.setOnline(true); }
      else { manager.setFocused(false); manager.setFocused(true); }
      for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve));
    });
  }
  focusManager.setFocused(undefined);
  assert.equal(h.requests(), 2);
});

test("adoption rejects mismatched task, route, user and invalid timestamps without creating cache data", () => {
  for (const invalid of [
    { userId: 986 }, { taskId: 43 }, { projectId: 16 }, { uniqueIndex: 8 },
    { updatedAt: 0 }, { updatedAt: NaN }, { updatedAt: Date.now() + 60_000 },
  ]) {
    const client = new QueryClient();
    reads.adoptTaskDetailServerSeed(client, 985, task, { ...seed(), ...invalid });
    assert.equal(client.getQueryState(reads.taskDetailReadKey(985, 42)), undefined);
    client.clear();
  }
});

test("adoption cannot replace a newer read, an invalidated edit or an access error", async () => {
  const serverTaskSeed = seed(Date.now() - 1000), key = reads.taskDetailReadKey(985, 42);
  for (const state of ["newer", "invalidated", "denied"]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(key, { ...task, title: "Existing copy" }, { updatedAt: state === "newer" ? Date.now() : serverTaskSeed.updatedAt - 1 });
    if (state === "invalidated") await client.invalidateQueries({ queryKey: key });
    if (state === "denied") await assert.rejects(client.fetchQuery({ queryKey: key, queryFn: () => { throw new Error("Access denied"); } }));
    const before = client.getQueryState(key);
    reads.adoptTaskDetailServerSeed(client, 985, task, serverTaskSeed);
    assert.equal(client.getQueryState(key), before);
    client.clear();
  }
});
