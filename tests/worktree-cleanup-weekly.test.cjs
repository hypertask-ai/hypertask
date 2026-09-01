const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'worktree-cleanup-weekly.sh');

function command(file, args, options = {}) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 180_000,
    ...options,
  }).trim();
}

function git(cwd, args) {
  return command('git', ['-C', cwd, ...args]);
}

function createFixture(tempRoot = os.tmpdir()) {
  const root = fs.mkdtempSync(path.join(tempRoot, 'htpr-5106-'));
  const repo = path.join(root, 'repo');
  const remote = path.join(root, 'remote.git');
  const worktree = path.join(root, 'worktree');
  const state = path.join(root, 'state');
  const response = path.join(root, 'prs.json');
  const openResponse = path.join(root, 'open-prs.json');
  const fakeGh = path.join(root, 'fake-gh');
  const fakeGit = path.join(root, 'fake-git');
  const fakeFlock = path.join(root, 'flock');
  const mutationMarker = path.join(root, 'mutation-once');
  const flockCount = path.join(root, 'flock-count');
  const log = path.join(root, 'cleanup.log');
  const procRoot = path.join(root, 'proc');
  const branch = 'feature/5106';

  fs.mkdirSync(procRoot);

  command('git', ['init', '--bare', remote]);
  command('git', ['init', repo]);
  git(repo, ['config', 'user.email', 'qa@example.test']);
  git(repo, ['config', 'user.name', 'QA Test']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-m', 'base']);
  git(repo, ['branch', '-M', 'staging']);
  git(repo, ['remote', 'add', 'origin', remote]);
  git(repo, ['push', '-u', 'origin', 'staging']);
  git(repo, ['checkout', '-b', branch]);
  fs.appendFileSync(path.join(repo, 'README.md'), 'feature\n');
  git(repo, ['commit', '-am', 'feature']);
  git(repo, ['push', '-u', 'origin', branch]);
  git(repo, ['checkout', 'staging']);
  git(repo, ['worktree', 'add', worktree, branch]);
  git(repo, ['merge', '--ff-only', branch]);
  git(repo, ['push', 'origin', 'staging']);

  fs.writeFileSync(response, '[]');
  fs.writeFileSync(openResponse, '[]');
  fs.writeFileSync(fakeGh, '#!/bin/sh\nif [ "${GH_FAIL:-0}" = "1" ]; then exit 17; fi\nif [ -n "${GH_FAIL_AFTER_FILE:-}" ] && [ -e "$GH_FAIL_AFTER_FILE" ]; then exit 17; fi\nif [ -n "${GH_READY_FILE:-}" ]; then : > "$GH_READY_FILE"; fi\nif [ -n "${GH_SLEEP:-}" ]; then sleep "$GH_SLEEP"; fi\ncase " $* " in *" --state open "*) cat "$GH_OPEN_RESPONSE" ;; *) cat "$GH_RESPONSE" ;; esac\n');
  fs.chmodSync(fakeGh, 0o755);
  fs.writeFileSync(fakeGit, `#!/bin/sh
REAL_GIT=$(command -v git) || exit 127
if [ "${'$'}{GIT_MUTATE_MODE:-}" = "remote-query-fail" ] && [ "${'$'}3" = "ls-remote" ] && [ -n "${'$'}{6:-}" ]; then
  exit 17
fi
if [ "${'$'}{GIT_MUTATE_MODE:-}" = "local-fail" ] && [ "${'$'}{GIT_MUTATE_MARKER:-}" != "" ] && [ ! -e "${'$'}GIT_MUTATE_MARKER" ] && [ "${'$'}1" = "-C" ] && [ "${'$'}3" = "update-ref" ] && [ "${'$'}4" = "-d" ]; then
  : > "${'$'}GIT_MUTATE_MARKER"
  exit 1
fi
if [ "${'$'}{GIT_MUTATE_MODE:-}" = "local" ] && [ "${'$'}{GIT_MUTATE_MARKER:-}" != "" ] && [ ! -e "${'$'}GIT_MUTATE_MARKER" ] && [ "${'$'}1" = "-C" ] && [ "${'$'}3" = "update-ref" ] && [ "${'$'}4" = "-d" ]; then
  : > "${'$'}GIT_MUTATE_MARKER"
  "${'$'}REAL_GIT" -C "${'$'}GIT_MUTATE_REPO" update-ref "refs/heads/${'$'}GIT_MUTATE_BRANCH" "${'$'}GIT_MUTATE_TIP"
fi
if [ "${'$'}{GIT_MUTATE_MODE:-}" = "remote" ] && [ "${'$'}{GIT_MUTATE_MARKER:-}" != "" ] && [ ! -e "${'$'}GIT_MUTATE_MARKER" ] && [ "${'$'}1" = "-C" ] && [ "${'$'}3" = "push" ] && echo " ${'$'}*" | grep -Fq " :refs/heads/${'$'}GIT_MUTATE_BRANCH"; then
  : > "${'$'}GIT_MUTATE_MARKER"
  "${'$'}REAL_GIT" -C "${'$'}GIT_MUTATE_REPO" push origin "staging:refs/heads/${'$'}GIT_MUTATE_BRANCH"
fi
if [ "${'$'}{GIT_MUTATE_MODE:-}" = "open-pr" ] && [ "${'$'}{GIT_MUTATE_MARKER:-}" != "" ] && [ ! -e "${'$'}GIT_MUTATE_MARKER" ] && [ "${'$'}1" = "-C" ] && [ "${'$'}3" = "push" ] && echo " ${'$'}*" | grep -Fq " :refs/heads/${'$'}GIT_MUTATE_BRANCH"; then
  : > "${'$'}GIT_MUTATE_MARKER"
  printf '[{"number":5106}]\n' > "${'$'}GH_OPEN_RESPONSE"
fi
if [ "${'$'}{GIT_MUTATE_MODE:-}" = "post-delete-gh-fail" ] && [ "${'$'}{GIT_MUTATE_MARKER:-}" != "" ] && [ ! -e "${'$'}GIT_MUTATE_MARKER" ] && [ "${'$'}1" = "-C" ] && [ "${'$'}3" = "push" ] && echo " ${'$'}*" | grep -Fq " :refs/heads/${'$'}GIT_MUTATE_BRANCH"; then
  : > "${'$'}GIT_MUTATE_MARKER"
fi
if [ "${'$'}{GIT_MUTATE_MODE:-}" = "post-delete-restore-fail" ] && [ ! -e "${'$'}GIT_MUTATE_MARKER" ] && [ "${'$'}1" = "-C" ] && [ "${'$'}3" = "push" ] && echo " ${'$'}*" | grep -Fq " :refs/heads/${'$'}GIT_MUTATE_BRANCH"; then
  : > "${'$'}GIT_MUTATE_MARKER"
fi
if [ "${'$'}{GIT_MUTATE_MODE:-}" = "post-delete-restore-fail" ] && [ -e "${'$'}GIT_MUTATE_MARKER" ] && [ "${'$'}1" = "-C" ] && [ "${'$'}3" = "push" ] && echo " ${'$'}*" | grep -Fq ":refs/heads/${'$'}GIT_MUTATE_BRANCH" && echo " ${'$'}*" | grep -Fq "refs/hypertask-cleanup/"; then
  exit 17
fi
if [ "${'$'}{GIT_MUTATE_MODE:-}" = "register-worktree" ] && [ "${'$'}{GIT_MUTATE_MARKER:-}" != "" ] && [ ! -e "${'$'}GIT_MUTATE_MARKER" ] && [ "${'$'}1" = "-C" ] && [ "${'$'}3" = "update-ref" ] && [ "${'$'}4" = "-d" ]; then
  : > "${'$'}GIT_MUTATE_MARKER"
  "${'$'}REAL_GIT" -C "${'$'}GIT_MUTATE_REPO" worktree add "${'$'}GIT_MUTATE_WORKTREE" "${'$'}GIT_MUTATE_BRANCH"
fi
if [ "${'$'}{GIT_MUTATE_MODE:-}" = "status-fail" ] && [ "${'$'}1" = "-C" ] && [ "${'$'}2" = "${'$'}GIT_MUTATE_WORKTREE" ] && [ "${'$'}3" = "status" ]; then
  exit 17
fi
if [ "${'$'}{GIT_MUTATE_MODE:-}" = "quarantine" ] && [ "${'$'}{GIT_MUTATE_MARKER:-}" != "" ] && [ ! -e "${'$'}GIT_MUTATE_MARKER" ] && [ "${'$'}1" = "-C" ] && [ "${'$'}3" = "worktree" ] && [ "${'$'}4" = "move" ]; then
  "${'$'}REAL_GIT" "${'$'}@"
  status=${'$'}?
  if [ "${'$'}status" -eq 0 ]; then
    : > "${'$'}GIT_MUTATE_MARKER"
    printf 'quarantine race\n' > "${'$'}7/quarantine-race.txt"
  fi
  exit "${'$'}status"
fi
exec "${'$'}REAL_GIT" "${'$'}@"
`);
  fs.chmodSync(fakeGit, 0o755);
  const realFlock = command('sh', ['-c', 'command -v flock']);
  fs.writeFileSync(fakeFlock, `#!/bin/sh
REAL_FLOCK=${realFlock}
count=0
if [ -n "${'$'}{FLOCK_COUNT_FILE:-}" ]; then
  count=${'$'}(cat "${'$'}FLOCK_COUNT_FILE" 2>/dev/null || printf '0')
  count=${'$'}((count + 1))
  printf '%s\n' "${'$'}count" > "${'$'}FLOCK_COUNT_FILE"
fi
"${'$'}REAL_FLOCK" "${'$'}@"
status=${'$'}?
if [ "${'$'}count" -eq 2 ] && [ -n "${'$'}{FLOCK_REPLACE_FILE:-}" ]; then
  cat "${'$'}FLOCK_REPLACEMENT" > "${'$'}FLOCK_REPLACE_FILE"
  chmod 600 "${'$'}FLOCK_REPLACE_FILE"
fi
exit "${'$'}status"
`);
  fs.chmodSync(fakeFlock, 0o755);

  const env = {
    ...process.env,
    REPO_DIR: repo,
    REPO_SLUG: 'example/hypertasks',
    BASE_BRANCH: 'staging',
    WORKTREE_ROOT: root,
    STATE_DIR: state,
    LEASE_DIR: path.join(state, 'leases'),
    LOCK_FILE: path.join(state, 'cleanup.lock'),
    LOG_FILE: log,
    PROC_ROOT: procRoot,
    GH_BIN: fakeGh,
    GH_RESPONSE: response,
    GH_OPEN_RESPONSE: openResponse,
    GH_READY_FILE: path.join(root, 'gh-ready'),
    LEASE_TTL_SECONDS: '3600',
    MIN_MERGED_AGE_SECONDS: '0',
    CACHE_MIN_IDLE_SECONDS: '0',
    CACHE_CLEANUP_LIMIT: '25',
  };

  return {
    root,
    repo,
    remote,
    worktree,
    state,
    response,
    openResponse,
    fakeGh,
    fakeGit,
    fakeFlock,
    mutationMarker,
    flockCount,
    log,
    branch,
    env,
  };
}

test('accepts a private state directory below a sticky shared parent', (t) => {
  const fixture = createFixture('/tmp');
  t.after(() => cleanupFixture(fixture));

  markReady(fixture);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
});

test('places default state in the common Git directory from a linked worktree', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const env = { ...fixture.env, REPO_DIR: fixture.worktree };
  for (const key of ['STATE_DIR', 'LEASE_DIR', 'LOCK_FILE', 'LOG_FILE']) delete env[key];

  command(SCRIPT, ['--dry-run'], { cwd: fixture.worktree, env });

  assert.equal(
    fs.existsSync(path.join(fixture.repo, '.git', 'hypertask-worktree-cleanup')),
    true,
  );
});

