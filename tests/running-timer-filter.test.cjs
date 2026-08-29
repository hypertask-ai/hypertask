const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/running-timer-filter.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { defaultConditions } = jiti(
  path.join(root, "src/utils/helperFunctions/Views/FilterHelperFunctions.ts")
);

const match = defaultConditions.RunningTimer;
const enabledProject = { timeTrackingEnabled: true };

test("the running-timer filter matches a task whose id is running", () => {
  const runtimeContext = { runningTaskIds: new Set([17]) };
  assert.equal(match({ id: 17 }, [], enabledProject, undefined, runtimeContext), true);
});

test("the running-timer filter rejects a task whose id is not running", () => {
  const runtimeContext = { runningTaskIds: new Set([17]) };
  assert.equal(match({ id: 18 }, [], enabledProject, undefined, runtimeContext), false);
});

test("the running-timer filter returns false without runtime context", () => {
  assert.equal(match({ id: 17 }, [], enabledProject), false);
});

test("the running-timer filter returns false for an empty running-id set", () => {
  const runtimeContext = { runningTaskIds: new Set() };
  assert.equal(match({ id: 17 }, [], enabledProject, undefined, runtimeContext), false);
});

test("the running-timer filter returns false when time tracking is disabled", () => {
  const runtimeContext = { runningTaskIds: new Set([17]) };
  const disabledProject = { timeTrackingEnabled: false };
  assert.equal(match({ id: 17 }, [], disabledProject, undefined, runtimeContext), false);
});
