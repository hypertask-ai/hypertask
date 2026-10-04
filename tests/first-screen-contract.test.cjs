const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
require("tsx/cjs");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { hydrateRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { QueryClient, QueryClientProvider, notifyManager } = require("@tanstack/react-query");
notifyManager.setScheduler(queueMicrotask);
const { useStore } = require("jotai");
const root = path.resolve(__dirname, "..");
const realtimePath = path.join(root, "src/lib/realtime/client.ts");
require.cache[realtimePath] = { id: realtimePath, filename: realtimePath, loaded: true,
  exports: { connectRealtimeClient: async () => null, releaseRealtimeClientIfIdle() {} } };
const { atom, selectorFamily, StateRoot, useRecoilValue, useSetRecoilState } = require("../src/lib/state.tsx");
const { FeatureFlagProvider, useFlag, featureFlagsQueryKey } = require("../src/hooks/useFlag.tsx");
const { projectBoardFirstScreen } = require("../src/lib/firstScreen/boardView.ts");
const { projectInboxFirstScreen, projectInboxDateGroup } = require("../src/lib/firstScreen/inbox.ts");
const { hasFirstScreenDisplayPreferences } = require("../src/lib/firstScreen/contract.ts");
const { pinProjectToUrlView, getViewFromProject, resolveBoardLayoutFromSurface, getActiveBoardLayoutPreferenceFromProject } = require("../src/utils/helperFunctions/Views/ViewsHelperFunctions.ts");

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const now = "2026-10-04T00:30:00.000Z";
const display = { version: 1, accountId: 985, timeZone: "America/Los_Angeles", locale: "en-US",
  boardLayout: "table", theme: "graphite", railCollapsed: true, quickTips: false, draftsFirst: false };
const defaultView = { id: "d", slug: "default", board_layout: "Table" };
const applied = { id: "a", slug: "work", board_layout: "Board" };
const unsaved = { id: "u", slug: "unsaved", board_layout: null };
const project = { id: 15, section: [], sections: [], project_view: { default_view_id: "d", default_view: defaultView,
  allViews: [defaultView, applied], user_project_views: [{ appliedView: applied, unsavedView: unsaved }] } };

test("board golden model preserves unsaved view and browser surface inheritance", () => {
  const input = freeze(structuredClone(project));
  assert.deepEqual(projectBoardFirstScreen(input, null, "table", "work"), {
    view: { view: unsaved, type: "Unsaved" }, slug: "work", surface: "table",
  });
  assert.deepEqual(projectBoardFirstScreen(input, "board", "table", "default"), {
    view: { view: defaultView, type: "Default" }, slug: "default", surface: "board",
  });
  assert.deepEqual(input, project);
});

test("board projection matches existing URL pinning and surface selection matrix", () => {
  for (const row of [{}, { appliedView: applied }, { unsavedView: unsaved }, { appliedView: applied, unsavedView: unsaved }]) {
    const input = freeze({ ...project, project_view: { ...project.project_view, user_project_views: [row] } });
    for (const slug of [undefined, "default", "work", "missing"]) {
      for (const surface of [undefined, "board", "table", "invalid"]) {
        for (const layout of ["board", "table"]) {
          const pinned = pinProjectToUrlView(input, slug);
          const result = projectBoardFirstScreen(input, surface, layout, slug);
          assert.deepEqual(result.view, getViewFromProject(pinned));
          assert.equal(result.surface, resolveBoardLayoutFromSurface(surface, getActiveBoardLayoutPreferenceFromProject(pinned), layout));
          assert.deepEqual(projectBoardFirstScreen(input, surface, layout, slug), result);
        }
      }
    }
  }
});

const notification = (id, overrides = {}) => ({ id, projectId: 15, userId: 985, taskId: id, type: "Comment", seen: false,
  createdAt: now, project: { title: "Product" }, task: { status: "Normal", section: "To do", createdAt: now }, ...overrides });
const inboxInput = { notifications: [notification(1)], splitsNoImportant: [], showImportantSplit: false, now, locale: "en-US" };
test("inbox golden model is pure and deterministically uses the supplied clock and split", () => {
  const input = freeze(structuredClone(inboxInput));
  const result = projectInboxFirstScreen(input);
  assert.deepEqual(result.structuredData.tabs, [
    { idx: 0, project: "Important", length: 1, hasUnseen: false, projectId: null },
    { idx: 1, project: "Product", length: 1, hasUnseen: false, projectId: 15 },
    { idx: 2, project: "All", length: 1, hasUnseen: false, projectId: null },
  ]);
  assert.equal(result.selectedSplit, 0);
  assert.equal(result.notifications[0].computedSplit, "Important");
  assert.equal(input.notifications[0].computedSplit, undefined);
  const realNow = Date.now;
  try {
    Date.now = () => { throw new Error("Implicit clock read"); };
    assert.deepEqual(projectInboxFirstScreen(input), result);
    assert.equal(projectInboxFirstScreen({ ...input, projectId: "15" }).selectedSplit, 1);
    assert.equal(projectInboxFirstScreen({ ...input, split: "All" }).selectedSplit, 2);
    assert.equal(projectInboxFirstScreen({ ...input, split: "missing" }).selectedSplit, null);
    const old = { ...input, notifications: [notification(2, { task: { status: "Normal", createdAt: "2020-01-01T00:00:00.000Z" } })] };
    assert.equal(projectInboxFirstScreen(old).notifications[0].computedSplit, "Updates");
    assert.equal(projectInboxFirstScreen({ ...input, splitsNoImportant: ["project:15"] }).notifications[0].computedSplit, "Product");
  } finally { Date.now = realNow; }
  assert.throws(() => projectInboxFirstScreen({ ...input, now: "bad" }), /clock/);
  assert.throws(() => projectInboxFirstScreen({ ...input, now: "2026-10-04T00:30:00" }), /clock/);
});

test("inbox respects locale sorting, empty data and synthetic rows", () => {
  const notifications = [notification(1, { projectId: 1, project: { title: "Ä" } }), notification(2, { projectId: 2, project: { title: "Z" } })];
  const titles = locale => projectInboxFirstScreen({ ...inboxInput, notifications, locale }).structuredData.tabs.filter(t => t.projectId).map(t => t.project);
  assert.deepEqual(titles("de-DE"), ["Ä", "Z"]);
  assert.deepEqual(titles("sv-SE"), ["Z", "Ä"]);
  const empty = projectInboxFirstScreen({ ...inboxInput, notifications: [], showImportantSplit: true });
  assert.deepEqual(empty.structuredData.data, [[], []]);
  const synthetic = projectInboxFirstScreen({ ...inboxInput, notifications: [notification(1, { waitingOnSynthetic: true })] });
  assert.ok(synthetic.structuredData.tabs.some(t => t.project === "Blocked by you"));
  assert.equal(synthetic.structuredData.tabs.find(t => t.project === "All").length, 0);
});

test("timezone grouping matches the existing renderer including DST, weeks and month boundaries", () => {
  const source = fs.readFileSync(path.join(root, "src/components/notifications/inboxSplit/index.tsx"), "utf8");
  const body = source.slice(source.indexOf("const getDateGroup ="), source.indexOf("const getDateGroupLabel ="))
    .replace("(date: Date): string", "(date)").replace("const now = new Date();", "const now = new Date(clock);");
  const originalTZ = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Los_Angeles", "Europe/London", "Asia/Kathmandu", "Pacific/Auckland",
      "Asia/Beirut", "America/Havana", "America/Sao_Paulo", "Pacific/Apia"]) {
      process.env.TZ = zone;
      for (const clock of [now, "2026-03-09T12:00:00.000Z", "2026-03-30T12:00:00.000Z", "2026-11-02T12:00:00.000Z",
        "2027-01-01T12:00:00.000Z", "2018-11-05T12:00:00.000Z", "2011-12-31T12:00:00.000Z"]) {
        const legacy = vm.runInNewContext(`${body}; getDateGroup`, { Date, clock });
        for (const days of [0, 1, 2, 6, 7, 10, 14, 40, 400]) {
          const date = new Date(Date.parse(clock) - days * 86_400_000).toISOString();
          assert.equal(projectInboxDateGroup(date, clock, zone), legacy(new Date(date)), `${zone} ${date} ${clock}`);
        }
      }
    }
    assert.equal(projectInboxDateGroup("2026-10-03T23:30:00.000Z", now, "UTC"), "yesterday");
    assert.equal(projectInboxDateGroup("2026-10-03T23:30:00.000Z", now, "America/Los_Angeles"), "today");
    assert.throws(() => projectInboxDateGroup("2026-10-03T23:30:00", now, "UTC"), /date/);
    assert.throws(() => projectInboxDateGroup(now, "bad", "UTC"), /date/);
  } finally {
    if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ;
  }
});

