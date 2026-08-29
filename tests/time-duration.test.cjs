const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename);
const { formatElapsed, hoursMinutesToMinutes } = jiti(
  path.join(root, "src/lib/timeDuration.ts")
);

test("adds hours and minutes fields into total minutes", () => {
  assert.equal(hoursMinutesToMinutes("1", "30"), 90);
  assert.equal(hoursMinutesToMinutes("", "45"), 45);
  assert.equal(hoursMinutesToMinutes("2", ""), 120);
  // Minutes above 59 belong in the hours field; accepting them would log a
  // different duration than the one read back off the row.
  assert.equal(Number.isNaN(hoursMinutesToMinutes("0", "60")), true);
  assert.equal(Number.isNaN(hoursMinutesToMinutes("1", "-5")), true);
  assert.equal(Number.isNaN(hoursMinutesToMinutes("1.5", "0")), true);
});

test("formats elapsed time as hours, minutes, and seconds", () => {
  assert.equal(formatElapsed(60), "0:01:00");
  assert.equal(formatElapsed(5400), "1:30:00");
});
