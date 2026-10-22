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
test('actual 39719731623 range has no failing-file change: newest #1806 owns fallback', async () => {
  const p = await plan(first(), fake());
  assert.equal(p.chosenPR, 1806); assert.equal(p.fixer.name, 'Runner 5');
  assert.match(p.why, /No PR.*newest PR/);
});
test('no touching PR falls back to newest, not the oldest or PR author', async () => {
  const d = second(); d.prs.forEach(p => { p.files = ['unrelated.txt']; });
  const p = await plan(d, fake()); assert.equal(p.chosenPR, d.prs[0].number);
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
  const d = second(); d.green.id = d.run.id + 1; d.run.id += 2; d.firstRed.head_sha = 'b'.repeat(40);
  const api = fake(d); await tick({ dir, api });
  assert.equal(api.writes.filter(a => a[0] === 'activity').length, 1);
  assert.equal(api.writes.filter(a => a[1] === 'create').length, 1);
});
test('key uses first red SHA plus sorted unique failing files, not newest red SHA', async () => {
  const a = second(), b = second();
  a.failures.push({ file: 'tests/a.test.cjs', error: 'Error: a' });
  b.failures = [...a.failures].reverse(); b.run.head_sha = 'f'.repeat(40);
  const pa = await plan(a, fake()), pb = await plan(b, fake());
  assert.equal(pa.key, pb.key); assert.ok(pa.key.startsWith(a.firstRed.head_sha));
  b.firstRed.head_sha = 'c'.repeat(40);
  assert.notEqual((await plan(b, fake())).key, pa.key);
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
  const u = units('/tmp/lib', '/tmp/repo'); assert.match(u.timer, /OnUnitActiveSec=5min/);
  assert.match(u.service, /nice -n 19/); assert.match(u.service, /TimeoutStartSec=240/);
  assert.match(u.service, /WorkingDirectory="\/tmp\/repo"/);
  await assert.rejects(main(['install', '--dry-run']), /usage/);
  await assert.rejects(main(['--run', '39719731623']), /replay-only/);
});

function fixtureCommand(data, { cancelled = true, greenOnly = false, paginate = false } = {}) {
  const calls = [], run = (bin, args, options) => {
    calls.push([bin, args]);
    if (bin === 'python3') return execFileSync(bin, args, { encoding: 'utf8', input: options.input });
    if (bin === 'git') {
      if (args.includes('merge-base')) return '';
      return data.prs.map((pr, i) => `${String(i).padStart(40, 'a')}\t${pr.title} (#${pr.number})`).join('\n');
    }
    assert.equal(bin, 'gh'); assert.deepEqual(args.slice(0, 3), ['api', '-X', 'GET']);
    const route = args[3];
    if (route.endsWith(`/actions/runs/${data.run.id}`)) return JSON.stringify(data.run);
    if (route.includes('/runs?')) {
      const rows = [ ...(cancelled ? [{ ...data.run, id: data.run.id + 5, conclusion: 'cancelled' }] : []),
        ...(greenOnly ? [] : [data.run]), data.green ];
      if (paginate && !route.includes('page=2')) return JSON.stringify({ workflow_runs: rows.filter(r => r.id !== data.green.id) });
      return JSON.stringify({ workflow_runs: paginate ? [data.green] : rows });
    }
    if (route.includes('/jobs?')) {
      assert.ok(!route.includes(`/runs/${data.run.id + 5}/`), 'cancelled run jobs must not be read');
      const green = route.includes(`/runs/${data.green.id}/`);
      return JSON.stringify({ jobs: [{ id: green ? 1 : data.run.job.id, name: 'ci-tests', status: 'completed', conclusion: green ? 'success' : 'failure' }] });
    }
    if (route.endsWith('/logs')) return fs.readFileSync(path.join(here, 'fixtures/yper4-582', `${data.run.id}.log`), 'utf8');
    const pr = data.prs.find(pr => route.includes(`/pulls/${pr.number}/files?`));
    if (pr) return JSON.stringify(pr.files.map(filename => ({ filename })));
    assert.fail(`Unexpected fixture command: ${bin} ${args.join(' ')}`);
  };
  return { run, calls };
}
test('real collection path ignores cancelled runs, reads only GET, and walks history across pages', async () => {
  const data = second(), mock = fixtureCommand(data, { paginate: true });
  const result = await live(mock.run, '/fixture').collect();
  assert.equal(result.status, 'failure'); assert.equal(result.firstRed.head_sha, data.firstRed.head_sha);
  assert.deepEqual(result.failures, data.failures);
  const p = await plan(result, fake()); assert.equal(p.chosenPR, 1835);
  assert.ok(mock.calls.some(([bin, args]) => bin === 'gh' && args[3].includes('page=2')));
});
test('collection of green CI with other jobs red does not alert; cancelled replay is ignored', async () => {
  const data = second(); data.green.conclusion = 'failure';
  const mock = fixtureCommand(data, { greenOnly: true });
  assert.equal((await live(mock.run, '/fixture').collect()).status, 'success');
  const cancelled = second(); cancelled.run.conclusion = 'cancelled';
  const cm = fixtureCommand(cancelled);
  assert.equal((await live(cm.run, '/fixture').collect(String(cancelled.run.id))).status, 'success');
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
  assert.equal((await live(missing, '/fixture').collect()).status, 'none');
  const noLog = (bin, args, opts) => bin === 'gh' && args[3].endsWith('/logs') ? 'No test locations' : mock.run(bin, args, opts);
  await assert.rejects(live(noLog, '/fixture').collect(), /no failing test file/);
  const invalid = (bin, args, opts) => bin === 'gh' && args[3].endsWith(`/runs/${data.run.id}`)
    ? JSON.stringify({ ...data.run, head_branch: 'other' }) : mock.run(bin, args, opts);
  await assert.rejects(live(invalid, '/fixture').collect(String(data.run.id)), /completed production/);
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
  await assert.rejects(live(run, '/fixture').collect(), /No last green/);
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
