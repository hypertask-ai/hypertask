import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { requiredChecks, snapshot, plan, live, propose, tick, units } = require('./production-red-alert');
const { PREFIX, owner, decide, allowed, guard, logs } = require('./release-incidents.cjs');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/yper4-842/2026-10-26.json', import.meta.url)));
const now = Date.parse('2026-10-26T17:55:00Z');
const sha = '7b167459c5127324cf8ed43efb9dc1c6f39f2edd';
const claim = (id = 'runner8', name = 'Runner 8', at = '2026-10-26T17:50:00Z', text = 'Claimed. Resume: tmux attach -t runner8') =>
  ({ id: 1, createdAt: at, text, agent: { id, displayName: name } });
const incident = { title: `${PREFIX}: browser-smoke`, ticketNumber: 'YPER4-999', uniqueIndex: 999, section: 'In Progress' };
const recorded = () => fixture.runs.toReversed().map(run => ({ sha: run.head_sha, parents: [run.parent], title: '', at: run.created_at, prs: [],
  contexts: run.jobs.map(job => ({ name: job.name, state: job.conclusion.toUpperCase(), at: job.completed_at, url: job.html_url })) }));
const tmp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-check-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
function fake(commits = recorded()) {
  const writes = [], proposals = [];
  return { writes, proposals, collect: () => commits, open: () => [], logs: () => [claim()],
    write: args => { writes.push(args); return { success: true, task: { ticketNumber: 'YPER4-999' } }; },
    recover: () => 'YPER4-999', propose: (...args) => { proposals.push(args); return 'https://github.com/example/revert/1'; } };
}
const runTick = (dir, api, options = {}) => tick({ dir, api, now, required: ['browser-smoke', 'ci-tests'], ...options });