test('lease cleanup still runs when cache cleanup has no worktree root', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  writePrResponse(fixture, [mergedPrForFixture(fixture)]);
  const cacheDisabled = {
    WORKTREE_ROOT: path.join(fixture.root, 'missing-worktree-root'),
    CACHE_CLEANUP_LIMIT: '0',
  };

  runScript(fixture, ['--mark-ready', fixture.worktree], cacheDisabled);
  runScript(fixture, [], cacheDisabled);

  assert.equal(fs.existsSync(fixture.worktree), false);
});

test('rejects a non-sticky writable state ancestor owned by the current user', (t) => {
  const writableParent = fs.mkdtempSync(path.join(os.tmpdir(), 'htpr-5106-writable-'));
  fs.chmodSync(writableParent, 0o777);
  const fixture = createFixture(writableParent);
  t.after(() => {
    cleanupFixture(fixture);
    fs.chmodSync(writableParent, 0o700);
    fs.rmSync(writableParent, { recursive: true, force: true });
  });

  assert.throws(() => markReady(fixture));
  assert.equal(fs.existsSync(fixture.worktree), true);
});

test('accepts a group-writable ancestor when the primary group has no other users', (t) => {
  const privateGroupParent = fs.mkdtempSync(path.join(os.tmpdir(), 'htpr-5106-private-group-'));
  fs.chmodSync(privateGroupParent, 0o770);
  const fixture = createFixture(privateGroupParent);
  t.after(() => {
    cleanupFixture(fixture);
    fs.chmodSync(privateGroupParent, 0o700);
    fs.rmSync(privateGroupParent, { recursive: true, force: true });
  });

  markReady(fixture);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
});

