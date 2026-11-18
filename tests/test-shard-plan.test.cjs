const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const script = resolve(__dirname, "../.github/scripts/test-shard-plan.mjs");

function runPlan({ eventName, buildNeeded = "true", selected }) {
  const runnerTemp = mkdtempSync(join(tmpdir(), "test-shard-plan-"));
  if (selected !== undefined) writeFileSync(join(runnerTemp, "selected-tests.txt"), selected);
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_NAME: eventName, BUILD_NEEDED: buildNeeded, RUNNER_TEMP: runnerTemp },
  });
  return { mode: result.stdout.trim(), stderr: result.stderr, status: result.status };
}

test("a scheduled run plans the whole suite instead of an empty selection", async () => {
  const { planShardInput, ALL } = await import("../.github/scripts/test-shard-plan.mjs");
  assert.equal(planShardInput({ eventName: "schedule", buildNeeded: "true", selectedText: "" }), ALL);
  assert.deepEqual(runPlan({ eventName: "schedule" }), { mode: ALL, stderr: "", status: 0 });
});

test("push and dispatch runs plan the whole suite", async () => {
  const { planShardInput, ALL } = await import("../.github/scripts/test-shard-plan.mjs");
  for (const eventName of ["push", "workflow_dispatch"]) {
    assert.equal(planShardInput({ eventName, buildNeeded: "true", selectedText: "" }), ALL);
    assert.deepEqual(runPlan({ eventName }), { mode: ALL, stderr: "", status: 0 });
  }
});

test("a pull request plans its selection, widens on ALL and skips a docs-only run", async () => {
  const { planShardInput, ALL, NONE, SELECTED } = await import("../.github/scripts/test-shard-plan.mjs");
  assert.equal(planShardInput({ eventName: "pull_request", buildNeeded: "true", selectedText: "tests/a.test.cjs\ntests/b.test.cjs\n" }), SELECTED);
  assert.equal(planShardInput({ eventName: "pull_request", buildNeeded: "true", selectedText: "ALL\n" }), ALL);
  assert.equal(planShardInput({ eventName: "pull_request", buildNeeded: "false", selectedText: "" }), NONE);
  assert.deepEqual(runPlan({ eventName: "pull_request", buildNeeded: "false" }), { mode: NONE, stderr: "", status: 0 });
  assert.deepEqual(runPlan({ eventName: "pull_request", selected: "tests/a.test.cjs\n" }), { mode: SELECTED, stderr: "", status: 0 });
});

test("a pull request with an empty selection fails instead of skipping the suite", async () => {
  const { planShardInput, emptySelectionMessage, EMPTY_SELECTION } = await import("../.github/scripts/test-shard-plan.mjs");
  assert.equal(planShardInput({ eventName: "pull_request", buildNeeded: "true", selectedText: "  \n" }), EMPTY_SELECTION);
  const blank = runPlan({ eventName: "pull_request", selected: "  \n" });
  assert.equal(blank.status, 1);
  assert.match(blank.stderr, new RegExp(emptySelectionMessage));
  const missing = runPlan({ eventName: "pull_request" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, new RegExp(emptySelectionMessage));
});
