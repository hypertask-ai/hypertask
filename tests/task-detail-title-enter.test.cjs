const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const React = require("react");

const root = path.resolve(__dirname, "..");
const noop = () => null;

function load(relative, dependencies, exportName = "default") {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  for (const dependency of Object.values(dependencies)) {
    if (dependency && "default" in dependency) dependency.__esModule = true;
  }
  new Function("require", "exports", js)((name) => {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exportName ? exports[exportName] : exports;
}

async function withTitle(t, { mobile = false, status = 200, id = 42, hydrate = false,
  beforeHydration, initialTitle = "Original title", lateLoad = false } = {}) {
  const dom = new JSDOM("<div id='root'></div><div id='description' tabindex='0'></div>", {
    url: "https://app.hypertask.ai/detail/project-7049/1",
  });
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(global, key));
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  }
  // React's input-event support is detected when react-dom/client is loaded.
  const { createRoot, hydrateRoot } = require("react-dom/client");
  let mounted;
  t.after(async () => {
    if (mounted) await React.act(async () => mounted.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  const Context = React.createContext(null);
  const task = { id, projectId: 7049, sectionId: 19409, uniqueIndex: 1, title: initialTitle };
  const requests = [], cache = [], errors = [];
  let state, pendingSave, resolveLoad, loadStarted = false;
  const realtimeHandlers = new Map();
  let useRealtime = noop;
  if (lateLoad) {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    global.fetch = () => {
      loadStarted = true;
      return new Promise((resolve) => { resolveLoad = resolve; });
    };
    const shared = { COMMENT_EVENT: "comment:changed", TASK_EVENT: "task:changed", taskChannel: (id) => `private-task-${id}` };
    const refresh = load("src/lib/realtime/taskDetailRefresh.ts", { "./shared": shared }, null);
    const channel = { subscribed: true,
      bind: (event, handler) => realtimeHandlers.set(event, handler),
      unbind: (event) => realtimeHandlers.delete(event) };
    const client = { subscribe: () => channel, unsubscribe: noop,
      connection: { state: "connected", bind: noop, unbind: noop } };
    const queryClient = { cancelQueries: async () => {}, setQueryData: noop, invalidateQueries: async () => {} };
    useRealtime = load("src/hooks/realtime/useTaskCommentsRealtime.ts", {
      "@tanstack/react-query": { useQueryClient: () => queryClient },
      "@/lib/realtime/client": { connectRealtimeClient: async () => client, releaseRealtimeClientIfIdle: noop },
      "@/lib/realtime/shared": shared,
      "@/lib/realtime/taskDetailRefresh": refresh,
      "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
    }, "useTaskCommentsRealtime");
  }
  const toast = Object.assign(noop, { error: (message) => errors.push(message) });
  const Title = load("src/components/PageComponents/TaskDetail/TopRow/TaskTitle.tsx", {
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => React.useContext(Context) },
    "@/utils/api/Task Detail": { updateTask: async (body) => { requests.push(body); return { status }; } },
    "react-hot-toast": { default: toast, __esModule: true },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(mobile) },
    "@/lib/constants/TaskDetail": { descriptionContainerId: "description" },
    "@/store": {},
    "@/lib/state": { useRecoilState: () => [null, noop], useRecoilValue: () => false },
    "@/hooks/MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigate: noop }) },
    "@/hooks/MultiPages/useClickOutside": { default: noop },
    "@/components/Modals/Common Modals/ConfirmActionModal": { default: noop },
    "@/hooks/General/useAutosizeTextarea": { default: noop },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/hooks/General/useDebounce": { default: (callback) => {
      const latest = React.useRef(callback);
      latest.current = callback;
      return () => { pendingSave = () => latest.current(); };
    } },
    "@/components/Common/Tooltip": { default: noop },
    "lucide-react": { Circle: noop },
    "@/hooks/MultiPages/useUpdateTaskInBoards": { default: () => ({ updateTaskInCache: (...args) => cache.push(args) }) },
    "./RunningTimerIndicator": { default: noop },
  });
  function Provider() {
    const [currentTask, setCurrentTask] = React.useState(task);
    const [editMode, setEditMode] = React.useState("title");
    useRealtime(id, { taskProjectId: task.projectId, taskUniqueIndex: task.uniqueIndex,
      currentTaskTitle: currentTask.title, setCurrentTask, hasPullRequests: true });
    state = { currentTask, setCurrentTask, editMode, setEditMode,
      parsedTask: JSON.stringify(task), focusOn: (id) => document.getElementById(id)?.focus() };
    return React.createElement(Context.Provider, { value: state }, React.createElement(Title));
  }
  const rootElement = document.getElementById("root");
  if (hydrate) {
    const { renderToString } = require("react-dom/server");
    rootElement.innerHTML = renderToString(React.createElement(Provider));
    await beforeHydration?.(document.getElementById("title-input"), dom.window);
    await React.act(async () => {
      mounted = hydrateRoot(rootElement, React.createElement(Provider));
    });
  } else {
    mounted = createRoot(rootElement);
    await React.act(async () => mounted.render(React.createElement(Provider)));
  }
  const input = document.getElementById("title-input");
  return {
    input, requests, cache, errors, state: () => state,
    async refresh() { await React.act(async () => realtimeHandlers.get("task:changed")()); },
    async completeLoad(title = initialTitle) {
      assert.ok(loadStarted, "the initial realtime load started before the rename");
      await React.act(async () => {
        resolveLoad({ ok: true, json: async () => ({ ...task, title, section: "Doing" }) });
      });
    },
    async type(value) {
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    },
    async press(key, options = {}) {
      const event = new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
      await React.act(async () => input.dispatchEvent(event));
      return event;
    },
    async autosave() { assert.ok(pendingSave, "typing schedules autosave"); await React.act(async () => pendingSave()); },
  };
}

