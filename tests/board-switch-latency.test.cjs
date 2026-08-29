const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  moduleCache: false,
});
const {
  markBoardSwitchIntent,
  resolveBoardSwitchIntent,
} = jiti(path.join(root, "src/lib/analytics/boardSwitchLatency.ts"));

const installRuntime = ({ hostname = "app.hypertask.ai", nowValues = [] } = {}) => {
  const previousWindow = global.window;
  const previousPerformance = global.performance;
  const nowQueue = [...nowValues];
  const fakePerformance = {
    now: () => (nowQueue.length ? nowQueue.shift() : 0),
  };
  const fakeWindow = { location: { hostname }, matchMedia: () => ({ matches: false }) };

  global.window = fakeWindow;
  Object.defineProperty(global, "performance", {
    configurable: true,
    value: fakePerformance,
  });

  return {
    fakeWindow,
    restore: () => {
      global.window = previousWindow;
      Object.defineProperty(global, "performance", {
        configurable: true,
        value: previousPerformance,
      });
    },
  };
};

const baseCompletion = (overrides = {}) => ({
  accountId: 1,
  projectId: 42,
  authenticated: true,
  localDatabasePilot: true,
  readinessSource: "indexeddb",
  viewSurface: "board",
  ...overrides,
});

const emittedEvents = (fakeWindow) =>
  fakeWindow.__hypertaskProductPerformanceQueue ?? [];

test("a fresh intent that matches the ready board emits app_board_switch_latency", () => {
  const runtime = installRuntime({ nowValues: [100, 340] });
  try {
    markBoardSwitchIntent({ surface: "sidebar", projectId: 42 });
    resolveBoardSwitchIntent(baseCompletion());

    const events = emittedEvents(runtime.fakeWindow);
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "app_board_switch_latency");
    assert.equal(events[0].properties.duration_ms, 240);
    assert.equal(events[0].properties.switch_surface, "sidebar");
    assert.equal(events[0].properties.readiness_source, "indexeddb");
    assert.equal(events[0].properties.project_id, 42);
    assert.equal(runtime.fakeWindow.__htBoardSwitchIntent, undefined);
  } finally {
    runtime.restore();
  }
});

test("no pending intent (plain route load) emits nothing", () => {
  const runtime = installRuntime({ nowValues: [500] });
  try {
    resolveBoardSwitchIntent(baseCompletion());
    assert.equal(emittedEvents(runtime.fakeWindow).length, 0);
  } finally {
    runtime.restore();
  }
});

test("an abandoned intent (overwritten by a second switch) is dropped, never emitted", () => {
  const runtime = installRuntime({ nowValues: [0, 10, 20, 400] });
  try {
    markBoardSwitchIntent({ surface: "sidebar", projectId: 1 }); // consumes 0
    markBoardSwitchIntent({ surface: "keyboard_shortcut", projectId: 2 }); // consumes 10, overwrites board 1's intent

    // A late completion for the abandoned board (1) must not emit, and must
    // not consume the still-pending intent for board 2.
    resolveBoardSwitchIntent(baseCompletion({ projectId: 1 })); // consumes 20
    assert.equal(emittedEvents(runtime.fakeWindow).length, 0);

    resolveBoardSwitchIntent(baseCompletion({ projectId: 2 })); // consumes 400
    const events = emittedEvents(runtime.fakeWindow);
    assert.equal(events.length, 1);
    assert.equal(events[0].properties.switch_surface, "keyboard_shortcut");
    assert.equal(events[0].properties.project_id, 2);
  } finally {
    runtime.restore();
  }
});

test("a stale intent past the abandonment window is dropped", () => {
  const runtime = installRuntime({ nowValues: [0, 30_001] });
  try {
    markBoardSwitchIntent({ surface: "mobile", projectId: 7 });
    resolveBoardSwitchIntent(baseCompletion({ projectId: 7 }));
    assert.equal(emittedEvents(runtime.fakeWindow).length, 0);
  } finally {
    runtime.restore();
  }
});

test("an unauthenticated or wrong-hostname completion emits nothing", () => {
  const runtime = installRuntime({
    hostname: "preview.example.com",
    nowValues: [0, 50],
  });
  try {
    markBoardSwitchIntent({ surface: "sidebar", projectId: 9 });
    resolveBoardSwitchIntent(baseCompletion({ projectId: 9 }));
    assert.equal(emittedEvents(runtime.fakeWindow).length, 0);
  } finally {
    runtime.restore();
  }
});
