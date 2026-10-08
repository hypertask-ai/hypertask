const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const axios = require("axios");
const { QueryClient, QueryObserver } = require("@tanstack/react-query");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const reads = jiti(path.join(root, "src/lib/taskDetailReads.ts"));
const refresh = jiti(path.join(root, "src/lib/realtime/taskDetailRefresh.ts"));
const commentsRefresh = jiti(path.join(root, "src/lib/realtime/taskCommentsRefresh.ts"));
const constants = jiti(path.join(root, "src/lib/constants"));
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

function load(file, mocks, source = fs.readFileSync(path.join(root, file), "utf8")) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function("require", "exports", js)(name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) return jiti(path.join(root, "src", name.slice(2)));
    return require(name);
  }, exports);
  return exports;
}

function harness(t, enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const observers = [], effects = [], intervals = new Set();
  const counts = { task: 0, comments: 0, meta: 0, single: 0 };
  let userId = 985, version = 1, ready = true;
  const original = { fetch: global.fetch, document: global.document, window: global.window, setInterval: global.setInterval, clearInterval: global.clearInterval, get: axios.get };
  global.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  global.window = { addEventListener() {}, removeEventListener() {} };
  global.setInterval = callback => { intervals.add(callback); return callback; };
  global.clearInterval = callback => intervals.delete(callback);
  const task = (id = 42) => ({ id, projectId: 15, uniqueIndex: id, status: "Active", title: `Task ${version}`, description_: { content: `Body ${version}` }, priority: version, estimate: version });
  const meta = () => ({ priority: version, estimate: version, labels: [version], followers: [version] });
  global.fetch = async () => { counts.task++; return { ok: true, status: 200, json: async () => task() }; };
  axios.get = async url => { if (url.includes("detailMeta")) { counts.meta++; await new Promise(resolve => setImmediate(resolve)); return { data: meta() }; } counts.single++; return { data: task() }; };
  const fetchCommentsHelper = async () => { counts.comments++; return { comments: [version] }; };
  const mocks = {
    react: { useCallback: fn => fn, useEffect: fn => { const cleanup = fn(); if (cleanup) effects.push(cleanup); }, useRef: current => ({ current }) },
    "@tanstack/react-query": {
      useQueryClient: () => client,
      useQuery: options => {
        const observer = new QueryObserver(client, options);
        const unsubscribe = observer.subscribe(() => {});
        observers.push(unsubscribe);
        return observer.getCurrentResult();
      },
    },
    "@/hooks/useFlag": { useFlag: () => enabled, useFlagReady: () => ready },
    "@/hooks/General/useAuth": { useAuth: () => ({ authenticatedUserId: userId }) },
    "@/utils/api/Task Detail": { fetchCommentsHelper, getAllFollowers: async id => (await axios.get(`/api/tasks/detailMeta?taskId=${id}`)).data.followers, getDraftsHelper: async () => ({}) },
    "@/utils/api/global": { __esModule: true, default: { getPriorityForTask: async () => 1, getEstimateForTask: async () => 1, getAllTaskLabels: async () => [], getSectionsForMoveTask: async () => [] } },
  };
  t.after(() => { effects.forEach(fn => fn()); observers.forEach(fn => fn()); client.clear(); Object.assign(global, { fetch: original.fetch, document: original.document, window: original.window, setInterval: original.setInterval, clearInterval: original.clearInterval }); axios.get = original.get; });
  const prefetch = targets => load("src/hooks/Task Detail/usePrefetchTaskDetail.ts", mocks).usePrefetchTaskDetailTargets({ userId })(targets);
  const field = name => load("src/hooks/Task Detail/useTaskDetailMetaField.ts", mocks).useTaskDetailMetaField(name, [{ priority: "priority", estimate: "estimate", labels: "taskLabels", followers: "followersFor:" }[name], 42], 42, () => axios.get("/api/tasks/detailMeta?taskId=42").then(r => r.data[name]), []);
  const comments = initialData => load("src/hooks/Task Detail/useGetComments.ts", mocks).useGetAllComments([constants.CommentsTQPrefixKey, 42], 42, userId, initialData);
  const embedded = source => load("src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx", {
    ...mocks,
    "@/lib/state": { useRecoilValue: () => ({ id: userId }) },
    "@/store": { currentUserAtom: {} },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: { commentsStacked: false } }) },
    "@/app/unauthorized/page": { __esModule: true, default: () => null },
    "@/app/detail/[...slug]/TaskDetailComp": { __esModule: true, default: () => null },
    "@/lib/contexts/TaskDetail/TaskProvider": { TasksProvider: () => null },
    "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: () => null },
  }, source).default({ taskId: 42, projectId: 15, uniqueIndex: 42, initialTask: task(), embedded: false });
  return { client, counts, mocks, prefetch, field, comments, embedded, task, meta, tick: () => intervals.forEach(callback => callback()), version: value => { version = value; }, user: value => { userId = value; }, ready: value => { ready = value; } };
}

