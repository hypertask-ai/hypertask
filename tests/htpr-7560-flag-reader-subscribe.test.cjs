const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { renderToString } = require("react-dom/server");
const { hydrateRoot } = require("react-dom/client");
const { QueryClient, QueryClientProvider, notifyManager } = require("@tanstack/react-query");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

function load(relative, mocks = {}) {
  const compiled = ts.transpileModule(read(relative), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => name in mocks ? mocks[name] : require(name), exports);
  return exports;
}

const hydration = load("src/hooks/General/useHydrated.ts");
const flags = load("src/hooks/useFlag.tsx", {
  "@/hooks/General/useHydrated": hydration,
  "@/lib/realtime/client": { connectRealtimeClient: async () => null, releaseRealtimeClientIfIdle() {} },
  "@/lib/realtime/shared": { FEATURE_FLAGS_EVENT: "flags", featureFlagsChannel: () => "flags" },
});
const definitions = require("./helpers/flag-files.cjs").definitions();
const keys = definitions.map(definition => definition.key);
const flagKey = "htpr-7560-flag-reader-subscribe";
const now = "2026-10-22T12:00:00.000Z";
const seed = values => ({ accountId: 985, evaluatedAt: now, values });
const valuesFor = offset => Object.fromEntries(keys.map((key, index) => [key, (index + offset) % 2 === 0]));
const expected = (values, key, fallback = false) => [values[key] === true, Object.hasOwn(values, key), Object.hasOwn(values, key) || fallback];
const providers = [flags.FeatureFlagProvider, flags.SubscribedFeatureFlagProvider];
notifyManager.setScheduler(queueMicrotask);

async function withFlags({ Provider, initialFlags, saved, children, userId = 985 }, run) {
  const names = ["window", "document", "fetch", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(global, name)]);
  const options = { defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity, structuralSharing: false } } };
  const serverClient = new QueryClient(options);
  const client = new QueryClient(options);
  const pending = [];
  const requests = [];
  const errors = [];
  let dom, instance;
  const tree = (queryClient, accountId = userId, child = children) => React.createElement(QueryClientProvider, { client: queryClient },
    React.createElement(Provider, { userId: accountId, initialFlags }, child));
  try {
    delete global.window;
    delete global.document;
    const html = renderToString(tree(serverClient));
    dom = new JSDOM(`<div id="root">${html}</div>`, { url: "https://app.hypertask.ai/inbox" });
    Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    global.fetch = (url, options) => {
      requests.push({ url, options });
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    };
    if (saved) client.setQueryData(flags.featureFlagsQueryKey(userId), saved, { updatedAt: Date.parse(now) + 1000 });
    await React.act(async () => {
      instance = hydrateRoot(document.getElementById("root"), tree(client), { onRecoverableError: error => errors.push(error) });
    });
    const refetch = async (values, fail = false) => React.act(async () => {
      const finished = client.refetchQueries({ queryKey: flags.featureFlagsQueryKey(userId) });
      assert.ok(pending.length > 0, "the real provider must request flags");
      for (const request of pending.splice(0)) {
        if (fail) request.reject(new Error("Flags unavailable"));
        else request.resolve({ ok: true, json: async () => ({ flags: values }) });
      }
      await finished;
    });
    await run({ html, document: dom.window.document, client, errors, requests, refetch,
      render: async (accountId, child = children) => React.act(async () => instance.render(tree(client, accountId, child))) });
    assert.deepEqual(errors, [], "hydration must not replace server markup");
    for (const request of requests) {
      assert.equal(request.url, "/api/flags");
      assert.deepEqual(request.options, { cache: "no-store" });
    }
  } finally {
    if (instance) await React.act(async () => instance.unmount());
    serverClient.clear();
    client.clear();
    dom?.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

function readerTree(observedKeys, history) {
  function Reader({ flag }) {
    const result = [flags.useFlag(flag), flags.useFlagLoaded(flag), flags.useFlagReady(flag)];
    const renders = history.get(flag) ?? [];
    renders.push(result);
    history.set(flag, renders);
    return React.createElement("output", { "data-key": flag }, JSON.stringify(result));
  }
  return observedKeys.map(key => React.createElement(Reader, { key, flag: key }));
}

function assertAnswers(document, values, fallback = false) {
  const outputs = new Map([...document.querySelectorAll("output")].map(node => [node.dataset.key, node.textContent]));
  assert.equal(outputs.size, keys.length);
  for (const key of keys) assert.deepEqual(JSON.parse(outputs.get(key)), expected(values, key, fallback), key);
}

test("the ticket flag is an Everyone improvement with a release risk and a server-selected provider", () => {
  const definition = definitions.find(item => item.key === flagKey);
  assert.equal(definition.kind, "improvement");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
  assert.equal(definition.releaseRisk.highRisk, undefined);
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /isFeatureEnabled\(HTPR_7560_FLAG_READER_SUBSCRIBE_FLAG, analyticsSession\?\.id \?\? -1\)/);
  assert.match(layout, /flagProvider=\{flagReaderSubscribe \? SubscribedFeatureFlagProvider : FeatureFlagProvider\}/);
  assert.match(read("src/utils/Providers.tsx"), /flagProvider: FlagProvider = FeatureFlagProvider,/);
  assert.match(read("src/utils/Providers.tsx"), /<FlagProvider userId=\{authenticatedUserId\} initialFlags=\{snapshot\?\.flags \?\? shell\?\.flags \?\? flagSeed \?\? undefined\}>/);
});

