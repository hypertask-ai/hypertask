const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');

async function fixture(id = 101, started = '2026-10-21T04:35:00Z') {
  const { PATHS, summarize } = await import('../scripts/speed/measure.mjs');
  const samples = ['desktop', 'phone'].flatMap(profile => PATHS.map(surface => ({
    profile, path: surface, contentMs: 100, requestCount: 1, bytes: 512, longTaskMs: 50,
    requests: [{ method: 'GET', path: '/api/flags', status: 200, failed: false, blocked: false, bytes: 512 }],
    longTasks: [{ startMs: 1, durationMs: 50 }],
  })));
  return { schema: 1, started, status: 'complete', accountId: 2343, base: 'https://app.hypertask.ai', productionCommit: 'a'.repeat(40), productionCommitEnd: 'a'.repeat(40), conditions: { samples: 1, runner: 'github-actions', browser: 'test', protocol: 1 }, github: { runId: id, sha: 'b'.repeat(40) }, samples, groups: summarize(samples) };
}

function sandbox(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'speed-fetch-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bin = path.join(home, 'bin');
  const state = path.join(home, '.local/state/speed');
  const history = path.join(state, 'history.json');
  fs.mkdirSync(bin);
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  const executable = (name, body) => fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\n${body}`, { mode: 0o700 });
  executable('gh', `
    const fs = require('node:fs'), path = require('node:path');
    const args = process.argv.slice(2), home = process.env.HOME;
    if (process.env.SPEED_AGE_IDENTITY) process.exit(80);
    fs.appendFileSync(path.join(home, 'commands'), JSON.stringify(args) + '\\n');
    if (args[0] === 'run' && args[1] === 'list') {
      if (!args.includes('speed-live.yml') || !args.includes('production')) process.exit(81);
      process.stdout.write(fs.readFileSync(path.join(home, 'listed.json')));
    } else if (args[0] === 'api') {
      const id = args[1].split('/').at(-2);
      console.log(JSON.stringify([{artifacts: process.env.NO_ARTIFACT === id ? [] : [{name: 'speed-run-' + id, expired: false}]}]));
    } else if (args[0] === 'run' && args[1] === 'download') {
      if (process.env.FAIL_DOWNLOAD) { console.error('PRIVATE REQUEST cookie=sentinel'); process.exit(82); }
      const directory = args[args.indexOf('-D') + 1];
      fs.mkdirSync(directory, { recursive: true });
      fs.copyFileSync(path.join(home, args[2] + '.json'), path.join(directory, 'run.json.age'));
    } else process.exit(83);
  `);
  executable('age', `
    const fs = require('node:fs'), path = require('node:path');
    const args = process.argv.slice(2), identity = args[args.indexOf('-i') + 1];
    if (process.env.SPEED_AGE_IDENTITY || (fs.statSync(identity).mode & 0o777) !== 0o600 || (fs.statSync(path.dirname(identity)).mode & 0o777) !== 0o700 || fs.readFileSync(identity, 'utf8') !== 'PRIVATE-IDENTITY-sentinel') process.exit(84);
    fs.writeFileSync(path.join(process.env.HOME, 'identity-path'), identity);
    if (process.env.FAIL_AGE) { console.error('PRIVATE-IDENTITY-sentinel'); process.exit(85); }
    process.stdout.write(fs.readFileSync(args.at(-1)));
  `);
  const put = run => fs.writeFileSync(path.join(home, `${run.github.runId}.json`), JSON.stringify(run), { mode: 0o600 });
  const list = entries => fs.writeFileSync(path.join(home, 'listed.json'), JSON.stringify(entries));
  const execute = (env = {}) => spawnSync(process.execPath, ['scripts/speed/fetch-github-runs.mjs'], { cwd: root, env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, SPEED_AGE_IDENTITY: 'PRIVATE-IDENTITY-sentinel', ...env }, encoding: 'utf8' });
  const clean = () => {
    assert.deepEqual(fs.readdirSync(state), fs.existsSync(history) ? ['history.json'] : []);
    const keyPath = path.join(home, 'identity-path');
    if (fs.existsSync(keyPath)) assert.equal(fs.existsSync(fs.readFileSync(keyPath, 'utf8')), false);
  };
  return { home, state, history, put, list, execute, clean };
}
const entry = (id, createdAt = '2026-10-21T04:35:00Z') => ({ databaseId: id, conclusion: 'success', createdAt });

test('imports verified runs chronologically, preserves legacy history, dedupes repeated ids and reruns, and writes private atomic history', async t => {
  const box = sandbox(t);
  const older = await fixture(101, '2026-10-20T04:35:00Z');
  const newer = await fixture(102);
  const legacy = { ...await fixture(99, '2026-10-19T04:35:00Z'), conditions: { samples: 1 } };
  delete legacy.github;
  fs.writeFileSync(box.history, JSON.stringify([legacy]));
  box.put(older); box.put(newer);
  box.list([entry(102), entry(101, older.started), entry(102), { ...entry(103), conclusion: 'failure' }]);
  const result = box.execute();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Speed import complete\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(box.history)), [legacy, older, newer]);
  assert.equal(fs.statSync(box.history).mode & 0o777, 0o600);
  box.clean();
  const before = fs.statSync(box.history);
  assert.equal(box.execute().status, 0);
  assert.equal(fs.statSync(box.history).ino, before.ino, 'a deduped import never rewrites history');
  const commands = fs.readFileSync(path.join(box.home, 'commands'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(commands.filter(args => args[1] === 'download').length, 2);
  assert.equal(JSON.stringify(commands).includes('PRIVATE-IDENTITY-sentinel'), false);
  box.clean();
});

test('successful setup-skips with no artifact are ignored, while failed downloads stay retryable', async t => {
  const box = sandbox(t);
  box.put(await fixture()); box.list([entry(101)]);
  assert.equal(box.execute({ NO_ARTIFACT: '101' }).status, 0);
  assert.equal(fs.existsSync(box.history), false);
  box.clean();
  const failed = box.execute({ FAIL_DOWNLOAD: '1' });
  assert.equal(failed.status, 1);
  assert.doesNotMatch(failed.stdout + failed.stderr, /PRIVATE REQUEST|cookie=sentinel/);
  box.clean();
  assert.equal(box.execute().status, 0);
});

test('rejects wrong metadata, missing paths, failed requests, changed commits, invalid summaries, and empty runs without changing history', async t => {
  const box = sandbox(t);
  const good = await fixture();
  const old = await fixture(99);
  fs.writeFileSync(box.history, JSON.stringify([old]), { mode: 0o600 });
  const before = fs.readFileSync(box.history, 'utf8');
  box.list([entry(101)]);
  for (const mutate of [
    run => { run.github.sha = 'invalid'; },
    run => { run.github.runId = 333; },
    run => { run.conditions.runner = 'vps'; },
    run => { delete run.conditions.runner; },
    run => { run.accountId = 6; },
    run => { run.status = 'failed'; },
    run => { run.productionCommitEnd = 'c'.repeat(40); },
    run => { run.samples.pop(); },
    run => { run.samples[0].requests[0].status = 500; },
    run => { run.groups['phone:board'].contentMs.median = 99; },
    run => { run.conditions.samples = 0; run.samples = []; run.groups = {}; },
  ]) {
    const bad = structuredClone(good); mutate(bad);
    fs.writeFileSync(path.join(box.home, '101.json'), JSON.stringify(bad), { mode: 0o600 });
    const result = box.execute();
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'Speed import failed; inspect setup and private history locally.\n');
    assert.equal(fs.readFileSync(box.history, 'utf8'), before);
    box.clean();
  }
});

test('a malformed later artifact rolls back the whole batch, then recovery imports both', async t => {
  const box = sandbox(t);
  box.put(await fixture(101)); box.put({ ...await fixture(102), accountId: 6 });
  box.list([entry(101), entry(102)]);
  assert.equal(box.execute().status, 1);
  assert.equal(fs.existsSync(box.history), false);
  box.clean();
  box.put(await fixture(102));
  assert.equal(box.execute().status, 0);
  assert.equal(JSON.parse(fs.readFileSync(box.history)).length, 2);
});

test('malformed JSON and decryption failures never echo private errors and always remove identities', async t => {
  const box = sandbox(t);
  box.put(await fixture()); box.list([entry(101)]);
  for (const env of [{ FAIL_AGE: '1' }, {}]) {
    if (!env.FAIL_AGE) fs.writeFileSync(path.join(box.home, '101.json'), 'PRIVATE REQUEST secret=sentinel');
    const result = box.execute(env);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE|sentinel/);
    box.clean();
  }
});

test('missing identity, malformed history and an active measurement lock fail closed without touching other state', async t => {
  const box = sandbox(t);
  box.list([]);
  assert.equal(box.execute({ SPEED_AGE_IDENTITY: '' }).status, 1);
  box.clean();
  fs.writeFileSync(box.history, '{}', { mode: 0o600 });
  assert.equal(box.execute().status, 1);
  assert.equal(fs.readFileSync(box.history, 'utf8'), '{}');
  box.clean();
  fs.writeFileSync(path.join(box.state, 'measure.lock'), 'another process');
  assert.equal(box.execute().status, 1);
  assert.equal(fs.readFileSync(path.join(box.state, 'measure.lock'), 'utf8'), 'another process');
});
