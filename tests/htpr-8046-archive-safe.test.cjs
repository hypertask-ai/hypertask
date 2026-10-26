const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");
const { NotificationType, Prisma } = require("@prisma/client");
const controller = load("src/utils/controllers/notifications/inboxZero.ts", {
  "@/lib/prisma": {},
  "./boardAccess": { notificationBoardAccessWhere: () => ({}) },
});
const { DEFAULT_INBOX_ZERO_RULES } = load("src/lib/inboxZero.ts", {});
const now = new Date("2026-10-26T12:00:00Z");
const rules = (agentOnly = false, taskIds = [1]) => ({ ...DEFAULT_INBOX_ZERO_RULES, safeUpdates: { taskIds, agentOnly } });
const row = (id, overrides = {}) => ({
  id, taskId: 1, notification_inviteId: null, type: NotificationType.TaskMoved,
  fromUserId: 6, fromAgentId: "runner", directReply: false, seen: false, createdAt: now,
  task: { status: "Normal", section: "Todo", projectId: 15, dueDate: null, blockerCommentId: null,
    waitingOnUserId: null, description: "", _count: { assignees: 0, comments: 0, decisionRequests: 0 } },
  ...overrides,
});
const evaluate = (rows, options = rules()) => controller.evaluateInboxZero(rows, 6, controller.parseInboxZeroRules(options), now);

test("pure unread moves and edits archive once per ticket, only in the selected split", () => {
  const result = evaluate([row(1), row(2, { type: NotificationType.TaskUpdateDescription }), row(3, { taskId: 2 })]);
  assert.deepEqual(result.notificationIds, [2, 1]);
  assert.equal(result.totalToArchive, 1);
  assert.equal(result.totalLeft, 1);
  assert.equal(result.totalActive, 2);
});

test("a mixed ticket never loses a mention, question, assignment, reminder or comment", () => {
  for (const type of ["Mentioned", "Assigned", "Comment", "TaskReminder", "TaskOverdue", "Reacted", "AgentMessage", "AddedToFollowerInTask"]) {
    const result = evaluate([row(1), row(2, { type })]);
    assert.deepEqual(result.notificationIds, [], type);
    assert.equal(result.totalToArchive, 0, type);
  }
  assert.deepEqual(evaluate([row(1)]).notificationIds, [1]);
});

test("human moves can clear Updates; Important and Agents only clear agent edits", () => {
  const human = row(1, { fromAgentId: null, fromUserId: 9 });
  assert.deepEqual(evaluate([human]).notificationIds, [1]);
  assert.deepEqual(evaluate([human], rules(true)).notificationIds, []);
  assert.deepEqual(evaluate([row(1)], rules(true)).notificationIds, [1]);
  assert.deepEqual(evaluate([row(1), human], rules(true)).notificationIds, []);
});

test("direct replies and task-level work stay even without an active question notification", () => {
  const base = row(1);
  for (const task of [
    { ...base.task, blockerCommentId: 55 },
    { ...base.task, waitingOnUserId: 6 },
    { ...base.task, description: '<span data-label="name-6">Owner</span>' },
    ...["assignees", "comments", "decisionRequests"].map(key => ({ ...base.task, _count: { ...base.task._count, [key]: 1 } })),
    null,
  ]) assert.deepEqual(evaluate([row(1, { task })]).notificationIds, []);
  assert.deepEqual(evaluate([row(1, { directReply: true })]).notificationIds, []);
  assert.deepEqual(evaluate([base]).notificationIds, [1]);
});

test("a new assignment, blocker, question, direct reply or mention invalidates the confirmed preview", () => {
  const before = evaluate([row(1)]).previewVersion;
  const base = row(1);
  for (const changed of [
    row(1, { directReply: true }),
    row(1, { task: { ...base.task, blockerCommentId: 10 } }),
    row(1, { task: { ...base.task, waitingOnUserId: 6 } }),
    row(1, { task: { ...base.task, _count: { assignees: 1, comments: 0, decisionRequests: 0 } } }),
    row(1, { task: { ...base.task, _count: { assignees: 0, comments: 1, decisionRequests: 0 } } }),
  ]) assert.notEqual(evaluate([changed]).previewVersion, before);
});

