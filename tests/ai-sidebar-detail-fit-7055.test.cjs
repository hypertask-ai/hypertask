const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const ts = require("typescript");
const { chromium } = require("@playwright/test");
const { compile } = require("@tailwindcss/node");
const { JSDOM } = require("jsdom");
const { twMerge } = require("tailwind-merge");
const root = path.resolve(__dirname, "..");
const key = "htpr-7055-ai-sidebar-detail-fit";
const noop = () => null;
const pass = ({ children }) => children;

function fixture(enabled, mobile = false) {
  const mobileContext = React.createContext(mobile);
  function load(relative, dependencies) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    const js = ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const exports = {};
    new Function("require", "exports", js)((name) => {
      if (name === "react" || name === "react/jsx-runtime") return require(name);
      if (name in dependencies) return dependencies[name];
      return { __esModule: true, default: pass };
    }, exports);
    return exports;
  }
  const shared = {
    "@/lib/contexts/mobileContext": { MobileViewContext: mobileContext },
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => twMerge(parts.filter(Boolean).join(" ")) },
    "@/lib/configs/taskDetail.config": { taskDetailSpacing: { mobile: { taskInfoContainer: "" } } },
  };
  const base = "src/components/PageComponents/TaskDetail/";
  const Thread = load(`${base}CommentAndDescription/BaseCommentAndDescriptionContainer.tsx`, shared).default;
  const Rail = load(`${base}MainPageComponents/TaskInfoColumnContainer.tsx`, shared).TaskInfoColumnContainer;
  const Main = load(`${base}TaskDetailMainContainer.tsx`, shared).default;
  const Panels = load("src/app/detail/[...slug]/TaskDetailPanels.tsx", {
    "next/dynamic": { __esModule: true, default: () => noop },
    "@/lib/analytics/taskDetailPhaseTimings": { instrumentedDynamicImport: noop },
    "@/hooks/useFlag": { useFlag: (flag) => flag === key && enabled },
    "@/lib/flags/keys": { HTPR_7055_AI_SIDEBAR_DETAIL_FIT_FLAG: key },
    "@/hooks/Task Detail/useThreadSettled": { useThreadSettled: () => true },
    "./SettledComposerSlot": { SettledComposerSlot: ({ children }) => children },
    "@/components/PageComponents/TaskDetail/CommentAndDescription/SettledComposerSlot": { SettledComposerSlot: ({ children }) => children },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ secondaryPanelsReady: true, cachedLayout: false }) },
    "@/lib/configs/taskDetail.config": { __esModule: true, default: { elementIds: { taskInfoCommentsDescriptionContainer: "detail-row" } } },
    "@/components/PageComponents/TaskDetail/TaskDetailMainContainer": { __esModule: true, default: Main },
    "@/components/PageComponents/TaskDetail/CommentAndDescription": { __esModule: true, default: () => React.createElement(Thread, null, "Comments") },
    "@/components/PageComponents/TaskDetail/TaskInfoColumn/TaskInfo": { __esModule: true, default: () => React.createElement(Rail, { heightVariant: "fit" },
      ...["qa-free", "To Do", "MYBO-1", "MyBoard", "No Priority", "No tags", "12 Oct 2026"].map(value => React.createElement("div", { key: value, "data-value": true }, value))) },
  }).TaskDetailPanels;
  return renderToString(React.createElement(Panels, {
    embedded: true, _mbl: mobile, _slugs: ["project-6367", "1"],
    currentTask: { id: 1, projectId: 6367, uniqueIndex: 1 }, showCommands: { show: false },
  }));
}

async function css(html) {
  const doc = new JSDOM(html).window.document;
  const candidates = [...new Set([...doc.querySelectorAll("[class]")].flatMap(e => [...e.classList]))];
  const compiler = await compile('@import "tailwindcss"; .task-detail-horizontal-padding { @apply @xs:px-[18px] @sm:px-16 @xl:px-16; }', { base: root, onDependency: noop });
  return compiler.build(candidates);
}

test("the row never wraps, and flag Off and mobile keep the original row", () => {
  for (const [enabled, mobile] of [[false, false], [false, true], [true, true], [true, false]]) {
    const row = new JSDOM(fixture(enabled, mobile)).window.document.querySelector("#detail-row");
    assert.equal(row.style.flexWrap, "");
    assert.equal(row.style.display, "flex");
  }
});

test("flag On shrinks the thread minimum; flag Off and mobile keep the original classes", () => {
  const cls = (enabled, mobile) => new JSDOM(fixture(enabled, mobile)).window.document.querySelector("#detail-row").className;
  assert.match(cls(true, false), /min-w-\[320px\]/);
  for (const [enabled, mobile] of [[false, false], [false, true], [true, true]]) assert.doesNotMatch(cls(enabled, mobile), /min-w/);
});

test("properties stay beside the thread at every width, with the AI sidebar open or closed", async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    // CI unit runs have no Playwright browser; the layout check runs where one is installed.
    if (/Executable doesn't exist/.test(String(error?.message))) return t.skip("Playwright browser not installed");
    throw error;
  }
  t.after(() => browser.close());
  const page = await browser.newPage();
  const snapshots = new Map();
  const overflow = [];
  for (const enabled of [false, true]) {
    const html = fixture(enabled);
    const styles = await css(html);
    for (const width of [900, 950, 1024, 1082, 1180, 1280, 1440]) {
      for (const sidebar of [false, true]) {
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(`<style>${styles}body{margin:0}</style><main style="margin-left:48px;width:calc(100% - ${48 + (sidebar ? 420 : 0)}px)">${html}</main>`);
        const geometry = await page.evaluate(() => {
          const rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, right: r.right }; };
          return { main: rect(document.querySelector("main")), rail: rect(document.querySelector("[data-task-properties-rail]")), thread: rect(document.querySelector('[data-testid="ticket-thread"]')) };
        });
        const label = `${width}-${sidebar}`;
        if (!enabled) {
          snapshots.set(label, geometry);
          if (sidebar && width <= 1180) assert.ok(geometry.rail.right > geometry.main.right, "negative control reproduces production overflow");
          continue;
        }
        assert.ok(Math.abs(geometry.rail.y - geometry.thread.y) <= 2, `side by side, never stacked at ${label}`);
        assert.ok(geometry.thread.width >= 320, `comment minimum stays usable at ${label}`);
        if (!sidebar && width >= 1280) assert.deepEqual(geometry, snapshots.get(label), `identical to flag Off at ${label}`);
        if (geometry.rail.right > geometry.main.right + 1) overflow.push(label);
        if (!sidebar && width >= 950) assert.ok(geometry.rail.right <= geometry.main.right + 1, `rail fits at ${label}`);
      }
    }
  }
  console.log("flag On combos where the rail still overflows (width-sidebarOpen):", overflow.join(", ") || "none");
});
