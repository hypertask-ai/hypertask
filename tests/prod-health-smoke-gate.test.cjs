const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const yaml = require("js-yaml");

const WORKFLOW_PATH = ".github/workflows/prod-health.yml";
const workflowText = readFileSync(WORKFLOW_PATH, "utf8");
const workflow = yaml.load(workflowText);

const SHA = "a".repeat(40);
const HEALTH_START = "2026-11-02T10:00:00Z";
const RUN_URL = "https://github.com/hypertask-ai/hypertask/actions/runs/1";
const OTHER_RUN_URL = "https://github.com/hypertask-ai/hypertask/actions/runs/999";

function smokeStep(id) {
  const step = workflow.jobs.smoke.steps.find((item) => item.id === id);
  assert.ok(step, `smoke step ${id} not found`);
  return step;
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function outputValue(text, key) {
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(text);
  return match ? match[1] : undefined;
}

function healthJobs(conclusion, startedAt = HEALTH_START) {
  return JSON.stringify({ jobs: [{ name: "health", conclusion, started_at: startedAt }] });
}

function gateStatuses(state, options = {}) {
  return JSON.stringify([
    {
      context: "prod-health-gate",
      state,
      target_url: options.targetUrl === undefined ? RUN_URL : options.targetUrl,
      created_at: options.createdAt === undefined ? "2026-11-02T10:20:00Z" : options.createdAt,
    },
  ]);
}

const CURL_STUB = `#!/usr/bin/env bash
set -u
out=""
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -H|--max-time|-w) shift 2 ;;
    *) url="$1"; shift ;;
  esac
done
jobs_calls=0
if [ -n "\${CALLS_FILE:-}" ]; then
  jobs_calls=$(cat "$CALLS_FILE" 2>/dev/null || echo 0)
  echo $((jobs_calls + 1)) > "$CALLS_FILE"
fi
code="\${STUB_HTTP_CODE:-200}"
body='{"message":"stub"}'
case "$url" in
  *"/jobs"*)
    body="\${JOBS_JSON:-}"
    if [ -z "$body" ]; then body='{"jobs":[]}'; fi
    code="\${JOBS_HTTP_CODE:-$code}"
    if [ "$jobs_calls" = "0" ]; then
      if [ -n "\${JOBS_FIRST_JSON:-}" ]; then body="$JOBS_FIRST_JSON"; fi
      if [ -n "\${JOBS_FIRST_HTTP_CODE:-}" ]; then code="$JOBS_FIRST_HTTP_CODE"; fi
    fi
    ;;
  *"/statuses"*)
    body="\${STATUSES_JSON:-[]}"
    code="\${STATUSES_HTTP_CODE:-$code}"
    ;;
esac
if [ -n "$out" ]; then printf '%s' "$body" > "$out"; fi
printf '%s' "$code"
`;

const SLEEP_STUB = "#!/bin/sh\nexit 0\n";

function runGate(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "prod-health-gate-"));
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "curl"), CURL_STUB, { mode: 0o755 });
  writeFileSync(join(bin, "sleep"), SLEEP_STUB, { mode: 0o755 });
  const output = join(directory, "output.txt");
  const summary = join(directory, "summary.txt");
  const result = spawnSync("bash", ["-c", smokeStep("gate").run], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CALLS_FILE: join(directory, "calls.txt"),
      RUNNER_TEMP: directory,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_TOKEN: "stub",
      GITHUB_REPOSITORY: "hypertask-ai/hypertask",
      RUN_ID: "1",
      SHA,
      EVENT_NAME: "push",
      GATE_BUDGET_SECONDS: "1",
      ...overrides,
    },
  });
  const written = readText(output);
  const writtenSummary = readText(summary);
  rmSync(directory, { recursive: true, force: true });
  return { result, written, writtenSummary };
}

test("smoke starts with the push, after its deploy-independent setup", () => {
  assert.equal(workflow.jobs.smoke.needs, undefined);
  const names = workflow.jobs.smoke.steps.map((step) => step.id || step.name);
  const npm = names.indexOf("setup-npm");
  const gate = names.indexOf("gate");
  const run = names.indexOf("smoke");
  assert.ok(npm !== -1 && gate !== -1 && run !== -1, `unexpected steps: ${names.join(", ")}`);
  assert.ok(npm < gate && gate < run, `unexpected step order: ${names.join(", ")}`);
});

test("the browser checks and their classifier still need the gate verdict", () => {
  assert.match(smokeStep("smoke").if, /steps\.gate\.outputs\.ok == 'true'/);
  assert.match(smokeStep("decide").if, /steps\.gate\.outputs\.ok == 'true'/);
  const run = smokeStep("gate").run;
  assert.ok(run.includes('[.jobs[] | select(.name == "health")][0].conclusion'));
  assert.ok(run.includes('[.jobs[] | select(.name == "health")][0].started_at'));
  assert.ok(run.includes('select(.context == "prod-health-gate")'));
  assert.ok(run.includes('select((.target_url // "") | contains("/runs/" + $run))'));
  assert.ok(run.includes("select(.created_at >= $since)"));
  assert.ok(run.includes('[ "$state" = "success" ]'));
  assert.ok(run.indexOf('name == "health"') < run.indexOf('context == "prod-health-gate"'));
});

