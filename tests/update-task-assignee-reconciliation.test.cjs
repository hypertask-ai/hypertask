const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src/lib/mcp/tasks/updateTask.ts",
  ),
  "utf8",
);

test("task update unassigns human users omitted from the requested assignee list", () => {
  assert.match(
    source,
    /const userIdsToUnassign = \[\.\.\.currentUserIds\]\.filter\([\s\S]*?!requestedUserIds\.has\(userId\)[\s\S]*?\);/,
  );
  assert.match(
    source,
    /await updateAssignees\(userIdsToUnassign, 'unassign'\);/,
  );
  assert.match(
    source,
    /await updateAssignees\(userIdsToAssign, 'assign'\);/,
  );
});

test("task update excludes agent assignee rows from reconciliation", () => {
  assert.match(
    source,
    /prisma\.assignees\.findMany\(\{[\s\S]*?where: \{ taskId: task\.id, agentId: null \},[\s\S]*?select: \{ userId: true \},[\s\S]*?\}\);/,
  );
  assert.doesNotMatch(source, /prisma\.assignees\.(?:delete|deleteMany)\(/);
});
