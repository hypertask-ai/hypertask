const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

test("every assignment activity snapshot preserves the user profile photo", () => {
  const activitySource = read(
    "src/utils/controllers/activities/createAssignedActivity.ts"
  );
  const assignmentSource = read(
    "src/utils/controllers/assignees/assign.ts"
  );
  const globalCreateSource = read("src/pages/api/tasks/createGlobally.ts");
  const taskDetailLoadSource = read(
    "src/utils/controllers/taskDetail/load.ts"
  );

  assert.match(
    activitySource,
    /export const assignmentActivityUserSelect = \{[\s\S]*photoURL: true,[\s\S]*\} satisfies Prisma\.UserSelect;/
  );
  assert.equal(
    (assignmentSource.match(/select: assignmentActivityUserSelect/g) || [])
      .length,
    3
  );
  assert.equal(
    (globalCreateSource.match(/select: assignmentActivityUserSelect/g) || [])
      .length,
    1
  );
  assert.match(
    taskDetailLoadSource,
    /const assignmentActivityWithCurrentAvatars = Prisma\.sql`[\s\S]*fromUser,user,photoURL[\s\S]*toUser,user,photoURL[\s\S]*`;/
  );
  assert.equal(
    (
      taskDetailLoadSource.match(
        /\$\{assignmentActivityWithCurrentAvatars\} AS activity/g
      ) || []
    ).length,
    2
  );
  assert.equal(
    (taskDetailLoadSource.match(/LEFT JOIN "User" activity_(?:from|to)_user/g) || [])
      .length,
    4
  );
});
