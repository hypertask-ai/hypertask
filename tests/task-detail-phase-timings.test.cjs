const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const { createJiti } = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  moduleCache: false,
});
const {
  markTaskDetailPhase,
  instrumentedDynamicImport,
  readTaskDetailPhaseTimings,
  TASK_DETAIL_SUSPENSE_COMMIT_MARK,
  TASK_DETAIL_COMP_MOUNT_MARK,
  TASK_DETAIL_COMMENTS_REQUEST_MARK,
  TASK_DETAIL_USABLE_MARK,
} = jiti(path.join(root, "src/lib/analytics/taskDetailPhaseTimings.ts"));

// HTPR-6047: field attribution for the task-detail readiness gap, since we
// have no way to CPU-profile a real user's browser. Every phase must report
// null (never a fake number) when unmeasurable, and a stale mark from an
// earlier mount in the same tab must never leak into a later reading.

const clearMarks = () => {
  performance.clearMarks();
};

test("reports null for every phase when nothing has marked yet", () => {
  clearMarks();
  const timings = readTaskDetailPhaseTimings();
  assert.deepEqual(timings, {
    phase_suspense_commit_ms: null,
    phase_comp_mount_ms: null,
    phase_comments_request_ms: null,
    phase_usable_ms: null,
    phase_dynamic_imports: null,
  });
});

test("reads real timings once all phases have marked", () => {
  clearMarks();
  markTaskDetailPhase(TASK_DETAIL_SUSPENSE_COMMIT_MARK);
  markTaskDetailPhase(TASK_DETAIL_COMP_MOUNT_MARK);
  markTaskDetailPhase(TASK_DETAIL_COMMENTS_REQUEST_MARK);
  markTaskDetailPhase(TASK_DETAIL_USABLE_MARK);

  const timings = readTaskDetailPhaseTimings();
  assert.equal(typeof timings.phase_suspense_commit_ms, "number");
  assert.equal(typeof timings.phase_comp_mount_ms, "number");
  assert.equal(typeof timings.phase_comments_request_ms, "number");
  assert.equal(typeof timings.phase_usable_ms, "number");
  assert.equal(timings.phase_dynamic_imports, null); // none instrumented in this test
});

test("a dynamic import mark shows up by name once its loader resolves", async () => {
  clearMarks();
  markTaskDetailPhase(TASK_DETAIL_SUSPENSE_COMMIT_MARK);

  const loader = instrumentedDynamicImport("Tooltip", () =>
    Promise.resolve({ default: () => null }),
  );
  await loader();

  const timings = readTaskDetailPhaseTimings();
  assert.ok(timings.phase_dynamic_imports, "dynamic import phase must be recorded");
  const parsed = JSON.parse(timings.phase_dynamic_imports);
  assert.deepEqual(
    parsed.map((entry) => entry.name),
    ["Tooltip"],
  );
  assert.equal(typeof parsed[0].ms, "number");
});

test("a mark left over from an earlier mount is discarded as stale, not reported", async () => {
  clearMarks();
  // Simulate a chunk resolved during a PREVIOUS task-detail mount (its mark
  // predates this mount's own suspense-commit mark, which is what actually
  // happens: a dynamic() loader only runs once per session, so a later
  // mount's read would otherwise see a timestamp from the wrong page).
  const loader = instrumentedDynamicImport("NewCommentComponent", () =>
    Promise.resolve({ default: () => null }),
  );
  await loader();

  // This mount's own suspense-commit mark happens AFTER the stale import mark.
  await new Promise((resolve) => setTimeout(resolve, 5));
  markTaskDetailPhase(TASK_DETAIL_SUSPENSE_COMMIT_MARK);

  const timings = readTaskDetailPhaseTimings();
  assert.equal(
    timings.phase_dynamic_imports,
    null,
    "a pre-mount import mark must never be reported as this mount's data",
  );
});

test("nothing throws when the Performance API is unavailable", () => {
  const realPerformance = global.performance;
  // eslint-disable-next-line no-global-assign
  global.performance = undefined;
  try {
    assert.doesNotThrow(() => markTaskDetailPhase(TASK_DETAIL_USABLE_MARK));
    assert.doesNotThrow(() => {
      const timings = readTaskDetailPhaseTimings();
      assert.deepEqual(timings, {
        phase_suspense_commit_ms: null,
        phase_comp_mount_ms: null,
        phase_comments_request_ms: null,
        phase_usable_ms: null,
        phase_dynamic_imports: null,
      });
    });
  } finally {
    global.performance = realPerformance;
  }
});
