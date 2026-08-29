const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src/app/starred/StarredComp.tsx"),
  "utf8",
);

test("starred desktop spacing is not blocked by legacy important zero-padding utilities", () => {
  const globalViewClass = source.match(/className="([^"]*global-view-width[^"]*)"/)?.[1];

  assert.ok(globalViewClass);
  assert.doesNotMatch(globalViewClass, /(?:^|\s)px-0(?:\s|$)/);
  assert.doesNotMatch(globalViewClass, /(?:^|\s)py-0(?:\s|$)/);
  assert.match(globalViewClass, /md:px-16/);
  assert.match(globalViewClass, /md:py-9/);
});
