import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMyTasksView,
  type MyTasksTask,
} from "../src/lib/myTasksFiltering";
import {
  DEFAULT_MY_TASKS_VIEW_CONFIG,
  parseMyTasksViewConfig,
  type MyTasksViewConfig,
} from "../src/models/MyTasksView";

const NOW = new Date("2026-09-14T12:00:00.000Z");

const task = (
  id: number,
  overrides: Partial<MyTasksTask> = {},
): MyTasksTask =>
  ({
    id,
    title: `Task ${id}`,
    section: "Doing",
    sectionId: 11,
    uniqueIndex: id,
    projectId: 1,
    project: { id: 1, title: "Product" },
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-10T10:00:00.000Z",
    permanentlyDeleteAt: new Date("2099-01-01T00:00:00.000Z"),
    subTasks: [],
    myTasksSection: { id: 11, isDone: false },
    ...overrides,
  }) as MyTasksTask;

const config = (
  overrides: Partial<MyTasksViewConfig> = {},
): MyTasksViewConfig => ({
  ...DEFAULT_MY_TASKS_VIEW_CONFIG,
  ...overrides,
  filters: {
    ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters,
    ...overrides.filters,
  },
  sort: {
    ...DEFAULT_MY_TASKS_VIEW_CONFIG.sort,
    ...overrides.sort,
  },
});

test("parseMyTasksViewConfig fills defaults and rejects malformed JSON", () => {
  assert.deepEqual(parseMyTasksViewConfig(null), DEFAULT_MY_TASKS_VIEW_CONFIG);
  assert.deepEqual(parseMyTasksViewConfig({ filters: "bad", sort: [] }), DEFAULT_MY_TASKS_VIEW_CONFIG);

  const parsed = parseMyTasksViewConfig({
    boardIds: [2, 2, -1, "3"],
    filters: {
      priorityIds: [0, 2, 2, -1],
      labelIds: ["label-a", "label-a", 7, null],
      estimateIds: [3, 5],
      starred: false,
      dueDate: "today",
      createdRange: { from: "not-a-date", to: "2026-09-14" },
      showDone: true,
    },
    sort: { field: "title", direction: "desc" },
  });

  assert.deepEqual(parsed.boardIds, [2]);
  assert.deepEqual(parsed.filters.priorityIds, [0, 2]);
  assert.deepEqual(parsed.filters.labelIds, ["label-a", 7]);
  assert.deepEqual(parsed.filters.sizeIds, [3, 5]);
  assert.equal(parsed.filters.starred, false);
  assert.equal(parsed.filters.dueDate, "today");
  assert.equal(parsed.filters.createdRange, null);
  assert.equal(parsed.filters.showDone, true);
  assert.deepEqual(parsed.sort, { field: "title", direction: "desc" });
});

test("the default view hides tasks in done columns", () => {
  const tasks = [
    task(1),
    task(2, { myTasksSection: { id: 12, isDone: true } }),
    task(3, { myTasksSection: { id: 13, isDone: null } }),
  ];

  assert.deepEqual(
    applyMyTasksView(tasks, config(), NOW).map(({ id }) => id),
    [1, 3],
  );
  assert.deepEqual(
    applyMyTasksView(tasks, config({ filters: { showDone: true } } as Partial<MyTasksViewConfig>), NOW).map(({ id }) => id),
    [1, 2, 3],
  );
});

test("filters boards, columns, priority, labels, size and starred together", () => {
  const matching = task(1, {
    priority: { priority_index: 2 } as MyTasksTask["priority"],
    estimate: { estimate_index: 3 } as MyTasksTask["estimate"],
    taskLabels: [{ label: { id: "label-a" } }] as MyTasksTask["taskLabels"],
    savedContent: [{ id: 1 }] as unknown as MyTasksTask["savedContent"],
  });
  const wrongBoard = task(2, { projectId: 2 });
  const wrongPriority = task(3, {
    priority: { priority_index: 4 } as MyTasksTask["priority"],
  });

  const filtered = applyMyTasksView(
    [matching, wrongBoard, wrongPriority],
    config({
      boardIds: [1],
      filters: {
        priorityIds: [2],
        labelIds: ["label-a"],
        sizeIds: [3],
        sectionIds: [11],
        starred: true,
      },
    } as Partial<MyTasksViewConfig>),
    NOW,
  );

  assert.deepEqual(filtered.map(({ id }) => id), [matching.id]);
});

test("supports due-date presets and inclusive date ranges", () => {
  const tasks = [
    task(1, { dueDate: new Date("2026-09-13T20:00:00.000Z") }),
    task(2, { dueDate: new Date("2026-09-14T18:00:00.000Z") }),
    task(3, { dueDate: new Date("2026-09-20T09:00:00.000Z") }),
    task(4, { dueDate: undefined }),
  ];

  assert.deepEqual(
    applyMyTasksView(tasks, config({ filters: { dueDate: "overdue" } } as Partial<MyTasksViewConfig>), NOW).map(({ id }) => id),
    [1],
  );
  assert.deepEqual(
    applyMyTasksView(tasks, config({ filters: { dueDate: "today" } } as Partial<MyTasksViewConfig>), NOW).map(({ id }) => id),
    [2],
  );
  assert.deepEqual(
    applyMyTasksView(tasks, config({ filters: { dueDate: "no_due_date" } } as Partial<MyTasksViewConfig>), NOW).map(({ id }) => id),
    [4],
  );
  assert.deepEqual(
    applyMyTasksView(
      tasks,
      config({
        filters: {
          dueDate: { from: "2026-09-14", to: "2026-09-20" },
        },
      } as Partial<MyTasksViewConfig>),
      NOW,
    ).map(({ id }) => id),
    [2, 3],
  );
});

test("default due-date sorting keeps overdue first and missing dates last", () => {
  const tasks = [
    task(1, { dueDate: undefined }),
    task(2, { dueDate: new Date("2026-09-16T10:00:00.000Z") }),
    task(3, { dueDate: new Date("2026-09-12T10:00:00.000Z") }),
    task(4, { dueDate: new Date("2026-09-10T10:00:00.000Z") }),
  ];

  assert.deepEqual(
    applyMyTasksView(tasks, config(), NOW).map(({ id }) => id),
    [4, 3, 2, 1],
  );
});

test("sorts by title and does not mutate the source array", () => {
  const tasks = [task(1, { title: "Alpha" }), task(2, { title: "Zulu" })];
  const sorted = applyMyTasksView(
    tasks,
    config({ sort: { field: "title", direction: "desc" } }),
    NOW,
  );

  assert.deepEqual(sorted.map(({ id }) => id), [2, 1]);
  assert.deepEqual(tasks.map(({ id }) => id), [1, 2]);
});

test("priority sorting matches the existing My Tasks ascending semantics", () => {
  const tasks = [
    task(1, { priority: { priority_index: 1 } as MyTasksTask["priority"] }),
    task(2, { priority: { priority_index: 4 } as MyTasksTask["priority"] }),
    task(3),
  ];

  assert.deepEqual(
    applyMyTasksView(
      tasks,
      config({ sort: { field: "priority", direction: "asc" } }),
      NOW,
    ).map(({ id }) => id),
    [2, 1, 3],
  );
  assert.deepEqual(
    applyMyTasksView(
      tasks,
      config({ sort: { field: "priority", direction: "desc" } }),
      NOW,
    ).map(({ id }) => id),
    [1, 2, 3],
  );
});
