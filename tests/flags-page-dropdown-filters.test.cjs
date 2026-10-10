const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const { createJiti } = require("jiti");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query");
const root = path.resolve(__dirname, "..");
const queryKey = ["admin-feature-flags"];
let enabled = true;
let oldEnabled = true;
const stub = (relative, exports) => {
  const filename = path.join(root, relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
stub("src/hooks/useFlag.tsx", {
  ADMIN_FEATURE_FLAGS_QUERY_KEY: queryKey,
  FEATURE_FLAGS_QUERY_PREFIX: ["feature-flags"],
  useFlag: key => key === "htpr-7069-flags-dropdown-filters" ? enabled : oldEnabled,
});
stub("src/styles/linksModal.module.scss", { __esModule: true, default: {} });
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false, jsx: { runtime: "automatic" } });
const Admin = jiti(path.join(root, "src/app/admin/flags/FeatureFlagsAdmin.tsx")).default;
const { parseFlagsPageFilters: parse, serializeFlagsPageFilters: serialize, matchesFlagRisk } = jiti(path.join(root, "src/app/admin/flags/useFlagsPageFilters.ts"));
const { FEATURE_FLAG_RELEASE_RISKS: risks } = jiti(path.join(root, "src/lib/flags/releaseRisk.ts"));
const keys = ["none", "small", "new"].map(risk => Object.keys(risks).find(key => risks[key].risk === risk));
const rows = keys.map((key, index) => ({
  key, kind: ["feature", "improvement", "bugfix"][index], mode: ["OWNER_ONLY", "OWNER_AND_QA", "EVERYONE"][index],
  description: `Fixture ${index}`, shippedOn: "2026-10-10", updatedAt: null, releasedAt: null,
  keep: false, removalTaskId: null, ticketId: null, ticketUrl: null, ticketTitle: null,
}));
rows.push({ ...rows[0], key: "unknown-risk", mode: "OFF" });

