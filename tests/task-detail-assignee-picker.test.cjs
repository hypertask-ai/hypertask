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

async function withPicker(t, { enabled = true, initialAssignees = [], rejectSave = false, holdSave = false, loadPath = "realtime" } = {}) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-6859/61" });
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(global, key));
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  }
  const originalFetch = global.fetch;
  let resolveLoad, loadStarted = false, mounted, state, serverRows = initialAssignees;
  global.fetch = () => {
    loadStarted = true;
    return new Promise(resolve => { resolveLoad = resolve; });
  };
  t.after(async () => {
    if (resolveSave) await React.act(async () => resolveSave());
    if (mounted) await React.act(async () => mounted.unmount());
    global.fetch = originalFetch;
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  const user = { id: 2343, displayName: "QA user" };
  const taskContext = React.createContext(null);
  const task = { id: 55840, projectId: 6859, uniqueIndex: 61, title: "HTPR-6962 QA", sectionId: 1,
    assignees: initialAssignees, project: { id: 6859 }, description_: { id: 1 } };
  const reactQuery = require("@tanstack/react-query");
  const cachedQueryKey = ["cached-task-detail", user.id, task.id];
  const cachedQueryClient = new reactQuery.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  t.after(() => cachedQueryClient.clear());
  let resolveReaction, pendingReaction, resolveSave;
  const requests = [], handlers = new Map();
  const queryClient = { cancelQueries: async () => {}, setQueryData: noop, invalidateQueries: async () => {}, refetchQueries: noop };
  const shared = { COMMENT_EVENT: "comment:changed", TASK_EVENT: "task:changed", taskChannel: id => `private-task-${id}` };
  const refresh = load("src/lib/realtime/taskDetailRefresh.ts", { "./shared": shared }, null);
  const channel = { subscribed: true, bind: (event, handler) => handlers.set(event, handler), unbind: event => handlers.delete(event) };
  const client = { subscribe: () => channel, unsubscribe: noop, connection: { state: "connected", bind: noop, unbind: noop } };
  const useRealtime = load("src/hooks/realtime/useTaskCommentsRealtime.ts", {
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/lib/realtime/client": { connectRealtimeClient: async () => client, releaseRealtimeClientIfIdle: noop },
    "@/lib/realtime/shared": shared,
    "@/lib/realtime/taskDetailRefresh": refresh,
    "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
  }, "useTaskCommentsRealtime");
  const assignees = load("src/lib/assignees.ts", {}, null);
  const constants = { default: { CommentsTQPrefixKey: "comments" } };
  const assign = load("src/hooks/Task Detail/useAssignTaskUser.ts", {
    "axios": { default: { post: async (url, body) => {
      requests.push({ url, body });
      if (holdSave) await new Promise(resolve => { resolveSave = resolve; });
      if (rejectSave) throw new Error("Save rejected");
      serverRows = body.intent === "unassign" ? serverRows.filter(row => row.userId !== user.id)
        : [...serverRows, { id: 1, taskId: task.id, userId: user.id, user, agentId: null, agent: null }];
      return { data: { body: serverRows } };
    } } },
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/lib/constants": constants,
    "@/lib/assignees": assignees,
  }, null);
  const keyCodes = { ESCAPE: 27, ENTER: 13, ARROW_DOWN: 40, ARROW_UP: 38 };
  const div = ({ children, id, onClick }) => React.createElement("div", { id, onClick }, children);
  let members = { members: [{ user }], owner: user, boardAgents: [] };
  const Assign = load("src/components/Modals/AssignToUser/AssignToUser.tsx", {
    "lucide-react": { Bot: noop, Check: () => React.createElement("span", { "data-checked": true }) },
    "reactstrap": { ModalBody: div },
    "@/lib/state": { useRecoilValue: () => user },
    "@/styles/linksModal.module.scss": { default: {} },
    "@/store": {},
    "@/hooks/MultiPages/useGetMembersForAssignees": { useGetAllMembersForAssign: () => ({ data: members }) },
    "@/components/Common/CommonModalComponents": { ModalContainerCustom: ({ children }) => React.createElement("div", { role: "dialog" }, children),
      ModalHeaderComp: noop, ModalInput: ({ onChange, value, placeholder }) => React.createElement("input", { onChange, value, placeholder }),
      ModalListContainer: div, ModalRowElementContainer: div },
    "@/hooks/General/useHandleMouse": { default: () => ({ handleMouseEnter: noop, handleMouseLeave: noop, handleMouseMove: noop }) },
    "@/lib/constants/keyboard-handler": { KeyCodes: keyCodes },
    "@/hooks/Task Detail/useAssignTaskUser": assign,
    "@/lib/realtime/taskDetailRefresh": refresh,
    "@/lib/assignees": assignees,
    "@/lib/assigneeRecency": { getAssigneeRecencyStorage: noop, getAssigneeRecencyLockManager: noop,
      readRecentAssigneeKeys: () => [], recordRecentAssigneeUse: noop, sortAssigneeOptionsByRecency: list => list },
    "@/components/Common/UserAvatar": { default: noop },
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/keys": {},
  });
  const Assignees = load("src/components/PageComponents/TaskDetail/AssigneesContainer.tsx", {
    "@/utils": { taskBaseUri: "/detail/" },
    "@/components/PageComponents/TaskDetail/MainPageComponents": { TaskInfoRow: div, TaskInfoLabel: div, TaskInfoValue: div,
      ClickableSpan: ({ title }) => React.createElement("span", null, title), AssigneeCard: ({ user }) => React.createElement("span", null, user.displayName) },
    "@/components/Common/Tooltip": { default: noop },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "next/dynamic": { default: () => Assign },
    "@/lib/assignees": assignees,
  });
  const common = { "react-hot-toast": { default: noop }, "@/lib/configs/taskDetail.config": { default: {} }, "@/lib/constants": constants };
  const useActions = load("src/app/detail/[...slug]/useTaskDetailCommentActions.tsx", {
    ...common, "@prisma/client": {}, "@/utils/helperFunctions/hasFigmaEmbed": { hasFigmaEmbed: () => false },
  }, "useTaskDetailCommentActions");
  const useNavigation = load("src/app/detail/[...slug]/useTaskDetailNavigationActions.tsx", {
    ...common, "@/components/undoToast": { undoToastSettings: {} }, "@/lib/constants/TaskDetail": { descriptionContainerId: "description" },
  }, "useTaskDetailNavigationActions");
  const useReactions = load("src/hooks/Task Detail/CommentAndDescriptionHooks/useDescriptionReactions.ts", {
    "@/lib/constants/constants": {}, "@/lib/constants/TaskDetail": {}, "@/store": {},
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => state },
    "axios": { default: { post: () => new Promise(resolve => { resolveReaction = resolve; }) } },
    "@/hooks/useFlag": { useFlag: () => enabled }, "@/lib/flags/keys": {},
    "@/lib/realtime/taskDetailRefresh": refresh,
    "@/lib/state": { useRecoilState: () => [user, noop] },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
  });
  function Provider({ children, parsedTask } = {}) {
    const [currentTask, setCurrentTask] = React.useState(() => parsedTask ? JSON.parse(parsedTask) : task);
    const [showAssignModal, setShowAssignModal] = React.useState(false);
    const lastM_APress = React.useRef(null);
    useRealtime(loadPath === "realtime" ? task.id : null, { taskProjectId: task.projectId, taskUniqueIndex: task.uniqueIndex,
      currentTaskTitle: currentTask.title, currentTaskAssignees: currentTask.assignees, keepAssignee: enabled,
      setCurrentTask, hasPullRequests: true });
    state = { currentTask, setCurrentTask, showAssignModal, setShowAssignModal, lastM_APress,
      updateTaskInCache: noop, _setActiveItem: noop, setInViewObject: noop, queryClient, setDescription: noop, parsedTask: JSON.stringify(task), focusOn: noop };
    Object.assign(state, useActions(() => state));
    Object.assign(state, useNavigation(() => state));
    state.reactions = useReactions();
    return React.createElement(taskContext.Provider, { value: state }, children ?? React.createElement(Assignees, { slugs: ["project-6859", "61"], currentTask, showAssigneeModal: showAssignModal,
      toggleAssigneeModal: state.toggleModal, showTooltip: false }));
  }
  const preferences = { commentsStacked: true };
  const Embedded = load("src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx", {
    "@tanstack/react-query": reactQuery,
    "@/app/unauthorized/page": { default: noop },
    "@/lib/navigation/cachedTaskDetail": { cachedTaskDetailKey: () => cachedQueryKey, TaskAccessDeniedError: class extends Error {} },
    "@/lib/contexts/TaskDetail/TaskProvider": { TasksProvider: Provider, useTaskContext: () => React.useContext(taskContext) },
    "@/lib/realtime/taskDetailRefresh": refresh,
    "@/app/detail/[...slug]/TaskDetailComp": { default: () => {
      const context = React.useContext(taskContext);
      return React.createElement(Assignees, { slugs: ["project-6859", "61"], currentTask: context.currentTask,
        showAssigneeModal: context.showAssignModal, toggleAssigneeModal: context.toggleModal, showTooltip: false });
    } },
    "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: preferences }) },
    "@/hooks/useFlag": { useFlag: key => key === "htpr-6962-keep-assignee" && enabled },
    "@/lib/flags/keys": { HTPR_6962_KEEP_ASSIGNEE_FLAG: "htpr-6962-keep-assignee" },
    "@/lib/constants": constants,
    "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: ({ children }) => children },
    "@/lib/state": { useRecoilValue: () => user },
    "@/store": {},
    "@/utils/api/Task Detail": { fetchCommentsHelper: async () => [] },
  });
  const { createRoot } = require("react-dom/client");
  mounted = createRoot(document.getElementById("root"));
  await React.act(async () => mounted.render(loadPath === "initial"
    ? React.createElement(reactQuery.QueryClientProvider, { client: cachedQueryClient },
      React.createElement(Embedded, { taskId: task.id, projectId: task.projectId, uniqueIndex: task.uniqueIndex, initialTask: task, embedded: false }))
    : React.createElement(Provider)));
  return {
    requests, state: () => state, serverRows: () => serverRows,
    row: () => document.getElementById("root").firstElementChild.textContent,
    async open() { state.lastM_APress.current = null; await React.act(async () => state.aHandler()); },
    async select() { await React.act(async () => document.getElementById(`task_${user.id}`).click()); },
    async escape() {
      await React.act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true })));
      assert.equal(document.querySelector("[role=dialog]"), null);
    },
    async completeSave() { await React.act(async () => { assert.ok(resolveSave, "the write is pending"); resolveSave(); }); },
    async completeLoad(rows = initialAssignees, title = task.title) {
      assert.ok(loadStarted, "the task fetch has started");
      await React.act(async () => {
        const loaded = loadPath === "initial" ? new Promise(resolve => {
          const unsubscribe = cachedQueryClient.getQueryCache().subscribe(event => {
            if (event.type === "updated" && event.action.type === "success") { unsubscribe(); resolve(); }
          });
        }) : undefined;
        resolveLoad({ ok: true, status: 200, json: async () => ({ ...task, title, section: "Doing", assignees: rows }) });
        await loaded;
      });
      await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    },
    async startReaction() { await React.act(async () => { pendingReaction = state.reactions.emojiClickHandlerDescriptionr({ unified: "1f44d" }); }); },
    async completeReaction() { await React.act(async () => { resolveReaction({ data: [{ emoji: "thumbs-up" }] }); await pendingReaction; }); },
    async refreshMembers() { members = { ...members }; await React.act(async () => state.setCurrentTask(current => ({ ...current }))); },
    checked: () => Boolean(document.querySelector("[data-checked]")),
    async refresh() { await React.act(async () => {
      if (loadPath === "initial") void cachedQueryClient.refetchQueries({ queryKey: cachedQueryKey });
      else handlers.get("task:changed")();
    }); },
  };
}

