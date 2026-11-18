const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const yaml = require("js-yaml");

const workflow = yaml.load(readFileSync(".github/workflows/ci-tests.yml", "utf8"));

test("no ci-tests job stops the build on a review verdict", () => {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const condition = String(job.if ?? "");
    assert.equal(/ai-review|claude-review|codex/i.test(condition), false, `${name} is gated on a review`);
  }
});

test("ci-prepare never reads review statuses and holds no statuses permission", () => {
  const prepare = workflow.jobs["ci-prepare"];
  const steps = prepare.steps.map((step) => String(step.run ?? ""));
  assert.equal(steps.some((run) => /ai-review|claude-review|codex|commits\/.*status/i.test(run)), false);
  assert.equal(prepare.steps.some((step) => /review/i.test(String(step.name ?? ""))), false);
  assert.equal(prepare.permissions.statuses, undefined);
});

test("the review contexts still block a merge until an administrator removes them", () => {
  const policy = yaml.load(readFileSync("docs/ci-policy.yml", "utf8"));
  for (const context of ["ai-review", "claude-review"]) {
    assert.equal(policy.required_checks.contexts.includes(context), true);
    assert.equal(policy.policies.production_ruleset.required_status_checks.includes(context), true);
  }
});
