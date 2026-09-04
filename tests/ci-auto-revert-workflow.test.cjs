const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const workflowPath = path.resolve(__dirname, "../.github/workflows/ci-tests.yml");
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
  const { shouldAutoRevert } = await import(scriptUrl);
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
  const result = await shouldAutoRevert(
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

test("only the newest exact successful production push allows a revert", async () => {
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
    [`${jobsPrefix}20/jobs`]: [
      response(200, { jobs: [{ name: "ci-tests", conclusion: "failure" }] }),
    ],
    [`${jobsPrefix}21/jobs`]: [
      response(200, { jobs: [{ name: "ci-tests", conclusion: "success" }] }),
    ],
  });

  assert.equal(result.action, "proceed");
  assert.match(calls[0], /branch=production&event=push&head_sha=1111/);
  assert.match(calls[1], /actions\/runs\/21\/jobs\?filter=latest/);
});

test("a failed previous ci-tests run blocks the revert immediately", async () => {
  const { result, calls, delays } = await evaluate({
    [runsPrefix]: [response(200, { workflow_runs: [run(30)] })],
    [`${jobsPrefix}30/jobs`]: [
      response(200, { jobs: [{ name: "ci-tests", conclusion: "failure" }] }),
    ],
  });

  assert.equal(result.action, "skip");
  assert.match(result.reason, /did not pass \(failure\)/);
  assert.equal(calls.length, 2);
  assert.deepEqual(delays, []);
});

test("missing or mismatched parent runs retry and then fail closed", async () => {
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

  assert.equal(result.action, "skip");
  assert.match(result.reason, /after 3 attempts/);
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [10_000, 10_000]);
});

test("GitHub API failures retry and then fail closed", async () => {
  const { result, calls, delays } = await evaluate({
    [runsPrefix]: [response(503, {})],
  });

  assert.equal(result.action, "skip");
  assert.match(result.reason, /workflow lookup failed: HTTP 503/);
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [10_000, 10_000]);
});

test("the workflow checks the prior push before touching Git or Vercel", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const preflight = workflow.indexOf("node .github/scripts/should-auto-revert.mjs");
  const revert = workflow.indexOf('git revert $MAINLINE --no-commit "$GITHUB_SHA"');
  const rollback = workflow.indexOf('emergency_rollback "push refused');

  assert.match(workflow, /auto-revert-production:[\s\S]*?permissions:\n\s+actions: read/);
  assert.match(workflow, /BEFORE_SHA: \$\{\{ github\.event\.before \}\}/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /secrets\.AUTOMERGE_TOKEN \|\| github\.token/);
  assert.ok(preflight >= 0 && preflight < revert, "parent CI preflight must run before git revert");
  assert.ok(preflight < rollback, "parent CI preflight must run before Vercel rollback");
  assert.match(workflow, /stop_without_revert\(\) \{[\s\S]*?send_alert[\s\S]*?exit 1/);
  assert.match(workflow, /if ! COMMIT_COUNT=\$\(git rev-list --count[\s\S]*?stop_without_revert/);
  assert.match(workflow, /if ! PREFLIGHT=\$\(node \.github\/scripts\/should-auto-revert\.mjs[\s\S]*?stop_without_revert/);
  assert.match(workflow, /if ! git fetch --quiet origin "\$GITHUB_REF_NAME"; then\n\s+stop_without_revert/);
  assert.match(workflow, /if \[ "\$PREFLIGHT_ACTION" != "proceed" \]; then\n\s+stop_without_revert/);
});
