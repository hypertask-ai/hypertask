const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

const allTasks = read("src/app/all-tasks/AllTasks.tsx");
const taskListRow = read(
  "src/components/Common/TaskRowComponents/TaskListRow.tsx",
);

test("All Tasks owns one mobile horizontal inset around its header and rows", () => {
  assert.match(allTasks, /className="px-4 @md:px-0"/);
  assert.match(
    allTasks,
    /className="flex items-center justify-between gap-5 @md:px-\[40px\]"/,
  );
  assert.match(
    allTasks,
    /className="rounded-b-\[4px\] mt-3 px-0 @md:!px-16/,
  );
  assert.match(allTasks, /<TaskListRow[\s\S]*?flushMobilePadding/);
});

test("mobile task rows shrink and truncate inside their content box", () => {
  assert.doesNotMatch(taskListRow, /(?:max-)?w-\[[^\]]*vw\]/);
  assert.doesNotMatch(taskListRow, /xs:flex-wrap|xs:whitespace-pre-wrap/);
  assert.match(taskListRow, /className="flex min-w-0 flex-grow/);
  assert.match(taskListRow, /className="min-w-0 flex-1 flex-column/);
  assert.match(
    taskListRow,
    /className="flex min-w-0 items-center truncate justify-start gap-1/,
  );
  assert.match(
    taskListRow,
    /className="block w-full max-w-full truncate whitespace-nowrap line-clamp-1"/,
  );
});

test("task rows follow the global view container breakpoints", () => {
  assert.doesNotMatch(
    taskListRow,
    /(^|[^@\w-])(?:x-sm|xs|sm|md|lg|xl|2xl):/m,
  );
  assert.match(taskListRow, /@md:flex-row/);
  assert.match(taskListRow, /@md:hidden/);
});