test("every registry key has the same answers Off and On before load, with saved flags, and after fetch", async () => {
  assert.ok(keys.length > 0);
  assert.equal(new Set(keys).size, keys.length);
  const seeded = valuesFor(0), saved = valuesFor(1), fetched = valuesFor(2);
  const partial = Object.fromEntries(keys.filter((_, index) => index % 3 === 0).map(key => [key, seeded[key]]));
  for (const scenario of [
    { name: "no saved flags", before: {}, after: {} },
    { name: "saved flags without a seed", saved, before: {}, after: saved },
    { name: "matching seed and newer saved flags", initialFlags: seed(seeded), saved, before: seeded, after: saved },
    { name: "partial seed and newer saved flags", initialFlags: seed(partial), saved, before: partial, after: saved },
    { name: "invalid seed", initialFlags: { ...seed(seeded), evaluatedAt: "invalid" }, saved, before: {}, after: saved },
    { name: "other account seed", initialFlags: { ...seed(seeded), accountId: 7 }, saved, before: {}, after: saved },
  ]) {
    const markup = [];
    for (const Provider of providers) {
      const history = new Map();
      await withFlags({ Provider, ...scenario, children: readerTree(keys, history) }, async ({ html, document, refetch }) => {
        markup.push(html);
        for (const key of keys) {
          assert.deepEqual(history.get(key)[0], expected(scenario.before, key), `${scenario.name} SSR ${key}`);
          assert.deepEqual(history.get(key)[1], expected(scenario.before, key), `${scenario.name} first hydration ${key}`);
        }
        assertAnswers(document, scenario.after);
        await refetch(fetched);
        assertAnswers(document, fetched);
        await refetch({});
        assertAnswers(document, {});
      });
    }
    assert.equal(markup[0], markup[1], scenario.name);
  }
});

test("a seed-only hydration redraws no subscribed readers when its answers stay equal", async () => {
  const values = valuesFor(0);
  for (const Provider of providers) {
    const history = new Map();
    await withFlags({ Provider, initialFlags: seed(values), children: readerTree(keys, history) }, async ({ document, requests }) => {
      assertAnswers(document, values);
      assert.equal(requests.length, 0);
      for (const key of keys) {
        if (Provider === flags.SubscribedFeatureFlagProvider) assert.equal(history.get(key).length, 2, key);
        else assert.ok(history.get(key).length > 2, key);
      }
    });
  }
});

test("an identical refetch redraws zero readers On and all N readers Off; a changed key isolates its readers", async () => {
  const observedKeys = [flagKey, ...keys.filter(key => key !== flagKey).slice(0, 2)];
  const initial = Object.fromEntries(observedKeys.map(key => [key, false]));
  for (const Provider of providers) {
    const counts = new Map();
    function Reader({ flag, id }) {
      const value = flags.useFlag(flag);
      counts.set(id, (counts.get(id) ?? 0) + 1);
      return React.createElement("output", { "data-key": id }, String(value));
    }
    const children = observedKeys.flatMap(key => [0, 1].map(index => {
      const id = `${key}:${index}`;
      return React.createElement(Reader, { key: id, id, flag: key });
    }));
    const N = children.length;
    await withFlags({ Provider, initialFlags: seed(initial), children }, async ({ refetch, document }) => {
      counts.clear();
      await refetch({ ...initial });
      assert.equal([...counts.values()].reduce((sum, count) => sum + count, 0), Provider === flags.SubscribedFeatureFlagProvider ? 0 : N);
      counts.clear();
      await refetch({ ...initial, [flagKey]: true });
      for (const key of observedKeys) {
        for (const index of [0, 1]) {
          const id = `${key}:${index}`;
          assert.equal(counts.get(id) ?? 0, Provider === flags.SubscribedFeatureFlagProvider && key !== flagKey ? 0 : 1, id);
        }
      }
      assert.equal([...document.querySelectorAll("output")].filter(node => node.textContent === "true").length, 2);
    });
  }
});

