const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync } = require('node:fs');
const { join, dirname } = require('node:path');
const { tmpdir } = require('node:os');

const root = join(__dirname, '..');
const command = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).ignoreCommand;

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'vercel-ignore-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com' },
  }).trim();
  function change(file, content = 'changed\n') {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), content);
    git('add', '--', file);
    git('commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  }
  git('init');
  mkdirSync(join(cwd, 'scripts'));
  copyFileSync(join(root, 'scripts/vercel-ignore-build.cjs'), join(cwd, 'scripts/vercel-ignore-build.cjs'));
  const base = change('src/app/page.tsx', 'initial\n');
  function run(previous = base, extra = {}, args) {
    return spawnSync(args ? process.execPath : command, args || [], {
      cwd, shell: !args, encoding: 'utf8',
      env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: previous,
        VERCEL_GIT_COMMIT_SHA: git('rev-parse', 'HEAD'), ...extra },
    });
  }
  return { cwd, git, base, change, run };
}

for (const file of ['.claude/skills/ship/SKILL.md', '.github/workflows/ci-tests.yml',
  'docs/ci.md', 'tests/route.test.cjs', 'e2e/smoke/a.spec.ts', 'skills/a/SKILL.md',
  '.agents/skills/a/SKILL.md', 'README.md']) {
  test(`configured ignored-build step skips ${file}`, t => {
    const f = fixture(t);
    f.change(file);
    const result = f.run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Skip build/);
  });
}

for (const file of ['src/app/page.tsx', 'src/app/wiki/help.md', 'public/icon.svg',
  'prisma/schema.prisma', 'package.json', 'package-lock.json', 'next.config.js',
  'middleware.ts', 'vercel.json', 'scripts/run-production-migrations.mjs',
  'scripts/vercel-ignore-build.cjs', 'packages/ui/index.ts', 'tsconfig.json',
  'postcss.config.js', 'tailwind.config.ts', 'types/window.d.ts', '.npmrc',
  'new-runtime-input', 'src/a\nREADME.md']) {
  test(`configured ignored-build step builds ${JSON.stringify(file)}`, t => {
    const f = fixture(t);
    let content = 'changed\n';
    if (file === 'package.json') content = '{"version":"1.0.1"}\n';
    if (file === 'scripts/vercel-ignore-build.cjs') content = readFileSync(join(root, file), 'utf8') + '\n';
    f.change(file, content);
    const result = f.run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /Build required/);
  });
}

test('compares the whole batch since the successful deployment, not HEAD parent', t => {
  const f = fixture(t);
  f.change('src/app/page.tsx', 'app update\n');
  f.change('docs/ci.md');
  assert.equal(f.run().status, 1);
  assert.equal(f.run(f.git('rev-parse', 'HEAD^')).status, 0);
});

test('builds when source is moved into an ignored directory', t => {
  const f = fixture(t);
  mkdirSync(join(f.cwd, 'docs'));
  f.git('mv', 'src/app/page.tsx', 'docs/page.tsx');
  f.git('commit', '-m', 'move');
  assert.equal(f.run().status, 1);
});

test('unknown, unavailable, divergent and empty comparisons build safely', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 1);
  assert.equal(f.run('', {}, ['scripts/vercel-ignore-build.cjs', '--between', f.base, f.base]).status, 0);
  f.change('docs/ci.md');
  for (const previous of ['', '0'.repeat(40), '--help', 'a'.repeat(40)]) {
    assert.equal(f.run(previous).status, 1, previous);
  }
  assert.equal(f.run(f.base, { VERCEL_GIT_COMMIT_SHA: '' }).status, 1);
  f.git('checkout', '-b', 'other', f.base);
  const divergent = f.change('docs/other.md');
  f.git('checkout', '-b', 'candidate', f.base);
  f.change('docs/candidate.md');
  assert.equal(f.run(divergent).status, 1);
});

test('health comparison uses the identical policy, including tests and unknown paths', t => {
  const f = fixture(t);
  const tests = f.change('tests/new.test.cjs');
  const compare = () => f.run('', {}, ['scripts/vercel-ignore-build.cjs', '--between', f.base, f.git('rev-parse', 'HEAD')]);
  assert.equal(compare().status, 0);
  f.change('src/app/page.tsx', 'app update\n');
  assert.equal(compare().status, 1);
  assert.equal(f.run('', {}, ['scripts/vercel-ignore-build.cjs', '--between', tests, 'f'.repeat(40)]).status, 1);
});
