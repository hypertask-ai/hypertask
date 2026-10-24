const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const FLAG = "htpr-7724-blocker-comment";

test("blocker comment has an independent Everyone-default feature flag", () => {
  const { default: definition, HTPR_7724_BLOCKER_COMMENT_FLAG } = load("src/lib/flags/definitions/htpr-7724-blocker-comment.ts", {});
  assert.equal(HTPR_7724_BLOCKER_COMMENT_FLAG, FLAG);
  assert.equal(definition.key, FLAG);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.ok(definition.releaseRisk.reason);
});

function fixture({ enabled = true, failed = false, activity = false } = {}) {
  const posts = [], cache = [], invalidations = [], errors = [];
  const context = {
    currentId: "comment-0",
    currentTask: { id: 42, projectId: 15, sectionId: 3, blockerCommentId: null, waitingOnUserId: 8 },
    currentUser: { id: 7 },
    comments: [{ id: "101", activity: activity ? { type: "TaskMoved" } : null }],
    getCurrentCommentIndex: () => 0,
    setCurrentTask: (update) => { context.currentTask = update(context.currentTask); },
    updateTaskInCache: (...args) => cache.push(args),
    queryClient: { invalidateQueries: async (query) => invalidations.push(query) },
  };
  const { useTaskDetailCommentActions } = load("src/app/detail/[...slug]/useTaskDetailCommentActions.tsx", {
    react: { useCallback: (fn) => fn },
    axios: { default: { post: async (url, body) => {
      posts.push({ url, body });
      if (failed) throw new Error("Write failed");
      return { data: { id: 42, blockerCommentId: body.blockerCommentId, waitingOnUserId: 8 } };
    } } },
    "react-hot-toast": { default: { error: (message) => errors.push(message) } },
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, FLAG); return enabled; } },
    "@/lib/taskDetailReads": { refreshTaskDetailReadAfterWrite: (...args) => cache.push(args) },
    "@/lib/configs/taskDetail.config": { default: {} },
    "@/lib/constants": { default: {} },
    "@/utils/helperFunctions/hasFigmaEmbed": { hasFigmaEmbed: () => false },
  });
  return { context, posts, cache, invalidations, errors, actions: useTaskDetailCommentActions(() => context) };
}

test("existing comment action marks and unmarks the reason without changing the blocking person and refreshes caches", async () => {
  const f = fixture();
  await f.actions.handleBlockerCommentFromHTC();
  assert.deepEqual(f.posts[0], { url: "/api/tasks/waiting-on", body: { taskId: 42, blockerCommentId: 101 } });
  assert.equal(f.context.currentTask.blockerCommentId, 101);
  assert.equal(f.context.currentTask.waitingOnUserId, 8);
  assert.equal(f.cache.length, 2);
  assert.deepEqual(f.invalidations, [{ queryKey: ["task-", 42] }]);
  await f.actions.handleBlockerCommentFromHTC();
  assert.deepEqual(f.posts[1].body, { taskId: 42, blockerCommentId: null });
  assert.equal(f.context.currentTask.blockerCommentId, null);
  assert.deepEqual(f.errors, []);
});

