const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename);
const { displayedBoardTimeSeconds, legacyBoardTimeTotal } = jiti(
  path.join(root, "src/lib/boardTimeTotals.ts"),
);

const calculatedAt = "2026-08-18T10:00:00.000Z";
const tenSecondsLater = new Date(calculatedAt).getTime() + 10_000;

test("keeps a stopped task total static", () => {
  assert.equal(
    displayedBoardTimeSeconds(
      { calculatedAt, runningTimers: [], totalSeconds: 3_600 },
      tenSecondsLater,
    ),
    3_600,
  );
});

test("adds live elapsed time for every active timer on the task", () => {
  assert.equal(
    displayedBoardTimeSeconds(
      {
        calculatedAt,
        runningTimers: [
          { startedAt: calculatedAt, pausedAt: null },
          { startedAt: calculatedAt, pausedAt: null },
        ],
        totalSeconds: 3_600,
      },
      tenSecondsLater,
    ),
    3_620,
  );
});

test("does not advance paused timers", () => {
  assert.equal(
    displayedBoardTimeSeconds(
      {
        calculatedAt,
        runningTimers: [
          { startedAt: calculatedAt, pausedAt: calculatedAt },
        ],
        totalSeconds: 3_600,
      },
      tenSecondsLater,
    ),
    3_600,
  );
});

test("does not count time before a timer that started after the snapshot", () => {
  const fiveSecondsLater = new Date(calculatedAt).getTime() + 5_000;
  assert.equal(
    displayedBoardTimeSeconds(
      {
        calculatedAt,
        runningTimers: [
          { startedAt: new Date(fiveSecondsLater).toISOString(), pausedAt: null },
        ],
        totalSeconds: 3_600,
      },
      tenSecondsLater,
    ),
    3_605,
  );
});

test("handles absent or invalid summaries safely", () => {
  assert.equal(displayedBoardTimeSeconds(undefined, tenSecondsLater), 0);
  assert.equal(
    displayedBoardTimeSeconds(
      { calculatedAt: "invalid", runningTimers: [], totalSeconds: -5 },
      tenSecondsLater,
    ),
    0,
  );
});

test("converts a legacy running timer into a live total snapshot", () => {
  const fiveSecondsEarlier = new Date(
    new Date(calculatedAt).getTime() - 5_000,
  ).toISOString();
  const total = legacyBoardTimeTotal(
    { startedAt: fiveSecondsEarlier, pausedAt: null },
    new Date(calculatedAt),
  );

  assert.equal(total.totalSeconds, 5);
  assert.equal(displayedBoardTimeSeconds(total, tenSecondsLater), 15);
});
