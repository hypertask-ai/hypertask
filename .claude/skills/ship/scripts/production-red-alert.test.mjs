import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { agent, identity, live, plan, tick, units, main } = require('./production-red-alert');
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = name => JSON.parse(fs.readFileSync(path.join(here, 'fixtures/yper4-582', `${name}.json`), 'utf8'));
const tasks = fixture('tasks');
tasks['HTPR-7311'] = { ...structuredClone(tasks['HTPR-7322']), ticketNumber: 'HTPR-7311' };
tasks['HTPR-7576'] = { ...structuredClone(tasks['HTPR-7574']), ticketNumber: 'HTPR-7576' };
tasks['HTPR-7567'] = { ...structuredClone(tasks['HTPR-7574']), ticketNumber: 'HTPR-7567' };
const first = () => fixture('39719731623');
const second = () => fixture('39765957007');
const tmp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'red-alert-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
function fake(data = second()) {
  const writes = [];
  return {
    writes, collect: async () => data,
    task: ticket => { assert.ok(tasks[ticket], ticket); return structuredClone(tasks[ticket]); },
    identity: () => ({ name: 'INFRA MANAGER', credentialPath: 'session-credential-path-only' }),
    write: args => { writes.push(args); return JSON.stringify({ success: true, task: { ticketNumber: 'YPER4-9999' } }); },
    recover: () => 'YPER4-9999'
  };
}

