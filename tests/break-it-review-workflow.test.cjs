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
