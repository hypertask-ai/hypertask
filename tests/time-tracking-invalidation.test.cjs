const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename);
const { timeEntryCreatedInvalidationKeys } = jiti(
  path.join(root, "src/lib/timeTrackingInvalidation.ts"),
);

test("creating a manual entry invalidates task, report, timer, and board totals", () => {
  assert.deepEqual(timeEntryCreatedInvalidationKeys(42), [
    ["time", "report"],
    ["time", "task", 42],
    ["time", "entries", 42],
    ["time", "running"],
    ["time", "running-board"],
  ]);
});
