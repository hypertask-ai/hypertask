const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { evaluate, workflowDigest, checkPullRequest } = require('../.github/scripts/ci-runner-policy.cjs');
const publicRepo = { full_name: 'fixture/app', private: false, visibility: 'public' };
const privateRepo = { ...publicRepo, private: true, visibility: 'private' };
const policy = { topology: { compute: 'github-hosted-ubuntu-latest' } };
const workflows = runner => ({ '.github/workflows/ci.yml': yaml.dump({ jobs: { test: { 'runs-on': runner, steps: [{ run: 'true' }] } } }) });

test('public app stays on free standard hosted runners, refusing alternate or opaque runners', () => {
  assert.match(evaluate(publicRepo, policy, workflows('ubuntu-latest')), /public; GitHub-hosted ubuntu-latest only; standard hosted minutes are free; 1 jobs checked/);
  for (const runner of ['self-hosted', ['self-hosted', 'linux'], ['ubuntu-latest', 'self-hosted'], 'windows-latest', '${{ matrix.runner }}', { group: 'custom' }, null]) {
    assert.throws(() => evaluate(publicRepo, policy, workflows(runner)), /requires GitHub-hosted|explicit static labels/);
  }
});

test('private and internal repos allow self-hosted, not unapproved hosted minutes', () => {
  for (const visibility of ['private', 'internal']) {
    const repo = { ...privateRepo, visibility };
    assert.match(evaluate(repo, policy, workflows(['self-hosted', 'linux'])), /hosted minutes may cost money; self-hosted infrastructure is not free/);
    assert.throws(() => evaluate(repo, policy, workflows('ubuntu-latest')), /need Valentin approval/);
  }
  for (const repo of [{ ...publicRepo, private: true }, { ...publicRepo, visibility: undefined }, { full_name: 'fixture/app' }]) {
    assert.throws(() => evaluate(repo, policy, workflows('ubuntu-latest')), /Invalid live repository visibility/);
  }
});

