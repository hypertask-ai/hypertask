const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src/app/time/TimeComp.tsx"),
  "utf8",
);

test("time reports use two theme-aware job surfaces on the gray page", () => {
  const surfaceClass = source.match(
    /const timeReportSurfaceClassName =\s*\n?\s*"([^"]+)"/,
  );

  assert.ok(surfaceClass, "time report surface class should be declared");
  assert.match(surfaceClass[1], /\bbg-cardBackground\b/);
  assert.doesNotMatch(surfaceClass[1], /\bbg-white\b/);
  assert.equal(
    [...source.matchAll(/data-time-report-surface=/g)].length,
    2,
    "scope and report content should form exactly two major surfaces",
  );
  assert.match(source, /w-full bg-containerBackground/);
});