test('real 26 October production jobs: detect before workflow completion, correct immediate culprit', async t => {
  const commits = recorded(), before = plan(commits, ['browser-smoke', 'ci-tests'], Date.parse('2026-10-26T17:53:59Z'));
  assert.equal(before.failures.length, 0);
  const p = plan(commits, ['browser-smoke', 'ci-tests'], now);
  assert.equal(p.failures.length, 1); assert.equal(p.failures[0].name, 'browser-smoke');
  assert.equal(p.failures[0].culprit, sha);
  assert.ok(now - Date.parse(p.failures[0].first.check.at) < 300000);
  assert.ok(now < Date.parse(fixture.runs[1].updated_at));
  const api = fake(), dir = tmp(t);
  await runTick(dir, api); await runTick(dir, api, { now: now + 300000 });
  assert.equal(api.writes.filter(args => args[1] === 'create').length, 1);
  assert.equal(api.proposals.length, 1); assert.equal(api.proposals[0][0].culprit, sha);
  assert.ok(api.writes.some(args => args.includes('--labels') && args.includes('Infra')));
  t.diagnostic(`shared-check replay ok: red 17:54:01Z, incident 17:55:00Z, culprit ${sha}, one ticket and one proposal`);
});
test('every canonical required context, including commit statuses, independently starts an incident', () => {
  const names = requiredChecks(); assert.ok(names.includes('ai-review')); assert.ok(names.includes('browser-smoke'));
  for (const name of names) {
    const commits = recorded().slice(1);
    commits[0].contexts = [{ name, state: 'FAILURE', at: '2026-10-26T17:54:01Z', url: 'https://example/red' }];
    commits[1].contexts = [{ name, state: 'SUCCESS', at: '2026-10-26T17:00:00Z', url: 'https://example/green' }];
    assert.equal(plan(commits, names, now).failures[0].name, name);
    commits[0].contexts[0].state = 'SUCCESS';
    assert.deepEqual(plan(commits, names, now).failures, []);
  }
});
test('unrelated PR or non-required failures cannot freeze production', () => {
  const commits = recorded(); commits.forEach(commit => commit.contexts = [{ name: 'informational', state: 'FAILURE', at: '2026-10-26T17:00:00Z' }]);
  assert.deepEqual(plan(commits, ['browser-smoke'], now).failures, []);
});
test('same commit breaking two required contexts creates one incident and one revert', async t => {
  const commits = recorded(); commits.forEach(commit => commit.contexts.push({ ...commit.contexts[0], name: 'secret-scan' }));
  const api = fake(commits); await runTick(tmp(t), api, { required: ['browser-smoke', 'secret-scan'] });
  assert.equal(api.writes.filter(args => args[1] === 'create').length, 1); assert.equal(api.proposals.length, 1);
});
test('missing last green, gaps and multi-parent commits never guess a revert', () => {
  const commits = recorded(); commits.pop();
  assert.equal(plan(commits, ['browser-smoke'], now).failures[0].culprit, null);
  const missing = recorded(); missing[1].parents = ['f'.repeat(40)];
  assert.equal(plan(missing, ['browser-smoke'], now).failures[0].culprit, null);
  missing[1].parents.push(missing[2].sha);
  assert.equal(plan(missing, ['browser-smoke'], now).failures[0].culprit, null);
});
test('first live claim wins despite conflicting assignments and a manager reassignment comment', () => {
  const rows = [claim(), claim('runner12', 'Runner 12', '2026-10-26T17:52:00Z'),
    claim('lead', 'HT Product Lead', '2026-10-26T17:53:00Z', 'Runner 12 owns this now. Runner 8 stops.')];
  assert.deepEqual(owner(rows, now), { id: 'runner8', name: 'Runner 8', session: 'tmux:runner8' });
  assert.equal(allowed([incident], { 'YPER4-999': rows }, 'RUNNER 12', 'HTPR-1', now), false);
  assert.equal(allowed([incident], { 'YPER4-999': rows }, 'RUNNER 8', 'HTPR-1', now, 'tmux attach -t runner8'), true);
  rows.push(claim('runner8', 'Runner 8', '2026-10-26T17:54:00Z', 'Handing over to Runner 12.'));
  assert.deepEqual(owner(rows, now), { id: 'runner12', name: 'Runner 12', session: 'tmux:runner8' });
});
test('stale, released and absent claims never grant the assigned agent an owner exception', () => {
  assert.equal(owner([claim('runner8', 'Runner 8', '2026-10-25T17:00:00Z')], now), null);
  assert.equal(owner([claim(), claim('runner8', 'Runner 8', '2026-10-26T17:54:00Z', 'Released this ticket.')], now), null);
  assert.equal(allowed([incident], {}, 'Runner 8', 'HTPR-1', now), false);
  assert.equal(allowed([incident], {}, 'Runner 8', 'YPER4-999', now), true);
  assert.equal(allowed([{ ...incident, section: 'Done' }], {}, 'Runner 8', 'HTPR-1', now), true);
  const activity = { id: 'activity', createdAt: '2026-10-26T17:54:00Z', agentId: 'runner8', agentName: 'Runner 8', text: 'Still working' };
  assert.equal(owner([claim('runner8', 'Runner 8', '2026-10-25T17:00:00Z'), activity], now), null);
  activity.text = 'Still working. tmux attach -t runner8';
  assert.equal(owner([claim('runner8', 'Runner 8', '2026-10-25T17:00:00Z'), activity], now).id, 'runner8');
});
test('guard reads real CLI boundaries and refuses before any write, owner and existing work still allowed', () => {
  const old = process.env.SHIP_SESSION_NAME;
  process.env.SHIP_SESSION_NAME = 'RUNNER 7';
  try {
    const calls = [], run = (bin, args) => {
      calls.push([bin, args]);
      if (args[1] === 'list' && args[0] === 'tasks') return JSON.stringify({ success: true, tasks: [incident] });
      if (args[0] === 'GET') return JSON.stringify({ success: true, activities: [] });
      return JSON.stringify({ success: true, comments: args[2] === 'YPER4-999' ? [claim('runner8', 'Runner 8', new Date().toISOString())] : [] });
    };
    assert.equal(guard('HTPR-1', run), false);
    assert.ok(calls.every(([bin]) => bin !== 'vcc'));
    process.env.SHIP_SESSION_NAME = 'RUNNER 8'; assert.equal(guard('HTPR-1', run, 'tmux attach -t runner8'), true);
    assert.equal(guard('YPER4-999', run), true);
    assert.throws(() => guard('HTPR-1', () => '{"success":false}'), /Unreadable tasks/);
  } finally { if (old === undefined) delete process.env.SHIP_SESSION_NAME; else process.env.SHIP_SESSION_NAME = old; }
});
test('claim reads refuse truncated activity or incomplete comment pages', () => {
  assert.throws(() => logs('YPER4-999', (bin) => JSON.stringify(bin === 'ht'
    ? { success: true, activities: Array(100).fill({}) } : { success: true, comments: [] })), /Incomplete claim/);
  assert.throws(() => logs('YPER4-999', () => '{"success":true,"comments":[],"total":1}'), /Incomplete board/);
});
test('no owner is escalated on the ticket, never assigned from a manager comment', async t => {
  const api = fake(); api.logs = () => [claim('lead', 'HT Product Lead', '2026-10-26T17:54:00Z', 'Runner 12 owns this now.')];
  await runTick(tmp(t), api);
  assert.ok(api.writes.some(args => args[0] === 'comment' && args.at(-1).includes('Blocked on') && args.at(-1).includes('HT Product Lead')));
  assert.ok(api.writes.every(args => args[1] !== 'assign'));
});
test('creation response lost: reconcile once, never create a second incident', async t => {
  const dir = tmp(t), api = fake(); api.write = () => { throw new Error('response lost'); };
  await assert.rejects(runTick(dir, api), /response lost/);
  const retry = fake(); await runTick(dir, retry, { now: now + 3600000 });
  assert.ok(retry.writes.every(args => args[1] !== 'create'));
  const next = fake(); next.recover = () => { throw new Error('manual reconciliation'); };
  const unknownDir = tmp(t); await assert.rejects(runTick(unknownDir, api));
  await assert.rejects(runTick(unknownDir, next, { now: now + 3600000 }), /reconciliation/);
  assert.equal(next.writes.length, 0);
});
test('dry-run writes no board, proposal or local state; failed token mint never falls back', async t => {
  const dir = path.join(tmp(t), 'absent'), api = fake();
  assert.equal((await runTick(dir, api, { dryRun: true })).dryRun, true);
  assert.equal(fs.existsSync(dir), false); assert.equal(api.writes.length, 0); assert.equal(api.proposals.length, 0);
  const calls = []; assert.throws(() => live((bin) => { calls.push(bin); return ''; }).collect(), /token unavailable/);
  assert.deepEqual(calls, ['gh-app-token']);
});
test('stall exactly two hours, deduplicated per latest merge, blocked on HT Product Lead', async t => {
  const commits = recorded(), dir = tmp(t), api = fake(commits);
  commits.forEach(commit => commit.contexts = []);
  const merged = Date.parse(commits[0].at);
  await runTick(dir, api, { now: merged + 7199999 }); assert.equal(api.writes.length, 0);
  await runTick(dir, api, { now: merged + 7200000 });
  await runTick(dir, api, { now: merged + 7500000 });
  assert.equal(api.writes.filter(args => args[1] === 'create').length, 1);
  assert.ok(api.writes.some(args => args[0] === 'comment' && args.at(-1).includes('HT Product Lead')));
});
test('green adds one recovery record, but only closing the board incident lifts the freeze', async t => {
  const dir = tmp(t), api = fake(); await runTick(dir, api);
  const green = recorded(); green[0].contexts = [{ name: 'browser-smoke', state: 'SUCCESS', at: '2026-10-26T18:00:00Z' }];
  const next = fake(green); await runTick(dir, next, { now: now + 600000 }); await runTick(dir, next, { now: now + 900000 });
  assert.equal(next.writes.filter(args => args[0] === 'activity').length, 1);
  assert.equal(allowed([incident], {}, 'Runner 7', 'HTPR-1', now), false);
});
test('GraphQL collector handles check runs and status contexts, refuses truncated checks', () => {
  const commit = { oid: sha, committedDate: '2026-10-26T17:42:39Z', messageHeadline: '', parents: { nodes: [] }, associatedPullRequests: { nodes: [] },
    statusCheckRollup: { contexts: { pageInfo: { hasNextPage: false }, nodes: [
      { name: 'browser-smoke', status: 'COMPLETED', conclusion: 'FAILURE', completedAt: '2026-10-26T17:54:01Z', detailsUrl: 'https://example/job' },
      { context: 'ai-review', state: 'ERROR', createdAt: '2026-10-26T17:54:00Z', targetUrl: 'https://example/status' }
    ] } } };
  const data = { data: { repository: { ref: { target: { history: { nodes: [commit] } } } } } };
  assert.deepEqual(snapshot(data)[0].contexts.map(row => [row.name, row.state]), [['browser-smoke', 'FAILURE'], ['ai-review', 'ERROR']]);
  commit.statusCheckRollup.contexts.pageInfo.hasNextPage = true;
  assert.throws(() => snapshot(data), /Incomplete production/);
});
test('five-minute timer, explicit named identity, bounded service', () => {
  const u = units('/tmp/lib', 'RUNNER 16'); assert.match(u.timer, /OnUnitActiveSec=5min/);
  assert.match(u.service, /TimeoutStartSec=240/); assert.match(u.service, /SHIP_SESSION_NAME=RUNNER 16/);
  assert.throws(() => units('/tmp/lib', ''), /Dedicated agent/);
});
test('bounded-history rollover retains the open incident; a red rerun after green creates a new incident', async t => {
  const dir = tmp(t), api = fake(); await runTick(dir, api);
  const truncated = fake(recorded().slice(0, 2));
  await runTick(dir, truncated, { now: now + 300000 });
  assert.equal(truncated.writes.filter(args => args[1] === 'create').length, 0);
  const green = recorded(); green[0].contexts = [{ name: 'browser-smoke', state: 'SUCCESS', at: '2026-10-26T18:00:00Z' }];
  await runTick(dir, fake(green), { now: now + 600000 });
  const rerun = recorded(); rerun[1].contexts.find(row => row.name === 'browser-smoke').at = '2026-10-26T18:10:00Z';
  for (const commit of rerun) commit.contexts.push({ ...commit.contexts.find(row => row.name === 'browser-smoke'), name: 'secret-scan' });
  rerun[1].contexts.find(row => row.name === 'secret-scan').at = '2026-10-26T18:11:00Z';
  const next = fake(rerun); await runTick(dir, next, { now: now + 1200000, required: ['browser-smoke', 'secret-scan'] });
  assert.equal(next.writes.filter(args => args[1] === 'create').length, 1);
  assert.equal(next.proposals.length, 1);
});

