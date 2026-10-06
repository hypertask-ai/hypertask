const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = readFileSync(path.join(root, 'scripts/premerge-local.sh'), 'utf8');
const stop = source.slice(source.indexOf('stop() {'), source.indexOf('if [ "$action" = down ]; then stop;'));
const cleanup = source.slice(source.indexOf('cleanup() {'), source.indexOf('# Logs can contain'));
const started = readFileSync(`/proc/${process.pid}/stat`, 'utf8').split(') ')[1].split(' ')[19];

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ht-premerge-lifetime-'));
  const state = path.join(dir, 'state');
  mkdirSync(state);
  const log = path.join(dir, 'operations');
  writeFileSync(log, '');
  const mocks = `
kill() { printf 'kill %s\\n' "$*" >>"$log"; [ "$1" != -0 ]; }
docker() { printf 'docker %s\\n' "$*" >>"$log"; return 0; }
`;
  return { dir, state, log, mocks };
}

test('EXIT always cleans both PID records and containers, preserving run status', () => {
  for (const status of [0, 17, 130, 143]) {
    const f = fixture();
    try {
      for (const name of ['server.pid', 'search.pid']) writeFileSync(path.join(f.state, name), `${process.pid} ${started}\n`);
      writeFileSync(path.join(f.state, 'credentials.env'), 'private-fixture');
      // All signal and Docker operations are shell functions, never live operations.
      const result = spawnSync('bash', ['-c', `set -euo pipefail\n${f.mocks}\n${stop}\n${cleanup}\nexit ${status}`], {
        env: { ...process.env, state: f.state, log: f.log, prefix: 'ht-premerge-fixture' }, encoding: 'utf8',
      });
      assert.equal(result.status, status);
      const operations = readFileSync(f.log, 'utf8');
      assert.equal(operations.split(`kill -TERM -- -${process.pid}\n`).length - 1, 2);
      for (const name of ['postgres', 'redis', 'soketi']) assert.match(operations, new RegExp(`docker rm -f -v ht-premerge-fixture-${name}`));
      for (const name of ['server.pid', 'search.pid', 'run.pid', 'credentials.env']) assert.throws(() => readFileSync(path.join(f.state, name)), { code: 'ENOENT' });
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  }
  assert.match(cleanup, /trap cleanup EXIT/);
  assert.match(cleanup, /trap 'exit 130' INT/);
  assert.match(cleanup, /trap 'exit 143' TERM/);
  assert.match(source, /printf '%s %s\\n' "\$pid".*>"\$state\/server\.pid"/);
  assert.match(source, /printf '%s %s\\n' "\$\$".*>"\$state\/run\.pid"/);
  assert.match(source, /wait "\$pid"\s*$/);
});

test('down stops the owning run, checks PID reuse, and still cleans server state', () => {
  for (const reused of [false, true]) {
    const f = fixture();
    try {
      const fixtureRoot = path.join(f.dir, 'repo');
      const state = path.join(fixtureRoot, 'e2e/smoke/.state/premerge-local');
      mkdirSync(path.join(fixtureRoot, 'scripts'), { recursive: true });
      mkdirSync(state, { recursive: true });
      const candidate = path.join(fixtureRoot, 'scripts/premerge-local.sh');
      writeFileSync(candidate, source.replace('set +x', `set +x\n${f.mocks}`));
      for (const name of ['server.pid', 'search.pid', 'run.pid']) writeFileSync(path.join(state, name), `${process.pid} ${reused ? Number(started) + 1 : started}\n`);
      const result = spawnSync('bash', [candidate, 'down'], {
        env: { ...process.env, PREMERGE_CLEAN_ENV: fixtureRoot, log: f.log }, encoding: 'utf8',
      });
      assert.equal(result.status, 0);
      const operations = readFileSync(f.log, 'utf8');
      if (reused) assert.doesNotMatch(operations, /kill /);
      else {
        assert.match(operations, new RegExp(`kill -TERM ${process.pid}\\n`));
        assert.match(operations, new RegExp(`kill -TERM -- -${process.pid}\\n`));
      }
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  }
});

test('stale sweep and opt-in hourly user timer pass isolated Python tests', () => {
  const result = spawnSync('python3', [path.join(root, 'scripts/premerge-local-sweep.test.py')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /OK/);
  assert.match(source, /exec python3 "\$root\/scripts\/premerge-local-sweep\.py" "\$action"/);
});


test('printed evidence can be checked without waiting for the owning server', () => {
  const start = source.indexOf("printf 'Build URL:");
  const print = source.slice(start, source.indexOf("\n# Keep the owning run alive", start));
  const result = spawnSync('bash', ['-c', print], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, url: 'http://127.0.0.1:3100', board_path: '/projects/project-7283',
      BROWSER_SMOKE_STATE_FILE: '/unused', account: '985', flags: 'htpr-1-fixture=EVERYONE' },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 0);
  assert.match(result.output[3], /^Board: http:\/\/127\.0\.0\.1:3100\/projects\/project-7283$/m);
  assert.doesNotMatch(result.output[3], /Keep this run open/);
});
