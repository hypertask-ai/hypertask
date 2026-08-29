const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const {
  emitProductPerformanceEvent,
  installProductPerformanceSink,
  PRODUCT_PERFORMANCE_READY_EVENT,
} = jiti(path.join(root, "src/lib/analytics/productPerformance.ts"));

test("readiness is queued before authenticated analytics are released", () => {
  const previousWindow = global.window;
  const fakeWindow = new EventTarget();
  fakeWindow.__hypertaskProductPerformanceQueue = [];
  global.window = fakeWindow;

  let queueLengthAtRelease = null;
  fakeWindow.addEventListener(PRODUCT_PERFORMANCE_READY_EVENT, () => {
    queueLengthAtRelease = fakeWindow.__hypertaskProductPerformanceQueue.length;
  });

  try {
    emitProductPerformanceEvent({
      event: "app_task_detail_readiness",
      properties: {},
    }, 6);

    assert.equal(queueLengthAtRelease, 1);
    assert.equal(fakeWindow.__hypertaskProductPerformanceQueue.length, 1);

    emitProductPerformanceEvent({
      event: "app_task_create_latency",
      properties: {},
    }, 6);

    assert.equal(queueLengthAtRelease, 1);
    assert.equal(fakeWindow.__hypertaskProductPerformanceQueue.length, 2);

    const flushed = [];
    const uninstall = installProductPerformanceSink((event, accountId) => {
      flushed.push([event.event, accountId]);
    });

    assert.deepEqual(flushed, [
      ["app_task_detail_readiness", 6],
      ["app_task_create_latency", 6],
    ]);
    assert.equal(fakeWindow.__hypertaskProductPerformanceQueue.length, 0);
    uninstall();
  } finally {
    global.window = previousWindow;
  }
});

test("queued product events retain their producing account", () => {
  const previousWindow = global.window;
  const fakeWindow = new EventTarget();
  fakeWindow.__hypertaskProductPerformanceQueue = [];
  global.window = fakeWindow;

  try {
    emitProductPerformanceEvent({
      event: "app_inbox_readiness",
      properties: {},
    }, 6);

    const captured = [];
    const activeAccountId = 7;
    installProductPerformanceSink((event, accountId) => {
      if (accountId === activeAccountId) captured.push(event.event);
    });

    assert.deepEqual(captured, []);
    assert.equal(fakeWindow.__hypertaskProductPerformanceQueue.length, 0);
  } finally {
    global.window = previousWindow;
  }
});

test("realtime bursts do not evict queued readiness events", () => {
  const previousWindow = global.window;
  const fakeWindow = new EventTarget();
  fakeWindow.__hypertaskProductPerformanceQueue = [];
  global.window = fakeWindow;

  try {
    emitProductPerformanceEvent({
      event: "app_board_readiness",
      properties: {},
    }, 6);
    for (let index = 0; index < 25; index += 1) {
      emitProductPerformanceEvent({
        event: "app_realtime_latency",
        properties: {},
      }, 6);
    }

    const events = fakeWindow.__hypertaskProductPerformanceQueue.map(
      (event) => event.event,
    );
    assert.equal(events.length, 20);
    assert.equal(events.includes("app_board_readiness"), true);
    assert.equal(events.filter((event) => event === "app_realtime_latency").length, 19);
  } finally {
    global.window = previousWindow;
  }
});

test("a realtime event is dropped when readiness fills the queue", () => {
  const previousWindow = global.window;
  const fakeWindow = new EventTarget();
  fakeWindow.__hypertaskProductPerformanceQueue = [];
  global.window = fakeWindow;

  try {
    for (let index = 0; index < 20; index += 1) {
      emitProductPerformanceEvent({
        event: "app_board_readiness",
        properties: {},
      }, 6);
    }
    emitProductPerformanceEvent({
      event: "app_realtime_latency",
      properties: {},
    }, 6);

    assert.equal(fakeWindow.__hypertaskProductPerformanceQueue.length, 20);
    assert.equal(
      fakeWindow.__hypertaskProductPerformanceQueue.every(
        (event) => event.event === "app_board_readiness",
      ),
      true,
    );
  } finally {
    global.window = previousWindow;
  }
});

test("readiness displaces realtime when realtime fills the queue", () => {
  const previousWindow = global.window;
  const fakeWindow = new EventTarget();
  fakeWindow.__hypertaskProductPerformanceQueue = [];
  global.window = fakeWindow;

  try {
    for (let index = 0; index < 20; index += 1) {
      emitProductPerformanceEvent({
        event: "app_realtime_latency",
        properties: {},
      }, 6);
    }
    emitProductPerformanceEvent({
      event: "app_board_readiness",
      properties: {},
    }, 6);

    const events = fakeWindow.__hypertaskProductPerformanceQueue.map(
      (event) => event.event,
    );
    assert.equal(events.length, 20);
    assert.equal(events.includes("app_board_readiness"), true);
    assert.equal(events.filter((event) => event === "app_realtime_latency").length, 19);
  } finally {
    global.window = previousWindow;
  }
});
