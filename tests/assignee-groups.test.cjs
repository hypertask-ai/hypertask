const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/assignee-groups-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { isAgentAssigneeRow, splitAssignees } = jiti(
  path.join(root, "src/lib/assignees.ts")
);
const { preserveHiddenAssignedOptions } = jiti(
  path.join(root, "src/lib/assignees.ts")
);

const human = { id: 6, displayName: "Valentin" };
const agent = { id: "agent-1", displayName: "HT Agent" };

test("an assignee row with agentId set is an agent", () => {
  const row = { id: 1, agentId: "agent-1", agent, user: null };

  assert.equal(isAgentAssigneeRow(row), true);
  assert.deepEqual(splitAssignees([row]), {
    humanAssignees: [],
    agentAssignees: [agent],
  });
});

test("an assignee row with agentId null is a human", () => {
  const row = { id: 2, agentId: null, agent: null, user: human };

  assert.equal(isAgentAssigneeRow(row), false);
  assert.deepEqual(splitAssignees([row]), {
    humanAssignees: [human],
    agentAssignees: [],
  });
});

test("a task with only humans yields an empty agent list", () => {
  const result = splitAssignees([
    { id: 2, agentId: null, agent: null, user: human },
  ]);

  assert.deepEqual(result.agentAssignees, []);
});

test("a task with only agents yields an empty human list", () => {
  const result = splitAssignees([
    { id: 1, agentId: "agent-1", agent, user: null },
  ]);

  assert.deepEqual(result.humanAssignees, []);
});

test("an undefined assignees array does not throw", () => {
  assert.deepEqual(splitAssignees(undefined), {
    humanAssignees: [],
    agentAssignees: [],
  });
});

test("an agents-only picker preserves assigned people in its task update", () => {
  const visibleAgent = { ...agent, assigned: false };

  assert.deepEqual(
    preserveHiddenAssignedOptions([visibleAgent], [human, agent], false, true),
    [{ ...human, assigned: true }, visibleAgent],
  );
});

test("a people-only picker preserves assigned agents in its task update", () => {
  const visibleHuman = { ...human, assigned: false };

  assert.deepEqual(
    preserveHiddenAssignedOptions([visibleHuman], [human, agent], true, false),
    [{ ...agent, assigned: true }, visibleHuman],
  );
});

test("a combined picker does not duplicate its visible assignees", () => {
  const visibleOptions = [
    { ...human, assigned: true },
    { ...agent, assigned: true },
  ];

  assert.deepEqual(
    preserveHiddenAssignedOptions(visibleOptions, [human, agent], true, true),
    visibleOptions,
  );
});
