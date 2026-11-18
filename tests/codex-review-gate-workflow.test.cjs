const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows/codex-review-gate.yml'), 'utf8'));

test('codex review gate runs only the script from the production branch', () => {
  const [checkout, gate] = workflow.jobs.gate.steps;
  assert.equal(checkout.with.ref, 'production');
  assert.equal(checkout.with['sparse-checkout'], '.github/scripts');
  assert.equal(gate.if, "hashFiles('.github/scripts/codex-review-gate.cjs') != ''");
});

test('codex review gate wakes on a review, a review comment or a comment, never on a push', () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ['issue_comment', 'pull_request_review', 'pull_request_review_comment', 'schedule', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.issue_comment.types, ['created', 'edited']);
  assert.deepEqual(workflow.on.pull_request_review.types, ['submitted']);
  assert.deepEqual(workflow.on.pull_request_review_comment.types, ['created']);
  assert.ok(!workflow.jobs.gate.if.includes("github.event_name == 'pull_request_target'"));
  assert.ok(workflow.jobs.gate.if.includes("github.event_name == 'schedule'"));
});