test('rejects extended ACLs on a group-writable ancestor', (t) => {
  const privateGroupParent = fs.mkdtempSync(path.join(os.tmpdir(), 'htpr-5106-acl-'));
  fs.chmodSync(privateGroupParent, 0o770);
  const fixture = createFixture(privateGroupParent);
  const fakeLs = path.join(fixture.root, 'fake-ls');
  t.after(() => {
    cleanupFixture(fixture);
    fs.chmodSync(privateGroupParent, 0o700);
    fs.rmSync(privateGroupParent, { recursive: true, force: true });
  });
  fs.writeFileSync(fakeLs, '#!/bin/sh\nprintf "drwxrwx---+ 1 owner group 0 Aug 23 00:00 path\\n"\n');
  fs.chmodSync(fakeLs, 0o755);

  assert.throws(() => runScript(fixture, ['--mark-ready', fixture.worktree], { LS_BIN: fakeLs }));
  assert.equal(fs.existsSync(leasePath(fixture)), false);
});

test('rejects a group-writable ancestor when another account receives its GID', (t) => {
  const privateGroupParent = fs.mkdtempSync(path.join(os.tmpdir(), 'htpr-5106-gid-'));
  fs.chmodSync(privateGroupParent, 0o770);
  const fixture = createFixture(privateGroupParent);
  const fakeId = path.join(fixture.root, 'fake-id');
  const realId = command('sh', ['-c', 'command -v id']);
  const uid = command(realId, ['-u']);
  const gid = command(realId, ['-g']);
  const user = command(realId, ['-un']);
  t.after(() => {
    cleanupFixture(fixture);
    fs.chmodSync(privateGroupParent, 0o700);
    fs.rmSync(privateGroupParent, { recursive: true, force: true });
  });
  fs.writeFileSync(fakeId, `#!/bin/sh
case "${'$'}1" in
  -u) printf '${uid}\\n' ;;
  -g) printf '${gid}\\n' ;;
  -un) printf '${user}\\n' ;;
  -G) printf '${gid}\\n' ;;
  *) exit 2 ;;
esac
`);
  fs.chmodSync(fakeId, 0o755);

  assert.throws(() => runScript(fixture, ['--mark-ready', fixture.worktree], { ID_BIN: fakeId }));
  assert.equal(fs.existsSync(leasePath(fixture)), false);
});

function cleanupFixture(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

function runScript(fixture, args = [], extraEnv = {}) {
  return command(SCRIPT, args, {
    cwd: fixture.repo,
    env: { ...fixture.env, ...extraEnv },
  });
}

function tip(fixture) {
  return git(fixture.repo, ['rev-parse', `refs/heads/${fixture.branch}`]);
}

function writePrResponse(fixture, records) {
  fs.writeFileSync(fixture.response, JSON.stringify(records));
}

function writeOpenPrResponse(fixture, records) {
  fs.writeFileSync(fixture.openResponse, JSON.stringify(records));
}

function createReproducibleCaches(fixture) {
  fs.appendFileSync(
    path.join(fixture.repo, '.git', 'info', 'exclude'),
    '\nnode_modules/\n.next/\n*.tsbuildinfo\n',
  );
  fs.mkdirSync(path.join(fixture.worktree, 'node_modules', 'package'), { recursive: true });
  fs.writeFileSync(path.join(fixture.worktree, 'node_modules', 'package', 'index.js'), 'cache\n');
  fs.mkdirSync(path.join(fixture.worktree, '.next', 'cache', 'webpack', 'client'), { recursive: true });
  fs.writeFileSync(path.join(fixture.worktree, '.next', 'cache', 'webpack', 'client', 'entry'), 'cache\n');
  fs.writeFileSync(path.join(fixture.worktree, 'tsconfig.tsbuildinfo'), 'cache\n');
}
function mergedPrForFixture(fixture) {
  return {
    number: 5106,
    state: 'MERGED',
    mergedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    headRefName: fixture.branch,
    headRefOid: tip(fixture),
    baseRefName: 'staging',
  };
}
function leasePath(fixture, target = fixture.worktree) {
  const id = crypto.createHash('sha256').update(target).digest('hex');
  return path.join(fixture.state, 'leases', `${id}.lease`);
}

function backupRef(fixture, target = fixture.worktree) {
  const id = crypto.createHash('sha256').update(target).digest('hex');
  return `refs/hypertask-cleanup/${id}`;
}

function writeLease(fixture, target, contents) {
  const file = leasePath(fixture, target);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  fs.writeFileSync(file, contents, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function markReady(fixture) {
  runScript(fixture, ['--mark-ready', fixture.worktree]);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
}

function remoteBranchTip(fixture) {
  return git(fixture.repo, ['ls-remote', '--heads', fixture.remote, `refs/heads/${fixture.branch}`]);
}

async function waitUntil(predicate, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('timed out waiting for test condition');
}

function waitForExit(child, timeout = 180_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode ?? 129);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('child process timed out'));
    }, timeout);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve(code ?? 128 + (signal ? 1 : 0));
    });
  });
}

function spawnScript(fixture, args = [], extraEnv = {}) {
  return spawn(SCRIPT, args, {
    cwd: fixture.repo,
    env: { ...fixture.env, ...extraEnv },
    stdio: 'ignore',
  });
}

test('removes only reproducible caches after an exact merged PR', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  createReproducibleCaches(fixture);
  writePrResponse(fixture, [mergedPrForFixture(fixture)]);
  const originalTip = tip(fixture);
  runScript(fixture);
  assert.equal(fs.existsSync(fixture.worktree), true);
  assert.equal(fs.existsSync(path.join(fixture.worktree, 'README.md')), true);
  assert.equal(fs.existsSync(path.join(fixture.worktree, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(fixture.worktree, '.next')), false);
  assert.equal(fs.existsSync(path.join(fixture.worktree, 'tsconfig.tsbuildinfo')), false);
  assert.equal(tip(fixture), originalTip);
  assert.notEqual(remoteBranchTip(fixture), '');
});

test('cache cleanup dry-run leaves every target intact', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  createReproducibleCaches(fixture);
  writePrResponse(fixture, [mergedPrForFixture(fixture)]);
  runScript(fixture, ['--dry-run']);
  assert.equal(fs.existsSync(path.join(fixture.worktree, 'node_modules')), true);
  assert.equal(fs.existsSync(path.join(fixture.worktree, '.next')), true);
  assert.equal(fs.existsSync(path.join(fixture.worktree, 'tsconfig.tsbuildinfo')), true);
  assert.match(fs.readFileSync(fixture.log, 'utf8'), /dry-run would remove cache=/);
});