for (const loadPath of ["realtime", "initial"]) for (const enabled of [true, false]) {
  test(`${loadPath}: closing the picker then receiving a pre-selection response ${enabled ? "keeps the assignee" : "retains the flag-off path"}`, async t => {
    const picker = await withPicker(t, { enabled, loadPath });
    await picker.open();
    await picker.select();
    assert.match(picker.row(), /QA user/);
    assert.equal(picker.state().showAssignModal, true);
    assert.deepEqual(picker.requests[0], { url: "/api/assignees/assign", body: { userId: 2343, taskId: 55840, agentId: undefined, intent: "assign" } });
    await picker.escape();
    await picker.completeLoad();
    assert.deepEqual(picker.serverRows().map(row => row.userId), [2343], "Escape cannot undo the server save");
    assert.equal(picker.row(), enabled ? "AssigneesQA user" : "AssigneesThe Assignees");
    assert.equal(picker.state().currentTask.section, "Doing", "unrelated server fields still refresh");
    if (enabled) {
      await picker.refresh();
      await picker.completeLoad([]);
      assert.equal(picker.row(), "AssigneesThe Assignees", "a later remote removal without a local toggle still applies");
    }
  });
}

for (const loadPath of ["realtime", "initial"]) for (const enabled of [true, false]) for (const intent of ["assign", "unassign"]) {
  test(`${loadPath}: refetch started while ${intent} is pending ${enabled ? "keeps the local row" : "retains flag-off behavior"}`, async t => {
    const assigned = [{ id: 1, userId: 2343, user: { id: 2343, displayName: "QA user" }, agent: null }];
    const initialAssignees = intent === "assign" ? [] : assigned;
    const picker = await withPicker(t, { enabled, initialAssignees, holdSave: true, loadPath });
    await picker.completeLoad();
    await picker.open();
    await picker.select();
    await picker.escape();
    const localRows = picker.state().currentTask.assignees;
    const expected = intent === "assign" ? "AssigneesQA user" : "AssigneesThe Assignees";
    assert.equal(picker.row(), expected);
    assert.equal(picker.requests[0].body.intent, intent);
    assert.deepEqual(picker.serverRows(), initialAssignees, "the outbound write has not committed");
    await picker.refresh();
    await picker.completeLoad(initialAssignees, "Remote title while save pending");
    assert.equal(picker.row(), enabled ? expected : intent === "assign" ? "AssigneesThe Assignees" : "AssigneesQA user");
    if (enabled) assert.equal(picker.state().currentTask.assignees, localRows, "no assignee reference change occurred during this fetch");
    assert.equal(picker.state().currentTask.section, "Doing");
    await picker.completeSave();
    assert.equal(picker.row(), expected, "the authoritative response still applies after Escape");
    assert.equal(picker.state().currentTask.assignees, picker.serverRows());
    await picker.refresh();
    await picker.completeLoad(initialAssignees);
    assert.equal(picker.row(), intent === "assign" ? "AssigneesThe Assignees" : "AssigneesQA user", "after acknowledgement, remote changes apply normally");
  });
}

