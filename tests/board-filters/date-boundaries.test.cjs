const test = require("node:test");
const assert = require("node:assert/strict");
const { NOW, fixture, sectionIds } = require("./fixture.cjs");
const { filters } = require("./runtime.cjs");
const { dateTypes } = require("./filter-cases.cjs");
const ranges = [
  ["TODAY", "2026-11-18", "2026-11-18"],
  ["YESTERDAY", "2026-11-17", "2026-11-17"],
  ["LAST_7_DAYS", "2026-11-12", "2026-11-18"],
  ["LAST_30_DAYS", "2026-10-20", "2026-11-18"],
  ["THIS_WEEK", "2026-11-16", "2026-11-22"],
  ["THIS_MONTH", "2026-11-01", "2026-11-30"],
  ["NEXT_7_DAYS", "2026-11-18", "2026-11-24"],
];
const fieldFor = { CreatedAt: "createdAt", UpdatedRange: "updatedAt", DueDate: "dueDate" };
function selectDates(type, timestamps, payload) {
  const { tasks, project } = fixture();
  const rows = tasks.slice(0, timestamps.length).map((task, i) => ({ ...task,
    createdAt: undefined, updatedAt: undefined, dueDate: undefined,
    [fieldFor[type]]: timestamps[i] == null ? undefined : new Date(timestamps[i]).toISOString(),
  }));
  return sectionIds(filters.applyFilters([{ items: rows }], [{ type, searchPayload: [payload] }], "ALL", project));
}
for (const type of dateTypes) {
  for (const [range, first, last] of ranges) {
    test(`filter ${type} ${range} exact calendar boundaries`, (t) => {
      t.mock.timers.enable({ apis: ["Date"], now: NOW });
      const start = Date.parse(`${first}T00:00:00.000Z`);
      const end = Date.parse(`${last}T23:59:59.999Z`);
      assert.deepEqual(selectDates(type, [start - 1, start, start + 1, end, end + 1, undefined], { dynamicRange: range }), ["b", "c", "d"]);
    });
  }
  test(`filter ${type} OVERDUE excludes start of today`, (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: NOW });
    const start = Date.parse("2026-11-18T00:00:00.000Z");
    assert.deepEqual(selectDates(type, [start - 1, start, start + 1, undefined], { dynamicRange: "OVERDUE" }), ["a"]);
  });
  for (const [condition, expected] of [["BEFORE", ["a"]], ["AFTER", ["c"]]]) {
    test(`filter ${type} ${condition} equality and adjacent milliseconds`, (t) => {
      t.mock.timers.enable({ apis: ["Date"], now: NOW });
      assert.deepEqual(selectDates(type, [NOW - 1, NOW, NOW + 1, undefined], { condition, selectedDate: new Date(NOW).toISOString() }), expected);
    });
  }
  test(`filter ${type} static range includes exact endpoints only`, (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: NOW });
    assert.deepEqual(selectDates(type, [NOW - 2, NOW - 1, NOW, NOW + 1, NOW + 2, undefined], {
      fromDate: new Date(NOW - 1).toISOString(), toDate: new Date(NOW + 1).toISOString(),
    }), ["b", "c", "d"]);
  });
  test(`filter ${type} LAST_7_DAYS crosses year boundary`, (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-01-01T12:00:00.000Z") });
    assert.deepEqual(selectDates(type, [Date.parse("2026-12-25T23:59:59.999Z"), Date.parse("2026-12-26T00:00:00.000Z"), Date.parse("2027-01-01T23:59:59.999Z"), Date.parse("2027-01-02T00:00:00.000Z")], { dynamicRange: "LAST_7_DAYS" }), ["b", "c"]);
  });
  test(`filter ${type} TODAY uses local calendar across spring DST`, (t) => {
    const previous = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-03-08T16:00:00.000Z") });
      assert.deepEqual(selectDates(type, [Date.parse("2026-03-08T04:59:59.999Z"), Date.parse("2026-03-08T05:00:00.000Z"), Date.parse("2026-03-09T03:59:59.999Z"), Date.parse("2026-03-09T04:00:00.000Z")], { dynamicRange: "TODAY" }), ["b", "c"]);
    } finally {
      process.env.TZ = previous;
    }
  });
}
