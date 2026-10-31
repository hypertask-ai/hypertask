const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const guard = path.join(root, 'scripts', 'check-session-ledgers.mjs');
const gateCheck = path.join(process.env.HOME || tmpdir(), '.agents/skills/unlazy/scripts/gate-check.mjs');

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'guard test',
  GIT_AUTHOR_EMAIL: 'guard@example.com',
  GIT_COMMITTER_NAME: 'guard test',
  GIT_COMMITTER_EMAIL: 'guard@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function run(cwd, args = []) {
  const result = spawnSync(process.execPath, [guard, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'session-ledger-guard-'));
  git(dir, ['init', '--quiet', '--initial-branch=production']);
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'src', 'page.tsx'), 'export default function Page() { return null; }\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'start']);
  return dir;
}

function write(dir, file, body = 'content\n') {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), body);
}

function commit(dir, message) {
  git(dir, ['add', '--all', '--force']);
  git(dir, ['commit', '--quiet', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

test('a committed session ledger fails the guard and the message names the fix', () => {
  const dir = repo();
  try {
    assert.equal(run(dir).status, 0);
    write(dir, 'GATES.md');
    const sha = commit(dir, 'add ledger');
    const result = run(dir, ['--rev', sha]);
    assert.equal(result.status, 1);
    assert.match(result.output, /session-ledger guard: FAILED/);
    assert.match(result.output, /\n {2}GATES\.md\n/);
    assert.match(result.output, /\$HOME\/\.unlazy\/ledgers\//);
    assert.match(result.output, /git rm --cached/);
    git(dir, ['rm', '--quiet', 'GATES.md']);
    git(dir, ['commit', '--quiet', '-m', 'drop ledger']);
    assert.equal(run(dir).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the hidden ledger folder and hook state fail at any depth', () => {
  const dir = repo();
  try {
    write(dir, '.unlazy/s-1234abcd/GATES.md');
    write(dir, '.unlazy/s-1234abcd/gates/leaf.md');
    write(dir, '.unlazy-hook-state.json', '{}\n');
    write(dir, 'packages/app/.unlazy/x/PLAN.md');
    const sha = commit(dir, 'add hidden ledgers');
    const result = run(dir, ['--rev', sha]);
    assert.equal(result.status, 1);
    for (const file of ['.unlazy/s-1234abcd/GATES.md', '.unlazy/s-1234abcd/gates/leaf.md', '.unlazy-hook-state.json', 'packages/app/.unlazy/x/PLAN.md']) {
      assert.ok(result.output.includes(`  ${file}`), file);
    }
    assert.match(result.output, /4 session ledger file\(s\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('real files whose names only resemble a ledger stay allowed', () => {
  const dir = repo();
  try {
    write(dir, 'docs/feature-flag-and-ux-gates.md');
    write(dir, 'docs/gates/HTPR-1234-plan.md');
    write(dir, '.claude/skills/unlazy/templates/gates-leaf.md');
    write(dir, 'skills/unlazy/README.md');
    write(dir, 'src/gates.ts');
    assert.equal(run(dir).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a lowercased ledger name is the same ledger, at any depth', () => {
  const dir = repo();
  try {
    write(dir, 'docs/gates.md');
    const sha = commit(dir, 'add a lowercased ledger');
    const result = run(dir, ['--rev', sha]);
    assert.equal(result.status, 1);
    assert.match(result.output, /\n {2}docs\/gates\.md\n/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an uncommitted ledger in the worktree fails the local run', () => {
  const dir = repo();
  try {
    write(dir, '.unlazy/s-abcdef12/GATES.md');
    const result = run(dir);
    assert.equal(result.status, 1);
    assert.match(result.output, /\.unlazy\/s-abcdef12\/GATES\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a ledger written outside the worktree keeps the worktree clean', () => {
  const dir = repo();
  const outside = mkdtempSync(path.join(tmpdir(), 'session-ledger-outside-'));
  try {
    const ledger = path.join(outside, 'HTPR-1234', 'GATES.md');
    mkdirSync(path.dirname(ledger), { recursive: true });
    writeFileSync(ledger, '- [ ] G1: the outcome is observable\n  CHECK: node -e "process.exit(0)"\n  EXPECT: passed\n');
    assert.equal(run(dir).status, 0);
    assert.equal(git(dir, ['status', '--porcelain']), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('the gate tools still read a ledger kept outside the worktree', async (t) => {
  const dir = repo();
  const outside = mkdtempSync(path.join(tmpdir(), 'session-ledger-outside-'));
  try {
    const ledger = path.join(outside, 'HTPR-1234', 'GATES.md');
    mkdirSync(path.dirname(ledger), { recursive: true });
    writeFileSync(ledger, '- [ ] G1: the outcome is observable\n  CHECK: node -e "process.exit(0)"\n  EXPECT: passed\n');
    if (!existsSync(gateCheck)) {
      t.skip('unlazy skill is not installed on this machine');
      return;
    }
    const status = spawnSync(process.execPath, [gateCheck, '--status', ledger], { cwd: dir, encoding: 'utf8' });
    const output = `${status.stdout}${status.stderr}`;
    assert.equal(status.status, 1, output);
    assert.match(output, /GATES:G1/);
    assert.equal(git(dir, ['status', '--porcelain']), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('the live repository tree carries no session ledger', () => {
  const result = run(root, ['--rev', 'HEAD']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /session-ledger guard: clean/);
});

test('a real past commit that added a ledger fails the guard', () => {
  const found = spawnSync('git', ['log', '--all', '--format=%H', '--diff-filter=A', '--', 'GATES.md'], {
    cwd: root, env: gitEnv, encoding: 'utf8',
  });
  const oldest = (found.stdout || '').trim().split('\n').filter(Boolean).at(-1);
  if (!oldest) return;
  const result = run(root, ['--rev', oldest]);
  assert.equal(result.status, 1, oldest);
  assert.match(result.output, /GATES\.md/);
});

test('the guard runs in the always-on ci-prepare job without adding a job', () => {
  const workflow = readFileSync(path.join(root, '.github', 'workflows', 'ci-tests.yml'), 'utf8');
  const start = workflow.indexOf('  ci-prepare:');
  const end = workflow.indexOf('\n  ci-checks:');
  assert.ok(start > 0 && end > start);
  const job = workflow.slice(start, end);
  const stepStart = job.indexOf('- name: Guard session ledgers');
  assert.ok(stepStart > 0, 'ci-prepare has no session ledger guard step');
  const nextStep = job.indexOf('\n      - ', stepStart + 1);
  const step = job.slice(stepStart, nextStep === -1 ? undefined : nextStep);
  assert.match(step, /run: node scripts\/check-session-ledgers\.mjs/);
  assert.doesNotMatch(step, /^\s+if:/m);
  assert.doesNotMatch(step, /continue-on-error/);
  assert.doesNotMatch(step, /uses: actions\/setup-node@/);
  const jobs = workflow.split('\n').filter(line => /^  [a-z][a-z0-9-]*:$/.test(line)).map(line => line.trim());
  assert.ok(!jobs.some(name => /ledger/.test(name)), 'the guard must not be its own job');
});
