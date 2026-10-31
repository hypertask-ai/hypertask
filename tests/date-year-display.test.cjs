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

const now = () => new Date();
const daysAgo = (at, n) => new Date(at.getTime() - n * 86_400_000);

test("a date in a previous calendar year shows its year even when under a year old", () => {
  const at = now();
  const lastYear = new Date(at.getFullYear() - 1, 11, 20);
  const formatted = formatDateDifference(lastYear);
  assert.match(formatted, new RegExp(String(at.getFullYear() - 1)));
});

test("a date earlier this year shows no year", () => {
  const at = now();
  const recent = daysAgo(at, 14);
  const formatted = formatDateDifference(recent);
  if (recent.getFullYear() === at.getFullYear()) {
    assert.doesNotMatch(formatted, new RegExp(String(at.getFullYear())));
  } else {
    assert.match(formatted, new RegExp(String(recent.getFullYear())));
  }
});

test("a date several years back still shows its year", () => {
  const at = now();
  const old = new Date(at.getFullYear() - 3, 4, 2);
  assert.match(formatDateDifference(old), new RegExp(String(at.getFullYear() - 3)));
});

test("recent timestamps keep their relative wording", () => {
  const at = now();
  assert.equal(formatDateDifference(new Date(at.getTime() - 30_000)), "Just now");
  assert.equal(formatDateDifference(new Date(at.getTime() - 5 * 60_000)), "5min");
});
