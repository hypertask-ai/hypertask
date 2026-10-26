const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const FLAG = "htpr-7311-decision-comment-link";
const inboxFile = "src/components/notifications/inboxSplit/index.tsx";
const navigationFile = "src/hooks/Task Detail/useArchiveAndNavigate.ts";
const compilerOptions = { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 };

function loadTsModule(file, stubs = {}) {
  const filename = path.join(root, file);
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.require = (request) => {
    if (Object.hasOwn(stubs, request)) return stubs[request];
    if (request.startsWith("@/")) return loadTsModule(`src/${request.slice(2)}.ts`, stubs);
    return require(request);
  };
  loaded._compile(ts.transpileModule(read(file), { compilerOptions }).outputText, filename);
  return loaded.exports;
}

const { pickDecisionComments, withDecisionCommentAnchor } = loadTsModule("src/lib/inboxDecisions.ts");
const { inboxConfig, decisionsSplitName } = loadTsModule("src/lib/configs/inbox.config.ts");
const { buildInboxTasksPlaylist } = require("./task-route-loader.cjs").load("src/lib/inbox/inboxTasksPlaylist.ts", {});
const archiveNavigation = loadTsModule("src/lib/taskDetailArchiveNavigation.ts");
const at = (hour) => new Date(`2026-10-21T${String(hour).padStart(2, "0")}:00:00Z`);
const question = (commentId, hour, taskId = 1) => ({ taskId, commentId, text: "<p><strong>Question:</strong> proceed?</p>", commentText: null, createdAt: at(hour) });