test("shared task fetcher uses explicit cache options and rejects invalid responses without replacing cached data", async t => {
  const h = harness(t);
  const signal = new AbortController().signal;
  for (const options of [{}, { cache: "no-store", credentials: "same-origin" }]) {
    global.fetch = async (url, init) => {
      assert.equal(url, "/api/tasks/getTask?project=project-15&uniqueIndex=42");
      assert.deepEqual(init, { signal, ...options });
      return { ok: true, status: 200, json: async () => h.task() };
    };
    assert.deepEqual(await reads.fetchScopedTaskDetail(42, 15, 42, signal, options), h.task());
  }
  const previous = h.task(), queryKey = reads.taskDetailReadKey(985, 42);
  h.client.setQueryData(queryKey, previous);
  for (const response of [
    { ok: false, status: 500 },
    ...[401, 403, 404].map(status => ({ ok: false, status })),
    ...[null, { ...previous, id: 43 }, { ...previous, projectId: 16 }, { ...previous, uniqueIndex: 43 }, { ...previous, status: "Deleted" }]
      .map(task => ({ ok: true, status: 200, json: async () => task })),
    { ok: true, status: 200, json: async () => { throw new SyntaxError("Invalid JSON"); } },
  ]) {
    global.fetch = async () => response;
    await assert.rejects(refresh.refreshTaskDetailQueryCache({ queryClient: h.client, taskId: 42, readQueryKey: queryKey,
      fetchTask: signal => reads.fetchScopedTaskDetail(42, 15, 42, signal, { cache: "no-store", credentials: "same-origin" }) }));
    assert.equal(h.client.getQueryData(queryKey), previous);
  }
});

test("flag-off detail query options and fetch behavior match production after helper reuse", async t => {
  const h = harness(t, false), captured = [];
  h.mocks["@tanstack/react-query"].useQuery = options => { captured.push(options); return { data: options.initialData }; };
  h.embedded();
  const production = require("node:child_process").execFileSync("git", ["show", "origin/production:src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx"], { cwd: root, encoding: "utf8" });
  h.embedded(production);
  const { queryFn: actualFn, ...actualOptions } = captured[0];
  const { queryFn: expectedFn, ...expectedOptions } = captured[2];
  assert.deepEqual(actualOptions, expectedOptions);
  const signal = new AbortController().signal, requests = [];
  for (const response of [
    { ok: true, status: 200, json: async () => h.task() },
    { ok: false, status: 500 },
    { ok: false, status: 403 },
    { ok: true, status: 200, json: async () => null },
  ]) {
    global.fetch = async (...args) => { requests.push(args); return response; };
    const result = async fn => { try { return await fn({ signal }); } catch (error) { return { name: error.name, message: error.message }; } };
    assert.deepEqual(await result(actualFn), await result(expectedFn));
    assert.deepEqual(requests.at(-2), requests.at(-1));
    assert.deepEqual(requests.at(-1)[1], { signal }, "legacy requests retain production's default cache behavior");
  }
});

