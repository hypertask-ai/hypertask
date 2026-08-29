const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadHook(stubs) {
  const filename = path.join(
    root,
    "src/hooks/realtime/useTaskCommentsRealtime.ts",
  );
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

function createHarness(initialVisibility) {
  let cleanup;
  let resolveClient;
  let onConnected;
  const refetches = [];
  const clientPromise = new Promise((resolve) => {
    resolveClient = resolve;
  });
  const client = {
    allChannels: () => [],
    connection: {
      state: "connecting",
      bind(event, callback) {
        if (event === "connected") onConnected = callback;
      },
      unbind() {},
    },
    subscribe() {
      return { bind() {}, unbind() {} };
    },
    unsubscribe() {},
  };
  const queryClient = {
    refetchQueries(options) {
      refetches.push(options);
      return Promise.resolve();
    },
  };
  const hook = loadHook({
    react: {
      useEffect(effect) {
        cleanup = effect();
      },
      useRef(initialValue) {
        return { current: initialValue };
      },
    },
    "@tanstack/react-query": {
      useQueryClient: () => queryClient,
    },
    "@/lib/realtime/client": {
      connectRealtimeClient: () => clientPromise,
      releaseRealtimeClientIfIdle() {},
    },
    "@/lib/realtime/shared": {
      COMMENT_EVENT: "comment:changed",
      TASK_EVENT: "task:changed",
      taskChannel: (taskId) => `private-task-${taskId}`,
    },
    "@/lib/realtime/taskDetailRefresh": {
      mergeRealtimeTaskDetail: (currentTask) => currentTask,
      shouldApplyRealtimeTaskDetail: () => false,
      shouldRefetchTaskDetail: () => true,
      shouldSyncTaskDetailContent: () => false,
    },
    "@/lib/constants": {
      CommentsTQPrefixKey: "comments-",
    },
  });

  return {
    cleanup: () => cleanup?.(),
    connect() {
      global.document.visibilityState = "visible";
      resolveClient(client);
    },
    invokeConnected: () => onConnected(),
    refetches,
    render() {
      global.document = { visibilityState: initialVisibility };
      hook.useTaskCommentsRealtime(42);
    },
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function withImmediateTimers(run) {
  const originalDocument = global.document;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  global.setTimeout = (callback) => {
    callback();
    return 1;
  };
  global.clearTimeout = () => {};

  try {
    await run();
  } finally {
    global.document = originalDocument;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
}

test("a task opened in a hidden tab catches up when its first realtime connection succeeds", async () => {
  await withImmediateTimers(async () => {
    const harness = createHarness("hidden");
    harness.render();
    harness.connect();
    await settle();
    harness.invokeConnected();

    assert.deepEqual(harness.refetches, [{ queryKey: ["comments-", 42] }]);
    harness.cleanup();
  });
});

test("a visible task does not duplicate its initial comments fetch", async () => {
  await withImmediateTimers(async () => {
    const harness = createHarness("visible");
    harness.render();
    harness.connect();
    await settle();
    harness.invokeConnected();

    assert.deepEqual(harness.refetches, []);
    harness.cleanup();
  });
});

test("a visible task still catches up after a genuine reconnect", async () => {
  await withImmediateTimers(async () => {
    const harness = createHarness("visible");
    harness.render();
    harness.connect();
    await settle();
    harness.invokeConnected();
    harness.invokeConnected();

    assert.deepEqual(harness.refetches, [{ queryKey: ["comments-", 42] }]);
    harness.cleanup();
  });
});

// HTPR-5594: realtime events must start their refetch immediately. The speed
// rules ban any timer between a realtime event and its authoritative request,
// so a reintroduced debounce default is a regression, not a tuning choice.
test("realtime refetch runs without any timer (HTPR-5594)", () => {
  const src = fs.readFileSync(
    require.resolve("../src/hooks/realtime/useTaskCommentsRealtime.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /setTimeout/);
  assert.match(src, /const runRefetch = async \(\) =>/);
});