test('real Git publication reverts only culprit, preserves later commits, deduplicates branch and never moves production', t => {
  const root = tmp(t), remote = path.join(root, 'remote.git'), checkout = path.join(root, 'checkout');
  const run = (bin, args, options = {}) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
  run('git', ['init', '--bare', remote]); run('git', ['clone', remote, checkout]);
  const git = (...args) => run('git', ['-C', checkout, ...args]).trim();
  git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('switch', '-c', 'production');
  fs.writeFileSync(path.join(checkout, 'shared.txt'), 'good\n'); git('add', '.'); git('commit', '-m', 'green');
  fs.writeFileSync(path.join(checkout, 'shared.txt'), 'bad\n'); git('commit', '-am', 'regression'); const culprit = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(checkout, 'later.txt'), 'keep\n'); git('add', '.'); git('commit', '-m', 'later independent change'); const head = git('rev-parse', 'HEAD');
  git('push', 'origin', 'production');
  const branch = `shared-check-revert/${culprit}`;
  const posts = []; let published, proposalState = 'open';
  const gh = args => {
    if (!args.includes('POST')) return published ? [{ html_url: published, state: proposalState, base: { ref: 'production' }, head: { ref: branch, sha: run('git', ['--git-dir', remote, 'rev-parse', branch]).trim() } }] : [];
    posts.push(args); published = 'https://github.com/example/revert/1'; return { html_url: published };
  };
  const failure = { culprit, name: 'browser-smoke', first: { check: { url: 'https://example/red' } } };
  assert.equal(propose(failure, head, 'YPER4-999', { run, gh, checkout, remote }), published);
  assert.equal(run('git', ['--git-dir', remote, 'show', `${branch}:shared.txt`]), 'good\n');
  assert.equal(run('git', ['--git-dir', remote, 'show', `${branch}:later.txt`]), 'keep\n');
  assert.equal(run('git', ['--git-dir', remote, 'rev-parse', 'production']).trim(), head);
  assert.equal(propose(failure, head, 'YPER4-999', { run, gh, checkout, remote }), published);
  assert.equal(posts.length, 1);
  proposalState = 'closed';
  assert.throws(() => propose(failure, head, 'YPER4-999', { run, gh, checkout, remote }), /closed or conflicting/);
  assert.throws(() => propose({ ...failure, culprit: null }, head, 'YPER4-999', { run, gh, checkout, remote }), /No unique/);
});

