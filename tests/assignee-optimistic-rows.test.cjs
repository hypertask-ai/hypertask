const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");
const { assigneeIntentForOption, toAssigneeRows } = load(
  "src/hooks/Task Detail/useAssignTaskUser.ts",
  { "@/hooks/useFlag": {}, "@/lib/api/typedClient": {}, "@/lib/constants": {} },
);

test("assigned people become rows the task panel can read", () => {
  const rows = toAssigneeRows(
    [
      { id: 6, displayName: "Valentin", assigned: true },
      { id: 12, displayName: "Not assigned", assigned: false },
    ],
    99
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].taskId, 99);
  assert.equal(rows[0].agentId, null);
  assert.equal(rows[0].agent, null);
  assert.equal(rows[0].user.displayName, "Valentin");
});

test("agents land on the agent field, not the user field", () => {
  const rows = toAssigneeRows(
    [{ id: "agent-uuid", userId: 4, displayName: "HT Agent", assigned: true }],
    99
  );

  assert.equal(rows[0].agentId, "agent-uuid");
  assert.equal(rows[0].user, null);
  assert.equal(rows[0].agent.displayName, "HT Agent");
});

test("picker sends the intended assignment state instead of a server toggle", () => {
  const agent = { id: "agent-uuid", userId: 4, displayName: "HT Agent" };

  assert.equal(assigneeIntentForOption({ ...agent, assigned: false }), "assign");
  assert.equal(assigneeIntentForOption({ ...agent, assigned: true }), "unassign");
});

test("unassigning everyone yields an empty list", () => {
  const rows = toAssigneeRows(
    [{ id: 6, displayName: "Valentin", assigned: false }],
    99
  );

  assert.deepEqual(rows, []);
});
