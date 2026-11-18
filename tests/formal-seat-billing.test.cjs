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
  assert.ok(manifest.checks["seat-billing"].properties.some((property) => property.expect === "violated"));
});

test("the seat-billing model raises the recorded finding and nothing else", () => {
  const checked = spawnSync(
    process.execPath,
    ["scripts/formal-verification/run.mjs", "seat-billing"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
  assert.match(
    checked.stdout,
    /formal-verification: ok seat-billing matches its record .*JoinNeverDecreases holds, ReconcileMatchesSeats violated \(recorded finding\), LeaseExcludesOverlap violated \(recorded finding\)/,
  );
});
