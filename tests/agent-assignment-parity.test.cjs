const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("./helpers/chat-stream-source.cjs");
const path = require("node:path");
const { ZodError } = require("zod");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/agent-assignment-parity-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { AssignUserInputSchema } = jiti(
  path.join(root, "src/lib/mcp-server/validations/task.validation.ts")
);
const { actionableToolError } = jiti(
  path.join(root, "src/lib/mcp-server/tool-response.ts")
);
const { resolveUserIds } = jiti(
  path.join(root, "src/app/api/ai/chat/stream/bulkTools.ts")
);

const agentId = "00000000-0000-4000-8000-0000000000ab";

test("MCP assign schema accepts agent_id for assign and unassign", () => {
  assert.equal(
    AssignUserInputSchema.parse({ task_id: 23692, agent_id: agentId }).agent_id,
    agentId
  );
  assert.equal(
    AssignUserInputSchema.parse({
      ticket_number: "HTPR-4150",
      agent_id: agentId,
      intent: "unassign",
    }).agent_id,
    agentId
  );
});

test("MCP assign schema accepts only one assignee identification method", () => {
  const result = AssignUserInputSchema.safeParse({
    task_id: 23692,
    user_id: 6,
    agent_id: agentId,
  });
  assert.equal(result.success, false);
  assert.match(
    result.error.issues[0].message,
    /Cannot provide multiple assignee identification methods/
  );
});

test("MCP assign schema lets assign_self stand beside the caller's own agent_id", () => {
  const result = AssignUserInputSchema.safeParse({
    ticket_number: "HTPR-7827",
    assign_self: true,
    agent_id: agentId,
  });
  assert.equal(result.success, true);
});

test("MCP assign schema still refuses assign_self with a user target, naming the fix", () => {
  const result = AssignUserInputSchema.safeParse({
    ticket_number: "HTPR-7827",
    assign_self: true,
    user_id: 6,
  });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /assign_self already names you/);
});

test("MCP assign schema reports one clear issue when no assignee is given", () => {
  const result = AssignUserInputSchema.safeParse({ ticket_number: "HTPR-7827" });
  assert.equal(result.success, false);
  assert.equal(result.error.issues.length, 1);
  assert.match(result.error.issues[0].message, /Name who to assign or unassign/);
});

test("MCP assignment errors name the target without a schema path", () => {
  const result = AssignUserInputSchema.safeParse({ ticket_number: "HTPR-7827" });
  assert.equal(result.success, false);
  const error = new ZodError(result.error.issues.map((issue) => ({
    ...issue,
    path: ["input", ...issue.path],
  })));
  const message = actionableToolError(error);
  assert.equal(
    message,
    "Name who to assign or unassign: provide exactly one of user_id, user_ids, agent_id, or assign_self (agent tokens only)"
  );
  assert.doesNotMatch(message, /Change input\.user_id/);
  assert.equal(
    AssignUserInputSchema.safeParse({ ticket_number: "HTPR-7827", user_id: 6 }).success,
    true
  );
  const unknownKey = AssignUserInputSchema.safeParse({
    ticket_number: "HTPR-7827",
    user_id: 6,
    unsupported: true,
  });
  assert.equal(unknownKey.success, false);
  assert.match(actionableToolError(unknownKey.error), /^Remove unsupported fields/);
});

test("MCP task service forwards agent_id to the shared assign endpoint", () => {
  const source = fs.readFileSync(
    path.join(root, "src/lib/mcp-server/lib/services/task.service.ts"),
    "utf8"
  );
  assert.match(source, /body\.agent_id = validatedInput\.agent_id/);
  assert.match(source, /['"]\/mcp\/assignees\/assign['"]/);
});

test("AI assignee resolver maps an agent name and UUID to agentIds only", () => {
  const members = [
    { id: 6, displayName: "Valentin Yeo", email: "valentin@hypertask.ai" },
    { id: agentId, displayName: "Mobile Developer" },
  ];
  assert.deepEqual(
    resolveUserIds(
      { users: [" mobile developer ", agentId.toUpperCase()] },
      6,
      members
    ),
    { userIds: [], agentIds: [agentId], failures: [] }
  );
});

test("AI assignee resolver rejects a person-agent name collision explicitly", () => {
  const result = resolveUserIds(
    { users: ["Mobile Developer"] },
    6,
    [
      { id: 42, displayName: "Mobile Developer", email: "mobile@example.com" },
      { id: agentId, displayName: "Mobile Developer" },
    ]
  );
  assert.deepEqual(result.userIds, []);
  assert.deepEqual(result.agentIds, []);
  assert.match(result.failures[0].error, /Both a project member and a board agent match/);
});

test("AI assignee resolver reports agents outside the task board clearly", () => {
  const result = resolveUserIds(
    { users: [agentId] },
    6,
    [{ id: 6, displayName: "Valentin Yeo", email: "valentin@hypertask.ai" }]
  );
  assert.deepEqual(result.agentIds, []);
  assert.match(result.failures[0].error, /on this task's board/);
});

test("AI assignment rechecks resolved agent membership on the task board", () => {
  const source = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8"
  );
  assert.match(source, /isAgentOnBoard\(task\.projectId, agentId\)/);
  assert.match(source, /\{ agent_id: agentId \}/);
});