test('same-agent sessions keep distinct ownership and a losing session cannot release the winner', () => {
  const first = claim('same-agent', 'Runner 8', '2026-10-26T17:50:00Z', 'Claimed. codex resume winner');
  const second = claim('same-agent', 'Runner 8', '2026-10-26T17:52:00Z', 'Claimed. codex resume loser');
  const released = claim('same-agent', 'Runner 8', '2026-10-26T17:54:00Z', 'Stepping back. codex resume loser');
  const rows = [first, second, released];
  assert.equal(owner(rows, now).session, 'resume:winner');
  assert.equal(allowed([incident], { 'YPER4-999': rows }, 'Runner 8', 'HTPR-1', now, 'codex resume loser'), false);
  assert.equal(allowed([incident], { 'YPER4-999': rows }, 'Runner 8', 'HTPR-1', now, 'codex resume winner'), true);
});

test('paginated activity read reaches a claim beyond 100 rows without looping or mixing pages', () => {
  const calls = [], first = Array.from({ length: 100 }, (_, n) => ({ id: String(n), text: 'Progress' }));
  const rows = logs('YPER4-999', (bin, args) => {
    calls.push(args);
    if (bin === 'hypertask') return JSON.stringify({ success: true, comments: [] });
    return JSON.stringify(args[1].includes('cursor=older')
      ? { success: true, activities: [claim()], nextCursor: null }
      : { success: true, activities: first, nextCursor: 'older' });
  });
  assert.equal(rows.length, 101);
  assert.equal(owner(rows, now).id, 'runner8');
  assert.equal(calls.filter(args => args[1]?.includes('cursor=older')).length, 1);
});

