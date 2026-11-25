const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/realtime-visibility-${Date.now()}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

function fakeDocument(initialVisibility = "visible") {
  const listeners = new Map();
  return {
    visibilityState: initialVisibility,
    addEventListener(name, callback) {
      const callbacks = listeners.get(name) ?? new Set();
      callbacks.add(callback);
      listeners.set(name, callbacks);
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback);
    },
    dispatch(name) {
      for (const callback of listeners.get(name) ?? []) callback();
    },
    listenerCount(name) {
      return listeners.get(name)?.size ?? 0;
    },
  };
}

function fakeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) {
      const callbacks = listeners.get(name) ?? new Set();
      callbacks.add(callback);
      listeners.set(name, callbacks);
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback);
    },
    dispatch(name) {
      for (const callback of listeners.get(name) ?? []) callback();
    },
    listenerCount(name) {
      return listeners.get(name)?.size ?? 0;
    },
  };
}

function fakeTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    clearTimer(id) {
      callbacks.delete(id);
    },
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
    pendingCount() {
      return callbacks.size;
    },
    setTimer(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
  };
}

function fakeBrowser(search = "", webdriver = false, hostname = "app.hypertask.ai") {
  const values = new Map();
  return {
    browser: {
      location: { hostname, search },
      navigator: { webdriver },
      sessionStorage: {
        getItem: (key) => values.get(key) ?? null,
        removeItem: (key) => values.delete(key),
        setItem: (key, value) => values.set(key, value),
      },
    },
    values,
  };
}

function fakeHeadlessBrowser(search = "") {
  const result = fakeBrowser(search);
  result.browser.navigator.userAgent =
    "Mozilla/5.0 HeadlessChrome/147.0.0.0 Safari/537.36";
  return result;
}

test("automated browser contexts always disable realtime", () => {
  const { REALTIME_DISABLED_STORAGE_KEY, realtimeDisabledForBrowser } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const { browser, values } = fakeBrowser("?realtime=on", true);
  assert.equal(realtimeDisabledForBrowser(browser), true);
  assert.equal(values.get(REALTIME_DISABLED_STORAGE_KEY), "1");
});

test("localhost browser smoke can opt an automated browser into realtime", () => {
  const { REALTIME_DISABLED_STORAGE_KEY, realtimeDisabledForBrowser } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const { browser, values } = fakeBrowser("?realtime=on", true, "127.0.0.1");

  assert.equal(realtimeDisabledForBrowser(browser), false);
  assert.equal(values.has(REALTIME_DISABLED_STORAGE_KEY), false);
});

test("a local verify build takes realtime in an automated browser with no query flag", () => {
  const previous = process.env.NEXT_PUBLIC_HT_LOCAL_REALTIME;
  process.env.NEXT_PUBLIC_HT_LOCAL_REALTIME = "1";
  const { REALTIME_DISABLED_STORAGE_KEY, realtimeDisabledForBrowser } = loadTs(
    "src/lib/realtime/client.ts",
  );
  try {
    const local = fakeBrowser("", true, "127.0.0.1");
    local.values.set(REALTIME_DISABLED_STORAGE_KEY, "1");
    assert.equal(realtimeDisabledForBrowser(local.browser), false);
    assert.equal(local.values.has(REALTIME_DISABLED_STORAGE_KEY), false);

    const headless = fakeHeadlessBrowser();
    headless.browser.location.hostname = "127.0.0.1";
    assert.equal(realtimeDisabledForBrowser(headless.browser), false);

    const managed = fakeBrowser("", true, "127.0.0.1");
    managed.browser.__multipromptNotificationClickBridgeInstalled = true;
    assert.equal(realtimeDisabledForBrowser(managed.browser), true);

    const localhost = fakeBrowser("", true, "localhost");
    assert.equal(realtimeDisabledForBrowser(localhost.browser), false);

    const off = fakeBrowser("?realtime=off", true, "127.0.0.1");
    assert.equal(realtimeDisabledForBrowser(off.browser), true);

    const production = fakeBrowser("", true, "app.hypertask.ai");
    assert.equal(realtimeDisabledForBrowser(production.browser), true);
    assert.equal(production.values.get(REALTIME_DISABLED_STORAGE_KEY), "1");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_HT_LOCAL_REALTIME;
    else process.env.NEXT_PUBLIC_HT_LOCAL_REALTIME = previous;
  }
});