for (const intent of ["assign", "unassign"]) {
  test(`a failed pending ${intent} rolls back and clears refresh protection`, async t => {
    const originalError = console.error;
    console.error = noop;
    t.after(() => { console.error = originalError; });
    const assigned = [{ id: 1, userId: 2343, user: { id: 2343, displayName: "QA user" }, agent: null }];
    const initialAssignees = intent === "assign" ? [] : assigned;
    const picker = await withPicker(t, { initialAssignees, holdSave: true, rejectSave: true });
    await picker.completeLoad();
    await picker.open();
    await picker.select();
    await picker.escape();
    await picker.completeSave();
    assert.equal(picker.row(), intent === "assign" ? "AssigneesThe Assignees" : "AssigneesQA user");
    await picker.refresh();
    await picker.completeLoad(intent === "assign" ? assigned : []);
    assert.equal(picker.row(), intent === "assign" ? "AssigneesQA user" : "AssigneesThe Assignees", "a failed write cannot leave a pending marker behind");
  });
}

test("reload renders the assignee saved by the picker", async t => {
  let saved;
  await t.test("assign and close", async t => {
    const picker = await withPicker(t);
    await picker.open();
    await picker.select();
    await picker.escape();
    saved = picker.serverRows();
  });
  await t.test("mount from the saved task API rows", async t => {
    const picker = await withPicker(t, { initialAssignees: saved });
    await picker.completeLoad(saved);
    assert.equal(picker.row(), "AssigneesQA user");
    assert.deepEqual(picker.requests, []);
  });
});

