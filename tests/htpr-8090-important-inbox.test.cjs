const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
let entry = 0;

async function inbox({ flagOn = true, kind = "qa", assigned = true, muted = false, status = "Normal", section = "In Progress", laterUpdate = false, stale = false, splitMuted = false } = {}) {
  const now = new Date();
  const activityAt = stale ? new Date(now.getTime() - 30 * 86400000) : now;
  const comment = { id: 321948, text: "<p>Human update</p>", kind };
  const actor = { id: "own-agent", displayName: "Agent", permissions: { postsToImportant: !muted } };
  const task = {
    id: 79865, title: "Fleet Setup", status, section,
    sectionChangedAt: activityAt, createdAt: activityAt, lastCommentAt: activityAt,
    assignees: [{ userId: 6, agentId: assigned ? null : actor.id }],
    comments: [{ createdAt: activityAt }],
  };
  const row = {
    id: 344971, taskId: task.id, projectId: 4060, type: laterUpdate ? "TaskMoved" : "Comment",
    userId: 6, agentId: null, fromAgentId: actor.id, fromUserId: 6,
    comment: laterUpdate ? null : comment, commentId: laterUpdate ? null : comment.id,
    createdAt: now, task, project: { id: 4060, title: "Fleet Infra" }, directReply: false,
  };
  const calls = [];
  const prisma = {
    $queryRaw: async (query) => query.sql.includes("AS selected") ? [{ id: row.id }] : [
      { taskId: task.id, type: "Comment", fromAgentId: actor.id, fromUserId: 6, createdAt: now },
      ...(laterUpdate ? [{ taskId: task.id, type: "TaskMoved", fromAgentId: actor.id, fromUserId: 6, createdAt: now }] : []),
    ],
    notification: {
      findMany: async (args) => {
        if (args.where.AND?.some((clause) => clause.id)) return [row];
        if (args.where.comment) {
          calls.push(args);
          assert.equal(args.where.userId, 6);
          assert.equal(args.where.agentId, null);
          assert.equal(args.where.type, "Comment");
          assert.deepEqual(args.where.task.assignees.some, { userId: 6, agentId: null });
          assert.deepEqual(args.where.comment.kind.in, ["question", "qa", "done"]);
          return assigned && args.where.comment.kind.in.includes(kind) ? [{ taskId: task.id, fromAgentId: actor.id }] : [];
        }
        if (args.where.type?.in) return [{ ...row, type: "Comment", comment, commentId: comment.id }];
        return [];
      },
      groupBy: async () => [],
    },
    agent: { findMany: async () => [actor] },
    user: { findMany: async () => [{ id: 6, displayName: "Owner" }] },
    task: { findMany: async () => [] },
    userSetting: { findUnique: async () => ({ notificationMatrix: { showImportantSplit: true, splitsNoImportant: splitMuted ? ["project:4060"] : [] } }) },
    taskReadState: { findMany: async () => [] },
    comment: { groupBy: async () => [] },
  };
  for (const [file, exports] of [
    ["src/lib/prisma.ts", { default: prisma }],
    ["src/lib/flags.ts", { isFeatureEnabled: async (key) => key === "htpr-8090-assignee-inbox" && flagOn }],
  ]) {
    const filename = path.join(root, file);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  }
  const jiti = require("jiti")(path.join(root, `tests/8090-important-${++entry}.cjs`), {
    interopDefault: true, alias: { "@": path.join(root, "src") }, cache: false,
  });
  const loaded = jiti(path.join(root, "src/utils/controllers/notifications/getAll.ts"));
  const result = await (loaded.default ?? loaded)("6");
  assert.equal(result.status, 200);
  const important = result.json.structuredData.tabs.find((tab) => tab.project === "Important");
  const rows = important ? result.json.structuredData.data[important.idx] : [];
  return { rows, notifications: result.json.notifications, calls };
}

for (const kind of ["qa", "question", "done"]) {
  test(`${kind}: owner receives own agent's assigned ticket in Important`, async () => {
    const result = await inbox({ kind });
    assert.deepEqual(result.rows, [0]);
    assert.equal(result.notifications[0].fromAgentId, "own-agent");
    assert.equal(result.notifications[0].directReply, false);
  });
}

test("a later agent move cannot hide the typed comment's Important slot", async () => {
  const result = await inbox({ laterUpdate: true });
  assert.deepEqual(result.rows, [0]);
  assert.equal(result.notifications[0].type, "Comment");
  assert.equal(result.notifications[0].commentId, 321948);
});

for (const [name, options] of [
  ["flag off", { flagOn: false }],
  ["untyped chatter", { kind: null }],
  ["agent-only assignment", { assigned: false }],
  ["agent not allowed Important", { muted: true }],
  ["done ticket", { section: "Done" }],
  ["stale ticket", { stale: true }],
  ["project split muted", { splitMuted: true }],
]) {
  test(`${name}: no new Important row`, async () => {
    assert.deepEqual((await inbox(options)).rows, []);
  });
}

test("flag off avoids the extra notification query", async () => {
  assert.deepEqual((await inbox({ flagOn: false })).calls, []);
});