test("a build whose public base URL is loopback takes realtime without the opt-in flag", () => {
  const previous = process.env.NEXT_PUBLIC_BASEURL;
  process.env.NEXT_PUBLIC_BASEURL = "http://127.0.0.1:3100";
  const {
    REALTIME_DISABLED_STORAGE_KEY,
    localRealtimeOptedIn,
    realtimeDisabledForBrowser,
  } = loadTs("src/lib/realtime/client.ts");
  try {
    assert.equal(localRealtimeOptedIn("127.0.0.1"), true);
    assert.equal(localRealtimeOptedIn("app.hypertask.ai"), false);

    const headless = fakeHeadlessBrowser();
    headless.browser.location.hostname = "127.0.0.1";
    assert.equal(realtimeDisabledForBrowser(headless.browser), false);

    const production = fakeBrowser("", true, "app.hypertask.ai");
    assert.equal(realtimeDisabledForBrowser(production.browser), true);
    assert.equal(production.values.get(REALTIME_DISABLED_STORAGE_KEY), "1");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BASEURL;
    else process.env.NEXT_PUBLIC_BASEURL = previous;
  }
});

test("a non-loopback public base URL is not a local copy", () => {
  const previous = process.env.NEXT_PUBLIC_BASEURL;
  process.env.NEXT_PUBLIC_BASEURL = "https://app.hypertask.ai";
  const { localRealtimeOptedIn, realtimeDisabledForBrowser } = loadTs(
    "src/lib/realtime/client.ts",
  );
  try {
    assert.equal(localRealtimeOptedIn("127.0.0.1"), false);
    const { browser } = fakeHeadlessBrowser();
    browser.location.hostname = "127.0.0.1";
    assert.equal(realtimeDisabledForBrowser(browser), true);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BASEURL;
    else process.env.NEXT_PUBLIC_BASEURL = previous;
  }
});

test("headless agent-browser contexts disable realtime without webdriver", () => {
  const { REALTIME_DISABLED_STORAGE_KEY, realtimeDisabledForBrowser } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const { browser, values } = fakeHeadlessBrowser("?realtime=on");

  assert.equal(realtimeDisabledForBrowser(browser), true);
  assert.equal(values.get(REALTIME_DISABLED_STORAGE_KEY), "1");
});

test("a production build keeps realtime off for automated browsers on loopback", () => {
  const { realtimeDisabledForBrowser } = loadTs("src/lib/realtime/client.ts");
  const { browser } = fakeBrowser("", true, "127.0.0.1");
  assert.equal(realtimeDisabledForBrowser(browser), true);
});

test("managed Multiprompt agent panes always disable realtime", () => {
  const { REALTIME_DISABLED_STORAGE_KEY, realtimeDisabledForBrowser } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const { browser, values } = fakeBrowser("?realtime=on");
  browser.__multipromptNotificationClickBridgeInstalled = true;
  assert.equal(realtimeDisabledForBrowser(browser), true);
  assert.equal(values.get(REALTIME_DISABLED_STORAGE_KEY), "1");
});

test("a late Multiprompt marker is trapped as soon as the bridge sets it", () => {
  const { installRealtimeAgentMarkerTrap } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const { browser } = fakeBrowser();
  let detections = 0;

  installRealtimeAgentMarkerTrap(browser, () => {
    detections += 1;
  });
  assert.equal(detections, 0);

  browser.__multipromptNotificationClickBridgeInstalled = true;
  assert.equal(detections, 1);
  assert.equal(browser.__multipromptNotificationClickBridgeInstalled, true);
});

test("the agent marker disables realtime for the tab session", () => {
  const { realtimeDisabledForBrowser } = loadTs("src/lib/realtime/client.ts");
  const { browser } = fakeBrowser("?realtime=off");
  assert.equal(realtimeDisabledForBrowser(browser), true);
  browser.location.search = "";
  assert.equal(realtimeDisabledForBrowser(browser), true);
});

test("idle clients disconnect after the grace period", () => {
  const { installRealtimeIdleDisconnect } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const timers = fakeTimers();
  let disconnects = 0;
  const client = {
    allChannels: () => [],
    disconnect: () => {
      disconnects += 1;
    },
  };

  installRealtimeIdleDisconnect({
    client,
    clearTimer: timers.clearTimer,
    setTimer: timers.setTimer,
  });
  assert.equal(timers.pendingCount(), 1);
  timers.flush();
  assert.equal(disconnects, 1);
});