test('crossed #1777 + #1789: only #1777 touched the failing test, so Runner 6 owns it', async () => {
  const p = await plan(fixture('crossed-1777-1789'), fake());
  assert.equal(p.chosenPR, 1777);
  assert.equal(p.fixer.name, 'Runner 6');
  assert.match(p.why, /newest PR.*changed a failing test/);
});
test('crossed #1837 + #1835: #1835 touched onboarding test, so Runner 5 owns it', async () => {
  const data = second();
  assert.ok(data.prs.some(p => p.number === 1837));
  const p = await plan(data, fake());
  assert.equal(p.chosenPR, 1835); assert.equal(p.fixer.name, 'Runner 5');
  assert.match(p.description, /Error: Unexpected import/);
  assert.match(p.title, /^Production red: tests\/htpr-7574/);
  for (const pr of data.prs) assert.ok(p.description.includes(`#${pr.number} ${pr.title} ${pr.url}`));
  assert.ok(p.description.includes(data.green.html_url)); assert.ok(p.description.includes(data.run.html_url));
});
test('39719731623: removed error identifier in #1789 beats newest #1806', async () => {
  const data = first();
  data.prs.find(p => p.number === 1789).patches = ['@@ -1 +1 @@\n-export function pickDecisionTaskIds() {}\n+export function pickDecisionTargets() {}'];
  const p = await plan(data, fake());
  assert.equal(p.chosenPR, 1789); assert.equal(p.rule, 'error-identifier');
  assert.equal(p.fixer.id, tasks['HTPR-7311'].assignees[0].agent.id);
  assert.match(p.description, /Rule: error-identifier/);
});
test('no touching PR or error identifier falls back to oldest, not newest or PR author', async () => {
  const d = second(); d.prs.forEach(p => { p.files = ['unrelated.txt']; });
  const p = await plan(d, fake()); assert.equal(p.chosenPR, d.prs.at(-1).number); assert.equal(p.rule, 'oldest-pr');
  assert.match(p.why, /No PR/);
});
test('same red streak twice, even at a later red commit, creates and assigns once', async t => {
  const dir = tmp(t), d = second(), api = fake(d);
  await tick({ dir, api });
  d.run = { ...d.run, id: d.run.id + 1, head_sha: 'a'.repeat(40) };
  await tick({ dir, api });
  assert.equal(api.writes.filter(a => a[1] === 'create').length, 1);
  const assigns = api.writes.filter(a => a[1] === 'assign');
  assert.equal(assigns.length, 1); assert.equal(assigns[0][4], tasks['HTPR-7574'].assignees[0].agent.id);
  assert.ok(!assigns[0].includes('6'));
  const create = api.writes[0]; assert.ok(create.includes('4060')); assert.ok(create.includes('In Progress'));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json')));
  assert.equal(Object.keys(saved.alerts).length, 1);
});
test('green posts nothing; recovery adds exactly one activity and marks streak closed', async t => {
  const dir = tmp(t), api = fake({ status: 'success', run: second().run });
  await tick({ dir, api }); assert.equal(api.writes.length, 0);
  const red = fake(); await tick({ dir, api: red });
  const green = fake({ status: 'success', run: { id: second().run.id + 1, html_url: 'https://example/green' } });
  await tick({ dir, api: green }); await tick({ dir, api: green });
  assert.equal(green.writes.length, 1); assert.deepEqual(green.writes[0].slice(0, 3), ['activity', 'add', 'YPER4-9999']);
  assert.match(green.writes[0][3], /Production green again/);
  assert.ok(Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))).alerts)[0].closed);
});
test('a green boundary missed between timer ticks still closes the previous streak', async t => {
  const dir = tmp(t), old = fake(); await tick({ dir, api: old });
  const d = second(); d.green.id = d.run.id + 1; d.green.created_at = '2026-10-22T11:00:00Z';
  d.run.id += 2; d.run.created_at = '2026-10-22T12:00:00Z'; d.firstRed = { ...d.run };
  const api = fake(d); await tick({ dir, api });
  assert.equal(api.writes.filter(a => a[0] === 'activity').length, 1);
  assert.equal(api.writes.filter(a => a[1] === 'create').length, 1);
});
test('key uses first red run ID and attempt plus green run ID, not SHAs or failing files', async () => {
  const a = second(), b = second();
  a.failures.push({ file: 'tests/a.test.cjs', error: 'Error: a' });
  b.failures = [...a.failures, { file: 'tests/new.test.cjs', error: 'new failure' }].reverse(); b.run.head_sha = 'f'.repeat(40);
  const pa = await plan(a, fake()), pb = await plan(b, fake());
  assert.equal(pa.key, pb.key); assert.equal(pa.key, `${a.firstRed.id}:1:${a.green.id}`);
  b.firstRed.head_sha = 'c'.repeat(40);
  assert.equal((await plan(b, fake())).key, pa.key);
  for (const change of [d => d.firstRed.id++, d => d.firstRed.run_attempt++, d => d.green.id++]) {
    const d = second(); change(d);
    assert.notEqual((await plan(d, fake())).key, pa.key);
  }
});
test('dry-run is zero-write, including no state directory, on success and errors', async t => {
  const parent = tmp(t), dir = path.join(parent, 'absent'), api = fake();
  const p = await tick({ dryRun: true, dir, api });
  assert.equal(p.dryRun, true); assert.equal(p.chosenPR, 1835);
  assert.equal(api.writes.length, 0); assert.equal(fs.existsSync(dir), false);
  api.collect = async () => { throw new Error('offline'); };
  await assert.rejects(tick({ dryRun: true, dir, api }), /offline/);
  assert.equal(fs.existsSync(dir), false);
});
test('dry-run never alters pre-existing state or honors backoff instead of replaying', async t => {
  const dir = tmp(t), stateFile = path.join(dir, 'state.json');
  const before = JSON.stringify({ alerts: {}, until: 9999999999, fails: 3 }); fs.writeFileSync(stateFile, before);
  const p = await tick({ dryRun: true, dir, api: fake() }); assert.equal(p.action, 'alert');
  assert.equal(fs.readFileSync(stateFile, 'utf8'), before);
});
test('errors double the five-minute interval to a one-hour cap; successful ticks reset it', async t => {
  const dir = tmp(t), api = fake(); let calls = 0;
  api.collect = async () => { calls++; throw new Error('offline'); };
  await assert.rejects(tick({ dir, api, now: 100 }), /offline/);
  let state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))); assert.equal(state.until, 700);
  assert.equal((await tick({ dir, api, now: 699 })).action, 'backoff'); assert.equal(calls, 1);
  await assert.rejects(tick({ dir, api, now: 700 }));
  state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))); assert.equal(state.until, 1900);
  for (let i = 0; i < 8; i++) { await assert.rejects(tick({ dir, api, now: state.until })); const old = state.until; state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))); assert.ok(state.until - old <= 3600); }
  assert.equal(state.fails, 10);
  await tick({ dir, api: fake({ status: 'success', run: second().run }), now: state.until });
  state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))); assert.equal(state.until, 0); assert.equal(state.fails, 0);
});
test('nested assigned agent is selected; humans, assigner-only and multiple agents fail closed', () => {
  const task = structuredClone(tasks['HTPR-7574']); assert.equal(task.assignees[0].id, 6);
  assert.equal(agent(task).id, task.assignees[0].agent.id);
  assert.throws(() => agent({ assignees: [{ id: 6 }] }), /exactly one/);
  assert.throws(() => agent({ assignees: [{ id: 6, agentAssigner: task.assignees[0].agent }] }), /exactly one/);
  assert.throws(() => agent({ assignees: [...task.assignees, tasks['HTPR-7322'].assignees[0]] }), /exactly one/);
});
test('identity helper fallback is refused without opening any credential file', () => {
  assert.throws(() => identity(() => 'Valentins Claude Code\t/some/fallback-token'), /refusing the Valentin fallback/);
});
test('unavailable dedicated identity refuses all board writes; dry-run reports refusal', async t => {
  const api = fake(), dir = tmp(t); api.identity = () => { throw new Error('identity unavailable'); };
  await assert.rejects(tick({ dir, api }), /identity unavailable/); assert.equal(api.writes.length, 0);
  const p = await tick({ dir, api, dryRun: true }); assert.match(p.identity.refused, /writes refused/);
});
test('creation timeout cannot create a duplicate on retry; recovery resumes agent assignment', async t => {
  const dir = tmp(t), api = fake();
  api.write = args => { api.writes.push(args); throw new Error('response lost'); };
  await assert.rejects(tick({ dir, api, now: 1 }), /response lost/);
  const retry = fake(); await tick({ dir, api: retry, now: 10000 });
  assert.deepEqual(retry.writes.map(a => a[1]), ['assign']);
});
test('ambiguous creation remains blocked rather than opening another ticket', async t => {
  const dir = tmp(t), api = fake(); api.write = () => { throw new Error('lost'); };
  await assert.rejects(tick({ dir, api, now: 1 }));
  const retry = fake(); retry.recover = () => { throw new Error('manual reconciliation required'); };
  await assert.rejects(tick({ dir, api: retry, now: 10000 }), /reconciliation/); assert.equal(retry.writes.length, 0);
});
test('assignment errors resume the same ticket; invalid assignment receipt is not marked assigned', async t => {
  const dir = tmp(t), api = fake(), original = api.write;
  api.write = args => args[1] === 'assign' ? '{"success":false}' : original(args);
  await assert.rejects(tick({ dir, api, now: 1 }), /success=false/);
  const retry = fake(); await tick({ dir, api: retry, now: 10000 });
  assert.deepEqual(retry.writes.map(a => a[1]), ['assign']);
});
test('timer is five minutes, low priority, bounded, and installation is explicit only', async () => {
  const u = units('/tmp/lib'); assert.match(u.timer, /OnUnitActiveSec=5min/);
  assert.match(u.service, /nice -n 19/); assert.match(u.service, /TimeoutStartSec=240/);
  assert.match(u.service, /^WorkingDirectory=%h$/m);
  const source = fs.readFileSync(path.join(here, 'production-red-alert'), 'utf8');
  assert.match(source, /timeout: 25000/);
  assert.match(source, /command\('flock',[\s\S]*?timeout: 240000/);
  await assert.rejects(main(['install', '--dry-run']), /usage/);
  await assert.rejects(main(['--run', '39719731623']), /replay-only/);
});

function fixtureCommand(data, { cancelled = true, greenOnly = false, paginate = false, history = [], attempts = [], smoke = false, ciFails = true, log } = {}) {
  const calls = [], run = (bin, args, options) => {
    calls.push([bin, args]);
    if (bin === 'python3') return execFileSync(bin, args, { encoding: 'utf8', input: options.input });
    assert.equal(bin, 'gh'); assert.deepEqual(args.slice(0, 3), ['api', '-X', 'GET']);
    const route = args[3];
    if (route.endsWith(`/actions/runs/${data.run.id}`)) return JSON.stringify(data.run);
    if (/\/attempts\/\d+$/.test(route)) {
      const given = attempts.find(r => route.endsWith(`/runs/${r.id}/attempts/${r.run_attempt}`));
      const number = Number(route.match(/\/attempts\/(\d+)$/)[1]);
      const attempt = given || (route.includes(`/runs/${data.run.id}/attempts/`) && number >= 1
        ? { ...data.run, run_attempt: number } : null);
      assert.ok(attempt, route); return JSON.stringify(attempt);
    }
    if (route.includes('/runs?')) {
      const rows = [ ...(cancelled ? [{ ...data.run, id: data.run.id + 5, conclusion: 'cancelled' }] : []),
        ...(greenOnly ? [] : [data.run, ...history]), data.green ];
      if (paginate && !route.includes('page=2')) return JSON.stringify({ workflow_runs: rows.filter(r => r.id !== data.green.id) });
      return JSON.stringify({ workflow_runs: paginate ? [data.green] : rows });
    }
    if (route.includes('/jobs?')) {
      assert.ok(!route.includes(`/runs/${data.run.id + 5}/`), 'cancelled run jobs must not be read');
      const green = route.includes(`/runs/${data.green.id}/`);
      const jobs = [{ id: green ? 1 : data.run.job.id, name: 'ci-tests', status: 'completed', conclusion: green || (smoke && !ciFails) ? 'success' : 'failure' }];
      if (smoke && !green) jobs.push({ id: 2, name: 'browser-smoke', status: 'completed', conclusion: 'failure' });
      return JSON.stringify({ jobs });
    }
    if (route.includes('/compare/')) {
      assert.equal(route, `repos/hypertask-ai/hypertask/compare/${data.green.head_sha}...${data.run.head_sha}?per_page=100&page=1`);
      return JSON.stringify({ status: 'ahead', total_commits: data.prs.length, commits: [...data.prs].reverse().map((pr, i) => ({
        sha: String(i).padStart(40, 'a'), commit: { message: `${pr.title} (#${pr.number})\n\nSquash body` }
      })) });
    }
    if (route.endsWith('/logs')) return (typeof log === 'function' ? log(route) : log)
      ?? fs.readFileSync(path.join(here, 'fixtures/yper4-582', `${data.run.id}.log`), 'utf8');
    if (route.includes('/commits/')) {
      const pr = data.prs.at(-1);
      return JSON.stringify({ sha: data.run.head_sha, commit: { message: `${pr.title} (#${pr.number})` } });
    }
    const pr = data.prs.find(pr => route.includes(`/pulls/${pr.number}/files?`));
    if (pr) return JSON.stringify(pr.files.map((filename, i) => ({ filename, patch: pr.patches?.[i] })));
    assert.fail(`Unexpected fixture command: ${bin} ${args.join(' ')}`);
  };
  return { run, calls };
}
test('real collection path ignores cancelled runs, reads only GET, and walks history across pages', async () => {
  const data = second(), mock = fixtureCommand(data, { paginate: true });
  const result = await live(mock.run).collect();
  assert.equal(result.status, 'failure'); assert.equal(result.firstRed.head_sha, data.firstRed.head_sha);
  assert.deepEqual(result.failures, data.failures);
  const p = await plan(result, fake()); assert.equal(p.chosenPR, 1835);
  assert.ok(mock.calls.some(([bin, args]) => bin === 'gh' && args[3].includes('page=2')));
});
test('collection of green CI with other jobs red does not alert; cancelled replay is ignored', async () => {
  const data = second(); data.green.conclusion = 'failure';
  const mock = fixtureCommand(data, { greenOnly: true });
  assert.equal((await live(mock.run).collect()).status, 'success');
  const cancelled = second(); cancelled.run.conclusion = 'cancelled';
  const cm = fixtureCommand(cancelled);
  assert.equal((await live(cm.run).collect(String(cancelled.run.id))).status, 'success');
});
test('shared parser returns actual first errors from both incident logs and preserves ship-check terse output', () => {
  for (const id of ['39719731623', '39765957007']) {
    const d = fixture(id), input = fs.readFileSync(path.join(here, 'fixtures/yper4-582', `${id}.log`));
    const result = JSON.parse(execFileSync('python3', [path.join(here, 'ci-test-failures.py'), '--json'], { input, encoding: 'utf8' }));
    assert.deepEqual(result, d.failures);
    const terse = execFileSync('python3', [path.join(here, 'ci-test-failures.py')], { input, encoding: 'utf8' });
    assert.ok(terse.includes(`${d.failures[0].file}:`));
  }
});
test('missing baseline, missing filenames, invalid replay and corrupt state fail closed', async t => {
  const data = second(), mock = fixtureCommand(data);
  const missing = (bin, args, opts) => bin === 'gh' && args[3].includes('/runs?')
    ? JSON.stringify({ workflow_runs: [] }) : mock.run(bin, args, opts);
  assert.equal((await live(missing).collect()).status, 'none');
  const noLog = (bin, args, opts) => bin === 'gh' && args[3].endsWith('/logs') ? 'No test locations' : mock.run(bin, args, opts);
  await assert.rejects(live(noLog).collect(), /no failing test file/);
  const invalid = (bin, args, opts) => bin === 'gh' && args[3].endsWith(`/runs/${data.run.id}`)
    ? JSON.stringify({ ...data.run, head_branch: 'other' }) : mock.run(bin, args, opts);
  await assert.rejects(live(invalid).collect(String(data.run.id)), /completed production/);
  const dir = tmp(t); fs.writeFileSync(path.join(dir, 'state.json'), '{bad');
  await assert.rejects(tick({ dir, api: fake() }));
});

test('red without a last green baseline refuses an incomplete range', async () => {
  const data = second(), mock = fixtureCommand(data);
  const run = (bin, args, opts) => {
    if (bin === 'gh' && args[3].includes('/runs?')) {
      return JSON.stringify({ workflow_runs: /[?&]page=1(?:&|$)/.test(args[3]) ? [data.run] : [] });
    }
    return mock.run(bin, args, opts);
  };
  await assert.rejects(live(run).collect(), /No last green/);
});
test('more than three failing files all appear in the dedup set; terse output remains capped', () => {
  const input = Array.from({ length: 5 }, (_, i) => `test at tests/control-${i}.test.cjs:1:1\n  Error: failure ${i}`).join('\n');
  const parser = path.join(here, 'ci-test-failures.py');
  const failures = JSON.parse(execFileSync('python3', [parser, '--json'], { input, encoding: 'utf8' }));
  assert.equal(failures.length, 5); assert.equal(failures[4].error, 'Error: failure 4');
  assert.equal(execFileSync('python3', [parser], { input, encoding: 'utf8' }).trim().split('; ').length, 3);
});
test('an interrupted recovery note is not posted a second time', async t => {
  const dir = tmp(t); await tick({ dir, api: fake() });
  const green = fake({ status: 'success', run: { id: second().run.id + 1, html_url: 'https://example/green' } });
  green.write = args => { green.writes.push(args); throw new Error('response lost'); };
  await assert.rejects(tick({ dir, api: green, now: 1 }), /response lost/);
  const retry = fake({ status: 'success', run: { id: second().run.id + 1 } });
  await assert.rejects(tick({ dir, api: retry, now: 10000 }), /Recovery note outcome unknown/);
  assert.equal(retry.writes.length, 0);
});

test('identifier rules use added or removed tokens, ignore context/common words, and prefer newest matching PR', async () => {
  const d = second();
  d.prs.forEach(p => { p.files = ['unrelated.txt']; p.patches = []; });
  d.failures[0].error = 'TypeError: pickDecisionTaskIds is not a function or its return value is not iterable';
  d.prs[0].patches = ['@@ -1 +1 @@\n function pickDecisionTaskIds() {}\n+const iterable = undefined; // Unexpected import Cannot property return'];
  d.prs[1].patches = ['+const pickDecisionTaskIdsExtra = true;'];
  assert.equal((await plan(d, fake())).rule, 'oldest-pr');
  d.prs.at(-1).patches = ['-const pickDecisionTaskIds = old;'];
  d.prs[1].patches = ['+const pickDecisionTaskIds = changed;'];
  assert.equal((await plan(d, fake())).chosenPR, d.prs[1].number);
  d.prs[0].files = [d.failures[0].file];
  const touched = await plan(d, fake());
  assert.equal(touched.chosenPR, d.prs[0].number); assert.equal(touched.rule, 'failing-test-file');
});
test('module-path identifiers match changed module paths or changed import lines, not generic path segments', async () => {
  const d = second();
  d.prs.forEach(p => { p.files = ['unrelated.txt']; p.patches = []; });
  d.failures[0].error = "Error: Cannot find module '@/lib/auth/agentScope'";
  d.prs[0].patches = ['+const agentScope = undefined;'];
  assert.equal((await plan(d, fake())).rule, 'oldest-pr');
  d.prs[1].files = ['src/lib/auth/agentScope.ts'];
  assert.equal((await plan(d, fake())).chosenPR, d.prs[1].number);
  d.prs[0].patches = ["-import { scope } from '@/lib/auth/agentScope';"];
  assert.equal((await plan(d, fake())).chosenPR, d.prs[0].number);
});
function counted(data, options) {
  const mock = fixtureCommand(data, options), f = fake(data);
  return { ...mock, api: { ...live(mock.run), task: f.task, identity: f.identity,
    write: f.write, recover: f.recover }, writes: f.writes,
    github: () => mock.calls.filter(([bin]) => bin === 'gh').length };
}
test('idle green ticks, including a new green run without an open streak, make exactly one API call', async t => {
  const dir = tmp(t), d = second(), mock = counted(d, { greenOnly: true, cancelled: false });
  mock.api.task = () => assert.fail('idle tick must not read tickets');
  assert.equal((await tick({ dir, api: mock.api })).action, 'green');
  assert.equal(mock.github(), 1);
  let before = mock.github();
  assert.equal((await tick({ dir, api: mock.api })).action, 'idle');
  assert.equal(mock.github() - before, 1);
  d.green.id++;
  before = mock.github();
  assert.equal((await tick({ dir, api: mock.api })).action, 'green');
  assert.equal(mock.github() - before, 1); assert.equal(mock.writes.length, 0);
  t.diagnostic(`green cold/idle/new-green gh calls: ${mock.github() / 3} each; writes: ${mock.writes.length}`);
});
test('unchanged red tick makes one API call and no second alert; new failures append once without PR or ticket reads', async t => {
  const dir = tmp(t), d = second();
  const originalLog = fs.readFileSync(path.join(here, 'fixtures/yper4-582', `${d.run.id}.log`), 'utf8');
  const mock = counted(d, { cancelled: false });
  await tick({ dir, api: mock.api });
  const firstCalls = mock.github();
  assert.equal(firstCalls, 4 + d.prs.length);
  const writes = mock.writes.length;
  mock.api.task = () => assert.fail('repeated streak must not read fixer tickets');
  mock.api.identity = () => assert.fail('idle tick must not resolve a writer');
  assert.equal((await tick({ dir, api: mock.api })).action, 'idle');
  assert.equal(mock.github() - firstCalls, 1); assert.equal(mock.writes.length, writes);
  const prior = structuredClone(d.run);
  d.run.id++; d.run.head_sha = 'a'.repeat(40);
  const next = counted(d, { cancelled: false, history: [prior],
    log: `${originalLog}\ntest at tests/new-red.test.cjs:1:1\n  Error: newFailureToken is not a function\ntest at tests/another-red.test.cjs:1:1\n  Error: anotherFailureToken is not a function\n` });
  next.api.task = () => assert.fail('existing streak must not re-read tickets');
  await tick({ dir, api: next.api });
  assert.equal(next.github(), 4);
  assert.equal(next.calls.filter(([bin, args]) => bin === 'gh' && args[3].includes('/pulls/')).length, 0);
  assert.equal(next.writes.length, 1);
  assert.deepEqual(next.writes[0].slice(0, 3), ['activity', 'add', 'YPER4-9999']);
  assert.match(next.writes[0][3], /tests\/new-red.test.cjs: Error: newFailureToken/);
  assert.match(next.writes[0][3], /tests\/another-red.test.cjs: Error: anotherFailureToken/);
  assert.equal(next.writes[0][3].split('\n').length, 1);
  const before = next.github();
  await tick({ dir, api: next.api });
  assert.equal(next.github() - before, 1); assert.equal(next.writes.length, 1);
  assert.equal(mock.writes.filter(a => a[1] === 'create').length + next.writes.filter(a => a[1] === 'create').length, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json')));
  assert.deepEqual(Object.keys(saved.alerts), [`${d.firstRed.id}:1:${d.green.id}`]);
  t.diagnostic(`new-streak gh calls: ${firstCalls}; unchanged-red gh calls: ${mock.github() - firstCalls}; later-red gh calls: ${before}; repeat-later-red gh calls: ${next.github() - before}; activity lines: ${next.writes.length}; tickets: ${Object.keys(saved.alerts).length}`);
});
test('a rerun attempt on the same run ID is not mistaken for an idle tick', async t => {
  const dir = tmp(t), d = second(), mock = counted(d, { greenOnly: true, cancelled: false });
  await tick({ dir, api: mock.api });
  d.green.run_attempt = 2;
  assert.equal((await tick({ dir, api: mock.api })).action, 'green');
  assert.equal(mock.github(), 2);
});
test('an ambiguous additional-failures activity is never posted twice', async t => {
  const dir = tmp(t), d = second(), api = fake(d);
  await tick({ dir, api });
  d.run.id++; d.failures.push({ file: 'tests/extra.test.cjs', error: 'Error: extra' });
  api.write = args => { api.writes.push(args); throw new Error('response lost'); };
  await assert.rejects(tick({ dir, api, now: 1 }), /response lost/);
  const retry = fake(d);
  await assert.rejects(tick({ dir, api: retry, now: 10000 }), /activity outcome unknown/);
  assert.equal(retry.writes.length, 0);
});

test('legacy file-set keys retain the existing ticket and append only genuinely new failures', async t => {
  const dir = tmp(t), d = second(), api = fake(d);
  await tick({ dir, api });
  const stateFile = path.join(dir, 'state.json'), state = JSON.parse(fs.readFileSync(stateFile));
  const key = `${d.firstRed.id}:1:${d.green.id}`, alert = state.alerts[key];
  delete state.alerts[key]; delete alert.files;
  state.alerts[`${d.firstRed.head_sha}:${d.failures.map(f => f.file).sort().join(',')}`] = alert;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  d.run.id++; d.failures.push({ file: 'tests/new.test.cjs', error: 'Error: new' });
  const next = fake(d); next.task = () => assert.fail('legacy streak must retain its fixer');
  await tick({ dir, api: next });
  assert.equal(next.writes.length, 1); assert.equal(next.writes[0][0], 'activity');
  assert.match(next.writes[0][3], /tests\/new.test.cjs/);
  assert.ok(!next.writes[0][3].includes(d.failures[0].file));
});

test('red at SHA X, green, then red rerun at SHA X creates a new alert and deduplicates each streak', async t => {
  const dir = tmp(t), d = second(), api = fake(d);
  await tick({ dir, api }); await tick({ dir, api });
  const firstKey = (await plan(d, fake())).key;
  const green = { ...d.green, id: d.run.id + 1, created_at: '2026-10-22T11:00:00Z' };
  await tick({ dir, api: fake({ status: 'success', run: green }) });
  d.green = green;
  d.firstRed.run_attempt = 2; d.run.run_attempt = 2; d.run.created_at = '2026-10-22T12:00:00Z';
  await tick({ dir, api }); await tick({ dir, api });
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json')));
  assert.equal(api.writes.filter(a => a[1] === 'create').length, 2);
  assert.equal(api.writes.filter(a => a[1] === 'assign').length, 2);
  assert.equal(Object.keys(state.alerts).length, 2);
  assert.equal(state.alerts[firstKey].closed, true);
  assert.notEqual((await plan(d, fake())).key, firstKey);
});
test('legacy closed SHA alert cannot suppress a new streak at the same SHA', async t => {
  const dir = tmp(t), d = second();
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ alerts: {
    [d.firstRed.head_sha]: { firstRed: d.firstRed.head_sha, runId: d.run.id - 2, closed: true }
  } }));
  const mock = counted(d, { cancelled: false });
  await tick({ dir, api: mock.api });
  assert.equal(mock.writes.filter(a => a[1] === 'create').length, 1);
  assert.equal(mock.calls.filter(([bin, args]) => bin === 'gh' && args[3].includes('/compare/')).length, 1);
});
test('GitHub compare paginates beyond 250 commits and reverses the entire range newest first', async () => {
  const d = second(), mock = fixtureCommand(d), comparisons = [];
  const commits = Array.from({ length: 251 }, (_, i) => ({ sha: String(i).padStart(40, 'a'),
    commit: { message: `${d.prs[i % d.prs.length].title} (#${d.prs[i % d.prs.length].number})` } }));
  const run = (bin, args, opts) => {
    if (bin === 'gh' && args[3].includes('/compare/')) {
      const page = Number(args[3].match(/page=(\d+)$/)[1]); comparisons.push(page);
      return JSON.stringify({ status: 'ahead', total_commits: commits.length, commits: commits.slice((page - 1) * 100, page * 100) });
    }
    return mock.run(bin, args, opts);
  };
  const result = await live(run).collect();
  assert.deepEqual(comparisons, [1, 2, 3]); assert.equal(result.prs.length, 251);
  assert.deepEqual(result.prs.map(p => p.number), commits.map(c => Number(c.commit.message.match(/#(\d+)/)[1])).reverse());
});
test('GitHub compare refuses incomplete, divergent, changing and non-squash ranges', async () => {
  for (const comparison of [
    { status: 'ahead', total_commits: 1, commits: [] },
    { status: 'diverged', total_commits: 0, commits: [] },
    { status: 'ahead', total_commits: 1, commits: [{ sha: 'a'.repeat(40), commit: { message: 'no PR number' } }] },
    { status: 'ahead', total_commits: 0, commits: [{ sha: 'a'.repeat(40), commit: { message: 'extra (#1)' } }] }
  ]) {
    const mock = fixtureCommand(second());
    const run = (bin, args, opts) => bin === 'gh' && args[3].includes('/compare/') ? JSON.stringify(comparison) : mock.run(bin, args, opts);
    await assert.rejects(live(run).collect(), /production commit range|Non-squash/);
  }
  const mock = fixtureCommand(second()); let page = 0;
  const run = (bin, args, opts) => bin === 'gh' && args[3].includes('/compare/')
    ? JSON.stringify({ status: 'ahead', total_commits: ++page === 1 ? 2 : 3, commits: [{ sha: 'a'.repeat(40), commit: { message: 'one (#1835)' } }] })
    : mock.run(bin, args, opts);
  await assert.rejects(live(run).collect(), /changed during pagination/);
});

test('live collection separates same-SHA reruns after a newer green run and keeps one ticket per streak', async t => {
  const dir = tmp(t), d = second();
  d.run.run_started_at = '2026-10-22T11:00:00Z';
  const prior = structuredClone(d.run), firstMock = counted(d, { cancelled: false });
  await tick({ dir, api: firstMock.api });
  const green = { ...d.green, id: d.run.id + 1, run_started_at: '2026-10-22T11:30:00Z' };
  await tick({ dir, api: fake({ status: 'success', run: green }) });
  d.green = green; d.run.run_attempt = 2; d.run.run_started_at = '2026-10-22T12:00:00Z';
  const rerun = counted(d, { cancelled: false, attempts: [prior] });
  assert.equal((await tick({ dir, api: rerun.api })).action, 'alert');
  assert.equal((await tick({ dir, api: rerun.api })).action, 'idle');
  assert.equal(firstMock.writes.filter(a => a[1] === 'create').length, 1);
  assert.equal(rerun.writes.filter(a => a[1] === 'create').length, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json')));
  assert.deepEqual(Object.keys(saved.alerts), [`${d.run.id}:1:${second().green.id}`, `${d.run.id}:2:${green.id}`]);
  assert.ok(Object.values(saved.alerts)[0].closed);
});
test('a deferred green boundary never closes the alert it bounds (YPER4-954)', async t => {
  const dir = tmp(t), d = second();
  const red = { ...d.run, created_at: '2026-10-22T11:00:00Z', run_started_at: '2026-10-22T11:00:00Z' };
  const retried = { ...d.run, id: d.run.id + 1, run_attempt: 2, conclusion: 'success', head_sha: d.green.head_sha,
    created_at: '2026-10-22T10:29:00Z', run_started_at: '2026-10-22T11:30:00Z' };
  const data = { ...d, run: red, green: retried };
  const mock = fixtureCommand(data, { cancelled: false, attempts: [{ ...red, run_attempt: 1 }] });
  const run = (bin, args, options) => {
    if (bin !== 'gh') return mock.run(bin, args, options);
    if (args[3].includes('/runs?')) return JSON.stringify({ workflow_runs: args[3].includes('page=2') ? [] : [retried, red] });
    return mock.run(bin, args, options);
  };
  const f = fake(data);
  const api = { ...live(run), task: f.task, identity: f.identity, write: f.write, recover: f.recover };
  assert.equal((await tick({ dir, api })).action, 'alert');
  assert.equal((await tick({ dir, api })).action, 'alert');
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json')));
  assert.ok(Object.values(saved.alerts).every(a => !a.closed));
  assert.ok(!f.writes.some(args => args.join(' ').includes('Production green again')));
});
test('a cancelled run created after a green retry does not defer it into an old failure (YPER4-954)', async () => {
  const d = second();
  const retried = { ...d.run, id: d.run.id + 1, run_attempt: 2, conclusion: 'success', head_sha: d.green.head_sha,
    created_at: '2026-10-30T15:29:00Z', run_started_at: '2026-10-30T15:50:13Z' };
  const cancelled = { ...d.run, id: d.run.id + 2, conclusion: 'cancelled',
    created_at: '2026-10-30T15:46:54Z', run_started_at: '2026-10-30T15:47:00Z' };
  const oldFailure = { ...d.run, id: d.run.id + 3, created_at: '2026-10-30T15:10:00Z', run_started_at: '2026-10-30T15:10:00Z' };
  const green = { ...d.green, created_at: '2026-10-30T15:00:00Z' };
  const mock = fixtureCommand({ ...d, run: retried, green });
  const run = (bin, args, options) => {
    if (bin !== 'gh') return mock.run(bin, args, options);
    const route = args[3];
    if (route.includes('/runs?')) return JSON.stringify({ workflow_runs: [retried, cancelled, oldFailure, green] });
    if (route.includes('/jobs?')) return JSON.stringify({ jobs: [{ id: 1, name: 'ci-tests', status: 'completed', conclusion: 'failure' }] });
    return mock.run(bin, args, options);
  };
  const result = await live(run).collect();
  assert.equal(result.status, 'success');
  assert.equal(result.run.id, retried.id);
});
test('a green retry that started after a newer red run still reports that red (YPER4-954)', async () => {
  const d = second();
  const red = { ...d.run, created_at: '2026-10-30T15:46:54Z', run_started_at: '2026-10-30T15:47:00Z' };
  const retried = { ...d.run, id: d.run.id + 1, run_attempt: 2, conclusion: 'success', head_sha: d.green.head_sha,
    created_at: '2026-10-30T15:29:00Z', run_started_at: '2026-10-30T15:50:13Z' };
  const green = { ...d.green, created_at: '2026-10-30T15:00:00Z' };
  const mock = fixtureCommand({ ...d, run: red, green });
  const run = (bin, args, options) => {
    if (bin !== 'gh') return mock.run(bin, args, options);
    const route = args[3];
    if (route.includes('/runs?')) return JSON.stringify({ workflow_runs: [retried, red, green] });
    if (route.includes('/jobs?')) {
      const id = Number(route.match(/runs\/(\d+)\/jobs/)[1]);
      return JSON.stringify({ jobs: [{ id: id + 900, name: 'ci-tests', status: 'completed',
        conclusion: id === red.id ? 'failure' : 'success' }] });
    }
    return mock.run(bin, args, options);
  };
  const result = await live(run).collect();
  assert.equal(result.status, 'failure');
  assert.equal(result.run.id, red.id);
  assert.equal(result.green.id, green.id);
});
test('a failed rerun without a green boundary retains the first red attempt and skips compare', async t => {
  const dir = tmp(t), d = second(); d.run.run_started_at = '2026-10-22T11:00:00Z';
  const prior = structuredClone(d.run), firstMock = counted(d, { cancelled: false });
  await tick({ dir, api: firstMock.api });
  d.run.run_attempt = 2; d.run.run_started_at = '2026-10-22T12:00:00Z';
  const rerun = counted(d, { cancelled: false, attempts: [prior] });
  rerun.api.task = () => assert.fail('continuous rerun must retain its fixer');
  await tick({ dir, api: rerun.api });
  assert.equal(rerun.calls.filter(([bin, args]) => bin === 'gh' && args[3].includes('/compare/')).length, 0);
  assert.equal(rerun.writes.length, 0);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'))).alerts).length, 1);
});
test('red after green at the same SHA blames that commit and opens one new incident', async t => {
  const dir = tmp(t), d = second(); d.run.run_started_at = '2026-10-22T11:00:00Z';
  const prior = structuredClone(d.run);
  await tick({ dir, api: counted(d, { cancelled: false }).api });
  const green = { ...d.green, id: d.run.id + 1, head_sha: d.run.head_sha, run_started_at: '2026-10-22T11:30:00Z' };
  await tick({ dir, api: fake({ status: 'success', run: green }) });
  d.green = green; d.run.run_attempt = 2; d.run.run_started_at = '2026-10-22T12:00:00Z';
  const pr = d.prs.at(-1), rerun = counted(d, { cancelled: false, attempts: [prior] });
  const run = (bin, args, opts) => bin === 'gh' && args[3].endsWith(`/commits/${d.run.head_sha}`)
    ? JSON.stringify({ sha: d.run.head_sha, commit: { message: `${pr.title} (#${pr.number})` } }) : rerun.run(bin, args, opts);
  const api = { ...rerun.api, ...live(run), task: rerun.api.task, identity: rerun.api.identity, write: rerun.api.write, recover: rerun.api.recover };
  assert.equal((await tick({ dir, api })).action, 'alert');
  assert.equal(rerun.writes.filter(a => a[1] === 'create').length, 1);
  assert.ok(!rerun.calls.some(([bin, args]) => bin === 'gh' && args[3].includes('/compare/')));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json')));
  assert.deepEqual(Object.keys(saved.alerts), [`${d.run.id}:1:${second().green.id}`, `${d.run.id}:2:${green.id}`]);
});

const SMOKE_LOG = [
  '  ✘  10 [Desktop] › e2e/smoke/layout-lock.spec.ts:111:7 › layout baseline: ticket from board card (50.1s)',
  '', '  1) [Desktop] › e2e/smoke/layout-lock.spec.ts:111:7 › layout baseline: ticket from board card ─────',
  '', '    Test timeout of 50000ms exceeded.', '',
  '  1 failed', '     [Desktop] › e2e/smoke/layout-lock.spec.ts:111:7 › layout baseline: ticket from board card ──',
  '  7 skipped', '  65 passed (3.7m)', ''
].join('\n');
const SMOKE_FAILURE = { file: 'e2e/smoke/layout-lock.spec.ts',
  name: 'layout baseline: ticket from board card', device: 'Desktop', error: 'Test timeout of 50000ms exceeded.' };

test('a red browser-smoke job is production red even when ci-tests passed', async () => {
  const data = second(), mock = fixtureCommand(data, { smoke: true, ciFails: false, log: SMOKE_LOG });
  const result = await live(mock.run).collect();
  assert.equal(result.status, 'failure');
  assert.deepEqual(result.failures, [SMOKE_FAILURE]);
});

test('both failed test jobs are read, so a red smoke never hides a failing ci-tests file', async () => {
  const data = second();
  const ciLog = fs.readFileSync(path.join(here, 'fixtures/yper4-582', `${data.run.id}.log`), 'utf8');
  const mock = fixtureCommand(data, { smoke: true,
    log: route => route.includes(`/jobs/${data.run.job.id}/`) ? ciLog : SMOKE_LOG });
  const result = await live(mock.run).collect();
  assert.equal(result.status, 'failure');
  assert.deepEqual(result.failures.map(f => f.file), [data.failures[0].file, SMOKE_FAILURE.file]);
});

test('--run replays the first failed attempt of a run that was later rerun green', async () => {
  const data = second(), target = { ...data.run, run_attempt: 2, conclusion: 'success' };
  const mock = fixtureCommand({ ...data, run: target }, { smoke: true, ciFails: false, log: SMOKE_LOG });
  assert.equal((await live(mock.run).collect(String(target.id))).status, 'failure');
});

test('a fresh red production run is rerun once before any fixer is paged', async t => {
  const dir = tmp(t), d = second(), reruns = [], now = Date.parse('2026-10-22T12:03:00Z') / 1000;
  d.run.updated_at = '2026-10-22T12:00:00Z';
  const mock = counted(d, { cancelled: false });
  mock.api.rerun = id => reruns.push(id);
  assert.equal((await tick({ dir, api: mock.api, now })).action, 'rerun');
  assert.deepEqual(reruns, [d.run.id]);
  assert.equal(mock.writes.length, 0);
  assert.equal((await tick({ dir: tmp(t), api: mock.api, dryRun: true, now })).action, 'rerun');
  assert.deepEqual(reruns, [d.run.id]);
});

test('a red run already seen hours ago goes straight to the fixer, never to a rerun', async t => {
  const dir = tmp(t), d = second(), reruns = [];
  d.run.updated_at = '2026-10-22T12:00:00Z';
  const mock = counted(d, { cancelled: false });
  mock.api.rerun = id => reruns.push(id);
  assert.equal((await tick({ dir, api: mock.api, now: Date.parse('2026-10-22T15:00:00Z') / 1000 })).action, 'alert');
  assert.deepEqual(reruns, []);
});

test('the red after that rerun files one urgent fixer ticket naming the smoke test', async t => {
  const dir = tmp(t), d = second();
  d.failures = [SMOKE_FAILURE];
  d.run.run_attempt = 2;
  d.run.updated_at = '2026-10-22T12:00:00Z';
  d.prs.forEach(pr => { pr.files = ['unrelated.txt']; });
  const api = fake(d);
  await tick({ dir, api, now: Date.parse('2026-10-22T12:03:00Z') / 1000 });
  const create = api.writes.find(a => a[1] === 'create');
  assert.ok(create.includes('urgent'));
  assert.match(create[create.indexOf('--title') + 1], /layout baseline: ticket from board card/);
  assert.match(create[create.indexOf('--description') + 1],
    /layout baseline: ticket from board card \[Desktop\]: Test timeout of 50000ms exceeded/);
  assert.equal(api.writes.filter(a => a[1] === 'create').length, 1);
});