test("unknown, invalid and other-account display preferences are explicitly ineligible", () => {
  assert.equal(hasFirstScreenDisplayPreferences(display, 985), true);
  for (const value of [undefined, null, {}, { ...display, version: 0 }, { ...display, accountId: 7 },
    { ...display, timeZone: "unknown" }, { ...display, locale: "not_a_locale" }, { ...display, railCollapsed: undefined },
    { ...display, boardLayout: "calendar" }, { ...display, locale: ["en-US"] },
    { ...display, timeZone: ["UTC"] }]) assert.equal(hasFirstScreenDisplayPreferences(value, 985), false);
});

const scoped = atom({ key: "first-screen-scope", default: "default" });
const derived = selectorFamily({ key: "first-screen-derived", get: () => ({ get }) => `view:${get(scoped)}` });
function StateReader() { return React.createElement("output", null, useRecoilValue(derived("view"))); }
const stateTree = (value, child = React.createElement(StateReader)) => React.createElement(StateRoot,
  value === undefined ? null : { initialValues: [[scoped, value]] }, child);

test("interleaved SSR state requests do not contaminate each other or unseeded defaults", () => {
  assert.equal(renderToString(stateTree("account-A")), "<output>view:account-A</output>");
  assert.equal(renderToString(stateTree("account-B")), "<output>view:account-B</output>");
  assert.equal(renderToString(stateTree(undefined)), "<output>view:default</output>");
  assert.equal(renderToString(stateTree("account-A")), "<output>view:account-A</output>");
});

