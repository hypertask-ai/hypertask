import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMyTasksTimeBucket,
  countMyTasksOverdue,
  countMyTasksOverdueByBoard,
  groupMyTasksByTime,
} from "../src/lib/myTasksGrouping";
import {
  effectiveMyTasksGroupBy,
  parseMyTasksViewConfig,
} from "../src/models/MyTasksView";

// Monday 14 Sep 2026, midday local — week is Mon–Sun.
const NOW = new Date(2026, 8, 14, 12, 0, 0);

test("effectiveMyTasksGroupBy stays on board when the flag is off", () => {
  assert.equal(effectiveMyTasksGroupBy({}, false), "board");
  assert.equal(effectiveMyTasksGroupBy({ groupBy: "time" }, false), "board");
});

test("effectiveMyTasksGroupBy defaults to time when the flag is on and groupBy is missing", () => {
  assert.equal(effectiveMyTasksGroupBy({}, true), "time");
  assert.equal(effectiveMyTasksGroupBy({ groupBy: "board" }, true), "board");
  assert.equal(effectiveMyTasksGroupBy({ groupBy: "time" }, true), "time");
});

test("parseMyTasksViewConfig preserves groupBy and drops invalid values", () => {
  assert.equal(parseMyTasksViewConfig({}).groupBy, undefined);
  assert.equal(parseMyTasksViewConfig({ groupBy: "time" }).groupBy, "time");
  assert.equal(parseMyTasksViewConfig({ groupBy: "board" }).groupBy, "board");
  assert.equal(parseMyTasksViewConfig({ groupBy: "priority" }).groupBy, undefined);

  const roundTrip = parseMyTasksViewConfig(
    parseMyTasksViewConfig({
      groupBy: "board",
      filters: { showDone: true },
      sort: { field: "title", direction: "desc" },
    }),
  );
  assert.equal(roundTrip.groupBy, "board");
  assert.equal(roundTrip.filters.showDone, true);
  assert.deepEqual(roundTrip.sort, { field: "title", direction: "desc" });
});

test("classifyMyTasksTimeBucket matches due-date filter day boundaries", () => {
  assert.equal(classifyMyTasksTimeBucket(null, NOW), "No due date");
  assert.equal(classifyMyTasksTimeBucket("not-a-date", NOW), "No due date");
  assert.equal(
    classifyMyTasksTimeBucket(new Date(2026, 8, 13, 23, 59, 0), NOW),
    "Overdue",
  );
  assert.equal(
    classifyMyTasksTimeBucket(new Date(2026, 8, 14, 8, 0, 0), NOW),
    "Today",
  );
  assert.equal(
    classifyMyTasksTimeBucket(new Date(2026, 8, 16, 10, 0, 0), NOW),
    "This week",
  );
  assert.equal(
    classifyMyTasksTimeBucket(new Date(2026, 8, 21, 9, 0, 0), NOW),
    "Later",
  );
});

test("groupMyTasksByTime keeps fixed bucket order and omits empty buckets", () => {
  const grouped = groupMyTasksByTime(
    [
      { id: 1, projectId: 10, dueDate: new Date(2026, 8, 13, 9, 0, 0) },
      { id: 2, projectId: 11, dueDate: new Date(2026, 8, 14, 15, 0, 0) },
      { id: 3, projectId: 10, dueDate: new Date(2026, 8, 17, 12, 0, 0) },
      { id: 4, projectId: 12, dueDate: new Date(2026, 8, 30, 12, 0, 0) },
      { id: 5, projectId: 11, dueDate: null },
    ],
    NOW,
  );

  assert.deepEqual(
    grouped.sections.map((section) => section.section_title),
    ["Overdue", "Today", "This week", "Later", "No due date"],
  );
  assert.deepEqual(
    grouped.sections.map((section) => section.items.map((task) => task.id)),
    [[1], [2], [3], [4], [5]],
  );
});

test("groupMyTasksByTime keeps board ids on tasks for split-tab filtering", () => {
  const grouped = groupMyTasksByTime(
    [
      {
        id: 1,
        projectId: 10,
        dueDate: new Date(2026, 8, 14, 15, 0, 0),
        project: { id: 10, title: "Alpha" },
      },
      {
        id: 2,
        projectId: 11,
        dueDate: new Date(2026, 8, 14, 16, 0, 0),
        project: { id: 11, title: "Beta" },
      },
    ],
    NOW,
  );

  const today = grouped.sections.find(
    (section) => section.section_title === "Today",
  );
  assert.ok(today);
  const boardScoped = today!.items.filter(
    (task) => (task.project?.id ?? task.projectId) === 11,
  );
  assert.deepEqual(
    boardScoped.map((task) => task.id),
    [2],
  );
});

test("countMyTasksOverdue hides zero and uses start-of-today, not now", () => {
  assert.equal(countMyTasksOverdue([], NOW), 0);
  assert.equal(
    countMyTasksOverdue(
      [
        { dueDate: new Date(2026, 8, 13, 23, 59, 0) },
        { dueDate: new Date(2026, 8, 14, 8, 0, 0) },
        { dueDate: null },
      ],
      NOW,
    ),
    1,
  );
});

test("countMyTasksOverdueByBoard respects board and hides empty boards", () => {
  const { total, byBoardId } = countMyTasksOverdueByBoard(
    [
      { id: 1, projectId: 10, dueDate: new Date(2026, 8, 13, 9, 0, 0) },
      { id: 2, projectId: 10, dueDate: new Date(2026, 8, 14, 9, 0, 0) },
      { id: 3, projectId: 11, dueDate: new Date(2026, 8, 12, 9, 0, 0) },
      { id: 4, projectId: 12, dueDate: new Date(2026, 8, 15, 9, 0, 0) },
    ],
    NOW,
  );
  assert.equal(total, 2);
  assert.equal(byBoardId.get(10), 1);
  assert.equal(byBoardId.get(11), 1);
  assert.equal(byBoardId.has(12), false);
});
