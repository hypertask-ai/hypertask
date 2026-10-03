const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");

const root = path.resolve(__dirname, "..");
const QUERY_KEY = ["admin-feature-flags"];
function stub(filename, exports) {
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}
let owner = true;
let reads = 0;
let rows = [];
stub(path.join(root, "src/lib/flags.ts"), {
  isFeatureFlagOwner: async () => owner,
  listFeatureFlagModes: async () => { reads++; return rows; },
});
stub(path.join(root, "src/hooks/useFlag.tsx"), {
  ADMIN_FEATURE_FLAGS_QUERY_KEY: QUERY_KEY,
  FEATURE_FLAGS_QUERY_PREFIX: ["feature-flags"],
  useFlag: () => true,
});
stub(require.resolve("next/headers"), { headers: async () => new Headers() });
stub(require.resolve("next/navigation"), { notFound: () => { throw new Error("NOT_FOUND"); } });
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false, jsx: { runtime: "automatic" } });
const Admin = jiti(path.join(root, "src/app/admin/flags/FeatureFlagsAdmin.tsx")).default;
const Overview = jiti(path.join(root, "src/app/admin/flags/page.tsx")).default;
const Detail = jiti(path.join(root, "src/app/admin/flags/[key]/page.tsx")).default;
const fixture = (key, extra = {}) => ({
  key, mode: "OWNER_AND_QA", description: `Description for ${key}`, shippedOn: "2026-10-03",
  updatedAt: null, releasedAt: null, keep: false, removalTaskId: null,
  ticketId: null, ticketUrl: null, ticketTitle: null, ...extra,
});
const detail = (key) => Detail({ params: Promise.resolve({ key }) });

test.beforeEach(() => {
  owner = true; reads = 0;
  rows = [fixture("htpr-6752-instant-ticket-open"), fixture("yper4-123-board-check")];
});

test("both server pages reject non-owners before reading flags", async () => {
  owner = false;
  await assert.rejects(Overview(), /NOT_FOUND/);
  await assert.rejects(detail(rows[0].key), /NOT_FOUND/);
  assert.equal(reads, 0);
});

test("known and legacy flags reuse the admin component; unknown keys return not found", async () => {
  rows.push(fixture("legacy-rollout", { shippedOn: null }));
  for (const row of rows) {
    const page = await detail(row.key);
    assert.equal(page.type, Admin);
    assert.deepEqual(page.props, { flagKey: row.key });
  }
  await assert.rejects(detail("unknown-flag"), /NOT_FOUND/);
  assert.equal((await Overview()).type, Admin);
});

