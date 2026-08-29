const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const { createJiti } = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  moduleCache: false,
});
const {
  createRealtimeLatencyCanary,
  markRealtimeRequestStarted,
  percentile75,
  REALTIME_RECEIPT_TO_REQUEST_BUDGET_MS,
} = jiti(path.join(root, "src/lib/realtime/latencyCanary.ts"));
const { createBoardRealtimeEventHandler } = jiti(
  path.join(root, "src/hooks/realtime/useBoardRealtime.ts"),
);
const { createInboxRealtimeEventHandler } = jiti(
  path.join(root, "src/hooks/realtime/useInboxRealtime.ts"),
);
const { createCalendarRealtimeEventHandler } = jiti(
  path.join(root, "src/hooks/realtime/useCalendarRealtime.ts"),
);
const { createArchivedRealtimeEventHandler } = jiti(
  path.join(root, "src/hooks/realtime/useArchivedRealtime.ts"),
);

test("bound realtime event handlers invoke reconciliation in the same turn", () => {
  const contracts = [
    {
      name: "board",
      createHandler: createBoardRealtimeEventHandler,
      expectedTrigger: "event",
    },
    {
      name: "inbox",
      createHandler: createInboxRealtimeEventHandler,
      expectedTrigger: "event",
    },
    {
      name: "calendar",
      createHandler: createCalendarRealtimeEventHandler,
      expectedTrigger: "event",
    },
    {
      name: "archived inbox",
      createHandler: createArchivedRealtimeEventHandler,
      expectedTrigger: undefined,
    },
    {
      name: "archived board",
      createHandler: createArchivedRealtimeEventHandler,
      expectedTrigger: undefined,
    },
  ];

  for (const { name, createHandler, expectedTrigger } of contracts) {
    const calls = [];
    let boundHandler;
    const channel = {
      bind(_eventName, handler) {
        boundHandler = handler;
      },
    };
    channel.bind(
      "event",
      createHandler((trigger) => {
        calls.push(trigger);
      }),
    );

    assert.equal(calls.length, 0, `${name} must wait for its event`);
    boundHandler();
    assert.deepEqual(
      calls,
      [expectedTrigger],
      `${name} must reconcile before its event callback returns`,
    );
  }
});

test("every event starts its own authoritative reconciliation in the same turn", async () => {
  const pending = [];
  const emitted = [];
  const clock = [100, 104, 110, 115, 120, 126, 180, 190, 200];
  let renderCount = 0;
  const canary = createRealtimeLatencyCanary({
    now: () => clock.shift(),
    afterRender: async () => (++renderCount === 3 ? false : undefined),
    emit: (record) => emitted.push(record),
  });
  let reconciliationCount = 0;
  const reconcile = () => {
    reconciliationCount += 1;
    return new Promise((resolve) => pending.push(resolve));
  };

  const traces = [
    canary.run({ accountId: 6, surface: "board", reconcile }),
    canary.run({ accountId: 6, surface: "board", reconcile }),
    canary.run({ accountId: 6, surface: "board", reconcile }),
  ];

  assert.equal(reconciliationCount, 3);
  pending.forEach((resolve) => resolve(true));
  const records = await Promise.all(traces);

  assert.equal(emitted.length, 3);
  assert.equal(
    records.every(
      (record) =>
        record.result === "success" &&
        record.receiptToRequestMs < REALTIME_RECEIPT_TO_REQUEST_BUDGET_MS,
    ),
    true,
  );
  assert.equal(records.at(-1).receiptToRequestP75Ms, 6);
  assert.equal(records.at(-1).receiptToRequestBudgetMet, true);
  assert.equal(records.at(-1).renderedMs, null);
  assert.equal(percentile75([8, 2, 5, 12]), 8);
});

test("the canary records failed reconciliation without claiming a render", async () => {
  const clock = [40, 42];
  const canary = createRealtimeLatencyCanary({
    now: () => clock.shift(),
    afterRender: async () => assert.fail("failed data must not be marked rendered"),
    emit: () => undefined,
  });

  const record = await canary.run({
    accountId: 6,
    surface: "calendar",
    reconcile: () => false,
  });

  assert.equal(record.result, "failure");
  assert.equal(record.requestStartedMs, null);
  assert.equal(record.receiptToRequestMs, null);
  assert.equal(record.renderedMs, null);
  assert.equal(record.receiptToRenderMs, null);
  assert.equal(record.receiptToRequestP75Ms, null);
  assert.equal(record.receiptToRequestBudgetMet, null);
});

test("an asynchronous skipped reconciliation does not enter the latency percentile", async () => {
  const clock = [40, 42];
  const canary = createRealtimeLatencyCanary({
    now: () => clock.shift(),
    afterRender: async () => assert.fail("failed data must not be marked rendered"),
    emit: () => undefined,
  });

  const record = await canary.run({
    accountId: 6,
    surface: "calendar",
    reconcile: async () => false,
  });

  assert.equal(record.result, "failure");
  assert.equal(record.requestStartedMs, null);
  assert.equal(record.receiptToRequestMs, null);
  assert.equal(record.receiptToRequestP75Ms, null);
  assert.equal(record.receiptToRequestBudgetMet, null);
});