test('reclaim expiry uses the surviving claim, not an older released mention', () => {
  const rows = [claim('ours', 'Runner 8', '2026-10-25T10:00:00Z', 'Claimed. codex resume ours'),
    claim('ours', 'Runner 8', '2026-10-25T11:00:00Z', 'Released. codex resume ours'),
    claim('rival', 'Runner 12', '2026-10-26T01:00:00Z', 'Claimed. codex resume rival'),
    claim('ours', 'Runner 8', '2026-10-26T17:50:00Z', 'Claimed. codex resume ours')];
  assert.equal(decide('ours', { comments: rows }, ['rival'], []), 'WIN');
  assert.match(decide('ours', { comments: rows }, [], []), /^LOSE\tRunner 12/);
});

test('pending or cancelled rerun cannot recover an incident using an older green parent', async t => {
  const dir = tmp(t); await runTick(dir, fake());
  for (const state of ['PENDING', 'CANCELLED']) {
    const commits = recorded().slice(1); commits[0].contexts = [{ name: 'browser-smoke', state, at: '2026-10-26T17:54:01Z' }];
    const api = fake(commits);
    assert.equal((await runTick(dir, api)).action, 'pending');
    assert.equal(api.writes.filter(args => args[0] === 'activity').length, 0);
    assert.notEqual(Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))).incidents)[0].closed, true);
  }
  const commits = recorded(); commits[0].contexts = [{ name: 'browser-smoke', state: 'SUCCESS', at: '2026-10-26T18:00:00Z' }];
  const api = fake(commits); await runTick(dir, api, { now: now + 600000 });
  assert.equal(api.writes.filter(args => args[0] === 'activity').length, 1);
});