test('only unedited Valentin approval bound to this repository and full workflow digest permits private hosted', () => {
  const files = workflows('ubuntu-latest');
  const url = 'https://github.com/fixture/app/issues/1#issuecomment-2';
  const approvedPolicy = { ...policy, runner_policy: { private_hosted_approval: url } };
  const comment = { html_url: url, user: { id: 3296316, type: 'User', login: 'fixture-owner' }, created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z', body: `Approve GitHub-hosted runners for fixture/app with workflow digest ${workflowDigest(files)}.` };
  assert.match(evaluate(privateRepo, approvedPolicy, files, () => comment), /approved by fixture-owner \(3296316\), https:\/\/github.com\/fixture\/app\/issues\/1#issuecomment-2/);
  for (const changed of [{ ...comment, user: { ...comment.user, id: 12 } }, { ...comment, updated_at: 'edited' }, { ...comment, html_url: 'https://github.com/other/repo/issues/1#issuecomment-2' }, { ...comment, body: 'yes' }]) {
    assert.throws(() => evaluate(privateRepo, approvedPolicy, files, () => changed), /Invalid Valentin approval/);
  }
  assert.throws(() => evaluate(privateRepo, approvedPolicy, workflows('windows-latest'), () => comment), /Invalid Valentin approval/);
  assert.throws(() => evaluate(privateRepo, { ...policy, runner_policy: { private_hosted_approval: url.replace('fixture/app', 'other/repo') } }, files), /need Valentin approval/);
  assert.throws(() => evaluate(privateRepo, approvedPolicy, files, () => { throw new Error('API unavailable'); }), /API unavailable/);
});

test('all workflow jobs are checked; local reusable workflows resolve, remote or missing jobs fail closed', () => {
  const files = { ...workflows('ubuntu-latest'), '.github/workflows/reuse.yml': 'jobs:\n  test:\n    uses: ./.github/workflows/ci.yml\n' };
  assert.match(evaluate(publicRepo, policy, files), /1 jobs checked/);
  for (const source of ['jobs: {}', 'jobs: []', 'jobs:\n  test:\n    uses: other/repo/workflow.yml@main', 'jobs:\n  test:\n    uses: ./.github/workflows/missing.yml', 'not yaml: [']) {
    assert.throws(() => evaluate(publicRepo, policy, { ...files, '.github/workflows/reuse.yml': source }));
  }
  assert.throws(() => evaluate(publicRepo, policy, { ...files, '.github/workflows/unsafe.yml': workflows('self-hosted')['.github/workflows/ci.yml'] }), /public app CI requires/);
  assert.throws(() => evaluate(publicRepo, {}, files), /Missing topology.compute/);
});

test('trusted PR title execution scans candidate Git data and publishes failure despite candidate checker/policy tampering', async t => {
  const root = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-runner-policy-'));
  const originalPath = process.env.PATH;
  const originalToken = process.env.GH_TOKEN;
  t.after(() => { process.chdir(root); process.env.PATH = originalPath; if (originalToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = originalToken; fs.rmSync(dir, { recursive: true, force: true }); });
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'bin'));
  const gh = path.join(dir, 'bin/gh');
  fs.writeFileSync(gh, `#!${process.execPath}\nif (process.argv[2] !== 'api' || process.argv[3] !== 'repos/fixture/app') process.exit(3); console.log(${JSON.stringify(JSON.stringify(publicRepo))});\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'docs/ci-policy.yml'), yaml.dump(policy));
  const file = path.join(dir, '.github/workflows/ci.yml');
  fs.writeFileSync(file, workflows('ubuntu-latest')['.github/workflows/ci.yml']);
  git('init', '-q'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture');
  git('add', 'docs', '.github'); git('commit', '-qm', 'baseline');
  git('remote', 'add', 'origin', 'https://github.com/fixture/app.git');
  git('config', `url.${dir}.insteadOf`, 'https://github.com/fixture/app.git');
  const good = git('rev-parse', 'HEAD');
  fs.writeFileSync(file, workflows('self-hosted')['.github/workflows/ci.yml']);
  fs.writeFileSync(path.join(dir, 'docs/ci-policy.yml'), 'topology:\n  compute: self-hosted\n');
  fs.mkdirSync(path.join(dir, '.github/scripts'));
  fs.writeFileSync(path.join(dir, '.github/scripts/ci-runner-policy.cjs'), "throw new Error('Candidate code executed')");
  git('add', 'docs', '.github'); git('commit', '-qm', 'bad runner and disabled checker');
  const bad = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'docs/ci-policy.yml'), yaml.dump(policy));
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/pr-guards-trusted.yml'), 'utf8'));
  const job = workflow.jobs['pr-guards-trusted'];
  const runner = job.steps.find(step => step.id === 'runner-policy').with.script;
  const publish = job.steps.find(step => step.name === 'Publish original guard contexts').with.script;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  process.chdir(dir); process.env.PATH = `${dir}/bin:${originalPath}`; delete process.env.GH_TOKEN;
  for (const [sha, state, brokenApi] of [[good, 'success', false], [bad, 'failure', false], [good, 'failure', true]]) {
    git('update-ref', 'refs/pull/844/head', sha);
    if (brokenApi) fs.writeFileSync(gh, `#!${process.execPath}\nprocess.exit(1);\n`, { mode: 0o755 });
    const pr = { number: 844, title: 'YPER4-844 [INFRA] Enforce runner policy', user: { login: 'fixture' }, base: { ref: 'production', repo: { full_name: 'fixture/app' } }, head: { sha } };
    const outputs = {};
    const posts = [];
    const github = { rest: { pulls: { get: async () => ({ data: pr }) }, repos: { createCommitStatus: async value => posts.push(value) } } };
    const context = { repo: { owner: 'fixture', repo: 'app' }, payload: { pull_request: pr } };
    const core = { info() {}, setOutput: (key, value) => { outputs[key] = value; }, setFailed: message => { throw new Error(message); } };
    let outcome = 'success';
    try { await new AsyncFunction('github', 'context', 'core', 'require', runner)(github, context, core, () => ({ checkPullRequest })); }
    catch (error) { outcome = 'failure'; assert.doesNotMatch(error.message, /Candidate code executed/); }
    const previous = process.env.RESULTS;
    process.env.RESULTS = JSON.stringify({ outside: { outcome: 'success', outputs: { sha } }, size: { outcome: 'success', outputs: { sha } }, title: { outcome: 'success', outputs: { sha, title: pr.title } }, 'runner-policy': { outcome, outputs } });
    try { await new AsyncFunction('github', 'context', 'core', publish)(github, context, { ...core, setFailed() {} }); }
    finally { if (previous === undefined) delete process.env.RESULTS; else process.env.RESULTS = previous; }
    assert.equal(posts.find(post => post.context === 'pr-title').state, state);
    assert.equal(posts.find(post => post.context === 'pr-title').sha, sha);
  }
});
