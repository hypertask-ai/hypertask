const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src/app/starred/StarredComp.tsx"),
  "utf8",
);

test("starred global view uses viewport breakpoints for desktop spacing", () => {
  assert.match(source, /md:px-16/);
  assert.match(source, /md:py-9/);
  assert.match(source, /md:space-y-4/);
  assert.match(source, /md:pb-0/);
  assert.doesNotMatch(source, /@md:!?p[xyb]-/);
});
