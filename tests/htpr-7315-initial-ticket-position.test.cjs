const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const load = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const { initialTicketPosition } = load(path.join(root, "src/lib/taskDetail/initialTicketPosition.ts"));
const { createTaskDetailInitialScrollGuard } = load(path.join(root, "src/lib/taskDetailInitialScroll.ts"));
const flag = load(path.join(root, "src/lib/flags/definitions/htpr-7315-unread-ticket-opens-top.ts"));
const config = load(path.join(root, "src/lib/configs/taskDetail.config.ts")).default;
const readAt = "2026-10-17T12:00:00.000Z";
const defaults = { hasDeepLink: false, scrollSetting: "Bottom", fromInbox: false, lastReadAt: readAt };

for (const [name, input, expected] of [
  ["never read opens at top", { lastReadAt: null, firstUnreadCommentId: 77 }, "top"],
  ["missing read state opens at top", { lastReadAt: undefined }, "top"],
  ["read without unread opens at bottom", {}, "bottom"],
  ["read with unread opens at first unread", { firstUnreadCommentId: 77 }, "firstUnread"],
  ["deep link wins over never read", { hasDeepLink: true, lastReadAt: null }, "deepLink"],
  ["None setting opens at top", { scrollSetting: "None", firstUnreadCommentId: 77 }, "top"],
  ["non-bottom setting opens at top outside inbox", { scrollSetting: "Top" }, "top"],
  ["inbox Bottom and read opens at bottom", { fromInbox: true }, "bottom"],
  ["inbox None opens at top", { fromInbox: true, scrollSetting: "None" }, "top"],
  ["inbox other setting retains auto-scroll", { fromInbox: true, scrollSetting: "Top" }, "bottom"],
]) {
  test(name, () => assert.equal(initialTicketPosition({ ...defaults, ...input }), expected));
}

test("flag is an Owner + QA improvement with release risk", () => {
  assert.equal(flag.default.key, flag.HTPR_7315_UNREAD_TICKET_OPENS_TOP_FLAG);
  assert.equal(flag.default.kind, "improvement");
  assert.equal(flag.default.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.default.shippedOn, "2026-10-18");
  assert.ok(flag.default.releaseRisk.reason);
});

