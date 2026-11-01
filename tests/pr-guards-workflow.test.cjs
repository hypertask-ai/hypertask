const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const read = file => readFileSync(file, 'utf8');
const workflow = name => yaml.load(read(`.github/workflows/${name}.yml`));

test('native scanner checks retain required names without commit-status API calls', () => {
  const w = workflow('pr-guards');
  assert.deepEqual(Object.keys(w.jobs), ['secret-scan', 'next-public-secrets']);
  assert.deepEqual(w.permissions, { contents: 'read' });
  assert.deepEqual(w.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'ready_for_review']);
  const scan = w.jobs['secret-scan'];
  assert.deepEqual(scan.outputs, { 'public-secrets': '${{ steps.public-secrets.outcome }}' });
  for (const id of ['gitleaks', 'trufflehog', 'public-secrets']) {
    const step = scan.steps.find(step => step.id === id);
    assert.ok(step);
    assert.notEqual(step['continue-on-error'], true);
    assert.match(step.if, /^always\(\)/);
  }
  assert.equal(scan.steps.find(step => step.uses?.startsWith('actions/checkout@')).with['persist-credentials'], false);
  assert.ok(scan.steps.every(step => !step.uses?.startsWith('actions/github-script@')));
  const summary = w.jobs['next-public-secrets'];
  assert.equal(summary.needs, 'secret-scan');
  assert.equal(summary.if, '${{ !cancelled() }}');
  assert.equal(summary.steps[0].env.SCAN_OUTCOME, '${{ needs.secret-scan.outputs.public-secrets }}');
  for (const outcome of ['success', 'failure', 'skipped', 'cancelled', '']) {
    const result = spawnSync('/bin/sh', ['-ec', summary.steps[0].run], {
      env: { SCAN_OUTCOME: outcome }, encoding: 'utf8',
    });
    assert.equal(result.status, outcome === 'success' ? 0 : 1);
  }
});

test('trusted publication combines outside and title guards without exposing candidate code', () => {
  const w = workflow('pr-guards-trusted');
  assert.deepEqual(Object.keys(w.jobs), ['pr-guards-trusted', 'bind-ticket']);
  assert.deepEqual(Object.keys(w.on), ['pull_request_target', 'workflow_dispatch']);
  assert.equal(w.concurrency.group, 'pr-guards-trusted-${{ github.event_name }}-${{ github.event.pull_request.number || inputs.pr_number }}');
  assert.equal(w.concurrency.queue, 'max');
  assert.equal(w.concurrency['cancel-in-progress'], false);
  const steps = w.jobs['pr-guards-trusted'].steps;
  assert.deepEqual(steps.filter(step => step.id).map(step => step.id), ['metadata', 'outside', 'size', 'title', 'runner-policy']);
  const checkout = steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, 'production');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.ok(steps.every(step => !step['continue-on-error']));
  for (const id of ['outside', 'size', 'title', 'runner-policy']) {
    assert.equal(steps.find(step => step.id === id).env.PR_METADATA, '${{ steps.metadata.outputs.pr }}');
  }
  assert.equal(steps.at(-1).if, "${{ !cancelled() && github.event.pull_request.base.ref == 'production' }}");
  assert.deepEqual(workflow('gitleaks').on.push.branches, ['main', 'master', 'production']);
  assert.deepEqual(workflow('secret-guard').on.push.branches, ['production', 'main']);
});

test('CI policy preserves every required context and describes native guard publication', () => {
  const policy = yaml.load(read('docs/ci-policy.yml'));
  assert.deepEqual(policy.pr_job_budget.pull_request_guards.native_checks, ['secret-scan', 'next-public-secrets']);
  assert.deepEqual(policy.pr_job_budget.trusted_pull_request_guards.published_statuses, ['pr-title']);
  assert.deepEqual(policy.required_checks.contexts, [
    'app-smoke', 'browser-smoke', 'ci-tests', 'ai-review', 'claude-review',
    'feature-flag-gate', 'pr-title', 'next-public-secrets', 'secret-scan', 'premerge-evidence',
  ]);
  assert.deepEqual(policy.policies.production_ruleset.required_status_checks, policy.required_checks.contexts);
});

test('heavy scope skips docs/skills/unit tests but never src, CI, dependencies, mixed or unknown changes', () => {
  const source = read('.github/scripts/ci-change-scope.cjs');
  const body = source.slice(source.indexOf('function heavyNeeded('), source.indexOf('\nfunction buildNeeded('));
  const needed = new Function('files', `${body}\nreturn heavyNeeded(files);`);
  for (const files of [['docs/a.yml'], ['.claude/skills/a/run.sh'], ['nested/a.md'], ['skills/a/script.sh'], ['.agents/skills/a/script.sh'], ['tests/a.test.cjs']]) {
    assert.equal(needed(files), false, files.join(', '));
  }
  for (const files of [[], undefined, [''], ['src/content.md'], ['src/a.ts', 'docs/a.md'], ['package.json'], ['.github/workflows/app-smoke.yml'], ['.github/scripts/ci-change-scope.cjs'], ['src/old.ts', 'docs/new.ts']]) {
    assert.equal(needed(files), true, JSON.stringify(files));
  }
  const smoke = workflow('app-smoke');
  assert.match(smoke.jobs['app-smoke'].if, /needs.validate.outputs.docs-only != 'true'/);
  assert.match(smoke.jobs.report.steps[0].run, /description='docs-only change, skipped'/);
  assert.deepEqual(smoke.concurrency, {
    group: "${{ github.event_name == 'push' && 'app-smoke-production-cache' || format('app-smoke-run-{0}', github.run_id) }}",
    'cancel-in-progress': true,
  });
  assert.equal(smoke.jobs['app-smoke'].concurrency, undefined);
  assert.equal(smoke.jobs.validate.permissions.actions, 'write');
  const cancellation = smoke.jobs.validate.steps.find(step => step.id === 'current-request');
  assert.match(cancellation.with.script, /requestNumber < request\.run_number/);
  assert.match(cancellation.with.script, /if \(!await currentHead\(\)\) return;/);
  assert.match(smoke.jobs.report.if, /!cancelled\(\)/);
  for (const key of ['browser-smoke-desktop', 'browser-smoke-mobile']) {
    const browser = workflow('ci-tests').jobs[key];
    assert.equal(browser.outputs.docs_only, "${{ steps.scope.outputs.heavy_needed == 'false' }}");
    assert.match(browser.steps.find(step => step.id === 'smoke').if, /heavy_needed == 'true'/);
  }
  assert.equal(workflow('ci-tests').jobs['browser-smoke'].outputs.docs_only, "${{ needs.browser-smoke-desktop.outputs.docs_only }}");
  assert.equal(workflow('ci-tests').on.pull_request['paths-ignore'], undefined);
  assert.equal(workflow('visual-regression').on.pull_request, undefined);
  assert.match(readFileSync('.github/scripts/visual-change-scope.cjs', 'utf8'), /EXCLUDES = \['src\/app\/api\/\*\*', '\*\*\/\*\.md'\]/);
});
