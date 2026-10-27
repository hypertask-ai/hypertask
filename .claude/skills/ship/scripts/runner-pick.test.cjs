'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pick } = require('./runner-pick.cjs');
const entry = path.join(__dirname, 'ship-claim');
const task = (ticketNumber, projectId, priority = null, section = 'Todo') => ({ ticketNumber, projectId, priority, section, title: ticketNumber, assignees: [] });
function fixture(t, tasks, comments = {}, fresh = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-pick-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify({ tasks, comments, fresh }));
  const fake = path.join(root, 'fake');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.PICK_FIXTURE;
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json')));
const [bin, ...args] = process.argv.slice(2);
const out = value => console.log(JSON.stringify({ success: true, ...value }));
fs.appendFileSync(path.join(root, 'calls'), JSON.stringify([bin, ...args]) + '\\n');
if (bin === 'hypertask' && args[0] === 'tasks' && args[1] === 'list') {
  let tasks = data.tasks.filter(t => String(t.projectId) === args[args.indexOf('--project') + 1]);
  if (args.includes('--priority')) tasks = tasks.filter(t => t.priority === 'Urgent');
  out({ tasks, total: tasks.length });
} else if (bin === 'hypertask' && args[0] === 'tasks' && args[1] === 'get') {
  out({ tasks: [data.fresh[args[2]] || data.tasks.find(t => t.ticketNumber === args[2])] });
} else if (bin === 'hypertask' && args[0] === 'comment') {
  out({ comments: data.comments[args[2]] || [], total: (data.comments[args[2]] || []).length });
} else if (bin === 'ht') out({ activities: [], nextCursor: null });
else if (bin === 'vcc' && args[0] === 'comment') {
  const text = args[args.indexOf('--text') + 1];
  (data.comments[args[2]] ||= []).push({ id: 999, agent: { id: 'mine', displayName: 'RUNNER 16' }, text, createdAt: new Date().toISOString() });
  fs.writeFileSync(path.join(root, 'data.json'), JSON.stringify(data));
} else if (bin === 'vcc' && args[0] === 'activity') process.exit(0);
else if (bin !== 'vcc') process.exit(99);
`);
  fs.chmodSync(fake, 0o755);
  for (const name of ['hypertask', 'ht', 'vcc']) {
    fs.writeFileSync(path.join(root, name), `#!/bin/sh\nexec '${fake}' ${name} "$@"\n`);
    fs.chmodSync(path.join(root, name), 0o755);
  }
  const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, PICK_FIXTURE: root,
    SHIP_CLAIM_HYPERTASK: path.join(root, 'hypertask'), SHIP_CLAIM_HT: path.join(root, 'ht'),
    SHIP_CLAIM_VCC: path.join(root, 'vcc'), SHIP_SESSION_NAME: 'RUNNER 16' };
  const run = () => spawnSync('bash', [entry, 'next', 'tmux attach -t fixture-runner-16'], { env, encoding: 'utf8', timeout: 15000 });
  const calls = () => fs.readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n').map(JSON.parse);
  return { run, calls };
}
for (const [name, tasks, expected] of [
  ['urgent Infra precedes urgent product', [task('HTPR-1', 15, 'Urgent'), task('YPER4-2', 4060, 'Urgent')], 'YPER4-2'],
  ['product precedes non-urgent Infra', [task('YPER4-1', 4060, 'High'), task('HTPR-2', 15, 'Low')], 'HTPR-2'],
  ['remaining Infra is picked when product is empty', [task('YPER4-1', 4060, 'High', 'Backlog')], 'YPER4-1'],
  ['highest priority within a board wins', [task('HTPR-1', 15, 'Low'), task('HTPR-2', 15, 'High')], 'HTPR-2'],
]) test(`claim next: ${name}`, t => {
  const f = fixture(t, tasks);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), expected);
  const writes = f.calls().filter(row => row[0] === 'vcc');
  assert.deepEqual(writes.map(row => row.slice(1, 4)), [
    ['comment', 'add', expected], ['task', 'assign', expected], ['task', 'move', expected],
  ]);
});
test('claim next: parked, review, blocked, held and Abdul tickets receive no writes', t => {
  const tasks = ['Later (parked)', 'Valentin Review', 'Agent Blocked', 'Agent Blocked (Infra)', 'In Progress', 'QA', 'AI Review', 'Done', 'UX Sign-off']
    .map((section, index) => task(`YPER4-${index + 1}`, 4060, 'Urgent', section));
  tasks.push({ ...task('HTPR-20', 15), assignees: [{ agent: { id: 'other' } }] });
  tasks.push({ ...task('HTPR-21', 15), assignees: [{ displayName: 'Abdul' }] });
  const f = fixture(t, tasks);
  const result = f.run();
  assert.equal(result.status, 4, result.stderr);
  assert.equal(f.calls().filter(row => row[0] === 'vcc').length, 0);
});
test('claim next: unreleased stale claims are not automatically reclaimed', t => {
  const comments = { 'HTPR-1': [{ id: 1, agent: { id: 'other', displayName: 'RUNNER 1' }, createdAt: '2020-01-01T00:00:00Z', text: 'Claimed. codex resume old' }] };
  const f = fixture(t, [task('HTPR-1', 15), task('HTPR-2', 15)], comments);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'HTPR-2');
});
test('claim next: candidate moved to blocked after listing is skipped', t => {
  const f = fixture(t, [task('HTPR-1', 15)], {}, { 'HTPR-1': task('HTPR-1', 15, null, 'Agent Blocked') });
  assert.equal(f.run().status, 4);
  assert.equal(f.calls().filter(row => row[0] === 'vcc').length, 0);
});
test('claim next: incomplete board reads fail closed', () => {
  assert.throws(() => pick('codex resume mine', () => JSON.stringify({ success: true, tasks: [], total: 1 })), /Incomplete/);
});
test('claim next: losing a claim race tries the next candidate', () => {
  const claimed = [];
  const tasks = [task('HTPR-1', 15), task('HTPR-2', 15)];
  const run = (bin, args) => JSON.stringify({ success: true,
    ...(args[0] === 'tasks' ? { tasks: args[1] === 'get' ? tasks.filter(t => t.ticketNumber === args[2]) : args.includes('15') ? tasks : [] } : { comments: [], activities: [] }) });
  assert.equal(pick('codex resume mine', run, ticket => { claimed.push(ticket); return ticket === 'HTPR-1' ? 3 : 0; }), 'HTPR-2');
  assert.deepEqual(claimed, ['HTPR-1', 'HTPR-2']);
});
