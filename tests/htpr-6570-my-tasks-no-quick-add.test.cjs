// HTPR-6570: My Tasks has no Quick add row. Tasks are added the board way only.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("My Tasks does not render a Quick add row", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/app/my-tasks/MyTasks.tsx"),
    "utf8",
  );
  assert.doesNotMatch(source, /MyTasksQuickAdd/);
  assert.doesNotMatch(source, /MY_TASKS_QUICK_ADD_FLAG/);
});
