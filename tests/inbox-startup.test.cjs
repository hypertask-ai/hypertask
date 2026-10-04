const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { QueryClient } = require("@tanstack/react-query");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const inbox = read("src/app/inbox/Inbox.tsx");
const hook = read("src/hooks/Inbox/useGetNotifications.ts");

function callbacks(source, bindings) {
  const effects = [];
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function("useEffect", ...Object.keys(bindings), js)(
    (effect) => effects.push(effect), ...Object.values(bindings),
  );
  return effects;
}

function initialRead(bindings) {
  const start = hook.indexOf("  // Start the existing fenced read on the first client commit");
  const end = hook.indexOf("  const query = useQuery", start);
  assert.ok(start >= 0 && end > start);
  return callbacks(hook.slice(start, end), bindings)[0];
}

test("first commit starts the account-scoped fenced read; hydrated observers reuse its in-flight request", async () => {
  const client = new QueryClient();
  let resolve, calls = 0;
  const pending = new Promise((done) => { resolve = done; });
  const reads = [];
  const bindings = {
    hydrated: false, userId: 985, queryClient: client, queryKey: ["inbox", "data", 985],
    getStartedAt: () => 42, readinessLatchRef: { current: { claim: () => true } },
    readinessLocalOutcomeRef: { current: { current: "none" } }, INBOX_QUERY_STALE_TIME_MS: 30000,
    fetchInboxPayload: (...args) => { calls++; reads.push(args); return pending; },
  };
  try {
    initialRead(bindings)();
    initialRead(bindings)();
    assert.equal(calls, 1);
    assert.equal(reads[0][0], 985);
    assert.equal(reads[0][1], client);
    assert.equal(reads[0][2], 42);
    const observerRequest = client.fetchQuery({ queryKey: bindings.queryKey, queryFn: () => { throw Error("duplicate request"); }, staleTime: 30000 });
    resolve({ accountId: 985, dataOrigin: "network" });
    assert.equal((await observerRequest).accountId, 985);
    await client.fetchQuery({ queryKey: bindings.queryKey, queryFn: () => { throw Error("settled response not reused"); }, staleTime: 30000 });
    assert.equal(calls, 1);
    initialRead({ ...bindings, hydrated: true })();
    assert.equal(calls, 1, "normal hydrated mounts leave fetching to the observer");
    initialRead({ ...bindings, userId: 986, queryKey: ["inbox", "data", 986] })();
    assert.equal(calls, 2, "accounts never share the early read");
    assert.equal(reads[1][0], 986);
  } finally { client.clear(); }
});

test("early read retains the observer's retry behavior after a transient failure", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const queryKey = ["inbox", "data", 985];
  let calls = 0;
  try {
    initialRead({
      hydrated: false, userId: 985, queryClient: client, queryKey,
      getStartedAt: () => 42, readinessLatchRef: { current: {} },
      readinessLocalOutcomeRef: { current: {} }, INBOX_QUERY_STALE_TIME_MS: 30000,
      fetchInboxPayload: async () => {
        if (++calls === 1) throw Error("transient network failure");
        return { accountId: 985, dataOrigin: "network" };
      },
    })();
    const result = await client.fetchQuery({ queryKey, queryFn: () => { throw Error("duplicate observer read"); } });
    assert.equal(result.accountId, 985);
    assert.equal(calls, 2);
  } finally { client.clear(); }
});

