const { readRefactoredSource } = require("../src/app/detail/[...slug]/taskDetailTestSources.cjs");
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { createJiti } = require("jiti");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { interopDefault: true });
const { createTaskDetailInitialScrollGuard } = jiti(
  path.join(root, "src/lib/taskDetailInitialScroll.ts")
);

function runFlag(guard, generation) {
  let ran = false;
  const allowed = guard.run(generation, () => {
    ran = true;
  });
  return { allowed, ran };
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end).trimEnd();
}

test("an untouched task can run its initial positioning", () => {
  const guard = createTaskDetailInitialScrollGuard(() => {});
  const generation = guard.reset();

  assert.deepEqual(runFlag(guard, generation), { allowed: true, ran: true });
  assert.deepEqual(runFlag(guard, generation), { allowed: true, ran: true });
});

test("a mobile scroll gesture cancels and blocks delayed positioning", () => {
  let cancellations = 0;
  const guard = createTaskDetailInitialScrollGuard(() => {
    cancellations += 1;
  });
  const generation = guard.reset();
  const target = new EventTarget();
  const cleanup = guard.listen(target);

  target.dispatchEvent(new Event("scroll"));
  assert.deepEqual(runFlag(guard, generation), { allowed: true, ran: true });

  target.dispatchEvent(new Event("touchmove"));
  assert.equal(cancellations, 1);
  assert.deepEqual(runFlag(guard, generation), { allowed: false, ran: false });

  target.dispatchEvent(new Event("wheel"));
  assert.equal(cancellations, 1);
  cleanup();
});

test("a gesture during settling blocks the next positioning frame", () => {
  const guard = createTaskDetailInitialScrollGuard(() => {});
  const generation = guard.reset();
  const target = new EventTarget();
  const cleanup = guard.listen(target);

  assert.deepEqual(runFlag(guard, generation), { allowed: true, ran: true });
  target.dispatchEvent(new Event("wheel"));
  assert.deepEqual(runFlag(guard, generation), { allowed: false, ran: false });
  cleanup();
});

test("task changes reject stale callbacks and allow the next untouched task", () => {
  let cancellations = 0;
  const guard = createTaskDetailInitialScrollGuard(() => {
    cancellations += 1;
  });
  const target = new EventTarget();
  const cleanup = guard.listen(target);
  const firstGeneration = guard.reset();
  target.dispatchEvent(new Event("wheel"));
  const secondGeneration = guard.reset();

  assert.equal(cancellations, 1);
  assert.deepEqual(runFlag(guard, firstGeneration), { allowed: false, ran: false });
  assert.equal(guard.invalidate(firstGeneration), false);
  assert.equal(cancellations, 1);
  assert.deepEqual(runFlag(guard, secondGeneration), { allowed: true, ran: true });
  cleanup();
});

test("unmount invalidation rejects pending callbacks", () => {
  let cancellations = 0;
  const guard = createTaskDetailInitialScrollGuard(() => {
    cancellations += 1;
  });
  const generation = guard.reset();

  assert.equal(guard.invalidate(generation), true);
  assert.equal(cancellations, 1);
  assert.deepEqual(runFlag(guard, generation), { allowed: false, ran: false });
  assert.equal(guard.invalidate(generation), false);
  assert.equal(cancellations, 1);
});

test("listener cleanup stops later gestures from changing the guard", () => {
  const guard = createTaskDetailInitialScrollGuard(() => {});
  const generation = guard.reset();
  const target = new EventTarget();
  const cleanup = guard.listen(target);

  cleanup();
  target.dispatchEvent(new Event("touchmove"));
  assert.deepEqual(runFlag(guard, generation), { allowed: true, ran: true });
});

