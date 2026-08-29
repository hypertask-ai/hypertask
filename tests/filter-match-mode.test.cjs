const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyFilters,
  assigneeFilterCondition,
  labelFilterCondition,
} = require("./filter-match-mode-entry.cjs");

const labels = [{ id: "bug" }, { id: "annoying" }];
const taskWithLabels = (...ids) => ({
  taskLabels: ids.map((id) => ({ label: { id } })),
});

test("two tags use ANY by default and require both under ALL", () => {
  const oneTag = taskWithLabels("bug");

  assert.equal(labelFilterCondition(oneTag, labels, undefined, "ANY"), true);
  assert.equal(labelFilterCondition(oneTag, labels, undefined, "ALL"), false);
});

test("two tags under ALL match a task carrying both", () => {
  assert.equal(
    labelFilterCondition(taskWithLabels("bug", "annoying"), labels, undefined, "ALL"),
    true
  );
});

test("an absent match mode behaves like ANY", () => {
  const oneTag = taskWithLabels("bug");

  assert.equal(
    labelFilterCondition(oneTag, labels),
    labelFilterCondition(oneTag, labels, undefined, "ANY")
  );
});

test("an empty payload matches under both modes", () => {
  const task = taskWithLabels();

  assert.equal(labelFilterCondition(task, [], undefined, "ANY"), true);
  assert.equal(labelFilterCondition(task, [], undefined, "ALL"), true);
});

test("assignee ALL keeps user and agent matching separate", () => {
  const user = { id: 7, uid: "user-7" };
  const agent = { id: "agent-1" };
  const selected = [user, agent];
  const onlyUser = { assignees: [{ userId: 7, agentId: null }] };
  const both = {
    assignees: [
      { userId: 7, agentId: null },
      { userId: null, agentId: "agent-1" },
    ],
  };

  assert.equal(assigneeFilterCondition(onlyUser, selected, undefined, "ALL"), false);
  assert.equal(assigneeFilterCondition(both, selected, undefined, "ALL"), true);
});

test("applyFilters passes match through when the condition is missing", () => {
  const sections = [{
    items: [
      { id: "one", ...taskWithLabels("bug") },
      { id: "both", ...taskWithLabels("bug", "annoying") },
    ],
  }];
  const filters = [{
    type: "Labels",
    searchPayload: labels,
    match: "ALL",
  }];

  for (const overallMode of ["ALL", "ANY"]) {
    assert.deepEqual(
      applyFilters(sections, filters, overallMode)[0].items.map(({ id }) => id),
      ["both"]
    );
  }
});

test("assignee ALL does not let one agent row satisfy both its owner and itself", () => {
  const owner = { id: 6, uid: "user-6" };
  const agent = { id: "agent-a" };
  // An agent assignment stores the agent AND its owner's userId on the same row.
  const onlyTheAgent = { assignees: [{ userId: 6, agentId: "agent-a" }] };
  const bothSeparately = {
    assignees: [
      { userId: 6, agentId: null },
      { userId: 6, agentId: "agent-a" },
    ],
  };

  assert.equal(assigneeFilterCondition(onlyTheAgent, [owner, agent], undefined, "ALL"), false);
  assert.equal(assigneeFilterCondition(bothSeparately, [owner, agent], undefined, "ALL"), true);
  // ANY is unchanged: the shared row still counts for either selection.
  assert.equal(assigneeFilterCondition(onlyTheAgent, [owner, agent], undefined, "ANY"), true);
});

test("only tags and assignees offer the ALL mode", () => {
  const { supportsMatchMode } = require("./filter-match-mode-entry.cjs");
  assert.equal(supportsMatchMode("Labels"), true);
  assert.equal(supportsMatchMode("Assignees"), true);
  // A task has one priority and one creating agent, so ALL there is always empty.
  assert.equal(supportsMatchMode("Priority"), false);
  assert.equal(supportsMatchMode("UpdatedBy"), false);
});

test("assignee ALL is independent of assignee order", () => {
  const owner = { id: 6, uid: "user-6" };
  const agent = { id: "agent-a" };
  // The agent row carries the owner's userId, so a greedy row-claiming match would answer
  // differently depending on which row Prisma returned first.
  const agentRowFirst = {
    assignees: [
      { userId: 6, agentId: "agent-a" },
      { userId: 6, agentId: null },
    ],
  };
  const userRowFirst = {
    assignees: [
      { userId: 6, agentId: null },
      { userId: 6, agentId: "agent-a" },
    ],
  };

  for (const task of [agentRowFirst, userRowFirst]) {
    assert.equal(assigneeFilterCondition(task, [owner, agent], undefined, "ALL"), true);
    assert.equal(assigneeFilterCondition(task, [agent, owner], undefined, "ALL"), true);
  }
});
