const test = require("node:test");
const assert = require("node:assert/strict");
const { actor, loadTs } = require("./slack-app-fixtures.cjs");

function fixture() {
  const calls = [], scopes = [];
  const task = { id: 10, projectId: 15, uniqueIndex: 10, ticketNumber: "HTPR-10", title: "Task", userId: 11, sectionId: 1, section: "Todo", status: "Normal", project: { title: "Web" } };
  const record = (name) => async (...args) => { calls.push({ name, args }); return { status: 200, json: {}, body: {} }; };
  const defaultMock = (fn) => ({ __esModule: true, default: fn });
  const scopedTask = async ({ where }) => { scopes.push(where); return task; };
  const loaded = loadTs("src/lib/slack/actions.ts", {
    "@/lib/constants/constants": { PriorityConstants: [{ priority_index: 0, Priority_Value: "No Priority" }, { priority_index: 1, Priority_Value: "High" }] },
    "@/lib/slack/projectScope": { slackAccessibleProjectWhere: (teamId, userId) => ({ AND: [{ teamId, status: "Normal" }, { member: userId }] }) },
    "@/lib/mcp/tasks/mappers": { taskMcpGetInclude: () => ({}), mapTaskToMcpGetResponse: (row) => ({ ...row, boardTitle: "Web", totalComments: 0 }) },
    "@/lib/mcp/tasks/services": { resolveLabelIds: async () => [], setTaskLabels: record("labels") },
    "@/lib/prisma": { __esModule: true, default: {
      project: { findFirst: async ({ where }) => { scopes.push(where); return { id: 15, title: "Web", uniqueIdentifier: "HTPR" }; }, findMany: async ({ where }) => { scopes.push(where); return [{ id: 15, title: "Web", section: [], _count: { members: 1, tasks: 1 } }]; }, findUnique: async () => ({ ownerId: 42, members: [] }) },
      task: { findFirst: scopedTask, count: async ({ where }) => { scopes.push(where); return 1; }, findMany: async ({ where }) => { scopes.push(where); return [task]; } },
      section: { findFirst: async () => ({ id: 2, section_title: "Done" }), findMany: async () => [{ id: 1, section_title: "Todo" }] },
      follower: { deleteMany: record("remove-follower") },
      notification: { findFirst: async ({ where }) => { scopes.push(where); return { id: 8, taskId: 10 }; }, updateMany: record("notification-siblings"), update: record("archive-inbox") },
      priority: { findUnique: async () => null, upsert: record("priority"), deleteMany: record("priority-delete") },
    } },
    "@/lib/realtime/server": Object.fromEntries(["broadcastBoardChange", "broadcastInboxChange", "broadcastTaskChange", "broadcastTaskComment"].map((name) => [name, record(name)])),
    "@/pages/api/queues/duedateQueue": { cancelDueDateJob: record("cancel-due"), scheduleDueDateJob: record("schedule-due") },
    "@/pages/api/queues/FAST/generateSummary": defaultMock(record("summary")),
    "@/utils/controllers/activities/createArchiveActivity": defaultMock(record("archive-activity")),
    "@/utils/controllers/activities/CreatePriorityActivity": defaultMock(record("priority-activity")),
    "@/utils/controllers/activities/createTaskDueDateActivity": defaultMock(record("due-activity")),
    "@/utils/controllers/assignees/assign": defaultMock(record("assign")),
    "@/utils/controllers/comments/createCommentService": { createCommentService: async (input) => { calls.push({ name: "comment", args: [input] }); return { id: 5 }; } },
    "@/utils/controllers/followers/createFollowerService": { createFollowerService: record("follower") },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove": defaultMock(record("notify")),
    "@/utils/controllers/notifications/broadcastInboxForTask": { broadcastInboxForTask: record("inbox") },
    "@/utils/controllers/notifications/getAll": defaultMock(async (userId) => { assert.equal(userId, "42"); return { status: 200, json: { notifications: [{ id: 8, task, project: { teamId: actor.teamId, title: "Web" } }, { id: 9, task, project: { teamId: "FOREIGN" } }] } }; }),
    "@/utils/controllers/search/document": { turbopufferSearchTaskIds: async () => [10] },
    "@/utils/controllers/tasks/createTaskCore": { createTaskCore: async (input) => { calls.push({ name: "create", args: [input] }); return { task }; } },
    "@/utils/controllers/tasks/single": { updateTaskSingle: record("update") },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { upsertTaskToTurbopuffer: record("index") },
    "@/utils/controllers/urls/extractUrlsFromContent": { persistUrlsForComment: record("urls") },
    "@/utils/helperFunctions/markdownToHtml": { markdownToHtml: (value) => `<p>${value}</p>` },
    "@/utils/helperFunctions/sanitizeRichHtml": { sanitizeRichHtml: (value) => value },
    "@/utils/generateRank": defaultMock(() => "rank"),
  });
  return { ...loaded, calls, scopes };
}