test('cache cleanup removes a stale quarantine left by an interrupted run', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  createReproducibleCaches(fixture);
  writePrResponse(fixture, [mergedPrForFixture(fixture)]);
  const quarantineDir = path.join(fixture.state, 'cache-quarantine');
  fs.mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(fixture.state, 0o700);
  fs.chmodSync(quarantineDir, 0o700);
  const target = path.join(fixture.worktree, 'node_modules');
  const targetId = crypto.createHash('sha256').update(target).digest('hex');
  const quarantine = path.join(quarantineDir, `${targetId}-node_modules`);
  fs.renameSync(target, quarantine);

  runScript(fixture);

  assert.equal(fs.existsSync(quarantine), false);
});

test('cache cleanup treats nested cache writes as recent activity', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  command('git', ['-C', fixture.worktree, 'commit', '--amend', '--no-edit'], {
    env: { ...process.env, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old },
  });
  git(fixture.worktree, ['push', '--force', 'origin', fixture.branch]);
  createReproducibleCaches(fixture);
  command('find', [fixture.worktree, '-exec', 'touch', '-d', old, '{}', '+']);
  fs.writeFileSync(path.join(fixture.worktree, '.next', 'cache', 'webpack', 'client', 'entry'), 'active build\n');
  writePrResponse(fixture, [mergedPrForFixture(fixture)]);
  runScript(fixture, [], { CACHE_MIN_IDLE_SECONDS: '3600' });
  assert.equal(fs.existsSync(path.join(fixture.worktree, '.next')), true);
});

test('cache cleanup preserves a candidate when remote revalidation fails', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  createReproducibleCaches(fixture);
  writePrResponse(fixture, [mergedPrForFixture(fixture)]);

  runScript(fixture, [], {
    GIT_BIN: fixture.fakeGit,
    GIT_MUTATE_MODE: 'remote-query-fail',
  });

  assert.equal(fs.existsSync(path.join(fixture.worktree, 'node_modules')), true);
  assert.equal(fs.existsSync(path.join(fixture.worktree, '.next')), true);
});

test('cache cleanup preserves active and unmerged worktrees', (t) => {
  const active = createFixture();
  t.after(() => cleanupFixture(active));
  createReproducibleCaches(active);
  writePrResponse(active, [mergedPrForFixture(active)]);
  const processDir = path.join(active.env.PROC_ROOT, '123');
  fs.mkdirSync(processDir);
  fs.symlinkSync(active.worktree, path.join(processDir, 'cwd'));
  runScript(active);
  assert.equal(fs.existsSync(path.join(active.worktree, 'node_modules')), true);
  const open = createFixture();
  t.after(() => cleanupFixture(open));
  createReproducibleCaches(open);
  writePrResponse(open, [{
    ...mergedPrForFixture(open), state: 'OPEN', mergedAt: null,
  }]);
  runScript(open);
  assert.equal(fs.existsSync(path.join(open.worktree, 'node_modules')), true);
});

test('cache cleanup accepts a missing remote branch but preserves tracked and symlinked targets', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  createReproducibleCaches(fixture);
  const external = path.join(fixture.root, 'external-cache');
  fs.rmSync(path.join(fixture.worktree, 'node_modules'), { recursive: true });
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, 'keep'), 'keep\n');
  fs.symlinkSync(external, path.join(fixture.worktree, 'node_modules'));
  git(fixture.worktree, ['add', '-f', 'tsconfig.tsbuildinfo']);
  git(fixture.worktree, ['commit', '-m', 'track build info']);
  git(fixture.worktree, ['push', 'origin', fixture.branch]);
  writePrResponse(fixture, [mergedPrForFixture(fixture)]);
  git(fixture.repo, ['push', 'origin', '--delete', fixture.branch]);
  runScript(fixture);

  assert.equal(fs.existsSync(path.join(external, 'keep')), true);
  assert.equal(fs.lstatSync(path.join(fixture.worktree, 'node_modules')).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(fixture.worktree, '.next')), false);
  assert.equal(fs.existsSync(path.join(fixture.worktree, 'tsconfig.tsbuildinfo')), true);
});

test('removes only a leased worktree and branch with an exact merged PR tip', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const currentTip = tip(fixture);
  writePrResponse(fixture, [{
    number: 5106,
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: fixture.branch,
    headRefOid: currentTip,
    baseRefName: 'staging',
  }]);
  markReady(fixture);

  runScript(fixture, ['--dry-run']);
  assert.equal(fs.existsSync(fixture.worktree), true);
  assert.match(git(fixture.repo, ['show-ref', '--verify', `refs/heads/${fixture.branch}`]), /[0-9a-f]{40}/);

  runScript(fixture);
  assert.equal(fs.existsSync(fixture.worktree), false);
  assert.throws(() => git(fixture.repo, ['show-ref', '--verify', `refs/heads/${fixture.branch}`]));
  assert.equal(remoteBranchTip(fixture), '');
  assert.equal(fs.existsSync(leasePath(fixture)), true);
  assert.equal(git(fixture.repo, ['rev-parse', backupRef(fixture)]), currentTip);
});

test('does not treat a closed unmerged PR as deletion proof', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const currentTip = tip(fixture);
  writePrResponse(fixture, [{
    number: 5106,
    state: 'CLOSED',
    mergedAt: null,
    headRefName: fixture.branch,
    headRefOid: currentTip,
    baseRefName: 'staging',
  }]);
  markReady(fixture);

  runScript(fixture);
  assert.equal(fs.existsSync(fixture.worktree), true);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
  assert.notEqual(remoteBranchTip(fixture), '');
});

test('keeps a worktree until its merged PR is 14 days old', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  writePrResponse(fixture, [{
    number: 5106, state: 'MERGED', mergedAt: new Date().toISOString(),
    headRefName: fixture.branch, headRefOid: tip(fixture), baseRefName: 'staging',
  }]);
  markReady(fixture);

  runScript(fixture, [], { MIN_MERGED_AGE_SECONDS: '1209600' });
  assert.equal(fs.existsSync(fixture.worktree), true);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
});

