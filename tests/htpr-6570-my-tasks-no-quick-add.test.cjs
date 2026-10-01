// HTPR-6570: removing Quick add is behind a flag that defaults to Owner + QA.
// The older quick-add flag still decides the row when the removal flag is off.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("Quick add removal is flagged and the old gate stays", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/app/my-tasks/MyTasks.tsx"),
    "utf8",
  );
  const keys = fs.readFileSync(
    path.join(__dirname, "../src/lib/flags/keys.ts"),
    "utf8",
  );
  assert.match(keys, /htpr-6570-remove-quick-add/);
  assert.match(source, /HTPR_6570_REMOVE_QUICK_ADD_FLAG/);
  assert.match(source, /MY_TASKS_QUICK_ADD_FLAG/);
  assert.match(source, /myTasksQuickAddEnabled && !removeQuickAdd/);
});