test("removing the last person cannot be undone by a pre-removal refetch", async t => {
  const initialAssignees = [{ id: 1, userId: 2343, user: { id: 2343, displayName: "QA user" }, agent: null }];
  const picker = await withPicker(t, { initialAssignees });
  await picker.open();
  await picker.select();
  await picker.escape();
  await picker.completeLoad(initialAssignees);
  assert.equal(picker.row(), "AssigneesThe Assignees");
  assert.deepEqual(picker.serverRows(), []);
});

test("a failed assignment still rolls back instead of keeping an unsaved name", async t => {
  const originalError = console.error;
  console.error = noop;
  t.after(() => { console.error = originalError; });
  const picker = await withPicker(t, { rejectSave: true });
  await picker.open();
  await picker.select();
  await picker.escape();
  await picker.completeLoad();
  assert.equal(picker.row(), "AssigneesThe Assignees");
  assert.deepEqual(picker.serverRows(), []);
});

test("assigning a person preserves hidden agent assignees", async t => {
  const agent = { id: "agent-1", displayName: "Existing agent" };
  const initialAssignees = [{ id: 2, userId: null, user: null, agentId: agent.id, agent }];
  const picker = await withPicker(t, { initialAssignees });
  await picker.open();
  await picker.select();
  await picker.escape();
  await picker.completeLoad(initialAssignees);
  assert.equal(picker.row(), "AssigneesQA user");
  assert.deepEqual(picker.state().currentTask.assignees.map(row => row.agentId || row.userId), ["agent-1", 2343]);
});

