const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const file = path.join(__dirname, '../.github/workflows/claude-review.yml');
const text = fs.readFileSync(file, 'utf8');
const workflow = yaml.load(text);
const job = workflow.jobs.review;

test('HYCI-416 claude review runs on pull_request, never pull_request_target', () => {
  assert.ok(workflow.on.pull_request);
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.deepEqual(workflow.on.pull_request.types, ['opened', 'reopened', 'synchronize', 'ready_for_review']);
  assert.ok(workflow.on.workflow_dispatch.inputs.pr.required);
});

test('HYCI-416 fork and dependabot PRs never reach the secret', () => {
  assert.match(job.if, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(job.if, /github\.actor != 'dependabot\[bot\]'/);
});

test('HYCI-416 claude review has minimal permissions and runs on a hosted runner', () => {
  assert.deepEqual(workflow.permissions, {
    contents: 'read', issues: 'read', 'pull-requests': 'write', statuses: 'write', checks: 'write',
  });
  assert.equal(job['runs-on'], 'ubuntu-latest');
});

test('HYCI-416 one parallel run per pull request, a newer push cancels the older run', () => {
  assert.equal(workflow.concurrency.group, 'review-${{ github.event.pull_request.number || inputs.pr }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
});

test('HYCI-416 only the subscription token is used, never a paid API key', () => {
  assert.match(text, /secrets\.CLAUDE_CODE_OAUTH_TOKEN/);
  assert.doesNotMatch(text, /ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENROUTER|OPENCODE/);
  assert.match(text, /exit 1/);
});

test('HYCI-416 every action is pinned to a commit and the CLI to a version', () => {
  for (const step of job.steps.filter(entry => entry.uses)) assert.match(step.uses, /@[0-9a-f]{40}$/);
  assert.match(text, /@anthropic-ai\/claude-code@\d+\.\d+\.\d+\b/);
});