test("a started request that later fails keeps its dispatch latency sample", async () => {
  const clock = [40, 42];
  const canary = createRealtimeLatencyCanary({
    now: () => clock.shift(),
    afterRender: async () => assert.fail("failed data must not be marked rendered"),
    emit: () => undefined,
  });

  const record = await canary.run({
    accountId: 6,
    surface: "calendar",
    reconcile: () => markRealtimeRequestStarted(Promise.resolve(false)),
  });

  assert.equal(record.result, "failure");
  assert.equal(record.requestStartedMs, 42);
  assert.equal(record.receiptToRequestMs, 2);
  assert.equal(record.receiptToRequestP75Ms, 2);
  assert.equal(record.receiptToRequestBudgetMet, true);
});

test("a rejected request keeps its dispatch latency sample", async () => {
  const clock = [50, 53];
  const canary = createRealtimeLatencyCanary({
    now: () => clock.shift(),
    afterRender: async () => assert.fail("failed data must not be marked rendered"),
    emit: () => undefined,
  });

  const record = await canary.run({
    accountId: 6,
    surface: "inbox",
    reconcile: async () => {
      throw new Error("request failed after dispatch");
    },
  });

  assert.equal(record.result, "failure");
  assert.equal(record.receiptToRequestP75Ms, 3);
  assert.equal(record.receiptToRequestBudgetMet, true);
});

test("a telemetry emitter cannot reject completed reconciliation", async () => {
  const clock = [70, 72, 80];
  const canary = createRealtimeLatencyCanary({
    now: () => clock.shift(),
    afterRender: async () => undefined,
    emit: () => {
      throw new Error("analytics sink unavailable");
    },
  });

  const record = await canary.run({
    accountId: 6,
    surface: "board",
    reconcile: async () => undefined,
  });

  assert.equal(record.result, "success");
  assert.equal(record.renderedMs, 80);
  assert.equal(record.receiptToRequestP75Ms, 2);
});

test("a synchronous reconciliation failure does not enter the latency percentile", async () => {
  const clock = [40, 42];
  const canary = createRealtimeLatencyCanary({
    now: () => clock.shift(),
    afterRender: async () => assert.fail("failed data must not be marked rendered"),
    emit: () => undefined,
  });

  const record = await canary.run({
    accountId: 6,
    surface: "board",
    reconcile: () => {
      throw new Error("request did not start");
    },
  });

  assert.equal(record.result, "failure");
  assert.equal(record.receiptToRequestP75Ms, null);
  assert.equal(record.receiptToRequestBudgetMet, null);
});

test("the budget uses unrounded latency and remains strictly below 50 ms", async () => {
  const clock = [0, 49.6, 100, 150];
  const canary = createRealtimeLatencyCanary({
    now: () => clock.shift(),
    afterRender: async () => false,
    emit: () => undefined,
  });

  const record = await canary.run({
    accountId: 6,
    surface: "inbox",
    reconcile: async () => undefined,
  });

  assert.equal(record.receiptToRequestP75Ms, 49.6);
  assert.equal(record.receiptToRequestBudgetMet, true);

  const boundaryRecord = await canary.run({
    accountId: 6,
    surface: "inbox",
    reconcile: async () => undefined,
  });

  assert.equal(boundaryRecord.receiptToRequestP75Ms, 50);
  assert.equal(boundaryRecord.receiptToRequestBudgetMet, false);
});

test("tab sleep stops render observation without waiting for another frame", async () => {
  const originalWindow = global.window;
  const originalDocument = global.document;
  const frames = new Map();
  const visibilityListeners = new Set();
  let nextFrameId = 1;
  let visibilityState = "visible";

  global.window = {
    requestAnimationFrame(callback) {
      const frameId = nextFrameId++;
      frames.set(frameId, callback);
      return frameId;
    },
    cancelAnimationFrame(frameId) {
      frames.delete(frameId);
    },
  };
  global.document = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type, listener) {
      if (type === "visibilitychange") visibilityListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "visibilitychange") visibilityListeners.delete(listener);
    },
  };

  try {
    const clock = [10, 12];
    const canary = createRealtimeLatencyCanary({
      now: () => clock.shift(),
      emit: () => undefined,
    });
    const pendingRecord = canary.run({
      accountId: 6,
      surface: "board",
      reconcile: () => undefined,
    });

    await Promise.resolve();
    assert.equal(frames.size, 1);
    const firstFrame = frames.values().next().value;
    frames.clear();
    firstFrame();
    assert.equal(frames.size, 1);

    visibilityState = "hidden";
    visibilityListeners.forEach((listener) => listener());
    const record = await pendingRecord;

    assert.equal(record.result, "success");
    assert.equal(record.renderedMs, null);
    assert.equal(record.receiptToRenderMs, null);
    assert.equal(frames.size, 0);
    assert.equal(visibilityListeners.size, 0);
  } finally {
    global.window = originalWindow;
    global.document = originalDocument;
  }
});
