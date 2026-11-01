const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const yaml = require("js-yaml");

const workflow = yaml.load(fs.readFileSync(".github/workflows/app-smoke.yml", "utf8"));
const validateScript = workflow.jobs.validate.steps.find((step) => step.id === "request").run;
const SHA = "6a2159078fb845751b1e00d045020a740bdba2c4";

function pr({ number = 1517, state = "open", draft = false, base = "production", sha = SHA } = {}) {
  return { number, state, draft, base: { ref: base, sha: "a".repeat(40) }, head: { sha, repo: { full_name: "hypertask-ai/hypertask" } } };
}

function runValidate({ requestPr = "", commitPulls = [], pullByNumber = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yper4-401-"));
  const fixtures = path.join(dir, "fixtures");
  fs.mkdirSync(fixtures);
  fs.writeFileSync(path.join(fixtures, "commit-pulls.json"), JSON.stringify(commitPulls));
  for (const [number, body] of Object.entries(pullByNumber)) {
    fs.writeFileSync(path.join(fixtures, `pull-${number}.json`), JSON.stringify(body));
  }
  const fakeGh = path.join(dir, "gh");
  fs.writeFileSync(
    fakeGh,
    `#!/usr/bin/env bash
echo "$*" >> "${dir}/gh-calls.log"
case "$*" in
  "api repos/hypertask-ai/hypertask/commits/${SHA}/pulls") cat "${fixtures}/commit-pulls.json" ;;
  "api repos/hypertask-ai/hypertask/pulls/"*) cat "${fixtures}/pull-\${2##*/}.json" ;;
  "api --method POST repos/hypertask-ai/hypertask/statuses/"*) echo '{}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 9 ;;
esac
`,
  );
  fs.chmodSync(fakeGh, 0o755);
  const output = path.join(dir, "github-output");
  fs.writeFileSync(output, "");
  const result = spawnSync("bash", ["-c", validateScript], {
    encoding: "utf8",
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      REPO: "hypertask-ai/hypertask",
      REQUEST_CONCLUSION: "success",
      REQUEST_HEAD_SHA: SHA,
      REQUEST_PR: requestPr,
      GITHUB_OUTPUT: output,
    },
  });
  const calls = fs.existsSync(path.join(dir, "gh-calls.log")) ? fs.readFileSync(path.join(dir, "gh-calls.log"), "utf8") : "";
  const outputs = Object.fromEntries(
    fs.readFileSync(output, "utf8").trim().split("\n").filter(Boolean).map((line) => line.split("=")),
  );
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls, outputs };
}

test("a request whose pull request was closed before validation stops quietly without a status", () => {
  const result = runValidate({ commitPulls: [pr({ state: "closed" })] });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.outputs.superseded, "true");
  assert.equal(result.outputs.pr, undefined);
  assert.doesNotMatch(result.calls, /statuses/);
});

