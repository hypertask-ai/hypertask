const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const task = { id: 42, projectId: 15, uniqueIndex: 43, description_: { content: "Cached body" } };

function compile(source, mocks) {
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", js)((name) => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("creator hydration enables description quoting without changing the frozen editor seed; flag off keeps the seed creator", () => {
  let currentTask = task;
  let seed = task;
  let flagEnabled = true;
  const noop = () => null;
  const Editor = noop;
  const HighlightMenu = () => null;
  const QuoteButton = () => null;
  const Body = compile(read("src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptonBody.tsx"), {
    react: { useContext: () => false, useMemo: (fn) => fn(), useCallback: (fn) => fn },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/components/Common/AttachmentsView": { __esModule: true, default: noop },
    "@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent": { __esModule: true, default: () => ({ redirectAPI: noop }) },
    "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => ({ description: "Local draft", descriptionAttachments: [], setDescriptionAttachments: noop }) },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ currentTask, parsedTask: JSON.stringify(seed), secondaryPanelsReady: true }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: {} },
    "@/hooks/General/useHasDrafts": { isMeaningfulDescriptionDraft: () => false },
    "@/hooks/useFlag": { useFlag: () => flagEnabled },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "htpr-6752-instant-ticket-open" },
    "../ContextMenu": { HighlightMenu },
    "../ContextMenu/QuoteButton": { __esModule: true, default: QuoteButton },
    "@/components/RTE/TipTapTaskDetail": { __esModule: true, default: Editor },
    "../BackgroundTaskAttachments": { __esModule: true, default: noop },
    "@/utils/helperFunctions/linkifyHtml": { linkifyHtml: (content) => content },
    "./InnerHtmlDescription": { __esModule: true, default: noop },
  }).default;
  const children = () => Body({ draftTQ: [] }).props.children;
  assert.equal(children().find((child) => child?.type === HighlightMenu), undefined);
  const user = { id: 6, displayName: "Creator" };
  currentTask = { ...task, user };
  const hydrated = children();
  const editor = hydrated.find((child) => child?.type === Editor);
  assert.equal(editor.props.user, user);
  assert.equal(editor.props.creatorname, "Creator");
  assert.equal(editor.key, String(task.id), "metadata hydration must not remount the editor");
  assert.equal(editor.props.defaultContent, "Local draft");
  const quote = hydrated.find((child) => child?.type === HighlightMenu).props.menu({ selectedHtml: "Selected text" });
  assert.equal(quote.type, QuoteButton);
  assert.equal(quote.props.creator, user);
  assert.equal(quote.props.selection, "Selected text");
  assert.equal(seed.user, undefined, "the initialization seed remains unchanged");
  flagEnabled = false;
  assert.equal(children().find((child) => child?.type === HighlightMenu), undefined);
  seed = { ...task, user: { id: 99, displayName: "Production seed" } };
  assert.equal(children().find((child) => child?.type === Editor).props.user.id, 99);
});

test("cached network and HTTP refresh failures recover through the authorized route, while embedded behavior is unchanged", () => {
  const source = read("src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx");
  for (const embedded of [false, true]) {
    for (const error of [new TypeError("Failed to fetch"), new Error("Unable to load task")]) {
      const effects = [];
      const replacements = [];
      const previous = global.window;
      const href = "https://app.hypertask.ai/detail/project-15/43?reply=true#comment-12";
      global.window = { location: { href, replace: (url) => replacements.push(url) } };
      try {
        const Detail = compile(source, {
          react: { useRef: () => ({ current: undefined }), useEffect: (effect) => effects.push(effect) },
          "react/jsx-runtime": require("react/jsx-runtime"),
          "@tanstack/react-query": { useQueryClient: () => ({}), useQuery: ({ queryKey }) => queryKey[0] === "comments" ? {} : { data: task, error, isError: true } },
          "@/app/unauthorized/page": { __esModule: true, default: () => null },
          "@/lib/navigation/cachedTaskDetail": { cachedTaskDetailKey: () => ["cached-task-detail"], TaskAccessDeniedError: class extends Error {} },
          "@/lib/contexts/TaskDetail/TaskProvider": { TasksProvider: () => null, useTaskContext: () => ({}) },
          "@/lib/realtime/taskDetailRefresh": {},
          "@/app/detail/[...slug]/TaskDetailComp": { __esModule: true, default: () => null },
          "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
          "@/lib/constants": { __esModule: true, default: { CommentsTQPrefixKey: "comments" } },
          "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: ({ children }) => children },
          "@/lib/state": { useRecoilValue: () => ({ id: 6 }) },
          "@/store": { currentUserAtom: {} },
          "@/utils/api/Task Detail": {},
        }).default;
        Detail({ taskId: 42, projectId: 15, uniqueIndex: 43, initialTask: task, embedded });
        effects.forEach((effect) => effect());
        assert.deepEqual(replacements, embedded ? [] : [href], "cached failures must not silently leave incomplete metadata forever");
      } finally {
        global.window = previous;
      }
    }
  }
});

