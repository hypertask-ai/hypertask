const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest, NextResponse } = require("next/server");
const { Prisma } = require("@prisma/client");
const { load } = require("./task-route-loader.cjs");

const text = "<p>Question: <strong>Keep it?</strong></p><p>My recommendation: Yes.</p><p>Why: less work.</p><p>Yes: keep it.</p><p>No: remove it.</p>";
const body = { taskId: 42, approvedClear: { commentId: 101, text, editedAt: null, reactionId: "human-yes" } };

function fixture(options = {}) {
  const task = { id: 42, projectId: 15, blockerCommentId: 101, waitingOnUserId: 6, waitingOnSetById: 6, waitingOnSetAt: new Date() };
  const question = { text, createdAt: new Date("2026-10-29T00:00:00Z"), editedAt: null };
  const reaction = { id: "human-yes", userId: 6, agentId: null, agentDisplayName: null, isDeleted: false, emoji: "👍", createdAt: new Date("2026-10-29T00:01:00Z"), ...options.reaction };
  const writes = [], activity = [], broadcasts = [], isolation = [], reads = [];
  const projectWhere = (id, agentId) => ({ callerId: id, ...(agentId ? { agentId } : {}) });
  const selection = (select) => Object.fromEntries(Object.keys(select).map((key) => [key, task[key]]));
  const db = {
    task: {
      findFirst: async ({ where }) => {
        reads.push(where);
        assert.deepEqual(where.project, { AND: [projectWhere(6), projectWhere(6, "runner")] });
        return options.denied ? null : { ...task };
      },
      update: async () => { throw new Error("conditional clear must not use unconditional update"); },
    },
    $transaction: async (run, config) => {
      isolation.push(config.isolationLevel);
      if (options.serializationConflict) throw new Prisma.PrismaClientKnownRequestError("race", { code: "P2034", clientVersion: "fixture" });
      return run({
        comment: { findFirst: async ({ where, select }) => {
          assert.equal(where.taskId, 42);
          assert.equal(where.id, 101);
          assert.deepEqual(where.activity, { equals: Prisma.DbNull });
          assert.equal(select.reactions.where.id, body.approvedClear.reactionId);
          if (options.edited || where.text !== question.text || where.editedAt !== null) return null;
          const filter = select.reactions.where;
          const matches = reaction.id === filter.id && reaction.userId === filter.userId
            && reaction.agentId === null && reaction.agentDisplayName === null
            && reaction.isDeleted === false && filter.emoji.in.includes(reaction.emoji);
          return { ...question, reactions: matches ? [reaction] : [] };
        } },
        task: {
          updateMany: async ({ where, data }) => {
            if (options.changedMarker) task.blockerCommentId = 102;
            if (options.changedPerson) task.waitingOnUserId = 9;
            assert.deepEqual(where.project, { AND: [projectWhere(6), projectWhere(6, "runner")] });
            if (task.blockerCommentId !== where.blockerCommentId || !where.OR.some((part) => part.waitingOnUserId === task.waitingOnUserId)) return { count: 0 };
            writes.push(data);
            Object.assign(task, data);
            return { count: 1 };
          },
          findUnique: async ({ select }) => selection(select),
        },
      });
    },
  };
  const mocks = {
    "@/lib/prisma": { default: db },
    "@/lib/flags": { isFeatureEnabled: async (key) => options.disabled !== key },
    "@/lib/flags/definitions/htpr-7723-task-waiting-on": { HTPR_7723_TASK_WAITING_ON_FLAG: "htpr-7723-task-waiting-on" },
    "@/lib/flags/definitions/htpr-7724-blocker-comment": { HTPR_7724_BLOCKER_COMMENT_FLAG: "htpr-7724-blocker-comment" },
    "@/lib/mcp/agents/readRoleGuard": { requireAgentWriteRole: async () => options.readRole ? NextResponse.json({ success: false, error: "read only" }, { status: 403 }) : null },
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (run) => run,
      validateMcpRouteAuth: async () => options.noAuth ? null : { user: { id: 6 }, agentId: "runner", agentRole: "write", teamScope: null },
      checkMcpRouteRateLimit: async () => null,
      mcpRouteUnauthorizedResponse: async () => NextResponse.json({ success: false }, { status: 401 }),
      withMcpRouteMutationLease: async (_db, _actor, run) => run(),
    },
    "@/lib/auth/sessionUserRecord": { loadSessionUserRecord: async () => ({ id: 6 }) },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: projectWhere },
    "@/lib/mcp/tasks/services": { validateProjectMemberIds: async () => { throw new Error("clear never adds a member"); } },
    "@/utils/controllers/activities/createActivity": { default: async (entry) => activity.push(entry) },
    "@/lib/realtime/server": {
      broadcastBoardChange: (...args) => broadcasts.push(args),
      broadcastTaskChange: (...args) => broadcasts.push(args),
      broadcastInboxChange: (...args) => broadcasts.push(args),
    },
  };
  const { POST } = load("src/app/api/mcp/tasks/clear-approved-blocker/route.ts", mocks);
  return {
    task, writes, activity, broadcasts, isolation, reads,
    post: (input = body) => POST(new NextRequest("https://app.hypertask.ai/api/mcp/tasks/clear-approved-blocker", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    })),
  };
}

test("still allowed: owner agent clears the current human-approved question atomically", async () => {
  const f = fixture();
  const response = await f.post();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).task, { id: 42, blockerCommentId: null, waitingOnUserId: null, waitingOnSetById: null, waitingOnSetAt: null });
  assert.deepEqual(f.isolation, ["Serializable"]);
  assert.deepEqual(f.writes, [{ blockerCommentId: null, waitingOnUserId: null, waitingOnSetById: null, waitingOnSetAt: null }]);
  assert.equal(f.activity.length, 1);
  assert.equal(f.broadcasts.length, 3);
});

for (const options of [{ changedMarker: true }, { changedPerson: true }, { edited: true }, { serializationConflict: true },
  { reaction: { isDeleted: true } }, { reaction: { userId: 8 } }, { reaction: { agentId: "runner" } },
  { reaction: { agentDisplayName: "Deleted agent" } }, { reaction: { emoji: "👎" } },
  { reaction: { createdAt: new Date("2026-10-28T23:59:00Z") } }]) {
  test(`now refused: changed blocker or approval ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    const response = await f.post();
    assert.equal(response.status, 409);
    assert.equal((await response.json()).success, false);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.activity, []);
    assert.deepEqual(f.broadcasts, []);
    assert.notEqual(f.task.blockerCommentId, null);
    assert.notEqual(f.task.waitingOnUserId, null);
  });
}

for (const options of [{ noAuth: true }, { readRole: true }, { denied: true }, { disabled: "htpr-7723-task-waiting-on" }, { disabled: "htpr-7724-blocker-comment" }]) {
  test(`existing access and feature gates remain enforced ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    assert.ok([401, 403, 404].includes((await f.post()).status));
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.isolation, []);
  });
}

for (const input of [null, {}, { ...body, taskId: "42" }, { ...body, approvedClear: { ...body.approvedClear, editedAt: "not a date" } }, { ...body, approvedClear: { ...body.approvedClear, reactionId: "" } }, { ...body, userId: null }]) {
  test(`invalid compare-and-clear input never reads task content: ${JSON.stringify(input)}`, async () => {
    const f = fixture();
    assert.equal((await f.post(input)).status, 400);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.writes, []);
  });
}
