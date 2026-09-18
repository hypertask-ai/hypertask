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

function createEventTarget(properties = {}) {
  return {
    ...properties,
    addEventListener() {},
    removeEventListener() {},
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("fallback reconciliation refreshes the task detail without replacing an active draft", async () => {
  let cleanup;
  let currentTask = {
    id: 42,
    projectId: 15,
    uniqueIndex: 6281,
    title: "Before",
    description: "Local draft",
  };
  let fetchedTask = {
    id: 42,
    projectId: 15,
    uniqueIndex: 6281,
    title: "First fallback",
    description: "Remote description",
  };
  const intervals = new Set();
  const fetches = [];
  const merges = [];
  const original = {
    clearInterval: global.clearInterval,
    consoleWarn: console.warn,
    document: global.document,
    fetch: global.fetch,
    navigatorDescriptor: Object.getOwnPropertyDescriptor(global, "navigator"),
    setInterval: global.setInterval,
    window: global.window,
  };

  global.document = createEventTarget({ visibilityState: "visible" });
  global.window = createEventTarget();
  Object.defineProperty(global, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  global.setInterval = (callback) => {
    intervals.add(callback);
    return callback;
  };
  global.clearInterval = (callback) => intervals.delete(callback);
  global.fetch = async (url, options) => {
    fetches.push({ url, options });
    return { ok: true, json: async () => fetchedTask };
  };
  console.warn = () => {};

  try {
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
        useQueryClient: () => ({}),
      },
      "@/lib/realtime/client": {
        connectRealtimeClient: async () => null,
        releaseRealtimeClientIfIdle() {},
      },
      "@/lib/realtime/shared": {
        COMMENT_EVENT: "comment:changed",
        TASK_EVENT: "task:changed",
        taskChannel: (taskId) => `private-task-${taskId}`,
      },
      "@/lib/realtime/taskCommentsRefresh": {
        refreshTaskComments: async () => {},
      },
      "@/lib/realtime/taskDetailRefresh": {
        mergeRealtimeTaskDetail(current, fetched, includeTaskContent) {
          merges.push(includeTaskContent);
          return {
            ...fetched,
            description: includeTaskContent
              ? fetched.description
              : current.description,
          };
        },
        refreshTaskDetailQueryCache: ({ fetchTask }) => fetchTask(),
        shouldApplyRealtimeTaskDetail: () => true,
        shouldRefetchTaskDetail: () => true,
        shouldSyncTaskDetailContent: () => false,
      },
    });

    hook.useTaskCommentsRealtime(42, {
      taskProjectId: 15,
      taskUniqueIndex: 6281,
      preserveEditorContent: true,
      setCurrentTask(updater) {
        currentTask = updater(currentTask);
      },
    });
    await settle();

    fetches.length = 0;
    merges.length = 0;
    fetchedTask = { ...fetchedTask, title: "After fallback tick" };
    for (const callback of intervals) callback();
    await settle();

    assert.equal(fetches.length, 1);
    assert.match(fetches[0].url, /\/api\/tasks\/getTask\?/);
    assert.equal(fetches[0].options.cache, "no-store");
    assert.equal(currentTask.title, "After fallback tick");
    assert.equal(currentTask.description, "Local draft");
    assert.deepEqual(merges, [false]);
  } finally {
    cleanup?.();
    global.clearInterval = original.clearInterval;
    console.warn = original.consoleWarn;
    global.document = original.document;
    global.fetch = original.fetch;
    if (original.navigatorDescriptor) {
      Object.defineProperty(global, "navigator", original.navigatorDescriptor);
    } else {
      delete global.navigator;
    }
    global.setInterval = original.setInterval;
    global.window = original.window;
  }
});
