const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const builtin = jiti(path.join(root, "src/lib/constants/builtinViews.ts"));
const views = require("./board-filters/runtime.cjs").views;
const order = jiti(path.join(root, "src/utils/helperFunctions/Views/ViewOrderHelperFunctions.ts"));
const flag = jiti(path.join(root, "src/lib/flags/definitions/htpr-7804-blocked-by-me.ts"));
const id = "builtin:blocked-by-me";

function loadHook(relative, stubs) {
  const filename = path.join(root, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = (name) => {
    assert.ok(name in stubs, `Unexpected dependency: ${name}`);
    return stubs[name];
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
  return loaded.exports.default;
}

function orderedHarness(enabled, active = {}, loaded = true, react) {
  const effects = [];
  let layout = "board";
  let destination;
  const atoms = { activeBuiltinViewsAtom: "active", viewTabsOrderAtom: "order", optimisticViewTabsOrderAtom: "optimistic", boardLayoutAtom: "layout", boardLayoutPreferenceAtom: "preference" };
  const hook = loadHook("src/hooks/Homepage/Views/useOrderedViews.ts", {
    react: react ?? { useMemo: (fn) => fn(), useEffect: (fn) => effects.push(fn) },
    "@/lib/state": {
      useRecoilValue: (atom) => atom === "active" ? active : atom === "preference" ? "board" : {},
      useSetRecoilState: (atom) => (update) => { if (atom === "layout") layout = update; else active = update(active); },
    },
    "next/navigation": { useRouter: () => ({ replace: (url) => { destination = url; } }) },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": views,
    "@/store": atoms,
    "@/utils/api/viewOrder": { saveViewOrder: () => assert.fail("No migration expected") },
    "@/utils/helperFunctions/Views/ViewOrderHelperFunctions": order,
    "@/lib/constants/builtinViews": builtin,
    "@/hooks/useFlag": { useFlagLoaded: () => loaded, useFlag: (key) => key === flag.HTPR_7804_BLOCKED_BY_ME_FLAG ? enabled : true },
    "@/lib/flags/keys": { HTPR_7804_BLOCKED_BY_ME_FLAG: flag.HTPR_7804_BLOCKED_BY_ME_FLAG, HTPR_7092_DECISIONS_FLAG: "decisions" },
  });
  return {
    hook,
    flush: () => {
      const original = global.window;
      global.window = { location: { href: "https://app.hypertask.ai/project?id=15&surface=board" } };
      try { effects.forEach((fn) => fn()); } finally { global.window = original; }
    },
    active: () => active, layout: () => layout, destination: () => destination,
  };
}

const project = (projectId) => ({ id: projectId, section: [], tasks: [], project_view: {
  default_view_id: "home", allViews: [{ id: "home", title: "Home" }], user_project_views: [],
} });

test("Blocked by me uses the current viewer and responds to blocker changes", () => {
  const view = builtin.getBuiltinView(id);
  assert.equal(view.title, "Blocked by me");
  const task = { waitingOnUserId: 985, blockingTasks: [{ id: 1 }] };
  assert.equal(view.predicate(task, { currentUserId: 985 }), true);
  assert.equal(view.predicate(task, { currentUserId: 2343 }), false);
  assert.equal(view.predicate(task, {}), false);
  assert.equal(view.predicate({}, {}), false);
  task.waitingOnUserId = null;
  assert.equal(view.predicate(task, { currentUserId: 985 }), false);
  task.waitingOnUserId = 2343;
  assert.equal(view.predicate(task, { currentUserId: 2343 }), true);
});

test("new and existing boards receive the view without saved setup", () => {
  for (const board of [project(1), { ...project(15), project_view: undefined }]) {
    const { hook } = orderedHarness(true);
    assert.ok(hook(board).some((view) => view.id === id));
  }
});

test("flag off removes only the new view and clears only its selected board", () => {
  const on = orderedHarness(true).hook(project(15)).map((view) => view.id);
  const off = orderedHarness(false, { 15: id, 16: "builtin:blocked" });
  assert.deepEqual(off.hook(project(15)).map((view) => view.id), on.filter((value) => value !== id));
  off.flush();
  assert.deepEqual(off.active(), { 16: "builtin:blocked" });
  const other = orderedHarness(false, { 15: "builtin:blocked", 16: id });
  other.hook(project(15));
  other.flush();
  assert.deepEqual(other.active(), { 15: "builtin:blocked", 16: id });
});

test("empty Blocked by me remains discoverable without changing other empty tabs", () => {
  const orderedViews = orderedHarness(true).hook(project(15));
  const hook = loadHook("src/hooks/Homepage/Views/useRenderedViews.ts", {
    "@/lib/flags/definitions/htpr-7865-agent-creator-filter": jiti(path.join(root, "src/lib/flags/definitions/htpr-7865-agent-creator-filter.ts")),
    react: { useMemo: (fn) => fn() },
    "@/lib/state": { useRecoilValue: (atom) => atom === "user" ? { id: 985 } : atom === "showEmpty" ? false : {} },
    "@/store": { currentUserAtom: "user", showEmptyViewTabsAtom: "showEmpty" },
    "@/utils/helperFunctions/Views/FilterHelperFunctions": { defaultFilterSettings: {}, applyFilters: (sections) => sections },
    "@/utils/helperFunctions/Views/SubtaskHelperFunction": { applySubTaskSetting: (sections) => sections },
    "@/lib/constants/builtinViews": builtin,
    "./useOrderedViews": { __esModule: true, default: () => orderedViews },
    "@/hooks/Task Detail/useTimeTracking": { useBoardRunningTimers: () => ({ timers: new Map() }) },
    "@/hooks/useFlag": { useFlag: () => true },
    "@/lib/flags/keys": {},
    "@/lib/flags/definitions/htpr-7804-blocked-by-me": flag,
    "@/models/Views/model": { DEFAULT_SUBTASK_SETTING: "None" },
  });
  assert.deepEqual(hook(project(15)).renderedViews.map((view) => view.id), ["home", id]);
});


test("loading flags does not discard the remembered view before refresh completes", () => {
  const harness = orderedHarness(false, { 15: id }, false);
  harness.hook(project(15));
  harness.flush();
  assert.deepEqual(harness.active(), { 15: id });
});

test("flag rollback restores the saved Table layout and removes the built-in surface override", () => {
  const board = project(15);
  board.project_view.default_view = { id: "home", board_layout: "Table" };
  const harness = orderedHarness(false, { 15: id });
  harness.hook(board);
  harness.flush();
  assert.equal(harness.layout(), "table");
  assert.equal(harness.destination(), "/project?id=15");
});

test("Manage views can retain the ordered list without a flag-off render loop", async () => {
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/project?id=15" });
  const original = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = dom.window.document.getElementById("root");
  const root = createRoot(container);
  const { hook } = orderedHarness(false, {}, true, React);
  const board = project(15);
  let renders = 0;
  function ManageViewsList() {
    if (++renders > 8) throw new Error("Ordered views never settle");
    const ordered = hook(board);
    const [displayed, setDisplayed] = React.useState([]);
    React.useEffect(() => setDisplayed(ordered), [ordered]);
    return React.createElement("p", null, displayed.map((view) => view.id).join(","));
  }
  try {
    await React.act(async () => root.render(React.createElement(ManageViewsList)));
    assert.equal(container.textContent, "home,builtin:decisions,builtin:my-tasks,builtin:overdue,builtin:blocked,builtin:agents");
    assert.ok(renders <= 3, `Unexpected render count: ${renders}`);
  } finally {
    await React.act(async () => root.unmount());
    global.window = original.window;
    global.document = original.document;
    global.IS_REACT_ACT_ENVIRONMENT = original.act;
    dom.window.close();
  }
});