for (const enabled of [true, false]) {
  test(`initial response while the picker is open ${enabled ? "keeps" : "resets"} the row and reopening tick`, async t => {
    const picker = await withPicker(t, { enabled, loadPath: "initial" });
    await picker.open();
    await picker.select();
    assert.equal(picker.checked(), true);
    await picker.completeLoad();
    assert.equal(picker.checked(), true, "the open picker does not reset its own optimistic list on task props");
    assert.equal(picker.row().includes("The Assignees"), !enabled);
    await picker.refreshMembers();
    assert.equal(picker.checked(), enabled, "members revalidation builds ticks from current task assignees");
    await picker.escape();
    await picker.open();
    assert.equal(picker.checked(), enabled, "reopening derives ticks from the guarded task row");
    await picker.escape();
  });
}

test("initial and subsequent revalidation accept server assignees when no local pick occurred", async t => {
  const rows = [{ id: 1, userId: 2343, user: { id: 2343, displayName: "QA user" }, agent: null }];
  const picker = await withPicker(t, { loadPath: "initial" });
  await picker.completeLoad(rows);
  assert.equal(picker.row(), "AssigneesQA user");
  await picker.refresh();
  await picker.completeLoad([]);
  assert.equal(picker.row(), "AssigneesThe Assignees");
});

test("a pick during a subsequent cached-query revalidation wins over that response", async t => {
  const picker = await withPicker(t, { loadPath: "initial" });
  await picker.completeLoad();
  await picker.refresh();
  await picker.open();
  await picker.select();
  await picker.escape();
  await picker.completeLoad();
  assert.equal(picker.row(), "AssigneesQA user");
});

test("the shared assignee rule preserves empty removals and formerly undefined rows, but not other tasks or flag-off changes", () => {
  const { preserveTaskAssigneesChangedDuringFetch: preserve } = load("src/lib/realtime/taskDetailRefresh.ts", { "./shared": {} }, null);
  const start = [{ userId: 2343 }];
  const fetched = { id: 1, projectId: 2, assignees: start, title: "Server title" };
  const current = { ...fetched, assignees: [] };
  assert.equal(preserve(current, fetched, start, true).assignees, current.assignees);
  assert.equal(preserve(current, fetched, undefined, true).assignees, current.assignees);
  assert.equal(preserve(current, fetched, current.assignees, true), fetched);
  assert.equal(preserve(current, fetched, start, false), fetched);
  assert.equal(preserve({ ...current, id: 3 }, fetched, start, true), fetched);
  assert.equal(preserve({ ...current, projectId: 3 }, fetched, start, true), fetched);
  assert.equal(preserve(null, fetched, start, true), fetched);
  assert.equal(preserve(current, fetched, start, true).title, "Server title");
});

test("pending assignee writes are counted per task and cleared only after every write finishes", () => {
  const { beginTaskAssigneeWrite, preserveTaskAssigneesChangedDuringFetch: preserve } = load("src/lib/realtime/taskDetailRefresh.ts", { "./shared": {} }, null);
  const current = { id: 1, projectId: 2, assignees: [] };
  const fetched = { ...current, assignees: [{ userId: 2343 }] };
  const finishFirst = beginTaskAssigneeWrite(current.id);
  const finishSecond = beginTaskAssigneeWrite(current.id);
  const finishOther = beginTaskAssigneeWrite(3);
  try {
    assert.equal(preserve(current, fetched, current.assignees, true).assignees, current.assignees);
    assert.equal(preserve(current, fetched, current.assignees, false), fetched);
    assert.equal(preserve({ ...current, id: 3 }, fetched, current.assignees, true), fetched);
    assert.equal(preserve({ ...current, projectId: 3 }, fetched, current.assignees, true), fetched);
    assert.equal(preserve(null, fetched, current.assignees, true), fetched);
    finishSecond();
    assert.equal(preserve(current, fetched, current.assignees, true).assignees, current.assignees, "an older pending write still needs protection");
    finishFirst();
    assert.equal(preserve(current, fetched, current.assignees, true), fetched, "a different task's pending write cannot block this refresh");
  } finally {
    finishOther();
  }
});

for (const enabled of [true, false]) {
  test(`description reaction finishing after a pick ${enabled ? "preserves the assignee" : "retains the flag-off replacement"}`, async t => {
    const picker = await withPicker(t, { enabled });
    await picker.startReaction();
    await picker.open();
    await picker.select();
    await picker.escape();
    await picker.completeReaction();
    assert.equal(picker.row(), enabled ? "AssigneesQA user" : "AssigneesThe Assignees");
    assert.deepEqual(picker.state().currentTask.description_.reactions, [{ emoji: "thumbs-up" }]);
  });
}