function sourceTree(file) {
  return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function findNode(tree, predicate) {
  if (predicate(tree)) return tree;
  return ts.forEachChild(tree, (node) => findNode(node, predicate));
}

function expression(file, name) {
  const tree = sourceTree(file);
  const node = findNode(tree, (node) => ts.isVariableDeclaration(node) && node.name.getText(tree) === name);
  assert.ok(node?.initializer, `${name} exists in ${file}`);
  const initializer = node.initializer;
  return (ts.isCallExpression(initializer) && initializer.expression.getText(tree) === "useCallback"
    ? initializer.arguments[0] : initializer).getText(tree);
}

function evaluate(source, environment) {
  const javascript = ts.transpileModule(`module.exports = (${source});`, { compilerOptions }).outputText;
  const loaded = { exports: {} };
  new Function("module", ...Object.keys(environment), javascript)(loaded, ...Object.values(environment));
  return loaded.exports;
}

test("latest unanswered Question mentioning the viewer wins regardless of query order", () => {
  const latest = question(30, 15);
  const mentions = [latest, question(10, 10), question(20, 12), { ...question(99, 18), text: "<p>FYI, a question: later</p>" }];
  assert.equal(pickDecisionComments(mentions, []).get(1).commentId, 30);
  assert.equal(pickDecisionComments([...mentions].reverse(), []).get(1).commentId, 30);
  assert.equal(pickDecisionComments([question(31, 15), latest], []).get(1).commentId, 31);
});

test("answered questions and ordinary mentions are not chosen; a newer question reopens the decision", () => {
  const answered = [{ taskId: 1, createdAt: at(13) }];
  assert.equal(pickDecisionComments([question(10, 10)], answered).size, 0);
  assert.equal(pickDecisionComments([{ ...question(20, 14), text: "<p>Just mentioning you</p>" }], []).size, 0);
  assert.equal(pickDecisionComments([question(10, 10), question(30, 15)], answered).get(1).commentId, 30);
  assert.equal(pickDecisionComments([question(30, 15)], [{ taskId: 2, createdAt: at(18) }]).get(1).commentId, 30);
});

test("server scopes mentions to any viewer, ignores agent replies, and uses only two batched queries", async () => {
  const viewer = 42;
  const calls = [];
  const mentions = [question(30, 15), question(10, 10), question(40, 15, 2), question(50, 16, 3)];
  const notifications = [
    ...mentions.map(({ taskId, commentId, ...comment }) => ({ userId: viewer, type: "Mentioned", taskId, commentId, comment })),
    { userId: viewer + 1, type: "Mentioned", taskId: 4, commentId: 60, comment: question(60, 18, 4) },
    { userId: viewer, type: "Comment", taskId: 5, commentId: 70, comment: question(70, 18, 5) },
  ];
  const replies = [
    { taskId: 1, creatorId: viewer, agentId: "agent", createdAt: at(18), activity: null },
    { taskId: 1, creatorId: viewer, agentId: null, createdAt: at(18), activity: {} },
    { taskId: 2, creatorId: viewer, agentId: null, createdAt: at(18), activity: null },
  ];
  const db = {
    notification: { findMany: async (args) => {
      calls.push("mentions");
      assert.equal(args.where.userId, viewer);
      assert.equal(args.where.type, "Mentioned");
      assert.equal(args.select.commentId, true);
      return notifications.filter((row) => row.userId === args.where.userId && row.type === args.where.type);
    } },
    comment: { findMany: async (args) => {
      calls.push("replies");
      assert.equal(args.where.creatorId, viewer);
      assert.equal(args.where.agentId, null);
      assert.ok(args.where.activity.equals);
      assert.deepEqual(args.where.taskId.in, [1, 2, 3]);
      return replies.filter((reply) => reply.creatorId === args.where.creatorId && reply.agentId === args.where.agentId && reply.activity === null);
    } },
  };
  const { getDecisionComments } = loadTsModule("src/utils/controllers/notifications/decisionTasks.ts", {
    "@/lib/prisma": { __esModule: true, default: db },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/flags/keys": { HTPR_7092_DECISIONS_FLAG: "htpr-7092-decisions" },
  });
  const decisions = await getDecisionComments(viewer, { userId: viewer });
  assert.deepEqual([...decisions].map(([taskId, comment]) => [taskId, comment.commentId]), [[1, 30], [3, 50]]);
  assert.deepEqual(calls, ["mentions", "replies"]);
  calls.length = 0;
  assert.equal((await getDecisionComments(viewer, {}, async () => false)).size, 0);
  assert.deepEqual(calls, []);
});

for (const enabled of [true, false]) {
  test(`the Decisions response includes question ids only with the flag on (enabled: ${enabled})`, async () => {
    const untouched = { id: "3", taskId: 2 };
    const original = { status: 200, json: { notifications: [{ id: "1", taskId: 1 }, { id: "2", taskId: 1 }, untouched] } };
    const { default: getAll } = loadTsModule("src/utils/controllers/notifications/getAllWithDecisions.ts", {
      "@/utils/controllers/notifications/getAll": { __esModule: true, default: async () => original },
      "@/utils/controllers/notifications/visibleInboxScope": { visibleUserInboxWhere: () => ({ userId: 42 }) },
      "@/utils/controllers/notifications/decisionTasks": { getDecisionComments: async () => new Map([[1, question(30, 15)]]) },
      "@/utils/helperFunctions/helperFunctions": { getInboxTabs: (rows) => rows.filter((row) => row.isDecision) },
      "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
        assert.equal(key, FLAG);
        assert.equal(userId, 42);
        return enabled;
      } },
      "@/lib/flags/keys": { HTPR_7311_DECISION_COMMENT_LINK_FLAG: FLAG },
    });
    const result = await getAll("42");
    const expectedDecisions = original.json.notifications.slice(0, 2).map((row) => ({
      ...row, isDecision: true, ...(enabled ? { decisionCommentId: 30 } : {}),
    }));
    assert.deepEqual(result.json.notifications, [...expectedDecisions, untouched]);
    assert.deepEqual(result.json.structuredData, expectedDecisions);
    if (!enabled) {
      for (const row of [...result.json.notifications, ...result.json.structuredData]) {
        assert.equal(Object.hasOwn(row, "decisionCommentId"), false);
      }
    }
    assert.equal(result.json.notifications[2], untouched);
    assert.equal(original.json.notifications[0].decisionCommentId, undefined);
  });
}

