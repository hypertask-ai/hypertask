const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rm, symlink } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let guardPull, snapshotModes, guardClickPath, resolveClickPath, decodeSnapshot, readBounded, validateEvidence;
test.before(async () => {
  ({ guardPull, snapshotModes, guardClickPath, resolveClickPath, decodeSnapshot, readBounded, validateEvidence } = await import('../scripts/premerge-click-guard.mjs'));
});

const sha = 'a'.repeat(40);
const repo = 'hypertask-ai/hypertask';
const pull = () => ({ state: 'open', base: { ref: 'production', repo: { full_name: repo } }, head: { sha, repo: { full_name: repo } } });

test('same-repository open production PR resolves exactly its head', () => {
  assert.equal(guardPull(pull(), repo), sha);
  assert.equal(guardPull(pull(), repo, sha), sha);
});

test('forks, deleted heads, wrong base and closed PRs are refused', () => {
  for (const change of [
    pr => { pr.head.repo.full_name = 'outside/hypertask'; },
    pr => { pr.head.repo = null; },
    pr => { pr.base.ref = 'main'; },
    pr => { pr.base.repo.full_name = 'outside/hypertask'; },
    pr => { pr.state = 'closed'; },
    pr => { pr.head.sha = 'not-a-sha'; },
  ]) {
    const pr = pull(); change(pr);
    assert.throws(() => guardPull(pr, repo));
  }
});

test('a moved head fails rather than transferring a pass to a newer SHA', () => {
  const pr = pull(); pr.head.sha = 'b'.repeat(40);
  assert.throws(() => guardPull(pr, repo, sha), /head moved/);
  assert.equal(guardPull(pr, repo, pr.head.sha), pr.head.sha);
});

test('live snapshots preserve Everyone and QA modes and only new keys use defaults', () => {
  const modes = { 'htpr-1-live': 'EVERYONE', 'htpr-2-qa': 'OWNER_AND_QA', 'htpr-3-off': 'OFF' };
  assert.deepEqual(snapshotModes({ modes, plain: { 'htpr-1-live': true, 'htpr-2-qa': false, 'htpr-3-off': false } }, {
    'htpr-1-live': 'OFF', 'htpr-2-qa': 'OFF', 'htpr-3-off': 'EVERYONE', 'htpr-4-new': 'OWNER_ONLY',
  }), { ...modes, 'htpr-4-new': 'OWNER_ONLY' });
  for (const value of [undefined, {}, { modes: {} }, { modes: [] }, { modes: { key: true } }, { modes: { '../key': 'OFF' } }, { modes: { key: 'NOT_EVERYONE' } }]) {
    assert.throws(() => snapshotModes(value), /Invalid live/);
  }
});

test('click paths reject injection, absolute paths, traversal and non-module files', () => {
  assert.equal(guardClickPath('scripts/qa/click-535.mjs'), 'scripts/qa/click-535.mjs');
  for (const value of ['', '/tmp/click.mjs', '../click.mjs', 'scripts/../click.mjs', './click.mjs', 'scripts//click.mjs', 'x;echo.mjs', 'click.cjs', 'click.mjs\n']) {
    assert.throws(() => guardClickPath(value));
  }
});

