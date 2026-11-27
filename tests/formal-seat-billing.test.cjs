const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const covered = [
  "src/lib/syncSeatBilling.ts",
  "src/lib/seatBillingLock.ts",
  "verification/formal/checks.json",
  "verification/formal/seat-billing/SeatBilling.tla",
  "verification/formal/seat-billing/SeatBilling.cfg",
  "verification/formal/seat-billing/BugLateWrite.cfg",
  "verification/formal/seat-billing/BugLeaseOverlap.cfg",
  "verification/formal/seat-billing/repro.cjs",
  ".claude/skills/formal-verification/SKILL.md",
];

test("the seat-billing model covers the files its record names", () => {
  for (const file of covered) {
    assert.ok(existsSync(path.join(root, file)), `${file} is named in the record and missing`);
  }
});

test("every covered file still feeds the model, so a change there reruns this check", () => {
  const manifest = require(path.join(root, "verification/formal/checks.json"));
  assert.ok(manifest.checks["seat-billing"].properties.some((property) => property.expect === "holds"));
  for (const replay of ["seat-billing-9465", "seat-billing-9465-overlap"]) {
    assert.ok(
      manifest.checks[replay].properties.some((property) => property.expect === "violated"),
      `${replay} must keep replaying the pre-fix behaviour`,
    );
  }
});

test("the seat-billing model holds, and its pre-fix replays still break it", () => {
  const checked = spawnSync(
    process.execPath,
    [
      "scripts/formal-verification/run.mjs",
      "seat-billing",
      "seat-billing-9465",
      "seat-billing-9465-overlap",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
  assert.match(
    checked.stdout,
    /formal-verification: ok seat-billing matches its record .*JoinNeverDecreases holds, ReconcileMatchesSeats holds, LeaseExcludesOverlap holds/,
  );
  assert.match(
    checked.stdout,
    /formal-verification: ok seat-billing-9465 matches its record .*ReconcileMatchesSeats violated \(recorded finding\)/,
  );
  assert.match(
    checked.stdout,
    /formal-verification: ok seat-billing-9465-overlap matches its record .*LeaseExcludesOverlap violated \(recorded finding\)/,
  );
});
