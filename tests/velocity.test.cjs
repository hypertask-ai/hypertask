const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/velocity-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  VELOCITY_RANGES,
  buildVelocityReport,
  completedAt,
  isDoneSection,
  resolveVelocityRange,
  velocityVerdict,
  velocityWindow,
} = jiti(path.join(root, "src/lib/velocity.ts"));

const DAY_IN_MS = 86_400_000;
const range = (key) => resolveVelocityRange(key);

const task = (overrides = {}) => ({
  id: overrides.id ?? 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: null,
  sectionChangedAt: null,
  section: "Doing",
  status: "Normal",
  assigneeUserIds: [],
  ...overrides,
});

test("range keys resolve from one table and invalid values use 30 days", () => {
  const defaultRange = VELOCITY_RANGES.find(({ key }) => key === "30d");

  for (const invalid of [null, "", "nonsense", "8"]) {
    assert.strictEqual(resolveVelocityRange(invalid), defaultRange);
  }
  for (const expected of VELOCITY_RANGES) {
    assert.strictEqual(resolveVelocityRange(expected.key), expected);
  }
});

// A later edit to finished work must not rewrite history. The Done move is the
// completion event, while updatedAt can change weeks later for unrelated edits.
test("a task in Done completes when it entered Done, not when it was last edited", () => {
  const finished = task({
    section: "Done",
    sectionChangedAt: "2026-02-03T09:00:00.000Z",
    updatedAt: "2026-03-12T15:00:00.000Z",
  });

  assert.equal(
    completedAt(finished).toISOString(),
    "2026-02-03T09:00:00.000Z"
  );
});

// Archive is the only completion signal outside a Done-like column. Normal work
// in that same column must remain open rather than borrowing its updatedAt.
test("archive completion uses updatedAt outside Done, while Normal work stays open", () => {
  const archived = task({
    status: "Archive",
    updatedAt: "2026-02-10T12:00:00.000Z",
  });
  const open = task({
    status: "Normal",
    updatedAt: "2026-02-10T12:00:00.000Z",
  });

  assert.equal(
    completedAt(archived).toISOString(),
    "2026-02-10T12:00:00.000Z"
  );
  assert.equal(completedAt(open), null);
});

// Column names are user-entered. Normal capitalization and padding should work,
// but partial matches would incorrectly finish columns such as "Not done".
test("done-column matching ignores case and whitespace but requires an exact name", () => {
  assert.equal(isDoneSection("  DoNe "), true);
  assert.equal(isDoneSection("SHIPPED"), true);
  assert.equal(isDoneSection("Finished"), true);
  assert.equal(isDoneSection("LIVE"), true);
  assert.equal(isDoneSection("released"), true);
  assert.equal(isDoneSection("Not done"), false);
  assert.equal(isDoneSection("Done deal"), false);
  // WHY: Velocity deliberately does not inherit MCP's broader done-keyword fallback.
  assert.equal(isDoneSection("Done WIN"), false);
});

// Velocity must use board metadata so custom finished columns count without changing legacy fallback behavior.
test("a custom finished column reports completions only when its done set is passed", () => {
  const now = new Date("2026-03-18T12:00:00.000Z");
  const finished = task({
    section: "Ship it",
    sectionChangedAt: "2026-03-17T09:00:00.000Z",
  });
  const withoutDoneSet = buildVelocityReport(
    [finished],
    [],
    [],
    now,
    range("7d")
  );
  const withDoneSet = buildVelocityReport(
    [finished],
    [],
    [],
    now,
    range("7d"),
    undefined,
    new Set(["ship it"])
  );

  assert.equal(withoutDoneSet.totals.completed, 0);
  assert.equal(withoutDoneSet.speed.completedInRange, 0);
  assert.equal(withDoneSet.totals.completed, 1);
  assert.equal(withDoneSet.speed.completedInRange, 1);
});