const actions = [
  ["create_task", { title: "New task", project: "Web", assignee: "me", labels: ["bug"] }],
  ["get_task", { ticket: "HTPR-10" }],
  ["list_tasks", { assignee: "me" }],
  ["search_tasks", { query: "Task" }],
  ["move_task", { ticket: "HTPR-10", section: "Done" }],
  ["add_comment", { ticket: "HTPR-10", content: "Comment" }],
  ["assign_user", { ticket: "HTPR-10", username: "me" }],
  ["add_follower", { ticket: "HTPR-10", username: "me" }],
  ["remove_follower", { ticket: "HTPR-10", username: "me" }],
  ["update_task", { ticket: "HTPR-10", title: "Changed", priority: "High", dueDate: "2026-12-01" }],
  ["list_projects", {}],
  ["list_sections", { project: "Web" }],
  ["list_inbox", {}],
  ["archive_inbox", { notificationId: "8" }],
];

for (const [action, params] of actions) {
  test(`real ${action} dispatch uses linked-person controllers and scoped data`, async () => {
    const { executeSlackAction, calls, scopes } = fixture();
    const result = await executeSlackAction(actor, { action, params });
    assert.ok(result.length > 0);
    assert.ok(scopes.length > 0);
    assert.ok(scopes.some((where) => JSON.stringify(where).includes(actor.teamId)));
    for (const call of calls) {
      if (call.name === "create") assert.equal(call.args[0].userId, actor.user.id);
      if (call.name === "comment") { assert.equal(call.args[0].creatorId, actor.user.id); assert.equal(call.args[0].currentUser.id, actor.user.id); }
      if (["assign", "update"].includes(call.name)) assert.equal(call.args[call.name === "assign" ? 0 : 1].id, actor.user.id);
      if (call.name === "follower") assert.equal(call.args[0].mentionById, actor.user.id);
      if (["priority-activity", "due-activity"].includes(call.name)) assert.equal(call.args[0].userObj.id, actor.user.id);
      if (call.name.startsWith("broadcast")) assert.equal(call.args[1].originUserId, actor.user.id);
    }
    if (action === "list_inbox") assert.doesNotMatch(JSON.stringify(result), /Notification ID: `9`/);
    if (action === "archive_inbox") assert.ok(scopes.some((where) => where.userId === actor.user.id));
  });
}

test("required action parameters reject empty and malformed writes", async () => {
  const { executeSlackAction } = fixture();
  for (const [action, params] of [
    ["create_task", { project: "Web" }], ["get_task", {}], ["search_tasks", {}],
    ["move_task", { ticket: "HTPR-10" }], ["add_comment", { ticket: "HTPR-10" }],
    ["assign_user", { ticket: "HTPR-10" }], ["archive_inbox", { notificationId: "bad" }],
  ]) await assert.rejects(executeSlackAction(actor, { action, params }), /required|positive integer/);
});