test('fails closed when the GitHub query fails', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  markReady(fixture);

  assert.throws(() => runScript(fixture, [], { GH_FAIL: '1' }));
  assert.equal(fs.existsSync(fixture.worktree), true);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
  assert.notEqual(remoteBranchTip(fixture), '');

  for (const malformed of [
    'not-json',
    '{"state":1}',
    '[{"state":"MERGED","headRefName":1,"headRefOid":"bad","baseRefName":"staging","mergedAt":null}]',
  ]) {
    fs.writeFileSync(fixture.response, malformed);
    assert.throws(() => runScript(fixture));
    assert.equal(fs.existsSync(fixture.worktree), true);
    assert.equal(fs.existsSync(leasePath(fixture)), true);
    assert.notEqual(remoteBranchTip(fixture), '');
  }
});

test('preserves a branch when the complete open-PR query finds an open PR', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const currentTip = tip(fixture);
  writePrResponse(fixture, [{
    number: 5106,
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: fixture.branch,
    headRefOid: currentTip,
    baseRefName: 'staging',
  }]);
  writeOpenPrResponse(fixture, [{ number: 5107 }]);
  markReady(fixture);

  runScript(fixture);
  assert.equal(fs.existsSync(fixture.worktree), true);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
  assert.notEqual(remoteBranchTip(fixture), '');
});

test('rechecks the lease tip and leaves a changed worktree alone', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const originalTip = tip(fixture);
  writePrResponse(fixture, [{
    number: 5106,
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: fixture.branch,
    headRefOid: originalTip,
    baseRefName: 'staging',
  }]);
  markReady(fixture);
  fs.appendFileSync(path.join(fixture.worktree, 'README.md'), 'later change\n');
  git(fixture.worktree, ['commit', '-am', 'later change']);

  runScript(fixture);
  assert.equal(fs.existsSync(fixture.worktree), true);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
  assert.notEqual(git(fixture.repo, ['show-ref', '--verify', `refs/heads/${fixture.branch}`]), '');
});

test('preserves stale leases and PR records without exact merged proof', (t) => {
  const scenarios = [
    {
      name: 'stale lease',
      prepare: (fixture) => {
        const file = leasePath(fixture);
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/issued_at=\d+/, 'issued_at=0'));
      },
    },
    {
      name: 'wrong merge base',
      records: (fixture, currentTip) => [{
        state: 'MERGED',
        mergedAt: '2026-08-21T10:00:00Z',
        headRefName: fixture.branch,
        headRefOid: currentTip,
        baseRefName: 'main',
      }],
    },
    {
      name: 'wrong head tip',
      records: (fixture) => [{
        state: 'MERGED',
        mergedAt: '2026-08-21T10:00:00Z',
        headRefName: fixture.branch,
        headRefOid: '0'.repeat(40),
        baseRefName: 'staging',
      }],
    },
  ];

  for (const scenario of scenarios) {
    const fixture = createFixture();
    t.after(() => cleanupFixture(fixture));
    const currentTip = tip(fixture);
    markReady(fixture);
    if (scenario.records) writePrResponse(fixture, scenario.records(fixture, currentTip));
    else writePrResponse(fixture, []);
    if (scenario.prepare) scenario.prepare(fixture);

    runScript(fixture);
    assert.equal(fs.existsSync(fixture.worktree), true, scenario.name);
    assert.equal(fs.existsSync(leasePath(fixture)), true, scenario.name);
    assert.notEqual(remoteBranchTip(fixture), '', scenario.name);
  }
});

test('requires a valid removal marker for missing worktrees', (t) => {
  const makeProof = (fixture, currentTip) => writePrResponse(fixture, [{
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: fixture.branch,
    headRefOid: currentTip,
    baseRefName: 'staging',
  }]);

  const absentFixture = createFixture();
  t.after(() => cleanupFixture(absentFixture));
  const absentTip = tip(absentFixture);
  markReady(absentFixture);
  git(absentFixture.repo, ['worktree', 'remove', '--', absentFixture.worktree]);
  makeProof(absentFixture, absentTip);
  runScript(absentFixture);
  assert.equal(fs.existsSync(leasePath(absentFixture)), true);
  assert.notEqual(remoteBranchTip(absentFixture), '');

  const markedFixture = createFixture();
  t.after(() => cleanupFixture(markedFixture));
  const markedTip = tip(markedFixture);
  markReady(markedFixture);
  makeProof(markedFixture, markedTip);
  runScript(markedFixture, [], {
    GIT_BIN: markedFixture.fakeGit,
    GIT_MUTATE_MODE: 'local-fail',
    GIT_MUTATE_REPO: markedFixture.repo,
    GIT_MUTATE_MARKER: markedFixture.mutationMarker,
  });
  assert.equal(fs.existsSync(markedFixture.worktree), false);
  assert.equal(fs.existsSync(leasePath(markedFixture)), true);
  runScript(markedFixture);
  assert.equal(fs.existsSync(leasePath(markedFixture)), true);
  assert.equal(remoteBranchTip(markedFixture), '');

  for (const removedAt of ['not-a-time', String(Math.floor(Date.now() / 1000) + 3600)]) {
    const invalidFixture = createFixture();
    t.after(() => cleanupFixture(invalidFixture));
    const invalidTip = tip(invalidFixture);
    markReady(invalidFixture);
    git(invalidFixture.repo, ['worktree', 'remove', '--', invalidFixture.worktree]);
    fs.appendFileSync(leasePath(invalidFixture), `removed_at=${removedAt}\n`);
    makeProof(invalidFixture, invalidTip);
    runScript(invalidFixture);
    assert.equal(fs.existsSync(leasePath(invalidFixture)), true);
    assert.notEqual(remoteBranchTip(invalidFixture), '');
  }

  const recreatedFixture = createFixture();
  t.after(() => cleanupFixture(recreatedFixture));
  const recreatedTip = tip(recreatedFixture);
  markReady(recreatedFixture);
  makeProof(recreatedFixture, recreatedTip);
  runScript(recreatedFixture, [], {
    GIT_BIN: recreatedFixture.fakeGit,
    GIT_MUTATE_MODE: 'local-fail',
    GIT_MUTATE_REPO: recreatedFixture.repo,
    GIT_MUTATE_MARKER: recreatedFixture.mutationMarker,
  });
  assert.equal(fs.existsSync(recreatedFixture.worktree), false);
  git(recreatedFixture.repo, ['worktree', 'add', recreatedFixture.worktree, recreatedFixture.branch]);
  runScript(recreatedFixture);
  assert.equal(fs.existsSync(recreatedFixture.worktree), true);
  assert.equal(fs.existsSync(leasePath(recreatedFixture)), true);
});

