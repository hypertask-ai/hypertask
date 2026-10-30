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
    if (name === "@/lib/taskDetailReads" && !(name in mocks)) return require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true })(path.join(root, "src/lib/taskDetailReads.ts"));
    if (name === "@/hooks/useFlag" && name in mocks) return { ...mocks[name], useFlagReady: () => true, useFlag: key => key === "htpr-7009-dedupe-task-detail-reads" ? false : mocks[name].useFlag(key) };
    if (name === "@/lib/flags/keys") return { ...mocks[name], HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG: "htpr-7009-dedupe-task-detail-reads" };
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const { inboxConfig } = compile(read("src/lib/configs/inbox.config.ts"), {});
const { withDecisionCommentAnchor } = compile(read("src/lib/inboxDecisions.ts"), {
  "@/lib/configs/inbox.config": { inboxConfig },
});

test("creator hydration enables description quoting without changing the frozen editor seed", () => {
  let currentTask = task;
  let seed = task;
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
    "@/lib/flags/keys": require("./helpers/flag-files.cjs").load("src/lib/flags/keys.ts"),
    "@/hooks/useFlag": { useFlag: () => true },

    "../ContextMenu": { HighlightMenu },
    "../ContextMenu/QuoteButton": { __esModule: true, default: QuoteButton },
    "@/components/RTE/TipTapTaskDetail": { __esModule: true, default: Editor },
    "./DescriptionEditorSlot": { __esModule: true, default: Editor },
    "./staticDescriptionHtml": { isPlainDescriptionHtml: () => false },
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
  seed = { ...task, user: { id: 99, displayName: "Production seed" } };
  assert.equal(children().find((child) => child?.type === Editor).props.user.id, 6, "a changed initialization seed must not replace the hydrated creator");
});

