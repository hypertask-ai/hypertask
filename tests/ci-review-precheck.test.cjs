const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const yaml = require("js-yaml");

const workflow = yaml.load(readFileSync(".github/workflows/ci-tests.yml", "utf8"));
const step = workflow.jobs["ci-prepare"].steps.find(
  (step) => step.name === "Skip the build when the review is already red",
);

function runPrecheck({ state = "none", status = 0 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "ci-review-precheck-"));
  const calls = join(directory, "calls");
  try {
    writeFileSync(join(directory, "gh"), `#!/bin/sh
printf '%s\\n' "$1" >> "$CALL_LOG"
if [ "$GH_STATUS" != 0 ]; then
  echo 'gh: API rate limit exceeded for installation. (HTTP 403)' >&2
  exit "$GH_STATUS"
fi
printf '%s\\n' "$REVIEW_STATE"
`, { mode: 0o755 });
    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c",
      `${step.run.replaceAll("${{ github.repository }}", "test/repo")}\nprintf 'tests reached\\n'`,
    ], {
      encoding: "utf8",
      timeout: 5_000,
      env: {
        PATH: directory,
        HEAD_SHA: "a".repeat(40),
        GH_STATUS: String(status),
        REVIEW_STATE: state,
        CALL_LOG: calls,
      },
    });
    assert.ifError(result.error);
    return {
      ...result,
      output: result.stdout + result.stderr,
      calls: readFileSync(calls, "utf8").trim().split("\n"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const state of ["success", "none"]) {
  test(`${state} review allows tests to start`, () => {
    const result = runPrecheck({ state });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /tests reached/);
    assert.equal(result.calls.length, 1);
  });
}

test("known failed review still refuses to start tests", () => {
  const result = runPrecheck({ state: "failure" });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /GitHub AI Review already failed/);
  assert.doesNotMatch(result.output, /tests reached/);
});

test("ten consecutive rate-limited pushes still start tests without retries", () => {
  for (let push = 0; push < 10; push++) {
    const result = runPrecheck({ status: 1 });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /tests reached/);
    assert.match(result.output, /::warning::.*required.*review/i);
    assert.equal(result.calls.length, 1);
  }
});

test("independent required review contexts remain mandatory", () => {
  const policy = yaml.load(readFileSync("docs/ci-policy.yml", "utf8"));
  for (const context of ["ai-review", "claude-review"]) {
    assert.ok(policy.required_checks.contexts.includes(context));
    assert.ok(policy.policies.production_ruleset.required_status_checks.includes(context));
  }
});
