const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  sortByDueDateOrder,
  sortByPriorityAndRankingOrder,
  sortBySizeAndRankingOrder,
  sortByAssigneeOrder,
} = jiti(path.join(root, "src/utils/helperFunctions/helperFunctions.ts"));

// The table view used to build every comparator ascending and negate the result
// for descending, which also negated the "empty values last" branch and floated
// blanks to the top (HTPR-4629). It now passes the direction down instead, so
// these factories have to keep blanks last in BOTH directions.
const ids = (tasks, comparator) => tasks.slice().sort(comparator).map((t) => t.id);

test("due date keeps tasks with no due date last in both directions", () => {
  const tasks = [
    { id: "blank" },
    { id: "early", dueDate: "2026-01-01T00:00:00.000Z" },
    { id: "late", dueDate: "2026-09-01T00:00:00.000Z" },
  ];
  assert.deepEqual(ids(tasks, sortByDueDateOrder("Ascending")), ["early", "late", "blank"]);
  assert.deepEqual(ids(tasks, sortByDueDateOrder("Descending")), ["late", "early", "blank"]);
});

test("priority keeps tasks with no priority last in both directions", () => {
  const tasks = [
    { id: "blank", ranking: "c" },
    { id: "low", ranking: "b", priority: { priority_index: 1 } },
    { id: "high", ranking: "a", priority: { priority_index: 3 } },
  ];
  assert.equal(ids(tasks, sortByPriorityAndRankingOrder("Ascending")).at(-1), "blank");
  assert.equal(ids(tasks, sortByPriorityAndRankingOrder("Descending")).at(-1), "blank");
});

test("size keeps tasks with no estimate last in both directions", () => {
  const tasks = [
    { id: "blank", ranking: "c" },
    { id: "small", ranking: "b", estimate: { estimate_index: 1 } },
    { id: "big", ranking: "a", estimate: { estimate_index: 3 } },
  ];
  assert.equal(ids(tasks, sortBySizeAndRankingOrder("Ascending")).at(-1), "blank");
  assert.equal(ids(tasks, sortBySizeAndRankingOrder("Descending")).at(-1), "blank");
});

test("assignee keeps unassigned tasks last in both directions", () => {
  const tasks = [
    { id: "blank", assignees: [] },
    { id: "anna", assignees: [{ user: { displayName: "Anna" } }] },
    { id: "zoe", assignees: [{ user: { displayName: "Zoe" } }] },
  ];
  assert.deepEqual(ids(tasks, sortByAssigneeOrder("Ascending")), ["anna", "zoe", "blank"]);
  assert.deepEqual(ids(tasks, sortByAssigneeOrder("Descending")), ["zoe", "anna", "blank"]);
});
