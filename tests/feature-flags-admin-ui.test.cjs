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
let discoveryEnabled = false;
let reads = 0;
let rows = [];
stub(path.join(root, "src/lib/flags.ts"), {
  isFeatureFlagOwner: async () => owner,
  listFeatureFlagModes: async () => { reads++; return rows; },
});
stub(path.join(root, "src/hooks/useFlag.tsx"), {
  ADMIN_FEATURE_FLAGS_QUERY_KEY: QUERY_KEY,
  FEATURE_FLAGS_QUERY_PREFIX: ["feature-flags"],
  useFlag: (key) => {
    assert.equal(key, "htpr-6964-flags-page-type-search");
    return discoveryEnabled;
  },
});
stub(path.join(root, "src/styles/linksModal.module.scss"), { __esModule: true, default: {} });
stub(require.resolve("next/headers"), { headers: async () => new Headers() });
stub(require.resolve("next/navigation"), { notFound: () => { throw new Error("NOT_FOUND"); } });
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false, jsx: { runtime: "automatic" } });
const Admin = jiti(path.join(root, "src/app/admin/flags/FeatureFlagsAdmin.tsx")).default;
const Overview = jiti(path.join(root, "src/app/admin/flags/page.tsx")).default;
const Detail = jiti(path.join(root, "src/app/admin/flags/[key]/page.tsx")).default;
const fixture = (key, extra = {}) => ({
  key, kind: "feature", mode: "OWNER_AND_QA", description: `Description for ${key}`, shippedOn: "2026-10-03",
  updatedAt: null, releasedAt: null, keep: false, removalTaskId: null,
  ticketId: null, ticketUrl: null, ticketTitle: null, ...extra,
});
const detail = (key) => Detail({ params: Promise.resolve({ key }) });