function scrollHarness({ mobile = false, enabled = true, fromInbox = false, scrollSetting = "Bottom", lastReadAt = readAt, unread = false, deepLink, embedded = false, cachedLayout = false } = {}) {
  const effects = [];
  const layouts = [];
  const timers = new Map();
  const frames = [];
  const movement = [];
  let timerId = 0;
  let clock = 0;
  const target = new EventTarget();
  Object.assign(target, {
    scrollHeight: 6000,
    scrollTo: options => movement.push(["scroll", options]),
    scrollBy: options => movement.push(["offset", options]),
  });
  const params = new URLSearchParams(fromInbox ? "inboxFlow=true" : "");
  if (deepLink && deepLink !== "hash") params.set(config.searchParams[deepLink], deepLink === "commentId" ? "comment-77" : "true");
  const mocks = {
    react: { useEffect: callback => effects.push(callback), useLayoutEffect: callback => layouts.push(callback), useCallback: callback => callback },
    "@/hooks/useFlag": { useFlag: key => key === flag.HTPR_7315_UNREAD_TICKET_OPENS_TOP_FLAG ? enabled : cachedLayout },
    "@/lib/flags/keys": { HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "instant", HTPR_6899_STABLE_LAYOUT_FLAG: "stable" },
    "@/lib/flags/definitions/htpr-7315-unread-ticket-opens-top": flag,
    "@/lib/taskDetail/initialTicketPosition": { initialTicketPosition },
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => ({ cachedLayout, newCommentsLastReadAt: lastReadAt }) },
    "@/lib/configs/taskDetail.config": { __esModule: true, default: config },
    "@/lib/constants/TaskDetail": { descriptionContainerId: "description-container" },
  };
  const source = fs.readFileSync(path.join(root, "src/app/detail/[...slug]/useTaskDetailInitialScroll.tsx"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("require", "exports", "window", "document", "setTimeout", "clearTimeout", "requestAnimationFrame", "performance", js)(
    name => { assert.ok(name in mocks, name); return mocks[name]; }, exports,
    Object.assign(target, { location: { hash: deepLink === "hash" ? "#comment-77" : "" }, history: {}, innerHeight: 900 }),
    { documentElement: target, getElementById: id => ({ click: () => movement.push(["click", id]) }) },
    callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id),
    callback => frames.push(callback), { now: () => clock += 500 },
  );
  const context = {
    _parsedTask: { id: 42 }, _mbl: mobile, scrollSetting, searchParams: params, showCreateTaskModal: { show: false },
    newCommentsSnapshotReady: false, newCommentIds: unread ? [77] : [], comments: [{ id: "77" }], visibleCommentIndices: [0],
    bottomScrollCancelRef: { current: null }, hasBottomScrolledRef: { current: false }, hasScrolledToUnreadRef: { current: false },
    initialScrollGenerationRef: { current: 0 }, initialScrollViewportRef: { current: {} },
    scrollElementRef: embedded ? { current: target } : undefined,
    virtualizeIndexes: { commentsStartVirtualIndex: 3 }, virtualizer: { scrollToIndex: (...args) => movement.push(["index", ...args]) },
    focusOn: (...args) => movement.push(["focus", ...args]), defaultCommentFocus: () => movement.push(["bottom"]),
    scrollVirtualize: (...args) => movement.push(["link", ...args]), setPriority_: () => {}, setEstimate_: () => {},
  };
  context.initialScrollGuard = createTaskDetailInitialScrollGuard(() => context.bottomScrollCancelRef.current?.());
  const render = () => { effects.length = layouts.length = 0; exports.useTaskDetailInitialScroll(context); };
  const flush = () => {
    for (let i = 0; timers.size || frames.length; i++) {
      assert.ok(i < 30, "scroll settling must be bounded");
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach(callback => callback());
      frames.splice(0).forEach(callback => callback());
    }
  };
  render();
  layouts.forEach(callback => callback());
  effects[3]();
  effects[4]();
  return { context, movement, target, flush, ready() { context.newCommentsSnapshotReady = true; render(); return effects[4](); }, repeat() { render(); effects[4](); } };
}

for (const mobile of [false, true]) for (const embedded of [false, true]) {
  test(`snapshot positioning waits and runs once (mobile=${mobile}, embedded=${embedded})`, () => {
    for (const [lastReadAt, unread, position] of [[null, true, "top"], [readAt, false, "bottom"], [readAt, true, "unread"]]) {
      const h = scrollHarness({ mobile, embedded, lastReadAt, unread });
      h.flush();
      assert.deepEqual(h.movement, [], "no default scroll before the snapshot");
      h.ready();
      h.flush();
      if (position === "top") {
        assert.deepEqual(h.movement, [["focus", "description-container", true, "auto", "start"], ["scroll", { top: 0, behavior: "auto" }]]);
      } else if (position === "unread") {
        assert.deepEqual(h.movement, [["focus", "comment-0", false], ["index", 3, { align: "start", behavior: "auto" }], ["offset", { top: -300, behavior: "auto" }]]);
      } else if (mobile) {
        assert.deepEqual(h.movement[0], ["focus", config.elementIds.comment, false, undefined, undefined, true]);
        assert.ok(h.movement.slice(1).every(([kind, options]) => kind === "scroll" && options.top === 6000));
      } else assert.deepEqual(h.movement, [["bottom"]]);
      const before = [...h.movement];
      h.repeat();
      h.flush();
      assert.deepEqual(h.movement, before, "late comments must not reposition an opened ticket");
    }
  });
}

