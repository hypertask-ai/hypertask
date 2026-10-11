const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const { createJiti } = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  moduleCache: false,
});

const {
  reconcileActiveBoardQuery,
  reconcileActiveBoardTasks,
} = jiti(
  path.join(root, "src/lib/boardSync/reconcileActiveBoardQuery.ts"),
);
const {
  createBoardRealtimeEventHandler,
} = jiti(
  path.join(root, "src/lib/realtime/boardRealtimeEventHandler.ts"),
);

const USER_ID = 6;
const PROJECT_ID = 15;
const PROJECTS_ALL_KEY = ["projectsAll"];

function loadTypeScriptModule(filename, stubs) {
  const source = fs.readFileSync(filename, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} };
  const localRequire = (request) => stubs[request] ?? require(request);

  new Function(
    "module",
    "exports",
    "require",
    "__filename",
    "__dirname",
    javascript,
  )(
    loadedModule,
    loadedModule.exports,
    localRequire,
    filename,
    path.dirname(filename),
  );
  return loadedModule.exports;
}

function createBindingTarget(properties = {}) {
  const bindings = new Map();
  return {
    ...properties,
    bind(event, callback) {
      const callbacks = bindings.get(event) ?? new Set();
      callbacks.add(callback);
      bindings.set(event, callbacks);
    },
    emit(event, payload) {
      for (const callback of bindings.get(event) ?? []) callback(payload);
    },
    unbind(event, callback) {
      bindings.get(event)?.delete(callback);
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

const changedPayload = {
  project: { id: PROJECT_ID, name: "Renamed by someone else" },
  tasks: [{ id: 900, title: "Changed on another device" }],
  allViews: [],
};

const buildProjects = () => [
  { id: 7, name: "Another board", section: [], tasks: [{ id: 1 }] },
  { id: PROJECT_ID, name: "Product board", section: [], tasks: [{ id: 2 }] },
  { id: 22, name: "Third board", section: [], tasks: [{ id: 3 }] },
];

const buildQueryClient = (
  projects,
  accountId = USER_ID,
  { fetchShouldThrow = false } = {},
) => {
  const operations = [];
  let cached =
    projects === null
      ? undefined
      : { accountId, updatedProjects: projects };
  return {
    operations,
    cachedProjects: () => cached?.updatedProjects,
    queryClient: {
      fetchQuery: async ({ queryKey }) => {
        operations.push(["fetch", queryKey]);
        if (fetchShouldThrow) throw new Error("forbidden");
        return changedPayload;
      },
      cancelQueries: async (filters) => {
        operations.push(["cancel", filters.queryKey]);
      },
      getQueryData: (queryKey) =>
        queryKey[0] === PROJECTS_ALL_KEY[0] ? cached : undefined,
      setQueryData: (queryKey, value) => {
        if (queryKey[0] !== PROJECTS_ALL_KEY[0]) return;
        cached = typeof value === "function" ? value(cached) : value;
      },
      invalidateQueries: async (filters) => {
        operations.push(["invalidate", filters]);
      },
      refetchQueries: async (filters) => {
        operations.push(["refetch", filters.queryKey]);
      },
    },
  };
};

test("a board change event fetches only that board, never the whole project list", async () => {
  const { queryClient, operations } = buildQueryClient(buildProjects());

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  assert.deepEqual(operations, [
    ["cancel", ["boardTasks", USER_ID, PROJECT_ID]],
    ["fetch", ["boardTasks", USER_ID, PROJECT_ID]],
  ]);
});

test("a board change cancels the in-flight board query before fetching", async () => {
  const { queryClient, operations } = buildQueryClient(buildProjects());

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  assert.deepEqual(operations[0], ["cancel", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.deepEqual(operations[1], ["fetch", ["boardTasks", USER_ID, PROJECT_ID]]);
});

test("a board change event patches only the changed project into the account list", async () => {
  const { queryClient, cachedProjects } = buildQueryClient(buildProjects());
  const before = cachedProjects();

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  const after = cachedProjects();
  assert.equal(after.length, before.length);
  assert.equal(after[1].name, "Renamed by someone else");
  assert.deepEqual(after[1].tasks, changedPayload.tasks);
  assert.equal(after[0], before[0]);
  assert.equal(after[2], before[2]);
});

test("a board change with no account list falls back to the full reconcile", async () => {
  const { queryClient, operations } = buildQueryClient(null);

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  assert.deepEqual(operations[0], ["cancel", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.deepEqual(operations[1], ["fetch", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.equal(
    operations[2][1].predicate({
      queryKey: ["boardTasks", USER_ID, PROJECT_ID],
    }),
    true,
  );
  assert.deepEqual(operations[3], ["refetch", PROJECTS_ALL_KEY]);
});

test("a board missing from the account list falls back to the full reconcile", async () => {
  const { queryClient, operations } = buildQueryClient([
    { id: 7, name: "Another board", section: [], tasks: [] },
  ]);

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  assert.deepEqual(operations[0], ["cancel", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.deepEqual(operations[1], ["fetch", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.deepEqual(operations[3], ["refetch", PROJECTS_ALL_KEY]);
});

test("a cache with no account id never accepts a scoped patch", async () => {
  const { queryClient, operations, cachedProjects } = buildQueryClient(
    buildProjects(),
    null,
  );
  const before = cachedProjects();

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  assert.equal(cachedProjects()[1], before[1]);
  assert.deepEqual(operations[0], ["cancel", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.deepEqual(operations[1], ["fetch", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.deepEqual(operations[3], ["refetch", PROJECTS_ALL_KEY]);
});

test("a response fetched under another account never patches the current list", async () => {
  const { queryClient, operations } = buildQueryClient(buildProjects(), 99);

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  assert.deepEqual(operations[0], ["cancel", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.deepEqual(operations[1], ["fetch", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.deepEqual(operations[3], ["refetch", PROJECTS_ALL_KEY]);
});

test("a rejected board fetch falls back to the full reconcile", async () => {
  const { queryClient, operations } = buildQueryClient(buildProjects(), USER_ID, {
    fetchShouldThrow: true,
  });

  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID);

  assert.deepEqual(operations[0], ["cancel", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.deepEqual(operations[1], ["fetch", ["boardTasks", USER_ID, PROJECT_ID]]);
  assert.deepEqual(operations[3], ["refetch", PROJECTS_ALL_KEY]);
});

test("the full reconcile still expires the board snapshot and refetches the list", async () => {
  const { queryClient, operations } = buildQueryClient(buildProjects());

  await reconcileActiveBoardQuery(queryClient, PROJECT_ID);

  assert.equal(
    operations[0][1].predicate({
      queryKey: ["boardTasks", USER_ID, PROJECT_ID],
    }),
    true,
  );
  assert.deepEqual(operations[1], ["refetch", PROJECTS_ALL_KEY]);
});

test("useBoardRealtime still wires the extracted handler and scoped route", () => {
  const source = require("fs").readFileSync(
    path.join(root, "src/hooks/realtime/useBoardRealtime.ts"),
    "utf8",
  );
  assert.match(source, /createBoardRealtimeEventHandler/);
  assert.doesNotMatch(source, /useFlag|SCOPED_BOARD_REFETCH_FLAG|eventReconcileRef/);
  assert.match(source, /trigger === "event" &&\s+userId !== undefined\s+\? runScopedReconcile\(userId\)/);
  assert.match(source, /reconcileActiveBoardTasks/);
});

test("create, move, and archive board events each trigger reconciliation", () => {
  const reconciliations = [];
  const onBoardEvent = createBoardRealtimeEventHandler((trigger) => {
    reconciliations.push(trigger);
  });

  onBoardEvent({ action: "create" });
  onBoardEvent({ action: "move" });
  onBoardEvent({ action: "archive" });

  assert.deepEqual(reconciliations, ["event", "event", "event"]);
});

test("an event missed during initial connection is recovered after subscription", async () => {
  let cleanup;
  let resolveClient;
  let renderedTasks = ["before"];
  let serverTasks = renderedTasks;
  let boardReconciles = 0;
  const planningRefetches = [];
  const channel = createBindingTarget({ subscribed: false });
  const connection = createBindingTarget({ state: "connecting" });
  const client = {
    connection,
    subscribe: () => channel,
    unsubscribe() {},
  };
  const clientPromise = new Promise((resolve) => {
    resolveClient = resolve;
  });
  const queryClient = {
    refetchQueries: async (options) => {
      planningRefetches.push(options);
    },
  };
  const hook = loadTypeScriptModule(
    path.join(root, "src/hooks/realtime/useBoardRealtime.ts"),
    {
      react: {
        useEffect(effect) {
          cleanup = effect();
        },
        useRef(initialValue) {
          return { current: initialValue };
        },
      },
      "@tanstack/react-query": { useQueryClient: () => queryClient },
      "@/lib/realtime/client": {
        connectRealtimeClient: () => clientPromise,
        releaseRealtimeClientIfIdle() {},
      },
      "@/lib/projectPlanning": {
        projectPlanningQueryKey: (projectId) => ["planning", projectId],
      },
      "@/lib/realtime/shared": {
        BOARD_EVENT: "board:changed",
        boardChannel: (projectId) => `private-board-${projectId}`,
      },
      "@/lib/boardSync/reconcileActiveBoardQuery": {
        reconcileActiveBoardQuery: async () => {
          boardReconciles += 1;
          renderedTasks = serverTasks;
        },
        reconcileActiveBoardTasks: async () => {},
      },
      "@/lib/realtime/latencyCanary": {
        runRealtimeReconciliation: ({ reconcile }) => reconcile(),
      },
      "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => null },
      "@/lib/firstScreen/boardDocument": { getBoardDocument: () => null },
      "@/lib/realtime/boardRealtimeEventHandler": {
        createBoardRealtimeEventHandler: (refetch) => () => refetch("event"),
      },
    },
  );

  hook.useBoardRealtime(PROJECT_ID, { accountId: USER_ID });
  serverTasks = ["created while connecting"];
  resolveClient(client);
  await settle();

  assert.deepEqual(renderedTasks, ["before"]);
  connection.state = "connected";
  connection.emit("connected");
  channel.subscribed = true;
  channel.emit("pusher:subscription_succeeded");
  await settle();

  assert.deepEqual(renderedTasks, ["created while connecting"]);
  assert.equal(boardReconciles, 1);
  assert.deepEqual(planningRefetches, [
    { exact: true, queryKey: ["planning", PROJECT_ID] },
  ]);

  channel.emit("pusher:subscription_succeeded");
  await settle();
  assert.equal(boardReconciles, 1);
  cleanup?.();
});

test("the visible board subscribes before deferred startup work is released", () => {
  const source = fs.readFileSync(
    path.join(
      root,
      "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx",
    ),
    "utf8",
  );
  const subscription = source.match(/useBoardRealtime\([\s\S]*?\);/u)?.[0];
  const hook = require("fs").readFileSync(
    path.join(root, "src/hooks/realtime/useBoardRealtime.ts"),
    "utf8",
  );

  assert.ok(subscription, "the board must mount its realtime subscription");
  assert.doesNotMatch(subscription, /enabled\s*:/u);
  assert.doesNotMatch(hook, /options\?\.enabled/u);
});

function mountFallbackHook(t, { connect, queryClient, accountId = USER_ID } = {}) {
  let cleanup;
  const timers = new Map();
  const listeners = new Map();
  const originals = {
    setInterval: global.setInterval,
    clearInterval: global.clearInterval,
    document: global.document,
    window: global.window,
    navigator: Object.getOwnPropertyDescriptor(global, "navigator"),
  };
  global.setInterval = (callback, delay) => {
    assert.equal(delay, 10_000);
    timers.set(callback, callback);
    return callback;
  };
  global.clearInterval = (id) => timers.delete(id);
  const target = (name, properties = {}) => ({
    ...properties,
    addEventListener: (event, callback) => listeners.set(`${name}:${event}`, callback),
    removeEventListener: (event) => listeners.delete(`${name}:${event}`),
  });
  global.document = target("document", { visibilityState: "visible" });
  global.window = target("window");
  Object.defineProperty(global, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  t.after(() => {
    cleanup?.();
    global.setInterval = originals.setInterval;
    global.clearInterval = originals.clearInterval;
    global.document = originals.document;
    global.window = originals.window;
    if (originals.navigator) Object.defineProperty(global, "navigator", originals.navigator);
    else delete global.navigator;
  });
  const hook = loadTypeScriptModule(
    path.join(root, "src/hooks/realtime/useBoardRealtime.ts"),
    {
      react: {
        useEffect: (effect) => { cleanup = effect(); },
        useRef: (initialValue) => ({ current: initialValue }),
      },
      "@tanstack/react-query": { useQueryClient: () => queryClient },
      "@/lib/realtime/client": {
        connectRealtimeClient: connect ?? (async () => null),
        releaseRealtimeClientIfIdle() {},
      },
      "@/lib/projectPlanning": { projectPlanningQueryKey: (id) => ["planning", id] },
      "@/lib/realtime/shared": {
        BOARD_EVENT: "board:changed",
        boardChannel: (id) => `private-board-${id}`,
      },
      "@/lib/boardSync/reconcileActiveBoardQuery": {
        reconcileActiveBoardQuery,
        reconcileActiveBoardTasks,
      },
      "@/lib/realtime/latencyCanary": {
        runRealtimeReconciliation: ({ reconcile }) => reconcile(),
      },
      "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => null },
      "@/lib/firstScreen/boardDocument": { getBoardDocument: () => null },
      "@/lib/realtime/boardRealtimeEventHandler": { createBoardRealtimeEventHandler },
    },
  );
  hook.useBoardRealtime(PROJECT_ID, { accountId });
  return {
    timers,
    listeners,
    tick: () => { for (const callback of timers.values()) callback(); },
    cleanup: () => cleanup?.(),
  };
}

test("unavailable realtime silently updates only the visible board without a flag", async (t) => {
  const { queryClient, operations, cachedProjects } = buildQueryClient(buildProjects());
  const before = cachedProjects();
  const harness = mountFallbackHook(t, { queryClient });
  await settle();
  assert.deepEqual(operations, [], "startup must reuse the initial board load");
  assert.equal(cachedProjects(), before);
  harness.tick();
  await settle();
  assert.deepEqual(cachedProjects()[1].tasks, changedPayload.tasks);
  assert.equal(cachedProjects()[0], before[0]);
  assert.equal(cachedProjects()[2], before[2]);
  assert.equal(harness.timers.size, 1);
  operations.length = 0;
  harness.tick();
  await settle();
  assert.deepEqual(operations, [
    ["cancel", ["boardTasks", USER_ID, PROJECT_ID]],
    ["refetch", ["planning", PROJECT_ID]],
    ["fetch", ["boardTasks", USER_ID, PROJECT_ID]],
  ]);
  harness.cleanup();
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.listeners.size, 0);
});

test("fallback pauses while hidden or offline and resumes when visible and online", async (t) => {
  const { queryClient, operations } = buildQueryClient(buildProjects());
  const harness = mountFallbackHook(t, { queryClient });
  await settle();
  operations.length = 0;
  global.document.visibilityState = "hidden";
  harness.tick();
  await settle();
  assert.deepEqual(operations, []);
  global.document.visibilityState = "visible";
  global.navigator.onLine = false;
  harness.tick();
  await settle();
  assert.deepEqual(operations, []);
  global.navigator.onLine = true;
  harness.listeners.get("window:online")();
  await settle();
  assert.equal(operations.filter(([op]) => op === "fetch").length, 1);
});

test("slow fallback requests never overlap or queue a refresh on every timer tick", async (t) => {
  const { queryClient, operations } = buildQueryClient(buildProjects());
  let finishFetch;
  let fetches = 0;
  queryClient.fetchQuery = () => {
    fetches += 1;
    return new Promise((resolve) => { finishFetch = resolve; });
  };
  const harness = mountFallbackHook(t, { queryClient });
  await settle();
  harness.tick();
  harness.tick();
  await settle();
  assert.equal(fetches, 1);
  finishFetch(changedPayload);
  await settle();
  assert.equal(fetches, 1);
  assert.ok(!operations.some(([op, key]) => op === "refetch" && key[0] === "projectsAll"));
});

test("failed subscriptions retry and stop fallback only after server confirmation", async (t) => {
  const { queryClient, operations } = buildQueryClient(buildProjects());
  const channel = createBindingTarget({ subscribed: false });
  const connection = createBindingTarget({ state: "connected" });
  let subscribes = 0;
  let unsubscribes = 0;
  const harness = mountFallbackHook(t, {
    queryClient,
    connect: async () => {
      if (connection.state === "unavailable") connection.state = "connecting";
      return {
        connection,
        subscribe() { subscribes += 1; return channel; },
        unsubscribe() { unsubscribes += 1; channel.subscribed = false; },
      };
    },
  });
  await settle();
  channel.emit("pusher:subscription_error");
  await settle();
  assert.equal(unsubscribes, 1);
  assert.equal(harness.timers.size, 1);
  assert.equal(subscribes, 2);
  channel.subscribed = true;
  channel.emit("pusher:subscription_succeeded");
  await settle();
  assert.equal(harness.timers.size, 0);
  assert.ok(operations.some(([op, key]) => op === "refetch" && key[0] === "projectsAll"));
  operations.length = 0;
  harness.tick();
  await settle();
  assert.deepEqual(operations, []);
  connection.state = "unavailable";
  connection.emit("state_change", { current: "unavailable" });
  await settle();
  assert.equal(harness.timers.size, 1);
  assert.equal(unsubscribes, 2);
});


test("a transient background board fetch failure keeps the existing board painted", async () => {
  const { queryClient, operations, cachedProjects } = buildQueryClient(buildProjects(), USER_ID, {
    fetchShouldThrow: true,
  });
  const before = cachedProjects();
  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID, { background: true });
  assert.equal(cachedProjects(), before);
  assert.deepEqual(operations, [
    ["cancel", ["boardTasks", USER_ID, PROJECT_ID]],
    ["fetch", ["boardTasks", USER_ID, PROJECT_ID]],
  ]);
});

test("a background poll re-proves board access after a forbidden response", async () => {
  const { queryClient, operations } = buildQueryClient(buildProjects());
  queryClient.fetchQuery = async () => { throw { response: { status: 403 } }; };
  await reconcileActiveBoardTasks(queryClient, PROJECT_ID, USER_ID, { background: true });
  assert.ok(operations.some(([op, key]) => op === "refetch" && key[0] === "projectsAll"));
});
