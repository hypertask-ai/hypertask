const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROUTE = path.resolve(__dirname, "../src/lib/api/project-writes/all-read.ts");
const source = fs.readFileSync(ROUTE, "utf8");

test("getAll projects route uses no shared console.time label", () => {
  assert.doesNotMatch(source, /console\.time(End|Log)?\s*\(/);
});
