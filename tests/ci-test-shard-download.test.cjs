const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const yaml = require("js-yaml");

test("shard list download retries once without retrying tests", () => {
  const workflow = yaml.load(readFileSync(".github/workflows/ci-tests.yml", "utf8"));
  const steps = workflow.jobs["ci-test"].steps;
  const downloads = steps.filter((step) => step.with?.name === "ci-test-shards");
  assert.equal(downloads.length, 2);
  const [first, retry] = downloads;
  assert.equal(steps.indexOf(retry), steps.indexOf(first) + 1);
  assert.equal(first.name, "Download test shard lists");
  assert.equal(first.id, "download-test-shards");
  assert.equal(first.if, undefined);
  assert.equal(first["continue-on-error"], true);
  assert.equal(retry.if, "steps.download-test-shards.outcome == 'failure'");
  assert.equal(retry["continue-on-error"], undefined);
  for (const step of downloads) {
    assert.equal(step.uses, "actions/download-artifact@95815c38cf2ff2164869cbab79da8d1f422bc89e");
    assert.deepEqual(step.with, { name: "ci-test-shards", path: "ci-test-shards" });
  }
  const testSteps = steps.filter((step) => step.name === "Test shard");
  assert.equal(testSteps.length, 1);
  assert.ok(steps.indexOf(testSteps[0]) > steps.indexOf(retry));
  assert.equal(testSteps[0].if, undefined);
  assert.equal(testSteps[0]["continue-on-error"], undefined);
});
