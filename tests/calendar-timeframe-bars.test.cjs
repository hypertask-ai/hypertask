const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.join(__dirname, "..");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
      alias: { "@": path.join(root, "src") },
    })
  : jitiModule(__filename, {
      interopDefault: true,
      cache: false,
      alias: { "@": path.join(root, "src") },
    });

const {
  buildCalendarTaskOverlapWhere,
  calendarTaskOverlapsRange,
} = jiti(path.join(root, "src/lib/calendarSync/taskRange.ts"));
const { buildWeekTaskBars } = jiti(
  path.join(root, "src/lib/calendarSync/weekLayout.ts"),
);

const task = (id, startDate, dueDate) => ({
  id,
  title: `Task ${id}`,
  startDate,
  dueDate,
});

const localDay = (year, month, day) => new Date(year, month - 1, day, 12);

test("timeframe buttons remain draggable interactive elements", () => {
  const weekView = fs.readFileSync(
    path.join(root, "src/components/PageComponents/Calendar/week-view.tsx"),
    "utf8",
  );

  assert.match(weekView, /<Draggable[\s\S]*?disableInteractiveElementBlocking/);
});

test("calendar interval membership uses half-open visible boundaries", () => {
  // New York's 2026 spring DST week has a 167-hour UTC range. The server still
  // receives exact local-midnight boundaries from the client.
  const start = new Date("2026-03-08T05:00:00.000Z");
  const endExclusive = new Date("2026-03-15T04:00:00.000Z");

  assert.equal(
    calendarTaskOverlapsRange(
      task(1, null, "2026-03-09T01:00:00.000Z"),
      start,
      endExclusive,
    ),
    true,
  );
  assert.equal(
    calendarTaskOverlapsRange(
      task(
        2,
        "2026-03-01T05:00:00.000Z",
        "2026-03-20T04:00:00.000Z",
      ),
      start,
      endExclusive,
    ),
    true,
  );
  assert.equal(
    calendarTaskOverlapsRange(
      task(
        3,
        "2026-03-15T04:00:00.000Z",
        "2026-03-20T04:00:00.000Z",
      ),
      start,
      endExclusive,
    ),
    false,
  );
  assert.equal(
    calendarTaskOverlapsRange(
      task(
        4,
        "2026-03-20T04:00:00.000Z",
        "2026-03-09T01:00:00.000Z",
      ),
      start,
      endExclusive,
    ),
    true,
    "an invalid start remains a one-day due task",
  );
  assert.equal(
    calendarTaskOverlapsRange(
      task(
        5,
        "2026-03-20T04:00:00.000Z",
        "2026-03-19T04:00:00.000Z",
      ),
      start,
      endExclusive,
    ),
    false,
  );
  assert.equal(
    calendarTaskOverlapsRange(task(6, "2026-03-09T01:00:00.000Z", null), start, endExclusive),
    false,
  );

  assert.deepEqual(buildCalendarTaskOverlapWhere(start, endExclusive), {
    OR: [
      { dueDate: { gte: start, lt: endExclusive } },
      {
        startDate: { not: null, lt: endExclusive },
        dueDate: { gte: start },
      },
    ],
  });
});

test("week bars clip to visible days and pack overlaps into stable lanes", () => {
  const days = [17, 18, 19, 20, 21, 22, 23].map((day) =>
    localDay(2026, 8, day),
  );
  const tasks = [
    task(20, localDay(2026, 8, 19), localDay(2026, 8, 23)),
    task(10, localDay(2026, 8, 17), localDay(2026, 8, 21)),
    task(30, localDay(2026, 8, 16), localDay(2026, 8, 24)),
    task(40, null, localDay(2026, 8, 20)),
    task(10, localDay(2026, 8, 17), localDay(2026, 8, 21)),
  ];

  const bars = buildWeekTaskBars(days, tasks);
  assert.deepEqual(
    bars.map(({ task: barTask, startColumn, endColumn, lane }) => ({
      id: barTask.id,
      startColumn,
      endColumn,
      lane,
    })),
    [
      { id: 30, startColumn: 0, endColumn: 6, lane: 0 },
      { id: 10, startColumn: 0, endColumn: 4, lane: 1 },
      { id: 20, startColumn: 2, endColumn: 6, lane: 2 },
    ],
  );
  assert.equal(bars[0].continuesBefore, true);
  assert.equal(bars[0].continuesAfter, true);
  assert.deepEqual(
    buildWeekTaskBars(days, [...tasks].reverse()).map((bar) => ({
      id: bar.task.id,
      lane: bar.lane,
    })),
    bars.map((bar) => ({ id: bar.task.id, lane: bar.lane })),
  );
});

test("hidden weekends clip continuation without inventing a visible bar", () => {
  const weekdays = [17, 18, 19, 20, 21].map((day) =>
    localDay(2026, 8, day),
  );
  const bars = buildWeekTaskBars(weekdays, [
    task(1, localDay(2026, 8, 16), localDay(2026, 8, 23)),
    task(2, localDay(2026, 8, 22), localDay(2026, 8, 23)),
    task(3, localDay(2026, 8, 21), localDay(2026, 8, 22)),
    task(4, localDay(2026, 8, 19), localDay(2026, 8, 19)),
  ]);

  assert.deepEqual(
    bars.map((bar) => ({
      id: bar.task.id,
      startColumn: bar.startColumn,
      endColumn: bar.endColumn,
      continuesBefore: bar.continuesBefore,
      continuesAfter: bar.continuesAfter,
    })),
    [
      {
        id: 1,
        startColumn: 0,
        endColumn: 4,
        continuesBefore: true,
        continuesAfter: true,
      },
      {
        id: 3,
        startColumn: 4,
        endColumn: 4,
        continuesBefore: false,
        continuesAfter: true,
      },
    ],
  );
});
