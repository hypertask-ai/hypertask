// HTPR-4885: recurrence date math for repeating tasks. The sweep that spawns
// the next occurrence relies on nextOccurrence never returning a date in the
// past and never drifting the time-of-day.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function loadTs(relativePath) {
  const jiti = require("jiti")(path.join(root, "tests/recurrence-entry.cjs"), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  return jiti(path.join(root, relativePath));
}

const { nextOccurrence, isRecurrenceRule, RECURRENCE_RULES } = loadTs(
  "src/lib/recurrence.ts",
);

const at = (iso) => new Date(iso);

test("daily steps one day and keeps time-of-day", () => {
  const next = nextOccurrence(
    "Daily",
    at("2026-08-03T09:30:00Z"),
    at("2026-08-03T00:00:00Z"),
  );
  assert.equal(next.toISOString(), "2026-08-04T09:30:00.000Z");
});

test("weekdays skips the weekend", () => {
  // 2026-08-07 is a Friday → next weekday is Monday the 10th.
  const next = nextOccurrence(
    "Weekdays",
    at("2026-08-07T12:00:00Z"),
    at("2026-08-07T00:00:00Z"),
  );
  assert.equal(next.toISOString(), "2026-08-10T12:00:00.000Z");
});

test("weekly and biweekly step 7 and 14 days", () => {
  const base = at("2026-08-03T08:00:00Z");
  const now = at("2026-08-03T00:00:00Z");
  assert.equal(
    nextOccurrence("Weekly", base, now).toISOString(),
    "2026-08-10T08:00:00.000Z",
  );
  assert.equal(
    nextOccurrence("Biweekly", base, now).toISOString(),
    "2026-08-17T08:00:00.000Z",
  );
});

test("monthly clamps to shorter months", () => {
  const next = nextOccurrence(
    "Monthly",
    at("2027-01-31T10:00:00Z"),
    at("2027-01-31T00:00:00Z"),
  );
  assert.equal(next.toISOString(), "2027-02-28T10:00:00.000Z");
});

test("monthly clamp does not stick: Jan 31 → Feb 28 → Mar 28", () => {
  const feb = nextOccurrence(
    "Monthly",
    at("2027-01-31T10:00:00Z"),
    at("2027-01-31T00:00:00Z"),
  );
  const mar = nextOccurrence("Monthly", feb, feb);
  assert.equal(mar.toISOString(), "2027-03-28T10:00:00.000Z");
});

test("completing late rolls forward past now — never spawns an overdue copy", () => {
  // Weekly task anchored months ago, completed today.
  const next = nextOccurrence(
    "Weekly",
    at("2026-05-04T09:00:00Z"),
    at("2026-08-02T18:00:00Z"),
  );
  assert.equal(next.toISOString(), "2026-08-03T09:00:00.000Z");
  assert.ok(next.getTime() > at("2026-08-02T18:00:00Z").getTime());
});

test("next occurrence is always strictly in the future for every rule", () => {
  const now = at("2026-08-02T18:00:00Z");
  for (const rule of RECURRENCE_RULES) {
    const next = nextOccurrence(rule, at("2025-01-15T07:45:00Z"), now);
    assert.ok(
      next.getTime() > now.getTime(),
      `${rule} produced a past date: ${next.toISOString()}`,
    );
  }
});

test("isRecurrenceRule accepts rules and rejects junk", () => {
  for (const rule of RECURRENCE_RULES) assert.ok(isRecurrenceRule(rule));
  assert.ok(!isRecurrenceRule("Hourly"));
  assert.ok(!isRecurrenceRule(null));
  assert.ok(!isRecurrenceRule(3));
});
