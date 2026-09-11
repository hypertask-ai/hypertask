const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

// Keep this in sync with src/lib/ai/hyperMentionComposition.ts (CI runs Node 20).
function resolveHyperMentionComposition(input) {
  const useComposed = input.composedForTaskId != null;
  const taskId = useComposed ? input.composedForTaskId : input.currentTaskId;
  const ownerId = useComposed
    ? input.composedForOwnerId
    : input.currentOwnerId;
  const projectId = useComposed
    ? input.composedForProjectId
    : input.currentProjectId;
  return {
    taskId,
    ownerId,
    projectId,
    taskIds: [taskId].filter(
      (id) => typeof id === "number" && Number.isFinite(id),
    ),
  };
}

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

test("source helper stays all-or-nothing on composedForTaskId", () => {
  const source = fs.readFileSync(
    path.join(root, "src/lib/ai/hyperMentionComposition.ts"),
    "utf8",
  );
  assert.match(source, /const useComposed = input\.composedForTaskId != null/);
  assert.match(source, /composedForProjectId/);
  assert.doesNotMatch(source, /composedRelatedTaskIds/);
});
