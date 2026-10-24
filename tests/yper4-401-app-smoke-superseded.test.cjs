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

test("the smoke and report jobs are skipped for a superseded request", () => {
  assert.equal(workflow.jobs.validate.outputs.superseded, "${{ steps.request.outputs.superseded }}");
  assert.equal(workflow.jobs["app-smoke"].if, "needs.validate.outputs.superseded != 'true' && needs.validate.outputs.docs-only != 'true'");
  assert.match(workflow.jobs.report.if, /needs\.validate\.outputs\.superseded != 'true'$/);
});
