const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const load = name => yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8'));
const workflow = load('claude-review.yml');
const parsed = JSON.stringify(workflow);
const job = workflow.jobs.review;

test('HYCI-456 the second review lane spends nothing until a person dispatches it', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.ok(workflow.on.workflow_dispatch.inputs.pr.required);
  assert.equal(workflow.on.pull_request, undefined);
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.equal(workflow.on.workflow_run, undefined);
  assert.equal(job.if, undefined);
  assert.equal(fs.existsSync(path.join(__dirname, '../.github/workflows/claude-review-request.yml')), false);
});

test('HYCI-456 the lane checks out the production branch, not the pull request', () => {
  const checkout = job.steps.find(step => step.uses && step.uses.startsWith('actions/checkout'));
  assert.equal(checkout.with.ref, 'production');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(checkout.with['sparse-checkout'], '.github/scripts');
});

test('HYCI-456 fork, draft and dependabot PRs never reach the secret', () => {
  const target = job.steps.find(step => step.id === 'target').with.script;
  assert.ok(target.includes("pr.head.repo?.full_name === `${owner}/${repo}`"));
  assert.ok(target.includes("pr.user?.login !== 'dependabot[bot]'"));
  assert.ok(target.includes('!pr.draft'));
  assert.ok(target.includes('PR_INPUT'));
  assert.equal(target.includes('workflow_run'), false);
});

test('HYCI-456 the lane has minimal permissions and runs on a hosted runner', () => {
  assert.deepEqual(workflow.permissions, {
    contents: 'read', issues: 'read', 'pull-requests': 'write', statuses: 'write', checks: 'write',
  });
  assert.equal(job['runs-on'], 'ubuntu-latest');
});

test('HYCI-456 one run per pull request, a second dispatch cancels the first', () => {
  assert.equal(workflow.concurrency.group, 'review-${{ inputs.pr }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
});

test('HYCI-456 only the subscription token is used, only in the steps that need it, never a paid API key', () => {
  assert.ok(parsed.includes('secrets.CLAUDE_CODE_OAUTH_TOKEN'));
  for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER', 'OPENCODE']) assert.ok(!parsed.includes(name));
  assert.ok(job.steps.some(step => (step.run || '').includes('exit 1')));
  assert.equal(job.env, undefined);
  const holders = job.steps.filter(step => JSON.stringify(step.env || {}).includes('CLAUDE_CODE_OAUTH_TOKEN'));
  assert.deepEqual(holders.map(step => step.name), ['Require the Claude subscription token', 'Review the diff']);
  const install = job.steps.find(step => (step.run || '').includes('npm install'));
  assert.equal(install.env, undefined);
});

test('HYCI-456 every action is pinned to a commit and the CLI to a version', () => {
  for (const step of job.steps.filter(entry => entry.uses)) assert.match(step.uses, /@[0-9a-f]{40}$/);
  assert.ok(job.steps.some(step => /@anthropic-ai\/claude-code@\d+\.\d+\.\d+(\s|$)/.test(step.run || '')));
});
