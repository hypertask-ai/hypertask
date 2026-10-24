const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const yaml = require('js-yaml');

const read = file => readFileSync(file, 'utf8');
const workflow = name => yaml.load(read(`.github/workflows/${name}.yml`));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const SHA = 'a'.repeat(40);
const TITLE = 'YPER4-663 [INFRA] Reduce CI queue';

async function publish(name, outcomes, completedRun = false, { current = {}, evaluated = {} } = {}) {
  const job = workflow(name).jobs[name];
  const step = job.steps.find(step => step.name === 'Publish original guard contexts');
  const posts = [];
  const failures = [];
  const gets = [];
  const previous = process.env.RESULTS;
  process.env.RESULTS = JSON.stringify(Object.fromEntries(Object.entries(outcomes).map(([id, outcome]) => [id, { outcome, outputs: { sha: SHA, ...(id === 'title' ? { title: TITLE } : {}), ...evaluated[id] } }])));
  try {
    await new AsyncFunction('github', 'context', 'core', step.with.script)(
      {
        rest: {
          repos: { createCommitStatus: async status => posts.push(status) },
          pulls: { get: async params => {
            gets.push(params);
            return { data: { head: { sha: SHA }, title: TITLE, ...(typeof current === 'function' ? current(gets.length) : current) } };
          } },
          actions: { listJobsForWorkflowRun() {} },
        },
        paginate: async () => [{ name: 'pr-guards', steps: [
          { name: 'Run gitleaks', conclusion: outcomes.gitleaks },
          { name: 'Run trufflehog', conclusion: outcomes.trufflehog },
          { name: 'Fail on NEXT_PUBLIC_ secret-named vars', conclusion: outcomes['public-secrets'] },
        ] }],
      },
      { actor: 'fixture', repo: { owner: 'fixture', repo: 'repo' }, payload: { ...(completedRun ? { workflow_run: { id: 123, head_sha: 'b'.repeat(40) } } : {}), action: 'synchronize', pull_request: { number: 663, title: TITLE, user: { login: 'fixture' }, head: { sha: 'a'.repeat(40), repo: { full_name: 'fixture/repo' } }, base: { ref: 'production' } } } },
      { setFailed: message => failures.push(message), info() {} },
    );
  } finally {
    if (previous === undefined) delete process.env.RESULTS;
    else process.env.RESULTS = previous;
  }
  return { posts, failures, gets };
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
      assert.match(step.if, name.endsWith('trusted') ? /!cancelled\(\)/ : /^always\(\)/);
    }
    assert.equal(w.jobs[name].steps.at(-1).if, name.endsWith('trusted') ? '${{ !cancelled() }}' : 'always()');
    for (const step of w.jobs[name].steps.filter(step => step.uses?.startsWith('actions/checkout@'))) {
      assert.equal(step.with['persist-credentials'], false);
      if (name.endsWith('trusted')) assert.equal(step.with.ref, 'production');
    }
  }
  assert.ok(workflow('pr-guards').on.pull_request === null);
  assert.deepEqual(workflow('pr-guards').on.workflow_run.workflows, ['PR Guards']);
  assert.deepEqual(workflow('pr-guards-trusted').on.pull_request_target.types, ['opened', 'synchronize', 'reopened', 'edited', 'ready_for_review']);
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
  const green = { outside: 'success', size: 'success', title: 'success' };
  const result = await publish('pr-guards-trusted', green);
  assert.deepEqual(result.posts.map(post => post.context).sort(), ['outside-pr-guard', 'pr-size', 'pr-title'].sort());
  assert.ok(result.posts.every(post => post.state === 'success'));
  assert.deepEqual(result.failures, []);
  for (const [id, context] of [['outside', 'outside-pr-guard'], ['size', 'pr-size'], ['title', 'pr-title']]) {
    for (const outcome of ['failure', 'skipped', 'cancelled']) {
      const failed = await publish('pr-guards-trusted', { ...green, [id]: outcome });
      assert.equal(failed.posts.find(post => post.context === context).state, 'failure', `${id}/${outcome}`);
      assert.equal(failed.failures.length, 1);
    }
  }
});