test.beforeEach(() => {
  owner = true; reads = 0; discoveryEnabled = false;
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
  let patchGate;
  let releasePatch;
  const calls = [];
  try {
    for (const name of ["window", "self", "document", "HTMLElement", "navigator"]) {
      Object.defineProperty(global, name, { value: name === "window" ? dom.window : dom.window[name], configurable: true, writable: true });
    }
    global.IS_REACT_ACT_ENVIRONMENT = true;
    global.fetch = async (url, options = {}) => {
      calls.push({ url, ...options });
      if (options.method === "PATCH") {
        if (patchGate) await patchGate;
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
    const pausePatch = () => {
      patchGate = new Promise((resolve) => { releasePatch = resolve; });
      return () => { releasePatch(); patchGate = undefined; };
    };
    await run({ document, client, calls, click, settle, pausePatch, setFail: () => { fail = true; } });
  } finally {
    releasePatch?.();
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

test("overview counts every audience and Unreleased filters exactly the release pile", async () => {
  const flags = [
    fixture("owner", { mode: "OWNER_ONLY" }),
    fixture("qa", { mode: "OWNER_AND_QA" }),
    fixture("released", { mode: "EVERYONE" }),
    fixture("hidden", { mode: "OFF" }),
  ];
  await withAdmin({}, { flags, detailsEnabled: true }, async ({ document, click }) => {
    const chips = () => [...document.querySelectorAll('[aria-label="Filter by audience"] button')];
    assert.deepEqual(chips().map((button) => button.textContent), ["All 4", "Unreleased 3", "Only me 1", "Owner + QA 1", "Everyone 1", "Off 1"]);
    assert.match(document.body.textContent, /3 unreleased flags waiting for release/);
    for (const [index, keys] of [[1, ["owner", "qa", "hidden"]], [2, ["owner"]], [3, ["qa"]], [4, ["released"]], [5, ["hidden"]], [0, flags.map((flag) => flag.key)]]) {
      await click(chips()[index]);
      assert.deepEqual([...document.querySelectorAll("code")].map((code) => code.textContent).sort(), keys.sort());
      assert.equal(chips()[index].getAttribute("aria-pressed"), "true");
    }
  });
});

test("counts and the active Unreleased list update before PATCH finishes, then roll back a failed release", async () => {
  await withAdmin({}, { flags: [fixture("qa")], detailsEnabled: true }, async ({ document, click, settle, pausePatch, setFail }) => {
    const chip = (label) => [...document.querySelectorAll('[aria-label="Filter by audience"] button')].find((button) => button.textContent.startsWith(`${label} `));
    const mode = (label) => [...document.querySelectorAll('[aria-label^="Mode for"] button')].find((button) => button.textContent === label);
    await click(chip("Unreleased"));
    assert.match(document.body.textContent, /1 unreleased flag waiting for release/);
    const finishRelease = pausePatch();
    await click(mode("Everyone"));
    assert.equal(chip("Unreleased").textContent, "Unreleased 0");
    assert.equal(chip("Everyone").textContent, "Everyone 1");
    assert.equal(document.querySelectorAll("code").length, 0);
    assert.match(document.body.textContent, /No flags match this filter/);
    await React.act(async () => finishRelease());
    await settle();
    await click(chip("All"));
    await click(mode("Owner + QA"));
    assert.equal(chip("Unreleased").textContent, "Unreleased 1");
    await click(chip("Unreleased"));
    setFail();
    const finishFailure = pausePatch();
    await click(mode("Everyone"));
    assert.equal(chip("Unreleased").textContent, "Unreleased 0");
    await React.act(async () => finishFailure());
    await settle();
    assert.equal(chip("All").textContent, "All 1");
    assert.equal(chip("Unreleased").textContent, "Unreleased 1");
    assert.equal(chip("Everyone").textContent, "Everyone 0");
    assert.equal(document.querySelectorAll("code").length, 1);
    assert.equal(document.querySelector('[role="alert"]').textContent, "Update unavailable");
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

test("flag off keeps the original cards, no search, badges, relations, anchors or focus changes", async () => {
  rows[0] = { ...rows[0], related: [rows[1].key], kind: "bugfix" };
  await withAdmin({}, { flags: rows, detailsEnabled: true }, async ({ document }) => {
    assert.equal(document.querySelector('input, .label-pill, [id^="flag-"], [tabindex]'), null);
    assert.doesNotMatch(document.body.textContent, /Related:|Improvement/);
    for (const group of document.querySelectorAll('[aria-label^="Mode for"]')) {
      assert.deepEqual([...group.querySelectorAll("button")].map(button => [button.textContent, button.getAttribute("aria-pressed")]), [
        ["Only me", "false"], ["Owner + QA", "true"], ["Everyone", "false"], ["Off", "false"],
      ]);
      assert.equal(group.parentElement.className, "flex flex-col gap-3 border-b border-border-light-gray-thin p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between");
    }
  });
});

test("flag on shows shared kind labels, sticky search, all-word reduction, empty state and Escape clears", async () => {
  discoveryEnabled = true;
  const flags = [
    fixture("htpr-6853-fast-open", { kind: "bugfix", ticketId: "HTPR-6853", ticketTitle: "Instant details", description: "Comment editor ready" }),
    fixture("htpr-6865-search", { kind: undefined }),
    fixture("htpr-6885-undo", { kind: "improvement" }),
  ];
  await withAdmin({}, { flags, detailsEnabled: true }, async ({ document, calls }) => {
    assert.deepEqual([...document.querySelectorAll(".label-pill")].map(node => node.textContent), ["Bug", "Feature", "Improvement"]);
    const input = document.querySelector('input[type="search"]');
    assert.equal(document.querySelector('label[for="flag-search"]').textContent, "Search flags");
    assert.ok(input.parentElement.classList.contains("sticky"));
    const enter = async (value) => {
      await React.act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, value);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    };
    for (const query of ["6853", "HTPR-6853", "INSTANT ready"]) {
      await enter(query);
      assert.deepEqual([...document.querySelectorAll("code")].map(node => node.textContent), [flags[0].key]);
    }
    await enter("instant missing");
    assert.equal(document.querySelectorAll("code").length, 0);
    assert.match(document.body.textContent, /No flags match this filter/);
    await React.act(async () => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(input.value, "");
    assert.equal(document.querySelectorAll("code").length, 3);
    assert.equal(calls.length, 0, "search must not call the network");
  });
});

test("related link clears filters, reveals its target, scrolls, highlights and focuses without a network read", async () => {
  discoveryEnabled = true;
  const a = fixture("htpr-1-child", { related: ["htpr-2-parent"] });
  const b = fixture("htpr-2-parent", { mode: "OFF" });
  await withAdmin({}, { flags: [a, b], detailsEnabled: true }, async ({ document, click, calls }) => {
    const scrolled = [];
    window.HTMLElement.prototype.scrollIntoView = function (options) { scrolled.push([this.id, options]); };
    await click([...document.querySelectorAll('[aria-label="Filter by audience"] button')].find(button => button.textContent.startsWith("Owner + QA")));
    assert.equal(document.getElementById(`flag-${b.key}`), null);
    const link = document.querySelector(`a[href="#flag-${b.key}"]`);
    assert.equal(link.textContent, b.key);
    await click(link);
    const target = document.getElementById(`flag-${b.key}`);
    assert.ok(target.classList.contains("bg-hover-active"));
    assert.equal(document.activeElement, target);
    assert.equal(scrolled.length, 1);
    assert.equal(scrolled[0][0], target.id);
    assert.equal(document.querySelectorAll("code").length, 2);
    assert.equal(calls.length, 0);
  });
});

test("detail related links point to anchored cards on the overview", async () => {
  discoveryEnabled = true;
  rows[0].related = [rows[1].key];
  await withAdmin({ flagKey: rows[0].key }, { flags: rows, detailsEnabled: true }, async ({ document }) => {
    assert.ok(document.querySelector(`a[href="/admin/flags#flag-${rows[1].key}"]`));
    assert.equal(document.querySelectorAll(".label-pill").length, 1);
    assert.equal(document.querySelector('input[type="search"]'), null);
  });
});
