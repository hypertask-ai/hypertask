const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createRoot } = require("react-dom/client");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const ts = require("typescript");

const filename = path.join(__dirname, "../src/hooks/Task Detail/useGetComments.ts");
const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: filename,
}).outputText;

async function mountComments(t, { initialData, userId = 2343, enabled, cached } = {}) {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [
    key, Object.getOwnPropertyDescriptor(global, key),
  ]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const queryKey = ["comments-for-taskId:", 42];
  const response = { comments: [{ id: 2 }], stacked: {}, lastReadAt: null };
  if (cached) client.setQueryData(queryKey, cached.data, { updatedAt: cached.updatedAt });
  const calls = [];
  const loaded = { exports: {} };
  const localRequire = (request) => request === "@/utils/api/Task Detail"
    ? { fetchCommentsHelper: async (...args) => { calls.push(args); return response; } }
    : require(request);
  new Function("module", "exports", "require", javascript)(loaded, loaded.exports, localRequire);
  const { useGetAllComments } = loaded.exports;
  function View() {
    useGetAllComments(queryKey, 42, userId, initialData, { enabled });
    return null;
  }
  const root = createRoot(dom.window.document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => root.unmount());
    client.clear();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  await React.act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(View)));
  });
  return { client, queryKey, calls, response, query: client.getQueryCache().find({ queryKey }) };
}

const seed = (updatedAt = Date.now()) => ({
  comments: [{ id: 1 }], stacked: {}, lastReadAt: null, updatedAt,
});

test("fresh SSR comments do not fetch again when the real hook mounts", async (t) => {
  const initialData = seed();
  const { client, queryKey, calls } = await mountComments(t, { initialData });
  assert.equal(calls.length, 0, "fresh server comments must not start a duplicate request");
  assert.deepEqual(client.getQueryData(queryKey), initialData);
});

test("an empty SSR thread is still fresh data", async (t) => {
  const { calls } = await mountComments(t, { initialData: { ...seed(), comments: [] } });
  assert.equal(calls.length, 0);
});

test("old SSR timestamps refetch immediately instead of becoming fresh at mount", async (t) => {
  const { calls, client, response, queryKey } = await mountComments(t, {
    initialData: seed(Date.now() - 31_000),
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), [42, 2343]);
  assert.equal(calls[0][2], client);
  assert.deepEqual(client.getQueryData(queryKey), response);
});

test("pending cached comments fetch immediately rather than becoming a fresh empty thread", async (t) => {
  const { calls, client, queryKey, response } = await mountComments(t, { initialData: { pending: true } });
  assert.equal(calls.length, 1);
  assert.deepEqual(client.getQueryData(queryKey), response);
});

test("missing server comments fetch immediately instead of treating an empty fallback as fresh", async (t) => {
  const { calls } = await mountComments(t);
  assert.equal(calls.length, 1);
});

test("existing prefetched comments retain their age and refetch when stale", async (t) => {
  for (const age of [1_000, 31_000]) {
    await t.test(`cached age ${age}ms`, async (t) => {
      const data = seed();
      const { calls, client, queryKey } = await mountComments(t, {
        initialData: seed(), cached: { data, updatedAt: Date.now() - age },
      });
      assert.equal(calls.length, age < 30_000 ? 0 : 1);
      if (age < 30_000) assert.deepEqual(client.getQueryData(queryKey), data);
    });
  }
});

test("realtime invalidation and explicit refresh still fetch fresh comments", async (t) => {
  const { calls, client, queryKey } = await mountComments(t, { initialData: seed() });
  const atMount = calls.length;
  await React.act(async () => client.invalidateQueries({ queryKey }));
  assert.equal(calls.length, atMount + 1);
  await React.act(async () => client.refetchQueries({ queryKey }));
  assert.equal(calls.length, atMount + 2);
});

test("focus and reconnect reconcile comments after the freshness window expires", async (t) => {
  for (const event of ["onFocus", "onOnline"]) {
    await t.test(event, async (t) => {
      const now = Date.now();
      let clock = now;
      t.mock.method(Date, "now", () => clock);
      const { calls, query } = await mountComments(t, { initialData: seed(now) });
      await React.act(async () => query[event]());
      assert.equal(calls.length, 0, "fresh data should not be fetched on focus/reconnect");
      clock += 31_000;
      await React.act(async () => query[event]());
      assert.equal(calls.length, 1);
    });
  }
});

test("share views and signed-out users do not fetch comments", async (t) => {
  for (const options of [{ enabled: false }, { userId: null }]) {
    await t.test(JSON.stringify(options), async (t) => {
      const { calls } = await mountComments(t, options);
      assert.equal(calls.length, 0);
    });
  }
});
