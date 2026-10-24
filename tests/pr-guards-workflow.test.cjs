const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const yaml = require('js-yaml');

const read = file => readFileSync(file, 'utf8');
const workflow = name => yaml.load(read(`.github/workflows/${name}.yml`));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function publish(name, outcomes, completedRun = false) {
  const job = workflow(name).jobs[name];
  const step = job.steps.find(step => step.name === 'Publish original guard contexts');
  const posts = [];
  const failures = [];
  const previous = process.env.RESULTS;
  process.env.RESULTS = JSON.stringify(Object.fromEntries(Object.entries(outcomes).map(([id, outcome]) => [id, { outcome }])));
  try {
    await new AsyncFunction('github', 'context', 'core', step.with.script)(
      {
        rest: { repos: { createCommitStatus: async status => posts.push(status) }, actions: { listJobsForWorkflowRun() {} } },
        paginate: async () => [{ name: 'pr-guards', steps: [
          { name: 'Run gitleaks', conclusion: outcomes.gitleaks },
          { name: 'Run trufflehog', conclusion: outcomes.trufflehog },
          { name: 'Fail on NEXT_PUBLIC_ secret-named vars', conclusion: outcomes['public-secrets'] },
        ] }],
      },
      { actor: 'fixture', repo: { owner: 'fixture', repo: 'repo' }, payload: { ...(completedRun ? { workflow_run: { id: 123, head_sha: 'b'.repeat(40) } } : {}), action: 'synchronize', pull_request: { user: { login: 'fixture' }, head: { sha: 'a'.repeat(40), repo: { full_name: 'fixture/repo' } }, base: { ref: 'production' } } } },
      { setFailed: message => failures.push(message) },
    );
  } finally {
    if (previous === undefined) delete process.env.RESULTS;
    else process.env.RESULTS = previous;
  }
  return { posts, failures };
}

test('PR guards share one runner, retain every verdict and never persist checkout credentials', () => {
  for (const name of ['pr-guards', 'pr-guards-trusted']) {
    const w = workflow(name);
    assert.deepEqual(Object.keys(w.jobs), [name]);
    assert.equal(w.permissions.statuses, 'write');
    assert.equal(w.concurrency['cancel-in-progress'], true);
    assert.match(w.concurrency.group, /pull_request.number/);
    for (const step of w.jobs[name].steps.filter(step => step.id)) {
      assert.notEqual(step['continue-on-error'], true, `${step.id}: a failed guard must remain failed`);
      assert.match(step.if, /^always\(\)/);
    }
    assert.equal(w.jobs[name].steps.at(-1).if, 'always()');
    for (const step of w.jobs[name].steps.filter(step => step.uses?.startsWith('actions/checkout@'))) {
      assert.equal(step.with['persist-credentials'], false);
      if (name.endsWith('trusted')) assert.equal(step.with.ref, 'production');
    }
  }
  assert.ok(workflow('pr-guards').on.pull_request === null);
  assert.deepEqual(workflow('pr-guards').on.workflow_run.workflows, ['PR Guards']);
  assert.ok(workflow('pr-guards-trusted').on.pull_request_target.types.includes('closed'));
  assert.equal(workflow('gitleaks').on.pull_request, undefined);
  assert.equal(workflow('secret-guard').on.pull_request, undefined);
  assert.deepEqual(workflow('gitleaks').on.push.branches, ['main', 'master', 'production']);
  assert.deepEqual(workflow('secret-guard').on.push.branches, ['production', 'main']);
});

test('either scanner fails secret-scan while the independent public-secret verdict still reports', async () => {
  for (const id of ['gitleaks', 'trufflehog']) {
    const result = await publish('pr-guards', { gitleaks: 'success', trufflehog: 'success', 'public-secrets': 'success', [id]: 'failure' });
    assert.equal(result.posts.find(post => post.context === 'secret-scan').state, 'failure');
    assert.equal(result.posts.find(post => post.context === 'next-public-secrets').state, 'success');
    assert.equal(result.failures.length, 1);
  }
  const result = await publish('pr-guards', { gitleaks: 'success', trufflehog: 'success', 'public-secrets': 'failure' });
  assert.equal(result.posts.find(post => post.context === 'secret-scan').state, 'success');
  assert.equal(result.posts.find(post => post.context === 'next-public-secrets').state, 'failure');
  assert.equal(result.failures.length, 1);
});

