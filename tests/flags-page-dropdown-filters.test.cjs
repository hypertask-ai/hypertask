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
let parkedOn = false;
const stub = (relative, exports) => {
  const filename = path.join(root, relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
stub("src/hooks/useFlag.tsx", {
  ADMIN_FEATURE_FLAGS_QUERY_KEY: queryKey,
  FEATURE_FLAGS_QUERY_PREFIX: ["feature-flags"],
  useFlag: key => key === "htpr-7069-flags-dropdown-filters" ? enabled : key === "htpr-7070-parked-flags" ? parkedOn : oldEnabled,
});
stub("src/styles/linksModal.module.scss", { __esModule: true, default: {} });
// reactstrap portals do not mount in this jsdom setup, so the modal shell is stubbed with plain elements (same approach as my-tasks-scope-picker.test.cjs).
const box = ({ children }) => React.createElement("div", null, children);
const reactstrapPath = require.resolve("reactstrap");
require.cache[reactstrapPath] = { id: reactstrapPath, filename: reactstrapPath, loaded: true, exports: { ModalBody: box } };
stub("src/components/Common/CommonModalComponents/index.tsx", {
  ModalContainerCustom: ({ id, children }) => React.createElement("div", { id, role: "dialog" }, children),
  ModalListContainer: box,
  ModalHeaderComp: ({ header }) => React.createElement("h2", null, header),
  ModalInput: ({ autofocus, ...props }) => React.createElement("input", props),
  ModalRowElementContainer: ({ children, onClick, id }) => React.createElement("button", { type: "button", onClick, id }, children),
});
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
    const pause = () => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const pickerRows = () => [...document.querySelectorAll("[id^='option-picker-']")].filter(el => /^option-picker-\d+$/.test(el.id));
    const labels = () => pickerRows().map(row => row.querySelector("span").textContent);
    const closePicker = async () => {
      if (!pickerRows().length) return;
      await React.act(async () => { document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
      await pause();
    };
    const open = async label => {
      await closePicker();
      const trigger = document.querySelector(`[aria-label="Filter ${label}"]`);
      await click(trigger);
      assert.ok(document.getElementById("option-picker")?.textContent.includes(label), `${label} picker header`);
      return labels();
    };
    const select = async (label, option) => {
      const trigger = document.querySelector(`[aria-label="Filter ${label}"]`);
      if (!pickerRows().length || trigger.getAttribute("aria-expanded") !== "true") await open(label);
      const row = pickerRows().find(row => row.querySelector("span").textContent.startsWith(option));
      assert.ok(row, `${label}: ${option}`);
      await click(row);
      await pause();
    };
    const travel = async direction => React.act(async () => {
      const arrived = new Promise(resolve => window.addEventListener("popstate", resolve, { once: true }));
      window.history[direction]();
      await arrived;
    });
    await run({ document, window: dom.window, click, open, select, travel, labels, pickerRows, pause, closePicker });
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    client.clear(); dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

test.beforeEach(() => { enabled = true; oldEnabled = true; parkedOn = false; });

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
      assert.deepEqual(await open(label), expected);
    }
    assert.equal(document.querySelectorAll('[aria-label="Flag filters"] button[aria-label^="Filter "]').length, 4);
  });
});

test("option counts reflect the other active filters and the search", async () => {
  await withAdmin("?type=bug", async ({ open }) => {
    assert.deepEqual(await open("Status"),
      ["All (1)", "Unreleased (0)", "Only me (0)", "Owner + QA (0)", "Everyone (1)", "Off (0)"]);
  });
  await withAdmin("?tab=unreleased", async ({ open }) => {
    assert.deepEqual(await open("Type"),
      ["All (2)", "Feature (1)", "Improvement (1)", "Bug (0)"]);
    assert.deepEqual(await open("Release risk"),
      ["All (2)", "No visible change (1)", "Small change (1)", "New feature (0)"]);
  });
  await withAdmin("?q=Fixture%201", async ({ document, open }) => {
    assert.equal(document.querySelector('[role="status"]').textContent, "Showing 1 of 4 flags");
    assert.deepEqual(await open("Type"),
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

test("filters use the shared option picker, a wrapping row of trigger buttons and no waiver", () => {
  const admin = fs.readFileSync(path.join(root, "src/app/admin/flags/FeatureFlagsAdmin.tsx"), "utf8");
  assert.match(admin, /import OptionPickerModal from "@\/components\/Modals\/OptionPicker"/);
  assert.match(admin, /className="mt-6 flex flex-wrap gap-3" aria-label="Flag filters"/);
  assert.doesNotMatch(admin, /MultiSelectDropdown|eslint-disable/);
});

test("single selects close the picker and return focus to the trigger; multi selects stay open", async () => {
  await withAdmin("", async ({ document, select, pickerRows, labels, pause }) => {
    await select("Sort", "Newest first");
    assert.equal(pickerRows().length, 0);
    const sort = document.querySelector('[aria-label="Filter Sort"]');
    assert.ok(sort.textContent.includes("Sort: Newest first"));
    assert.equal(document.activeElement, sort);
    await select("Type", "Feature");
    assert.ok(pickerRows().length > 0, "multi select stays open");
    assert.ok(labels()[0].startsWith("All"));
    await select("Type", "Bug");
    assert.ok(document.querySelector('[aria-label="Filter Type"]').textContent.includes("Feature, Bug"));
    await select("Type", "Feature");
    assert.ok(document.querySelector('[aria-label="Filter Type"]').textContent.includes("Type: Bug"));
    await pause();
  });
});

const browserInstalled = fs.existsSync(require("@playwright/test").chromium.executablePath());

test("real browser at 390px wraps the row and without sideways scroll", { skip: !browserInstalled && "Playwright browser not installed" }, async () => {
  const { compile } = require("@tailwindcss/node");
  const { chromium } = require("@playwright/test");
  const snapshots = [];
  await withAdmin("", async ({ document }) => {
    snapshots.push(document.getElementById("root").innerHTML);
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
        }));
        assert.ok(layout.scrollWidth <= width, JSON.stringify({ width, layout }));
        assert.equal(new Set(layout.tops).size, width === 390 ? 2 : 1);
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

test("Parked status option, count and filter exist only with the parked-flags flag", async () => {
  const parkedRow = { ...rows[0], key: "parked-fixture", mode: "OWNER_ONLY", parked: { reason: "Waiting on a decision" } };
  rows.push(parkedRow);
  parkedOn = true;
  try {
    await withAdmin("", async ({ open }) => {
      assert.deepEqual(await open("Status"),
        ["All (5)", "Unreleased (2)", "Only me (2)", "Owner + QA (1)", "Everyone (1)", "Off (1)", "Parked (1)"]);
    });
    await withAdmin("?tab=parked", async ({ document }) => {
      assert.equal(document.querySelector('[role="status"]').textContent, "Showing 1 of 5 flags");
      assert.match(document.body.textContent, /Parked: Waiting on a decision/);
      assert.ok(document.querySelector('[aria-label="Filter Status"]').textContent.includes("Status: Parked"));
    });
    parkedOn = false;
    await withAdmin("?tab=parked", async ({ document, open }) => {
      assert.equal(document.querySelector('[role="status"]').textContent, "Showing 5 of 5 flags");
      assert.doesNotMatch(document.body.textContent, /Waiting on a decision/);
      assert.deepEqual(await open("Status"),
        ["All (5)", "Unreleased (3)", "Only me (2)", "Owner + QA (1)", "Everyone (1)", "Off (1)"]);
    });
  } finally {
    rows.splice(rows.indexOf(parkedRow), 1);
  }
});
