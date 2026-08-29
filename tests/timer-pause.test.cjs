const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/timer-pause-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { elapsedSeconds, resumedStartedAt, stoppedAt } = jiti(
  path.join(root, "src/lib/timeDuration.ts")
);

const at = (minutes) => new Date(Date.UTC(2026, 7, 7, 10, minutes));

test("elapsed time freezes at the moment of pause", () => {
  assert.equal(elapsedSeconds(at(0), null, at(5), at(20)), 5 * 60);
});

test("resume preserves accumulated time across the paused gap", () => {
  const resumedAt = at(20);
  const shiftedStart = resumedStartedAt(at(0), at(5), resumedAt);

  assert.equal(elapsedSeconds(at(0), null, at(5), resumedAt), 5 * 60);
  assert.equal(elapsedSeconds(shiftedStart, null, null, resumedAt), 5 * 60);
  assert.equal(elapsedSeconds(shiftedStart, null, null, at(25)), 10 * 60);
});

test("stopping while paused bills only up to pausedAt", () => {
  const endedAt = stoppedAt(at(5), at(20));

  assert.equal(endedAt.getTime(), at(5).getTime());
  assert.equal(elapsedSeconds(at(0), endedAt, at(5), at(20)), 5 * 60);
});

test("a never-paused timer is unchanged", () => {
  assert.equal(stoppedAt(null, at(20)).getTime(), at(20).getTime());
  assert.equal(elapsedSeconds(at(0), null, null, at(20)), 20 * 60);
  assert.equal(elapsedSeconds(at(0), at(5), null, at(20)), 5 * 60);
});