for (const [name, mobile, options] of [
  ["desktop Enter", false, {}], ["mobile Enter", true, {}],
  ["desktop Ctrl+Enter", false, { ctrlKey: true }], ["desktop Cmd+Enter", false, { metaKey: true }],
]) {
  test(`${name} saves the renamed title before autosave and prevents a newline`, async (t) => {
    const title = await withTitle(t, { mobile });
    await title.type("Renamed title");
    assert.equal(title.input.value, "Renamed title");
    assert.equal(title.requests.length, 0, "the debounce has not fired yet");
    const event = await title.press("Enter", options);
    assert.deepEqual(title.requests, [{ id: 42, title: "Renamed title" }], "Enter must issue the save immediately");
    assert.equal(event.defaultPrevented, true, "Enter must not insert a newline");
    assert.equal(title.state().currentTask.title, "Renamed title");
    assert.equal(title.input.value, "Renamed title", "the old initialization snapshot must not restore the old title");
    assert.deepEqual(title.cache[0], [{ title: "Renamed title" }, 42, 7049, 19409]);
    assert.equal(title.state().editMode, null);
    assert.equal(document.activeElement.id, "description");
    await title.autosave();
    assert.ok(title.requests.every((request) => request.title === "Renamed title"), "a pending autosave cannot restore the old title");
  });
}

test("IME Enter confirms composition without saving or leaving the title editor", async (t) => {
  const title = await withTitle(t);
  await title.type("Composing title");
  const event = await title.press("Enter", { isComposing: true });
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(title.requests, []);
  assert.equal(title.state().editMode, "title");
  await title.autosave();
  assert.deepEqual(title.requests, [{ id: 42, title: "Composing title" }]);
});

test("typing still autosaves without Enter and Enter after a pause retains the latest title", async (t) => {
  const title = await withTitle(t);
  await title.type("Paused rename");
  await title.autosave();
  assert.deepEqual(title.requests, [{ id: 42, title: "Paused rename" }]);
  await title.press("Enter");
  assert.equal(title.input.value, "Paused rename");
  assert.ok(title.requests.every((request) => request.title === "Paused rename"));
});

