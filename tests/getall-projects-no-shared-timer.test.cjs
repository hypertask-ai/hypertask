// HTPR-7233: console.time labels are process-wide. The getAll projects route
// used one fixed label, so overlapping requests would end each other's timer
// and Node would warn "No such label" (same bug as HTPR-7219 and HTPR-7231).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROUTE = path.resolve(__dirname, "../src/lib/api/project-writes/all-read.ts");
const source = fs.readFileSync(ROUTE, "utf8");

test("getAll projects route uses no shared console.time label", () => {
  assert.doesNotMatch(source, /console\.time(End|Log)?\s*\(/);
});