test("cached network and HTTP refresh failures retry in place, while embedded behavior is unchanged", () => {
  const source = read("src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx");
  for (const embedded of [false, true]) {
    for (const error of [new TypeError("Failed to fetch"), new Error("Unable to load task")]) {
      const effects = [];
      const replacements = [];
      const timers = new Map();
      const retries = [];
      const cancellations = [];
      const previous = global.window;
      const href = "https://app.hypertask.ai/detail/project-15/43?reply=true#comment-12";
      global.window = {
        location: { href, replace: (url) => replacements.push(url) },
        setTimeout: (callback, delay) => { timers.set(1, { callback, delay }); return 1; },
        clearTimeout: id => { cancellations.push(id); timers.delete(id); },
      };
      try {
        const Detail = compile(source, {
          react: { useRef: (initial) => ({ current: initial }), useEffect: (effect) => effects.push(effect) },
          "react/jsx-runtime": require("react/jsx-runtime"),
          "@tanstack/react-query": { useQueryClient: () => ({}), useQuery: ({ queryKey }) => queryKey[0] === "comments" ? {} : { data: task, error, isError: true, refetch: () => retries.push(task.id) } },
          "@/app/unauthorized/page": { __esModule: true, default: () => null },
          "@/lib/navigation/cachedTaskDetail": { cachedTaskDetailKey: () => ["cached-task-detail"], TaskAccessDeniedError: class extends Error {} },
          "@/lib/contexts/TaskDetail/TaskProvider": { TasksProvider: () => null, useTaskContext: () => ({}) },
          "@/lib/realtime/taskDetailRefresh": { shouldPreserveTaskEditorContent: () => false },
          "@/app/detail/[...slug]/TaskDetailComp": { __esModule: true, default: () => null },
          "@/hooks/General/useGetUserPreferences": { useGetUserPreferences: () => ({ data: {} }) },
          "@/hooks/useFlag": { useFlag: () => true },
          "@/lib/flags/keys": { HTPR_6899_STABLE_LAYOUT_FLAG: "htpr-6899-stable-layout" },
          "@/lib/constants": { __esModule: true, default: { CommentsTQPrefixKey: "comments" } },
          "@/lib/contexts/TaskDetail/FollowersProvider": { FollowersProvider: ({ children }) => children },
          "@/lib/state": { useRecoilValue: () => ({ id: 6 }) },
          "@/store": { currentUserAtom: {} },
          "@/utils/api/Task Detail": {},
        }).default;
        const result = Detail({ taskId: 42, projectId: 15, uniqueIndex: 43, initialTask: task, embedded });
        if (!embedded) {
          const refresh = result.props.children;
          assert.equal(refresh.type(refresh.props), refresh.props.children, "cached content stays visible during recovery");
        } else {
          assert.equal(result.props.children, "Unable to load this task");
        }
        const cleanups = effects.map((effect) => effect()).filter(Boolean);
        assert.deepEqual(replacements, [], "transient failures must not reload the cached detail");
        assert.equal(timers.size, embedded ? 0 : 1);
        assert.deepEqual(retries, [], "refetch waits for the backoff timer");
        if (!embedded) {
          const timer = timers.get(1);
          assert.equal(timer.delay, 1000);
          timer.callback();
          assert.deepEqual(retries, [task.id], "the scheduled retry refetches the cached task once");
        }
        cleanups.forEach(cleanup => cleanup());
        assert.equal(timers.size, 0);
        assert.deepEqual(cancellations, embedded ? [] : [1]);
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
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(inboxSource) === "openTask")) declarations.push(node.getText(inboxSource));
  if (ts.isJsxAttribute(node) && node.name.getText(inboxSource) === "onClickCapture") clickCapture = node.initializer.expression.getText(inboxSource);
  ts.forEachChild(node, visit);
}
visit(inboxSource);
assert.equal(declarations.length, 1);
assert.ok(clickCapture);

test("explicit inbox mouse rows use cached navigation with their own task and retain side effects", async () => {
  const notification = { id: "7", type: "Mentioned", projectId: 15, task, commentId: 12, decisionCommentId: 30 };
  const js = ts.transpileModule(`${declarations.join("\n")}\nreturn openTask;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  {
    const pushes = [];
    const navigations = [];
    const seen = [];
    const playlists = [];
    const open = new Function("decisionCommentLinks", "withDecisionCommentAnchor", "selectedKeyboardRow", "disableNotificationSideEffects", "disableInboxFlow", "markSeenOnOpen", "buildUniqueTasksPlaylist", "_notifications", "setTasksPlayList", "buildQueryParams", "commentIdHash", "inboxConfig", "router", "markTaskDetailNavigationStart", "navigateToTask", js)(
      false, withDecisionCommentAnchor, { item: { kind: "notification", notification: { ...notification, task: { ...task, id: 99 } } } }, false, false,
      (row) => seen.push(row), () => [task], [notification], (list) => playlists.push(list), () => "", (id) => `#comment-${id}`,
      inboxConfig, { push: (url) => pushes.push(url) }, () => {}, (...args) => navigations.push(args),
    );
    await open("view", notification);
    assert.deepEqual(seen, [notification]);
    assert.deepEqual(playlists, [[task]]);
    assert.deepEqual(pushes, []);
    assert.deepEqual(navigations, [[15, 43, "push", "?inboxFlow=true#comment-12", task]]);
  }
});

test("Decisions mouse rows anchor the decision comment with cached navigation", async () => {
  const notification = { id: "7", type: "Mentioned", projectId: 15, task, commentId: 12, decisionCommentId: 30 };
  const js = ts.transpileModule(`${declarations.join("\n")}\nreturn openTask;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  {
    const pushes = [];
    const navigations = [];
    const open = new Function("decisionCommentLinks", "withDecisionCommentAnchor", "selectedKeyboardRow", "disableNotificationSideEffects", "disableInboxFlow", "markSeenOnOpen", "buildUniqueTasksPlaylist", "_notifications", "setTasksPlayList", "buildQueryParams", "commentIdHash", "inboxConfig", "router", "markTaskDetailNavigationStart", "navigateToTask", js)(
      true, withDecisionCommentAnchor, null, true, false,
      () => {}, () => [task], [notification], () => {}, () => "", inboxConfig.urls.commentHash,
      inboxConfig, { push: (url) => pushes.push(url) }, () => {}, (...args) => navigations.push(args),
    );
    await open("view", notification);
    assert.deepEqual(pushes, []);
    assert.deepEqual(navigations, [[15, 43, "push", "?inboxFlow=true#comment-30", task]]);
  }
});

test("inbox Link clicks open once, preserve modified browser clicks and row controls, and leave invitations untouched", () => {
  const js = ts.transpileModule(`export function handler(notification, openTask, globalIndex) { return ${clickCapture}; }`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const handler = compile(js, {}).handler;
  const notification = { type: "Mentioned", task };
  const opens = [];
  const onClick = handler(notification, (...args) => opens.push(args), 3);
  const anchor = { contains: () => true };
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
  assert.equal(handler({ type: "Invited" }, () => assert.fail(), 3), undefined);
});