test("early reads keep the pre-hydration publication boundary and current access/revision fences", () => {
  assert.match(hook, /const query = useQuery\(\{\s*queryKey,\s*\.\.\.\(hydrated[\s\S]*?"hydrating"[\s\S]*?enabled: false/);
  assert.match(hook, /if \(!hydrated\) return;/);
  assert.match(hook, /const \[storedPayload, access\] = await Promise\.all/);
  assert.match(hook, /access\.accountId !== userId/);
  assert.match(hook, /response = await getAllNotifications\(userId\)/);
  assert.match(hook, /authorizationFailureBlocksRevision\(userId, revision\)/);
  assert.match(hook, /Ignored Inbox response after final revision check/);
});

function warmFixture({ fetched = true, ready = true, idle = true } = {}) {
  const calls = [], listeners = new Map(), frames = new Map(), idles = new Map(), timers = new Map();
  let next = 1;
  const window = {
    requestAnimationFrame: (callback) => { const id = next++; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    requestIdleCallback: idle ? (callback, options) => { assert.deepEqual(options, { timeout: 5000 }); const id = next++; idles.set(id, callback); return id; } : undefined,
    cancelIdleCallback: (id) => idles.delete(id),
    setTimeout: (callback, delay) => { assert.equal(delay, 2000); const id = next++; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const start = inbox.indexOf("  useEffect(() => {\n    // Fetch the visible split");
  const end = inbox.indexOf("  const [__notifications", start);
  assert.ok(start >= 0 && end > start);
  const effects = callbacks(inbox.slice(start, end), {
    window, document: {
      addEventListener: (event, callback) => listeners.set(event, callback),
      removeEventListener: (event, callback) => { assert.equal(listeners.get(event), callback); listeners.delete(event); },
    },
    loadInboxSplit: () => { calls.push("split"); return Promise.resolve(); },
    warmCommands: () => calls.push("commands"),
    showCommands: { show: false }, HypertasksCommands: undefined,
    notificationsQuery: { isFetched: fetched }, inboxContentReady: ready,
  });
  const advance = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((f) => f()); };
  return { effects, calls, listeners, frames, idles, timers, advance };
}

test("split starts at mount in parallel with the read, but commands warm only on intent or after actual content paint", () => {
  const cold = warmFixture({ fetched: false, ready: false });
  const cleanup = cold.effects[0]();
  assert.deepEqual(cold.calls, ["split"]);
  assert.deepEqual([...cold.listeners.keys()], ["pointerdown", "touchstart", "keydown"]);
  for (const callback of cold.listeners.values()) callback();
  assert.deepEqual(cold.calls, ["split", "commands", "commands", "commands"]);
  cleanup(); assert.equal(cold.listeners.size, 0);
  for (const [fetched, ready] of [[false, false], [false, true], [true, false]]) {
    const f = warmFixture({ fetched, ready }); f.effects[2]();
    assert.equal(f.frames.size, 0); assert.deepEqual(f.calls, []);
  }
  const f = warmFixture(); const cancel = f.effects[2]();
  f.advance(); assert.equal(f.idles.size, 0);
  f.advance(); assert.equal(f.idles.size, 1); assert.deepEqual(f.calls, []);
  [...f.idles.values()][0](); assert.deepEqual(f.calls, ["commands"]);
  cancel(); assert.equal(f.idles.size, 0);
  assert.match(inbox, /notificationsQuery\.isFetched && notificationsQuery\.isSuccess &&\s*__notifications === _notificationsTQ\?\.structuredData\?\.data/);
  const split = read("src/components/notifications/inboxSplit/index.tsx");
  assert.match(split, /if \(value === index\) onContentReady\?\.\(\);/);
});

test("paint/idle warmups cancel on unmount and use a delayed fallback without changing visible UI", () => {
  for (const stage of [0, 1, 2]) {
    const f = warmFixture(); const cancel = f.effects[2]();
    for (let i = 0; i < stage; i++) f.advance();
    cancel(); assert.equal(f.frames.size + f.idles.size + f.timers.size, 0); assert.deepEqual(f.calls, []);
  }
  const f = warmFixture({ idle: false }); const cancel = f.effects[2]();
  f.advance(); f.advance(); assert.equal(f.timers.size, 1); cancel(); assert.equal(f.timers.size, 0);
  const rejectStatic = (source) => assert.doesNotMatch(source, /import HypertasksCommands from ["']@\/components\/commands["']/);
  assert.throws(() => rejectStatic('import HypertasksCommands from "@/components/commands";'), assert.AssertionError);
  rejectStatic(inbox);
  assert.doesNotMatch(inbox, /Suspense|React\.lazy|loading:\s*\(/);
});
