const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const yaml = require("js-yaml");

const workflow = (name) => yaml.load(readFileSync(`.github/workflows/${name}.yml`, "utf8"));
const prTypes = ["opened", "synchronize", "reopened", "ready_for_review"];

function assertNoCoverage(ci) {
  assert.doesNotMatch(JSON.stringify(ci), /NODE_V8_COVERAGE|coverage:report|automated-test-coverage|coverage\//);
}

function assertNormalTriggers(ci, request) {
  assert.deepEqual(ci.on.pull_request.types, prTypes);
  assert.deepEqual(request.on.pull_request.types, prTypes);
  assert.deepEqual(ci.on.push.branches, ["production"]);
  assert.equal(ci.on.schedule, undefined);
  assert.equal(ci.on.workflow_dispatch, undefined);
  assert.equal(ci.jobs["ci-prepare"].if, "github.event_name == 'push' || github.event.pull_request.draft == false");
  assert.equal(ci.jobs["browser-smoke"].if, "github.event_name == 'push' || github.event.pull_request.draft == false");
  assert.equal(ci.jobs["ci-tests"].name, "ci-tests");
  assert.equal(
    ci.jobs["ci-tests"].if,
    "always() && (github.event_name == 'push' || github.event.pull_request.draft == false)",
  );
  assert.deepEqual(ci.jobs["ci-tests"].needs, ["ci-prepare", "ci-checks", "ci-test"]);
  assert.equal(request.jobs.request.if, "github.event.pull_request.draft == false");
}

test("metadata changes cannot restart or skip required CI, and PR/push tests collect no coverage", () => {
  const ci = workflow("ci-tests");
  const request = workflow("app-smoke-request");
  assertNormalTriggers(ci, request);
  assertNoCoverage(ci);
  const push = ci.jobs["ci-test"].steps.find((step) => step.id === "push-test");
  assert.equal(push.if, undefined);
  assert.equal(push.env.HT_REQUIRE_PG_TESTS, "${{ github.event_name == 'push' && '1' || steps.pg.outputs.need }}");
  assert.match(push.run, /npm test -- "\$\{FILES\[@\]\}" 2>&1 \| tee "\$RUNNER_TEMP\/ci-shard-upload\/shard-\$\{SHARD\}\.log"/);
  assert.equal(ci.jobs["ci-test"].strategy["fail-fast"], false);
  assert.equal(String(ci.env.CI_TEST_SHARDS), "2");
});

test("nightly diagnostics run the full production suite without publishing a required check", () => {
  const nightly = workflow("coverage-nightly");
  assert.deepEqual(Object.keys(nightly.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.deepEqual(nightly.on.schedule, [{ cron: "17 2 * * *" }]);
  assert.deepEqual(Object.keys(nightly.jobs), ["coverage-nightly"]);
  const job = nightly.jobs["coverage-nightly"];
  assert.equal(job.name, "coverage-nightly");
  assert.equal(job.if, "github.ref == 'refs/heads/production'");
  assert.equal(job["runs-on"], "ubuntu-latest");
  assert.equal(job.steps[0].with.ref, "${{ github.sha }}");
  assert.equal(job.steps[0].with["persist-credentials"], false);
  assert.deepEqual(job.permissions, { contents: "read", packages: "read" });
  assert.equal(job["timeout-minutes"], 60);
  assert.deepEqual(nightly.concurrency, { group: "coverage-nightly-production", "cancel-in-progress": false });
  const collect = job.steps.find((step) => step.name === "Test with coverage collection");
  assert.equal(collect.run, "npm test");
  assert.deepEqual(collect.env, { NODE_V8_COVERAGE: "coverage/raw", HT_REQUIRE_PG_TESTS: "1" });
  assert.equal(collect.if, undefined);
  const report = job.steps.find((step) => step.name === "Build report-only coverage baseline");
  assert.equal(report.run, "npm run coverage:report");
  assert.equal(report["continue-on-error"], true);
  const upload = job.steps.find((step) => step.name === "Upload coverage baseline");
  assert.equal(upload.if, "always()");
  assert.equal(upload.with.name, "automated-test-coverage-${{ github.sha }}");
  assert.equal(upload.with.path, "coverage/report/\ncoverage/critical-domains.json\ncoverage/critical-domains.md\n");
  assert.equal(upload.with["retention-days"], 30);
});

test("contract rejects restored instrumentation, metadata triggers, and label skips", () => {
  const ci = workflow("ci-tests");
  const request = workflow("app-smoke-request");
  assert.throws(() => assertNoCoverage({ ...ci, env: { NODE_V8_COVERAGE: "coverage/raw" } }));
  for (const type of ["labeled", "edited"]) {
    const changed = { ...ci, on: { ...ci.on, pull_request: { types: [...prTypes, type] } } };
    assert.throws(() => assertNormalTriggers(changed, request));
  }
  const edited = { ...request, on: { pull_request: { types: [...prTypes, "edited"] } } };
  assert.throws(() => assertNormalTriggers(ci, edited));
  const skipped = { ...ci, jobs: { ...ci.jobs, "ci-tests": { ...ci.jobs["ci-tests"], if: "contains(github.event.pull_request.labels.*.name, 'full-ci')" } } };
  assert.throws(() => assertNormalTriggers(skipped, request));
});