test("board prefetch and detail mount share full task, existing comments and metadata reads, including late field mounts", async t => {
  const h = harness(t, process.env.HTPR_7009_NEGATIVE_CONTROL !== "1");
  h.prefetch([{ id: 42, projectId: 15, uniqueIndex: 42 }, { id: 43, projectId: 15, uniqueIndex: 43 }]);
  await settle();
  h.embedded();
  h.comments();
  for (const field of ["priority", "estimate", "labels", "followers"]) h.field(field);
  await settle();
  assert.deepEqual(h.counts, { task: 2, comments: 2, meta: 2, single: 0 }, "one read of each scoped resource for each adjacent task, with no follow-up on mount");
});

test("direct fresh comments seed needs no read and staggered metadata observers share one request", async t => {
  const h = harness(t);
  h.comments({ comments: [1], updatedAt: Date.now() });
  h.field("followers");
  await settle();
  for (const field of ["priority", "estimate", "labels"]) h.field(field);
  await settle();
  assert.equal(h.counts.comments, 0);
  assert.equal(h.counts.meta, 1);
  assert.deepEqual(h.client.getQueryData(["taskLabels", 42]), [1]);
});

test("account changes clear unscoped comments and metadata at the existing QueryClient boundary", async t => {
  const h = harness(t);
  h.prefetch([{ id: 42, projectId: 15, uniqueIndex: 42 }]);
  await settle();
  h.client.clear(); h.user(986); h.version(2);
  h.prefetch([{ id: 42, projectId: 15, uniqueIndex: 42 }]);
  await settle();
  assert.deepEqual(h.counts, { task: 2, comments: 2, meta: 2, single: 0 });
  assert.equal(h.client.getQueryData(reads.taskDetailReadKey(985, 42)), undefined);
  assert.equal(h.client.getQueryData(reads.taskDetailReadKey(986, 42)).title, "Task 2");
  assert.deepEqual(h.client.getQueryData([constants.CommentsTQPrefixKey, 42]).comments, [2]);
  assert.deepEqual(h.client.getQueryData(["taskLabels", 42]), [2]);
});

test("legacy exact readers and post-write writers share the flag-on metadata cache", async t => {
  const h = harness(t);
  h.prefetch([{ id: 42, projectId: 15, uniqueIndex: 42 }]); await settle();
  for (const [prefix, value] of [["priority", 1], ["estimate", 1], ["taskLabels", [1]], ["followersFor:", [1]]]) {
    assert.deepEqual(h.client.getQueryData([prefix, 42]), value, `${prefix} exact legacy reader must see prefetch`);
    assert.equal(h.client.getQueryData([prefix, 42, 985]), undefined, "no split user-scoped satellite cache");
    h.client.setQueryData([prefix, 42], Array.isArray(value) ? [2] : 2);
  }
  for (const field of ["priority", "estimate", "labels", "followers"]) h.field(field);
  await settle();
  assert.equal(h.counts.meta, 1, "mount uses legacy post-write data without reading again");
  assert.equal(h.client.getQueryData(["priority", 42]), 2, "command modal reader retains the new priority");
  assert.equal(h.client.getQueryData(["estimate", 42]), 2, "command modal reader retains the new estimate");
  assert.deepEqual(h.client.getQueryData(["followersFor:", 42]), [2], "board-card unfollow has its followers array");
});

test("legacy comment mutations and realtime refresh use the same flag-on exact key", async t => {
  const h = harness(t);
  h.prefetch([{ id: 42, projectId: 15, uniqueIndex: 42 }]); await settle();
  const key = [constants.CommentsTQPrefixKey, 42];
  h.client.setQueryData(key, { comments: ["posted"] });
  assert.deepEqual(h.comments().data.comments, ["posted"]);
  h.version(2);
  await commentsRefresh.refreshTaskComments(h.client, 42);
  assert.deepEqual(h.client.getQueryData(key).comments, [2]);
  assert.equal(h.counts.comments, 2);
  assert.equal(h.client.getQueryData([...key, 985]), undefined);
});