test("clients with active channels remain connected", () => {
  const { installRealtimeIdleDisconnect } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const timers = fakeTimers();
  let disconnects = 0;

  installRealtimeIdleDisconnect({
    client: {
      allChannels: () => [{ name: "private-user-6" }],
      disconnect: () => {
        disconnects += 1;
      },
    },
    clearTimer: timers.clearTimer,
    setTimer: timers.setTimer,
  });
  timers.flush();
  assert.equal(disconnects, 0);
});

test("a new realtime consumer cancels the pending idle disconnect", () => {
  const { installRealtimeIdleDisconnect } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const timers = fakeTimers();
  let disconnects = 0;
  const cancel = installRealtimeIdleDisconnect({
    client: {
      allChannels: () => [],
      disconnect: () => {
        disconnects += 1;
      },
    },
    clearTimer: timers.clearTimer,
    setTimer: timers.setTimer,
  });

  cancel();
  timers.flush();
  assert.equal(disconnects, 0);
});

test("connection-only sessions close after the subscription grace period", () => {
  const { installRealtimeSubscriptionWatchdog } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const timers = fakeTimers();
  const listeners = new Map();
  const calls = [];
  const client = {
    allChannels: () => [
      { name: "private-user-6", subscribed: false },
      { name: "private-project-15", subscribed: false },
    ],
    connection: {
      bind(name, callback) {
        listeners.set(name, callback);
      },
      unbind(name, callback) {
        if (listeners.get(name) === callback) listeners.delete(name);
      },
    },
    disconnect() {
      calls.push("disconnect");
    },
    unsubscribe(name) {
      calls.push(`unsubscribe:${name}`);
    },
  };

  const cleanup = installRealtimeSubscriptionWatchdog({
    client,
    clearTimer: timers.clearTimer,
    setTimer: timers.setTimer,
  });
  timers.flush();

  assert.deepEqual(calls, [
    "unsubscribe:private-user-6",
    "unsubscribe:private-project-15",
    "disconnect",
  ]);
  cleanup();
  assert.equal(listeners.size, 0);
});

test("successfully subscribed human sessions remain connected", () => {
  const { installRealtimeSubscriptionWatchdog } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const timers = fakeTimers();
  let disconnects = 0;
  const client = {
    allChannels: () => [
      { name: "private-user-6", subscribed: true },
      { name: "private-project-15", subscribed: false },
    ],
    connection: { bind() {}, unbind() {} },
    disconnect() {
      disconnects += 1;
    },
    unsubscribe() {},
  };

  installRealtimeSubscriptionWatchdog({
    client,
    clearTimer: timers.clearTimer,
    setTimer: timers.setTimer,
  });
  timers.flush();

  assert.equal(disconnects, 0);
});

test("a human can explicitly restore realtime in a marked tab", () => {
  const { realtimeDisabledForBrowser } = loadTs("src/lib/realtime/client.ts");
  const { browser } = fakeBrowser("?realtime=off");
  assert.equal(realtimeDisabledForBrowser(browser), true);
  browser.location.search = "?realtime=on";
  assert.equal(realtimeDisabledForBrowser(browser), false);
  browser.location.search = "";
  assert.equal(realtimeDisabledForBrowser(browser), false);
});

test("a pending connection attempt is rejected after realtime is disabled", () => {
  const { realtimeConnectionAttemptAllowed, realtimeDisabledForBrowser } =
    loadTs("src/lib/realtime/client.ts");
  const { browser } = fakeBrowser();
  const attemptGeneration = 4;

  assert.equal(
    realtimeConnectionAttemptAllowed(browser, attemptGeneration, 4),
    true,
  );
  browser.location.search = "?realtime=off";
  assert.equal(realtimeDisabledForBrowser(browser), true);
  assert.equal(
    realtimeConnectionAttemptAllowed(browser, attemptGeneration, 4),
    false,
  );
  browser.location.search = "?realtime=on";
  assert.equal(
    realtimeConnectionAttemptAllowed(browser, attemptGeneration, 5),
    false,
  );
});

