const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const workflowPath = path.resolve(__dirname, "../.github/workflows/ci-tests.yml");
const scriptUrl = pathToFileURL(
  path.resolve(__dirname, "../.github/scripts/should-auto-revert.mjs"),
).href;
const CURRENT_SHA = "1111111111111111111111111111111111111111";

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function statuses(state) {
  const payload = { statuses: [] };
  if (state) payload.statuses.push({ context: "prod-health-gate", state });
  payload.statuses.push({ context: "ci-tests", state: "failure" });
  return payload;
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
    CURRENT_SHA,
    "test-token",
    fetchImpl,
    async (ms) => delays.push(ms),
  );
  return { result, calls, delays };
}

const statusPrefix =
  "https://api.github.com/repos/hypertask-ai/hypertask/commits/1111111111111111111111111111111111111111/status";

test("only a failed live-site health check on this deploy allows a revert", async () => {
  const { result, calls } = await evaluate({
    [statusPrefix]: [response(200, statuses("failure"))],
  });

  assert.equal(result.action, "proceed");
  assert.match(result.reason, /live website failed its health check/);
  assert.match(calls[0], /commits\/1111.*\/status/);
  assert.equal(calls.length, 1);
});

test("a healthy live site blocks the revert even when unit tests are red", async () => {
  const { result, calls, delays } = await evaluate({
    [statusPrefix]: [response(200, statuses("success"))],
  });

  assert.equal(result.action, "skip");
  assert.match(result.reason, /live website is healthy/);
  assert.match(result.reason, /unit-test failure is not a reason/);
  assert.equal(calls.length, 1);
  assert.deepEqual(delays, []);
});

test("a missing or unfinished health check fails closed without reverting", async () => {
  const { result, calls, delays } = await evaluate({
    [statusPrefix]: [response(200, statuses(""))],
  });

  assert.equal(result.action, "skip");
  assert.match(result.reason, /has not finished/);
  assert.match(result.reason, /after 3 attempts/);
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [10_000, 10_000]);
});

test("GitHub API failures retry and then fail closed", async () => {
  const { result, calls, delays } = await evaluate({
    [statusPrefix]: [response(503, {})],
  });

  assert.equal(result.action, "skip");
  assert.match(result.reason, /live-site health lookup failed: HTTP 503/);
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [10_000, 10_000]);
});

test("the workflow checks this deploy's live health and never the previous unit-test run", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const preflight = workflow.indexOf("node .github/scripts/should-auto-revert.mjs");
  const revert = workflow.indexOf('git revert $MAINLINE --no-commit "$GITHUB_SHA"');
  const rollback = workflow.indexOf('emergency_rollback "push refused');

  assert.match(workflow, /auto-revert-production:[\s\S]*?permissions:\n\s+actions: read/);
  assert.match(workflow, /BEFORE_SHA: \$\{\{ github\.event\.before \}\}/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(
    workflow,
    /should-auto-revert\.mjs "\$GITHUB_REPOSITORY" "\$GITHUB_SHA"/,
  );
  assert.doesNotMatch(workflow, /should-auto-revert\.mjs "\$GITHUB_REPOSITORY" "\$BEFORE_SHA"/);
  assert.doesNotMatch(workflow, /actions\/workflows\/ci-tests\.yml\/runs/);
  assert.doesNotMatch(workflow, /secrets\.AUTOMERGE_TOKEN \|\| github\.token/);
  assert.ok(preflight >= 0 && preflight < revert, "health preflight must run before git revert");
  assert.ok(preflight < rollback, "health preflight must run before Vercel rollback");
  assert.match(workflow, /stop_without_revert\(\) \{[\s\S]*?send_alert[\s\S]*?exit 1/);
  assert.match(workflow, /if ! COMMIT_COUNT=\$\(git rev-list --count[\s\S]*?stop_without_revert/);
  assert.match(workflow, /if ! PREFLIGHT=\$\(node \.github\/scripts\/should-auto-revert\.mjs[\s\S]*?stop_without_revert/);
  assert.match(workflow, /if ! git fetch --quiet origin "\$GITHUB_REF_NAME"; then\n\s+stop_without_revert/);
  assert.match(workflow, /if \[ "\$PREFLIGHT_ACTION" != "proceed" \]; then\n\s+stop_without_revert/);
  assert.match(workflow, /did not change the live website/);
  assert.match(workflow, /Check https:\/\/app\.hypertask\.ai/);
});

test("the runner isolates the three production-flake suites before the shared run", async () => {
  const source = await readFile(path.resolve(__dirname, "../scripts/run-tests.mjs"), "utf8");
  for (const file of [
    "tests/agent-run-activities.test.cjs",
    "tests/action-archive-cache.test.cjs",
    "tests/feature-flags.test.cjs",
  ]) {
    assert.match(source, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const isolatedAt = source.indexOf("tests/agent-run-activities.test.cjs");
  const sharedAt = source.indexOf('"Node test suite"');
  assert.ok(isolatedAt !== -1 && isolatedAt < sharedAt);
});