test('cancelled trusted runs cannot publish pending or final statuses', () => {
  const steps = workflow('pr-guards-trusted').jobs['pr-guards-trusted'].steps;
  for (const step of steps.filter(step => step.with?.script?.includes('createCommitStatus'))) {
    assert.equal(step.if, '${{ !cancelled() }}');
    assert.doesNotMatch(step.if, /always/);
  }
});

test('trusted publishers skip all stale-head verdicts, including failures', async () => {
  for (const outcome of ['success', 'failure']) {
    const result = await publish('pr-guards-trusted', { outside: outcome, size: outcome, title: outcome }, false,
      { current: { head: { sha: 'b'.repeat(40) } } });
    assert.deepEqual(result.posts, []);
    assert.deepEqual(result.failures, []);
    assert.equal(result.gets.length, 3);
  }
});

test('trusted publishers compare each guard evaluated head with the fresh API head', async () => {
  for (const id of ['outside', 'size', 'title']) {
    const result = await publish('pr-guards-trusted', { outside: 'success', size: 'success', title: 'success' }, false,
      { evaluated: { [id]: { sha: 'b'.repeat(40) } } });
    assert.equal(result.posts.length, 2);
    assert.ok(!result.posts.some(post => post.context === { outside: 'outside-pr-guard', size: 'pr-size', title: 'pr-title' }[id]));
  }
});

test('a guard with no evaluated SHA cannot publish a green verdict', async () => {
  for (const [id, context] of [['outside', 'outside-pr-guard'], ['size', 'pr-size'], ['title', 'pr-title']]) {
    const result = await publish('pr-guards-trusted', { outside: 'success', size: 'success', title: 'success' }, false,
      { evaluated: { [id]: { sha: '' } } });
    assert.equal(result.posts.find(post => post.context === context).state, 'failure');
    assert.equal(result.failures.length, 1);
  }
});

test('a same-head title edit cannot overwrite the newer title verdict with a pass or failure', async () => {
  for (const outcome of ['success', 'failure']) {
    const result = await publish('pr-guards-trusted', { outside: 'success', size: 'success', title: outcome }, false,
      { current: { title: 'Changed after evaluation' } });
    assert.deepEqual(result.posts.map(post => post.context), ['outside-pr-guard', 'pr-size']);
    assert.deepEqual(result.failures, []);
    assert.equal(result.gets.length, 3);
  }
});

test('title publication compares the evaluated API title, not the webhook title', async () => {
  const title = 'YPER4-663 [INFRA] Fresh API title';
  const fresh = await publish('pr-guards-trusted', { outside: 'success', size: 'success', title: 'success' }, false,
    { evaluated: { title: { title } }, current: { title } });
  assert.equal(fresh.posts.find(post => post.context === 'pr-title').state, 'success');
  const stale = await publish('pr-guards-trusted', { outside: 'success', size: 'success', title: 'failure' }, false,
    { evaluated: { title: { title } } });
  assert.ok(!stale.posts.some(post => post.context === 'pr-title'));
});

test('the title read happens immediately before its own publication, not before other statuses', async () => {
  const result = await publish('pr-guards-trusted', { outside: 'success', size: 'success', title: 'success' }, false,
    { current: call => call === 3 ? { title: 'Edited during publication' } : {} });
  assert.deepEqual(result.posts.map(post => post.context), ['outside-pr-guard', 'pr-size']);
  assert.equal(result.gets.length, 3);
});