async function withAdmin(props, data, run) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/admin/flags" });
  const names = ["window", "self", "document", "HTMLElement", "navigator", "IS_REACT_ACT_ENVIRONMENT", "fetch"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  let reactRoot;
  let fail = false;
  let current = data;
  const calls = [];
  try {
    for (const name of ["window", "self", "document", "HTMLElement", "navigator"]) {
      Object.defineProperty(global, name, { value: name === "window" ? dom.window : dom.window[name], configurable: true, writable: true });
    }
    global.IS_REACT_ACT_ENVIRONMENT = true;
    global.fetch = async (url, options = {}) => {
      calls.push({ url, ...options });
      if (options.method === "PATCH") {
        if (fail) return Response.json({ error: "Update unavailable" }, { status: 500 });
        const input = JSON.parse(options.body);
        current = { ...current, flags: current.flags.map((row) => row.key === input.key ? { ...row, ...input } : row) };
        return Response.json({ flag: current.flags.find((row) => row.key === input.key) });
      }
      return Response.json(current);
    };
    client.setQueryData(QUERY_KEY, data);
    const { createRoot } = require("react-dom/client");
    reactRoot = createRoot(document.getElementById("root"));
    await React.act(async () => reactRoot.render(React.createElement(QueryClientProvider, { client }, React.createElement(Admin, props))));
    const settle = () => React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    const click = async (button) => {
      await React.act(async () => button.click());
      await settle();
    };
    await run({ document, client, calls, click, settle, setFail: () => { fail = true; } });
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    client.clear();
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

for (const detailsEnabled of [true, false]) {
  test(`overview keys link to pages across metadata and title variants (details=${detailsEnabled})`, async () => {
    rows[0] = { ...rows[0], ticketTitle: "Instant ticket open", ticketUrl: "https://app.hypertask.ai/detail/project-15/6752" };
    await withAdmin({}, { flags: rows, detailsEnabled }, async ({ document }) => {
      for (const row of rows) {
        const code = [...document.querySelectorAll("code")].find((node) => node.textContent === row.key);
        assert.equal(code.closest("a").getAttribute("href"), `/admin/flags/${row.key}`);
      }
    });
  });
}

for (const [key, project, number] of [["htpr-6752-instant-ticket-open", 15, 6752], ["yper4-123-board-check", 4060, 123]]) {
  test(`detail shows just ${key}, metadata, audience, ticket and back link even when overview details are off`, async () => {
    await withAdmin({ flagKey: key }, { flags: rows, detailsEnabled: false }, async ({ document }) => {
      assert.equal(document.querySelector("h1").textContent, key);
      assert.equal(document.querySelectorAll("code").length, 1);
      assert.match(document.body.textContent, new RegExp(`Description for ${key}`));
      assert.equal(document.querySelector("time").getAttribute("datetime"), "2026-10-03");
      assert.equal(document.querySelector('a[href="/admin/flags"]').textContent, "Back to all flags");
      assert.ok(document.querySelector(`a[href="https://app.hypertask.ai/detail/project-${project}/${number}"]`));
      assert.equal(document.querySelector('[aria-label="Filter by audience"]'), null);
      const active = document.querySelector('button[aria-pressed="true"]');
      assert.equal(active.textContent, "Owner + QA");
      assert.equal(document.querySelectorAll("button").length, 4);
    });
  });
}

test("legacy detail has no invented ticket or shipped date; missing client row has a plain not-found state", async () => {
  await withAdmin({ flagKey: "legacy-rollout" }, { flags: [fixture("legacy-rollout", { shippedOn: null })], detailsEnabled: true }, async ({ document }) => {
    assert.match(document.body.textContent, /Shipped: Not recorded/);
    assert.equal(document.querySelector('a[href^="https://app.hypertask.ai/detail/"]'), null);
  });
  await withAdmin({ flagKey: "missing" }, { flags: rows, detailsEnabled: true }, async ({ document }) => {
    assert.match(document.body.textContent, /Feature flag not found\./);
    assert.equal(document.querySelectorAll("button").length, 0);
  });
});

for (const singleFlag of [false, true]) {
  test(`shared controls PATCH the existing API, refetch, invalidate and roll back failures (detail=${singleFlag})`, async () => {
    const row = fixture("htpr-6752-instant-ticket-open", { mode: "EVERYONE", releasedAt: new Date().toISOString() });
    await withAdmin({ ...(singleFlag ? { flagKey: row.key } : {}) }, { flags: [row], detailsEnabled: true }, async ({ document, client, calls, click, setFail }) => {
      const invalidated = [];
      const invalidate = client.invalidateQueries.bind(client);
      client.invalidateQueries = (options) => { invalidated.push(options.queryKey); return invalidate(options); };
      const button = (label) => [...document.querySelectorAll(label === "Keep" ? "button" : '[role="group"][aria-label^="Mode for"] button')].find((node) => node.textContent === label);
      await click(button("Keep"));
      assert.deepEqual(JSON.parse(calls.find((call) => call.method === "PATCH").body), { key: row.key, keep: true });
      assert.equal(button("Keep").getAttribute("aria-pressed"), "true");
      await click(button("Off"));
      const patch = calls.filter((call) => call.method === "PATCH").at(-1);
      assert.equal(patch.url, "/api/admin/flags");
      assert.equal(patch.headers["Content-Type"], "application/json");
      assert.deepEqual(JSON.parse(patch.body), { key: row.key, mode: "OFF" });
      assert.equal(button("Off").getAttribute("aria-pressed"), "true");
      assert.ok(calls.some((call) => !call.method && call.url === "/api/admin/flags" && call.cache === "no-store"));
      assert.ok(invalidated.some((key) => key[0] === "feature-flags"));
      assert.ok(invalidated.some((key) => key[0] === "admin-feature-flags"));
      setFail();
      await click(button("Owner + QA"));
      assert.equal(document.querySelector('[role="alert"]').textContent, "Update unavailable");
      assert.equal(button("Off").getAttribute("aria-pressed"), "true");
      assert.equal(button("Owner + QA").getAttribute("aria-pressed"), "false");
    });
  });
}