test("post-write refetch refreshes metadata and stale mount/focus policy remains enabled", async t => {
  const h = harness(t);
  h.field("labels"); await settle(); h.version(2);
  await h.client.refetchQueries({ queryKey: ["taskLabels", 42] });
  assert.equal(h.counts.meta, 2);
  assert.deepEqual(h.client.getQueryData(["taskLabels", 42]), [2]);
  assert.equal(reads.shouldRefetchDetailOnMount({ state: { dataUpdatedAt: Date.now(), isInvalidated: true } }), true);
  assert.equal(reads.shouldRefetchDetailOnMount({ state: { dataUpdatedAt: Date.now() - 31_000, isInvalidated: false } }), true);
});

test("realtime events, same-user multi-tab edits, reconnect and PR subscription still refetch", async t => {
  const h = harness(t);
  h.prefetch([{ id: 42, projectId: 15, uniqueIndex: 42 }]); await settle();
  h.comments(); h.field("labels"); await settle();
  const channelHandlers = new Map(), connectionHandlers = new Map();
  const channel = { subscribed: false, bind: (event, fn) => channelHandlers.set(event, fn), unbind: event => channelHandlers.delete(event) };
  const client = { allChannels: () => [{ name: "private-task-42" }], subscribe: () => channel, unsubscribe() {}, connection: { state: "connected", bind: (event, fn) => connectionHandlers.set(event, fn), unbind: event => connectionHandlers.delete(event) } };
  const hook = load("src/hooks/realtime/useTaskCommentsRealtime.ts", { ...h.mocks,
    "@/lib/realtime/client": { connectRealtimeClient: async () => client, releaseRealtimeClientIfIdle() {} },
    "@/lib/realtime/taskDetailRefresh": refresh,
    "@/lib/realtime/taskCommentsRefresh": commentsRefresh,
  });
  let current = h.task();
  hook.useTaskCommentsRealtime(42, { currentUserId: 985, taskProjectId: 15, taskUniqueIndex: 42, setCurrentTask: update => { current = update(current); }, hasPullRequests: true });
  await settle();
  const initial = h.counts.task;
  channelHandlers.get("pusher:subscription_succeeded")(); await settle();
  assert.ok(h.counts.task > initial, "PR refresh before subscribe must still reconcile");
  for (const event of ["task:changed", "comment:changed"]) {
    const previous = { ...h.counts }; h.version(3);
    channelHandlers.get(event)({ originUserId: 985 }); await settle();
    assert.ok(h.counts.task > previous.task);
    assert.ok(h.counts.comments > previous.comments);
    assert.ok(h.counts.meta > previous.meta);
    assert.equal(current.title, "Task 3");
  }
  const previous = { ...h.counts }; h.version(4);
  connectionHandlers.get("connected")(); await settle();
  assert.ok(h.counts.task > previous.task);
  assert.ok(h.counts.comments > previous.comments);
  assert.equal(current.title, "Task 4");
});

test("rebased readiness retains production's no-loading-flash guard when dedupe is off", () => {
  const file = "src/app/detail/[...slug]/useTaskDetailReadiness.tsx";
  const production = require("node:child_process").execFileSync("git", ["show", `origin/production:${file}`], { cwd: root, encoding: "utf8" });
  const refreshDecision = source => new Function("flagReady", "dedupe", "noLoadingFlash", "cachedLayout", "window", "_parsedTask",
    `return ${source.match(/getTask\(([^;]+)\);/)[1]}`);
  const actual = refreshDecision(fs.readFileSync(path.join(root, file), "utf8"));
  const expected = refreshDecision(production);
  for (const noLoadingFlash of [false, true]) for (const cachedLayout of [false, true]) for (const cachedTaskId of [undefined, 42, 43]) {
    const args = [noLoadingFlash, cachedLayout, { history: { state: { cachedTaskDetail: { taskId: cachedTaskId } } } }, { id: 42 }];
    assert.equal(actual(true, false, ...args), expected(true, false, ...args));
    assert.equal(actual(true, true, ...args), false);
    assert.equal(actual(false, false, ...args), false);
  }
});

