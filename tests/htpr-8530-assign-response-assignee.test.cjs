const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/htpr-8530-assign-response-assignee.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { mapTaskAssignees } = jiti(path.join(root, "src/lib/mcp/tasks/mappers.ts"));

const assignOperation = fs.readFileSync(
  path.join(root, "src/lib/mcp/operations/assignees/assign/operation.ts"),
  "utf8"
);

const reader = 6;
const projectId = 15;
const owner = { id: reader, email: "owner@example.com", displayName: "Board Owner" };
const runnerAgent = {
  id: "1a6dd89d-5fff-4c1b-9610-0a4270a7f2c7",
  userId: reader,
  visibility: "PRIVATE",
  members: [],
  displayName: "Runner 7",
};

test("an assign response names the agent it assigned, not a bare user id", () => {
  const [assignee] = mapTaskAssignees(
    [{ user: owner, agent: runnerAgent, agentAssigner: runnerAgent }],
    reader,
    projectId
  );
  assert.equal(assignee.type, "agent");
  assert.equal(assignee.displayName, "Runner 7");
  assert.equal(assignee.agentId, runnerAgent.id);
  assert.equal(assignee.agent.displayName, "Runner 7");
  assert.equal(assignee.email, "");
});

test("a person assignment keeps its id, email and name", () => {
  const [assignee] = mapTaskAssignees([{ user: owner }], reader, projectId);
  assert.equal(assignee.type, "person");
  assert.equal(assignee.id, reader);
  assert.equal(assignee.email, owner.email);
  assert.equal(assignee.displayName, "Board Owner");
  assert.equal(assignee.agentId, undefined);
});

test("an agent the reader cannot see is still left out", () => {
  const hidden = {
    id: "9d0f4d1c-0000-4000-8000-000000000000",
    userId: 999,
    visibility: "PRIVATE",
    members: [],
    displayName: "Ghost",
  };
  assert.deepEqual(mapTaskAssignees([{ user: owner, agent: hidden }], reader, projectId), []);
});

test("the assign response reads its rows through the shared assignee mapper", () => {
  assert.match(assignOperation, /mapTaskAssignee\(row, ctx\.user\.id, task\.projectId\)/);
  assert.match(assignOperation, /\.\.\.mapped, userId: row\.userId/);
  assert.match(assignOperation, /user: \{ select: \{ id: true, email: true, displayName: true \} \}/);
  assert.doesNotMatch(assignOperation, /const item: McpAssigneeResponseItem = \{ userId: row\.userId \}/);
});
