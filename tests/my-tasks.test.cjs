const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/my-tasks-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { getMyTasksSplitIndex, groupMyTasksByBoard } = jiti(
  path.join(root, "src/lib/myTasksGrouping.ts")
);

const NOW = new Date("2026-08-05T12:00:00.000Z");
const task = (id, projectId, projectTitle, dueDate) => ({
  id,
  projectId,
  project: { id: projectId, title: projectTitle },
  dueDate,
});

test("creates one section per board and matching tabs", () => {
  const { sections, tabs } = groupMyTasksByBoard(
    [
      task(1, 10, "Product", "2026-08-06T09:00:00.000Z"),
      task(2, 10, "Product", null),
      task(3, 20, "Marketing", "2026-08-07T09:00:00.000Z"),
    ],
    NOW
  );

  assert.equal(sections.length, 2);
  assert.deepEqual(
    sections.map((section) => section.items.map((item) => item.id)),
    [[1, 2], [3]]
  );
  assert.deepEqual(tabs, ["All", "Product", "Marketing"]);
});

test("maps board ids to stable split indexes and falls back to All", () => {
  const { sections } = groupMyTasksByBoard(
    [
      task(1, 10, "Product", "2026-08-06T09:00:00.000Z"),
      task(2, 20, "Marketing", "2026-08-07T09:00:00.000Z"),
    ],
    NOW
  );

  sections.forEach((section, index) => {
    assert.equal(getMyTasksSplitIndex(sections, String(section.projectId)), index + 1);
  });
  assert.equal(getMyTasksSplitIndex(sections, null), 0);
  assert.equal(getMyTasksSplitIndex(sections, ""), 0);
  assert.equal(getMyTasksSplitIndex(sections, "999"), 0);
});

test("puts boards with overdue work first", () => {
  const { sections } = groupMyTasksByBoard(
    [
      task(1, 10, "Upcoming", "2026-08-06T09:00:00.000Z"),
      task(2, 20, "Overdue", "2026-08-04T09:00:00.000Z"),
    ],
    NOW
  );

  assert.deepEqual(
    sections.map((section) => section.section_title),
    ["Overdue", "Upcoming"]
  );
});

test("sorts overdue first, then due dates ascending, with no due date last", () => {
  const { sections } = groupMyTasksByBoard(
    [
      task(1, 10, "Product", null),
      task(2, 10, "Product", "2026-08-08T09:00:00.000Z"),
      task(3, 10, "Product", "2026-08-04T09:00:00.000Z"),
      task(4, 10, "Product", "2026-08-01T09:00:00.000Z"),
      task(5, 10, "Product", "2026-08-06T09:00:00.000Z"),
    ],
    NOW
  );

  assert.deepEqual(
    sections[0].items.map((item) => item.id),
    [4, 3, 5, 2, 1]
  );
});
