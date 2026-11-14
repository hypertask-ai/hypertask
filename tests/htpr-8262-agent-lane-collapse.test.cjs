const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadModule } = require("./helpers/loadModule.cjs");

const flagKey = "htpr-8262-agent-lane-collapse";
const icon = () => React.createElement("i", null);

const thought = {
  id: "activity-1",
  runId: "run-1",
  type: "thought",
  text: "Read the ticket and the two comments before touching the lane spacing.",
  createdAt: "2026-11-03T10:00:00.000Z",
  selectedOption: null,
};

function loadRow(fold) {
  const { flagEnabled, foldTaskId = 15 } = fold;
  return loadModule(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/AgentRunActivityRow.tsx",
    {
      "lucide-react": { Activity: icon, CircleAlert: icon, CircleHelp: icon, ExternalLink: icon, Lightbulb: icon },
      "react-hot-toast": { default: { error() {} } },
      "@tanstack/react-query": { useQueryClient: () => ({}) },
      "./CommentContainer/CommentBodyDesktop": { default: ({ children }) => React.createElement("div", { "data-comment-card": true }, children) },
      "@/styles/tiptap.module.scss": { default: { unstacked_grid_row1: "header", unstacked_grid_row2: "body" } },
      "@/components/Common/RelativeTime": { default: () => React.createElement("time", null, "2h") },
      "@/hooks/useFlag": { useFlag: () => flagEnabled },
      "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ agentLaneFold: { taskId: foldTaskId, collapsed: fold.collapsed ?? false, version: fold.version ?? 1 } }) },
      "@/lib/agentRuns/model": {},
      "@/lib/agentRuns/taskActivityFeed": { safeAgentRunActivityLink: () => null },
      "@/lib/flags/definitions/htpr-8262-agent-lane-collapse": { HTPR_8262_AGENT_LANE_COLLAPSE_FLAG: flagKey },
      "@/lib/realtime/taskCommentsRefresh": { refreshTaskComments: async () => {} },
      "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
    },
  ).default;
}

function render({ flagEnabled, collapsed = false, activity = thought, taskId = 15, foldTaskId = 15 }) {
  const Row = loadRow({ flagEnabled, collapsed, foldTaskId });
  return renderToStaticMarkup(React.createElement(Row, { activity, taskId }));
}

const isFoldedRow = (html) => html.includes("text-ellipsis");

test("flag off preserves the original expanded inset even when the thread is collapsed", () => {
  const html = render({ flagEnabled: false, collapsed: true });
  assert.equal(isFoldedRow(html), false);
  assert.match(html, /role="group"/);
  assert.match(html, /px-3 py-1/);
  assert.match(html, /px-3 py-2/);
  assert.doesNotMatch(html, /data-comment-card/);
});

test("thread collapse folds agent entries, and restore opens the shared comment card", () => {
  const folded = render({ flagEnabled: true, collapsed: true });
  assert.equal(isFoldedRow(folded), true);
  assert.match(folded, /h-\[29px\]/);
  assert.match(folded, /my-\[4px\]/);
  assert.match(folded, /aria-expanded="false"/);
  const open = render({ flagEnabled: true, collapsed: false });
  assert.equal(isFoldedRow(open), false);
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /data-comment-card/);
  assert.match(open, /Read the ticket and the two comments/);
});

test("collapse also applies to a question and restores its options", () => {
  const activity = { ...thought, type: "elicitation", options: [{ value: "yes", label: "Yes" }] };
  const folded = render({ flagEnabled: true, collapsed: true, activity });
  assert.match(folded, /aria-expanded="false"/);
  assert.doesNotMatch(folded, /Choose a response/);
  const open = render({ flagEnabled: true, collapsed: false, activity });
  assert.match(open, /role="group" aria-label="Agent elicitation"/);
  assert.match(open, /role="button" tabindex="0" aria-label="Agent elicitation" aria-expanded="true"/);
  assert.match(open, /Choose a response/);
  assert.match(open, />Yes<\/button>/);
});

