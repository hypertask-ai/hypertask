const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

function bindingTarget(properties) {
  const bindings = new Map();
  return {
    ...properties,
    bind(event, callback) {
      if (!bindings.has(event)) bindings.set(event, new Set());
      bindings.get(event).add(callback);
    },
    unbind(event, callback) {
      bindings.get(event)?.delete(callback);
    },
    emit(event, payload) {
      for (const callback of [...(bindings.get(event) ?? [])]) callback(payload);
    },
  };
}

async function mountBoardRealtime(t, { realtime = false, subscribed = false } = {}) {
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://app.hypertask.ai/project?id=15",
    pretendToBeVisual: true,
  });
  const globals = ["window", "document", "navigator", "setInterval", "clearInterval", "IS_REACT_ACT_ENVIRONMENT"];
  const originals = globals.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  Object.defineProperty(global, "window", { configurable: true, writable: true, value: dom.window });
  Object.defineProperty(global, "document", { configurable: true, writable: true, value: dom.window.document });
  Object.defineProperty(global, "navigator", { configurable: true, writable: true, value: { onLine: true } });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const timers = new Map();
  let timerStarts = 0;
  global.setInterval = (callback, delay) => {
    assert.equal(delay, 10_000);
    const id = ++timerStarts;
    timers.set(id, callback);
    return id;
  };
  global.clearInterval = (id) => timers.delete(id);

  let flag = false;
  let connects = 0;
  let subscribes = 0;
  const fullReconciles = [];
  const scopedReconciles = [];
  const triggers = [];
  const planningRefetches = [];
  const connection = bindingTarget({ state: "connected" });
  const channel = bindingTarget({ subscribed });
  const client = {
    connection,
    subscribe() { subscribes += 1; return channel; },
    unsubscribe() { channel.subscribed = false; },
  };
  const queryClient = {
    refetchQueries: async (filters) => { planningRefetches.push(filters); },
  };
  const mocks = {
    react: React,
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/hooks/useFlag": { useFlag: () => flag },
    "@/lib/flags/keys": { SCOPED_BOARD_REFETCH_FLAG: "scoped" },
    "@/lib/realtime/client": {
      connectRealtimeClient: async () => {
        connects += 1;
        if (connection.state === "unavailable") connection.state = "connecting";
        return realtime ? client : null;
      },
      releaseRealtimeClientIfIdle() {},
    },
    "@/lib/realtime/shared": {
      BOARD_EVENT: "board:changed",
      boardChannel: (id) => `private-board-${id}`,
    },
    "@/lib/projectPlanning": { projectPlanningQueryKey: (id) => ["planning", id] },
    "@/lib/boardSync/reconcileActiveBoardQuery": {
      reconcileActiveBoardQuery: async (...args) => { fullReconciles.push(args); },
      reconcileActiveBoardTasks: async (...args) => { scopedReconciles.push(args); },
    },
    "@/lib/realtime/latencyCanary": {
      runRealtimeReconciliation: ({ trigger, reconcile }) => { triggers.push(trigger); return reconcile(); },
    },
    "@/lib/realtime/boardRealtimeEventHandler": {
      createBoardRealtimeEventHandler: (refetch) => () => refetch("event"),
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "../src/hooks/realtime/useBoardRealtime.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (specifier) => mocks[specifier] ?? require(specifier), loaded, loaded.exports,
  );
  function Board({ projectId = 15, accountId = 8 }) {
    loaded.exports.useBoardRealtime(projectId, { accountId });
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => root.unmount());
    assert.equal(timers.size, 0, "unmount must stop fallback polling");
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  const render = async (props = {}) => {
    await React.act(async () => root.render(React.createElement(Board, props)));
  };
  await render();
  return {
    channel, connection, timers, fullReconciles, scopedReconciles, triggers, planningRefetches,
    connects: () => connects,
    subscribes: () => subscribes,
    timerStarts: () => timerStarts,
    render,
    setFlag: async (value) => { flag = value; await render(); },
    tick: async () => {
      await React.act(async () => { for (const callback of [...timers.values()]) callback(); });
    },
    emit: async (target, event, payload) => {
      await React.act(async () => target.emit(event, payload));
    },
  };
}