for (const pending of [false, true]) {
  test(`initial unavailable realtime reuses the board read (${pending ? "pending" : "fresh"}) but periodic reconciliation still refreshes`, async t => {
    const h = harness(t);
    let release;
    if (pending) global.fetch = () => {
      h.counts.task++;
      return new Promise(resolve => { release = () => resolve({ ok: true, status: 200, json: async () => h.task() }); });
    };
    h.prefetch([{ id: 42, projectId: 15, uniqueIndex: 42 }]);
    if (!pending) await settle();
    h.embedded(); h.comments(); h.field("labels");
    global.window.history = { state: { cachedTaskDetail: { taskId: 42 } } };
    const hook = load("src/hooks/realtime/useTaskCommentsRealtime.ts", { ...h.mocks,
      "@/lib/realtime/client": { connectRealtimeClient: async () => null, releaseRealtimeClientIfIdle() {} },
      "@/lib/realtime/taskDetailRefresh": refresh,
      "@/lib/realtime/taskCommentsRefresh": commentsRefresh,
    });
    hook.useTaskCommentsRealtime(42, { currentUserId: 985, taskProjectId: 15, taskUniqueIndex: 42 });
    await settle();
    assert.deepEqual(h.counts, { task: 1, comments: 1, meta: 1, single: 0 }, "startup must not cancel or repeat the board read");
    if (pending) { release(); await settle(); }
    global.fetch = async () => { h.counts.task++; return { ok: true, status: 200, json: async () => h.task() }; };
    h.version(2); h.tick(); await settle();
    assert.deepEqual(h.counts, { task: 2, comments: 2, meta: 2, single: 0 }, "unhealthy realtime still reconciles on its next cycle");
    assert.equal(h.client.getQueryData(reads.taskDetailReadKey(985, 42)).title, "Task 2");
  });
}

test("initial unavailable direct read does not invalidate freshly mounted metadata; later reconciliation does", async t => {
  const h = harness(t);
  h.client.setQueryData(reads.taskDetailReadKey(985, 42), h.task());
  h.comments({ comments: [1], updatedAt: Date.now() }); h.field("labels"); await settle();
  global.window.history = { state: {} };
  const hook = load("src/hooks/realtime/useTaskCommentsRealtime.ts", { ...h.mocks,
    "@/lib/realtime/client": { connectRealtimeClient: async () => null, releaseRealtimeClientIfIdle() {} },
    "@/lib/realtime/taskDetailRefresh": refresh,
    "@/lib/realtime/taskCommentsRefresh": commentsRefresh,
  });
  hook.useTaskCommentsRealtime(42, { currentUserId: 985, taskProjectId: 15, taskUniqueIndex: 42 });
  await settle();
  assert.deepEqual(h.counts, { task: 1, comments: 1, meta: 1, single: 0 });
  h.version(2); h.tick(); await settle();
  assert.deepEqual(h.counts, { task: 2, comments: 2, meta: 2, single: 0 });
  assert.deepEqual(h.client.getQueryData(["taskLabels", 42]), [2]);
});

test("unavailable realtime mounted hidden still invalidates metadata when it first reconciles", async t => {
  const h = harness(t);
  h.comments({ comments: [1], updatedAt: Date.now() }); h.field("labels"); await settle();
  global.document.visibilityState = "hidden";
  global.window.history = { state: {} };
  const hook = load("src/hooks/realtime/useTaskCommentsRealtime.ts", { ...h.mocks,
    "@/lib/realtime/client": { connectRealtimeClient: async () => null, releaseRealtimeClientIfIdle() {} },
    "@/lib/realtime/taskDetailRefresh": refresh,
    "@/lib/realtime/taskCommentsRefresh": commentsRefresh,
  });
  hook.useTaskCommentsRealtime(42, { currentUserId: 985, taskProjectId: 15, taskUniqueIndex: 42 });
  await settle();
  assert.deepEqual(h.counts, { task: 0, comments: 0, meta: 1, single: 0 });
  global.document.visibilityState = "visible";
  h.version(2); h.tick(); await settle();
  assert.deepEqual(h.counts, { task: 1, comments: 1, meta: 2, single: 0 });
  assert.deepEqual(h.client.getQueryData(["taskLabels", 42]), [2]);
});

