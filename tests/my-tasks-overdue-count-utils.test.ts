import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeActiveViewOverdueCounts,
  msUntilNextLocalMidnight,
  parseMyTasksViewOverdueCounts,
  taskMatchesMyTasksScopes,
} from "../src/lib/myTasksOverdueCountUtils";
import {
  parseIanaTimeZone,
  startOfDayInTimeZone,
  startOfWeekInTimeZone,
} from "../src/lib/myTasksTimeZone";
import { classifyMyTasksTimeBucket } from "../src/lib/myTasksGrouping";

const USER_ID = 6;
const membership = {
  userId: USER_ID,
  watchingIds: new Set<number>([9]),
  mentionedIds: new Set<number>([8]),
};

test("taskMatchesMyTasksScopes keeps created-only rows out of assigned views", () => {
  const assignedTask = {
    id: 1,
    assignees: [{ userId: USER_ID, agentId: null }],
  };
  const createdTask = { id: 2, userId: USER_ID, assignees: [] };
  assert.equal(
    taskMatchesMyTasksScopes(assignedTask, ["assigned"], membership),
    true,
  );
  assert.equal(
    taskMatchesMyTasksScopes(createdTask, ["assigned"], membership),
    false,
  );
  assert.equal(
    taskMatchesMyTasksScopes(createdTask, ["created"], membership),
    true,
  );
  assert.equal(
    taskMatchesMyTasksScopes(createdTask, ["assigned", "created"], membership),
    true,
  );
  assert.equal(
    taskMatchesMyTasksScopes({ id: 9 }, ["watching"], membership),
    true,
  );
  assert.equal(
    taskMatchesMyTasksScopes({ id: 8 }, ["mentioned"], membership),
    true,
  );
});

test("mergeActiveViewOverdueCounts overlays only the open tab", () => {
  const remote = { all: 4, byViewId: { 10: 2, 11: 3 } };
  assert.deepEqual(mergeActiveViewOverdueCounts(remote, null, 9), {
    all: 9,
    byViewId: { 10: 2, 11: 3 },
  });
  assert.deepEqual(mergeActiveViewOverdueCounts(remote, 11, 8), {
    all: 4,
    byViewId: { 10: 2, 11: 8 },
  });
});

test("parseMyTasksViewOverdueCounts rejects junk and keeps finite ids", () => {
  assert.equal(parseMyTasksViewOverdueCounts(null), null);
  assert.deepEqual(parseMyTasksViewOverdueCounts({ all: 2, byViewId: { 7: 2 } }), {
    all: 2,
    byViewId: { 7: 2 },
  });
});

test("msUntilNextLocalMidnight lands on the next calendar day", () => {
  const evening = new Date(2026, 8, 14, 23, 0, 0, 0);
  const wait = msUntilNextLocalMidnight(evening);
  const next = new Date(evening.getTime() + wait);
  assert.equal(next.getHours(), 0);
  assert.equal(next.getMinutes(), 0);
  assert.equal(next.getDate(), 15);
  assert.ok(wait > 0);
  assert.ok(msUntilNextLocalMidnight(new Date(2026, 8, 14, 0, 0, 0, 0)) >= 1);
});

test("parseIanaTimeZone accepts real zones and rejects junk", () => {
  assert.equal(parseIanaTimeZone("Asia/Tokyo"), "Asia/Tokyo");
  assert.equal(parseIanaTimeZone(" UTC "), "UTC");
  assert.equal(parseIanaTimeZone("not a zone"), null);
  assert.equal(parseIanaTimeZone(""), null);
});

test("startOfDayInTimeZone and overdue buckets follow the named zone", () => {
  const now = new Date("2026-09-16T15:30:00.000Z");
  const tokyoStart = startOfDayInTimeZone(now, "Asia/Tokyo");
  assert.equal(tokyoStart.toISOString(), "2026-09-16T15:00:00.000Z");
  const due = new Date("2026-09-16T14:00:00.000Z");
  assert.equal(classifyMyTasksTimeBucket(due, now, "UTC"), "Today");
  assert.equal(classifyMyTasksTimeBucket(due, now, "Asia/Tokyo"), "Overdue");
});

test("startOfWeekInTimeZone stays on Monday in UTC+14", () => {
  const mondayMorningOnKiritimati = new Date("2026-09-13T12:00:00.000Z");
  const start = startOfWeekInTimeZone(
    mondayMorningOnKiritimati,
    "Pacific/Kiritimati",
  );
  assert.equal(start.toISOString(), "2026-09-13T10:00:00.000Z");
  const tuesdayIfBugged = new Date("2026-09-14T10:00:00.000Z");
  assert.ok(start.getTime() < tuesdayIfBugged.getTime());
});