test('ignores malformed, mismatched, symlinked, and outside leases', (t) => {
  const cases = [
    (fixture, currentTip, now) => ({
      target: fixture.worktree,
      contents: `CLEANUP_READY\nformat=1\npath=${fixture.worktree}\nbranch=${fixture.branch}\nissued_at=${now}\n`,
    }),
    (fixture, currentTip, now) => ({
      target: fixture.worktree,
      contents: `CLEANUP_READY\nformat=1\npath=${fixture.worktree}\nbranch=${fixture.branch}\ntip=${currentTip}\ntip=${currentTip}\nissued_at=${now}\n`,
    }),
    (fixture, currentTip) => ({
      target: fixture.worktree,
      contents: `CLEANUP_READY\nformat=1\npath=${fixture.worktree}\nbranch=${fixture.branch}\ntip=${currentTip}\nissued_at=not-a-time\n`,
    }),
    (fixture, currentTip, now) => ({
      target: path.join(fixture.root, 'not-a-worktree'),
      contents: `CLEANUP_READY\nformat=1\npath=${path.join(fixture.root, 'not-a-worktree')}\nbranch=${fixture.branch}\ntip=${currentTip}\nissued_at=${now}\n`,
    }),
    (fixture, currentTip, now) => ({
      target: fixture.worktree,
      contents: `CLEANUP_READY\nformat=1\npath=${fixture.worktree}\nbranch=other/branch\ntip=${currentTip}\nissued_at=${now}\n`,
    }),
  ];

  for (const makeCase of cases) {
    const fixture = createFixture();
    t.after(() => cleanupFixture(fixture));
    const currentTip = tip(fixture);
    const now = Math.floor(Date.now() / 1000);
    const lease = makeCase(fixture, currentTip, now);
    writeLease(fixture, lease.target, lease.contents);
    writePrResponse(fixture, []);
    runScript(fixture);
    assert.equal(fs.existsSync(fixture.worktree), true);
    assert.notEqual(remoteBranchTip(fixture), '');
  }

  const symlinkFixture = createFixture();
  t.after(() => cleanupFixture(symlinkFixture));
  const outsideLease = path.join(symlinkFixture.root, 'outside-lease');
  fs.mkdirSync(path.join(symlinkFixture.state, 'leases'), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(symlinkFixture.state, 'leases'), 0o700);
  fs.writeFileSync(outsideLease, 'CLEANUP_READY\n');
  fs.symlinkSync(outsideLease, leasePath(symlinkFixture));
  runScript(symlinkFixture);
  assert.equal(fs.existsSync(symlinkFixture.worktree), true);
  assert.notEqual(remoteBranchTip(symlinkFixture), '');

  const symlinkPath = path.join(symlinkFixture.root, 'worktree-link');
  fs.symlinkSync(symlinkFixture.worktree, symlinkPath);
  const symlinkTip = tip(symlinkFixture);
  writeLease(symlinkFixture, symlinkPath, `CLEANUP_READY\nformat=1\npath=${symlinkPath}\nbranch=${symlinkFixture.branch}\ntip=${symlinkTip}\nissued_at=${Math.floor(Date.now() / 1000)}\n`);
  writePrResponse(symlinkFixture, [{
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: symlinkFixture.branch,
    headRefOid: symlinkTip,
    baseRefName: 'staging',
  }]);
  runScript(symlinkFixture);
  assert.equal(fs.existsSync(symlinkFixture.worktree), true);
  assert.notEqual(remoteBranchTip(symlinkFixture), '');

  const danglingPath = path.join(symlinkFixture.root, 'dangling-link');
  fs.symlinkSync(path.join(symlinkFixture.root, 'missing-target'), danglingPath);
  writeLease(symlinkFixture, danglingPath, `CLEANUP_READY\nformat=1\npath=${danglingPath}\nbranch=${symlinkFixture.branch}\ntip=${symlinkTip}\nissued_at=${Math.floor(Date.now() / 1000)}\n`);
  runScript(symlinkFixture);
  assert.equal(fs.existsSync(symlinkFixture.worktree), true);
  assert.notEqual(remoteBranchTip(symlinkFixture), '');
});

test('rejects tampered authenticated removal state', (t) => {
  const mutators = [
    (text) => text.replace(/removed_at=\d+/, `removed_at=${Math.floor(Date.now() / 1000) + 100}`),
    (text) => text.replace(/removed_mac=[0-9a-f]+/, `removed_mac=${'0'.repeat(64)}`),
    (text) => text.replace(/branch=feature\/5106/, 'branch=feature/tampered'),
    (text) => text.replace(/tip=[0-9a-f]+/, `tip=${'1'.repeat(40)}`),
  ];

  for (const mutate of mutators) {
    const fixture = createFixture();
    t.after(() => cleanupFixture(fixture));
    const currentTip = tip(fixture);
    markReady(fixture);
    writePrResponse(fixture, [{
      state: 'MERGED',
      mergedAt: '2026-08-21T10:00:00Z',
      headRefName: fixture.branch,
      headRefOid: currentTip,
      baseRefName: 'staging',
    }]);
    runScript(fixture, [], {
      GIT_BIN: fixture.fakeGit,
      GIT_MUTATE_MODE: 'local-fail',
      GIT_MUTATE_REPO: fixture.repo,
      GIT_MUTATE_MARKER: fixture.mutationMarker,
    });
    const lease = leasePath(fixture);
    fs.writeFileSync(lease, mutate(fs.readFileSync(lease, 'utf8')), { mode: 0o600 });
    fs.chmodSync(lease, 0o600);
    runScript(fixture);
    assert.equal(fs.existsSync(fixture.worktree), false);
    assert.equal(fs.existsSync(lease), true);
    assert.notEqual(remoteBranchTip(fixture), '');
  }
});

test('fails closed when lease metadata is insecure', (t) => {
  const leaseFixture = createFixture();
  t.after(() => cleanupFixture(leaseFixture));
  const leaseTip = tip(leaseFixture);
  writePrResponse(leaseFixture, [{
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: leaseFixture.branch,
    headRefOid: leaseTip,
    baseRefName: 'staging',
  }]);
  markReady(leaseFixture);
  fs.chmodSync(leasePath(leaseFixture), 0o644);
  runScript(leaseFixture);
  fs.chmodSync(leasePath(leaseFixture), 0o600);
  assert.equal(fs.existsSync(leaseFixture.worktree), true);
  assert.notEqual(remoteBranchTip(leaseFixture), '');
});

test('fails closed when worktree metadata cannot be read', (t) => {
  const metadataFixture = createFixture();
  t.after(() => cleanupFixture(metadataFixture));
  const metadataTip = tip(metadataFixture);
  writePrResponse(metadataFixture, [{
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: metadataFixture.branch,
    headRefOid: metadataTip,
    baseRefName: 'staging',
  }]);
  markReady(metadataFixture);
  runScript(metadataFixture, [], {
    GIT_BIN: metadataFixture.fakeGit,
    GIT_MUTATE_MODE: 'status-fail',
    GIT_MUTATE_WORKTREE: metadataFixture.worktree,
  });
  assert.equal(fs.existsSync(metadataFixture.worktree), true);
  assert.notEqual(remoteBranchTip(metadataFixture), '');
});