const notification = (overrides = {}) => ({
  id: "1", type: "Comment", taskId: 1, projectId: 15, project: { id: 15 },
  task: { id: 1, projectId: 15, uniqueIndex: 7311 }, decisionCommentId: 30, ...overrides,
});

function createInboxHarness(enabled, split, rows = [notification()], disableInboxFlow = false, inboxVisibleOrder = false) {
  const calls = [];
  let playlist;
  const tree = sourceTree(inboxFile);
  const decisionGate = findNode(tree, (node) => ts.isIfStatement(node) && node.expression.getText(tree) === "decisionCommentLinkEnabled");
  assert.ok(decisionGate);
  const environment = {
    inboxConfig, withDecisionCommentAnchor, buildInboxTasksPlaylist, selectedSplit: split,
    inboxVisibleOrder, snapshot: null,
    decisionCommentLinks: evaluate(`(() => { let decisionCommentLinks = ${expression(inboxFile, "decisionCommentLinks")}; ${decisionGate.getText(tree)} return decisionCommentLinks; })()`, { decisionCommentLinkEnabled: enabled, selectedSplit: split, decisionsSplitName }),
    disableInboxFlow, disableNotificationSideEffects: true,
    _notifications: rows, selectedKeyboardRow: { item: { kind: "notification", notification: rows[0] } },
    setTasksPlayList: (value) => { playlist = value; },
    router: { push: (url) => calls.push(url) },
    navigateToTask: (project, index, mode, suffix) => calls.push(`/detail/project-${project}/${index}${suffix}`),
    markTaskDetailNavigationStart: () => {},
    commentIdHash: inboxConfig.urls.commentHash,
  };
  environment.buildQueryParams = evaluate(expression(inboxFile, "buildQueryParams"), environment);
  environment.buildUniqueTasksPlaylist = evaluate(expression(inboxFile, "buildUniqueTasksPlaylist"), environment);
  return { calls, environment, open: evaluate(expression(inboxFile, "openTask"), environment), playlist: () => playlist };
}

test("Decisions click and keyboard open anchor the question with cached opens", async () => {
  {
    for (const clicked of [true, false]) {
      const row = notification({ type: "Mentioned", commentId: 99 });
      const harness = createInboxHarness(true, "Decisions", [row]);
      await harness.open("view", clicked ? row : null);
      assert.deepEqual(harness.calls, ["/detail/project-15/7311?inboxFlow=true#comment-30"]);
      assert.equal(harness.playlist()[0].decisionCommentId, 30);
    }
  }
  const reply = createInboxHarness(true, "Decisions");
  await reply.open("reply", notification());
  assert.deepEqual(reply.calls, ["/detail/project-15/7311?inboxFlow=true&reply=true#comment-30"]);
});

test("flag off and every other split keep byte-identical open URLs and playlists", async () => {
  for (const [enabled, split] of [[false, "Decisions"], [true, "Important"], [true, "Updates"], [true, "@Mentions"], [true, "Agents"], [true, "Stale"], [true, "Reactions"]]) {
    {
      for (const clicked of [true, false]) {
        const row = notification();
        const harness = createInboxHarness(enabled, split, [row]);
        await harness.open("view", clicked ? row : null);
        assert.deepEqual(harness.calls, ["/detail/project-15/7311?inboxFlow=true"]);
        assert.deepEqual(harness.playlist(), [{ projectId: 15, uniqueIndex: 7311, notification: row }]);
      }
    }
    const mentioned = notification({ type: "Mentioned", commentId: 99 });
    const harness = createInboxHarness(enabled, split, [mentioned]);
    await harness.open("view", mentioned);
    assert.deepEqual(harness.calls, ["/detail/project-15/7311?inboxFlow=true#comment-99"]);
  }
});

