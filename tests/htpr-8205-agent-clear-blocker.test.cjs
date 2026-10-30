const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const FLAG = "htpr-8205-agent-clear-blocker";
const DECISIONS_FLAG = "htpr-7092-decisions";
const at = (minute) => new Date(`2026-10-30T10:${String(minute).padStart(2, "0")}:00Z`);
const questionAt = (minute, commentId = 100 + minute) => ({
  taskId: 42, commentId, text: "<p>Question: ship?</p>", commentText: "Question: ship?", createdAt: at(minute),
});

test("flag is an Everyone-default feature flag with a release risk", () => {
  const { default: definition, HTPR_8205_AGENT_CLEAR_BLOCKER_FLAG } = load("src/lib/flags/definitions/htpr-8205-agent-clear-blocker.ts", {});
  assert.equal(HTPR_8205_AGENT_CLEAR_BLOCKER_FLAG, FLAG);
  assert.equal(definition.key, FLAG);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.ok(definition.releaseRisk.reason);
  assert.equal(require("../e2e/smoke/production-flag-modes.json").modes[FLAG], "EVERYONE");
});

test("a blocker clear after the Question removes it from Decisions", () => {
  const { pickDecisionComments } = load("src/lib/inboxDecisions.ts", {});
  assert.deepEqual([...pickDecisionComments([questionAt(5)], [], [{ taskId: 42, createdAt: at(8) }]).keys()], []);
});

test("posting the Question again after a clear brings the ticket back", () => {
  const { pickDecisionComments } = load("src/lib/inboxDecisions.ts", {});
  const picked = pickDecisionComments([questionAt(5), questionAt(12)], [], [{ taskId: 42, createdAt: at(8) }]);
  assert.equal(picked.get(42).commentId, 112);
});

test("a clear on another ticket leaves this Question in Decisions", () => {
  const { pickDecisionComments } = load("src/lib/inboxDecisions.ts", {});
  assert.deepEqual([...pickDecisionComments([questionAt(5)], [], [{ taskId: 7, createdAt: at(8) }]).keys()], [42]);
});

function decisionsWorld({ clearFlag }) {
  const queries = [];
  const db = {
    notification: {
      findMany: async () => [{ taskId: 42, commentId: 105, comment: { text: "<p>Question: ship?</p>", commentText: "Question: ship?", createdAt: at(5) } }],
    },
    comment: {
      findMany: async (args) => {
        queries.push(args.where);
        return args.where.activity?.path ? [{ taskId: 42, createdAt: at(8) }] : [];
      },
    },
  };
  const { getDecisionComments } = load("src/utils/controllers/notifications/decisionTasks.ts", {
    "@/lib/prisma": { default: db },
    "@/lib/flags/keys": { HTPR_7092_DECISIONS_FLAG: DECISIONS_FLAG },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === DECISIONS_FLAG || (key === FLAG && clearFlag) },
  });
  return { getDecisionComments, queries };
}

test("with the flag on, an agent's blocker clear drops the Question from the viewer's Decisions", async () => {
  const world = decisionsWorld({ clearFlag: true });
  assert.equal((await world.getDecisionComments(6, {})).size, 0);
  assert.deepEqual(world.queries[1].activity, { path: ["data", "blockerCleared"], equals: true });
  assert.deepEqual(world.queries[1].taskId, { in: [42] });
});

test("with the flag off, the clear marker is not read and the Question stays", async () => {
  const world = decisionsWorld({ clearFlag: false });
  assert.deepEqual([...(await world.getDecisionComments(6, {})).keys()], [42]);
  assert.equal(world.queries.length, 1);
});

function waitingOnWorld({ clearFlag = true, task = { projectId: 15, waitingOnUserId: null, blockerCommentId: 900 }, mentioned = [{ userId: 6 }, { userId: 7 }] } = {}) {
  const activities = [], updates = [], inboxes = [], taskLookups = [];
  const agent = { id: "agent-19", userId: 19, displayName: "RUNNER 19", photoURL: null };
  const db = {
    task: {
      findFirst: async (args) => { taskLookups.push(args.where); return task; },
      update: async ({ data }) => { updates.push(data); return { id: 42, ...data }; },
    },
    comment: { findFirst: async () => ({ id: 900 }) },
    user: { findUnique: async () => null },
    agent: { findUnique: async () => agent },
    notification: { findMany: async () => mentioned },
  };
  const { setTaskWaitingOn } = load("src/lib/tasks/setWaitingOn.ts", {
    "@/lib/prisma": { default: db },
    "@prisma/client": { Prisma: { DbNull: Symbol("DbNull") } },
    "@/lib/flags": { isFeatureEnabled: async (key) => key === FLAG ? clearFlag : true },
    "@/lib/realtime/server": {
      broadcastBoardChange: () => {},
      broadcastTaskChange: () => {},
      broadcastInboxChange: (id) => inboxes.push(id),
    },
    "@/lib/mcp/tasks/services": { validateProjectMemberIds: async () => ({ invalidIds: [] }) },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: (...args) => ({ args }) },
    "@/utils/controllers/activities/createActivity": { default: async (input) => { activities.push(input); } },
  });
  return { setTaskWaitingOn, activities, updates, inboxes, taskLookups, agent };
}

