import assert from "node:assert/strict";
import test from "node:test";
import {
  annotateMyTasksSnoozeFields,
  isMyTasksSnoozed,
  myTasksActiveSnoozeWhere,
  nearestFutureSnoozeUntil,
  parseMyTasksSnoozeUntil,
} from "../src/lib/myTasksSnooze";
import { applyMyTasksView } from "../src/lib/myTasksFiltering";
import type { MyTasksViewConfig } from "../src/models/MyTasksView";
import { DEFAULT_MY_TASKS_VIEW_CONFIG } from "../src/models/MyTasksView";
import type { MyTasksTask } from "../src/lib/myTasksFiltering";

const NOW = new Date("2026-09-15T12:00:00.000Z");

test("parseMyTasksSnoozeUntil clears past and empty values", () => {
  assert.deepEqual(parseMyTasksSnoozeUntil(null, NOW), {
    ok: true,
    snoozeUntil: null,
  });
  assert.deepEqual(parseMyTasksSnoozeUntil("2026-09-14T12:00:00.000Z", NOW), {
    ok: true,
    snoozeUntil: null,
  });
});

test("parseMyTasksSnoozeUntil accepts a near future ISO date", () => {
  const result = parseMyTasksSnoozeUntil("2026-09-16T09:00:00.000Z", NOW);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.snoozeUntil?.toISOString(), "2026-09-16T09:00:00.000Z");
  }
});

test("parseMyTasksSnoozeUntil rejects garbage and distant futures", () => {
  assert.equal(parseMyTasksSnoozeUntil("not-a-date", NOW).ok, false);
  assert.equal(parseMyTasksSnoozeUntil("2035-01-01T00:00:00.000Z", NOW).ok, false);
});

test("myTasksActiveSnoozeWhere hides current-user future snoozes", () => {
  assert.deepEqual(myTasksActiveSnoozeWhere(6, NOW), {
    NOT: {
      assignees: {
        some: {
          userId: 6,
          agentId: null,
          snoozeUntil: { gt: NOW },
        },
      },
    },
  });
});

test("annotateMyTasksSnoozeFields keeps only the caller's snooze", () => {
  const [task] = annotateMyTasksSnoozeFields(
    [
      {
        assignees: [
          {
            id: 10,
            userId: 6,
            agentId: null,
            snoozeUntil: new Date("2026-09-16T09:00:00.000Z"),
          },
          {
            id: 11,
            userId: 7,
            agentId: null,
            snoozeUntil: new Date("2026-09-20T09:00:00.000Z"),
          },
        ],
      },
    ],
    6,
  );
  assert.equal(task.currentUserAssignmentId, 10);
  assert.equal(task.currentUserSnoozeUntil, "2026-09-16T09:00:00.000Z");
  assert.equal(
    (task.assignees as Array<{ snoozeUntil?: unknown }>).every(
      (row) => row.snoozeUntil === undefined,
    ),
    true,
  );
});

test("nearestFutureSnoozeUntil picks the soonest future value", () => {
  assert.equal(
    nearestFutureSnoozeUntil(
      ["2026-09-20T09:00:00.000Z", "2026-09-16T09:00:00.000Z", null],
      NOW,
    ),
    "2026-09-16T09:00:00.000Z",
  );
});

test("applyMyTasksView hides snoozed rows unless showSnoozed", () => {
  const tasks = [
    {
      id: 1,
      title: "open",
      projectId: 15,
      currentUserSnoozeUntil: null,
    },
    {
      id: 2,
      title: "snoozed",
      projectId: 15,
      currentUserSnoozeUntil: "2026-09-16T09:00:00.000Z",
    },
  ] as MyTasksTask[];

  const hidden = applyMyTasksView(
    tasks,
    {
      ...DEFAULT_MY_TASKS_VIEW_CONFIG,
      filters: { ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters, showSnoozed: false },
    } as MyTasksViewConfig,
    NOW,
  ).map((task) => task.id);
  assert.deepEqual(hidden, [1]);

  const shown = applyMyTasksView(
    tasks,
    {
      ...DEFAULT_MY_TASKS_VIEW_CONFIG,
      filters: { ...DEFAULT_MY_TASKS_VIEW_CONFIG.filters, showSnoozed: true },
    } as MyTasksViewConfig,
    NOW,
  ).map((task) => task.id);
  assert.deepEqual(shown, [1, 2]);
});

test("isMyTasksSnoozed is false at and before the boundary", () => {
  assert.equal(isMyTasksSnoozed("2026-09-15T12:00:00.000Z", NOW), false);
  assert.equal(isMyTasksSnoozed("2026-09-15T12:00:00.001Z", NOW), true);
});
