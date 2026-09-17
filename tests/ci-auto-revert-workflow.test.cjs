const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const workflowPath = path.resolve(__dirname, "../.github/workflows/ci-tests.yml");
const healthWorkflowPath = path.resolve(__dirname, "../.github/workflows/prod-health.yml");
const scriptUrl = pathToFileURL(
  path.resolve(__dirname, "../.github/scripts/should-auto-revert.mjs"),
).href;
const PREVIOUS_SHA = "1111111111111111111111111111111111111111";
const OTHER_SHA = "2222222222222222222222222222222222222222";

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function run(id, overrides = {}) {
  return {
    id,
    event: "push",
    head_branch: "production",
    head_sha: PREVIOUS_SHA,
    status: "completed",
    run_attempt: 1,
    ...overrides,
  };
}

async function evaluate(queues) {
  const { previousProductionTestResult } = await import(scriptUrl);
  const calls = [];
  const cursors = {};
  const fetchImpl = async (url) => {
    calls.push(url);
    const key = Object.keys(queues).find((prefix) => url.startsWith(prefix));
    assert.ok(key, `unexpected fetch ${url}`);
    const entries = queues[key];
    const index = cursors[key] ?? 0;
    cursors[key] = index + 1;
    return entries[Math.min(index, entries.length - 1)];
  };
  const delays = [];
  const result = await previousProductionTestResult(
    "hypertask-ai/hypertask",
    PREVIOUS_SHA,
    "test-token",
    fetchImpl,
    async (ms) => delays.push(ms),
  );
  return { result, calls, delays };
}

const runsPrefix = "https://api.github.com/repos/hypertask-ai/hypertask/actions/workflows/ci-tests.yml/runs";
const jobsPrefix = "https://api.github.com/repos/hypertask-ai/hypertask/actions/runs/";

test("the newest exact production push is reported for context", async () => {
  const { result, calls } = await evaluate({
    [runsPrefix]: [
      response(200, {
        workflow_runs: [
          run(20, { run_attempt: 3 }),
          run(21, { run_attempt: 1 }),
          run(99, { event: "pull_request" }),
          run(98, { head_branch: "other" }),
          run(97, { head_sha: OTHER_SHA }),
        ],
      }),
    ],
    [`${jobsPrefix}21/jobs`]: [
      response(200, { jobs: [{ name: "ci-tests", conclusion: "success" }] }),
    ],
  });

  assert.equal(result.status, "success");
  assert.match(result.reason, /concluded success in run 21/);
  assert.match(calls[0], /branch=production&event=push&head_sha=1111/);
  assert.match(calls[1], /actions\/runs\/21\/jobs\?filter=latest/);
});

test("a failed previous run is informational and returned immediately", async () => {
  const { result, calls, delays } = await evaluate({
    [runsPrefix]: [response(200, { workflow_runs: [run(30)] })],
    [`${jobsPrefix}30/jobs`]: [
      response(200, { jobs: [{ name: "ci-tests", conclusion: "failure" }] }),
    ],
  });

  assert.equal(result.status, "failure");
  assert.match(result.reason, /concluded failure in run 30/);
  assert.equal(calls.length, 2);
  assert.deepEqual(delays, []);
});

test("missing or mismatched previous runs retry and report unknown", async () => {
  const { result, calls, delays } = await evaluate({
    [runsPrefix]: [
      response(200, {
        workflow_runs: [
          run(40, { event: "pull_request" }),
          run(41, { head_branch: "other" }),
          run(42, { head_sha: OTHER_SHA }),
        ],
      }),
    ],
  });

  assert.equal(result.status, "unknown");
  assert.match(result.reason, /after 3 attempts/);
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [10_000, 10_000]);
});

test("GitHub API failures retry and report unknown", async () => {
  const { result, calls, delays } = await evaluate({
    [runsPrefix]: [response(503, {})],
  });

  assert.equal(result.status, "unknown");
  assert.match(result.reason, /workflow lookup failed: HTTP 503/);
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [10_000, 10_000]);
});

test("a production unit-test failure can only warn", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const start = workflow.indexOf("  production-test-warning:");
  const end = workflow.indexOf("  production-cli-parity:", start);
  const warningJob = workflow.slice(start, end);

  assert.match(workflow, /id: push-test[\s\S]*?shell: bash[\s\S]*?run: npm test 2>&1 \| tee/);
  assert.match(warningJob, /name: production-test-warning/);
  assert.match(warningJob, /permissions:\n\s+actions: read\n\s+contents: read/);
  assert.match(warningJob, /FAILED_TESTS: \$\{\{ needs\.ci-tests\.outputs\.failed_tests \}\}/);
  assert.match(warningJob, /::notice::Previous run:/);
  assert.match(
    warningJob,
    /What failed: %s\\nLive site changed: no\\nNext: production stays live while the test failure is investigated\\nRun: %s/,
  );
  assert.doesNotMatch(warningJob, /contents: write|pull-requests: write/);
  assert.doesNotMatch(
    warningJob,
    /git (?:revert|push)|gh pr (?:create|merge)|emergency-rollback|VERCEL_TOKEN|deploymentId/,
  );
});

test("only the live production health workflow retains rollback authority", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const healthWorkflow = await readFile(healthWorkflowPath, "utf8");

  assert.doesNotMatch(workflow, /emergency-rollback\.mjs|api\.vercel\.com\/v10\/projects\/.*\/promote/);
  assert.match(healthWorkflow, /The FINAL attempt decides rollback/);
  assert.match(healthWorkflow, /if ! \$unchallenged_failure; then/);
  assert.match(healthWorkflow, /promote\/\$PREV_UID/);
});