for (const entry of ["direct", "stale", "invalidated", "off"]) {
  test(`initial unavailable realtime still refreshes ${entry} opens`, async t => {
    const h = harness(t, entry !== "off");
    const key = reads.taskDetailReadKey(985, 42);
    if (entry !== "off") h.client.setQueryData(key, h.task(), { updatedAt: entry === "stale" ? Date.now() - 31_000 : Date.now() });
    if (entry === "invalidated") await h.client.invalidateQueries({ queryKey: key, exact: true });
    global.window.history = { state: entry === "direct" ? {} : { cachedTaskDetail: { taskId: 42 } } };
    const hook = load("src/hooks/realtime/useTaskCommentsRealtime.ts", { ...h.mocks,
      "@/lib/realtime/client": { connectRealtimeClient: async () => null, releaseRealtimeClientIfIdle() {} },
      "@/lib/realtime/taskDetailRefresh": refresh,
      "@/lib/realtime/taskCommentsRefresh": commentsRefresh,
    });
    hook.useTaskCommentsRealtime(42, { currentUserId: 985, taskProjectId: 15, taskUniqueIndex: 42 });
    await settle();
    assert.equal(h.counts.task, 1);
  });
}

test("resolved flag-off metadata options and fetch results match origin/production exactly", async () => {
  const mocks = {
    "@tanstack/react-query": { useQuery: options => options, useQueryClient: () => ({}) },
    "@/hooks/useFlag": { useFlag: () => false, useFlagReady: () => true },
    "@/hooks/General/useAuth": { useAuth: () => ({ authenticatedUserId: 985 }) },
    "@/utils/api/global": { __esModule: true, default: { getPriorityForTask: async () => "priority", getEstimateForTask: async () => "estimate", getAllTaskLabels: async () => ["label"] } },
    "@/utils/api/Task Detail": { getAllFollowers: async () => ["follower"] },
  };
  mocks["@/hooks/Task Detail/useTaskDetailMetaField"] = load("src/hooks/Task Detail/useTaskDetailMetaField.ts", mocks);
  for (const [file, hook, args] of [
    ["src/hooks/MultiPages/useGetPriorityForTask.ts", "useGetPriorityForTask", [["priority", 42], 42]],
    ["src/hooks/MultiPages/useGetEstimateForTask.ts", "useGetEstimateForTask", [["estimate", 42], 42]],
    ["src/hooks/MultiPages/useGetAllTaskLabels.ts", "useGetAllTaskLabels", [42]],
    ["src/hooks/Task Detail/useGetFollowers.ts", "useGetAllFollowers", [["followersFor:", 42], 42]],
  ]) {
    const production = require("node:child_process").execFileSync("git", ["show", `origin/production:${file}`], { cwd: root, encoding: "utf8" });
    for (const initial of [undefined, null, { value: "seed" }]) {
      const actual = load(file, mocks)[hook](...args, initial);
      const expected = load(file, mocks, production)[hook](...args, initial);
      const { queryFn: actualFn, ...actualOptions } = actual;
      const { queryFn: expectedFn, ...expectedOptions } = expected;
      assert.deepEqual(actualOptions, expectedOptions, `${hook} preserves all production options`);
      assert.deepEqual(await actualFn(), await expectedFn());
    }
  }
});

test("flag off keeps legacy task prefetch and repeated metadata mount reads", async t => {
  const h = harness(t, false);
  h.prefetch([{ id: 42, projectId: 15, uniqueIndex: 42 }]); await settle();
  h.field("followers"); await settle();
  assert.equal(h.counts.single, 1);
  assert.equal(h.client.getQueryData(reads.taskDetailReadKey(985, 42)), undefined);
  assert.deepEqual(h.client.getQueryData([constants.CommentsTQPrefixKey, 42]).comments, [1]);
  assert.ok(h.counts.meta >= 2);
});

