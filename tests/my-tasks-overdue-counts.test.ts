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
    dueDate: new Date("2026-09-13T09:00:00.000Z"),
    ...overrides,
  }) as MyTasksTask;

const assigned = (id: number, overrides: Partial<MyTasksTask> = {}) =>
  task(id, {
    assignees: [{ userId: USER_ID, agentId: null }],
    ...overrides,
  });

const createdOnly = (id: number, overrides: Partial<MyTasksTask> = {}) =>
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
