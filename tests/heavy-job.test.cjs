const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/heavy-job.sh');
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ht-heavy-test-'));
  const env = { ...process.env, XDG_RUNTIME_DIR: dir, HT_HEAVY_SLOTS: '1', CI: 'false' };
  delete env.GITHUB_ACTIONS;
  return { dir, env };
}
function run(env, code, cwd = root) {
  const child = spawn('bash', [script, process.execPath, '-e', code], { env, cwd });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
  const ready = new Promise(resolve => child.stdout.once('data', resolve));
  return { done, ready };
}

test('one shared slot queues a second worktree and prints exactly one wait line', async () => {
  const { dir, env } = fixture();
  try {
    mkdirSync(path.join(dir, 'other-worktree'));
    const first = run(env, 'console.log("holder");setTimeout(()=>console.log("released "+Date.now()),700)');
    await first.ready;
    const second = run(env, 'console.log("second "+Date.now())', path.join(dir, 'other-worktree'));
    const [a, b] = await Promise.all([first.done, second.done]);
    assert.equal(a.status, 0);
    assert.equal(b.status, 0);
    assert.ok(Number(b.stdout.trim().split(' ')[1]) >= Number(a.stdout.trim().split('released ')[1]), 'second starts only after the holder releases');
    assert.equal(b.stderr, 'waiting for a heavy-job slot, 1 in use\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CI=true and GITHUB_ACTIONS set bypass an occupied slot without waiting', async () => {
  const { dir, env } = fixture();
  try {
    const holder = run(env, 'console.log("holder");setTimeout(()=>{},900)');
    await holder.ready;
    let finished = false;
    holder.done.then(() => { finished = true; });
    for (const override of [{ CI: 'true' }, { GITHUB_ACTIONS: '' }]) {
      const result = await run({ ...env, ...override }, 'console.log("CI")').done;
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, 'CI\n');
      assert.equal(finished, false, 'CI ran before the holder released');
    }
    await holder.done;
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('abnormal command exit releases its flock and preserves the exit status', async () => {
  const { dir, env } = fixture();
  try {
    const failed = await run(env, 'process.exit(17)').done;
    assert.equal(failed.status, 17);
    const next = await run(env, 'console.log("released")').done;
    assert.equal(next.status, 0);
    assert.equal(next.stderr, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('default is max(2, nproc/6), override is validated, and arguments stay intact', async () => {
  const { dir, env } = fixture();
  try {
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'nproc'), '#!/bin/sh\nprintf "%s\\n" "$TEST_CORES"\n', { mode: 0o755 });
    for (const [cores, expected] of [['1', 2], ['18', 3]]) {
      const configuration = { ...env, HT_HEAVY_SLOTS: '', PATH: `${bin}:${env.PATH}`, TEST_CORES: cores };
      const holders = [];
      for (let i = 0; i < expected; i++) {
        const holder = run(configuration, 'console.log("holder");setTimeout(()=>{},1200)');
        holders.push(holder.done);
        await holder.ready;
      }
      const queued = run(configuration, 'console.log("queued")');
      const result = await queued.done;
      assert.equal(result.stderr, `waiting for a heavy-job slot, ${expected} in use\n`);
      await Promise.all(holders);
    }
    for (const slots of ['0', '-1', 'abc']) {
      const result = spawnSync('bash', [script, 'true'], { env: { ...env, HT_HEAVY_SLOTS: slots } });
      assert.equal(result.status, 2);
    }
    const result = spawnSync('bash', [script, 'printf', '%s', 'a b'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'a b');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('npm lint, test, test:file, typecheck and premerge build use the semaphore', () => {
  const { scripts } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const name of ['lint', 'lint:changed', 'test', 'test:file', 'typecheck']) {
    assert.match(scripts[name], /^bash scripts\/heavy-job\.sh /);
  }
  const premerge = readFileSync(path.join(root, 'scripts/premerge-local.sh'), 'utf8');
  assert.match(premerge, /bash "\$root\/scripts\/heavy-job\.sh" npx --no-install next build --webpack/);
  assert.match(premerge, /HT_HEAVY_SLOTS="\$\{HT_HEAVY_SLOTS:-\}"/);
});
