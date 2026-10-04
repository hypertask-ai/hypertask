const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const script = path.resolve(__dirname, '../scripts/premerge-local.sh');

test('premerge-local rejects unknown arguments and extra arguments before touching Docker', () => {
  for (const args of [['help'], ['--help'], ['UP'], ['up', 'down'], ['down', 'extra'], ['down', '--flag', 'key=OFF'], ['up', '--flag'], ['up', '--flag', 'key=INVALID'], ['up', '--flag', 'key=OFF=EVERYONE']]) {
    const result = spawnSync('bash', [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage: scripts\/premerge-local\.sh \[up\|down\]/);
    assert.equal(result.stdout, '');
  }
});

test('premerge-local defaults to up, clears inherited secrets and refuses env files', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'premerge-local-test-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'bin'));
    const candidate = path.join(root, 'scripts/premerge-local.sh');
    copyFileSync(script, candidate);
    writeFileSync(path.join(root, '.env'), 'DATABASE_URL=must-not-be-read\n');
    writeFileSync(path.join(root, 'bin/docker'), `#!/bin/sh
[ -z "\$DATABASE_URL\$SESSION_SECRET\$VERCEL_TOKEN\$NODE_OPTIONS" ] || exit 19
[ "$1" = info ] && exit 0
exit 20
`, { mode: 0o755 });
    const result = spawnSync('bash', [candidate], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
        DATABASE_URL: 'production-must-not-reach-docker',
        SESSION_SECRET: 'must-not-reach-docker',
        VERCEL_TOKEN: 'must-not-reach-docker',
        NODE_OPTIONS: '--invalid-inherited-option',
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing \.env:.*No credentials were read/);
    assert.equal(result.stdout, '');
    assert.equal(readFileSync(path.join(root, '.env'), 'utf8'), 'DATABASE_URL=must-not-be-read\n');
    const flagged = spawnSync('bash', [candidate, 'up', '--flag', 'htpr-1-fixture=OFF', '--flag', 'htpr-2-fixture=OWNER_AND_QA'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(flagged.status, 1);
    assert.match(flagged.stderr, /Refusing \.env/);

    // Positive control: retaining any inherited variable makes the Docker probe fail.
    const control = spawnSync(path.join(root, 'bin/docker'), ['info'], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'unsafe' },
    });
    assert.equal(control.status, 19);

    // Down still works with env files present and no previous up.
    // Use the fake daemon, not a developer's real Docker.
    const fakeDown = spawnSync('bash', [candidate, 'down'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(fakeDown.status, 0);
    assert.equal(fakeDown.stdout, '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('down guards reused PIDs and cleans the local server and credentials during a Docker outage', { timeout: 10_000 }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'premerge-local-pid-'));
  const child = spawn(process.execPath, ['-e', 'process.title="premerge test";process.send("ready");setInterval(()=>{},1000)'], {
    detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  try {
    await once(child, 'message');
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'bin'));
    const state = path.join(root, 'e2e/smoke/.state/premerge-local');
    mkdirSync(state, { recursive: true });
    const candidate = path.join(root, 'scripts/premerge-local.sh');
    copyFileSync(script, candidate);
    writeFileSync(path.join(root, 'bin/docker'), '#!/bin/sh\n[ "$1" = info ] && exit 0\nexit 1\n', { mode: 0o755 });
    const stat = readFileSync(`/proc/${child.pid}/stat`, 'utf8');
    const started = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19];
    const env = { ...process.env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}` };
    writeFileSync(path.join(state, 'server.pid'), `${child.pid} ${Number(started) + 1}\n`);
    const reused = spawnSync('bash', [candidate, 'down'], { encoding: 'utf8', env });
    assert.equal(reused.status, 0);
    assert.equal(process.kill(child.pid, 0), true);
    writeFileSync(path.join(state, 'search.pid'), `${child.pid} ${started}\n`);
    writeFileSync(path.join(state, 'flag-modes.json'), 'disposable fixture');
    writeFileSync(path.join(state, 'credentials.env'), 'disposable fixture');
    writeFileSync(path.join(state, 'smoke-state.json'), 'disposable fixture');
    writeFileSync(path.join(root, 'bin/docker'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const exited = once(child, 'exit');
    const down = spawnSync('bash', [candidate, 'down'], { encoding: 'utf8', env });
    assert.equal(down.status, 1);
    assert.match(down.stderr, /Docker unavailable.*Rerun down/);
    await exited;
    assert.equal(child.signalCode, 'SIGTERM');
    for (const file of ['server.pid', 'search.pid', 'flag-modes.json', 'credentials.env', 'smoke-state.json']) {
      assert.throws(() => readFileSync(path.join(state, file)), { code: 'ENOENT' });
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
});

test('background server closes captured output descriptors, with a retained-stderr control', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'premerge-local-fds-'));
  try {
    const nextDir = path.join(root, 'node_modules/next/dist/bin');
    mkdirSync(nextDir, { recursive: true });
    writeFileSync(path.join(nextDir, 'next'), 'setInterval(()=>{},1000);');
    mkdirSync(path.join(root, 'scripts'));
    writeFileSync(path.join(root, 'scripts/premerge-local-search.mjs'), 'setInterval(()=>{},1000);');
    const launches = readFileSync(script, 'utf8').split('\n').filter(line => line.startsWith('setsid node '));
    assert.equal(launches.length, 2);
    for (const launch of launches) for (const retainStderr of [false, true]) {
      const line = retainStderr ? launch.replace(' 4>&-', '') : launch;
      const result = spawnSync('bash', ['-c', `exec 3>&1 4>&2 9>"$state/lock"\n${line}\nprintf '%s' "$!" >"$state/pid"\n`], {
        encoding: 'utf8', timeout: 1000,
        env: { ...process.env, root, state: root, app_port: '3100' },
      });
      try {
        if (retainStderr) assert.equal(result.error?.code, 'ETIMEDOUT');
        else {
          assert.equal(result.error, undefined);
          assert.equal(result.status, 0);
          assert.equal(result.stdout, '');
          assert.equal(result.stderr, '');
        }
      } finally {
        const pid = Number(readFileSync(path.join(root, 'pid'), 'utf8'));
        try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