for (const options of [{ enabled: false }, { activity: true }]) {
  test(`comment action refuses an unavailable marker: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    await f.actions.handleBlockerCommentFromHTC();
    assert.deepEqual(f.posts, []);
    assert.deepEqual(f.cache, []);
  });
}

test("failed comment writes leave the previous marker and caches unchanged", async () => {
  const f = fixture({ failed: true });
  await f.actions.handleBlockerCommentFromHTC();
  assert.equal(f.context.currentTask.blockerCommentId, null);
  assert.deepEqual(f.cache, []);
  assert.deepEqual(f.invalidations, []);
  assert.deepEqual(f.errors, ["Unable to update blocker comment"]);
});

function renderComment({ mobile, enabled, blockerCommentId }) {
  const fs = require("node:fs");
  const path = require("node:path");
  const ts = require("typescript");
  const noop = () => {};
  const filename = path.join(__dirname, "../src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentsContainer.tsx");
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const mocks = {
    react: { Suspense: "suspense", useContext: () => mobile, useMemo: (fn) => fn(), useRef: (current) => ({ current }) },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/lib/contexts/CommentsContext": { useCommentsContext: () => ({ comment: { id: "101", creatorId: 7 }, i: 0, isStacked: false, pinned: true }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: {} },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ currentTask: { blockerCommentId }, newCommentIds: [], currentId: "comment-0", setCurrentId: noop }) },
    "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => ({ updateStackedComments: noop }) },
    "@/lib/state": { useRecoilValue: () => ({}), useRecoilState: () => [{ id: 7 }, noop] },
    "@/store": {},
    "@/hooks/useFlag": { useFlag: (key) => key === FLAG ? enabled : false },
    "@/lib/flags/keys": {},
    "@/lib/flags/definitions/htpr-7724-blocker-comment": { HTPR_7724_BLOCKER_COMMENT_FLAG: FLAG },
    "@/models/enums": {},
    "@/hooks/MultiPages/useDoubleTap": { useDoubleTap: () => ({}) },
    "@/lib/constants/TaskDetail": {},
    "@/lib/taskDetailEditTarget": {},
    "@/lib/htc/isCommentCreatedByUser": { isCommentCreatedByUser: () => true },
    "@/styles/tiptap.module.scss": {},
    "@/components/Common/AttachmentsView": "attachments",
    "next/dynamic": () => "reactions",
    "lucide-react": { Reply: "reply" },
    "./CommentOptions": { CommentOptions: "options" },
  };
  const exports = {};
  new Function("require", "exports", source)((name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    assert.ok(["./CommentBodyDesktop", "./CommentCreatedBy", "./CommentText", "./CommentTaskActivity", "./CommentOptions/ReplyToComment", "./SwipeableCommentRow", "./CommentReactions"].includes(name), `Unexpected dependency: ${name}`);
    return name;
  }, exports);
  return exports.default();
}

function commentBoxes(element) {
  if (!element || typeof element !== "object") return [];
  return [
    ...(element.props?.["data-task-comment-box"] ? [element] : []),
    ...require("react").Children.toArray(element.props?.children).flatMap(commentBoxes),
  ];
}

for (const mobile of [false, true]) {
  test(`real comment markup gates the blocker frame without removing the existing pin: mobile=${mobile}`, () => {
    for (const [enabled, blockerCommentId, expected] of [[true, 101, true], [false, 101, undefined], [true, 102, undefined], [true, null, undefined]]) {
      const boxes = commentBoxes(renderComment({ mobile, enabled, blockerCommentId }));
      assert.equal(boxes.length, 1);
      assert.equal(boxes[0].props["data-task-comment-blocker"], expected);
    }
  });
}

for (const enabled of [false, true]) {
  test(`ticket command dispatch honors the blocker flag without disabling Pin: enabled=${enabled}`, () => {
    const blockerCalls = [], pinCalls = [];
    const { useTaskDetailCommandActions } = load("src/app/detail/[...slug]/useTaskDetailCommandActions.tsx", {
      react: { useCallback: (fn) => fn },
      axios: { default: {} },
      "react-hot-toast": { default: {} },
      "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, FLAG); return enabled; } },
      "@/lib/configs/taskDetail.config": { default: { commandModes: { starComment: "StarComment" } } },
      "@/lib/constants/TaskDetail": {},
      "@/lib/constants/constants": {},
      "@/utils/helperFunctions/TaskDetail": {},
    });
    const actions = useTaskDetailCommandActions(() => ({
      handleBlockerCommentFromHTC: () => { blockerCalls.push(true); },
      handleStarCommentFromHTC: (type) => pinCalls.push(type),
    }));
    actions.callback(undefined, "BlockerComment");
    assert.equal(blockerCalls.length, enabled ? 1 : 0);
    actions.callback("Public", "StarComment");
    assert.deepEqual(pinCalls, ["Public"]);
  });
}
