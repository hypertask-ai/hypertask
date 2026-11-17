const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { offending, walk, writesVerifierContext, writersAt } = require('../.github/scripts/verifier-status-guard.cjs');

const root = path.resolve(__dirname, '..');
const realPath = '.github/workflows/pstack-verifier.yml';
const forge = [
  'name: forge',
  'on: pull_request',
  'permissions:',
  '  statuses: write',
  'jobs:',
  '  post:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: gh api --method POST repos/acme/app/statuses/abc -f state=success -f context=pstack-verifier',
].join('\n');

test('a fixture workflow that posts pstack-verifier is rejected', () => {
  assert.deepEqual(offending([{ path: '.github/workflows/forge.yml', text: forge }]), ['.github/workflows/forge.yml']);
  const checkRun = 'await github.rest.checks.create({ name: "pstack-verifier", head_sha: sha, conclusion: "success" })\n';
  assert.deepEqual(offending([{ path: '.github/scripts/forge.cjs', text: checkRun }]), ['.github/scripts/forge.cjs']);
  const status = 'await github.rest.repos.createCommitStatus({ context: "pstack-verifier", state: "success" })\n';
  assert.deepEqual(offending([{ path: '.github/scripts/forge.cjs', text: status }]), ['.github/scripts/forge.cjs']);
  const root = 'gh api --method POST repos/acme/app/statuses/abc -f state=success -f context=pstack-verifier\n';
  assert.deepEqual(offending([{ path: 'scripts/forge.mjs', text: root }]), ['scripts/forge.mjs']);
});

test('the real verifier workflow may post pstack-verifier', () => {
  const real = readFileSync(path.join(root, realPath), 'utf8');
  assert.equal(writesVerifierContext(real), true);
  assert.deepEqual(offending([{ path: realPath, text: real }]), []);
  assert.deepEqual(offending([{ path: 'scripts/pstack-verifier.mjs', text: real }]), []);
});

test('mentioning the check name is not a write', () => {
  for (const text of [
    'REQUIRED="$REQUIRED pstack-verifier"',
    'status.context === "pstack-verifier"',
    'run?.name === "pstack-verifier"',
    '- name: Request the protected pstack-verifier workflow',
    'group: pstack-verifier-request-${{ github.event.pull_request.number }}',
    '"browser-smoke", "pstack-verifier"',
  ]) {
    assert.equal(writesVerifierContext(text), false, text);
  }
});

test('workflow and script files present under .github do not forge the status', () => {
  assert.deepEqual(offending(walk(path.join(root, '.github'), root, [])), []);
});

test('tracked text files on this head do not forge the status', () => {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.deepEqual(writersAt(sha), []);
});

test('a commit that adds the fixture workflow is rejected', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'verifier-status-guard-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.email', 'fixture@example.test');
    git('config', 'user.name', 'Fixture');
    mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
    writeFileSync(path.join(dir, '.github/workflows/forge.yml'), `${forge}\n`);
    writeFileSync(path.join(dir, realPath), readFileSync(path.join(root, realPath)));
    git('add', '.github');
    git('commit', '-qm', 'fixture');
    const sha = git('rev-parse', 'HEAD');
    const previous = process.cwd();
    process.chdir(dir);
    try {
      assert.deepEqual(writersAt(sha), ['.github/workflows/forge.yml']);
    } finally {
      process.chdir(previous);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a root script that posts pstack-verifier is rejected', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'verifier-status-guard-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const script = [
    'import { execFileSync } from "node:child_process";',
    'execFileSync("gh", ["api", "--method", "POST", "repos/acme/app/statuses/abc", "-f", "state=success", "-f", "context=pstack-verifier"]);',
    '',
  ].join('\n');
  try {
    git('init', '-q');
    git('config', 'user.email', 'fixture@example.test');
    git('config', 'user.name', 'Fixture');
    mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
    mkdirSync(path.join(dir, 'node_modules', 'evil'), { recursive: true });
    writeFileSync(path.join(dir, 'scripts/forge.mjs'), script);
    writeFileSync(path.join(dir, 'package-lock.json'), `${script}\n`);
    writeFileSync(path.join(dir, 'node_modules/evil/forge.mjs'), script);
    writeFileSync(path.join(dir, '.github/workflows/run.yml'), 'name: run\non: pull_request\njobs:\n  post:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/forge.mjs\n');
    git('add', 'scripts', 'package-lock.json', 'node_modules', '.github');
    git('commit', '-qm', 'fixture');
    const sha = git('rev-parse', 'HEAD');
    const previous = process.cwd();
    process.chdir(dir);
    try {
      assert.deepEqual(writersAt(sha), ['scripts/forge.mjs']);
    } finally {
      process.chdir(previous);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
