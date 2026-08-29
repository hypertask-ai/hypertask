const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename);
const { getCalendarTitle } = jiti(
  path.join(
    root,
    "src/components/PageComponents/Calendar/calendarTitle.ts"
  )
);
const today = new Date(2026, 6, 29);

const weekTitle = (currentDate) =>
  getCalendarTitle({
    currentView: "week",
    currentDate,
    today,
    weekStartsOn: 1,
  });

test("formats a current-year week with abbreviated months", () => {
  assert.equal(weekTitle(new Date(2026, 6, 29)), "Jul 27 – Aug 2");
});

test("formats a week spanning a new year with the ending year", () => {
  assert.equal(weekTitle(new Date(2026, 11, 30)), "Dec 28 – Jan 3, 2027");
});

test("formats a non-current-year week with its year", () => {
  assert.equal(weekTitle(new Date(2027, 2, 3)), "Mar 1 – 7, 2027");
});

test("collapses the month in a same-month current-year week", () => {
  assert.equal(weekTitle(new Date(2026, 6, 8)), "Jul 6 – 12");
});

test("shows the year only for a month outside the current year", () => {
  assert.equal(
    getCalendarTitle({
      currentView: "month",
      currentDate: new Date(2026, 6, 1),
      today,
      weekStartsOn: 1,
    }),
    "July"
  );
  assert.equal(
    getCalendarTitle({
      currentView: "month",
      currentDate: new Date(2027, 2, 1),
      today,
      weekStartsOn: 1,
    }),
    "March 2027"
  );
});