async function hydrate(tree, verify) {
  const html = renderToString(tree);
  const dom = new JSDOM(`<div id='root'>${html}</div>`, { url: "https://example.test" });
  const previous = { window: global.window, document: global.document, fetch: global.fetch, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => ({ ok: true, json: async () => ({ flags: { example: false } }) }) });
  let instance;
  const errors = [];
  try {
    await React.act(async () => { instance = hydrateRoot(document.getElementById("root"), tree, { onRecoverableError: e => errors.push(e) }); });
    assert.deepEqual(errors, []);
    await verify({ html, dom, instance });
  } finally {
    if (instance) await React.act(async () => instance.unmount());
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete global[key]; else global[key] = value;
    }
  }
}

test("state first hydration reads the exact seed and never replays it over a live edit", async () => {
  const renders = [];
  let update, store;
  function Reader() {
    const value = useRecoilValue(scoped);
    update = useSetRecoilState(scoped);
    store = useStore();
    renders.push(value);
    return React.createElement("output", null, value);
  }
  const tree = stateTree("seed", React.createElement(Reader));
  await hydrate(tree, async ({ html, dom, instance }) => {
    assert.equal(html, "<output>seed</output>");
    assert.ok(renders.every(v => v === "seed"));
    assert.equal(store.get(scoped), "seed");
    await React.act(async () => update("edited"));
    await React.act(async () => instance.render(stateTree("stale", React.createElement(Reader))));
    assert.equal(dom.window.document.querySelector("output").textContent, "edited");
  });
});

