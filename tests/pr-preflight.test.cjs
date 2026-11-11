const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../.github/scripts/pr-preflight.cjs');
const { preflight, titleProblem, countHandWritten, parseNumstat } = require(script);
const GOOD = 'HTPR-8935 [INFRA] Stop oversized pull requests';

function gitRepo(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', ...args], {
    cwd: root, encoding: 'utf8',
  });
  assert.equal(git('init', '-q', '-b', 'production').status, 0);
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n');
  assert.equal(git('add', '-A').status, 0);
  assert.equal(git('commit', '-q', '-m', 'base').status, 0);
  assert.equal(git('checkout', '-q', '-b', 'feature').status, 0);
  for (const [name, lines] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Array.from({ length: lines }, (_, index) => `line ${index}\n`).join(''));
  }
  git('add', '-A');
  assert.equal(git('commit', '-q', '-m', 'feature').status, 0);
  return root;
}

function runCli(args, cwd) {
  return spawnSync('node', [script, ...args], { cwd, encoding: 'utf8', timeout: 30_000 });
}

test('a 1256-line change is refused with the split message, before anything opens', (t) => {
  const root = gitRepo(t, { 'src/big.ts': 1256 });
  const result = preflight({ title: GOOD, base: 'production', cwd: root });
  assert.equal(result.ok, false);
  assert.equal(result.output, 'PR size: 1256 hand-written lines is over the 400-line cap. ' +
    'Split it into smaller changes that each build green.');
  const cli = runCli(['--title', GOOD, '--base', 'production'], root);
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /^PR size: 1256 hand-written lines is over the 400-line cap\./);
});

test('a normal 50-line pull request passes on the command line', (t) => {
  const root = gitRepo(t, { 'src/small.ts': 50 });
  const cli = runCli(['--title', GOOD, '--base', 'production'], root);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /50 hand-written lines \(cap 400/);
});

test('a title with no ticket and tag is refused and the right shape is shown', (t) => {
  const result = runCli(['--title', 'Fix the sidebar'], gitRepo(t, { 'src/a.ts': 1 }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /got:      Fix the sidebar/);
  assert.match(result.stderr, /expected: \(HTPR\|HYFA\|YPER4\|HYCI\)-<n> \[TAG\] <summary>/);
  assert.match(result.stderr, /Example: HTPR-5626 \[INFRA\]/);
});

for (const [title, reason] of [
  ['HTPR-1 fix the sidebar', 'no tag'],
  ['NOPE-12 [INFRA] do a thing', 'unknown ticket prefix'],
  ['HTPR-12 [NOPE] do a thing', 'unknown tag'],
  ['HTPR-12 [INFRA] ', 'no summary'],
]) {
  test(`a title with ${reason} is refused`, () => assert.ok(titleProblem(title)));
}

test('generated and fixture lines are skipped, like the GitHub guard skips them', () => {
  const size = countHandWritten(parseNumstat(
    '1256\t0\tsrc/big.ts\n900\t0\tpackage-lock.json\n40\t40\ttests/fixtures/large.json',
  ));
  assert.deepEqual(size, { counted: 1256, ignored: 980, cap: 400, overCap: true });
});

test('a rename counts once, braced or plain, and checks both names against the exclusions', () => {
  const changes = parseNumstat([
    '10\t2\tsrc/{old.ts => new.ts}',
    '30\t0\tsrc/generated/{a.ts => b.ts}',
    '5\t0\ta.ts => b.ts',
  ].join('\n'));
  assert.equal(changes[0].filenames.join(','), 'src/old.ts,src/new.ts');
  assert.equal(changes[2].filenames.join(','), 'a.ts,b.ts');
  assert.deepEqual(countHandWritten(changes), { counted: 17, ignored: 30, cap: 400, overCap: false });
});

test('an unreadable line count is refused instead of guessed', () => {
  assert.throws(() => parseNumstat('12\t0'), /Unreadable git diff line/);
  assert.throws(() => countHandWritten([{ filenames: ['src/a.ts'], lines: Number.NaN }]), /no trustworthy size count/);
});

test('an over-cap change opens only with a recorded reason', (t) => {
  const root = gitRepo(t, { 'src/big.ts': 1256 });
  const result = runCli(['--title', GOOD, '--base', 'production', '--allow-over-cap', 'one mechanical rename'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PR size exception recorded: one mechanical rename/);
});

test('an unreadable base or a missing title is refused, never treated as small', (t) => {
  const root = gitRepo(t, { 'src/small.ts': 5 });
  assert.match(preflight({ title: GOOD, base: 'origin/missing', cwd: root }).output,
    /PR size could not be measured against origin\/missing/);
  const cli = runCli([], root);
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /--title is required/);
});
