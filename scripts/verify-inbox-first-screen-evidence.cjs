#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const folder = path.join(os.homedir(), '.local/state/vcc-evidence/HTPR-6934');
const evidence = path.join(folder, 'ssr4');
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const files = run('git', ['ls-files', '-co', '--exclude-standard', 'src']).trim().split('\n').sort();
const hash = crypto.createHash('sha256').update(files.map(f => f + '\0' + fs.readFileSync(path.join(root, f))).join('\0')).digest('hex');
const read = name => fs.readFileSync(path.join(evidence, name), 'utf8');
const artifact = name => { const value = JSON.parse(read(name + '.json')); assert.equal(value.sourceHash, hash, name + ': stale source evidence'); return value; };
const nonempty = name => assert.ok(fs.statSync(path.join(evidence, name)).size > 0, name);
const head = () => run('git', ['rev-parse', 'HEAD']).trim();
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
const mode = process.argv[2];
if (mode === 'build') {
  const log = fs.readFileSync(path.join(root, 'e2e/smoke/.state/premerge-local/setup.log'), 'utf8'); assert.match(log, /Compiled successfully/); assert.match(log, /[ƒf]\s+\/inbox/);
  const proof = artifact('security');
  for (const device of ['phone', 'desktop']) {
    const row = proof.cases.find(r => r.name === 'js-disabled-' + device); assert.ok(row);
    assert.equal(row.headers['cache-control'], 'private, no-store');
    assert.equal(row.headers['cdn-cache-control'], 'no-store'); assert.equal(row.headers['vercel-cdn-cache-control'], 'no-store');
    assert.equal(row.flightHeaders['cache-control'], 'private, no-store'); assert.equal(row.flightHeaders['cdn-cache-control'], 'no-store'); assert.equal(row.flightHeaders['vercel-cdn-cache-control'], 'no-store');
    assert.ok(row.flightNoSeedReplay); nonempty('js-disabled-' + device + '.html');
  }
  console.log('BUILD PRIVACY VERIFIED');
} else if (mode === 'parity') {
  const parity = artifact('parity'); assert.equal(parity.cases.length, 4);
  for (const row of parity.cases) {
    assert.deepEqual(JSON.parse(read(row.before + '-dom.json')), JSON.parse(read(row.after + '-dom.json')));
    assert.deepEqual(JSON.parse(read(row.before + '-requests.json')), JSON.parse(read(row.after + '-requests.json')));
  }
  const security = artifact('security');
  for (const name of ['js-disabled-phone', 'js-disabled-desktop', 'flag-off', 'nonmember', 'guest', 'empty', 'forged', 'mismatch', 'missing', 'missing-preferences', 'live-catch-up']) assert.ok(security.cases.some(c => c.name === name), name);
  const phone = read('js-disabled-phone.html'); assert.ok(phone.includes('SSR4 first inbox message') && phone.includes('SSR4 unsent draft preview'));
  for (const secret of ['OTHER ACCOUNT', 'REVOKED DRAFT SECRET', 'ARCHIVED TASK SECRET', 'DELETED TASK SECRET']) assert.ok(!phone.includes(secret), secret);
  assert.ok(read('js-disabled-empty.html').includes('INBOX ZERO'));
  const timeout = artifact('timeout'); assert.ok(timeout.elapsed >= 780 && timeout.elapsed < 1500); assert.ok(timeout.oldPath);
  console.log('PARITY SECURITY VERIFIED');
} else if (mode === 'speed') {
  const proof = artifact('performance'); assert.equal(proof.runs.length, 20);
  assert.deepEqual(proof.profile.phone, { width: 390, height: 844, latency: 150, downloadThroughput: 200000, uploadThroughput: 100000, cpu: 4 });
  for (const device of ['phone', 'desktop']) {
    const before = proof.runs.filter(r => r.kind === 'before' && r.device === device), after = proof.runs.filter(r => r.kind === 'after' && r.device === device);
    assert.equal(before.length, 5); assert.equal(after.length, 5); assert.ok(median(after.map(r => r.ready)) < median(before.map(r => r.ready)));
    for (const r of proof.runs.filter(r => r.device === device)) { assert.ok(Number.isFinite(r.ready)); assert.ok(r.hydrationMounted && r.identity); assert.deepEqual(r.errors, []); assert.equal(r.lost.length, 0); }
    for (const r of after) { assert.equal(r.cls, 0); assert.equal(r.loaderFrames, 0); assert.ok(r.documentNodeBeforeHydration); }
  }
  const frames = artifact('frames'); assert.equal(frames.runs.length, 4);
  for (const r of frames.runs) {
    nonempty(r.video); assert.equal(r.framerate, '125/2'); assert.ok(r.coverage >= 3); assert.ok(r.nativeFrames >= 188); assert.equal(r.extractedFrames, 188);
    assert.equal(fs.readdirSync(path.join(evidence, r.directory)).length, 188);
    for (let i = 1; i < r.timestamps.length; i++) assert.ok(Math.abs(r.timestamps[i] - r.timestamps[i-1] - .016) < .0001);
    if (r.kind === 'after') { assert.equal(r.observation.lost, 0); assert.ok(r.observation.identity); assert.deepEqual(r.observation.shifts, []); }
  }
  console.log('SPEED FRAMES VERIFIED');
} else if (mode === 'interactions') {
  const inbox = artifact('inbox-interactions'), board = artifact('board-interactions');
  for (const proof of [inbox, board]) {
    assert.equal(proof.proof.length, 4);
    for (const r of proof.proof) { assert.deepEqual(r.errors, []); nonempty(r.video); assert.equal(r.documentRequestsDuringTicket, 0); assert.ok(r.titleOpen && r.bodyOpen && r.close && r.back && r.realtime); }
  }
  for (const r of inbox.proof) { assert.ok(r.messages && r.reminder && r.splits && r.archiveUndo && r.localSnapshotNavigation); if (r.device === 'phone') assert.ok(r.pullDownFocus && r.commandTyping); }
  for (const r of board.proof) { assert.ok(r.tableRoundTrip); if (r.device === 'desktop') assert.ok(r.dragRoundTrip); }
  console.log('INTERACTIONS VERIFIED');
} else if (mode === 'delivery') {
  const record = fs.readFileSync(path.join(folder, 'premerge.md'), 'utf8'); assert.equal(record, fs.readFileSync(path.join(root, 'premerge-ssr4.md'), 'utf8'));
  assert.match(record, new RegExp('^Commit: ' + head() + '$', 'm')); for (const key of ['Account', 'Flags', 'Board', 'Build', 'Click', 'Recording']) assert.match(record, new RegExp('^' + key + ': \\S', 'm'));
  const pr = JSON.parse(run('gh', ['pr', 'view', '1070', '--repo', 'hypertask-ai/hypertask', '--json', 'title,body,headRefOid,baseRefName,state,isDraft,autoMergeRequest']));
  assert.equal(pr.headRefOid, head()); assert.equal(pr.baseRefName, 'production'); assert.equal(pr.state, 'OPEN'); assert.equal(pr.isDraft, false); assert.equal(pr.autoMergeRequest, null);
  assert.equal(pr.title, 'HTPR-6934 [BUGFIX] Send the inbox first screen from the server for owner and QA (switch htpr-6934-server-first-screen)');
  for (const section of ['Summary for non-engineers', 'What went wrong', 'What changes', 'What you will see', 'Watch out for', 'Technical notes and decisions']) assert.ok(pr.body.includes('## ' + section));
  assert.ok(pr.body.includes('Open the inbox on app.hypertask.ai on a phone with an owner or QA account: your messages should appear within a few seconds instead of about nine.'));
  assert.ok(pr.body.includes('https://claude.ai/code/session_01K4hkRqsVXWsG1mhkqxhtLk'));
  assert.match(run(path.join(os.homedir(), '.agents/skills/ship/scripts/ship-check'), ['premerge-status', '1070']), /premerge-evidence: success/);
  const checks = run('gh', ['pr', 'checks', '1070', '--repo', 'hypertask-ai/hypertask', '--required']).trim().split('\n');
  assert.ok(checks.length); for (const check of checks) assert.match(check, /\tpass\t/, check);
  console.log('DELIVERY VERIFIED');
} else if (mode === 'scope') {
  assert.equal(run('git', ['branch', '--show-current']).trim(), 'htpr-6934-ssr-4');
  const base = 'd4e19ce451330692d06171136a8fdf2541384e25'; run('git', ['merge-base', '--is-ancestor', base, 'HEAD']);
  const changed = run('git', ['diff', '--name-only', base, 'HEAD']).trim().split('\n');
  assert.ok(!changed.some(f => f.startsWith('.claude/') || ['CLAUDE.md', 'AGENTS.md'].includes(f)));
  const diff = run('git', ['diff', '--unified=0', base, 'HEAD']); assert.ok(!diff.split('\n').some(l => l.startsWith('+') && !l.startsWith('+++') && l.includes('\u2014')));
  console.log('SCOPE VERIFIED');
} else throw Error('Expected build, parity, speed, interactions, delivery, or scope');