test("seeded persisted atoms and late selectors neither leak storage into hydration nor write it", () => {
  const dom = new JSDOM("", { url: "https://example.test" });
  const oldWindow = global.window;
  const oldDocument = global.document;
  global.window = dom.window;
  global.document = dom.window.document;
  const saved = JSON.stringify({ "late-persisted": "browser-old" });
  dom.window.localStorage.setItem("recoil-persist", saved);
  let late;
  function LateReader() {
    // Evaluated after StateRoot has constructed its request snapshot.
    late ??= atom({ key: "late-persisted", default: "default", effects_UNSTABLE: [require("../src/lib/state.tsx").recoilPersist().persistAtom] });
    const label = selectorFamily({ key: "late-label", get: () => ({ get }) => get(late) })(0);
    return React.createElement("output", null, useRecoilValue(label));
  }
  try {
    assert.equal(renderToString(stateTree("seed", React.createElement(LateReader))), "<output>default</output>");
    assert.equal(renderToString(React.createElement(StateRoot, { initialValues: [[late, "request"]] }, React.createElement(LateReader))), "<output>request</output>");
    assert.equal(dom.window.localStorage.getItem("recoil-persist"), saved);
  } finally {
    dom.window.close();
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow;
    if (oldDocument === undefined) delete global.document; else global.document = oldDocument;
  }
});

function FlagReader() { return React.createElement("output", null, String(useFlag("example"))); }
function flagTree(accountId, seed, client = new QueryClient()) {
  return React.createElement(QueryClientProvider, { client }, React.createElement(FeatureFlagProvider,
    { userId: accountId, initialFlags: seed }, React.createElement(FlagReader)));
}
test("flag SSR uses only a matching seed and never another account's flags", () => {
  const seed = { accountId: 985, evaluatedAt: now, values: { example: true } };
  assert.equal(renderToString(flagTree(985, seed)), "<output>true</output>");
  assert.equal(renderToString(flagTree(7, seed)), "<output>false</output>");
  assert.equal(renderToString(flagTree(null, seed)), "<output>false</output>");
  assert.equal(renderToString(flagTree(985)), "<output>false</output>");
  assert.equal(renderToString(flagTree(985, { ...seed, evaluatedAt: "bad" })), "<output>false</output>");
});
test("partial flag seeds preserve unrelated flags and never replace a newer cache entry", () => {
  const seed = { accountId: 985, evaluatedAt: now, values: { example: true } };
  const key = featureFlagsQueryKey(985), evaluatedAt = Date.parse(now);
  for (const updatedAt of [evaluatedAt - 1000, evaluatedAt + 1000]) {
    const client = new QueryClient();
    client.setQueryData(key, { example: false, unrelated: true }, { updatedAt });
    assert.equal(renderToString(flagTree(985, seed, client)), "<output>true</output>");
    assert.deepEqual(client.getQueryData(key), { example: updatedAt < evaluatedAt, unrelated: true });
    assert.equal(client.getQueryState(key).dataUpdatedAt, Math.max(updatedAt, evaluatedAt));
    client.clear();
  }
});

test("unseeded flags retain false through first hydration even with a populated cache", async () => {
  const renders = [];
  function Reader() {
    const value = useFlag("example");
    renders.push(value);
    return React.createElement("output", null, String(value));
  }
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(featureFlagsQueryKey(985), { example: true });
  const tree = React.createElement(QueryClientProvider, { client }, React.createElement(FeatureFlagProvider,
    { userId: 985 }, React.createElement(Reader)));
  await hydrate(tree, async ({ html, dom }) => {
    assert.equal(html, "<output>false</output>");
    assert.equal(renders[0], false);
    assert.equal(renders[1], false);
    assert.equal(dom.window.document.querySelector("output").textContent, "true");
  });
  client.clear();
});

test("flag first hydration matches the snapshot despite stale cache, then accepts live refresh", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(featureFlagsQueryKey(985), { example: false });
  const seed = { accountId: 985, evaluatedAt: now, values: { example: true } };
  await hydrate(flagTree(985, seed, client), async ({ html, dom }) => {
    assert.equal(html, "<output>true</output>");
    assert.equal(dom.window.document.querySelector("output").textContent, "false");
    await React.act(async () => client.setQueryData(featureFlagsQueryKey(985), { example: true }));
    assert.equal(dom.window.document.querySelector("output").textContent, "true");
  });
  client.clear();
});