test('pending title status also skips same-head edits and all pending statuses skip stale heads', async () => {
  const script = workflow('pr-guards-trusted').jobs['pr-guards-trusted'].steps.find(step => step.name === 'Mark original guard contexts pending').with.script;
  for (const [current, expected] of [
    [{ head: { sha: SHA }, title: TITLE }, ['outside-pr-guard', 'pr-size', 'pr-title']],
    [{ head: { sha: SHA }, title: 'Edited title' }, ['outside-pr-guard', 'pr-size']],
    [{ head: { sha: 'b'.repeat(40) }, title: TITLE }, []],
  ]) {
    const posts = [];
    await new AsyncFunction('github', 'context', script)(
      { rest: { pulls: { get: async () => ({ data: current }) }, repos: { createCommitStatus: async status => posts.push(status) } } },
      { repo: { owner: 'fixture', repo: 'repo' }, payload: { pull_request: { number: 663, title: TITLE, head: { sha: SHA }, base: { ref: 'production' } } } },
    );
    assert.deepEqual(posts.map(post => post.context), expected);
    assert.ok(posts.every(post => post.state === 'pending'));
  }
});

test('global reconciliation keeps original events, serialization and isolated workflows', () => {
  const trusted = workflow('pr-guards-trusted').jobs['pr-guards-trusted'];
  assert.deepEqual(trusted.steps.filter(step => step.id).map(step => step.id), ['outside', 'size', 'title']);
  assert.doesNotMatch(JSON.stringify(trusted), /feature-flag|ux-signoff|MCP_TOKEN/);
  const flags = workflow('feature-flag-gate');
  assert.deepEqual(Object.keys(flags.on).sort(), ['pull_request_target', 'push']);
  assert.equal(Object.keys(flags.jobs).length, 2);
  assert.deepEqual(flags.concurrency, { group: 'feature-flag-gate-production', 'cancel-in-progress': false });
  const ux = workflow('ux-signoff-gate');
  assert.deepEqual(Object.keys(ux.on).sort(), ['pull_request_target', 'schedule', 'workflow_dispatch']);
  assert.deepEqual(ux.concurrency, { group: 'ux-signoff-gate', 'cancel-in-progress': false });
  assert.equal(workflow('dependabot-major-ticket').concurrency['cancel-in-progress'], false);
  assert.equal(workflow('node-version-guard').jobs['node-version-guard'].needs, 'vercel-node-version');
  assert.deepEqual(workflow('parity-contract-trusted').permissions, { contents: 'read' });
});

test('CI policy budgets the reduced folding and keeps UX out of required contexts', () => {
  const policy = yaml.load(read('docs/ci-policy.yml'));
  const budget = policy.pr_job_budget;
  assert.equal(budget.normal_synchronize_before, 17);
  assert.equal(budget.normal_synchronize_after, 15);
  assert.equal(budget.opened_before, 18);
  assert.equal(budget.opened_after, 15);
  assert.deepEqual(budget.pull_request_guards.published_statuses, ['secret-scan', 'next-public-secrets']);
  assert.deepEqual(budget.trusted_pull_request_guards.published_statuses, ['outside-pr-guard', 'pr-size', 'pr-title']);
  for (const guard of [budget.pull_request_guards, budget.trusted_pull_request_guards, ...budget.serialized_reconciliation_guards]) {
    assert.equal(guard.contexts, undefined);
  }
  assert.ok(!policy.required_checks.contexts.includes('ux-signoff'));
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
  assert.equal(smoke.concurrency['cancel-in-progress'], true);
  assert.match(smoke.concurrency.group, /format\('app-smoke-cancelled-request-\{0\}', github\.run_id\)/);
  const browser = workflow('ci-tests').jobs['browser-smoke'];
  assert.equal(browser.outputs.docs_only, "${{ steps.scope.outputs.heavy_needed == 'false' }}");
  assert.match(browser.steps.find(step => step.id === 'smoke').if, /heavy_needed == 'true'/);
  assert.equal(workflow('ci-tests').on.pull_request['paths-ignore'], undefined);
  assert.ok(workflow('visual-regression').on.pull_request.paths.includes('!**/*.md'));
});
