import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMyTasksView,
  overdueCountForMyTasksView,
  type MyTasksTask,
} from "../src/lib/myTasksFiltering";
import type { ISection } from "../src/models/model";
import {
  migrateFlatFiltersToFilterSettings,
  myTasksParityFilterCount,
} from "../src/lib/filterSettingsMutations";
import { PriorityConstants } from "../src/lib/constants/constants";
import {
  DEFAULT_MY_TASKS_VIEW_CONFIG,
  parseMyTasksViewConfig,
  type MyTasksViewConfig,
} from "../src/models/MyTasksView";

const NOW = new Date("2026-09-14T12:00:00.000Z");

const task = (
  id: number,
  overrides: Record<string, unknown> = {},
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
  }) as unknown as MyTasksTask;

const config = (
  overrides: Partial<MyTasksViewConfig> = {},
): MyTasksViewConfig => ({
  ...DEFAULT_MY_TASKS_VIEW_CONFIG,
  ...overrides,
  filters: {
    ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters,
    ...overrides.filters,
  },
  filterSettings:
    overrides.filterSettings === undefined
      ? DEFAULT_MY_TASKS_VIEW_CONFIG.filterSettings
      : overrides.filterSettings,
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

test("column filtering uses the resolved My Tasks section for legacy tasks", () => {
  const legacyTask = task(1, {
    sectionId: null as unknown as number,
    section: "Doing",
    myTasksSection: { id: 11, isDone: false },
  });

  const filtered = applyMyTasksView(
    [legacyTask],
    config({ filters: { sectionIds: [11] } } as Partial<MyTasksViewConfig>),
    NOW,
  );

  assert.deepEqual(filtered.map(({ id }) => id), [legacyTask.id]);
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

test("parseMyTasksViewConfig keeps filterSettings and unknown top-level keys", () => {
  const parsed = parseMyTasksViewConfig({
    boardIds: [1],
    futureKey: { keep: true },
    filterSettings: {
      matchFilters: "ALL",
      addedFilters: [
        {
          type: "Inbox",
          searchPayload: [{ id: 0 }],
          condition: () => true,
          extra: "drop-me",
        },
      ],
      stray: true,
    },
    filters: { showDone: true },
    sort: { field: "title", direction: "asc" },
  });

  assert.equal((parsed as { futureKey?: { keep: boolean } }).futureKey?.keep, true);
  assert.equal(parsed.filterSettings?.matchFilters, "ALL");
  assert.equal(parsed.filterSettings?.addedFilters.length, 1);
  assert.equal(parsed.filterSettings?.addedFilters[0].type, "Inbox");
  assert.deepEqual(parsed.filterSettings?.addedFilters[0].searchPayload, [{ id: 0 }]);
  assert.equal(
    "condition" in (parsed.filterSettings?.addedFilters[0] ?? {}),
    false,
  );
});

test("filterSettings apply with match ALL/ANY and leave legacy flat filters alone when empty", () => {
  const tasks = [
    task(1, {
      notifications: [
        { seen: false, id: "n1", userId: 1, taskId: 1, type: "Comment" },
      ] as MyTasksTask["notifications"],
      priority: { priority_index: 2 } as MyTasksTask["priority"],
    }),
    task(2, {
      notifications: [
        { seen: true, id: "n2", userId: 1, taskId: 2, type: "Comment" },
      ] as MyTasksTask["notifications"],
      priority: { priority_index: 2 } as MyTasksTask["priority"],
    }),
    task(3, {
      priority: { priority_index: 4 } as MyTasksTask["priority"],
    }),
  ];

  assert.deepEqual(
    applyMyTasksView(
      tasks,
      config({
        filters: { priorityIds: [2] } as MyTasksViewConfig["filters"],
        filterSettings: {
          matchFilters: "ANY",
          addedFilters: [{ type: "Unread", searchPayload: [{ id: 0 }] }],
        },
      }),
      NOW,
    ).map(({ id }) => id),
    [1],
  );

  assert.deepEqual(
    applyMyTasksView(
      tasks,
      config({
        filters: { priorityIds: [2] } as MyTasksViewConfig["filters"],
        filterSettings: { matchFilters: "ANY", addedFilters: [] },
      }),
      NOW,
      { applyFilterSettings: true },
    ).map(({ id }) => id),
    [1, 2],
  );

  assert.deepEqual(
    applyMyTasksView(
      tasks,
      config({
        filterSettings: {
          matchFilters: "ALL",
          addedFilters: [
            { type: "Unread", searchPayload: [{ id: 0 }] },
            {
              type: "Priority",
              searchPayload: [{ id: 2, priority_index: 2 }],
            },
          ],
        },
      }),
      NOW,
    ).map(({ id }) => id),
    [1],
  );
});

test("flag-off evaluation ignores filterSettings so legacy panel saves stay safe", () => {
  const tasks = [
    task(1, {
      notifications: [
        { seen: false, id: "n1", userId: 1, taskId: 1, type: "Comment" },
      ] as MyTasksTask["notifications"],
    }),
    task(2),
  ];

  assert.deepEqual(
    applyMyTasksView(
      tasks,
      config({
        filterSettings: {
          matchFilters: "ANY",
          addedFilters: [{ type: "Inbox", searchPayload: [{ id: 0 }] }],
        },
      }),
      NOW,
      { applyFilterSettings: false },
    ).map(({ id }) => id),
    [1, 2],
  );
});

test("apply path migrates flat overlapping filters into filterSettings", () => {
  const migrated = migrateFlatFiltersToFilterSettings(
    config({
      filters: {
        ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters,
        priorityIds: [2],
        dueDate: "today",
        showDone: true,
        sectionIds: [11],
      },
    }),
  );

  assert.equal(migrated.filters.priorityIds.length, 0);
  assert.equal(migrated.filters.dueDate, null);
  assert.equal(migrated.filters.showDone, true);
  assert.deepEqual(migrated.filters.sectionIds, [11]);
  assert.equal(migrated.filterSettings?.addedFilters.length, 2);
  assert.equal(migrated.filterSettings?.addedFilters[0].type, "Priority");
  assert.equal(migrated.filterSettings?.addedFilters[1].type, "DueDate");

  const tasks = [
    task(1, { priority: { priority_index: 2 } as MyTasksTask["priority"] }),
    task(2, { priority: { priority_index: 1 } as MyTasksTask["priority"] }),
  ];

  // Flat priority still filters correctly via in-memory migration before persist.
  assert.deepEqual(
    applyMyTasksView(
      tasks,
      config({
        filters: {
          ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters,
          priorityIds: [2],
        },
      }),
      NOW,
      { applyFilterSettings: true },
    ).map(({ id }) => id),
    [1],
  );
});

test("migrate keeps starred:false flat and attaches label names", () => {
  const migrated = migrateFlatFiltersToFilterSettings(
    config({
      filters: {
        ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters,
        priorityIds: [2],
        starred: false,
        labelIds: ["lab-1"],
      },
    }),
    new Map([["lab-1", "Bug"]]),
  );

  assert.equal(migrated.filters.starred, false);
  assert.equal(migrated.filterSettings?.addedFilters.length, 2);
  const labels = migrated.filterSettings?.addedFilters.find(
    (filter) => filter.type === "Labels",
  );
  assert.deepEqual(labels?.searchPayload[0], { id: "lab-1", value: "Bug" });
  assert.equal(
    myTasksParityFilterCount(
      config({
        filters: {
          ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters,
          starred: false,
        },
      }),
    ),
    1,
  );
});

test("migrate merges flat edits into existing filterSettings", () => {
  const migrated = migrateFlatFiltersToFilterSettings(
    config({
      filters: {
        ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters,
        priorityIds: [2],
      },
      filterSettings: {
        matchFilters: "ALL",
        addedFilters: [{ type: "Inbox", searchPayload: [{ id: 0 }] }],
      },
    }),
  );

  assert.equal(migrated.filters.priorityIds.length, 0);
  assert.equal(migrated.filterSettings?.matchFilters, "ALL");
  assert.deepEqual(
    migrated.filterSettings?.addedFilters.map((filter) => filter.type).sort(),
    ["Inbox", "Priority"],
  );
});

test("apply migrates flat edits even when filterSettings already exist", () => {
  const tasks = [
    task(1, { priority: { priority_index: 2 } as MyTasksTask["priority"] }),
    task(2, { priority: { priority_index: 1 } as MyTasksTask["priority"] }),
  ];

  assert.deepEqual(
    applyMyTasksView(
      tasks,
      config({
        filters: {
          ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters,
          priorityIds: [2],
        },
        filterSettings: {
          matchFilters: "ANY",
          addedFilters: [{ type: "Inbox", searchPayload: [{ id: 0 }] }],
        },
      }),
      NOW,
      { applyFilterSettings: true },
    ).map(({ id }) => id),
    // Inbox alone would keep both; merged Priority keeps only task 1.
    // Tasks without inbox still fail Inbox unless they match ANY with Priority.
    [1],
  );
});

test("filterSettings path still applies flat starred:false", () => {
  const high = PriorityConstants.find((p) => p.priority_index === 2)!;
  const tasks = [
    task(1, {
      priority: { priority_index: high.priority_index } as MyTasksTask["priority"],
      savedContent: [{ id: 1 }] as unknown as MyTasksTask["savedContent"],
    }),
    task(2, {
      priority: { priority_index: high.priority_index } as MyTasksTask["priority"],
      savedContent: [] as unknown as MyTasksTask["savedContent"],
    }),
  ];

  assert.deepEqual(
    applyMyTasksView(
      tasks,
      config({
        filters: {
          ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters,
          starred: false,
        },
        filterSettings: {
          matchFilters: "ANY",
          addedFilters: [{ type: "Priority", searchPayload: [high] }],
        },
      }),
      NOW,
      { applyFilterSettings: true },
    ).map(({ id }) => id),
    // Priority keeps both; not-starred drops the starred task.
    [2],
  );
});

const viewSection = (
  items: MyTasksTask[],
  projectId: number,
): ISection =>
  ({
    sectionId: projectId,
    projectId,
    section_title: `Board ${projectId}`,
    items,
  }) as ISection;

test("overdueCountForMyTasksView follows the active view filters", () => {
  const sections = [
    viewSection(
      [
        task(1, { dueDate: new Date("2026-09-13T20:00:00.000Z"), projectId: 1 }),
        task(2, { dueDate: new Date("2026-09-14T18:00:00.000Z"), projectId: 1 }),
      ],
      1,
    ),
    viewSection(
      [
        task(3, {
          dueDate: new Date("2026-09-12T09:00:00.000Z"),
          projectId: 2,
          project: { id: 2, title: "Other" },
        }),
      ],
      2,
    ),
  ];

  assert.equal(overdueCountForMyTasksView(sections, config(), NOW), 2);
  assert.equal(
    overdueCountForMyTasksView(sections, config({ boardIds: [2] }), NOW),
    1,
  );
  assert.equal(
    overdueCountForMyTasksView(
      sections,
      config({ filters: { dueDate: "today" } } as Partial<MyTasksViewConfig>),
      NOW,
    ),
    0,
  );
});
