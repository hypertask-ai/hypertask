const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const compile = (file) =>
  ts.transpileModule(read(file), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

const load = (javascript, stubs) => {
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    mod,
    mod.exports,
    (request) => stubs[request] ?? require(request),
  );
  return mod.exports;
};

const matches = (row, where) =>
  Object.entries(where).every(
    ([key, value]) => value === undefined || row[key] === value,
  );

test("a human assignment coexists with an agent owned by the same user", async () => {
  const owner = {
    id: 6,
    email: "owner@example.test",
    displayName: "Valentin",
  };
  const task = {
    id: 42,
    projectId: 15,
    sectionId: 4309,
    uniqueIndex: 5905,
    ticketNumber: "HTPR-5905",
    title: "Owner assignment",
  };
  const agentAssignment = {
    id: 91,
    assignerId: 6,
    taskId: task.id,
    userId: owner.id,
    agentId: "agent-6",
    assignedAt: new Date("2026-09-01T00:00:00Z"),
    user: owner,
    agent: { id: "agent-6", userId: owner.id, displayName: "Dev 1" },
    agentAssigner: null,
  };
  const rows = [agentAssignment];
  const calls = {
    activities: [],
    cancellations: 0,
    creates: 0,
    fences: 0,
    fenceOptions: [],
    notificationDeletes: [],
    transactions: 0,
    validations: 0,
  };

  const findAssignment = (where) => rows.find((row) => matches(row, where)) ?? null;
  const prisma = {
    task: { findUnique: async () => task },
    agent: { findFirst: async () => ({ userId: owner.id }) },
    assignees: {
      findFirst: async ({ where }) => findAssignment(where),
      findMany: async () => [...rows],
    },
    subscribedDevices: { findMany: async () => [] },
    notification: {
      deleteMany: async ({ where }) => {
        calls.notificationDeletes.push(where);
      },
    },
    $transaction: async (callback) => {
      calls.transactions += 1;
      return callback({
        $executeRaw: async () => 1,
        $queryRaw: async () => [],
        task: {
          findUnique: async () => ({
            projectId: task.projectId,
            sectionId: task.sectionId,
            status: "Normal",
          }),
        },
        assignees: {
          findFirst: async ({ where }) => {
            const row = findAssignment(where);
            return row ? { id: row.id } : null;
          },
          findMany: async ({ where }) => rows.filter((row) => matches(row, where)),
          create: async ({ data }) => {
            calls.creates += 1;
            const row = {
              id: 92,
              assignerId: data.assignerId,
              taskId: data.taskId,
              userId: data.userId,
              agentId: data.agentId ?? null,
              assignedAt: new Date("2026-09-01T00:01:00Z"),
              user: owner,
              agent: null,
              agentAssigner: null,
            };
            rows.push(row);
            return row;
          },
          deleteMany: async ({ where }) => {
            const ids = new Set(where.id.in);
            for (let index = rows.length - 1; index >= 0; index -= 1) {
              if (ids.has(rows[index].id)) rows.splice(index, 1);
            }
          },
        },
        follower: { findFirst: async () => null },
      });
    },
  };

  const stubs = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/models/model": {},
    "../FCM": {},
    "../activities/createAssignedActivity": {
      __esModule: true,
      assignmentActivityUserSelect: {},
      default: (input) => calls.activities.push(input.updatedStatus),
    },
    "../notifications/creation-service/check-reminder_create-notification": {
      __esModule: true,
      default: async () => null,
    },
    "../notifications/agentActionRecipients": {
      shouldSkipSelfAssign: (userId, currentUserId) => userId === currentUserId,
    },
    "../notifications/sendAssignEmail": { sendAssignEmail: async () => {} },
    "@/utils": { taskBaseUri: "https://app.hypertask.ai/detail/" },
    "@/utils/controllers/agents/boardMembers": {
      isAgentOnBoard: async () => true,
    },
    "@/lib/mcp/tasks/services": {
      validateProjectMemberIds: async () => {
        calls.validations += 1;
        return { invalidIds: [] };
      },
    },
    "@/lib/agents/publicAgent": { publicAgentSelect: {} },
    "@/lib/agentWebhooks/outbox": {
      persistAgentWebhookEvent: async () => null,
      publishAgentWebhookDeliveries: async () => {},
    },
    "@/lib/mcp/webhooks/outbox": {
      persistBoardWebhookEvent: async () => [],
      publishBoardWebhookDeliveries: async () => {},
    },
    "@/lib/mcp/tasks/agentMutationFence": {
      AgentMutationLeaseConflictError: class extends Error {},
      assertAgentAssignmentChangeAllowed: async (
        _transaction,
        _taskId,
        _agentId,
        _userId,
        options,
      ) => {
        calls.fences += 1;
        calls.fenceOptions.push(options);
      },
      cancelAgentMutationLeaseForHumanOverride: async () => {
        calls.cancellations += 1;
      },
    },
  };

  const { default: assign } = load(
    compile("src/utils/controllers/assignees/assign.ts"),
    stubs,
  );

  const assigned = await assign(owner, owner.id, task.id, undefined, undefined, {
    intent: "assign",
  });

  assert.equal(assigned.status, 200);
  assert.equal(assigned.json.assignmentOutcome, "created");
  assert.deepEqual(
    assigned.json.body.map(({ userId, agentId }) => ({ userId, agentId })),
    [
      { userId: owner.id, agentId: agentAssignment.agentId },
      { userId: owner.id, agentId: null },
    ],
  );
  assert.equal(calls.transactions, 1);
  assert.equal(calls.creates, 1);
  assert.equal(calls.validations, 1);
  assert.equal(calls.fences, 1);
  assert.equal(calls.cancellations, 1);

  const repeated = await assign(owner, owner.id, task.id, undefined, undefined, {
    intent: "assign",
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.json.assignmentOutcome, "already-assigned");
  assert.equal(calls.transactions, 1);
  assert.equal(calls.creates, 1);

  const unassigned = await assign(owner, owner.id, task.id, undefined, undefined, {
    intent: "unassign",
  });
  assert.equal(unassigned.status, 200);
  assert.equal(unassigned.json.assignStatus, "Unassigned");
  assert.deepEqual(
    unassigned.json.body.map(({ userId, agentId }) => ({ userId, agentId })),
    [{ userId: owner.id, agentId: agentAssignment.agentId }],
  );
  assert.equal(calls.transactions, 2);
  assert.equal(calls.fences, 2);
  assert.equal(calls.cancellations, 2);

  const toggledOn = await assign(owner, owner.id, task.id, undefined, undefined, {
    intent: "toggle",
  });
  assert.equal(toggledOn.status, 200);
  assert.deepEqual(
    toggledOn.json.body.map(({ userId, agentId }) => ({ userId, agentId })),
    [
      { userId: owner.id, agentId: agentAssignment.agentId },
      { userId: owner.id, agentId: null },
    ],
  );

  const toggledOff = await assign(owner, owner.id, task.id, undefined, undefined, {
    intent: "toggle",
  });
  assert.equal(toggledOff.status, 200);
  assert.deepEqual(
    toggledOff.json.body.map(({ userId, agentId }) => ({ userId, agentId })),
    [{ userId: owner.id, agentId: agentAssignment.agentId }],
  );
  assert.equal(calls.transactions, 4);
  assert.equal(calls.fences, 4);
  assert.equal(calls.cancellations, 4);
  assert.deepEqual(calls.activities, [
    "Assigned",
    "Unassigned",
    "Assigned",
    "Unassigned",
  ]);
  assert.deepEqual(calls.notificationDeletes, [
    { type: "Assigned", taskId: task.id, userId: owner.id, agentId: null },
    { type: "Assigned", taskId: task.id, userId: owner.id, agentId: null },
  ]);

  const staleUnassignment = await assign(
    owner,
    owner.id,
    task.id,
    agentAssignment.agentId,
    undefined,
    {
      intent: "unassign",
      expectedProjectId: task.projectId,
      expectedSectionId: 5511,
      allowHumanOverride: false,
    },
  );
  assert.equal(staleUnassignment.status, 409);
  assert.equal(staleUnassignment.json.assignmentOutcome, "stale-task");
  assert.deepEqual(
    rows.map(({ userId, agentId }) => ({ userId, agentId })),
    [{ userId: owner.id, agentId: agentAssignment.agentId }],
  );
  assert.equal(calls.cancellations, 4);
  assert.deepEqual(calls.fenceOptions.at(-1), { allowHumanOverride: false });

  const projectOnly = await assign(
    owner,
    owner.id,
    task.id,
    agentAssignment.agentId,
    undefined,
    {
      intent: "unassign",
      expectedProjectId: task.projectId,
      allowHumanOverride: false,
    },
  );
  assert.equal(projectOnly.status, 200);

  rows.push(agentAssignment);
  const sectionOnly = await assign(
    owner,
    owner.id,
    task.id,
    agentAssignment.agentId,
    undefined,
    {
      intent: "unassign",
      expectedSectionId: task.sectionId,
      allowHumanOverride: false,
    },
  );
  assert.equal(sectionOnly.status, 200);
  assert.equal(rows.length, 0);
});