test('preserves dirty and ignored worktrees', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const currentTip = tip(fixture);
  writePrResponse(fixture, [{
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: fixture.branch,
    headRefOid: currentTip,
    baseRefName: 'staging',
  }]);
  markReady(fixture);
  fs.writeFileSync(path.join(fixture.worktree, 'uncommitted.txt'), 'keep me\n');

  runScript(fixture);
  assert.equal(fs.existsSync(fixture.worktree), true);
  assert.equal(fs.existsSync(leasePath(fixture)), true);

  const ignoredFixture = createFixture();
  t.after(() => cleanupFixture(ignoredFixture));
  const ignoreFile = path.join(ignoredFixture.root, 'global-ignore');
  fs.writeFileSync(ignoreFile, 'secret.env\n');
  git(ignoredFixture.repo, ['config', 'core.excludesFile', ignoreFile]);
  fs.writeFileSync(path.join(ignoredFixture.worktree, 'secret.env'), 'keep me private\n');
  assert.throws(() => runScript(ignoredFixture, ['--mark-ready', ignoredFixture.worktree]));
  assert.equal(fs.existsSync(leasePath(ignoredFixture)), false);
  assert.equal(fs.existsSync(ignoredFixture.worktree), true);
});

test('permits generated dependency and TypeScript cache files', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const currentTip = tip(fixture);
  fs.mkdirSync(path.join(fixture.worktree, 'node_modules', 'package'), { recursive: true });
  fs.writeFileSync(path.join(fixture.worktree, 'node_modules', 'package', 'index.js'), 'generated\n');
  fs.writeFileSync(path.join(fixture.worktree, 'tsconfig.tsbuildinfo'), 'generated\n');
  fs.writeFileSync(path.join(fixture.worktree, '.gitignore'), 'node_modules/\n*.tsbuildinfo\n');
  git(fixture.worktree, ['add', '.gitignore']);
  git(fixture.worktree, ['commit', '-m', 'ignore generated caches']);
  git(fixture.worktree, ['push', '--force', 'origin', fixture.branch]);
  const generatedTip = tip(fixture);
  markReady(fixture);
  writePrResponse(fixture, [{
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: fixture.branch,
    headRefOid: generatedTip,
    baseRefName: 'staging',
  }]);

  runScript(fixture);
  assert.notEqual(currentTip, generatedTip);
  assert.equal(fs.existsSync(fixture.worktree), false);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
});

test('preserves a live worktree detected by process cwd', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const currentTip = tip(fixture);
  writePrResponse(fixture, [{
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: fixture.branch,
    headRefOid: currentTip,
    baseRefName: 'staging',
  }]);
  markReady(fixture);
  const processDir = path.join(fixture.env.PROC_ROOT, '123');
  fs.mkdirSync(processDir);
  fs.symlinkSync(fixture.worktree, path.join(processDir, 'cwd'));

  runScript(fixture);
  assert.equal(fs.existsSync(fixture.worktree), true);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
  assert.notEqual(remoteBranchTip(fixture), '');
});

test('restores a candidate that changes during quarantine', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const currentTip = tip(fixture);
  writePrResponse(fixture, [{
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: fixture.branch,
    headRefOid: currentTip,
    baseRefName: 'staging',
  }]);
  markReady(fixture);

  runScript(fixture, [], {
    GIT_BIN: fixture.fakeGit,
    GIT_MUTATE_MODE: 'quarantine',
    GIT_MUTATE_REPO: fixture.repo,
    GIT_MUTATE_MARKER: fixture.mutationMarker,
  });
  assert.equal(fs.existsSync(fixture.worktree), true);
  assert.equal(fs.existsSync(path.join(fixture.worktree, 'quarantine-race.txt')), true);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
  assert.notEqual(remoteBranchTip(fixture), '');
});

test('preserves a changed registered worktree before deletion', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const originalTip = tip(fixture);
  markReady(fixture);
  fs.appendFileSync(path.join(fixture.worktree, 'later.txt'), 'later change\n');
  git(fixture.worktree, ['add', 'later.txt']);
  git(fixture.worktree, ['commit', '-m', 'later change']);
  writePrResponse(fixture, [{
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: fixture.branch,
    headRefOid: originalTip,
    baseRefName: 'staging',
  }]);

  runScript(fixture);
  assert.equal(fs.existsSync(fixture.worktree), true);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
  assert.notEqual(remoteBranchTip(fixture), '');
});

test('uses compare-and-delete guards when refs change during cleanup', (t) => {
  for (const mode of ['local', 'remote']) {
    const fixture = createFixture();
    t.after(() => cleanupFixture(fixture));
    const originalTip = tip(fixture);
    markReady(fixture);
    fs.appendFileSync(path.join(fixture.repo, 'README.md'), `${mode} race\n`);
    git(fixture.repo, ['commit', '-am', `${mode} race`]);
    const changedTip = git(fixture.repo, ['rev-parse', 'refs/heads/staging']);
    if (mode === 'remote') git(fixture.repo, ['push', 'origin', 'staging']);
    writePrResponse(fixture, [{
      state: 'MERGED',
      mergedAt: '2026-08-21T10:00:00Z',
      headRefName: fixture.branch,
      headRefOid: originalTip,
      baseRefName: 'staging',
    }]);

    runScript(fixture, [], {
      GIT_BIN: fixture.fakeGit,
      GIT_MUTATE_MODE: mode,
      GIT_MUTATE_REPO: fixture.repo,
      GIT_MUTATE_BRANCH: fixture.branch,
      GIT_MUTATE_TIP: changedTip,
      GIT_MUTATE_MARKER: fixture.mutationMarker,
    });
    assert.equal(fs.existsSync(fixture.worktree), false, mode);
    assert.equal(fs.existsSync(leasePath(fixture)), true, mode);
    if (mode === 'local') {
      assert.equal(git(fixture.repo, ['rev-parse', `refs/heads/${fixture.branch}`]), changedTip);
      assert.match(remoteBranchTip(fixture), new RegExp(originalTip));
    } else {
      assert.throws(() => git(fixture.repo, ['show-ref', '--verify', `refs/heads/${fixture.branch}`]));
      assert.match(remoteBranchTip(fixture), new RegExp(changedTip));
    }
  }
});

