const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const readiness = jiti(path.join(root, "src/lib/analytics/taskDetailReadiness.ts"));
const currentPath = "/detail/project-15/5599";
test("classifies the three measured in-app entry routes", () => {
  assert.equal(readiness.taskDetailEntryPathForRoute("/project"), "board");
  assert.equal(readiness.taskDetailEntryPathForRoute("/project/views/active"), "board");
  assert.equal(readiness.taskDetailEntryPathForRoute("/inbox"), "inbox");
  assert.equal(readiness.taskDetailEntryPathForRoute("/calendar"), "calendar");
  assert.equal(readiness.taskDetailEntryPathForRoute("/search"), null);
});
test("measures an exact-target in-app navigation from its stored start", () => {
  const sample = readiness.resolveTaskDetailReadinessSample({
    currentPath,
    now: 425,
    navigationEntry: null,
    storedMarker: JSON.stringify({
      version: 1, entryPath: "board", targetPath: currentPath, startedAt: 125,
    }),
  });
  assert.deepEqual(sample, {
    entryPath: "board", navigationMode: "client_navigation", navigationType: "spa",
    durationMs: 300, measurementEligible: true, exclusionReason: "none",
  });
});
test("measures a direct task URL from the document navigation start", () => {
  const sample = readiness.resolveTaskDetailReadinessSample({
    currentPath,
    now: 860,
    navigationEntry: {
      name: `https://app.hypertask.ai${currentPath}`, startTime: 0, type: "reload",
    },
    storedMarker: null,
  });
  assert.deepEqual(sample, {
    entryPath: "direct_route", navigationMode: "hard_navigation", navigationType: "reload",
    durationMs: 860, measurementEligible: true, exclusionReason: "none",
  });
});
test("excludes missing and out-of-range starts instead of guessing", () => {
  const missing = readiness.resolveTaskDetailReadinessSample({
    currentPath, now: 500, storedMarker: null,
    navigationEntry: { name: "https://app.hypertask.ai/inbox", startTime: 0, type: "navigate" },
  });
  assert.deepEqual(
    [missing.entryPath, missing.measurementEligible, missing.exclusionReason],
    ["unknown", false, "missing_start_marker"],
  );
  const stale = readiness.resolveTaskDetailReadinessSample({
    currentPath, now: 31_000, navigationEntry: null,
    storedMarker: JSON.stringify({
      version: 1, entryPath: "calendar", targetPath: currentPath, startedAt: 0,
    }),
  });
  assert.deepEqual(
    [stale.entryPath, stale.measurementEligible, stale.exclusionReason],
    ["calendar", false, "duration_out_of_range"],
  );
});
test("usable state accepts rendered read-only content only when actions are ready", () => {
  const present = new Set([readiness.TASK_DETAIL_READ_ONLY_CONTENT_READY_SELECTOR]);
  const fakeRoot = { querySelector: (selector) => present.has(selector) ? {} : null };
  assert.equal(readiness.taskDetailUsableDomPresent(fakeRoot), false);
  present.add(readiness.TASK_DETAIL_ACTIONS_READY_SELECTOR);
  assert.equal(readiness.taskDetailUsableDomPresent(fakeRoot), true);
});

test("usable state still waits for a mounted editor when description editing starts", () => {
  const present = new Set([readiness.TASK_DETAIL_ACTIONS_READY_SELECTOR]);
  const fakeRoot = { querySelector: (selector) => present.has(selector) ? {} : null };
  assert.equal(readiness.taskDetailUsableDomPresent(fakeRoot), false);
  present.add(readiness.TASK_DETAIL_EDITOR_CONTENT_READY_SELECTOR);
  assert.equal(readiness.taskDetailUsableDomPresent(fakeRoot), true);
});
