const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const { resolveHyperMentionComposition } = load("src/lib/ai/hyperMentionComposition.ts");

test("composed HyperAI targets win over live current task and project", () => {
  const result = resolveHyperMentionComposition({
    composedForTaskId: 1691,
    composedForOwnerId: 4,
    composedForProjectId: 339,
    currentTaskId: 9999,
    currentOwnerId: 1,
    currentProjectId: 15,
  });

  assert.deepEqual(result, {
    taskId: 1691,
    ownerId: 4,
    projectId: 339,
    taskIds: [1691],
  });
});

test("composed snapshot does not mix in live project when owner is missing", () => {
  const result = resolveHyperMentionComposition({
    composedForTaskId: 1691,
    composedForProjectId: 339,
    currentTaskId: 9999,
    currentProjectId: 15,
    currentOwnerId: 1,
  });

  assert.equal(result.taskId, 1691);
  assert.equal(result.projectId, 339);
  assert.equal(result.ownerId, undefined);
  assert.deepEqual(result.taskIds, [1691]);
});

test("falls back to live current values when composition is missing", () => {
  const result = resolveHyperMentionComposition({
    currentTaskId: 55,
    currentOwnerId: 6,
    currentProjectId: 15,
  });

  assert.deepEqual(result, {
    taskId: 55,
    ownerId: 6,
    projectId: 15,
    taskIds: [55],
  });
});
