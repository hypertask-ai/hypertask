const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const yaml = require('js-yaml');
const workflow = name => yaml.load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const evaluate = (expression, github) => vm.runInNewContext(expression, { github, always: () => true });

test('no pull request starts a smoke status stub', () => {
  const request = workflow('app-smoke-request');
  assert.equal(request.on.pull_request, undefined);
  assert.deepEqual(request.on, { workflow_dispatch: null });
  assert.equal(workflow('app-smoke').jobs['pr-status'], undefined);
  const summary = workflow('ci-tests').jobs['browser-smoke'];
  assert.equal(summary.if, "always() && github.event_name != 'pull_request'");
  assert.equal(summary.steps.some(step => /stub/i.test(step.name ?? '')), false);
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
