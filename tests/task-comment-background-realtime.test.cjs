const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

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

function createEventTarget(properties = {}) {
  const listeners = new Map();
  return {
    ...properties,
    addEventListener(event, callback) {
      const callbacks = listeners.get(event) ?? new Set();
      callbacks.add(callback);
      listeners.set(event, callbacks);
    },
    removeEventListener(event, callback) {
      listeners.get(event)?.delete(callback);
    },
    dispatch(event, payload) {
      for (const callback of listeners.get(event) ?? []) callback(payload);
    },
  };
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
    unbind(event, callback) {
      bindings.get(event)?.delete(callback);
    },
    emit(event, payload) {
      for (const callback of bindings.get(event) ?? []) callback(payload);
    },
    callback(event) {
      return [...(bindings.get(event) ?? [])][0];
    },
  };
}

function createHarness({
  initialVisibility = "visible",
  online = true,
  holdRefetch = false,
} = {}) {
  let cleanup;
  let rejectClient;
  let resolveClient;
  let nextTimerId = 1;
  const intervals = new Map();
  const warnings = [];
  const refetches = [];
  const refetchResolvers = [];
  const clientPromise = new Promise((resolve, reject) => {
    resolveClient = resolve;
    rejectClient = reject;
  });
  const channel = createBindingTarget({ subscribed: false });
  const connection = createBindingTarget({ state: "connecting" });
  const client = {
    allChannels: () => [channel],
    connection,
    subscribe() {
      return channel;
    },
    unsubscribe() {},
  };
  const queryClient = {
    refetchQueries(options) {
      refetches.push(options);
      if (!holdRefetch) return Promise.resolve();
      return new Promise((resolve) => refetchResolvers.push(resolve));
    },
  };
  const documentTarget = createEventTarget({
    visibilityState: initialVisibility,
  });
  const windowTarget = createEventTarget();
  const navigatorTarget = { onLine: online };
  const original = {
    clearInterval: global.clearInterval,
    consoleWarn: console.warn,
    document: global.document,
    navigatorDescriptor: Object.getOwnPropertyDescriptor(global, "navigator"),
    setInterval: global.setInterval,
    window: global.window,
  };

  global.document = documentTarget;
  global.window = windowTarget;
  Object.defineProperty(global, "navigator", {
    configurable: true,
    value: navigatorTarget,
  });
  global.setInterval = (callback) => {
    const id = nextTimerId++;
    intervals.set(id, callback);
    return id;
  };
  global.clearInterval = (id) => intervals.delete(id);
  console.warn = (...args) => warnings.push(args);

  const hook = loadTypeScriptModule(
    path.join(root, "src/hooks/realtime/useTaskCommentsRealtime.ts"),
    {
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
      "@/lib/realtime/taskCommentsRefresh": {
        refreshTaskComments: (activeQueryClient, taskId) =>
          activeQueryClient.refetchQueries({
            queryKey: ["comments-", taskId],
          }),
      },
      "@/lib/realtime/taskDetailRefresh": {
        mergeRealtimeTaskDetail: (currentTask) => currentTask,
        refreshTaskDetailQueryCache: async () => null,
        shouldApplyRealtimeTaskDetail: () => false,
        shouldRefetchTaskDetail: () => true,
        shouldSyncTaskDetailContent: () => false,
      },
    },
  );

  let cleaned = false;
  return {
    channel,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      cleanup?.();
      global.clearInterval = original.clearInterval;
      console.warn = original.consoleWarn;
      global.document = original.document;
      if (original.navigatorDescriptor) {
        Object.defineProperty(global, "navigator", original.navigatorDescriptor);
      } else {
        delete global.navigator;
      }
      global.setInterval = original.setInterval;
      global.window = original.window;
    },
    connect() {
      resolveClient(client);
    },
    connectWithoutRealtime() {
      resolveClient(null);
    },
    connection,
    intervalCount: () => intervals.size,
    invokeConnected() {
      connection.state = "connected";
      connection.emit("connected");
    },
    refetches,
    rejectConnection() {
      rejectClient(new Error("realtime client unavailable"));
    },
    render() {
      hook.useTaskCommentsRealtime(42);
    },
    resolveNextRefetch() {
      refetchResolvers.shift()?.();
    },
    setConnectionState(state) {
      connection.state = state;
      connection.emit("state_change", { current: state });
    },
    setOnline(nextOnline) {
      navigatorTarget.onLine = nextOnline;
      if (nextOnline) windowTarget.dispatch("online");
    },
    setSubscriptionSucceeded() {
      channel.subscribed = true;
      channel.emit("pusher:subscription_succeeded");
    },
    setVisibility(visibilityState) {
      documentTarget.visibilityState = visibilityState;
      documentTarget.dispatch("visibilitychange");
    },
    tickIntervals() {
      for (const callback of [...intervals.values()]) callback();
    },
    warnings,
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function withHarness(options, run) {
  const harness = createHarness(options);
  try {
    await run(harness);
  } finally {
    harness.cleanup();
  }
}

test("a task opened in a hidden tab catches up when its first realtime connection succeeds", async () => {
  await withHarness({ initialVisibility: "hidden" }, async (harness) => {
    harness.render();
    harness.connect();
    await settle();
    harness.setVisibility("visible");
    harness.invokeConnected();

    assert.deepEqual(harness.refetches, [{ queryKey: ["comments-", 42] }]);
  });
});

test("a visible task does not duplicate its initial comments fetch", async () => {
  await withHarness({}, async (harness) => {
    harness.render();
    harness.connect();
    await settle();
    harness.setSubscriptionSucceeded();
    harness.invokeConnected();

    assert.deepEqual(harness.refetches, []);
  });
});

test("a visible task still catches up after a genuine reconnect", async () => {
  await withHarness({}, async (harness) => {
    harness.render();
    harness.connect();
    await settle();
    harness.setSubscriptionSucceeded();
    harness.invokeConnected();
    harness.invokeConnected();

    assert.deepEqual(harness.refetches, [{ queryKey: ["comments-", 42] }]);
  });
});

test("a failed private-channel subscription starts one reconciliation fallback", async () => {
  await withHarness({}, async (harness) => {
    harness.render();
    harness.connect();
    await settle();
    harness.channel.emit("pusher:subscription_error", { status: 403 });
    await settle();

    assert.equal(harness.intervalCount(), 1);
    assert.equal(harness.warnings.length, 1);
    assert.deepEqual(harness.refetches, [{ queryKey: ["comments-", 42] }]);

    harness.tickIntervals();
    await settle();
    assert.equal(harness.refetches.length, 2);
  });
});

test("a rejected realtime client starts fallback reconciliation", async () => {
  await withHarness({}, async (harness) => {
    harness.render();
    harness.rejectConnection();
    await settle();

    assert.equal(harness.intervalCount(), 1);
    assert.equal(harness.refetches.length, 1);
    assert.equal(harness.warnings.length, 1);
  });
});

test("a successful subscription stops fallback reconciliation", async () => {
  await withHarness({}, async (harness) => {
    harness.render();
    harness.connect();
    await settle();
    harness.channel.emit("pusher:subscription_error");
    await settle();
    harness.setSubscriptionSucceeded();

    assert.equal(harness.intervalCount(), 0);
    harness.tickIntervals();
    await settle();
    assert.equal(harness.refetches.length, 1);
  });
});

test("a later disconnected state starts fallback until subscription recovery", async () => {
  await withHarness({}, async (harness) => {
    harness.render();
    harness.connect();
    await settle();
    harness.setSubscriptionSucceeded();
    harness.setConnectionState("disconnected");
    await settle();

    assert.equal(harness.intervalCount(), 1);
    assert.equal(harness.refetches.length, 1);
    harness.setSubscriptionSucceeded();
    assert.equal(harness.intervalCount(), 0);
  });
});

test("fallback skips hidden tabs and reconciles immediately when visible", async () => {
  await withHarness({ initialVisibility: "hidden" }, async (harness) => {
    harness.render();
    harness.connectWithoutRealtime();
    await settle();
    harness.tickIntervals();
    await settle();
    assert.equal(harness.refetches.length, 0);

    harness.setVisibility("visible");
    await settle();
    assert.equal(harness.refetches.length, 1);
  });
});

test("fallback skips offline tabs and reconciles immediately when online", async () => {
  await withHarness({ online: false }, async (harness) => {
    harness.render();
    harness.connectWithoutRealtime();
    await settle();
    harness.tickIntervals();
    await settle();
    assert.equal(harness.refetches.length, 0);

    harness.setOnline(true);
    await settle();
    assert.equal(harness.refetches.length, 1);
  });
});

test("fallback coalesces repeated ticks while a comments refresh is in flight", async () => {
  await withHarness({ holdRefetch: true }, async (harness) => {
    harness.render();
    harness.connectWithoutRealtime();
    await settle();
    assert.equal(harness.refetches.length, 1);

    harness.tickIntervals();
    harness.tickIntervals();
    assert.equal(harness.refetches.length, 1);

    harness.resolveNextRefetch();
    await settle();
    assert.equal(harness.refetches.length, 2);
  });
});

test("late subscription callbacks cannot refresh after cleanup", async () => {
  await withHarness({}, async (harness) => {
    harness.render();
    harness.connect();
    await settle();
    const lateError = harness.channel.callback("pusher:subscription_error");
    harness.cleanup();

    lateError();
    await settle();
    assert.equal(harness.refetches.length, 0);
    assert.equal(harness.intervalCount(), 0);
  });
});

// HTPR-5594: realtime events must start their refetch immediately. The speed
// rules ban any timer between a realtime event and its authoritative request,
// so a reintroduced debounce default is a regression, not a tuning choice.
test("realtime events still refetch without a timeout (HTPR-5594)", () => {
  const src = fs.readFileSync(
    require.resolve("../src/hooks/realtime/useTaskCommentsRealtime.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /setTimeout/);
  assert.match(src, /const runRefetch = async \(\) =>/);
});

test("the shared task-comment refresh uses the existing exact query key", async () => {
  const helper = loadTypeScriptModule(
    path.join(root, "src/lib/realtime/taskCommentsRefresh.ts"),
    {
      "@/lib/constants": { CommentsTQPrefixKey: "comments-" },
    },
  );
  const calls = [];

  await helper.refreshTaskComments(
    {
      refetchQueries(options) {
        calls.push(options);
        return Promise.resolve();
      },
    },
    42,
  );

  assert.deepEqual(calls, [{ queryKey: ["comments-", 42] }]);
});

test("successful AI stream completion refreshes the task captured before streaming", () => {
  const src = fs.readFileSync(
    require.resolve("../src/hooks/MultiPages/AIChat/useAiChat.ts"),
    "utf8",
  );
  const captureIndex = src.indexOf("const streamTaskId =");
  const sessionAwaitIndex = src.indexOf("await waitForChatSession()", captureIndex);
  const successIndex = src.indexOf("} else if (!streamErrorHandled) {", sessionAwaitIndex);
  const refreshIndex = src.indexOf(
    "refreshTaskComments(queryClient, streamTaskId)",
    successIndex,
  );

  assert.ok(captureIndex > -1 && captureIndex < sessionAwaitIndex);
  assert.ok(successIndex > sessionAwaitIndex && refreshIndex > successIndex);
  assert.match(src, /\.\.\.\(streamTaskId \? \{ task_id: streamTaskId \} : \{\}\)/);
});