test("a background-restored tab waits until visible before creating realtime", async () => {
  const { waitForVisibleDocument } = loadTs("src/lib/realtime/client.ts");
  const documentTarget = fakeDocument("hidden");
  let resolved = false;
  const visible = waitForVisibleDocument(documentTarget).then(() => {
    resolved = true;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolved, false);
  assert.equal(documentTarget.listenerCount("visibilitychange"), 1);

  documentTarget.visibilityState = "visible";
  documentTarget.dispatch("visibilitychange");
  await visible;
  assert.equal(resolved, true);
  assert.equal(documentTarget.listenerCount("visibilitychange"), 0);
});

test("hidden tabs disconnect after grace and reconnect when visible", () => {
  const { installRealtimeVisibilityLifecycle } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const documentTarget = fakeDocument("visible");
  const pageTarget = fakeEventTarget();
  const timers = fakeTimers();
  const calls = [];
  const client = {
    allChannels: () => [{ name: "private-project-15" }],
    connection: { state: "connected" },
    connect() {
      calls.push("connect");
      this.connection.state = "connected";
    },
    disconnect() {
      calls.push("disconnect");
      this.connection.state = "disconnected";
    },
  };
  const cleanup = installRealtimeVisibilityLifecycle({
    client,
    documentTarget,
    pageTarget,
    disconnectDelayMs: 30_000,
    clearTimer: timers.clearTimer,
    setTimer: timers.setTimer,
  });

  documentTarget.visibilityState = "hidden";
  documentTarget.dispatch("visibilitychange");
  assert.equal(timers.pendingCount(), 1);
  assert.deepEqual(calls, []);

  timers.flush();
  assert.deepEqual(calls, ["disconnect"]);

  documentTarget.visibilityState = "visible";
  documentTarget.dispatch("visibilitychange");
  assert.deepEqual(calls, ["disconnect", "connect"]);

  cleanup();
  assert.equal(documentTarget.listenerCount("visibilitychange"), 0);
  assert.equal(pageTarget.listenerCount("pagehide"), 0);
  assert.equal(pageTarget.listenerCount("pageshow"), 0);
});

test("quick tab switches cancel the pending disconnect", () => {
  const { installRealtimeVisibilityLifecycle } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const documentTarget = fakeDocument("visible");
  const pageTarget = fakeEventTarget();
  const timers = fakeTimers();
  let disconnects = 0;
  const client = {
    allChannels: () => [{ name: "private-project-15" }],
    connection: { state: "connected" },
    connect() {},
    disconnect() {
      disconnects += 1;
      this.connection.state = "disconnected";
    },
  };
  installRealtimeVisibilityLifecycle({
    client,
    documentTarget,
    pageTarget,
    clearTimer: timers.clearTimer,
    setTimer: timers.setTimer,
  });

  documentTarget.visibilityState = "hidden";
  documentTarget.dispatch("visibilitychange");
  documentTarget.visibilityState = "visible";
  documentTarget.dispatch("visibilitychange");
  timers.flush();

  assert.equal(disconnects, 0);
});

test("visibility changes do not reconnect a client without channels", () => {
  const { installRealtimeVisibilityLifecycle } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const documentTarget = fakeDocument("hidden");
  const pageTarget = fakeEventTarget();
  let connects = 0;
  const client = {
    allChannels: () => [],
    connection: { state: "disconnected" },
    connect() {
      connects += 1;
    },
    disconnect() {},
  };
  installRealtimeVisibilityLifecycle({ client, documentTarget, pageTarget });

  documentTarget.visibilityState = "visible";
  documentTarget.dispatch("visibilitychange");
  pageTarget.dispatch("pageshow");
  assert.equal(connects, 0);
});

test("pagehide releases the connection immediately", () => {
  const { installRealtimeVisibilityLifecycle } = loadTs(
    "src/lib/realtime/client.ts",
  );
  const documentTarget = fakeDocument("visible");
  const pageTarget = fakeEventTarget();
  const calls = [];
  const client = {
    allChannels: () => [{ name: "private-project-15" }],
    connection: { state: "connected" },
    connect() {
      calls.push("connect");
      this.connection.state = "connected";
    },
    disconnect() {
      calls.push("disconnect");
      this.connection.state = "disconnected";
    },
  };
  installRealtimeVisibilityLifecycle({ client, documentTarget, pageTarget });

  assert.equal(documentTarget.listenerCount("pagehide"), 0);
  assert.equal(documentTarget.listenerCount("pageshow"), 0);
  assert.equal(pageTarget.listenerCount("pagehide"), 1);
  assert.equal(pageTarget.listenerCount("pageshow"), 1);

  pageTarget.dispatch("pagehide");
  pageTarget.dispatch("pageshow");
  assert.deepEqual(calls, ["disconnect", "connect"]);
});
