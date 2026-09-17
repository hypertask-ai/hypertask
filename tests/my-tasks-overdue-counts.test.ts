import assert from "node:assert/strict";
import test from "node:test";

import type { MyTasksTask } from "../src/lib/myTasksFiltering";
import { overdueCountForMyTasksView } from "../src/lib/myTasksFiltering";
import { overdueCountsFromAuthorizedTasks } from "../src/lib/myTasksOverdueCounts";
import type { ISection } from "../src/models/model";
import {
  DEFAULT_MY_TASKS_VIEW_CONFIG,
  type MyTasksSavedView,
  type MyTasksViewConfig,
} from "../src/models/MyTasksView";

const NOW = new Date("2026-09-14T12:00:00.000Z");
const USER_ID = 6;

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
    dueDate: new Date("2026-09-13T09:00:00.000Z"),
    ...overrides,
  }) as unknown as MyTasksTask;

const assigned = (id: number, overrides: Record<string, unknown> = {}) =>
  task(id, {
    assignees: [{ userId: USER_ID }],
    ...overrides,
  });

const createdOnly = (id: number, overrides: Record<string, unknown> = {}) =>
  task(id, { userId: USER_ID, assignees: [], ...overrides });

const membership = {
  userId: USER_ID,
  watchingIds: new Set<number>(),
  mentionedIds: new Set<number>(),
};

const savedView = (
  id: number,
  config: Partial<MyTasksViewConfig>,
): MyTasksSavedView => ({
  id,
  name: `View ${id}`,
  position: id,
  isDefault: false,
  config: { ...DEFAULT_MY_TASKS_VIEW_CONFIG, ...config },
});

test("overdueCountsFromAuthorizedTasks does not reuse the active view's dataset", () => {
  const tasks = [assigned(1), createdOnly(2)];
  const counts = overdueCountsFromAuthorizedTasks(
    tasks,
    [
      savedView(10, { scopes: ["assigned"] }),
      savedView(11, { scopes: ["assigned", "created"] }),
    ],
    membership,
    NOW,
    {},
    true,
  );

  assert.equal(counts.all, 1);
  assert.equal(counts.byViewId[10], 1);
  assert.equal(counts.byViewId[11], 2);

  const assignedOnlySections = [
    {
      sectionId: 1,
      projectId: 1,
      section_title: "Board 1",
      items: [assigned(1)],
    },
  ] as ISection[];
  assert.equal(
    overdueCountForMyTasksView(
      assignedOnlySections,
      { ...DEFAULT_MY_TASKS_VIEW_CONFIG, scopes: ["assigned", "created"] },
      NOW,
    ),
    1,
  );
});

test("overdueCountsFromAuthorizedTasks uses the supplied time zone day start", () => {
  const now = new Date("2026-09-16T15:30:00.000Z");
  const dueYesterdayInTokyo = assigned(3, {
    dueDate: new Date("2026-09-16T14:00:00.000Z"),
  });
  const utcCounts = overdueCountsFromAuthorizedTasks(
    [dueYesterdayInTokyo],
    [],
    membership,
    now,
    { timeZone: "UTC" },
    false,
  );
  const tokyoCounts = overdueCountsFromAuthorizedTasks(
    [dueYesterdayInTokyo],
    [],
    membership,
    now,
    { timeZone: "Asia/Tokyo" },
    false,
  );
  assert.equal(utcCounts.all, 0);
  assert.equal(tokyoCounts.all, 1);
});

test("this_week overdue counts keep Monday in UTC+14", () => {
  const thursdayOnKiritimati = new Date("2026-09-16T12:00:00.000Z");
  const mondayMorningOnKiritimati = assigned(6, {
    dueDate: new Date("2026-09-13T10:30:00.000Z"),
  });
  const sections = [
    {
      sectionId: 1,
      projectId: 1,
      section_title: "Board 1",
      items: [mondayMorningOnKiritimati],
    },
  ] as ISection[];
  const thisWeek = {
    ...DEFAULT_MY_TASKS_VIEW_CONFIG,
    filters: {
      ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters,
      dueDate: "this_week" as const,
    },
  };
  assert.equal(
    overdueCountForMyTasksView(
      sections,
      thisWeek,
      thursdayOnKiritimati,
      { timeZone: "Pacific/Kiritimati" },
    ),
    1,
  );
});

test("date-only created ranges use the named timezone day", () => {
  const now = new Date("2026-09-16T15:30:00.000Z");
  const createdNearUtcEvening = assigned(7, {
    createdAt: "2026-09-16T15:30:00.000Z",
    dueDate: new Date("2026-09-15T00:00:00.000Z"),
  });
  const sections = [
    {
      sectionId: 1,
      projectId: 1,
      section_title: "Board 1",
      items: [createdNearUtcEvening],
    },
  ] as ISection[];
  const createdOnThe16th = {
    ...DEFAULT_MY_TASKS_VIEW_CONFIG,
    filters: {
      ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters,
      createdRange: { from: "2026-09-16", to: "2026-09-16" },
    },
  };
  assert.equal(
    overdueCountForMyTasksView(sections, createdOnThe16th, now, {
      timeZone: "UTC",
    }),
    1,
  );
  assert.equal(
    overdueCountForMyTasksView(sections, createdOnThe16th, now, {
      timeZone: "Pacific/Kiritimati",
    }),
    0,
  );
});

test("overdueCountsFromAuthorizedTasks honors running-timer runtime context", () => {
  const running = assigned(4, {
    project: { id: 1, title: "Product", timeTrackingEnabled: true },
  });
  const idle = assigned(5, {
    project: { id: 1, title: "Product", timeTrackingEnabled: true },
  });
  const view = savedView(12, {
    filterSettings: {
      matchFilters: "ALL",
      addedFilters: [{ type: "RunningTimer", searchPayload: [{}] }],
    },
  });
  const withoutRuntime = overdueCountsFromAuthorizedTasks(
    [running, idle],
    [view],
    membership,
    NOW,
    { applyFilterSettings: true },
    false,
  );
  const withRuntime = overdueCountsFromAuthorizedTasks(
    [running, idle],
    [view],
    membership,
    NOW,
    {
      applyFilterSettings: true,
      runtimeContext: { runningTaskIds: new Set([4]) },
    },
    false,
  );
  assert.equal(withoutRuntime.byViewId[12], 0);
  assert.equal(withRuntime.byViewId[12], 1);
});
