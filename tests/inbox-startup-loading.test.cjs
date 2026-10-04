const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const inbox = read("src/app/inbox/Inbox.tsx");
const reminder = read("src/components/notifications/inboxSplit/RemindMeInbox.tsx");
const split = read("src/components/notifications/inboxSplit/index.tsx");

function effects(source, bindings) {
  const callbacks = [];
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function("useEffect", ...Object.keys(bindings), js)(
    (callback) => callbacks.push(callback), ...Object.values(bindings),
  );
  return callbacks;
}

const startupEffects = () => {
  const start = inbox.indexOf("  useEffect(() => {\n    // Discover the visible split");
  const end = inbox.indexOf("  const [__notifications", start);
  assert.ok(start >= 0 && end > start, "startup effects must exist");
  return inbox.slice(start, end);
};

function fixture({ fetched = true, ready = true, opened = false, loaded = false, idle = true } = {}) {
  const calls = [];
  const listeners = new Map();
  const frames = new Map();
  const idles = new Map();
  const timers = new Map();
  let nextId = 1;
  const window = {
    requestAnimationFrame(callback) { const id = nextId++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    requestIdleCallback: idle ? (callback, options) => {
      assert.deepEqual(options, { timeout: 5000 });
      const id = nextId++; idles.set(id, callback); return id;
    } : undefined,
    cancelIdleCallback(id) { idles.delete(id); },
    setTimeout(callback, delay) {
      assert.equal(delay, 2000);
      const id = nextId++; timers.set(id, callback); return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  const bindings = {
    window,
    document: {
      addEventListener(event, callback, options) {
        assert.equal(typeof options === "boolean" ? options : options.capture, true);
        listeners.set(event, callback);
      },
      removeEventListener(event, callback, capture) {
        assert.equal(listeners.get(event), callback);
        assert.equal(capture, true);
        listeners.delete(event);
      },
    },
    notificationsQuery: { isFetched: fetched },
    inboxContentReady: ready,
    showCommands: { show: opened },
    HypertasksCommands: loaded ? () => null : undefined,
    warmInboxOverlays: () => calls.push("overlays"),
    loadInboxSplit: () => { calls.push("split"); return Promise.resolve(); },
  };
  const callbacks = effects(startupEffects(), bindings);
  const advance = () => {
    const pending = [...frames]; frames.clear();
    for (const [, callback] of pending) callback();
  };
  return { calls, listeners, frames, idles, timers, callbacks, advance };
}

test("closed inbox overlays have no runtime static import, and both reminder paths share the deferred modal", () => {
  const rejectStatic = (source, module) => assert.doesNotMatch(source, new RegExp(`import[^;\\n]+from ["']${module}["']`));
  assert.throws(() => rejectStatic('import Commands from "@/components/commands";', "@/components/commands"), assert.AssertionError);
  rejectStatic(inbox, "@/components/commands");
  for (const source of [reminder, split]) rejectStatic(source, "@/components/Modals/RemindMe/RemindMeComponent");
  assert.match(reminder, /InboxReminder = dynamic\(loadInboxReminder, \{ ssr: false \}\)/);
  assert.match(split, /import \{ InboxReminder as RemindMeComponent \} from "\.\/RemindMeInbox"/);
  assert.match(reminder, /showRemindMeModal &&\s*<InboxReminder/);
  assert.match(inbox, /showCommands\.show && HypertasksCommands && \(/);
});

test("split code starts on mount without waiting for data or overlay visibility", () => {
  const f = fixture({ fetched: false, ready: false });
  const cleanup = f.callbacks[0]();
  assert.deepEqual(f.calls, ["split"]);
  assert.deepEqual([...f.listeners.keys()], ["pointerdown", "touchstart", "keydown"]);
  f.listeners.get("touchstart")();
  assert.deepEqual(f.calls, ["split", "overlays"], "explicit first-press intent warms before touchend");
  cleanup();
  assert.equal(f.listeners.size, 0);
});

test("automatic warming waits for authoritative data and a committed active split, then two paint frames and idle", () => {
  for (const [fetched, ready] of [[false, false], [false, true], [true, false]]) {
    const f = fixture({ fetched, ready });
    f.callbacks[2]();
    assert.equal(f.frames.size, 0);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture();
  const cleanup = f.callbacks[2]();
  f.advance();
  assert.equal(f.idles.size, 0);
  f.advance();
  assert.equal(f.idles.size, 1);
  assert.deepEqual(f.calls, []);
  [...f.idles.values()][0]();
  assert.deepEqual(f.calls, ["overlays"]);
  cleanup();
  assert.equal(f.idles.size, 0);
  assert.match(inbox, /notificationsQuery\.isFetched && notificationsQuery\.isSuccess &&\s*__notifications === _notificationsTQ\?\.structuredData\?\.data/);
  const start = split.indexOf("  useEffect(() => {\n    if (value === index) onContentReady?.();");
  assert.ok(start >= 0);
  const source = split.slice(start, split.indexOf("  const router", start));
  for (const [value, index, count] of [[0, 1, 0], [1, 1, 1]]) {
    let calls = 0;
    effects(source, { value, index, onContentReady: () => calls++ })[0]();
    assert.equal(calls, count);
  }
});

test("paint/idle/timer warmups cancel on unmount; browsers without idle callbacks keep the existing page", () => {
  for (const stage of [0, 1, 2]) {
    const f = fixture();
    const cleanup = f.callbacks[2]();
    for (let i = 0; i < stage; i++) f.advance();
    cleanup();
    assert.equal(f.frames.size + f.idles.size + f.timers.size, 0);
    assert.deepEqual(f.calls, []);
  }
  const f = fixture({ idle: false });
  const cleanup = f.callbacks[2]();
  f.advance(); f.advance();
  assert.equal(f.timers.size, 1);
  cleanup();
  assert.equal(f.timers.size, 0);
});

test("first programmatic open loads missing commands, and warmed commands use the synchronous component, not React.lazy", () => {
  for (const [opened, loaded, count] of [[false, false, 0], [true, true, 0], [true, false, 1]]) {
    const f = fixture({ opened, loaded });
    f.callbacks[1]();
    assert.equal(f.calls.length, count);
  }
  assert.match(inbox, /loadedCommands = module\.default/);
  assert.match(inbox, /const HypertasksCommands = loadedCommands \?\? commands/);
  assert.doesNotMatch(inbox, /Suspense|React\.lazy|loading:\s*\(/);
  assert.match(inbox, /setCommands\(\(\) => Commands\)/);
});