const inboxSource = ts.createSourceFile("inbox.tsx", read("src/components/notifications/inboxSplit/index.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = [];
let clickCapture;
function visit(node) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => ["openTaskWithCachedData", "openTask"].includes(item.name.getText(inboxSource)))) declarations.push(node.getText(inboxSource));
  if (ts.isJsxAttribute(node) && node.name.getText(inboxSource) === "onClickCapture") clickCapture = node.initializer.expression.getText(inboxSource);
  ts.forEachChild(node, visit);
}
visit(inboxSource);
assert.equal(declarations.length, 2);
assert.ok(clickCapture);

test("explicit inbox mouse rows use cached navigation with their own task; flag off retains production URLs and side effects", async () => {
  const notification = { id: "7", type: "Mentioned", projectId: 15, task, commentId: 12 };
  const js = ts.transpileModule(`${declarations.join("\n")}\nreturn openTask;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const instantTicketOpen of [false, true]) {
    const pushes = [];
    const navigations = [];
    const seen = [];
    const playlists = [];
    const open = new Function("instantTicketOpen", "selectedKeyboardRow", "disableNotificationSideEffects", "disableInboxFlow", "markSeenOnOpen", "buildUniqueTasksPlaylist", "_notifications", "setTasksPlayList", "buildQueryParams", "commentIdHash", "inboxConfig", "router", "markTaskDetailNavigationStart", "navigateToTask", js)(
      instantTicketOpen, { item: { kind: "notification", notification: { ...notification, task: { ...task, id: 99 } } } }, false, false,
      (row) => seen.push(row), () => [task], [notification], (list) => playlists.push(list), () => "?inboxFlow=true", (id) => `#comment-${id}`,
      { urls: { taskDetail: (projectId, index, hash) => `/detail/project-${projectId}/${index}${hash}` } }, { push: (url) => pushes.push(url) }, () => {}, (...args) => navigations.push(args),
    );
    await open("view", notification);
    assert.deepEqual(seen, [notification]);
    assert.deepEqual(playlists, [[task]]);
    assert.deepEqual(pushes, instantTicketOpen ? [] : ["/detail/project-15/43#comment-12?inboxFlow=true"]);
    assert.deepEqual(navigations, instantTicketOpen ? [[15, 43, "push", "#comment-12?inboxFlow=true", task]] : []);
  }
});

test("inbox Link clicks open once, preserve modified browser clicks and row controls, and leave flag-off and invitations untouched", () => {
  const js = ts.transpileModule(`export function handler(instantTicketOpen, notification, openTask, globalIndex) { return ${clickCapture}; }`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const handler = compile(js, {}).handler;
  const notification = { type: "Mentioned", task };
  const opens = [];
  const onClick = handler(true, notification, (...args) => opens.push(args), 3);
  const anchor = {};
  for (const modifier of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    let prevented = false;
    let stopped = false;
    onClick({ button: 0, ...modifier, target: { closest: () => anchor }, currentTarget: anchor, preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
    assert.equal(prevented, Object.keys(modifier).length === 0);
    assert.equal(stopped, true, "the nested row must not issue another navigation, including modified clicks");
  }
  assert.deepEqual(opens, [["view", notification, 3]]);
  onClick({ target: { closest: () => ({ tagName: "BUTTON" }) }, currentTarget: anchor, preventDefault: () => assert.fail("row controls own their click"), stopPropagation: () => assert.fail("row controls must receive their click") });
  assert.equal(opens.length, 1);
  assert.equal(handler(false, notification, () => assert.fail(), 3), undefined);
  assert.equal(handler(true, { type: "Invited" }, () => assert.fail(), 3), undefined);
});
