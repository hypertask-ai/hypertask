const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const load = name => yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8'));
const request = load('claude-review-request.yml');
const workflow = load('claude-review.yml');
const parsed = JSON.stringify(workflow);
const job = workflow.jobs.review;
const requestJob = request.jobs.request;

test('HYCI-456 the request stage runs on pull_request with no secret and read-only permissions', () => {
  assert.ok(request.on.pull_request);
  assert.equal(request.on.pull_request_target, undefined);
  assert.deepEqual(request.permissions, { contents: 'read' });
  assert.ok(!JSON.stringify(request).includes('secrets.'));
  assert.ok(!requestJob.steps.some(step => step.uses && step.uses.startsWith('actions/checkout')));
  assert.match(requestJob.if, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
});

test('HYCI-456 the trusted stage runs from base code on workflow_run and never on pull_request_target', () => {
  assert.deepEqual(workflow.on.workflow_run.workflows, [request.name]);
  assert.deepEqual(workflow.on.workflow_run.types, ['completed']);
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.ok(workflow.on.workflow_dispatch.inputs.pr.required);
  assert.match(job.if, /github\.event\.workflow_run\.conclusion == 'success'/);
});

test('HYCI-456 the trusted stage checks out the production branch, not the pull request, and never runs on pull_request', () => {
  const checkout = job.steps.find(step => step.uses && step.uses.startsWith('actions/checkout'));
  assert.equal(checkout.with.ref, 'production');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(checkout.with['sparse-checkout'], '.github/scripts');
  assert.equal(workflow.on.pull_request, undefined);
  assert.ok(!job.if.includes("github.event_name == 'pull_request'"));
});

test('HYCI-456 fork and dependabot PRs never reach the secret and a stale head is skipped', () => {
  const target = job.steps.find(step => step.id === 'target').with.script;
  assert.ok(target.includes("pr.head.repo?.full_name === `${owner}/${repo}`"));
  assert.ok(target.includes("pr.user?.login !== 'dependabot[bot]'"));
  assert.ok(target.includes('pr.head.sha === run.head_sha'));
});

test('HYCI-456 the trusted stage has minimal permissions and runs on a hosted runner', () => {
  assert.deepEqual(workflow.permissions, {
    contents: 'read', issues: 'read', 'pull-requests': 'write', statuses: 'write', checks: 'write',
  });
  assert.equal(job['runs-on'], 'ubuntu-latest');
});

test('HYCI-456 one parallel run per pull request, a newer push cancels the older run', () => {
  assert.match(workflow.concurrency.group, /format\('review-\{0\}-\{1\}', github\.event\.workflow_run\.pull_requests\[0\]\.number, github\.event\.workflow_run\.head_sha\)/);
  assert.match(workflow.concurrency.group, /format\('review-\{0\}-manual', inputs\.pr\)/);
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
  for (const step of requestJob.steps.filter(entry => entry.uses)) assert.match(step.uses, /@[0-9a-f]{40}$/);
  assert.ok(job.steps.some(step => /@anthropic-ai\/claude-code@\d+\.\d+\.\d+(\s|$)/.test(step.run || '')));
});

test('HYCI-456 REVIEWER is a repo variable read at run time by both review workflows', () => {
  const gate = load('codex-review-gate.yml');
  const gateStep = gate.jobs.gate.steps.find(step => step.uses && step.uses.startsWith('actions/github-script'));
  assert.equal(gateStep.env.REVIEWER, '${{ vars.REVIEWER }}');
  const target = job.steps.find(step => step.id === 'target');
  assert.equal(target.env.REVIEWER, '${{ vars.REVIEWER }}');
  const publish = job.steps.find(step => step.name && step.name.startsWith('Publish'));
  assert.equal(publish.env.REVIEWER, '${{ vars.REVIEWER }}');
  assert.ok(!JSON.stringify(workflow).includes('review-switch'));
  assert.ok(!JSON.stringify(gate).includes('review-switch'));
});

test('HYCI-456 a Codex usage limit comment is the only comment that starts a Claude review', () => {
  assert.deepEqual(workflow.on.issue_comment.types, ['created']);
  assert.match(job.if, /github\.event\.comment\.user\.login == 'chatgpt-codex-connector\[bot\]'/);
  assert.match(job.if, /contains\(github\.event\.comment\.body, 'usage limits have been reached'\)/);
  assert.match(job.if, /github\.event\.issue\.pull_request != null/);
  assert.match(workflow.concurrency.group, /github\.run_id/);
  const target = job.steps.find(step => step.id === 'target').with.script;
  assert.ok(target.includes("reviewer === (fallback ? 'codex' : 'claude')"));
});

test('HYCI-456 when Claude hits its usage limit the same run asks Codex once', () => {
  const review = job.steps.find(step => step.id === 'review');
  assert.equal(review.env.REVIEW_HANDOFF, '${{ steps.target.outputs.handoff }}');
  const handoff = job.steps.find(step => step.name && step.name.startsWith('Hand the review to Codex'));
  assert.equal(handoff.if, "steps.review.outputs.handoff == 'codex'");
  assert.ok(handoff.with.script.includes('codex-review-request:${sha}'));
  assert.ok(handoff.with.script.includes('@codex review'));
  assert.ok(!JSON.stringify(handoff).includes('secrets.'));
  const publish = job.steps.find(step => step.name && step.name.startsWith('Publish'));
  assert.match(publish.if, /steps\.review\.outputs\.handoff != 'codex'/);
});
