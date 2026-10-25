const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, chmodSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const moduleUrl = pathToFileURL(join(__dirname, '../.github/scripts/production-revert-pr.mjs')).href;

function history(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'revert-fixture-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('config', 'core.hooksPath', '/dev/null');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  mkdirSync(join(cwd, 'tests'));
  writeFileSync(join(cwd, 'package-lock.json'), '{}');
  writeFileSync(join(cwd, 'tests/check.test.cjs'), "require('node:assert/strict').equal(require('node:fs').readFileSync('value', 'utf8'), 'good');\n");
  const commit = (file, value) => {
    writeFileSync(join(cwd, file), value);
    git('add', '.'); git('commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  writeFileSync(join(cwd, 'tests/second.test.cjs'), "require('node:assert/strict').equal(require('node:fs').readFileSync('other', 'utf8'), 'good');\n");
  writeFileSync(join(cwd, 'other'), 'good');
  const good = commit('value', 'good');
  const before = commit('unrelated', 'preserve before');
  const culprit = commit('value', 'bad');
  const bad = commit('unrelated', 'preserve after');
  return { cwd, git, good, before, culprit, bad, head: bad, files: ['tests/check.test.cjs'], commit };
}

test('real Git replay identifies only the breaking commit and preserves later work', async t => {
  const { findRegression } = await import(moduleUrl);
  const h = history(t);
  assert.deepEqual(findRegression(h), { culprit: h.culprit, head: h.head, files: h.files });
  assert.equal(h.git('rev-parse', 'HEAD'), h.head);
  assert.equal(readFileSync(join(h.cwd, 'unrelated'), 'utf8'), 'preserve after');
  assert.equal(readFileSync(join(h.cwd, 'value'), 'utf8'), 'bad');
  assert.equal(h.git('worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);
});

test('flaky replay refuses a proposal and cleans its temporary tree', async t => {
  const { findRegression } = await import(moduleUrl);
  const h = history(t);
  let n = 0;
  assert.throws(() => findRegression({ ...h, probe: () => ({ status: n++ % 2, stdout: '', stderr: '' }) }), /Unstable/);
  assert.equal(h.git('worktree', 'list', '--porcelain').match(/^worktree /gm).length, 1);
});

test('rate limits, timeouts and passing production never propose a revert', async t => {
  const { findRegression, testFiles } = await import(moduleUrl);
  const h = history(t);
  const jobs = [{ steps: [{ name: 'Source-text regex gate', conclusion: 'failure' }] }];
  assert.deepEqual(testFiles(jobs, 'GitHub API rate limit exceeded'), []);
  assert.deepEqual(testFiles(jobs, 'network ECONNRESET'), []);
  assert.deepEqual(testFiles([{ steps: [{ name: 'Install dependencies', conclusion: 'failure' }] }], ''), []);
  assert.deepEqual(testFiles(jobs, 'AssertionError: rejected nextjs-build-cache'), ['tests/source-text-regex-lint.test.cjs']);
  assert.throws(() => findRegression({ ...h, probe: () => ({ status: 1, stderr: 'HTTP 429 rate limited' }) }), /infrastructure/);
  assert.throws(() => findRegression({ ...h, probe: () => ({ status: null, signal: 'SIGTERM' }) }), /infrastructure/);
  h.head = h.commit('value', 'good');
  assert.equal(findRegression(h), null);
});

test('ambiguous dependency changes, invalid paths and a non-repairing revert are refused', async t => {
  const { findRegression } = await import(moduleUrl);
  const h = history(t);
  assert.equal(findRegression({ ...h, files: ['--import=evil'] }), null);
  h.head = h.commit('other', 'independent break');
  assert.equal(findRegression({ ...h, files: [...h.files, 'tests/second.test.cjs'] }), null);
  h.head = h.commit('package-lock.json', '{"changed":true}');
  assert.equal(findRegression(h), null);
});

test('publisher opens a reviewable branch, never updates production, and rejects a stale replay', async t => {
  const { spawnSync } = require('node:child_process');
  const h = history(t), remote = `${h.cwd}-remote.git`;
  t.after(() => rmSync(remote, { recursive: true, force: true }));
  execFileSync('git', ['init', '--bare', '-q', remote]);
  h.git('remote', 'add', 'origin', remote);
  h.git('push', 'origin', 'HEAD:production');
  const bin = join(h.cwd, 'bin'), record = join(h.cwd, 'request.json');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}\nconst fs = require('node:fs'); if (process.argv[2] === 'api') console.log('[]'); else fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'hypertask-ai/hypertask', CULPRIT: h.culprit, VALIDATED_HEAD: h.head, EVIDENCE_URL: 'https://github.com/hypertask-ai/hypertask/actions/runs/1' };
  const script = join(__dirname, '../.github/scripts/production-revert-pr.mjs');
  const stale = spawnSync(process.execPath, [script, 'publish'], { cwd: h.cwd, env: { ...env, VALIDATED_HEAD: h.good }, encoding: 'utf8' });
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /Production moved/);
  const published = spawnSync(process.execPath, [script, 'publish'], { cwd: h.cwd, env, encoding: 'utf8' });
  assert.equal(published.status, 0, published.stderr);
  assert.equal(h.git('ls-remote', 'origin', 'refs/heads/production').split(/\s/)[0], h.head);
  const proposal = h.git('rev-parse', `refs/remotes/origin/auto-revert/${h.culprit}`);
  assert.equal(h.git('show', `${proposal}:value`), 'good');
  assert.equal(h.git('show', `${proposal}:unrelated`), 'preserve after');
  const request = JSON.parse(readFileSync(record, 'utf8'));
  assert.deepEqual(request.slice(0, 2), ['pr', 'create']);
  assert.equal(request[request.indexOf('--base') + 1], 'production');
  assert.equal(request.includes('--auto'), false);
});