test("prefetch and mount share a still-pending task read, not only a completed cache entry", async t => {
  const h = harness(t);
  let release;
  global.fetch = () => { h.counts.task++; return new Promise(resolve => { release = () => resolve({ ok: true, status: 200, json: async () => h.task() }); }); };
  h.prefetch([{ id: 42, projectId: 15, uniqueIndex: 42 }]);
  h.embedded();
  h.comments(); h.field("followers");
  await settle();
  assert.equal(h.counts.task, 1);
  assert.equal(h.counts.meta, 1);
  assert.equal(h.counts.comments, 1);
  release(); await settle();
  assert.equal(h.client.getQueryData(reads.taskDetailReadKey(985, 42)).title, "Task 1");
});

test("a real metadata refresh aborts a pre-write request before caching the changed response", async t => {
  const h = harness(t);
  let first = true, aborted = false;
  axios.get = (_url, { signal }) => {
    h.counts.meta++;
    if (!first) return Promise.resolve({ data: h.meta() });
    first = false;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }));
  };
  const pending = reads.fetchTaskDetailMeta(h.client, 42).catch(() => null);
  h.version(2);
  await reads.fetchTaskDetailMeta(h.client, 42, true);
  await pending;
  assert.equal(aborted, true);
  assert.equal(h.counts.meta, 2);
  assert.deepEqual(h.client.getQueryData(["taskLabels", 42]), [2]);
});


test("unresolved metadata flags do not seed fake-fresh legacy arrays before a flag-on mount", async t => {
  const h = harness(t);
  h.ready(false);
  h.mocks["@/hooks/useFlag"].useFlag = () => false;
  for (const field of ["labels", "followers"]) assert.deepEqual(h.field(field).data, []);
  await settle();
  assert.equal(h.counts.meta, 0);
  for (const prefix of ["taskLabels", "followersFor:"]) {
    assert.deepEqual(h.client.getQueryData([prefix, 42]), []);
    assert.equal(h.client.getQueryState([prefix, 42]).status, "success");
    assert.equal(h.client.getQueryState([prefix, 42]).dataUpdatedAt, 0);
  }
  h.ready(true);
  h.mocks["@/hooks/useFlag"].useFlag = () => true;
  for (const field of ["labels", "followers"]) h.field(field);
  await settle();
  assert.equal(h.counts.meta, 1);
  assert.deepEqual(h.client.getQueryData(["taskLabels", 42]), [1]);
  assert.deepEqual(h.client.getQueryData(["followersFor:", 42]), [1]);
});

test("initial reads wait for the flag decision instead of fetching under the temporary Off key", async t => {
  const h = harness(t);
  h.ready(false);
  h.prefetch([{ id: 42, projectId: 15, uniqueIndex: 42 }]);
  h.embedded(); h.field("followers");
  await settle();
  assert.deepEqual(h.counts, { task: 0, comments: 0, meta: 0, single: 0 });
  h.ready(true);
  h.prefetch([{ id: 42, projectId: 15, uniqueIndex: 42 }]);
  h.embedded(); h.comments(); h.field("followers");
  await settle();
  assert.deepEqual(h.counts, { task: 1, comments: 1, meta: 1, single: 0 });
});


for (const [state, expected] of [[undefined, "false:false"], [false, "true:false"], [true, "true:true"], ["failure", "true:false"]]) {
  test(`actual flag readiness distinguishes unresolved, Off, On and failed flags (${state})`, () => {
    const React = require("react");
    const { renderToString } = require("react-dom/server");
    const key = "htpr-7009-dedupe-task-detail-reads";
    const flags = load("src/hooks/useFlag.tsx", {
      "@tanstack/react-query": { useQueryClient: () => ({}), useQuery: () => ({ data: typeof state === "boolean" ? { [key]: state } : undefined, isError: state === "failure" }) },
      "@/hooks/General/useHydrated": { useHydrated: () => true },
      "@/lib/realtime/client": {},
    });
    const View = () => React.createElement("span", null, `${flags.useFlagReady(key)}:${flags.useFlag(key)}`);
    assert.equal(renderToString(React.createElement(flags.FeatureFlagProvider, { userId: 985 }, React.createElement(View))), `<span>${expected}</span>`);
    assert.equal(renderToString(React.createElement(View)), "<span>true:false</span>", "public/share has no flag provider and must retain legacy reads");
  });
}
