const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/board-realtime-reconciliation-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  buildMyTasksListUrl,
  createMyTasksReconcileRunner,
  parseMyTasksListPayload,
} = jiti(path.join(root, "src/lib/myTasks/reconcileMyTasks.ts"));

test("my-tasks reconcile drops stale responses", async () => {
  assert.equal(buildMyTasksListUrl(["assigned"]), "/api/my-tasks?scopes=assigned");
  assert.equal(parseMyTasksListPayload({ tabs: ["All"] }), null);
  const applied = [];
  let resolveFirst;
  let n = 0;
  const runner = createMyTasksReconcileRunner({
    fetchList: (signal) => {
      n += 1;
      if (n === 1) {
        return new Promise((resolve, reject) => {
          resolveFirst = () =>
            signal.aborted
              ? reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
              : resolve({
                  sections: [{ id: "old" }],
                  tabs: ["All"],
                  boards: [],
                  accessibleProjectIds: [1],
                });
          signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        });
      }
      return Promise.resolve({
        sections: [{ id: "new" }],
        tabs: ["All"],
        boards: [],
        accessibleProjectIds: [2],
      });
    },
    apply: (payload) => applied.push(payload.sections[0].id),
  });
  runner.request();
  await Promise.resolve();
  runner.request();
  resolveFirst();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(applied, ["old", "new"]);
});

test("my-tasks reconcile flush waits for the applied payload", async () => {
  const applied = [];
  let resolveFetch;
  const runner = createMyTasksReconcileRunner({
    fetchList: () =>
      new Promise((resolve) => {
        resolveFetch = () =>
          resolve({
            sections: [{ id: "flushed" }],
            tabs: ["All"],
            boards: [],
            accessibleProjectIds: [3],
          });
      }),
    apply: (payload) => applied.push(payload.sections[0].id),
  });
  const pending = runner.flush();
  await Promise.resolve();
  resolveFetch();
  const payload = await pending;
  assert.equal(payload.sections[0].id, "flushed");
  assert.deepEqual(applied, ["flushed"]);
});

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
  new Function("module", "exports", "require", javascript)(
    loadedModule,
    loadedModule.exports,
    localRequire,
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
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("my-tasks reconciles while realtime is pending or unavailable", async () => {
  const cleanups = [];
  const intervals = new Map();
  const reconciliations = [];
  let nextIntervalId = 1;
  let resolveClient;
  const clientPromise = new Promise((resolve) => {
    resolveClient = resolve;
  });
  const original = {
    clearInterval: global.clearInterval,
    document: global.document,
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
    const id = nextIntervalId++;
    intervals.set(id, callback);
    return id;
  };
  global.clearInterval = (id) => intervals.delete(id);

  try {
    const hook = loadTypeScriptModule(
      path.join(root, "src/hooks/realtime/useMyTasksRealtime.ts"),
      {
        react: {
          useEffect(effect) {
            const cleanup = effect();
            if (typeof cleanup === "function") cleanups.push(cleanup);
          },
          useRef(initialValue) {
            return { current: initialValue };
          },
        },
        "@/lib/realtime/client": {
          connectRealtimeClient: () => clientPromise,
          releaseRealtimeClientIfIdle() {},
        },
        "@/lib/realtime/shared": {
          BOARD_EVENT: "board:changed",
          boardChannel: (projectId) => `private-project-${projectId}`,
        },
      },
    );

    hook.useMyTasksRealtime(6, [15], true, (trigger) => {
      reconciliations.push(trigger);
    });
    await settle();

    assert.deepEqual(reconciliations, []);
    assert.equal(intervals.size, 1);
    for (const callback of intervals.values()) callback();
    assert.deepEqual(reconciliations, ["realtime"]);

    resolveClient(null);
    await settle();
    assert.deepEqual(reconciliations, ["realtime", "realtime"]);
    for (const callback of intervals.values()) callback();
    assert.deepEqual(reconciliations, ["realtime", "realtime", "realtime"]);
  } finally {
    cleanups.reverse().forEach((cleanup) => cleanup());
    global.clearInterval = original.clearInterval;
    global.document = original.document;
    if (original.navigatorDescriptor) {
      Object.defineProperty(global, "navigator", original.navigatorDescriptor);
    } else {
      delete global.navigator;
    }
    global.setInterval = original.setInterval;
    global.window = original.window;
  }

  assert.equal(intervals.size, 0);
});