test('a newer pending production head cannot hide its parent completed failure', async t => {
  const commits = recorded();
  const job = fixture.runs[2].jobs.find(row => row.name === 'browser-smoke');
  assert.ok(Date.parse(job.started_at) < now && Date.parse(job.completed_at) > now);
  commits[0].contexts = [{ name: job.name, state: 'PENDING', at: job.started_at, url: job.html_url }];
  const p = plan(commits, ['browser-smoke'], now);
  assert.equal(p.failures[0].culprit, sha);
  assert.deepEqual(p.recovered, []);
  const api = fake(commits); await runTick(tmp(t), api);
  assert.equal(api.writes.filter(args => args[1] === 'create').length, 1);
  assert.equal(api.proposals[0][0].culprit, sha);
});

test('same-commit pending reruns retain completed failure evidence instead of an older green parent', () => {
  const commits = recorded().slice(1);
  commits[0].contexts.unshift({ name: 'browser-smoke', state: 'PENDING', at: '2026-10-26T17:54:30Z' });
  const p = plan(commits, ['browser-smoke'], now);
  assert.equal(p.failures[0].culprit, sha);
  assert.deepEqual(p.recovered, []);
  commits[0].contexts[0] = { name: 'browser-smoke', state: 'SUCCESS', at: '2026-10-26T17:54:40Z' };
  assert.deepEqual(plan(commits, ['browser-smoke'], now).recovered, ['browser-smoke']);
});

test('queued check without startedAt remains unresolved instead of recovering from its completed predecessor', () => {
  const commit = { oid: sha, committedDate: '2026-10-26T17:42:39Z', messageHeadline: '', parents: { nodes: [] }, associatedPullRequests: { nodes: [] },
    statusCheckRollup: { contexts: { pageInfo: { hasNextPage: false }, nodes: [
      { name: 'browser-smoke', status: 'COMPLETED', conclusion: 'SUCCESS', completedAt: '2026-10-26T17:54:01Z', databaseId: 1 },
      { name: 'browser-smoke', status: 'QUEUED', conclusion: null, startedAt: null, databaseId: 2 }
    ] } } };
  const data = { data: { repository: { ref: { target: { history: { nodes: [commit] } } } } } };
  const p = plan(snapshot(data), ['browser-smoke'], now);
  assert.deepEqual(p.pending, ['browser-smoke']);
  assert.deepEqual(p.recovered, []);
});

test('another session cannot revive an expired claim or inherit its incident exception', () => {
  const rows = [claim('same', 'Runner 8', '2026-10-25T17:00:00Z', 'Claimed. codex resume expired'),
    claim('same', 'Runner 8', '2026-10-26T17:50:00Z', 'Claimed. codex resume current')];
  assert.deepEqual(owner(rows, now), { id: 'same', name: 'Runner 8', session: 'resume:current' });
  assert.equal(allowed([incident], { 'YPER4-999': rows }, 'Runner 8', 'HTPR-1', now, 'codex resume expired'), false);
  assert.equal(allowed([incident], { 'YPER4-999': rows }, 'Runner 8', 'HTPR-1', now, 'codex resume current'), true);
});
test('missing current-head required checks cannot publish recovery from a green ancestor', async t => {
  const dir = tmp(t), api = fake(); await runTick(dir, api);
  const commits = recorded();
  commits[0].contexts = [];
  commits[1].contexts = [{ name: 'browser-smoke', state: 'SUCCESS', at: '2026-10-26T17:54:00Z' }];
  const next = fake(commits);
  const result = await runTick(dir, next);
  assert.equal(result.action, 'pending');
  assert.deepEqual(plan(commits, ['browser-smoke'], now).pending, ['browser-smoke']);
  assert.deepEqual(plan(commits, ['browser-smoke'], now).recovered, []);
  assert.equal(next.writes.filter(args => args[0] === 'activity').length, 0);
  commits[0].contexts = [{ name: 'browser-smoke', state: 'SUCCESS', at: '2026-10-26T17:54:00Z' }];
  await runTick(dir, next);
  assert.equal(next.writes.filter(args => args[0] === 'activity').length, 1);
});
