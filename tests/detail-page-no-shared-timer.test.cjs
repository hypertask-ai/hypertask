const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PAGE = path.resolve(__dirname, "../src/app/detail/[...slug]/page.tsx");
const source = fs.readFileSync(PAGE, "utf8");

test("ticket detail page uses no shared console.time label", () => {
  assert.doesNotMatch(source, /console\.time(End|Log)?\s*\(/);
});