for (const mobile of [false, true]) {
  test(`settings suppress automatic unread and bottom scrolling (mobile=${mobile})`, () => {
    for (const fromInbox of [false, true]) {
      const h = scrollHarness({ mobile, fromInbox, scrollSetting: "None", unread: true });
      h.ready(); h.flush();
      assert.equal(h.movement[0][1], "description-container");
      assert.equal(h.movement[1][1].top, 0);
    }
  });
  test(`read inbox retains bottom positioning (mobile=${mobile})`, () => {
    const h = scrollHarness({ mobile, fromInbox: true });
    h.ready(); h.flush();
    assert.equal(h.movement[0][0], mobile ? "focus" : "bottom");
  });
  test(`explicit links retain priority with flag on and off (mobile=${mobile})`, () => {
    for (const enabled of [false, true]) for (const deepLink of ["hash", "commentId", "reply", "audio"]) {
      const h = scrollHarness({ mobile, enabled, lastReadAt: null, unread: true, deepLink });
      h.ready(); h.flush();
      assert.deepEqual(h.movement, deepLink === "hash" || deepLink === "commentId"
        ? [["link", config.elementIds.comment, 77, undefined, true]]
        : [...(deepLink === "audio" ? [["click", `${config.audioButtons.createComment}-${config.audioButtons.suffix}`]] : []), ["focus", config.elementIds.commentInput]]);
    }
  });
  test(`gestures and navigation cancel pending positioning (mobile=${mobile})`, () => {
    for (const interrupt of [h => h.target.dispatchEvent(new Event("wheel")), h => h.context.initialScrollGuard.reset()]) {
      const h = scrollHarness({ mobile, unread: true });
      h.ready(); interrupt(h); h.flush();
      assert.deepEqual(h.movement, []);
    }
  });
  test(`flag off preserves immediate bottom positioning (mobile=${mobile})`, () => {
    const h = scrollHarness({ mobile, enabled: false, lastReadAt: null });
    h.flush();
    assert.equal(h.movement[0][0], mobile ? "focus" : "bottom");
  });
}

test("cached stable-layout opens remain untouched with the new flag on", () => {
  const h = scrollHarness({ cachedLayout: true, lastReadAt: null, unread: true });
  h.ready(); h.flush();
  assert.deepEqual(h.movement, []);
});

test("top positioning cancels an existing bottom scroll", () => {
  const h = scrollHarness({ lastReadAt: null });
  let cancelled = false;
  h.context.bottomScrollCancelRef.current = () => { cancelled = true; };
  h.ready(); h.flush();
  assert.equal(cancelled, true);
  assert.equal(h.context.bottomScrollCancelRef.current, null);
});

test("mark-on-leave updates object and legacy-array caches only with the flag on, including beacon leave", () => {
  const source = ts.createSourceFile("comments.ts", fs.readFileSync(path.join(root, "src/hooks/Task Detail/CommentAndDescriptionHooks/useCommentAndDescriptions.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  let callback;
  let normalize;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "markTaskReadOnLeave") callback = node.initializer.arguments[0].getText(source);
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "normalizeCommentsQueryPayload") normalize = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const js = ts.transpileModule(`const normalizeCommentsQueryPayload = ${normalize}; return ${callback};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const enabled of [false, true]) for (const beacon of [false, true]) for (const legacy of [false, true]) {
    const comments = [{ id: "77" }];
    const original = legacy ? comments : { comments, lastReadAt: null, agentRunActivities: [], extra: "preserved" };
    let payload = original;
    const requests = [];
    const markRead = new Function("isShareView", "currentUser", "currentTask", "unreadTicketOpensTop", "queryClient", "globalConstants", "EMPTY_AGENT_RUN_ACTIVITIES", "EMPTY_COMMENTS", "navigator", "fetch", js)(
      false, { id: 985 }, { id: 42 }, enabled,
      { setQueryData: (key, update) => { assert.deepEqual(key, ["comments", 42]); payload = update(payload); } },
      { CommentsTQPrefixKey: "comments" }, [], [],
      { sendBeacon: (...args) => { requests.push(args); return true; } },
      (...args) => { requests.push(args); return Promise.resolve(); },
    );
    const before = Date.now();
    markRead(beacon);
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], "/api/tasks/markRead");
    if (enabled) {
      assert.equal(Array.isArray(payload), false);
      assert.equal(payload.comments, comments);
      assert.ok(new Date(payload.lastReadAt).getTime() >= before);
      assert.equal(initialTicketPosition({ ...defaults, lastReadAt: payload.lastReadAt }), "bottom");
      if (!legacy) assert.equal(payload.extra, "preserved");
    } else assert.equal(payload, original);
  }
});