async function withAdmin(query, run, props = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: `http://localhost/admin/flags${query}#flag-test` });
  const names = ["window", "self", "document", "HTMLElement", "navigator", "IS_REACT_ACT_ENVIRONMENT", "fetch"];
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(global, name)]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  let reactRoot;
  try {
    for (const name of names) Object.defineProperty(global, name, { value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "fetch" ? async () => { throw new Error("Unexpected network access"); } : name === "window" ? dom.window : dom.window[name], configurable: true, writable: true });
    client.setQueryData(queryKey, { flags: rows, detailsEnabled: true });
    reactRoot = require("react-dom/client").createRoot(document.getElementById("root"));
    await React.act(async () => reactRoot.render(React.createElement(QueryClientProvider, { client }, React.createElement(Admin, props))));
    const click = async element => { assert.ok(element); await React.act(async () => element.click()); };
    const open = async label => {
      const current = document.querySelector('[aria-expanded="true"]');
      if (current) await click(current);
      const trigger = document.querySelector(`[aria-label="Filter ${label}"]`);
      await click(trigger);
      return trigger.parentElement.querySelector('[role="listbox"]');
    };
    const select = async (label, option) => {
      const menu = document.querySelector(`[aria-label="Filter ${label}"]`).getAttribute("aria-expanded") === "true" ? document.querySelector('[role="listbox"]') : await open(label);
      const row = [...menu.querySelectorAll("label")].find(row => row.textContent.startsWith(option));
      assert.ok(row, `${label}: ${option}`);
      await click(row.querySelector("input"));
    };
    const travel = async direction => React.act(async () => {
      const arrived = new Promise(resolve => window.addEventListener("popstate", resolve, { once: true }));
      window.history[direction]();
      await arrived;
    });
    await run({ document, window: dom.window, click, open, select, travel });
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    client.clear(); dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

test.beforeEach(() => { enabled = true; oldEnabled = true; });

test("all dropdowns show current choices and per-option counts; count matches actual cards", async () => {
  await withAdmin("", async ({ document, open }) => {
    assert.equal(document.querySelector('[role="status"]').textContent, "Showing 4 of 4 flags");
    assert.equal(document.querySelectorAll('[id^="flag-"][tabindex]').length, 4);
    for (const [label, summary, expected] of [
      ["Status", "All", ["All (4)", "Unreleased (2)", "Only me (1)", "Owner + QA (1)", "Everyone (1)", "Off (1)"]],
      ["Type", "All", ["All (4)", "Feature (2)", "Improvement (1)", "Bug (1)"]],
      ["Release risk", "All", ["All (4)", "No visible change (1)", "Small change (1)", "New feature (1)"]],
      ["Sort", "Release risk first", ["Release risk first (4)", "Newest first (4)", "Oldest first (4)"]],
    ]) {
      assert.ok(document.querySelector(`[aria-label="Filter ${label}"]`).textContent.includes(`${label}: ${summary}`));
      const menu = await open(label);
      assert.deepEqual([...menu.querySelectorAll("label")].map(row => row.textContent), expected);
    }
    assert.equal(document.querySelector('[aria-label="Flag filters"]').children.length, 4);
  });
});

test("option counts reflect the other active filters and the search", async () => {
  await withAdmin("?type=bug", async ({ open }) => {
    const menu = await open("Status");
    assert.deepEqual([...menu.querySelectorAll("label")].map(row => row.textContent),
      ["All (1)", "Unreleased (0)", "Only me (0)", "Owner + QA (0)", "Everyone (1)", "Off (0)"]);
  });
  await withAdmin("?tab=unreleased", async ({ open }) => {
    assert.deepEqual([...(await open("Type")).querySelectorAll("label")].map(row => row.textContent),
      ["All (2)", "Feature (1)", "Improvement (1)", "Bug (0)"]);
    assert.deepEqual([...(await open("Release risk")).querySelectorAll("label")].map(row => row.textContent),
      ["All (2)", "No visible change (1)", "Small change (1)", "New feature (0)"]);
  });
  await withAdmin("?q=Fixture%201", async ({ document, open }) => {
    assert.equal(document.querySelector('[role="status"]').textContent, "Showing 1 of 4 flags");
    assert.deepEqual([...(await open("Type")).querySelectorAll("label")].map(row => row.textContent),
      ["All (1)", "Feature (0)", "Improvement (1)", "Bug (0)"]);
  });
});

test("dropdown selections preserve params, intersect filters, and restore on back/forward", async () => {
  await withAdmin("?other=keep", async ({ document, window, select, travel }) => {
    await select("Status", "Unreleased");
    await select("Type", "Feature");
    await select("Type", "Improvement");
    await select("Release risk", "No visible change");
    await select("Release risk", "Small change");
    await select("Sort", "Oldest first");
    const params = new URLSearchParams(window.location.search);
    assert.equal(params.get("tab"), "unreleased");
    assert.equal(params.get("type"), "feature,improvement");
    assert.equal(params.get("risk"), "none,small");
    assert.equal(params.get("sort"), "oldest");
    assert.equal(params.get("other"), "keep");
    assert.equal(window.location.hash, "#flag-test");
    assert.equal(document.querySelector('[role="status"]').textContent, "Showing 2 of 4 flags");
    assert.equal(document.querySelectorAll('[id^="flag-"][tabindex]').length, 2);
    assert.ok(document.querySelector('[aria-label="Filter Type"]').textContent.includes("Feature, Improvement"));
    await travel("back");
    assert.equal(new URLSearchParams(window.location.search).get("sort"), null);
    await travel("back");
    assert.equal(document.querySelector('[role="status"]').textContent, "Showing 1 of 4 flags");
    await travel("forward");
    assert.equal(document.querySelector('[role="status"]').textContent, "Showing 2 of 4 flags");
  });
});

test("shared single-risk links and search produce correct filtered and zero counts", async () => {
  for (const [query, count] of [["?risk=small&type=improvement", 1], ["?q=Fixture", 4], ["?q=missing", 0], ["?risk=none,new", 2]]) {
    await withAdmin(query, async ({ document }) => {
      assert.equal(document.querySelector('[role="status"]').textContent, `Showing ${count} of 4 flags`);
      assert.equal(document.querySelectorAll('[id^="flag-"][tabindex]').length, count);
    });
  }
});

test("risk multi-select uses the same risk param; legacy parsing and single values are unchanged", () => {
  for (const value of ["none", "small", "new"]) assert.deepEqual(parse(`risk=${value}`, true), parse(`risk=${value}`));
  assert.equal(parse("risk=none,new").risk, null);
  assert.deepEqual(parse("risk=new,none,invalid,none", true).risk, ["none", "new"]);
  assert.equal(serialize(parse("risk=new,none", true)), "risk=none%2Cnew");
  assert.equal(matchesFlagRisk(rows[0], ["none", "new"]), true);
  assert.equal(matchesFlagRisk(rows[1], ["none", "new"]), false);
  assert.equal(matchesFlagRisk(rows[3], ["none", "new"]), false);
});

test("flag off renders the old three bars and no shown count or dropdowns", async () => {
  enabled = false;
  await withAdmin("?risk=small", async ({ document }) => {
    for (const label of ["audience", "type", "release risk"]) assert.ok(document.querySelector(`[aria-label="Filter by ${label}"]`));
    assert.equal(document.querySelector('[aria-label="Flag filters"]'), null);
    assert.equal(document.querySelector('[role="status"]'), null);
    const input = document.getElementById("flag-search");
    assert.ok(input.parentElement.classList.contains("sticky"), "legacy search retains its exact parent");
  });
});

test("new flag works independently of older flags and does not change detail controls", async () => {
  oldEnabled = false;
  await withAdmin("?type=bug", async ({ document }) => {
    assert.equal(document.querySelector('[role="status"]').textContent, "Showing 1 of 4 flags");
  });
  await withAdmin("", async ({ document }) => {
    assert.equal(document.querySelector('[aria-label="Flag filters"]'), null);
    assert.equal(document.querySelector('[role="status"]'), null);
  }, { flagKey: rows[0].key });
});

test("wrapping filter row and constrained menus use the existing shared dropdown", () => {
  const admin = fs.readFileSync(path.join(root, "src/app/admin/flags/FeatureFlagsAdmin.tsx"), "utf8");
  const shared = fs.readFileSync(path.join(root, "src/components/TimeTracking/MultiSelectDropdown.tsx"), "utf8");
  assert.match(admin, /import MultiSelectDropdown from "@\/components\/TimeTracking\/MultiSelectDropdown"/);
  assert.match(admin, /className="mt-6 flex flex-wrap gap-3" aria-label="Flag filters"/);
  assert.match(admin, /className="max-w-full flex-1 basis-40"/);
  assert.match(shared, /label \? "w-full" : "min-w-full"/);
});

const browserInstalled = fs.existsSync(require("@playwright/test").chromium.executablePath());

test("real browser at 390px wraps the row and bounds every opened menu without sideways scroll", { skip: !browserInstalled && "Playwright browser not installed" }, async () => {
  const { compile } = require("@tailwindcss/node");
  const { chromium } = require("@playwright/test");
  const snapshots = [];
  await withAdmin("", async ({ document, open }) => {
    snapshots.push(document.getElementById("root").innerHTML);
    for (const label of ["Status", "Type", "Release risk", "Sort"]) {
      await open(label);
      snapshots.push(document.getElementById("root").innerHTML);
    }
  });
  const compiler = await compile('@import "tailwindcss";', { base: root, onDependency: () => {} });
  const candidates = [...new Set(snapshots.flatMap(html => [...html.matchAll(/class="([^"]*)"/g)].flatMap(match => match[1].split(/\s+/))))];
  const css = compiler.build(candidates);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const html of snapshots) {
        await page.setContent(`<style>${css}</style>${html}`);
        const layout = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          tops: [...document.querySelector('[aria-label="Flag filters"]').children].map(el => el.getBoundingClientRect().top),
          menus: [...document.querySelectorAll('[role="listbox"]')].map(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })),
        }));
        assert.ok(layout.scrollWidth <= width, JSON.stringify({ width, layout }));
        assert.equal(new Set(layout.tops).size, width === 390 ? 2 : 1);
        for (const menu of layout.menus) assert.ok(menu.left >= 0 && menu.right <= width, JSON.stringify(menu));
      }
      if (process.env.HTPR_7069_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.HTPR_7069_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.HTPR_7069_SCREENSHOT_DIR, `flags-${width}.png`), fullPage: true });
      }
    }
  } finally {
    await browser.close();
  }
});

test("All resets multi-selects without changing unrelated params or search", async () => {
  await withAdmin("?type=feature,improvement&risk=none,small&q=Fixture&other=keep", async ({ document, window, select }) => {
    await select("Type", "All");
    await select("Release risk", "All");
    const params = new URLSearchParams(window.location.search);
    assert.equal(params.get("type"), null);
    assert.equal(params.get("risk"), null);
    assert.equal(params.get("q"), "Fixture");
    assert.equal(params.get("other"), "keep");
    assert.equal(document.querySelector('[role="status"]').textContent, "Showing 4 of 4 flags");
  });
});