test("an unsuccessful Enter save retains the existing rollback and error behavior", async (t) => {
  const title = await withTitle(t, { status: 500 });
  await title.type("Rejected rename");
  await title.press("Enter");
  assert.equal(title.requests.length, 1);
  assert.equal(title.input.value, "Original title");
  assert.equal(title.state().currentTask.title, "Original title");
  assert.deepEqual(title.errors, ["Failed to update task title."]);
  assert.deepEqual(title.cache.at(-1), [{ title: "Original title" }, 42, 7049, 19409]);
});

test("Enter on an unsaved draft keeps its local title without a nonexistent-task request", async (t) => {
  const title = await withTitle(t, { id: -1 });
  await title.type("Draft rename");
  const event = await title.press("Enter");
  assert.equal(event.defaultPrevented, true);
  assert.equal(title.state().currentTask.title, "Draft rename");
  assert.equal(title.input.value, "Draft rename");
  assert.deepEqual(title.requests, []);
});

for (const mobile of [false, true]) {
  test(`direct-link ${mobile ? "mobile" : "desktop"} title waits for hydration, then Enter persists across reload`, async (t) => {
    let savedTitle = "Original title";
    await t.test("server HTML cannot accept an edit without save handlers", async (t) => {
      const title = await withTitle(t, {
        mobile, hydrate: true,
        beforeHydration(input, window) {
          assert.equal(input.value, savedTitle);
          assert.equal(input.readOnly, true, "a visible server title must not accept unsaveable edits");
          input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        },
      });
      assert.equal(title.input.readOnly, false, "hydration enables the existing title editor");
      assert.deepEqual(title.requests, [], "hydration alone must not rename a task");
      await title.type("Early rename");
      await title.press("Enter");
      assert.deepEqual(title.requests, [{ id: 42, title: "Early rename" }]);
      savedTitle = title.requests[0].title;
      assert.equal(title.input.value, savedTitle);
      await title.autosave();
      assert.ok(title.requests.every((request) => request.title === savedTitle));
    });
    await t.test("reload uses the saved title", async (t) => {
      const title = await withTitle(t, { mobile, hydrate: true, initialTitle: savedTitle });
      assert.equal(title.input.value, "Early rename");
      assert.equal(title.state().currentTask.title, "Early rename");
      assert.deepEqual(title.requests, []);
    });
  });
}

for (const mobile of [false, true]) {
  test(`a late initial load after ${mobile ? "mobile" : "desktop"} Enter cannot write back the old title`, async (t) => {
    const title = await withTitle(t, { mobile, lateLoad: true });
    await title.type("Early rename");
    await title.press("Enter");
    assert.deepEqual(title.requests, [{ id: 42, title: "Early rename" }]);
    await title.completeLoad();
    const refreshedTitle = title.state().currentTask.title;
    const displayedTitle = title.input.value;
    assert.equal(title.state().currentTask.section, "Doing", "unrelated refreshed fields still apply");
    await title.autosave();
    assert.deepEqual(title.requests, [{ id: 42, title: "Early rename" }, { id: 42, title: "Early rename" }], "the pending autosave must never PUT the old title");
    assert.equal(refreshedTitle, "Early rename", "a pre-rename response cannot replace the optimistic title");
    assert.equal(displayedTitle, "Early rename");
    await title.refresh();
    await title.completeLoad("Other tab rename");
    assert.equal(title.input.value, "Other tab rename", "a later request can still apply another tab's rename");
  });
}

test("a title refresh without a concurrent local rename still accepts the remote title", async (t) => {
  const title = await withTitle(t, { lateLoad: true });
  await title.completeLoad("Remote rename");
  assert.equal(title.state().currentTask.title, "Remote rename");
  assert.equal(title.input.value, "Remote rename");
  assert.deepEqual(title.requests, [], "a remote refresh must not schedule a title save");
});
