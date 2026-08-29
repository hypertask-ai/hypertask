const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/date-year-display.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { default: formatDateDifference } = jiti(
  path.join(root, "src/utils/generateTime.ts"),
);

const now = new Date();
const daysAgo = (n) => new Date(now.getTime() - n * 86_400_000);

// The bug this replaces: the year appeared only after 365 days elapsed, so a
// comment from last September read "12 Sep" in August and looked five weeks
// old instead of eleven months.
test("a date in a previous calendar year shows its year even when under a year old", () => {
  const lastYear = new Date(now.getFullYear() - 1, 11, 20); // 20 Dec last year
  const formatted = formatDateDifference(lastYear);
  assert.match(formatted, new RegExp(String(now.getFullYear() - 1)));
});

test("a date earlier this year shows no year", () => {
  // Two weeks back stays inside this calendar year except in the first fortnight
  // of January, where the previous test already covers the year-carrying case.
  const recent = daysAgo(14);
  const formatted = formatDateDifference(recent);
  if (recent.getFullYear() === now.getFullYear()) {
    assert.doesNotMatch(formatted, new RegExp(String(now.getFullYear())));
  } else {
    assert.match(formatted, new RegExp(String(recent.getFullYear())));
  }
});

test("a date several years back still shows its year", () => {
  const old = new Date(now.getFullYear() - 3, 4, 2);
  assert.match(formatDateDifference(old), new RegExp(String(now.getFullYear() - 3)));
});

test("recent timestamps keep their relative wording", () => {
  assert.equal(formatDateDifference(new Date(now.getTime() - 30_000)), "Just now");
  assert.equal(formatDateDifference(new Date(now.getTime() - 5 * 60_000)), "5min");
});