test("a mouse click on an inbox row keeps the inbox flow so sending a comment moves to the next message", async () => {
  for (const [mode, suffix] of [["view", ""], ["reply", "&reply=true"], ["audio", "&audio=true"]]) {
    const row = notification({ decisionCommentId: undefined });
    const clicked = createInboxHarness(false, "Important", [row, notification({ id: "2", taskId: 2, task: { id: 2, projectId: 15, uniqueIndex: 7312 } })]);
    await clicked.open(mode, row);
    const keyboard = createInboxHarness(false, "Important", [row]);
    await keyboard.open(mode, null);
    assert.deepEqual(clicked.calls, [`/detail/project-15/7311?inboxFlow=true${suffix}`]);
    assert.deepEqual(clicked.calls, keyboard.calls, "click and Enter open the same address");
    assert.deepEqual(clicked.playlist().map((item) => item.uniqueIndex), [7311, 7312]);
  }
  const optedOut = createInboxHarness(false, "Important", [notification({ decisionCommentId: undefined })], true);
  await optedOut.open("view", notification({ decisionCommentId: undefined }));
  assert.deepEqual(optedOut.calls, ["/detail/project-15/7311"], "still allowed: callers that disable the inbox flow keep a plain address");
});

test("the row Link href uses the same anchor for ordinary and modified clicks", () => {
  const tree = sourceTree(inboxFile);
  const href = findNode(tree, (node) => ts.isJsxAttribute(node) && node.name.text === "href" && node.initializer?.expression?.getText(tree).includes("inboxConfig.urls.taskDetail"));
  assert.ok(href);
  for (const enabled of [true, false]) {
    const harness = createInboxHarness(enabled, "Decisions");
    const url = evaluate(href.initializer.expression.getText(tree), { ...harness.environment, notification: notification(), mentionedQueryParam: "" });
    assert.equal(url, `/detail/project-15/7311?inboxFlow=true&split=Decisions${enabled ? "#comment-30" : ""}`);
  }
  const mentionHarness = createInboxHarness(false, "Important");
  const mentionUrl = evaluate(href.initializer.expression.getText(tree), { ...mentionHarness.environment, notification: notification(), mentionedQueryParam: "#comment-5" });
  assert.equal(mentionUrl, "/detail/project-15/7311?inboxFlow=true&split=Important#comment-5", "HTPR-7680: the split stays in the query and the mention anchor stays last");
  const source = read(inboxFile);
  assert.match(source, /onClickCapture=[\s\S]*?openTask\("view", notification, globalIndex\)/);
  assert.match(source, /KeyCodes\.ENTER[\s\S]*?openTask\("view"\)/);
});

function createNextHarness(enabled, playlist, flow = "true", missingCurrent = false) {
  const calls = [];
  const environment = {
    ...archiveNavigation, withDecisionCommentAnchor,
    tasksPlayList: playlist, currentItemInTasksPlaylist: { projectId: 15, uniqueIndex: missingCurrent ? 999 : 7311 },
    currentTask: { id: 1, projectId: 15 }, decisionCommentLinkEnabled: enabled,
    searchParams: new URLSearchParams(flow ? `inboxFlow=${flow}` : ""),
    moveIdxDown: () => {}, moveIdxUp: () => {}, onGoback: () => calls.push("back"),
    navigate: (mode, href) => calls.push(href),
  };
  return {
    calls,
    next: evaluate(expression(navigationFile, "navigateToNextTask"), environment),
    previous: evaluate(expression(navigationFile, "navigateToPreviousTask"), environment),
  };
}

