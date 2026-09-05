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
const { createRealtimeLatencyCanary } = jiti(
  path.join(root, "src/lib/realtime/latencyCanary.ts"),
);

// HTPR-6166: network_ms/long_task_ms split receipt_to_render_ms into fetch
// time vs main-thread blocking, so field data can tell a network problem
// from a render problem without another manual dig.

test("emits network_ms, long_task_ms, realtime_project_id on a rendered record", async () => {
  const emitted = [];
  const canary = createRealtimeLatencyCanary({
    now: () => Date.now(),
    afterRender: async () => undefined,
    emit: (record) => emitted.push(record),
  });

  const record = await canary.run({
    accountId: 6,
    surface: "board",
    reconcile: async () => undefined,
    networkUrlPatterns: ["/api/projects/boardTasks", "/api/projects/getAll"],
    projectId: 15,
  });

  assert.equal(record.result, "success");
  assert.ok(
    "networkMs" in record && "longTaskMs" in record && "projectId" in record,
    "record must carry the three new fields",
  );
  // Node's performance.getEntriesByType("resource") exists but never has
  // entries here, so network_ms is a real, honest 0 (no matching fetch
  // happened in this process), not null - the API itself is measurable.
  assert.equal(record.networkMs, 0);
  assert.equal(record.projectId, 15);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].projectId, 15);
});

test("projectId defaults to null when the caller doesn't pass one (inbox/calendar)", async () => {
  const canary = createRealtimeLatencyCanary({
    now: () => Date.now(),
    afterRender: async () => undefined,
    emit: () => undefined,
  });

  const record = await canary.run({
    accountId: 6,
    surface: "inbox",
    reconcile: async () => undefined,
    networkUrlPatterns: ["/api/notifications/getAll"],
  });

  assert.equal(record.projectId, null);
});

test("a reconciliation that never renders reports null network_ms/long_task_ms instead of guessing a window", async () => {
  const canary = createRealtimeLatencyCanary({
    now: () => Date.now(),
    afterRender: async () => {
      throw new Error("must not be reached for a failed reconciliation");
    },
    emit: () => undefined,
  });

  const record = await canary.run({
    accountId: 6,
    surface: "board",
    reconcile: () => false,
    networkUrlPatterns: ["/api/projects/getAll"],
    projectId: 15,
  });

  assert.equal(record.result, "failure");
  assert.equal(record.renderedMs, null);
  assert.equal(record.networkMs, null);
  assert.equal(record.longTaskMs, null);
});

test("long_task_ms is null and nothing throws when PerformanceObserver doesn't exist", async () => {
  const original = global.PerformanceObserver;
  delete global.PerformanceObserver;
  try {
    const canary = createRealtimeLatencyCanary({
      now: () => Date.now(),
      afterRender: async () => undefined,
      emit: () => undefined,
    });
    const record = await canary.run({
      accountId: 6,
      surface: "board",
      reconcile: async () => undefined,
      projectId: 15,
    });
    assert.equal(record.result, "success");
    assert.equal(record.longTaskMs, null);
  } finally {
    if (original === undefined) delete global.PerformanceObserver;
    else global.PerformanceObserver = original;
  }
});

test("long_task_ms is null and nothing throws when observe() throws (unsupported entry type)", async () => {
  const original = global.PerformanceObserver;
  global.PerformanceObserver = class {
    observe() {
      throw new Error('entryType "longtask" is not supported');
    }
  };
  try {
    const canary = createRealtimeLatencyCanary({
      now: () => Date.now(),
      afterRender: async () => undefined,
      emit: () => undefined,
    });
    const record = await canary.run({
      accountId: 6,
      surface: "board",
      reconcile: async () => undefined,
      projectId: 15,
    });
    assert.equal(record.result, "success");
    assert.equal(record.longTaskMs, null);
  } finally {
    if (original === undefined) delete global.PerformanceObserver;
    else global.PerformanceObserver = original;
  }
});

test("network_ms is null and nothing throws when the Resource Timing API doesn't exist", async () => {
  const original = global.performance;
  global.performance = { now: () => Date.now() };
  try {
    const canary = createRealtimeLatencyCanary({
      now: () => Date.now(),
      afterRender: async () => undefined,
      emit: () => undefined,
    });
    const record = await canary.run({
      accountId: 6,
      surface: "board",
      reconcile: async () => undefined,
      networkUrlPatterns: ["/api/projects/getAll"],
      projectId: 15,
    });
    assert.equal(record.result, "success");
    assert.equal(record.networkMs, null);
  } finally {
    global.performance = original;
  }
});