test('restores a branch checked out in another worktree during ref deletion', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const currentTip = tip(fixture);
  const replacementWorktree = path.join(fixture.root, 'replacement-worktree');
  markReady(fixture);
  writePrResponse(fixture, [{
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: fixture.branch,
    headRefOid: currentTip,
    baseRefName: 'staging',
  }]);

  runScript(fixture, [], {
    GIT_BIN: fixture.fakeGit,
    GIT_MUTATE_MODE: 'register-worktree',
    GIT_MUTATE_REPO: fixture.repo,
    GIT_MUTATE_BRANCH: fixture.branch,
    GIT_MUTATE_WORKTREE: replacementWorktree,
    GIT_MUTATE_MARKER: fixture.mutationMarker,
  });
  assert.equal(fs.existsSync(fixture.worktree), false);
  assert.equal(fs.existsSync(replacementWorktree), true);
  assert.equal(git(fixture.repo, ['rev-parse', `refs/heads/${fixture.branch}`]), currentTip);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
  assert.notEqual(remoteBranchTip(fixture), '');
});

test('restores a remote branch when post-delete pull request safety changes', (t) => {
  for (const mode of ['open-pr', 'post-delete-gh-fail', 'post-delete-restore-fail']) {
    const fixture = createFixture();
    t.after(() => cleanupFixture(fixture));
    const currentTip = tip(fixture);
    markReady(fixture);
    writePrResponse(fixture, [{
      state: 'MERGED',
      mergedAt: '2026-08-21T10:00:00Z',
      headRefName: fixture.branch,
      headRefOid: currentTip,
      baseRefName: 'staging',
    }]);
    const extraEnv = mode !== 'open-pr'
      ? { GH_FAIL_AFTER_FILE: fixture.mutationMarker }
      : {};

    runScript(fixture, [], {
      GIT_BIN: fixture.fakeGit,
      GIT_MUTATE_MODE: mode,
      GIT_MUTATE_REPO: fixture.repo,
      GIT_MUTATE_BRANCH: fixture.branch,
      GIT_MUTATE_MARKER: fixture.mutationMarker,
      GIT_MUTATE_TIP: currentTip,
      ...extraEnv,
    });
    assert.equal(fs.existsSync(fixture.worktree), false, mode);
    assert.equal(fs.existsSync(leasePath(fixture)), true, mode);
    if (mode === 'post-delete-restore-fail') {
      assert.equal(remoteBranchTip(fixture), '', mode);
      writePrResponse(fixture, [{
        state: 'MERGED', mergedAt: '2026-08-21T10:00:00Z',
        headRefName: fixture.branch, headRefOid: currentTip, baseRefName: 'staging',
      }, {
        state: 'OPEN', mergedAt: null,
        headRefName: fixture.branch, headRefOid: currentTip, baseRefName: 'staging',
      }]);
      writeOpenPrResponse(fixture, [{ number: 5106 }]);
      runScript(fixture);
    }
    assert.match(remoteBranchTip(fixture), new RegExp(`^${currentTip}`), mode);
  }
});

test('restores a deleted branch when a pull request opens on a later run', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const currentTip = tip(fixture);
  markReady(fixture);
  writePrResponse(fixture, [{
    state: 'MERGED', mergedAt: '2026-08-21T10:00:00Z',
    headRefName: fixture.branch, headRefOid: currentTip, baseRefName: 'staging',
  }]);

  runScript(fixture);
  assert.equal(remoteBranchTip(fixture), '');
  assert.match(fs.readFileSync(leasePath(fixture), 'utf8'), /remote_deleted_at=/);
  assert.equal(git(fixture.repo, ['rev-parse', backupRef(fixture)]), currentTip);
  git(fixture.repo, ['reflog', 'expire', '--expire=now', '--all']);
  git(fixture.repo, ['gc', '--prune=now']);

  writePrResponse(fixture, [{
    state: 'OPEN', mergedAt: null,
    headRefName: fixture.branch, headRefOid: currentTip, baseRefName: 'staging',
  }]);
  writeOpenPrResponse(fixture, [{ number: 5107 }]);
  runScript(fixture);

  assert.match(remoteBranchTip(fixture), new RegExp(`^${currentTip}`));
  assert.doesNotMatch(fs.readFileSync(leasePath(fixture), 'utf8'), /remote_deleted_at=/);
});

test('rechecks the lease after acquiring the action lock', (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const currentTip = tip(fixture);
  writePrResponse(fixture, [{
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: fixture.branch,
    headRefOid: currentTip,
    baseRefName: 'staging',
  }]);
  markReady(fixture);
  const replacement = path.join(fixture.root, 'replacement.lease');
  fs.writeFileSync(replacement, fs.readFileSync(leasePath(fixture), 'utf8').replace(
    `tip=${currentTip}`,
    `tip=${'0'.repeat(40)}`,
  ), { mode: 0o600 });
  fs.chmodSync(replacement, 0o600);

  runScript(fixture, [], {
    PATH: `${fixture.root}:${process.env.PATH}`,
    FLOCK_COUNT_FILE: fixture.flockCount,
    FLOCK_REPLACEMENT: replacement,
    FLOCK_REPLACE_FILE: leasePath(fixture),
  });
  assert.equal(fs.existsSync(fixture.worktree), true);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
  assert.notEqual(remoteBranchTip(fixture), '');
});

test('serializes concurrent cleanup-script runs with the cleanup lock', {
  skip: !(() => {
    try {
      command('sh', ['-c', 'command -v flock']);
      return true;
    } catch {
      return false;
    }
  })(),
}, async (t) => {
  const fixture = createFixture();
  const children = new Set();
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null) child.kill('SIGTERM');
    }
    await Promise.all([...children].map((child) => waitForExit(child).catch(() => {})));
    cleanupFixture(fixture);
  });
  const currentTip = tip(fixture);
  writePrResponse(fixture, [{
    state: 'MERGED',
    mergedAt: '2026-08-21T10:00:00Z',
    headRefName: fixture.branch,
    headRefOid: currentTip,
    baseRefName: 'staging',
  }]);
  markReady(fixture);
  const first = spawnScript(fixture, [], { GH_SLEEP: '2' });
  children.add(first);
  await waitUntil(() => fs.existsSync(fixture.env.GH_READY_FILE), 30_000);
  assert.throws(() => runScript(fixture, ['--mark-ready', fixture.worktree]));
  const second = spawnScript(fixture);
  children.add(second);
  assert.equal(await waitForExit(second), 0);
  assert.equal(await waitForExit(first), 0);
  assert.match(fs.readFileSync(fixture.log, 'utf8'), /another cleanup run holds/);
  assert.equal(fs.existsSync(fixture.worktree), false);
  assert.equal(fs.existsSync(leasePath(fixture)), true);
});
