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

test("HTPR-5674 regression passed: a user's agent assignment prevents a duplicate user assignment", async () => {
  const existingAssignment = {
    id: 91,
    taskId: 42,
    userId: 6,
    agentId: "agent-6",
    user: { id: 6, displayName: "Valentin" },
    agent: { id: "agent-6", userId: 6, displayName: "Dev 1" },
    agentAssigner: null,
  };
  let transactionCalls = 0;
  let transactionLookup;

  const prisma = {
    task: {
      findUnique: async () => ({
        id: 42,
        projectId: 15,
        sectionId: 4307,
        uniqueIndex: 5674,
        ticketNumber: "HTPR-5674",
        title: "CLI bug: assign duplicates existing assignee",
      }),
    },
    assignees: {
      findFirst: async ({ where }) =>
        where.taskId === 42 &&
        where.userId === 6 &&
        !Object.hasOwn(where, "agentId")
          ? existingAssignment
          : null,
      findMany: async () => [existingAssignment],
    },
    subscribedDevices: {
      findMany: async () => [],
    },
    $transaction: async (callback) => {
      transactionCalls += 1;
      return callback({
        $executeRaw: async () => 1,
        $queryRaw: async () => [],
        assignees: {
          findFirst: async ({ where }) => {
            transactionLookup = where;
            return { id: 92 };
          },
        },
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
      default: () => {},
    },
    "../notifications/creation-service/check-reminder_create-notification": {
      __esModule: true,
      default: async () => {},
    },
    "../notifications/agentActionRecipients": {
      shouldSkipSelfAssign: () => false,
    },
    "../notifications/sendAssignEmail": { sendAssignEmail: async () => {} },
    "@/utils": { taskBaseUri: "https://app.hypertask.ai/detail/" },
    "@/utils/controllers/agents/boardMembers": {
      isAgentOnBoard: async () => true,
    },
    "@/lib/mcp/tasks/services": {
      validateProjectMemberIds: async () => ({ invalidIds: [] }),
    },
    "@/lib/agents/publicAgent": { publicAgentSelect: {} },
    "@/lib/agentWebhooks/outbox": {
      persistAgentWebhookEvent: async () => null,
      publishAgentWebhookDeliveries: async () => {},
    },
    "@/lib/mcp/webhooks/outbox": {
      persistBoardWebhookEvent: async () => null,
      publishBoardWebhookDeliveries: async () => {},
    },
    "@/lib/mcp/tasks/agentMutationFence": {
      AgentMutationLeaseConflictError: class extends Error {},
      assertAgentAssignmentChangeAllowed: async () => {},
      cancelAgentMutationLeaseForHumanOverride: async () => {},
    },
  };

  const { default: assign } = load(
    compile("src/utils/controllers/assignees/assign.ts"),
    stubs,
  );

  const response = await assign(
    { id: 6, displayName: "Valentin" },
    6,
    42,
    undefined,
    "calling-agent",
    { intent: "assign" },
  );

  assert.equal(response.status, 200);
  assert.equal(response.json.assignStatus, "Assigned");
  assert.equal(response.json.assignmentOutcome, "already-assigned");
  assert.equal(response.json.body.length, 1);
  assert.equal(transactionCalls, 0);

  const unassignResponse = await assign(
    { id: 6, displayName: "Valentin" },
    6,
    42,
    undefined,
    "calling-agent",
    { intent: "unassign" },
  );

  assert.equal(unassignResponse.status, 200);
  assert.equal(unassignResponse.json.assignStatus, "Unassigned");
  assert.equal(unassignResponse.json.body[0].agentId, "agent-6");
  assert.equal(transactionCalls, 0);

  const toggleResponse = await assign(
    { id: 6, displayName: "Valentin" },
    6,
    42,
    undefined,
    undefined,
    { intent: "toggle" },
  );

  assert.equal(toggleResponse.status, 200);
  assert.equal(toggleResponse.json.assignStatus, "Assigned");
  assert.deepEqual(transactionLookup, {
    taskId: 42,
    userId: 6,
    agentId: null,
  });
  assert.equal(transactionCalls, 1);

  const route = read("src/app/api/mcp/assignees/assign/route.ts");
  const service = read("src/lib/mcp-server/lib/services/task.service.ts");
  assert.match(
    route,
    /assignIntent === "assign" && !hasMultipleUsers/,
  );
  assert.match(
    service,
    /assignmentOutcome\?: 'created' \| 'already-assigned'/,
  );
});