test("a request whose pull request was closed after the lookup stops quietly without a status", () => {
  const result = runValidate({ requestPr: "1517", pullByNumber: { 1517: pr({ state: "closed" }) } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.outputs.superseded, "true");
  assert.doesNotMatch(result.calls, /statuses/);
});

test("a pull request pushed again after the request stops quietly; its new head has its own request", () => {
  const result = runValidate({ requestPr: "1517", pullByNumber: { 1517: pr({ sha: "f".repeat(40) }) } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.outputs.superseded, "true");
  assert.doesNotMatch(result.calls, /statuses/);
});

test("an open production pull request is still validated and marked pending", () => {
  const result = runValidate({ commitPulls: [pr()], pullByNumber: { 1517: pr() } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.outputs.pr, "1517");
  assert.equal(result.outputs["head-sha"], SHA);
  assert.equal(result.outputs.superseded, undefined);
  assert.match(result.calls, /statuses\/6a2159078/);
});

test("still refused: a draft pull request, a non-production base, or two open pull requests fail", () => {
  for (const [label, commitPulls] of [
    ["draft", [pr({ draft: true })]],
    ["two open", [pr(), pr({ number: 1518 })]],
  ]) {
    const result = runValidate({ commitPulls });
    assert.equal(result.status, 1, label);
    assert.match(result.stdout, /Request is not attached to one open production pull request/, label);
  }
  const otherBase = runValidate({ requestPr: "1517", pullByNumber: { 1517: pr({ base: "main" }) } });
  assert.equal(otherBase.status, 1);
  assert.match(otherBase.stdout, /Pull request changed after this request started/);
});

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const cancellationStep = workflow.jobs.validate.steps.find((step) => step.id === "current-request");
const REPOSITORY = "hypertask-ai/hypertask";
const BRANCH = "yper4-663-ci-queue";

function smokeRun({ id = 500, runNumber = id, requestNumber = 100, repository = REPOSITORY, branch = BRANCH, status = "in_progress" } = {}) {
  return { id, run_number: runNumber, status, display_title: `App Smoke request ${requestNumber} for ${repository}:${branch}` };
}

async function cancelOlder({ requestNumber = 200, runId = 600, runNumber = runId, pulls = [pr()], runs = [], cancelError, cancelMessage, limitedRead = false } = {}) {
  const calls = [];
  const cancelled = [];
  const waits = [];
  const warnings = [];
  const outputs = {};
  const previous = { PR: process.env.PR, HEAD_SHA: process.env.HEAD_SHA };
  process.env.PR = "1517";
  process.env.HEAD_SHA = SHA;
  let reads = 0;
  try {
    const { retryGithubRequest } = await import('../.github/scripts/github-rate-limit.mjs');
    const script = cancellationStep.with.script.replace(/^.*const \{ retryGithubRequest \} = await import.*\n/m, '');
    await new AsyncFunction("github", "context", "core", "retryGithubRequest", script)(
      {
        rest: {
          pulls: { get: async (params) => {
            assert.equal(params.pull_number, 1517);
            calls.push("head");
            if (limitedRead) {
              limitedRead = false;
              throw Object.assign(new Error('API rate limit exceeded for installation'), {
                status: 403, response: { headers: { 'retry-after': '1' } },
              });
            }
            return { data: pulls[Math.min(reads++, pulls.length - 1)] };
          } },
          actions: {
            listWorkflowRuns() {},
            cancelWorkflowRun: async ({ run_id }) => {
              calls.push(`cancel:${run_id}`);
              cancelled.push(run_id);
              if (cancelError) throw Object.assign(new Error(cancelMessage || "cancellation failed"), { status: cancelError });
            },
          },
        },
        paginate: async (_, params) => {
          calls.push(`list:${params.status}`);
          assert.equal(params.workflow_id, "app-smoke.yml");
          assert.equal(params.event, "workflow_run");
          assert.equal(params.per_page, 100);
          return runs.filter(run => run.status === params.status);
        },
      },
      {
        repo: { owner: "hypertask-ai", repo: "hypertask" }, runId, runNumber,
        payload: { workflow_run: { run_number: requestNumber, head_repository: { full_name: REPOSITORY }, head_branch: BRANCH } },
      },
      { setOutput: (name, value) => { outputs[name] = value; }, info() {}, warning: message => warnings.push(message) },
      request => retryGithubRequest(request, { sleep: async ms => { waits.push(ms); }, log() {}, ...(cancelMessage ? { budget: { reserve: () => { throw Object.assign(new Error(cancelMessage), { rateLimited: true }); } } } : {}) }),
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return { calls, cancelled, outputs, waits, warnings };
}

test("validation that stalls in checkout or scope cannot cancel the newest smoke", async () => {
  const validated = runValidate({ requestPr: "1517", pullByNumber: { 1517: pr() } });
  assert.equal(validated.status, 0);
  assert.equal(validated.outputs["head-sha"], SHA);
  for (const moved of [pr({ sha: "f".repeat(40) }), pr({ state: "closed" })]) {
    const result = await cancelOlder({ pulls: [moved], runs: [smokeRun({ requestNumber: 300 })] });
    assert.deepEqual(result.calls, ["head"]);
    assert.deepEqual(result.cancelled, []);
    assert.equal(result.outputs.superseded, "true");
  }
});

test("request order, not completion order, determines which same-branch smokes can be cancelled", async () => {
  const result = await cancelOlder({ runs: [
    smokeRun({ id: 900, requestNumber: 100 }),
    smokeRun({ id: 400, requestNumber: 300 }),
    smokeRun({ id: 599, requestNumber: 200, status: "queued" }),
    smokeRun({ id: 600, requestNumber: 200 }),
    smokeRun({ id: 601, requestNumber: 200 }),
    smokeRun({ id: 450, branch: "other-branch" }),
    smokeRun({ id: 451, repository: "fork/hypertask" }),
    smokeRun({ id: 452, status: "completed" }),
    { id: 453, status: "in_progress", display_title: "App Smoke production cache" },
    { id: 454, status: "in_progress", display_title: "App Smoke request 1 for malformed" },
  ] });
  assert.deepEqual(result.cancelled.sort((a, b) => a - b), [599, 900]);
  assert.equal(result.outputs.superseded, undefined);
  assert.equal(result.calls[0], "head");
  for (const id of result.cancelled) {
    assert.equal(result.calls[result.calls.indexOf(`cancel:${id}`) - 1], "head");
  }
});

test("old request reruns never cancel a newer request even with a stale head API response", async () => {
  const result = await cancelOlder({ requestNumber: 100, runId: 900, runs: [
    smokeRun({ id: 600, requestNumber: 200 }),
    smokeRun({ id: 950, requestNumber: 300 }),
  ] });
  assert.deepEqual(result.cancelled, []);
});

test("a push during run discovery stops cancellation and marks the request superseded", async () => {
  const result = await cancelOlder({ pulls: [pr(), pr({ sha: "f".repeat(40) })], runs: [smokeRun()] });
  assert.deepEqual(result.cancelled, []);
  assert.equal(result.outputs.superseded, "true");
});

test("a head change during cancellation cannot cancel a newer build or publish failure", async () => {
  const result = await cancelOlder({ pulls: [pr(), pr(), pr({ sha: "f".repeat(40) })], runs: [
    smokeRun({ id: 500 }), smokeRun({ id: 501 }), smokeRun({ id: 400, requestNumber: 300 }),
  ] });
  assert.deepEqual(result.cancelled, [500]);
  assert.equal(result.outputs.superseded, "true");
});

test("the final head read catches a push even when no older smoke needed cancellation", async () => {
  const result = await cancelOlder({ pulls: [pr(), pr({ sha: "f".repeat(40) })] });
  assert.deepEqual(result.cancelled, []);
  assert.equal(result.outputs.superseded, "true");
});

test("completed cancellation races are harmless but real cancellation errors fail closed", async () => {
  const finished = await cancelOlder({ runs: [smokeRun()], cancelError: 409 });
  assert.deepEqual(finished.cancelled, [500]);
  assert.equal(finished.outputs.superseded, undefined);
  await assert.rejects(cancelOlder({ runs: [smokeRun()], cancelError: 403 }), /cancellation failed/);
});

test("a GitHub rate limit while cancelling older runs warns and continues", async () => {
  const result = await cancelOlder({
    runs: [smokeRun(), smokeRun({ id: 501 })],
    cancelError: 403,
    cancelMessage: "API rate limit exceeded for installation",
  });
  assert.deepEqual(result.cancelled, [500]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Could not cancel older app-smoke runs; continuing the build/);
  assert.match(result.warnings[0], /rate limit exceeded for installation/);
});

test("same-request duplicates use workflow sequence numbers rather than run IDs", async () => {
  const result = await cancelOlder({ runId: 600, runNumber: 600, runs: [
    smokeRun({ id: 999, runNumber: 599, requestNumber: 200 }),
    smokeRun({ id: 100, runNumber: 601, requestNumber: 200 }),
  ] });
  assert.deepEqual(result.cancelled, [999]);
});

test("all active run states are eligible for ordered cancellation", async () => {
  const statuses = ["queued", "in_progress", "waiting", "pending", "requested"];
  const result = await cancelOlder({ runs: statuses.map((status, index) => smokeRun({ id: 500 + index, status })) });
  assert.deepEqual(result.cancelled, [500, 501, 502, 503, 504]);
});

test("ten smoke discovery replays wait after quota refusal then recheck the live head", async () => {
  for (let push = 0; push < 10; push++) {
    const result = await cancelOlder({ limitedRead: true, runs: [smokeRun()] });
    assert.deepEqual(result.waits, [1000]);
    assert.deepEqual(result.cancelled, [500]);
    assert.deepEqual(result.calls.slice(0, 2), ['head', 'head']);
    assert.equal(result.outputs.superseded, undefined);
    const stale = await cancelOlder({ limitedRead: true, pulls: [pr({ sha: 'f'.repeat(40) })], runs: [smokeRun()] });
    assert.deepEqual(stale.waits, [1000]);
    assert.deepEqual(stale.cancelled, []);
    assert.equal(stale.outputs.superseded, 'true');
  }
});
