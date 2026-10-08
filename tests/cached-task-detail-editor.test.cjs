const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { createJiti } = require("jiti");
const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") } });
const refresh = jiti(path.join(root, "src/lib/realtime/taskDetailRefresh.ts"));
const flags = jiti(path.join(root, "src/lib/flags/keys.ts"));
const task = { id: 42, projectId: 6859, uniqueIndex: 43, title: "Cached", description_: { content: "Cached body" } };

function compile(source, mocks) {
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", js)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

// Execute the hook's actual state initializer and every description synchronization
// effect, isolating them from unrelated notification and keyboard subscriptions.
const source = ts.createSourceFile("hook.ts", fs.readFileSync(path.join(root, "src/hooks/Task Detail/CommentAndDescriptionHooks/useCommentAndDescriptions.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(source) === "useDescriptionAndCommentsStates"));
const statements = declaration.declarationList.declarations[0].initializer.body.statements;
const relevant = statements.filter((node) => {
  const text = node.getText(source);
  return text.startsWith("const [descriptionAttachments,") || text.startsWith("const preserveEditorContent =") ||
    (text.startsWith("useEffect(") && /\}, \[(currentTask|_parsedTask)\?\.description_/.test(text));
});
assert.equal(relevant.length, 5, "the initializer, preservation guard and all three sync effects must be exercised");
// The preserved predicate comes from the real module, not a test reimplementation.
const syncJs = ts.transpileModule(`
  export function useSync(context) {
    const { currentTask, _parsedTask, setDescription, hasDraft, hasDraftInit, editMode, uploadingDescription } = context;
    const { useState, useEffect } = React;
    const { shouldPreserveTaskEditorContent } = refresh;
    const instantTicketOpen = context.instantTicketOpen ?? true;
    ${relevant.map((node) => node.getText(source)).join("\n")}
    return { descriptionAttachments, setDescriptionAttachments };
  }
`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const syncExports = {};
new Function("exports", "React", "refresh", syncJs)(syncExports, React, refresh);

async function mount(t) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-6859/43" });
  const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const reactRoot = createRoot(document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => reactRoot.unmount());
    global.window = previous.window;
    global.document = previous.document;
    global.IS_REACT_ACT_ENVIRONMENT = previous.act;
    dom.window.close();
  });
  return (element) => React.act(async () => reactRoot.render(element));
}

const protectedStates = [
  { editMode: "description" },
  { editMode: "description-ai" },
  { hasDraft: true },
  { hasDraftInit: true },
  { uploadingDescription: { content: "Uploading" } },
];

test("all description sync effects normalize partial attachments and preserve active local content", async (t) => {
  const render = await mount(t);
  let state;
  const descriptionWrites = [];
  const Probe = ({ parsed, current, editor = {} }) => {
    state = syncExports.useSync({ _parsedTask: parsed, currentTask: current, setDescription: (value) => descriptionWrites.push(value), ...editor });
    return null;
  };
  await render(React.createElement(Probe, { parsed: task, current: task }));
  assert.deepEqual(state.descriptionAttachments, [], "a content-only board description must never unset attachment state");
  await React.act(async () => state.setDescriptionAttachments((current) => {
    assert.equal(current.some((item) => item.id === 1), false, "BackgroundTaskAttachments must receive an array");
    return [...current, { id: 1 }];
  }));
  for (const editor of protectedStates) {
    const parsed = { ...task, description_: { content: "Remote", attachments: [{ id: 99 }] } };
    const current = { ...parsed, description_: { ...parsed.description_ } };
    descriptionWrites.length = 0;
    await render(React.createElement(Probe, { parsed, current, editor }));
    assert.deepEqual(state.descriptionAttachments, [{ id: 1 }], JSON.stringify(editor));
    assert.deepEqual(descriptionWrites, [], "parsedTask effects must not bypass the editor-preservation guard");
  }
  await render(React.createElement(Probe, { parsed: task, current: task }));
  assert.deepEqual(state.descriptionAttachments, []);
  assert.equal(descriptionWrites.at(-1), "Cached body");
});

test("flag-off description synchronization retains production seed updates even during editing", async (t) => {
  const render = await mount(t);
  let state;
  const descriptionWrites = [];
  const Probe = ({ parsed, current }) => {
    state = syncExports.useSync({ instantTicketOpen: false, _parsedTask: parsed, currentTask: current, hasDraft: true, editMode: "description", setDescription: (value) => descriptionWrites.push(value) });
    return null;
  };
  const initial = { ...task, description_: { content: "Production body", attachments: [{ id: 1 }] } };
  await render(React.createElement(Probe, { parsed: initial, current: initial }));
  assert.equal(descriptionWrites.at(-1), "Production body");
  const incoming = { ...task, description_: { content: "Updated seed", attachments: [{ id: 2 }] } };
  await render(React.createElement(Probe, { parsed: incoming, current: incoming }));
  assert.equal(descriptionWrites.at(-1), "Updated seed");
  assert.deepEqual(state.descriptionAttachments, [{ id: 2 }]);
  await render(React.createElement(Probe, { parsed: task, current: incoming }));
  assert.equal(state.descriptionAttachments, undefined, "flag-off must retain production's unnormalized seed effect");
});

test("cached refresh keeps parsedTask stable while updating metadata and preserving editor content", async (t) => {
  const render = await mount(t);
  const Context = React.createContext(null);
  let editor = {};
  let incoming = task;
  let state;
  const parsedSnapshots = [];
  const Provider = ({ parsedTask, children }) => {
    parsedSnapshots.push(parsedTask);
    const parsed = React.useMemo(() => JSON.parse(parsedTask), [parsedTask]);
    const [currentTask, setCurrentTask] = React.useState(parsed);
    const [description, setDescription] = React.useState(parsed.description_.content);
    const value = { currentTask, setCurrentTask, description, setDescription, ...editor };
    const sync = syncExports.useSync({ ...value, _parsedTask: parsed });
    state = { ...value, ...sync };
    return React.createElement(Context.Provider, { value }, children);
  };
  const mocks = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-query": { useQueryClient: () => ({}), useQuery: ({ queryKey }) => queryKey[0] === "cached-task-detail" ? { data: incoming } : {} },
    "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
    "@/store": { currentUserAtom: {} },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
    "@/hooks/useFlag": { useFlag: key => key !== flags.HTPR_7004_NO_LOADING_FLASH_FLAG },
    "@/lib/flags/keys": flags,
    "@/lib/constants": { __esModule: true, default: { CommentsTQPrefixKey: "comments" } },
    "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: ({ children }) => children },
    "@/lib/contexts/TaskDetail/TaskProvider": { TasksProvider: Provider, useTaskContext: () => React.useContext(Context) },
    "@/lib/navigation/cachedTaskDetail": jiti(path.join(root, "src/lib/navigation/cachedTaskDetail.ts")),
    "@/lib/realtime/taskDetailRefresh": refresh,
    "@/app/unauthorized/page": { __esModule: true, default: () => null },
    "@/utils/api/Task Detail": { fetchCommentsHelper: () => assert.fail("comments must not block cached rendering") },
    "@/app/detail/[...slug]/TaskDetailComp": { __esModule: true, default: () => null },
  };
  const Detail = compile(fs.readFileSync(path.join(root, "src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx"), "utf8"), mocks).default;
  const element = () => React.createElement(Detail, { taskId: 42, projectId: 6859, uniqueIndex: 43, initialTask: task, embedded: false });
  await render(element());
  for (const [index, protectedState] of protectedStates.entries()) {
    editor = protectedState;
    await render(element());
    await React.act(async () => {
      state.setDescription("Local draft");
      state.setDescriptionAttachments([{ id: 1 }]);
    });
    incoming = { ...task, title: `Remote title ${index}`, description_: { content: "Remote body", attachments: [{ id: 99 }] } };
    await render(element());
    assert.equal(state.currentTask.title, incoming.title, "metadata still refreshes");
    assert.equal(state.description, "Local draft", JSON.stringify(protectedState));
    assert.deepEqual(state.descriptionAttachments, [{ id: 1 }]);
    assert.equal(state.currentTask.description_.content, "Cached body");
  }
  editor = {};
  await render(element());
  assert.equal(state.description, "Local draft", "ending editing must not replay an old refresh");
  incoming = { ...incoming, title: "Latest", description_: { content: "Latest body", attachments: [{ id: 2 }] } };
  await render(element());
  assert.equal(state.description, "Latest body");
  assert.deepEqual(state.descriptionAttachments, [{ id: 2 }]);
  assert.equal(new Set(parsedSnapshots).size, 1, "provider initialization cannot change underneath an active editor");
});

test("cached refresh failures retry in place during edits, drafts and uploads, then recover only when idle", async (t) => {
  const render = await mount(t);
  const Context = React.createContext(null);
  let editor = {};
  let error;
  let retries = 0;
  const refetch = async () => { retries += 1; };
  const Provider = ({ children }) => React.createElement(Context.Provider, { value: editor }, children);
  const Detail = compile(fs.readFileSync(path.join(root, "src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx"), "utf8"), {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@tanstack/react-query": { useQueryClient: () => ({}), useQuery: ({ queryKey }) => queryKey[0] === "cached-task-detail" ? { data: task, error, refetch } : {} },
    "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
    "@/store": { currentUserAtom: {} },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
    "@/hooks/useFlag": { useFlag: key => key !== flags.HTPR_7004_NO_LOADING_FLASH_FLAG },
    "@/lib/flags/keys": flags,
    "@/lib/constants": { __esModule: true, default: { CommentsTQPrefixKey: "comments" } },
    "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: ({ children }) => children },
    "@/lib/contexts/TaskDetail/TaskProvider": { TasksProvider: Provider, useTaskContext: () => React.useContext(Context) },
    "@/lib/navigation/cachedTaskDetail": jiti(path.join(root, "src/lib/navigation/cachedTaskDetail.ts")),
    "@/lib/realtime/taskDetailRefresh": refresh,
    "@/app/unauthorized/page": { __esModule: true, default: () => null },
    "@/utils/api/Task Detail": {},
    "@/app/detail/[...slug]/TaskDetailComp": { __esModule: true, default: () => React.createElement("textarea", { defaultValue: "Local unsaved edit" }) },
  }).default;
  const replacements = [];
  const timers = new Map();
  let timerId = 0;
  const browserWindow = global.window;
  const href = browserWindow.location.href;
  global.window = {
    location: { href, replace: (url) => replacements.push(url) },
    setTimeout: (callback, delay) => { assert.equal(delay, 1000); timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  };
  try {
    const element = () => React.createElement(Detail, { taskId: 42, projectId: 6859, uniqueIndex: 43, initialTask: task, embedded: false });
    await render(element());
    const input = document.querySelector("textarea");
    input.value = "Typed draft";
    for (const protectedState of [...protectedStates, { editMode: "title" }]) {
      editor = protectedState;
      error = new Error("Refresh failed");
      await render(element());
      assert.deepEqual(replacements, [], JSON.stringify(editor));
      assert.equal(document.querySelector("textarea"), input, "the active editor must remain mounted");
      assert.equal(input.value, "Typed draft");
      assert.equal(timers.size, 1, "retry is scheduled in place");
      const before = retries;
      await React.act(async () => [...timers.values()][0]());
      assert.equal(retries, before + 1);
    }
    editor = {};
    await render(element());
    assert.equal(timers.size, 0, "pending retry is cancelled when idle");
    assert.deepEqual(replacements, [href]);
  } finally {
    global.window = browserWindow;
  }
});

for (const enabled of [true, false]) {
  test(`HTPR-7004 bounds refresh retries, resets on success and preserves access denial and editing (flag=${enabled})`, async t => {
    const render = await mount(t);
    const cache = jiti(path.join(root, "src/lib/navigation/cachedTaskDetail.ts"));
    let error = null;
    let editor = {};
    let retries = 0;
    const refetch = async () => { retries++; };
    const Detail = compile(fs.readFileSync(path.join(root, "src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx"), "utf8"), {
      react: React,
      "react/jsx-runtime": require("react/jsx-runtime"),
      "@tanstack/react-query": { useQueryClient: () => ({}), useQuery: ({ queryKey }) => queryKey[0] === "cached-task-detail" ? { data: task, error, refetch } : {} },
      "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
      "@/store": { currentUserAtom: {} },
      "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
      "@/hooks/useFlag": { useFlag: key => key === flags.HTPR_7004_NO_LOADING_FLASH_FLAG ? enabled : true },
      "@/lib/flags/keys": flags,
      "@/lib/constants": { __esModule: true, default: { CommentsTQPrefixKey: "comments" } },
      "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: ({ children }) => children },
      "@/lib/contexts/TaskDetail/TaskProvider": { TasksProvider: ({ children }) => children, useTaskContext: () => editor },
      "@/lib/navigation/cachedTaskDetail": cache,
      "@/lib/realtime/taskDetailRefresh": refresh,
      "@/app/unauthorized/page": { __esModule: true, default: () => React.createElement("div", { role: "alert" }, "No access") },
      "@/utils/api/Task Detail": {},
      "@/app/detail/[...slug]/TaskDetailComp": { __esModule: true, default: () => React.createElement("textarea", { id: "title-input", defaultValue: task.title }) },
    }).default;
    const browserWindow = global.window;
    const replacements = [];
    const timers = new Map();
    let timerId = 0;
    global.window = {
      location: { href: browserWindow.location.href, replace: url => replacements.push(url) },
      setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
      clearTimeout: id => timers.delete(id),
    };
    try {
      const element = () => React.createElement(Detail, { taskId: 42, projectId: 6859, uniqueIndex: 43, initialTask: task, embedded: false });
      await render(element());
      const title = document.querySelector("#title-input");
      const fireRetry = async delay => {
        assert.equal(timers.size, 1);
        const [id, timer] = [...timers.entries()][0];
        assert.equal(timer.delay, delay);
        timers.delete(id);
        const before = retries;
        await React.act(async () => timer.callback());
        assert.equal(retries, before + 1);
      };
      for (let streak = 0; streak < 2; streak++) {
        const before = retries;
        const reloadsBefore = replacements.length;
        for (const delay of [1000, 2000, 4000]) {
          error = new TypeError("Failed to fetch");
          await render(element());
          assert.equal(document.querySelector("#title-input"), title, "the parent stays committed");
          assert.equal(title.value, task.title);
          if (enabled) {
            assert.equal(replacements.length, reloadsBefore, "recoverable failures retry before reloading");
            await render(element());
            await fireRetry(delay);
          } else {
            assert.equal(replacements.at(-1), browserWindow.location.href, "OFF positive control still reloads immediately");
            assert.equal(timers.size, 0);
          }
        }
        error = new Error("Unable to load task");
        await render(element());
        assert.equal(timers.size, 0, "persistent failures stop retrying after the bound");
        assert.equal(retries - before, enabled ? 3 : 0);
        assert.equal(replacements.length - reloadsBefore, enabled ? 1 : 4);
        assert.equal(replacements.at(-1), browserWindow.location.href);
        error = null;
        await render(element());
        assert.equal(timers.size, 0, "success ends the streak and resets its retry budget");
      }
      error = new Error("Another refresh failure");
      await render(element());
      if (enabled) assert.equal([...timers.values()][0].delay, 1000);
      error = null;
      await render(element());
      assert.equal(timers.size, 0, "success cancels a pending retry without consuming the budget");
      error = new Error("Failure before departure");
      await render(element());
      await render(null);
      assert.equal(timers.size, 0, "leaving the parent cancels its retry");
      const reloadsBeforeEditing = replacements.length;
      for (const protectedState of [...protectedStates, { editMode: "title" }]) {
        editor = protectedState;
        error = new Error("Failure while editing");
        await render(element());
        await fireRetry(1000);
        assert.equal(replacements.length, reloadsBeforeEditing, "editing still retries indefinitely at one second");
      }
      editor = {};
      error = new cache.TaskAccessDeniedError();
      await render(element());
      assert.equal(document.querySelector("#title-input"), null, "authorization denial must not retain cached content");
      assert.equal(document.querySelector('[role="alert"]').textContent, "No access");
      assert.equal(timers.size, 0, "denials are not treated as transient failures");
      assert.equal(replacements.at(-1), browserWindow.location.href);
      const reloadsBeforeDeniedEdit = replacements.length;
      editor = { hasDraft: true };
      error = new cache.TaskAccessDeniedError();
      await render(element());
      await fireRetry(1000);
      assert.equal(document.querySelector("#title-input"), null);
      assert.equal(document.querySelector('[role="alert"]').textContent, "No access");
      assert.equal(replacements.length, reloadsBeforeDeniedEdit, "access denial during editing retains today's retry behaviour");
      await render(null);
      assert.equal(timers.size, 0);
    } finally {
      global.window = browserWindow;
    }
  });
}
