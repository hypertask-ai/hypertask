const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const helperPath = path.join(
  root,
  "src/lib/ai/hyperMentionComposition.ts",
);

function resolve(input) {
  const script = `
    import { resolveHyperMentionComposition } from ${JSON.stringify(
      pathToFileURL(helperPath).href,
    )};
    process.stdout.write(JSON.stringify(resolveHyperMentionComposition(${JSON.stringify(
      input,
    )})));
  `;
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || "strip-types import failed");
  return JSON.parse(result.stdout);
}

test("composed HyperAI targets win over live current task and project", () => {
  const result = resolve({
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
  const result = resolve({
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
  assert.equal("teamId" in result, false);
  assert.equal("teamTitle" in result, false);
  assert.equal("ownerId" in result, false);
  assert.deepEqual(result.taskIds, [1691]);
});

test("falls back to live current values when composition is missing", () => {
  const result = resolve({
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