test("presence and error fallback update only the hook whose answer changed", async () => {
  for (const Provider of providers) {
    const counts = { value: 0, loaded: 0, ready: 0 };
    function Value() { counts.value++; return React.createElement("output", { id: "value" }, String(flags.useFlag(flagKey))); }
    function Loaded() { counts.loaded++; return React.createElement("output", { id: "loaded" }, String(flags.useFlagLoaded(flagKey))); }
    function Ready() { counts.ready++; return React.createElement("output", { id: "ready" }, String(flags.useFlagReady(flagKey))); }
    const children = React.createElement(React.Fragment, null, React.createElement(Value), React.createElement(Loaded), React.createElement(Ready));
    await withFlags({ Provider, initialFlags: seed({}), children }, async ({ refetch, document }) => {
      const answers = () => ["value", "loaded", "ready"].map(id => document.getElementById(id).textContent);
      const clear = () => { counts.value = 0; counts.loaded = 0; counts.ready = 0; };
      assert.deepEqual(answers(), ["false", "false", "false"]);
      clear();
      await refetch({ [flagKey]: false });
      assert.deepEqual(answers(), ["false", "true", "true"]);
      if (Provider === flags.SubscribedFeatureFlagProvider) assert.deepEqual(counts, { value: 0, loaded: 1, ready: 1 });
      await refetch({});
      assert.deepEqual(answers(), ["false", "false", "false"]);
      clear();
      await refetch({}, true);
      assert.deepEqual(answers(), ["false", "false", "true"]);
      if (Provider === flags.SubscribedFeatureFlagProvider) assert.deepEqual(counts, { value: 0, loaded: 0, ready: 1 });
      clear();
      await refetch({});
      assert.deepEqual(answers(), ["false", "false", "false"]);
      if (Provider === flags.SubscribedFeatureFlagProvider) assert.deepEqual(counts, { value: 0, loaded: 0, ready: 1 });
    });
  }
});

test("account switches cannot expose the old seed or store", async () => {
  for (const Provider of providers) {
    const history = new Map();
    await withFlags({ Provider, initialFlags: seed({ [flagKey]: true }), children: readerTree([flagKey], history) }, async ({ client, render, document }) => {
      client.setQueryData(flags.featureFlagsQueryKey(7), { [flagKey]: false });
      await render(7);
      assert.deepEqual(JSON.parse(document.querySelector("output").textContent), [false, true, true]);
      await render(null);
      assert.deepEqual(JSON.parse(document.querySelector("output").textContent), [false, false, false]);
    });
  }
});

test("late unseeded readers keep their hydration answer while the provider has already loaded saved flags", async () => {
  for (const Provider of providers) {
    const history = new Map();
    const values = valuesFor(0);
    let delayed = false, released = false, release;
    const pending = new Promise(resolve => { release = resolve; });
    function Reader({ flag }) {
      const result = [flags.useFlag(flag), flags.useFlagLoaded(flag)];
      const renders = history.get(flag) ?? [];
      renders.push(result);
      history.set(flag, renders);
      return React.createElement("output", { "data-key": flag }, JSON.stringify(result));
    }
    const readers = keys.map(key => React.createElement(Reader, { key, flag: key }));
    function Delayed() {
      if (delayed && !released) throw pending;
      return readers;
    }
    function Marker() {
      return React.createElement("label", null, hydration.useHydrated() ? "ready" : "server");
    }
    const children = React.createElement(React.Fragment, null,
      React.createElement(Marker), React.createElement(React.Suspense, { fallback: "Loading" }, React.createElement(Delayed)));
    function DeferringProvider(props) {
      const result = React.createElement(Provider, props);
      if (typeof window !== "undefined") delayed = true;
      return result;
    }
    await withFlags({ Provider: DeferringProvider, saved: values, children }, async ({ document, errors }) => {
      assert.equal(document.querySelector("label").textContent, "ready");
      for (const key of keys) assert.equal(history.get(key).length, 1);
      await React.act(async () => { released = true; release(); });
      for (const key of keys) {
        assert.deepEqual(history.get(key)[0], [false, false]);
        assert.deepEqual(history.get(key)[1], [false, false]);
        assert.deepEqual(history.get(key).at(-1), expected(values, key).slice(0, 2));
      }
      assert.deepEqual(errors, []);
    });
  }
});