test("fallback startup reuses the initial board load and polls only on the interval", async (t) => {
  const board = await mountBoardRealtime(t);
  assert.equal(board.scopedReconciles.length, 0, "the initial query already loaded the board");
  assert.equal(board.fullReconciles.length, 0);
  assert.equal(board.timers.size, 1);

  await board.setFlag(true);
  assert.equal(board.connects(), 1, "hydrating the scoped policy must not restart realtime");
  assert.equal(board.timerStarts(), 1, "flag hydration must not reset the polling clock");
  assert.equal(board.scopedReconciles.length, 0);
  await board.tick();
  assert.equal(board.scopedReconciles.length, 1, "one interval means one boardTasks reconcile");
  assert.equal(board.fullReconciles.length, 0, "fallback must not refetch getAll");
  assert.equal(board.planningRefetches.length, 1);
});

test("flag hydration preserves the subscription and routes subsequent real events with the new policy", async (t) => {
  const board = await mountBoardRealtime(t, { realtime: true, subscribed: true });
  assert.equal(board.fullReconciles.length, 1, "one catch-up covers the query/subscription gap");
  await board.setFlag(true);
  assert.equal(board.subscribes(), 1);
  assert.equal(board.fullReconciles.length, 1, "policy hydration must not run catch-up again");

  await board.emit(board.channel, "board:changed", { action: "create" });
  assert.equal(board.scopedReconciles.length, 1);
  assert.equal(board.fullReconciles.length, 1);
  await board.setFlag(false);
  await board.emit(board.channel, "board:changed", { action: "archive" });
  assert.equal(board.fullReconciles.length, 2);
  assert.deepEqual(board.triggers, ["event", "event"]);
  assert.equal(board.subscribes(), 1);
});

test("a real dropped connection reconciles once after subscription recovery", async (t) => {
  const board = await mountBoardRealtime(t, { realtime: true, subscribed: true });
  await board.setFlag(true);
  const initialReconciles = board.fullReconciles.length;
  board.connection.state = "unavailable";
  await board.emit(board.connection, "state_change", { previous: "connected", current: "unavailable" });
  assert.equal(board.timers.size, 1);
  assert.equal(board.scopedReconciles.length, 0, "disconnect must not add an immediate poll");
  await board.tick();
  assert.equal(board.scopedReconciles.length, 1);
  assert.equal(board.subscribes(), 2);
  board.connection.state = "connected";
  await board.emit(board.connection, "connected");
  board.channel.subscribed = true;
  await board.emit(board.channel, "pusher:subscription_succeeded");
  assert.equal(board.fullReconciles.length, initialReconciles + 1);
  assert.equal(board.timers.size, 0);
  await board.emit(board.channel, "pusher:subscription_succeeded");
  assert.equal(board.fullReconciles.length, initialReconciles + 1);
});

test("a brief real reconnect still re-proves account access with the scoped flag enabled", async (t) => {
  const board = await mountBoardRealtime(t, { realtime: true, subscribed: true });
  await board.setFlag(true);
  const initialReconciles = board.fullReconciles.length;
  board.connection.state = "connecting";
  await board.emit(board.connection, "state_change", { previous: "connected", current: "connecting" });
  board.connection.state = "connected";
  await board.emit(board.connection, "connected");
  await board.emit(board.channel, "pusher:subscription_succeeded");
  assert.equal(board.fullReconciles.length, initialReconciles + 1);
  assert.equal(board.scopedReconciles.length, 0);
  assert.deepEqual(board.triggers, ["reconnect"]);
});

test("changing board or account still replaces the subscription", async (t) => {
  const board = await mountBoardRealtime(t, { realtime: true, subscribed: true });
  await board.render({ projectId: 16, accountId: 8 });
  assert.equal(board.subscribes(), 2);
  await board.render({ projectId: 16, accountId: 9 });
  assert.equal(board.subscribes(), 3);
});
