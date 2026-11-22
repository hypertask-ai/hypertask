const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const key = "htpr-7924-free-file-25mb";
const snapshot = require("../e2e/smoke/production-flag-modes.json");

test("the Free 25 MB file ceiling no longer has a switch of its own", () => {
  const definitions = require("./helpers/flag-files.cjs").definitions();
  assert.equal(definitions.some((definition) => definition.key === key), false);
  assert.equal(Object.hasOwn(snapshot.modes, key), false);
  assert.equal(fs.existsSync(path.join(root, "e2e/smoke/flag-modes", `${key}.json`)), false);
});

test("a Free scope sees 25 MB files and 25 MB plan copy with no flag of its own", () => {
  const limits = load("src/lib/freePlanLimits.ts", {});
  assert.equal(limits.FREE_PLAN_MAX_FILE_BYTES, 25 * 1024 * 1024);
  assert.equal(limits.freePlanFileMegabytes(), 25);
  assert.equal("freeFileByteLimit" in limits, false);
  const copy = limits.freePlanLimitCopy({ planLimits: true, unlimitedTickets: false });
  assert.equal(copy.includes("Up to 25 MB each on tickets and comments"), true);
  assert.equal(limits.freePlanLimitCopy({ planLimits: false, unlimitedTickets: false }).some((line) => line.includes("MB")), false);
});