test("the health job scopes its published verdict to its own run", () => {
  const health = workflow.jobs.health.steps.find((step) => step.id === "check");
  assert.ok(health.run.includes("target_url"));
  assert.ok(health.run.includes("/actions/runs/${GITHUB_RUN_ID}"));
});

test("the wait covers the whole health budget without outliving the job", () => {
  const gate = smokeStep("gate").run;
  const budget = /GATE_BUDGET_SECONDS:-(\d+)/.exec(gate);
  assert.ok(budget, "the gate budget is not readable");
  assert.ok(Number(budget[1]) >= workflow.jobs.health["timeout-minutes"] * 60);
  const jobTimeout = workflow.jobs.smoke["timeout-minutes"];
  assert.ok(jobTimeout * 60 > Number(budget[1]) + 300, `job timeout ${jobTimeout} leaves no room after the wait`);
});

test("a speculative setup cannot hold a rollback the health job requested", () => {
  for (const id of ["setup-npm", "setup-pw"]) {
    const limit = smokeStep(id)["timeout-minutes"];
    assert.ok(limit, `${id} has no step timeout`);
    assert.ok(limit <= workflow.jobs["core-actions"]["timeout-minutes"], `${id} waits ${limit} minutes`);
  }
});

test("an unreadable verdict is reported red instead of skipped green", () => {
  const report = workflow.jobs.smoke.steps.find((step) => step.id === "gate-unreadable");
  assert.ok(report, "no step reports an unreadable verdict");
  assert.match(report.if, /steps\.gate\.outcome == 'failure'/);
  assert.match(report.run, /^exit 1$/m);
  assert.equal(workflow.jobs.smoke.outputs.rollback, "${{ steps.alarm.outputs.rollback }}");
});

test("a live healthy verdict for this run runs the browser checks", () => {
  const { result, written } = runGate({
    JOBS_JSON: healthJobs("success"),
    STATUSES_JSON: gateStatuses("success"),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(written, "ok"), "true");
  assert.match(result.stdout, /live and healthy; running the browser checks/);
});

test("a still-running health job is polled, not treated as a verdict", () => {
  const { result, written } = runGate({
    JOBS_FIRST_JSON: healthJobs(null),
    JOBS_JSON: healthJobs("success"),
    STATUSES_JSON: gateStatuses("success"),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(written, "ok"), "true");
});

test("a failed health job skips the checks", () => {
  const { result, written } = runGate({
    JOBS_JSON: healthJobs("failure"),
    STATUSES_JSON: gateStatuses("success"),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(written, "ok"), "false");
  assert.match(result.stdout, /ended 'failure'/);
});

test("a health success with nothing to check skips the checks", () => {
  const { result, written } = runGate({ JOBS_JSON: healthJobs("success"), STATUSES_JSON: "[]" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(written, "ok"), "false");
  assert.match(result.stdout, /without a live verdict/);
});

test("a failed verdict is never overridden by a success elsewhere", () => {
  const { result, written } = runGate({
    JOBS_JSON: healthJobs("success"),
    STATUSES_JSON: gateStatuses("failure"),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(written, "ok"), "false");
});

test("a success from another run does not authorise this run's checks", () => {
  const { result, written } = runGate({
    JOBS_JSON: healthJobs("success"),
    STATUSES_JSON: gateStatuses("success", { targetUrl: OTHER_RUN_URL }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(written, "ok"), "false");
  assert.match(result.stdout, /without a live verdict/);
});

test("a verdict older than this run's health job does not authorise them either", () => {
  const { result, written } = runGate({
    JOBS_JSON: healthJobs("success", "2026-11-02T11:00:00Z"),
    STATUSES_JSON: gateStatuses("success", { createdAt: "2026-11-02T10:20:00Z" }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(written, "ok"), "false");
});

test("a manual dispatch runs the checks with nothing to wait for", () => {
  const { result, written } = runGate({ EVENT_NAME: "workflow_dispatch", JOBS_JSON: "{}", STATUSES_JSON: "[]" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(written, "ok"), "true");
  assert.match(result.stdout, /Manual run/);
});

test("an unreadable job list ends the wait as an error, not a skip", () => {
  const { result, written, writtenSummary } = runGate({
    JOBS_HTTP_CODE: "500",
    STATUSES_JSON: gateStatuses("success"),
  });
  assert.equal(result.status, 1, result.stdout);
  assert.equal(outputValue(written, "ok"), "false");
  assert.match(result.stdout, /::error::could not read this run's jobs/);
  assert.match(writtenSummary, /the browser checks did not run/);
});

test("an unreadable verdict ends the wait as an error, not a skip", () => {
  const { result, written } = runGate({
    JOBS_JSON: healthJobs("success"),
    STATUSES_HTTP_CODE: "500",
  });
  assert.equal(result.status, 1, result.stdout);
  assert.equal(outputValue(written, "ok"), "false");
  assert.match(result.stdout, /::error::could not read the production health verdict/);
});

test("a transient read failure is retried before any verdict is claimed", () => {
  const { result, written } = runGate({
    JOBS_FIRST_HTTP_CODE: "500",
    JOBS_JSON: healthJobs("success"),
    STATUSES_JSON: gateStatuses("success"),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(outputValue(written, "ok"), "true");
});
