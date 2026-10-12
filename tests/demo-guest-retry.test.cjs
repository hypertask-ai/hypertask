const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const FLAG = "htpr-7141-demo-guest-retry";
const FRIENDLY = "Could not reach Hypertask. Check your connection.";
const drop = () => new TypeError("Failed to fetch");
const success = () => Response.json({ boardUrl: "/project?id=123" });

function loadPage(file, mocks, browser) {
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", "window", compiled)((name) => {
    if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected demo dependency: ${name}`);
  }, loadedModule, loadedModule.exports, browser);
  return loadedModule.exports.default;
}

async function withDemo(t, enabled, responses, run) {
  const dom = new JSDOM('<div id="root"></div>');
  const names = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(global, name)]);
  const requests = [];
  const navigations = [];
  let reactRoot;
  try {
    for (const name of names) Object.defineProperty(global, name, { value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "window" ? dom.window : dom.window[name], configurable: true, writable: true });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(global, "fetch", async (url, options) => {
      requests.push({ url, options });
      assert.ok(requests.length <= responses.length, "unexpected additional fetch");
      const response = responses[requests.length - 1];
      if (response instanceof Error) throw response;
      return response;
    });
    const file = process.env.DEMO_RETRY_SOURCE || path.join(root, "src/app/(tutorial space)/demo/DemoBoardPage.tsx");
    const Page = loadPage(file, {
      "@/components/LoadingSpinners/LoadingSpinner1": { default: () => React.createElement("span", { "data-spinner": true }) },
    }, { location: { assign: url => navigations.push(url) } });
    reactRoot = require("react-dom/client").createRoot(document.getElementById("root"));
    await React.act(async () => reactRoot.render(React.createElement(React.StrictMode, null, React.createElement(Page, { retryNetworkErrors: enabled }))));
    const advance = async ms => React.act(async () => t.mock.timers.tick(ms));
    const loading = () => {
      assert.ok(document.querySelector("[data-spinner]"));
      assert.match(document.body.textContent, /Creating your private demo board/);
      assert.equal(document.querySelector('[role="alert"]'), null);
      assert.equal(document.querySelector("button"), null);
    };
    const error = message => {
      assert.equal(document.querySelector('[role="alert"]')?.textContent, message);
      assert.equal(document.querySelector("button")?.textContent, "Try again");
      assert.equal(document.querySelector("[data-spinner]"), null);
    };
    await run({ requests, navigations, advance, loading, error });
    for (const request of requests) assert.deepEqual(request, { url: "/api/demo/guest", options: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" } });
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    t.mock.restoreAll();
    t.mock.timers.reset();
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

test("flag on: a network drop keeps the spinner until the 1s retry navigates", async t => {
  await withDemo(t, true, [drop(), success()], async ({ requests, navigations, advance, loading }) => {
    assert.equal(requests.length, 1);
    loading();
    await advance(999);
    assert.equal(requests.length, 1);
    loading();
    await advance(1);
    assert.equal(requests.length, 2);
    assert.deepEqual(navigations, ["/project?id=123"]);
  });
});

test("flag on: a second network drop waits 2s before the last successful attempt", async t => {
  await withDemo(t, true, [drop(), drop(), success()], async ({ requests, navigations, advance, loading }) => {
    await advance(1000);
    assert.equal(requests.length, 2);
    loading();
    await advance(1999);
    assert.equal(requests.length, 2);
    loading();
    await advance(1);
    assert.equal(requests.length, 3);
    assert.deepEqual(navigations, ["/project?id=123"]);
  });
});

for (const status of [429, 500]) {
  test(`flag on: HTTP ${status} is shown without retrying`, async t => {
    await withDemo(t, true, [Response.json({ error: "Please try later" }, { status })], async ({ requests, navigations, advance, error }) => {
      error("Please try later");
      await advance(10000);
      assert.equal(requests.length, 1);
      assert.deepEqual(navigations, []);
    });
  });
}

test("flag on: three network failures show the friendly message; Try again can recover", async t => {
  await withDemo(t, true, [drop(), drop(), drop(), success()], async ({ requests, navigations, advance, loading, error }) => {
    loading();
    await advance(1000);
    loading();
    await advance(2000);
    error(FRIENDLY);
    await advance(10000);
    assert.equal(requests.length, 3);
    assert.deepEqual(navigations, []);
    await React.act(async () => document.querySelector("button").click());
    assert.equal(requests.length, 4);
    assert.deepEqual(navigations, ["/project?id=123"]);
  });
});

test("flag on: a JSON-body network failure after a response is not retried or relabeled", async t => {
  await withDemo(t, true, [{ ok: true, json: async () => { throw drop(); } }], async ({ requests, advance, error }) => {
    error("Failed to fetch");
    await advance(10000);
    assert.equal(requests.length, 1);
  });
});

test("flag off: a network drop still shows the raw error without retrying", async t => {
  await withDemo(t, false, [drop()], async ({ requests, navigations, advance, error }) => {
    error("Failed to fetch");
    await advance(10000);
    assert.equal(requests.length, 1);
    assert.deepEqual(navigations, []);
  });
});

for (const enabled of [false, true]) {
  test(`flag ${enabled}: an immediate success navigates once even in StrictMode`, async t => {
    await withDemo(t, enabled, [success()], async ({ requests, navigations }) => {
      assert.equal(requests.length, 1);
      assert.deepEqual(navigations, ["/project?id=123"]);
    });
  });
}

test("flag definition is registered as a bugfix enabled for anonymous visitors unless Off", async () => {
  const { HTPR_7141_DEMO_GUEST_RETRY_FLAG } = load("src/lib/flags/keys.ts", {});
  assert.equal(HTPR_7141_DEMO_GUEST_RETRY_FLAG, FLAG);
  const { FEATURE_FLAG_DEFINITIONS } = load("src/lib/flags/definitions.ts", {});
  const definition = FEATURE_FLAG_DEFINITIONS.find(({ key }) => key === FLAG);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
  const flags = load("src/lib/flags.ts", { "@/lib/prisma": { default: {} } });
  assert.equal(flags.defaultFeatureFlagMode(FLAG), "EVERYONE");
  for (const mode of [null, "OFF"]) {
    const db = { featureFlag: { findUnique: async () => mode ? { mode } : null } };
    assert.equal(await flags.isFeatureEnabled(FLAG, -1, db), mode === null);
  }
});

for (const enabled of [false, true, "unavailable"]) {
  test(`server page passes the anonymous flag decision (${enabled}) to the client`, async () => {
    const Client = () => null;
    const Page = loadPage(path.join(root, "src/app/(tutorial space)/demo/page.tsx"), {
      "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
        assert.equal(key, FLAG);
        assert.equal(userId, -1);
        if (enabled === "unavailable") throw new Error("flags unavailable");
        return enabled;
      } },
      "@/lib/flags/keys": { HTPR_7141_DEMO_GUEST_RETRY_FLAG: FLAG },
      "./DemoBoardPage": { default: Client },
    });
    const result = await Page();
    assert.equal(result.type, Client);
    assert.equal(result.props.retryNetworkErrors, enabled === true);
  });
}