test("each range uses its required UTC bucket granularity", () => {
  const now = new Date("2026-07-27T09:40:00.000Z");
  const today = velocityWindow(now, range("1d"));
  const sevenDays = velocityWindow(now, range("7d"));
  const threeMonths = velocityWindow(now, range("3m"));
  const twelveMonths = velocityWindow(now, range("12m"));

  assert.equal(today.granularity, "hour");
  assert.equal(today.bucketStarts.length, now.getUTCHours() + 1);
  assert.equal(today.bucketStarts[0].toISOString(), "2026-07-27T00:00:00.000Z");
  assert.equal(
    today.bucketStarts.at(-1).toISOString(),
    "2026-07-27T09:00:00.000Z"
  );
  assert.strictEqual(today.windowStart, today.bucketStarts[0]);

  assert.equal(sevenDays.granularity, "day");
  assert.equal(sevenDays.bucketStarts.length, 7);
  assert.deepEqual(
    sevenDays.bucketStarts.map((date) => date.toISOString()),
    [
      "2026-07-21T00:00:00.000Z",
      "2026-07-22T00:00:00.000Z",
      "2026-07-23T00:00:00.000Z",
      "2026-07-24T00:00:00.000Z",
      "2026-07-25T00:00:00.000Z",
      "2026-07-26T00:00:00.000Z",
      "2026-07-27T00:00:00.000Z",
    ]
  );

  assert.equal(threeMonths.granularity, "week");
  assert.equal(threeMonths.bucketStarts.length, 13);
  assert.equal(
    threeMonths.bucketStarts[0].toISOString(),
    "2026-05-04T00:00:00.000Z"
  );
  assert.ok(threeMonths.bucketStarts.every((date) => date.getUTCDay() === 1));

  assert.equal(twelveMonths.granularity, "month");
  assert.equal(twelveMonths.bucketStarts.length, 12);
  assert.equal(
    twelveMonths.bucketStarts[0].toISOString(),
    "2025-08-01T00:00:00.000Z"
  );
  assert.equal(
    twelveMonths.bucketStarts.at(-1).toISOString(),
    "2026-07-01T00:00:00.000Z"
  );
  assert.ok(
    twelveMonths.bucketStarts.every((date) => date.getUTCDate() === 1)
  );
});

// Median finish time should resist one slow outlier and correctly average the
// two middle values when the completed set has an even size.
test("median finish time handles even and odd completion counts", () => {
  const now = new Date("2026-03-18T12:00:00.000Z");
  const completedWithFinishTime = (id, completed, days) =>
    task({
      id,
      createdAt: new Date(
        new Date(completed).getTime() - days * DAY_IN_MS
      ).toISOString(),
      section: "Done",
      sectionChangedAt: completed,
    });

  const even = buildVelocityReport(
    [
      completedWithFinishTime(1, "2026-03-05T00:00:00.000Z", 2),
      completedWithFinishTime(2, "2026-03-06T00:00:00.000Z", 4),
    ],
    [],
    [],
    now
  );
  const odd = buildVelocityReport(
    [
      completedWithFinishTime(1, "2026-03-05T00:00:00.000Z", 1),
      completedWithFinishTime(2, "2026-03-06T00:00:00.000Z", 3),
      completedWithFinishTime(3, "2026-03-07T00:00:00.000Z", 8),
    ],
    [],
    [],
    now
  );
  const empty = buildVelocityReport([], [], [], now);

  assert.equal(even.speed.medianLeadTimeDays, 3);
  assert.equal(odd.speed.medianLeadTimeDays, 3);
  assert.equal(empty.speed.medianLeadTimeDays, null);
});

test("the prior window has the same length, does not overlap, and counts a finish nine days ago", () => {
  const now = new Date("2026-03-18T12:00:00.000Z");
  const selectedRange = range("7d");
  const { windowStart, priorStart } = velocityWindow(now, selectedRange);
  const completed = new Date(now.getTime() - 9 * DAY_IN_MS);
  const report = buildVelocityReport(
    [
      task({
        createdAt: new Date(completed.getTime() - 3 * DAY_IN_MS).toISOString(),
        section: "Done",
        sectionChangedAt: completed.toISOString(),
      }),
    ],
    [],
    [],
    now,
    selectedRange
  );

  assert.equal(
    windowStart.getTime() - priorStart.getTime(),
    now.getTime() - windowStart.getTime()
  );
  assert.ok(priorStart < windowStart);
  assert.equal(report.speed.completedInRange, 0);
  assert.equal(report.speed.priorCompletedInRange, 1);
  assert.equal(report.speed.medianLeadTimeDays, null);
  assert.equal(report.speed.priorMedianLeadTimeDays, 3);
});

test("a finish 40 days ago appears in 3 months but not 7 days", () => {
  const now = new Date("2026-03-18T12:00:00.000Z");
  const completed = new Date(now.getTime() - 40 * DAY_IN_MS);
  const comments = [{
    userId: 1,
    comments: 1,
    lastCommentAt: completed.toISOString(),
  }];
  const members = [
    { userId: 1, displayName: "Active Ada", email: "ada@example.com" },
  ];
  const finished = task({
    createdAt: new Date(completed.getTime() - 3 * DAY_IN_MS).toISOString(),
    section: "Done",
    sectionChangedAt: completed.toISOString(),
    assigneeUserIds: [1],
  });

  const threeMonths = buildVelocityReport(
    [finished],
    comments,
    members,
    now,
    range("3m")
  );
  const sevenDays = buildVelocityReport(
    [finished],
    comments,
    members,
    now,
    range("7d")
  );

  assert.equal(threeMonths.speed.medianLeadTimeDays, 3);
  assert.equal(threeMonths.people[0].completed, 1);
  assert.equal(threeMonths.people[0].comments, 1);
  assert.equal(sevenDays.speed.medianLeadTimeDays, null);
  assert.equal(sevenDays.people[0].completed, 0);
  assert.equal(sevenDays.people[0].comments, 0);
});