test("a fold from another task does not collapse this task", () => {
  assert.equal(isFoldedRow(render({ flagEnabled: true, collapsed: true, foldTaskId: 16 })), false);
});

test("the folded row is keyboard operable", () => {
  const html = render({ flagEnabled: true, collapsed: true });
  assert.match(html, /tabindex="0"/);
  assert.match(html, /focus-visible:bg-hover-active/);
});


test("elicitation collapse keeps keyboard focus without stealing outside focus", async () => {
  const { JSDOM } = require("jsdom");
  const { createRoot } = require("react-dom/client");
  const dom = new JSDOM('<div id="root"></div><button id="outside">Outside</button>', { url: "https://example.com/" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(global, key, { value, configurable: true, writable: true });
  const fold = { flagEnabled: true, collapsed: false };
  const Row = loadRow(fold);
  const activity = { ...thought, type: "elicitation", options: [{ value: "yes", label: "Yes" }] };
  const root = createRoot(document.getElementById("root"));
  const key = (element) => element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  try {
    await React.act(async () => root.render(React.createElement(Row, { activity, taskId: 15 })));
    let header = document.querySelector('[role="button"][aria-expanded="true"]');
    header.focus();
    await React.act(async () => key(header));
    let collapsed = document.querySelector('[role="button"][aria-expanded="false"]');
    assert.equal(document.activeElement, collapsed);
    await React.act(async () => key(collapsed));
    header = document.querySelector('[role="button"][aria-expanded="true"]');
    assert.ok(header);
    assert.equal(document.activeElement, header);
    await React.act(async () => key(header));
    collapsed = document.querySelector('[role="button"][aria-expanded="false"]');
    assert.ok(collapsed);
    assert.equal(document.activeElement, collapsed);
    document.getElementById("outside").focus();
    fold.collapsed = true;
    fold.version = 2;
    await React.act(async () => root.render(React.createElement(Row, { activity, taskId: 15 })));
    assert.ok(document.querySelector('[role="button"][aria-expanded="false"]'));
    assert.equal(document.activeElement.id, "outside");
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
});

test("the flag is a reversible low-risk improvement for owner and QA", () => {
  const { default: flag } = loadModule("src/lib/flags/definitions/htpr-8262-agent-lane-collapse.ts");
  assert.equal(flag.key, flagKey);
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "small");
  assert.ok(flag.releaseRisk.reason);
  assert.equal(flag.releaseRisk.highRisk, undefined);
});

test("the real thread hook toggles all rows across a refresh", async () => {
  const { JSDOM } = require("jsdom");
  const { createRoot } = require("react-dom/client");
  const { ensureAtLeastOneCommentIsOpen, processComments } = loadModule(
    "src/utils/helperFunctions/TaskDetail/index.ts",
    { "@/models/model": {}, "@/utils/htmlEscape": {}, "@/lib/richText/replyQuote": {} },
  );
  const dom = new JSDOM('<div id="root"></div>', { url: "https://example.com/" });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, fetch: async () => ({}), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(global, key, { value, configurable: true, writable: true });
  }

  const thread = [{ id: 1 }, { id: 2 }, { id: 3, activity: {} }];
  const noop = () => {};
  const signalAtom = {};
  const userAtom = {};
  let context;
  let signal = 0;
  let query = thread;
  let flagEnabled = true;
  let currentUser = null;
  let events = null;
  const useHook = loadModule("src/hooks/Task Detail/CommentAndDescriptionHooks/useCommentAndDescriptions.ts", {
    "@/hooks/useFlag": { useFlag: (key) => key === flagKey && flagEnabled },
    "@/lib/flags/definitions/htpr-8262-agent-lane-collapse": { HTPR_8262_AGENT_LANE_COLLAPSE_FLAG: flagKey },
    "@/lib/flags/keys": { HTPR_7315_UNREAD_TICKET_OPENS_TOP_FLAG: "unread" },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => context },
    "@/utils/helperFunctions/helperFunctions": { emptyDescription: "", returnIfModalOrInputActive: () => false },
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "react-hot-toast": { default: {} },
    "../useGetComments": { useGetAllComments: () => ({ data: query }) },
    "@/lib/constants": { default: {} },
    "@/hooks/realtime/useTaskCommentsRealtime": { useTaskCommentsRealtime: noop },
    "@/lib/realtime/taskDetailRefresh": { shouldPreserveTaskEditorContent: () => true },
    "@/lib/state": {
      useRecoilState: (atom) => [atom === signalAtom ? signal : atom === userAtom ? currentUser : null, noop],
      useRecoilValue: () => false,
    },
    "@/store": { currentUserAtom: userAtom, toggleAllCommentsSignalAtom: signalAtom },
    "@/lib/constants/TaskDetail": {},
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/utils/helperFunctions/TaskDetail": { ensureAtLeastOneCommentIsOpen, processComments },
    "./useDescriptionReactions": { default: () => ({}) },
    "@/utils/api/Task Detail/markTaskSeen": { markTaskSeen: () => events?.push("seen") },
    "@/lib/constants/keyboard-handler": { KeyCodes: {} },
    "@/lib/constants/constants": {},
  }).default;
  const queryClient = { getQueryData: () => ({}) };
  let result;
  function Harness() {
    const [stacked, setStackedState] = React.useState({ 0: false, 1: false, 2: false });
    const setStacked = React.useCallback((update) => {
      if (typeof update === "function") events?.push("stacked");
      setStackedState(update);
    }, []);
    const [agentLaneFold, setAgentLaneFold] = React.useState({ taskId: 15, collapsed: false, version: 0 });
    const [comments, setComments] = React.useState(thread);
    context = {
      parsedTask: '{"id":15}', currentTask: { id: 15 }, currentId: "", _comments: "[]",
      description: "", stacked, setStacked, agentLaneFold, setAgentLaneFold, comments, setComments,
      setAgentRunActivities: noop, setDescription: noop, setNewCommentIds: noop,
      setNewCommentsSnapshotReady: noop, setNewCommentsLastReadAt: noop,
    };
    result = useHook();
    return null;
  }
  const root = createRoot(document.getElementById("root"));
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    const localNote = { id: 5 };
    await React.act(async () => context.setComments((comments) => [...comments, localNote]));
    signal++;
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.deepEqual(result.comments, [...thread, localNote]);
    assert.deepEqual(result.stacked, { 0: true, 1: true, 2: true, 3: true });
    assert.equal(context.agentLaneFold.collapsed, true);
    await React.act(async () => result.updateStackedComments(0));
    query = [...thread, localNote, { id: 4 }];
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.deepEqual(result.stacked, { 0: false, 1: true, 2: true, 3: true, 4: true });
    signal++;
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.deepEqual(result.stacked, { 0: false, 1: false, 2: false, 3: false, 4: false });
    assert.equal(context.agentLaneFold.collapsed, false);

    query = thread;
    flagEnabled = false;
    await React.act(async () => root.render(React.createElement(Harness, { key: "flag-off" })));
    signal++;
    await React.act(async () => root.render(React.createElement(Harness, { key: "flag-off" })));
    signal++;
    await React.act(async () => root.render(React.createElement(Harness, { key: "flag-off" })));
    assert.deepEqual(result.stacked, { 0: true, 1: false, 2: true });
    assert.equal(context.agentLaneFold.collapsed, false);

    currentUser = { id: 1 };
    query = thread.map((comment) => ({ ...comment, creatorId: 1 }));
    await React.act(async () => root.render(React.createElement(Harness, { key: "flag-off" })));
    await React.act(async () => context.setStacked({ 0: true, 1: true, 2: true }));
    events = [];
    query = query.map((comment) => ({ ...comment }));
    await React.act(async () => root.render(React.createElement(Harness, { key: "flag-off" })));
    assert.deepEqual(events, ["stacked", "seen"]);
    assert.deepEqual(result.stacked, { 0: true, 1: false, 2: true });
    events = null;
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
});