const agentClear = (world, extra = {}) => world.setTaskWaitingOn({
  taskId: 42, blockerCommentId: null, reason: "Valentin answered in the ticket", currentUser: { id: 19 },
  agentId: "agent-19", teamScope: null, ...extra,
});

test("an agent clears the blocker with a reason and one note records who and why", async () => {
  const world = waitingOnWorld();
  const result = await agentClear(world);
  assert.equal(result.status, 200);
  assert.deepEqual(world.updates, [{ blockerCommentId: null }]);
  assert.equal(world.activities.length, 1);
  const { type, data } = world.activities[0].activityBody;
  assert.equal(type, "TaskWaitingOn");
  assert.equal(data.blockerCleared, true);
  assert.equal(data.reason, "Valentin answered in the ticket");
  assert.equal(data.fromAgent.displayName, "RUNNER 19");
});

test("everyone with a Mention on the ticket gets an inbox refresh at once", async () => {
  const world = waitingOnWorld();
  await agentClear(world);
  assert.deepEqual([...world.inboxes].sort(), [6, 7]);
});

test("an agent clear without a reason is refused and changes nothing", async () => {
  const world = waitingOnWorld();
  const result = await agentClear(world, { reason: "   " });
  assert.equal(result.status, 400);
  assert.match(result.body.message, /reason is required/);
  assert.deepEqual([world.updates, world.activities], [[], []]);
});

test("a ticket the agent cannot edit is refused: the lookup is scoped to the agent's boards", async () => {
  const world = waitingOnWorld({ task: null });
  const result = await agentClear(world);
  assert.equal(result.status, 404);
  assert.deepEqual([world.updates, world.activities, world.inboxes], [[], [], []]);
  assert.equal(world.taskLookups[0].project.AND.length, 2);
});

test("a ticket the agent can edit is still cleared with the scoped lookup", async () => {
  const world = waitingOnWorld();
  assert.equal((await agentClear(world)).status, 200);
  assert.equal(world.taskLookups[0].project.AND.length, 2);
});

test("clearing a ticket that has no blocker writes no note", async () => {
  const world = waitingOnWorld({ task: { projectId: 15, waitingOnUserId: null, blockerCommentId: null } });
  assert.equal((await agentClear(world)).status, 200);
  assert.deepEqual(world.activities, []);
});

test("with the flag off the clear works as before: no note, no reason needed", async () => {
  const world = waitingOnWorld({ clearFlag: false });
  const result = await agentClear(world, { reason: undefined });
  assert.equal(result.status, 200);
  assert.deepEqual(world.activities, []);
  assert.deepEqual(world.inboxes, []);
});

test("clearing the person and the blocker together writes one note", async () => {
  const world = waitingOnWorld({ task: { projectId: 15, waitingOnUserId: 6, blockerCommentId: 900 } });
  await agentClear(world, { userId: null });
  assert.equal(world.activities.length, 1);
  assert.equal(world.activities[0].activityBody.data.blockerCleared, true);
});

test("a person clearing the blocker needs no reason", async () => {
  const world = waitingOnWorld();
  const result = await world.setTaskWaitingOn({ taskId: 42, blockerCommentId: null, currentUser: { id: 6 } });
  assert.equal(result.status, 200);
  assert.equal(world.activities[0].activityBody.data.reason, null);
});

test("MCP schema takes a reason and still refuses unknown fields", () => {
  const { SetTaskWaitingOnInputSchema } = load("src/lib/mcp-server/validations/task.validation.ts", {});
  assert.deepEqual(
    SetTaskWaitingOnInputSchema.parse({ taskId: 42, blockerCommentId: null, reason: "  Answered  " }),
    { taskId: 42, blockerCommentId: null, reason: "Answered" },
  );
  assert.throws(() => SetTaskWaitingOnInputSchema.parse({ taskId: 42, blockerCommentId: null, why: "x" }));
  assert.throws(() => SetTaskWaitingOnInputSchema.parse({ taskId: 42, blockerCommentId: null, reason: "x".repeat(501) }));
});