test("Inbox Next, missing-current Next, and previous opens carry only Decisions playlist anchors", () => {
  const playlist = [{ projectId: 15, uniqueIndex: 7311, decisionCommentId: 30 }, { projectId: 15, uniqueIndex: 7312, decisionCommentId: 40 }];
  for (const enabled of [true, false]) {
    const harness = createNextHarness(enabled, playlist);
    harness.next(false, true);
    assert.deepEqual(harness.calls, [`/detail/project-15/7312?inboxFlow=true${enabled ? "#comment-40" : ""}`]);
    harness.previous(true, true, "true");
    assert.equal(harness.calls[1], `/detail/project-15/7311?inboxFlow=true${enabled ? "#comment-30" : ""}`);
    const missing = createNextHarness(enabled, playlist, "true", true);
    missing.next(false, true);
    assert.deepEqual(missing.calls, [`/detail/project-15/7311?inboxFlow=true${enabled ? "#comment-30" : ""}`]);
  }
  const otherSplit = createNextHarness(true, playlist.map(({ decisionCommentId, ...item }) => item));
  otherSplit.next(false, true);
  assert.deepEqual(otherSplit.calls, ["/detail/project-15/7312?inboxFlow=true"]);
  const nonInbox = createNextHarness(true, playlist, "");
  nonInbox.next(false, true);
  assert.deepEqual(nonInbox.calls, ["/detail/project-15/7312"]);
});

test("anchor helper preserves existing URLs off, uses the established comment hash on, and safely replaces older mention anchors", () => {
  const plain = "/detail/project-15/7311?inboxFlow=true&audio=true";
  assert.equal(withDecisionCommentAnchor(plain, 30, true), `${plain}${inboxConfig.urls.commentHash(30)}`);
  assert.equal(withDecisionCommentAnchor(`${plain}#comment-99`, 30, true), `${plain}#comment-30`);
  assert.equal(withDecisionCommentAnchor(`${plain}#comment-99`, 30, false), `${plain}#comment-99`);
  assert.equal(withDecisionCommentAnchor(plain, undefined, true), plain);
});

test("flag is a low-risk feature on for Everyone and runtime gates cover both changed UI files", () => {
  const flag = loadTsModule("src/lib/flags/definitions/htpr-7311-decision-comment-link.ts");
  assert.equal(flag.HTPR_7311_DECISION_COMMENT_LINK_FLAG, FLAG);
  assert.equal(flag.default.key, FLAG);
  assert.equal(flag.default.kind, "feature");
  assert.equal(flag.default.defaultMode, "EVERYONE");
  assert.equal(flag.default.releaseRisk.risk, "small");
  assert.ok(flag.default.releaseRisk.reason);
  for (const file of [inboxFile, navigationFile]) {
    assert.match(read(file), /useFlag\(HTPR_7311_DECISION_COMMENT_LINK_FLAG\)/);
  }
  assert.match(read(".claude/skills/verify-qa/reference/feature-map/inbox.md"), /htpr-7311-decision-comment-link/);
});

test("click and reply opens queue blocked tickets in visible order only while the bugfix flag is on", async () => {
  const rows = [3, 2, 1, 5, 4].map((uniqueIndex) => notification({
    id: String(uniqueIndex <= 3 ? -uniqueIndex : uniqueIndex),
    taskId: uniqueIndex,
    waitingOnSynthetic: uniqueIndex <= 3,
    createdAt: `2026-10-24T${String(20 - uniqueIndex).padStart(2, "0")}:00:00.000Z`,
    task: { id: uniqueIndex, projectId: 15, uniqueIndex },
  }));
  for (const enabled of [false, true]) {
    for (const clicked of [false, true]) {
      const harness = createInboxHarness(false, "Important", rows, false, enabled);
      await harness.open(clicked ? "view" : "reply", clicked ? rows[2] : null);
      assert.deepEqual(harness.playlist().map((item) => item.uniqueIndex), enabled ? [1, 2, 3, 4, 5] : [3, 2, 1, 5, 4]);
    }
  }
});