test("totals sum the whole selected window instead of the last bucket", () => {
  const now = new Date("2026-03-18T12:00:00.000Z");
  const report = buildVelocityReport(
    [
      task({ id: 1, createdAt: "2026-03-12T01:00:00.000Z" }),
      task({
        id: 2,
        createdAt: "2026-03-15T00:00:00.000Z",
        section: "Done",
        sectionChangedAt: "2026-03-17T00:00:00.000Z",
      }),
      task({
        id: 3,
        createdAt: "2026-03-01T00:00:00.000Z",
        status: "Archive",
        updatedAt: "2026-03-18T10:00:00.000Z",
      }),
    ],
    [],
    [],
    now,
    range("7d")
  );

  assert.deepEqual(report.totals, { created: 2, completed: 2, net: 0 });
  assert.equal(report.buckets.at(-1).created, 0);
  assert.equal(report.buckets.at(-1).completed, 1);
  assert.match(report.buckets[0].start, /T00:00:00\.000Z$/);
});

// The People table is an accountability view, so inactivity must be visible.
test("people includes idle members with zeroed activity", () => {
  const now = new Date("2026-03-18T12:00:00.000Z");
  const report = buildVelocityReport(
    [
      task({
        id: 1,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        section: "Done",
        sectionChangedAt: "2026-03-09T00:00:00.000Z",
        assigneeUserIds: [1],
      }),
    ],
    [{
      userId: 1,
      comments: 1,
      lastCommentAt: "2026-03-11T00:00:00.000Z",
    }],
    [
      { userId: 1, displayName: "Active Ada", email: "ada@example.com" },
      { userId: 2, displayName: "Idle Ida", email: "ida@example.com" },
    ],
    now
  );

  assert.deepEqual(report.people[0], {
    userId: 1,
    displayName: "Active Ada",
    completed: 1,
    comments: 1,
    lastActiveAt: "2026-03-11T00:00:00.000Z",
  });
  assert.deepEqual(report.people[1], {
    userId: 2,
    displayName: "Idle Ida",
    completed: 0,
    comments: 0,
    lastActiveAt: null,
  });
});

// A task edit carries no per-user timestamp, so attributing one would credit
// everyone who ever edited the task for activity inside the selected period.
test("a task edit alone credits nobody and invents no last-comment timestamp", () => {
  const now = new Date("2026-03-18T12:00:00.000Z");
  const report = buildVelocityReport(
    [
      task({
        updatedAt: "2026-03-18T09:00:00.000Z",
        assigneeUserIds: [1],
      }),
    ],
    [],
    [
      { userId: 1, displayName: "Alice", email: "alice@example.com" },
      { userId: 2, displayName: "Bob", email: "bob@example.com" },
    ],
    now
  );

  assert.equal(report.people[0].completed, 0);
  assert.equal(report.people[0].comments, 0);
  assert.equal(report.people[0].lastActiveAt, null);
});

test("open columns keep their staleness counts and exclude finished work", () => {
  const now = new Date();
  const report = buildVelocityReport(
    [
      task({
        id: 1,
        createdAt: new Date(now.getTime() - 60 * DAY_IN_MS),
        sectionChangedAt: now,
        lastCommentAt: new Date(now.getTime() - 30 * DAY_IN_MS),
      }),
      task({
        id: 2,
        section: "Done",
        sectionChangedAt: now,
      }),
    ],
    [],
    [],
    now
  );

  assert.equal(report.now.openTotal, 1);
  assert.equal(report.now.staleTotal, 1);
  assert.deepEqual(report.now.columns, [
    { section: "Doing", open: 1, stale: 1 },
  ]);
});

test("velocity verdict explains finish-time direction and backlog change", () => {
  const report = buildVelocityReport(
    [],
    [],
    [],
    new Date("2026-03-18T12:00:00.000Z")
  );

  report.speed.medianLeadTimeDays = 2;
  report.speed.priorMedianLeadTimeDays = 4;
  report.totals.net = -1;
  assert.equal(
    velocityVerdict(report),
    "Finishing work faster than the previous 30 days · backlog shrinking"
  );

  report.speed.medianLeadTimeDays = 5;
  report.speed.priorMedianLeadTimeDays = 4;
  report.totals.net = 2;
  assert.equal(
    velocityVerdict(report),
    "Finishing work slower than the previous 30 days · backlog growing"
  );

  report.speed.medianLeadTimeDays = 4;
  report.totals.net = 0;
  assert.equal(
    velocityVerdict(report),
    "Holding steady · backlog stable"
  );
});
