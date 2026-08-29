const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const jiti = require("jiti")(__filename, { interopDefault: true });

const root = path.resolve(__dirname, "..");
const { agentPoolScope } = jiti(
  path.join(root, "src/lib/agents/poolScope.ts"),
);

const sourceSections = [
  { boardId: 15, section: "Bugs" },
  { boardId: 15, section: "Improvements" },
];

test("a label-scoped pool counts only labelled, unowned intake work", () => {
  const scope = agentPoolScope({
    agentId: "agent-speed",
    boardIds: [15],
    sourceSections,
    scopeLabel: "SPEED OPTIMIZATION",
  });

  assert.deepEqual(scope.sourceScopeWhere.taskLabels, {
    some: { label: { value: "SPEED OPTIMIZATION" } },
  });
  assert.deepEqual(scope.sourceScopeWhere.OR, [
    { projectId: 15, section: "Bugs" },
    { projectId: 15, section: "Improvements" },
  ]);
  // Tickets another agent already owns are not this agent's to pick up.
  assert.deepEqual(scope.eligiblePoolWhere.AND[1], {
    assignees: { none: { agentId: { not: null, notIn: ["agent-speed"] } } },
  });
  assert.deepEqual(scope.eligiblePoolWhere.AND[0], scope.sourceScopeWhere);
});

test("an unlabelled agent keeps its intake columns without a label filter", () => {
  const scope = agentPoolScope({
    agentId: "agent-bugs",
    boardIds: [15],
    sourceSections,
    scopeLabel: null,
  });

  assert.equal(scope.sourceScopeWhere.taskLabels, undefined);
  assert.equal(scope.sourceScopeWhere.status, "Normal");
});

test("explicit assignments ignore label and column scope", () => {
  const scope = agentPoolScope({
    agentId: "agent-speed",
    boardIds: [15, 16],
    sourceSections,
    scopeLabel: "SPEED OPTIMIZATION",
  });

  const [boards, assignment] = scope.assignedWhere.AND;
  assert.deepEqual(boards, {
    projectId: { in: [15, 16] },
    status: "Normal",
    archivedAt: null,
    deletedAt: null,
  });
  assert.equal(boards.taskLabels, undefined);
  assert.equal(boards.OR, undefined);
  assert.deepEqual(assignment, {
    assignees: { some: { agentId: "agent-speed" } },
  });
});

test("an agent with no boards still produces an empty, safe scope", () => {
  const scope = agentPoolScope({
    agentId: "agent-speed",
    boardIds: [],
    sourceSections: [],
    scopeLabel: null,
  });

  assert.deepEqual(scope.sourceScopeWhere.projectId, { in: [] });
  assert.equal(scope.sourceScopeWhere.OR, undefined);
});
