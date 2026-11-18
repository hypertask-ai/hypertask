const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const yaml = require('js-yaml');
const workflow = name => yaml.load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const evaluate = (expression, github) => vm.runInNewContext(expression, { github, always: () => true });

test('PR app-smoke publishes the required commit status without candidate execution', async () => {
  const smoke = workflow('app-smoke');
  assert.deepEqual(workflow('app-smoke-request').on.pull_request, { branches: ['production'], types: ['opened', 'synchronize', 'reopened', 'ready_for_review'] });
  const stub = smoke.jobs['pr-status'];
  assert.equal(evaluate(stub.if, { event_name: 'workflow_run', event: { workflow_run: { event: 'pull_request', conclusion: 'success' } } }), true);
  assert.equal(evaluate(stub.if, { event_name: 'schedule' }), false);
  assert.deepEqual(stub.permissions, { contents: 'read', 'pull-requests': 'read', statuses: 'write' });
  assert.equal(stub.needs, undefined);
  assert.equal(stub.services, undefined);
  assert.equal(stub.steps.length, 1);
  assert.match(stub.steps[0].uses, /^actions\/github-script@[a-f0-9]{40}$/);
  const published = [];
  const head = 'a'.repeat(40);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const publish = new AsyncFunction('github', 'context', stub.steps[0].with.script);
  const pull = { state: 'open', base: { ref: 'production' }, head: { sha: head } };
  const github = { rest: { repos: {
    listPullRequestsAssociatedWithCommit: async () => ({ data: [pull] }),
    createCommitStatus: async args => published.push(args),
  } } };
  const context = { repo: { owner: 'owner', repo: 'repository' }, payload: { workflow_run: { head_sha: head } }, sha: 'base-sha' };
  await publish(github, context);
  assert.deepEqual(published, [{ owner: 'owner', repo: 'repository', sha: head, state: 'success', context: 'app-smoke', description: 'moved to nightly (HTPR-9450)' }]);
  pull.head.sha = 'newer-head';
  await publish(github, context);
  assert.equal(published.length, 1);
});

test('PR browser-smoke succeeds without running shard or contract checks', () => {
  const ci = workflow('ci-tests');
  const stub = ci.jobs['browser-smoke'];
  const github = { event_name: 'pull_request', event: { pull_request: { draft: true } } };
  assert.equal(evaluate(stub.if, github), true);
  for (const name of stub.needs) assert.equal(evaluate(ci.jobs[name].if, github), false, name);
  const steps = stub.steps.filter(step => !step.if || evaluate(step.if, github));
  assert.equal(steps.length, 1);
  assert.equal(stub.services, undefined);
  const directory = mkdtempSync(join(tmpdir(), 'htpr-9450-'));
  try {
    const summary = join(directory, 'summary');
    const result = spawnSync('bash', ['-e', '-c', steps[0].run], { env: { ...process.env, GITHUB_STEP_SUMMARY: summary }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(summary, 'utf8'), /moved to nightly \(HTPR-9450\)/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  for (const step of stub.steps.slice(1)) assert.equal(evaluate(step.if, { event_name: 'schedule' }), true);
});

test('nightly runs the visual comparison and production AI pilot', () => {
  const visual = workflow('visual-regression');
  assert.equal(evaluate(visual.jobs['visual-regression'].if, { event_name: 'schedule' }), true);
  const pilot = workflow('e2e-ai-pilot');
  for (const event_name of ['schedule', 'workflow_dispatch']) {
    assert.equal(evaluate(pilot.jobs.pilot.if, { event_name, ref: 'refs/heads/production' }), true);
    assert.equal(evaluate(pilot.jobs.pilot.if, { event_name, ref: 'refs/heads/feature' }), false);
  }
  assert.equal(evaluate(pilot.jobs.pilot.if, { event_name: 'pull_request', ref: 'refs/heads/production' }), false);
});


test('nightly app smoke checks out only the event production SHA', () => {
  const smoke = workflow('app-smoke');
  assert.equal(smoke.on.schedule, undefined);
  assert.equal(smoke.on.pull_request_target, undefined);
  const nightly = workflow('app-smoke-nightly');
  assert.deepEqual(nightly.on.schedule, [{ cron: '47 3 * * *' }]);
  const job = nightly.jobs['app-smoke-nightly'];
  assert.equal(job.if, "github.ref == 'refs/heads/production'");
  for (const step of job.steps.filter(step => step.uses?.startsWith('actions/checkout@'))) {
    assert.equal(step.with.ref, '${{ github.sha }}');
    assert.equal(step.with['persist-credentials'], false);
  }
  assert.match(job.steps.at(-1).run, /run-app-smoke-isolated/);
  const validate = smoke.jobs.validate;
  const evaluateRequest = event => evaluate(validate.if, { event_name: 'workflow_run', event: { workflow_run: { event, conclusion: 'success' } } });
  assert.equal(evaluateRequest('pull_request'), false);
  assert.equal(evaluateRequest('workflow_dispatch'), true);
});


test('only production pushes publish the TypeScript cache', () => {
  const save = workflow('ci-tests').jobs['ci-checks'].steps.find(step => step.name === 'Save TypeScript cache');
  const context = {
    needs: { 'ci-prepare': { outputs: { run_tests: 'true' } } },
    steps: { 'restore-tsc-cache': { outputs: { 'cache-hit': 'false' } } },
  };
  const expression = save.if.replaceAll('needs.ci-prepare', 'needs["ci-prepare"]').replaceAll('steps.restore-tsc-cache', 'steps["restore-tsc-cache"]').replaceAll('.cache-hit', '["cache-hit"]');
  for (const [event_name, expected] of [['push', true], ['pull_request', false], ['schedule', false]]) {
    assert.equal(vm.runInNewContext(expression, { ...context, github: { event_name } }), expected);
  }
});