test('read-only PR tokens use trusted GitHub step conclusions without executing candidate code', async () => {
  const result = await publish('pr-guards', { gitleaks: 'success', trufflehog: 'failure', 'public-secrets': 'success' }, true);
  assert.equal(result.posts.find(post => post.context === 'secret-scan').state, 'failure');
  assert.equal(result.posts.find(post => post.context === 'next-public-secrets').state, 'success');
  assert.ok(result.posts.every(post => post.sha === 'b'.repeat(40)));
  const w = workflow('pr-guards');
  assert.match(w.jobs['pr-guards'].if, /workflow_run.event == 'pull_request'/);
  for (const step of w.jobs['pr-guards'].steps.filter(step => step.run || step.uses?.startsWith('actions/checkout@'))) {
    assert.match(step.if, /github.event_name == 'pull_request'/);
  }
});

test('trusted guards fail their own contexts and the job without overwriting semantic green statuses', async () => {
  const green = { outside: 'success', size: 'success', title: 'success', flags: 'success', reconcile: 'success', ux: 'success' };
  const result = await publish('pr-guards-trusted', green);
  assert.deepEqual(result.posts.map(post => post.context).sort(), ['outside-pr-guard', 'pr-size', 'pr-title', 'reconcile-feature-flag-gate', 'ux-signoff-gate'].sort());
  assert.ok(result.posts.every(post => post.state === 'success'));
  assert.deepEqual(result.failures, []);
  for (const [id, context] of [['outside', 'outside-pr-guard'], ['size', 'pr-size'], ['title', 'pr-title'], ['flags', 'feature-flag-gate'], ['reconcile', 'reconcile-feature-flag-gate'], ['ux', 'ux-signoff']]) {
    for (const outcome of ['failure', 'skipped', 'cancelled']) {
      const failed = await publish('pr-guards-trusted', { ...green, [id]: outcome });
      assert.equal(failed.posts.find(post => post.context === context).state, 'failure', `${id}/${outcome}`);
      assert.equal(failed.failures.length, 1);
    }
  }
});

test('trusted reconciliation commands and non-PR paths are retained', () => {
  const trusted = workflow('pr-guards-trusted').jobs['pr-guards-trusted'];
  const flags = workflow('feature-flag-gate');
  assert.deepEqual(Object.keys(flags.on), ['push']);
  assert.equal(trusted.steps.find(step => step.id === 'reconcile').run,
    flags.jobs['reconcile-open-pull-requests'].steps.find(step => step.name === 'Reconcile every open production pull request').run);
  const ux = workflow('ux-signoff-gate');
  assert.deepEqual(Object.keys(ux.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.equal(trusted.steps.find(step => step.id === 'ux').run, ux.jobs['ux-signoff-gate'].steps.at(-1).run);
  assert.equal(ux.concurrency['cancel-in-progress'], false);
  assert.equal(flags.concurrency['cancel-in-progress'], false);
  // Secrets never cross the existing candidate-code/candidate-checkout isolation boundaries.
  assert.equal(workflow('node-version-guard').jobs['node-version-guard'].needs, 'vercel-node-version');
  assert.deepEqual(workflow('parity-contract-trusted').permissions, { contents: 'read' });
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
  assert.match(smoke.concurrency.group, /head_branch/);
  assert.doesNotMatch(smoke.concurrency.group, /head_sha/);
  assert.equal(smoke.concurrency['cancel-in-progress'], "${{ github.event_name == 'workflow_run' }}");
  const browser = workflow('ci-tests').jobs['browser-smoke'];
  assert.equal(browser.outputs.docs_only, "${{ steps.scope.outputs.heavy_needed == 'false' }}");
  assert.match(browser.steps.find(step => step.id === 'smoke').if, /heavy_needed == 'true'/);
  assert.equal(workflow('ci-tests').on.pull_request['paths-ignore'], undefined);
  assert.ok(workflow('visual-regression').on.pull_request.paths.includes('!**/*.md'));
});
