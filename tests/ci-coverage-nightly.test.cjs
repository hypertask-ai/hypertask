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
  for (const key of ["browser-smoke-desktop", "browser-smoke-mobile"]) {
    assert.equal(ci.jobs[key].if, "github.event_name == 'push' || github.event.pull_request.draft == false", key);
  }
  assert.equal(ci.jobs["browser-smoke"].if, "always() && (github.event_name == 'push' || github.event.pull_request.draft == false)");
  assert.equal(ci.jobs["ci-tests"].name, "ci-tests");
  assert.equal(
    ci.jobs["ci-tests"].if,
    "always() && (github.event_name == 'push' || github.event.pull_request.draft == false)",
  );
  assert.deepEqual(ci.jobs["ci-tests"].needs, ["ci-prepare", "ci-checks", "ci-test", "ci-fixtures"]);
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
  assert.equal(String(ci.env.CI_TEST_SHARDS), "6");
  assert.equal(String(ci.env.CI_SERIAL_SHARDS), "2");
  const plan = ci.jobs["ci-prepare"].steps.find((step) => step.name === "Write test shards");
  assert.match(plan.run, /LANES=\$\(\(CI_TEST_SHARDS \+ CI_SERIAL_SHARDS\)\)/);
  assert.match(plan.run, /--count "\$LANES" --serial-lanes "\$CI_SERIAL_SHARDS" --out "\$OUT"/);
  assert.match(plan.run, /--check --serial-lanes "\$CI_SERIAL_SHARDS" --out "\$OUT"/);
  assert.match(plan.run, /' "\$LANES"\)$/m);
  assert.equal(ci.jobs["ci-test"].strategy.matrix.shard, "${{ fromJSON(needs.ci-prepare.outputs.shard_indexes || '[\"0\"]') }}");
  const prove = ci.jobs["ci-tests"].steps.find((step) => step.id === "prove");
  assert.equal(prove.run, 'node .github/scripts/shard-tests.mjs --prove --serial-lanes "$CI_SERIAL_SHARDS" --out ci-test-shards --results ci-shard-results');
});

test("nightly diagnostics run the full production suite in lanes without publishing a required check", () => {
  const nightly = workflow("coverage-nightly");
  assert.deepEqual(Object.keys(nightly.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.deepEqual(nightly.on.schedule, [{ cron: "17 2 * * *" }]);
  assert.deepEqual(Object.keys(nightly.jobs), ["coverage-plan", "coverage-lane", "coverage-nightly"]);
  assert.deepEqual(nightly.concurrency, { group: "coverage-nightly-production", "cancel-in-progress": false });
  assert.equal(String(nightly.env.COVERAGE_POOL_LANES), "4");
  assert.equal(String(nightly.env.COVERAGE_SERIAL_LANES), "1");
  for (const [name, job] of Object.entries(nightly.jobs)) {
    assert.notEqual(job.name, "ci-tests", name);
    assert.ok(job["timeout-minutes"] < 55, `${name} must finish inside the 55-minute target, not the old 60-minute cap`);
    assert.equal(job["runs-on"], "ubuntu-latest", name);
    assert.equal(job.steps[0].with.ref, "${{ github.sha }}", name);
    assert.equal(job.steps[0].with["persist-credentials"], false, name);
  }
  assert.equal(nightly.jobs["coverage-plan"].if, "github.ref == 'refs/heads/production'");
  assert.equal(nightly.jobs["coverage-lane"].if, "github.ref == 'refs/heads/production'");
  assert.equal(nightly.jobs["coverage-nightly"].if, "always() && github.ref == 'refs/heads/production'");
  assert.deepEqual(nightly.jobs["coverage-nightly"].needs, ["coverage-plan", "coverage-lane"]);

  const plan = nightly.jobs["coverage-plan"];
  assert.equal(plan.outputs.lanes, "${{ steps.lanes.outputs.indexes }}");
  const write = plan.steps.find((step) => step.name === "Write coverage lanes");
  assert.match(write.run, /LANES=\$\(\(COVERAGE_POOL_LANES \+ COVERAGE_SERIAL_LANES\)\)/);
  assert.match(write.run, /--discover --count "\$LANES" --serial-lanes "\$COVERAGE_SERIAL_LANES" --out "\$OUT"/);
  assert.match(write.run, /--check --serial-lanes "\$COVERAGE_SERIAL_LANES" --out "\$OUT"/);
  const planUpload = plan.steps.find((step) => step.name === "Upload coverage lanes");
  assert.equal(planUpload.with.name, "coverage-lanes");

  const lane = nightly.jobs["coverage-lane"];
  assert.equal(lane.strategy["fail-fast"], false);
  assert.equal(lane.strategy.matrix.lane, "${{ fromJSON(needs.coverage-plan.outputs.lanes || '[\"0\"]') }}");
  assert.equal(lane.env.HTPR_PG_IMAGE, workflow("ci-tests").jobs["ci-test"].env.HTPR_PG_IMAGE);
  const collect = lane.steps.find((step) => step.name === "Test lane with coverage collection");
  assert.deepEqual(collect.env, {
    LANE: "${{ matrix.lane }}",
    NODE_V8_COVERAGE: "coverage/raw",
    HT_REQUIRE_PG_TESTS: "1",
    SOURCE_TEXT_ALLOWLIST_BASE: "${{ github.sha }}^",
    COMPOSE_PALETTE_STALL_MS: "600000",
  });
  assert.match(collect.run, /npm test -- "\$\{FILES\[@\]\}" 2>&1 \| tee "\$RUNNER_TEMP\/coverage-lane-upload\/shard-\$\{LANE\}\.log"/);
  const pack = lane.steps.find((step) => step.name === "Pack lane coverage");
  assert.equal(pack.if, "always() && steps.lane-test.outcome != 'skipped'");
  assert.match(pack.run, /tar --warning=no-file-changed -czf "\$RUNNER_TEMP\/coverage-lane-upload\/coverage\/raw\.tgz" -C coverage raw \|\| \[ \$\? -eq 1 \]/);
  const laneUpload = lane.steps.find((step) => step.name === "Upload lane result");
  assert.equal(laneUpload.if, "always()");
  assert.equal(laneUpload.with.name, "coverage-lane-${{ matrix.lane }}");

  const report = nightly.jobs["coverage-nightly"];
  const merge = report.steps.find((step) => step.name === "Merge lane coverage");
  assert.match(merge.run, /node \.github\/scripts\/merge-coverage-raw\.mjs coverage\/raw "\$\{dirs\[@\]}"/);
  const baseline = report.steps.find((step) => step.name === "Build report-only coverage baseline");
  assert.equal(baseline.run, "npm run coverage:report");
  assert.equal(baseline["continue-on-error"], true);
  const upload = report.steps.find((step) => step.name === "Upload coverage baseline");
  assert.equal(upload.if, "always()");
  assert.equal(upload.with.name, "automated-test-coverage-${{ github.sha }}");
  assert.equal(upload.with.path, "coverage/report/\ncoverage/critical-domains.json\ncoverage/critical-domains.md\n");
  assert.equal(upload.with["retention-days"], 30);
  const prove = report.steps.find((step) => step.name === "Prove every test file ran once");
  assert.equal(prove.run, 'node .github/scripts/shard-tests.mjs --prove --serial-lanes "$COVERAGE_SERIAL_LANES" --out coverage-lanes --results coverage-results');
  const fail = report.steps.find((step) => step.name === "Fail when a lane failed");
  assert.equal(fail.if, "needs.coverage-lane.result != 'success'");
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
