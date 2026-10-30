const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

function fixture(options = {}) {
  const rows = [];
  const created = [];
  const task = {
    id: 42,
    ticketNumber: "HTPR-42",
    status: options.taskDeleted ? "Deleted" : "Normal",
    projectId: 15,
    project: { status: options.boardStatus ?? "Normal" },
  };
  const prisma = {
    task: {
      findFirst: async ({ where }) => {
        assert.equal(where.id, 42);
        assert.ok(where.project);
        return options.taskMissing ? null : { ...task };
      },
    },
    taskSharing: {
      findFirst: async ({ where }) => {
        assert.equal(where.taskId, 42);
        assert.equal(where.userId, 7);
        return rows.find((row) => row.taskId === 42 && row.userId === 7) ?? null;
      },
      create: async ({ data }) => {
        created.push(data);
        const row = { id: `share-${created.length}`, expired: false, expiredAt: null, shareType: "Anyone", ...data };
        rows.push(row);
        return row;
      },
    },
  };
  const mocks = {
    "@/lib/prisma": { default: prisma },
    "@/lib/flags": { isFeatureEnabled: async () => options.flagEnabled !== false },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: (userId) => ({ access: userId }) },
  };
  return { ...load("src/lib/tasks/taskSharing.ts", mocks), rows, created };
}

const actor = { taskId: 42, currentUser: { id: 7 }, agentId: "agent-owner", teamScope: null };

test("shareTaskWithLink creates the public link an agent can hand to a client", async () => {
  const share = fixture();
  const result = await share.shareTaskWithLink(actor);
  assert.equal(result.status, 200);
  assert.equal(result.body.taskId, 42);
  assert.equal(result.body.ticketNumber, "HTPR-42");
  assert.equal(result.body.isPublic, true);
  assert.match(result.body.link, /\/share\?id=share-1$/);
  assert.equal(result.body.shareType, "Anyone");
  assert.deepEqual(share.created, [{ taskId: 42, userId: 7, projectId: 15 }]);
});

test("shareTaskWithLink reuses a live link instead of creating a second one", async () => {
  const share = fixture();
  share.rows.push({ id: "share-old", taskId: 42, userId: 7, expired: false, expiredAt: null, shareType: "Anyone" });
  const result = await share.shareTaskWithLink(actor);
  assert.equal(result.body.link, "https://app.hypertask.ai/share?id=share-old");
  assert.equal(share.created.length, 0);
});

test("shareTaskWithLink replaces an expired link", async () => {
  const share = fixture();
  share.rows.push({ id: "share-dead", taskId: 42, userId: 7, expired: true, expiredAt: null, shareType: "Anyone" });
  const result = await share.shareTaskWithLink(actor);
  assert.match(result.body.link, /share\?id=share-1$/);
  assert.equal(share.created.length, 1);
});

test("a board where sharing is off refuses politely", async () => {
  const share = fixture({ boardStatus: "Archived" });
  const result = await share.shareTaskWithLink(actor);
  assert.equal(result.status, 403);
  assert.equal(result.body.message, "This board does not allow sharing a ticket");
  assert.equal(share.created.length, 0);
});

test("a deleted ticket cannot be shared", async () => {
  const share = fixture({ taskDeleted: true });
  const result = await share.shareTaskWithLink(actor);
  assert.equal(result.status, 403);
  assert.equal(share.created.length, 0);
});

test("a ticket on a board the agent cannot reach is not found", async () => {
  const share = fixture({ taskMissing: true });
  const result = await share.shareTaskWithLink(actor);
  assert.equal(result.status, 404);
  assert.equal(result.body.message, "Task not found, or you cannot share it");
});

test("sharing off by flag makes no link", async () => {
  const share = fixture({ flagEnabled: false });
  const result = await share.shareTaskWithLink(actor);
  assert.equal(result.status, 404);
  assert.equal(result.body.message, "Ticket sharing is not enabled");
  assert.equal(share.created.length, 0);
});

test("readTaskShare says the ticket is public and returns its link", async () => {
  const share = fixture();
  share.rows.push({ id: "share-live", taskId: 42, userId: 7, expired: false, expiredAt: null, shareType: "Anyone" });
  const result = await share.readTaskShare(actor);
  assert.equal(result.status, 200);
  assert.equal(result.body.isPublic, true);
  assert.equal(result.body.link, "https://app.hypertask.ai/share?id=share-live");
  assert.equal(result.body.shareType, "Anyone");
});

test("readTaskShare says not public when no link exists", async () => {
  const share = fixture();
  const result = await share.readTaskShare(actor);
  assert.equal(result.body.isPublic, false);
  assert.equal(result.body.link, null);
  assert.equal(result.body.shareType, null);
});

test("readTaskShare says not public when the link expired", async () => {
  const share = fixture();
  share.rows.push({ id: "share-past", taskId: 42, userId: 7, expired: false, expiredAt: new Date("2020-01-01T00:00:00Z"), shareType: "Anyone" });
  const result = await share.readTaskShare(actor);
  assert.equal(result.body.isPublic, false);
  assert.match(result.body.link, /share\?id=share-past$/);
});

test("readTaskShare never creates a link", async () => {
  const share = fixture();
  await share.readTaskShare(actor);
  assert.equal(share.created.length, 0);
});
