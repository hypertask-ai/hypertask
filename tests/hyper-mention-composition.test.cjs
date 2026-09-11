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
  const teamId = useComposed ? input.composedForTeamId : input.currentTeamId;
  const teamTitle = useComposed
    ? input.composedForTeamTitle
    : input.currentTeamTitle;
  const related = useComposed
    ? input.composedRelatedTaskIds ?? []
    : input.currentRelatedTaskIds ?? [];
  return {
    taskId,
    ownerId,
    projectId,
    teamId,
    teamTitle,
    taskIds: [taskId, ...related].filter(
      (id) => typeof id === "number" && Number.isFinite(id),
    ),
  };
}

test("composed HyperAI targets win over live current task and project", () => {
  const result = resolveHyperMentionComposition({
    composedForTaskId: 1691,
    composedForOwnerId: 4,
    composedForProjectId: 339,
    composedForTeamId: "team-inne",
    composedForTeamTitle: "inne",
    composedRelatedTaskIds: [100, 200],
    currentTaskId: 9999,
    currentOwnerId: 1,
    currentProjectId: 15,
    currentTeamId: "team-other",
    currentTeamTitle: "other",
    currentRelatedTaskIds: [888],
  });

  assert.deepEqual(result, {
    taskId: 1691,
    ownerId: 4,
    projectId: 339,
    teamId: "team-inne",
    teamTitle: "inne",
    taskIds: [1691, 100, 200],
  });
});

test("composed snapshot does not mix in live project when team fields are missing", () => {
  const result = resolveHyperMentionComposition({
    composedForTaskId: 1691,
    composedForProjectId: 339,
    currentTaskId: 9999,
    currentProjectId: 15,
    currentTeamId: "team-other",
    currentTeamTitle: "other",
    currentRelatedTaskIds: [888],
  });

  assert.equal(result.taskId, 1691);
  assert.equal(result.projectId, 339);
  assert.equal(result.teamId, undefined);
  assert.equal(result.teamTitle, undefined);
  assert.equal(result.ownerId, undefined);
  assert.deepEqual(result.taskIds, [1691]);
});

test("falls back to live current values when composition is missing", () => {
  const result = resolveHyperMentionComposition({
    currentTaskId: 55,
    currentOwnerId: 6,
    currentProjectId: 15,
    currentTeamId: "team-ht",
    currentTeamTitle: "Hypertask",
    currentRelatedTaskIds: [10, 20],
  });

  assert.deepEqual(result, {
    taskId: 55,
    ownerId: 6,
    projectId: 15,
    teamId: "team-ht",
    teamTitle: "Hypertask",
    taskIds: [55, 10, 20],
  });
});

test("source helper stays all-or-nothing on composedForTaskId", () => {
  const source = fs.readFileSync(
    path.join(root, "src/lib/ai/hyperMentionComposition.ts"),
    "utf8",
  );
  assert.match(source, /const useComposed = input\.composedForTaskId != null/);
  assert.match(source, /useComposed \? input\.composedRelatedTaskIds/);
  assert.match(source, /: input\.currentRelatedTaskIds/);
});
