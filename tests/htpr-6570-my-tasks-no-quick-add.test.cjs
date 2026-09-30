// HTPR-6570: My Tasks must not show a permanent "Quick add a task" row.
// Creating a task stays on the existing board pattern.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("My Tasks does not mount the Quick add a task row", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/app/my-tasks/MyTasks.tsx"),
    "utf8",
  );
  assert.equal(
    source.includes("MyTasksQuickAdd"),
    false,
    "the Quick add row must not be mounted on My Tasks",
  );
  assert.equal(
    source.includes("MY_TASKS_QUICK_ADD_FLAG"),
    false,
    "the quick-add flag must not turn the row back on",
  );
});