test("rules parser preserves safe scope and rejects malformed or oversized requests", () => {
  assert.deepEqual(controller.parseInboxZeroRules(rules()), rules());
  for (const safeUpdates of [true, {}, { taskIds: [-1], agentOnly: false }, { taskIds: [1], agentOnly: "false" }, { taskIds: Array(10001).fill(1), agentOnly: true }]) {
    assert.equal(controller.parseInboxZeroRules({ ...rules(), safeUpdates }), null);
  }
  assert.deepEqual(controller.parseInboxZeroRules(DEFAULT_INBOX_ZERO_RULES), DEFAULT_INBOX_ZERO_RULES);
});

for (const endpoint of ["preview", "execute"]) {
  test(`${endpoint} denies disabled safe requests; ordinary Inbox Zero stays available`, async () => {
    const { POST } = load(`src/app/api/notifications/inbox-zero/${endpoint}/route.ts`, {
      "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 6 }) },
      "@/lib/flags": { isFeatureEnabled: async () => false },
      "@/lib/prisma": { $transaction: async callback => callback({ notification: { updateMany: async () => {}, findMany: async () => [] } }) },
      "@/lib/realtime/server": {},
      "@/utils/controllers/notifications/inboxZero": {
        ...controller, loadActiveInboxZeroNotifications: async () => [], loadInboxZeroDoneTitlesByProject: async () => new Map(), // trufflehog:ignore
      },
    });
    const request = data => new Request("http://localhost", { method: "POST", body: JSON.stringify(data) });
    const denied = await POST(request(endpoint === "preview" ? rules() : { rules: rules() }));
    assert.equal(denied.status, 404);
    const allowed = await POST(request(endpoint === "preview" ? DEFAULT_INBOX_ZERO_RULES : { rules: DEFAULT_INBOX_ZERO_RULES, previewVersion: evaluate([], DEFAULT_INBOX_ZERO_RULES).previewVersion }));
    assert.equal(allowed.status, 200);
  });
}

test("confirmed safe batch uses existing archive and undo with every exact notification id", async t => {
  const stored = [row(1), row(2)];
  const db = { notification: {
    updateMany: async ({ where, data }) => { for (const item of stored) if (where.id.in.includes(item.id)) Object.assign(item, data); },
    findMany: async () => stored.filter(item => item.status === "Archive").map(item => ({ id: item.id })),
  } };
  const { POST } = load("src/app/api/notifications/inbox-zero/execute/route.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 6 }) },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/prisma": { $transaction: async callback => callback(db) },
    "@/lib/realtime/server": { broadcastInboxChange: async () => {}, socketIdFromHeader: () => null },
    "@/utils/controllers/notifications/inboxZero": { ...controller, loadActiveInboxZeroNotifications: async () => stored, loadInboxZeroDoneTitlesByProject: async () => new Map() },
  });
  const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ rules: rules(), previewVersion: evaluate(stored).previewVersion }) }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.notificationIds, [1, 2]);
  assert.equal(body.archivedItemCount, 1);
  assert.deepEqual(stored.map(item => item.status), ["Archive", "Archive"]);
  t.mock.method(global, "fetch", async (url, options) => {
    assert.equal(url, "/api/notifications/inbox-zero/undo");
    for (const item of stored) if (JSON.parse(options.body).notificationIds.includes(item.id)) item.status = "Normal";
    return new Response("{}", { status: 200 });
  });
  const { UndoInboxArchive } = load("src/utils/undoActions/helperFuncs.ts", {
    "@/lib/constants/APIRouteConstants": {}, "@/lib/realtime/client": { realtimeEchoHeaders: () => ({}) }, "../api/global": {},
  });
  await UndoInboxArchive({ isInboxZeroOperation: true, notificationIds: body.notificationIds });
  assert.deepEqual(stored.map(item => item.status), ["Normal", "Normal"]);
});

test("new protected work returns a refreshed preview, without archiving the confirmed batch", async () => {
  const before = evaluate([row(1)]);
  const changed = [row(1), row(2, { type: "Mentioned" })];
  let writes = 0;
  const { POST } = load("src/app/api/notifications/inbox-zero/execute/route.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 6 }) },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/prisma": { $transaction: async callback => callback({ notification: { updateMany: async () => { writes++; } } }) },
    "@/lib/realtime/server": {},
    "@/utils/controllers/notifications/inboxZero": { ...controller, loadActiveInboxZeroNotifications: async () => changed, loadInboxZeroDoneTitlesByProject: async () => new Map() },
  });
  const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ rules: rules(), previewVersion: before.previewVersion }) }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.preview.totalToArchive, 0);
  assert.equal(body.preview.totalLeft, 1);
  assert.equal(writes, 0);
});
