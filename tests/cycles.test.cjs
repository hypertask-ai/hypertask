const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/cycles-jiti-entry.cjs"), {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const {
  cycleDateRange,
  cycleDaysLeft,
  cycleEndFor,
  dateOnly,
  resolveCycleWindow,
  startOfUtcWeek,
} = jiti(path.join(root, "src/lib/cycles.ts"));

test("cycle dates start on Monday UTC and span exactly two weeks", () => {
  const monday = startOfUtcWeek(new Date("2026-09-06T23:59:59-07:00"));
  assert.equal(dateOnly(monday), "2026-09-07");
  assert.equal(dateOnly(cycleEndFor(monday)), "2026-09-21");
});

test("cycle windows use half-open UTC date boundaries", () => {
  const cycles = [
    {
      id: 2,
      number: 2,
      projectId: 15,
      startDate: "2026-09-14",
      endDate: "2026-09-28",
    },
    {
      id: 1,
      number: 1,
      projectId: 15,
      startDate: "2026-08-31",
      endDate: "2026-09-14",
    },
  ];

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(resolveCycleWindow(cycles, "2026-09-13T23:59:59Z")).map(
        ([key, cycle]) => [key, cycle?.id ?? null],
      ),
    ),
    { current: 1, next: 2 },
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(resolveCycleWindow(cycles, "2026-09-14T00:00:00Z")).map(
        ([key, cycle]) => [key, cycle?.id ?? null],
      ),
    ),
    { current: 2, next: null },
  );
});

test("cycle labels and countdown exclude the half-open end date", () => {
  const cycle = { startDate: "2026-08-31", endDate: "2026-09-14" };
  assert.equal(cycleDateRange(cycle, "en-US"), "Aug 31 to Sep 13");
  assert.equal(cycleDaysLeft(cycle, "2026-08-31T20:00:00Z"), 13);
  assert.equal(cycleDaysLeft(cycle, "2026-09-13T01:00:00Z"), 0);
  assert.equal(cycleDaysLeft(cycle, "2026-09-14T00:00:00Z"), 0);
});
