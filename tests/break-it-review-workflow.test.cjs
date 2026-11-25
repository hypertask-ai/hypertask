const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const yaml = require("js-yaml");

const workflow = yaml.load(readFileSync(".github/workflows/break-it-review.yml", "utf8"));
const policy = yaml.load(readFileSync("docs/ci-policy.yml", "utf8")).break_it_review;
const job = workflow.jobs["break-it"];

test("a bug fix pull request is the only thing that starts break-it", () => {
  assert.deepEqual(Object.keys(workflow.on), ["pull_request_target"]);
  assert.equal(workflow.on.pull_request_target.branches.includes("production"), true);
  for (const type of ["opened", "synchronize", "reopened", "edited", "ready_for_review"]) {
    assert.equal(workflow.on.pull_request_target.types.includes(type), true, type);
  }
});

test("one job runs it, and only for a ready [BUGFIX] pull request from this repository", () => {
  assert.deepEqual(Object.keys(workflow.jobs), ["break-it"]);
  assert.equal(job.if.includes("'[BUGFIX]'"), true);
  assert.equal(job.if.includes("draft == false"), true);
  assert.equal(job.if.includes("head.repo.full_name == github.repository"), true);
});

test("the review stays a signal and never a required check", () => {
  assert.deepEqual([policy.mode, policy.required, policy.jobs_per_push], ["report_only", false, 1]);
  assert.deepEqual(policy.triggers, ["pull_request_target"]);
  assert.equal(policy.paid_requests_per_bugfix_pr, "at most 2");
});

test("the breaker reaches a model through the ladder checked out beside the sandbox", () => {
  const ladder = yaml.load(readFileSync(".github/workflows/pstack-verifier.yml", "utf8"));
  const pin = (steps) => steps.map((step) => step.with).find((withBlock) => withBlock?.path === "token-ladder")?.ref;
  const askIndex = job.steps.findIndex((step) => step.name === "Ask another model family to break the fix");
  const checkoutIndex = job.steps.findIndex((step) => step.with?.path === "token-ladder");
  assert.notEqual(checkoutIndex, -1);
  assert.notEqual(askIndex, -1);
  assert.equal(checkoutIndex < askIndex, true);
  assert.deepEqual(job.steps[checkoutIndex].with, {
    repository: "valentinyeo/token-ladder",
    ref: pin(job.steps),
    path: "token-ladder",
    "fetch-depth": 1,
    "persist-credentials": false,
  });
  assert.equal(/^[0-9a-f]{40}$/.test(pin(job.steps)), true);
  const verifierPins = Object.values(ladder.jobs).flatMap((each) => pin(each.steps ?? []) ?? []).filter(Boolean);
  assert.equal(verifierPins.length > 0, true);
  assert.deepEqual([...new Set(verifierPins)], [pin(job.steps)]);
  const ask = job.steps[askIndex];
  assert.equal(ask.env.LADDER_CALL_BIN, "${{ github.workspace }}/token-ladder/ci/ladder-call");
  assert.equal(ask.env.LADDER_CALL_ROOT, "${{ github.workspace }}/token-ladder");
  for (const name of ["AI_GATEWAY_API_KEY", "OPENCODE_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_EVAL_KEY", "PSTACK_VERIFIER_ALT_MODEL"]) {
    assert.notEqual(ask.env[name], undefined, name);
  }
  assert.equal(ask.env.OPENROUTER_API_KEY, ask.env.OPENROUTER_EVAL_KEY);
});