test("task detail wires the guard to task lifecycle and every delayed mobile scroll", () => {
  const source = readRefactoredSource(
    path.join(root, "src/app/detail/[...slug]/TaskDetailComp.tsx"),
    "utf8"
  );
  const bottomPositioning = sourceBetween(
    source,
    "const scrollWindowToBottomMobile = useCallback(",
    "useLayoutEffect(() => {\n    const generation"
  );
  const taskLifecycle = sourceBetween(
    source,
    "useLayoutEffect(() => {\n    const generation",
    "useLayoutEffect(() => {\n    const previousViewport"
  );
  const viewportLifecycle = sourceBetween(
    source,
    "useLayoutEffect(() => {\n    const previousViewport",
    "useEffect(() => {\n    const"
  );
  const mountPositioning = sourceBetween(
    source,
    "useEffect(() => {\n    const",
    "useEffect(stableLayout"
  );
  const unreadPositioning = sourceBetween(
    source,
    "useEffect(stableLayout",
    "  useEffect(() => {\n    if (embedded) return;"
  );
  const unreadDependencyStart = unreadPositioning?.lastIndexOf("}, [") ?? -1;

  assert.match(bottomPositioning, /!initialScrollGuard\.allows\(generation\)/);
  assert.match(
    bottomPositioning,
    /\}, \[initialScrollGuard, scrollElementRef, deferredEditorReady\]\);$/
  );
  assert.match(taskLifecycle, /initialScrollGuard\.reset\(\)/);
  assert.match(taskLifecycle, /initialScrollGuard\.invalidate\(generation\)/);
  assert.match(
    taskLifecycle,
    /\}, \[_parsedTask\.id, initialScrollGuard\]\);$/
  );
  assert.match(
    viewportLifecycle,
    /previousViewport\.taskId === _parsedTask\.id[\s\S]*?previousViewport\.isMobile !== _mbl[\s\S]*?initialScrollGuard\.invalidate/
  );
  assert.match(
    viewportLifecycle,
    /return initialScrollGuard\.listen\(scrollElementRef\?\.current \?\? window\)/
  );
  assert.doesNotMatch(viewportLifecycle, /if \(!_mbl\) return/);
  assert.match(
    viewportLifecycle,
    /\}, \[_mbl, _parsedTask\.id, initialScrollGuard, scrollElementRef\]\);$/
  );
  assert.match(mountPositioning, /runInitialPositioning\(scrollToElement\)/);
  assert.match(mountPositioning, /runInitialPositioning\(\(\) =>\s*focusOn/);
  assert.match(mountPositioning, /useEffect\(\(\) => \{/);
  assert.match(unreadPositioning, /initialScrollGuard\.allows\(generation\)/);
  assert.notEqual(
    unreadDependencyStart,
    -1,
    "the unread effect dependency array must be found"
  );
  const unreadDependencyList = unreadPositioning.slice(unreadDependencyStart);
  assert.match(unreadDependencyList, /_parsedTask\.id/);
  assert.doesNotMatch(unreadDependencyList, /_mbl/);
  assert.match(
    unreadPositioning,
    /requestAnimationFrame\(\(\) => \{\s*runInitialPositioning\(\(\) => \{/
  );
});

const { initialTicketPosition } = jiti(path.join(root, "src/lib/taskDetail/initialTicketPosition.ts"));
const taskDetailConfig = {
  searchParams: { commentId: "commentId", reply: "reply", audio: "audio", inboxFlow: "inboxFlow" },
  delays: { scrollToElement: 500, focusCommentInput: 300, defaultCommentFocus: 400, mobileFocusComment: 500 },
  elementIds: { comment: "comment", commentInput: "comment-input" },
  audioButtons: { suffix: "audio-button", createComment: "create-comment" },
};

function renderOpenedTicket({ deepLink, lastReadAt = null, unread = false, snapshotReady = true } = {}) {
  const effects = [];
  const timers = new Map();
  const frames = [];
  const movement = [];
  const flagKeys = [];
  let timerId = 0;
  let clock = 0;
  const target = Object.assign(new EventTarget(), {
    scrollHeight: 6000,
    scrollTo: (options) => movement.push(["scroll", options]),
    scrollBy: (options) => movement.push(["offset", options]),
    location: { hash: deepLink === "hash" ? "#comment-4" : "" },
    history: {},
    innerHeight: 900,
  });
  const params = new URLSearchParams();
  if (deepLink && deepLink !== "hash") params.set(taskDetailConfig.searchParams[deepLink], deepLink === "commentId" ? "comment-4" : "true");
  const { useTaskDetailInitialScroll } = loadModule("src/app/detail/[...slug]/useTaskDetailInitialScroll.tsx", {
    react: { useEffect: (callback) => effects.push(callback), useLayoutEffect: () => {}, useCallback: (callback) => callback },
    "@/hooks/useFlag": { useFlag: (key) => { flagKeys.push(key); return false; } },
    "@/lib/flags/keys": { HTPR_6899_STABLE_LAYOUT_FLAG: "stable", HTPR_7395_CACHED_STATIC_FIRST_FLAG: "static" },
    "@/lib/taskDetail/initialTicketPosition": { initialTicketPosition },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ cachedLayout: false, newCommentsLastReadAt: lastReadAt, descriptionStart: "live", liveRowsPendingFor: () => false }) },
    "@/lib/configs/taskDetail.config": { default: taskDetailConfig },
    "@/lib/constants/TaskDetail": { descriptionContainerId: "description-container" },
    "@/lib/snippets": { getTiptapEditorForMode: () => null },
  });
  const previous = {
    window: global.window,
    document: global.document,
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    requestAnimationFrame: global.requestAnimationFrame,
    performance: global.performance,
  };
  global.window = target;
  global.document = { documentElement: target, getElementById: (id) => ({ click: () => movement.push(["click", id]) }) };
  global.setTimeout = (callback) => { timers.set(++timerId, callback); return timerId; };
  global.clearTimeout = (id) => { timers.delete(id); };
  global.requestAnimationFrame = (callback) => { frames.push(callback); };
  global.performance = { now: () => (clock += 500) };
  try {
    const guard = createTaskDetailInitialScrollGuard(() => {});
    useTaskDetailInitialScroll({
      _parsedTask: { id: 42 }, _mbl: false, scrollSetting: "Bottom", searchParams: params, showCreateTaskModal: { show: false },
      newCommentsSnapshotReady: snapshotReady, newCommentIds: unread ? [77] : [], comments: [{ id: "77" }], visibleCommentIndices: [0],
      bottomScrollCancelRef: { current: null }, hasBottomScrolledRef: { current: false }, hasScrolledToUnreadRef: { current: false },
      initialScrollGenerationRef: { current: guard.reset() }, initialScrollViewportRef: { current: {} }, scrollElementRef: undefined,
      virtualizeIndexes: { commentsStartVirtualIndex: 3 }, virtualizer: { scrollToIndex: (...args) => movement.push(["index", ...args]) },
      focusOn: (...args) => movement.push(["focus", ...args]), defaultCommentFocus: () => movement.push(["bottom"]),
      scrollVirtualize: (...args) => movement.push(["link", ...args]), setPriority_: () => {}, setEstimate_: () => {},
      priorityForTaskTQ: null, estimateForTaskTQ: null, initialScrollGuard: guard,
    });
    assert.equal(effects.length, 5);
    effects[3]();
    effects[4]();
    for (let i = 0; timers.size || frames.length; i++) {
      assert.ok(i < 30, "scroll settling must be bounded");
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
      frames.splice(0).forEach((callback) => callback());
    }
    return { movement, flagKeys };
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete global[key];
      else global[key] = previous[key];
    }
  }
}

test("opening a ticket keeps the live unread position and ignores the removed switch", () => {
  const waiting = renderOpenedTicket({ lastReadAt: null, snapshotReady: false });
  assert.deepEqual(waiting.flagKeys, ["stable", "static"]);
  assert.deepEqual(waiting.movement, []);

  const neverRead = renderOpenedTicket({ lastReadAt: null });
  assert.deepEqual(neverRead.movement, [
    ["focus", "description-container", true, "auto", "start"],
    ["scroll", { top: 0, behavior: "auto" }],
  ]);

  const audio = renderOpenedTicket({ deepLink: "audio", lastReadAt: null });
  assert.deepEqual(audio.movement, [
    ["click", `${taskDetailConfig.audioButtons.createComment}-${taskDetailConfig.audioButtons.suffix}`],
    ["focus", taskDetailConfig.elementIds.commentInput],
  ]);
});

test("the task detail virtualizer leaves row-resize scroll compensation to the browser (HTPR-6277)", () => {
  const source = readRefactoredSource(
    path.join(root, "src/hooks/Task Detail/useTaskDetailGlobalStates.ts"),
    "utf8"
  );
  const optionsStart = source.indexOf("const virtualizerOptions = {");
  assert.notEqual(optionsStart, -1, "virtualizer options block must exist");
  const options = sourceBetween(source, "const virtualizerOptions = {", "};");

  assert.match(
    options,
    /shouldAdjustScrollPositionOnItemSizeChange:\s*\(\)\s*=>\s*false/,
    "tanstack's JS scroll correction must stay off; native scroll anchoring owns re-measure compensation, otherwise opening a modal (Share task) re-scrolls the window and the task detail jumps"
  );
});

test("task detail isolates HypertasksCommands in Suspense so Share cannot remount the page (HTPR-6277)", () => {
  const source = readRefactoredSource(
    path.join(root, "src/app/detail/[...slug]/TaskDetailComp.tsx"),
    "utf8"
  );
  const commandsMount = sourceBetween(
    source,
    "{!embedded && showCommands.show && (",
    "{showShortucts && <KeyboardShortcuts />}"
  );

  assert.match(
    source,
    /import\s*\{[^}]*\bSuspense\b[^}]*\}\s*from\s*"react"/,
    "Suspense must be imported so command-modal chunk loads stay local"
  );
  assert.match(
    commandsMount,
    /<Suspense\s+fallback=\{null\}>\s*<HypertasksCommands[\s\S]*?<\/Suspense>/,
    "HypertasksCommands must sit in a null-fallback Suspense; otherwise ShareTaskModal's dynamic() import bubbles into page.tsx Suspense, the task detail falls back to Loading..., and scroll jumps to the top"
  );
});
