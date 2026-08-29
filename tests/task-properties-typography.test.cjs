// HTPR-5465: assignees rendered at 13px while every other property row rendered
// at the rail's 14px, so the Assignees value looked like a different font.
// The rail owns the font size; desktop property values must not re-declare one.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relative) =>
  fs.readFileSync(path.resolve(__dirname, relative), "utf8");

const containerSource = read(
  "../src/components/PageComponents/TaskDetail/MainPageComponents/TaskInfoColumnContainer.tsx",
);
const mainPageComponentsSource = read(
  "../src/components/PageComponents/TaskDetail/MainPageComponents/index.tsx",
);
const taskTimeSource = read(
  "../src/components/PageComponents/TaskDetail/TaskInfoColumn/TaskTime.tsx",
);

const TEXT_SIZE = /\btext-(micro|meta|dense|content|emphasis|subheading|heading|display|modalSmall|\[\d+px\])\b/g;

function sizesIn(source) {
  return source.match(TEXT_SIZE) ?? [];
}

function assigneeCardSource() {
  const start = mainPageComponentsSource.indexOf("export const AssigneeCard");
  const end = mainPageComponentsSource.indexOf(
    "export const TaskInfoRow",
    start,
  );
  assert.ok(start > -1 && end > start, "AssigneeCard block not found");
  return mainPageComponentsSource.slice(start, end);
}

test("the properties rail declares exactly one font size", () => {
  const sizes = new Set(sizesIn(containerSource));
  assert.deepEqual(
    [...sizes],
    ["text-content"],
    "the rail must set one size (14px) so every property row matches",
  );
});

test("the desktop assignee card inherits the rail font size", () => {
  const block = assigneeCardSource();

  // The mobile chip keeps its own 12px scale; nothing else may set a size.
  const sizes = sizesIn(block).filter((size) => size !== "text-meta");
  assert.deepEqual(
    sizes,
    [],
    "assignee names must not override the rail font size on desktop",
  );
});

test("the Time property value inherits the rail font size", () => {
  const start = taskTimeSource.indexOf("<TaskInfoValue");
  const end = taskTimeSource.indexOf("</TaskInfoValue>", start);
  assert.ok(start > -1 && end > start, "Time value block not found");

  assert.deepEqual(
    sizesIn(taskTimeSource.slice(start, end)),
    [],
    "the Time value must not override the rail font size",
  );
});
