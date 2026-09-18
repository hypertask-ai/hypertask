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
  shouldUseScopedBoardReconcile,
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

test("the hook routing uses the scoped path only for flagged change events", () => {
  assert.equal(
    shouldUseScopedBoardReconcile({
      scopedRefetch: true,
      trigger: "event",
      userId: USER_ID,
    }),
    true,
  );
  assert.equal(
    shouldUseScopedBoardReconcile({
      scopedRefetch: false,
      trigger: "event",
      userId: USER_ID,
    }),
    false,
  );
  assert.equal(
    shouldUseScopedBoardReconcile({
      scopedRefetch: true,
      trigger: "reconnect",
      userId: USER_ID,
    }),
    false,
  );
  assert.equal(
    shouldUseScopedBoardReconcile({
      scopedRefetch: true,
      trigger: "event",
      userId: undefined,
    }),
    false,
  );
});

test("useBoardRealtime still wires the extracted handler and scoped route", () => {
  const source = require("fs").readFileSync(
    path.join(root, "src/hooks/realtime/useBoardRealtime.ts"),
    "utf8",
  );
  assert.match(source, /createBoardRealtimeEventHandler/);
  assert.match(source, /useFlag\(SCOPED_BOARD_REFETCH_FLAG\)/);
  assert.match(source, /if \(scopedRefetch\) return reconcileActiveBoardTasks/);
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
      "@/hooks/useFlag": { useFlag: () => false },
      "@/lib/flags/keys": { SCOPED_BOARD_REFETCH_FLAG: "scoped" },
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
