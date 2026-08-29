const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/board-menu-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { assigneeIntentForOption, toAssigneeRows } = jiti(
  path.join(root, "src/hooks/Task Detail/useAssignTaskUser.ts")
);

// The assign menu paints a toggle before the server answers, so it has to hand
// the task the same row shape /api/assignees/assign returns. Every consumer
// (task detail, board card, Ctrl+K) reads `row.agent ?? row.user`; a row that
// carries neither renders a blank avatar instead of the person.
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

// Removing the last assignee must produce an empty list rather than nothing:
// the consumers only repaint on an actual array, so anything else leaves the
// removed person on screen until a reload.
test("unassigning everyone yields an empty list", () => {
  const rows = toAssigneeRows(
    [{ id: 6, displayName: "Valentin", assigned: false }],
    99
  );

  assert.deepEqual(rows, []);
});