test('evidence fields, flag snapshot and media are validated without executing artifact code', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'yper4-535-evidence-'));
  const snapshot = { modes: { 'htpr-1-live': 'EVERYONE' }, plain: { 'htpr-1-live': true } };
  const record = `Commit: ${sha}\nAccount: 985 (disposable QA, board owner)\nFlags: htpr-1-live=EVERYONE\nBoard: http://127.0.0.1:3100/project?id=42&surface=board\nBuild: http://127.0.0.1:3100\nClick: PASS scripts/click.mjs\nRecording: video/click.webm\n`;
  const save = text => writeFile(path.join(folder, 'premerge.md'), text);
  try {
    await mkdir(path.join(folder, 'video')); await mkdir(path.join(folder, 'screenshots'));
    await writeFile(path.join(folder, 'video/click.webm'), 'disposable recording fixture');
    await writeFile(path.join(folder, 'screenshots/after.png'), 'disposable screenshot fixture');
    await save(record);
    assert.equal((await validateEvidence(folder, sha, snapshot)).Commit, sha);
    for (const invalid of [
      record.replace(sha, 'b'.repeat(40)), record.replace('985 (', '6 ('), record.replace('Click: PASS', 'Click: FAIL'),
      record.replace('htpr-1-live=EVERYONE', 'htpr-1-live=OFF'), record.replace('Board:', 'Absent:'),
      record + `Commit: ${sha}\n`, record.replace('/project?id=42&surface=board', '/demo'),
      record.replace('video/click.webm', '../outside.webm'), record.replace('http://127.0.0.1:3100\nClick', 'https://app.hypertask.ai\nClick'),
    ]) { await save(invalid); await assert.rejects(validateEvidence(folder, sha, snapshot)); }
    await save(record);
    await writeFile(path.join(folder, 'video/click.webm'), '');
    await assert.rejects(validateEvidence(folder, sha, snapshot), /Missing or unsafe/);
    await rm(path.join(folder, 'video/click.webm'));
    await symlink('/etc/hostname', path.join(folder, 'video/click.webm'));
    await assert.rejects(validateEvidence(folder, sha, snapshot), /Missing or unsafe/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('snapshots reject credential fields, oversized inputs and silent Everyone downgrades', () => {
  const snapshot = { modes: { live: 'EVERYONE' }, plain: { live: true } };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
  assert.deepEqual(decodeSnapshot(encode(snapshot)), snapshot);
  for (const invalid of [
    { ...snapshot, cookies: [] }, { ...snapshot, token: 'secret' }, { ...snapshot, storageState: {} },
    { ...snapshot, modes: { live: 'OFF' } }, { ...snapshot, modes: { live: 'OWNER_AND_QA' } },
    { ...snapshot, modes: { other: 'EVERYONE' } }, { ...snapshot, plain: { live: 'secret' } },
    { ...snapshot, modes: { ['a'.repeat(161)]: 'OFF' } },
    { ...snapshot, modes: Object.fromEntries(Array.from({length: 1001}, (_, i) => [`key-${i}`, 'OFF'])) },
  ]) assert.throws(() => decodeSnapshot(encode(invalid)));
  for (const invalid of ['!', 'a'.repeat(60004), encode(snapshot) + '\n', encode({})]) assert.throws(() => decodeSnapshot(invalid));
});

test('realpath containment is anchored at the checkout, including when cwd differs', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'yper4-535-path-'));
  try {
    const checkout = path.join(folder, 'pr');
    await mkdir(path.join(checkout, 'scripts'), { recursive: true });
    await writeFile(path.join(checkout, 'scripts/click.mjs'), 'export default () => {};');
    await writeFile(path.join(folder, 'outside.mjs'), 'export default () => {};');
    await writeFile(path.join(checkout, 'not-module.txt'), 'not a module');
    await symlink(path.join(folder, 'outside.mjs'), path.join(checkout, 'escape.mjs'));
    await symlink('not-module.txt', path.join(checkout, 'disguised.mjs'));
    await symlink('scripts/click.mjs', path.join(checkout, 'inside.mjs'));
    assert.equal(await resolveClickPath(checkout, 'scripts/click.mjs'), path.join(checkout, 'scripts/click.mjs'));
    assert.equal(await resolveClickPath(checkout, 'inside.mjs'), path.join(checkout, 'scripts/click.mjs'));
    for (const name of ['escape.mjs', 'disguised.mjs', '../outside.mjs', path.join(folder, 'outside.mjs'), 'not-module.txt']) {
      await assert.rejects(resolveClickPath(checkout, name));
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('bounded input refuses oversized records and symlinked premerge.md before reading', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'yper4-535-bounds-'));
  try {
    await writeFile(path.join(folder, 'valid'), 'data');
    assert.equal(await readBounded(path.join(folder, 'valid'), 4), 'data');
    await assert.rejects(readBounded(path.join(folder, 'valid'), 3), /Oversized/);
    await symlink('valid', path.join(folder, 'premerge.md'));
    await assert.rejects(validateEvidence(folder, sha, { modes: { live: 'EVERYONE' }, plain: { live: true } }));
    await rm(path.join(folder, 'premerge.md'));
    await writeFile(path.join(folder, 'premerge.md'), 'x'.repeat(262145));
    await assert.rejects(validateEvidence(folder, sha, { modes: { live: 'EVERYONE' }, plain: { live: true } }), /Oversized/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
