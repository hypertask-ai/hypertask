import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { collect, fingerprint, normalize, redact, loadSources } from './collector.mjs';
import * as fixture from './sources/fixture.mjs';
import * as journal from './sources/vps-journal.mjs';
import { command as readCommand, query } from './io.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'collector.mjs');
const NOW = Date.parse('2026-10-14T05:00:00Z');
const HOUR = 3600000;
const DAY = HOUR * 24;
const suite = process.env.ERROR_COLLECTOR_TEST_SUITE ?? 'all';
let passed = 0;
let failed = 0;
function check(group, name, fn) {
  if (suite !== 'all' && suite !== group) return;
  test(`${group}: ${name}`, async () => { try { await fn(); passed++; } catch (error) { failed++; throw error; } });
}
const fake = `#!${process.execPath}
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
const home = process.env.HOME;
const name = basename(process.argv[1]);
const args = process.argv.slice(2);
const read = (file, fallback) => existsSync(join(home, file)) ? JSON.parse(readFileSync(join(home, file), 'utf8')) : fallback;
const cfg = read('mock.json', {});
const calls = join(home, 'calls.jsonl');
const row = { name, args };
if (name === 'vcc' && args.includes('--description-file')) row.description = readFileSync(args[args.indexOf('--description-file') + 1], 'utf8');
if (name === 'runner-deliver') { row.input = readFileSync(0, 'utf8'); row.id = process.env.RUNNER_DELIVER_ID; }
appendFileSync(calls, JSON.stringify(row) + '\\n');
if (cfg.stall === name) { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); await new Promise(() => {}); }
const exit = () => { console.error('fake credential-bearing failure suppressed'); process.exit(1); };
const remote = read('remote.json', []);
if (name === 'systemctl') { if (cfg.installFail) exit(); process.exit(0); }
if (name === 'runner-deliver') { if (cfg.deliverFail) exit(); process.exit(0); }
if (name === 'ht') {
  if (args[0] !== 'GET') throw new Error('WRITE FORBIDDEN');
  if (cfg.searchFail) exit();
  const url = new URL(args[1], 'https://fake.invalid');
  if (url.pathname.startsWith('/mcp/tasks/') && url.pathname.endsWith('/agent-activity')) {
    console.log(JSON.stringify({ success: true, activities: read('activities.json', []).filter(item => item.ticket === url.pathname.split('/')[3]) }));
  } else if (url.pathname === '/mcp/projects/4060/sections') {
    console.log(JSON.stringify({ success: true, sections: cfg.sections ?? [{ id: 10414, section_title: 'Backlog', projectId: 4060, deleted: false }] }));
  } else {
    if (url.pathname !== '/mcp/tasks') throw new Error('unexpected read');
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search');
    const board = Number(url.searchParams.get('projectId'));
    let tasks = remote.filter(t => t.status === status && t.projectId === board && t.description.includes(search));
    if (cfg.pages) tasks = [...Array.from({ length: 100 }, (_, i) => ({ ticketNumber: 'HTPR-' + (9000 + i), projectId: board, description: 'unrelated' })), ...tasks];
    const offset = Number(url.searchParams.get('offset'));
    console.log(cfg.badSearch ? '{}' : JSON.stringify({ success: true, tasks: tasks.slice(offset, offset + 100), total: tasks.length }));
  }
} else if (name === 'vcc') {
  const plain = args[0] === '--json' ? args.slice(1) : args;
  if (plain[0] === 'task' && plain[1] === 'create') {
    if (args[0] !== '--json') throw new Error('must request JSON');
    if (cfg.createFail) exit();
    const board = Number(args[args.indexOf('--project') + 1]);
    const task = { ticketNumber: (board === 15 ? 'HTPR-' : 'YPER4-') + (100 + remote.length), projectId: board, description: row.description, status: 'Normal' };
    remote.push(task);
    writeFileSync(join(home, 'remote.json'), JSON.stringify(remote));
    if (cfg.ambiguousCreate) exit();
    console.log(JSON.stringify({ success: true, task: cfg.badReceipt ? { ticketNumber: 'invalid receipt' } : task }));
  } else if (plain[0] === 'activity' && plain[1] === 'add') {
    if (cfg.activityFail) exit();
    const saved = read('activities.json', []);
    saved.unshift({ ticket: plain[2], text: plain[3], createdAt: new Date().toISOString() });
    writeFileSync(join(home, 'activities.json'), JSON.stringify(saved));
    if (cfg.ambiguousActivity) exit();
    console.log('fake-activity-id');
  } else throw new Error('unexpected vcc command');
} else throw new Error('unexpected command');
`;

function harness() {
  const home = mkdtempSync(join(tmpdir(), 'error-collector-test-'));
  mkdirSync(join(home, 'bin'));
  for (const name of ['vcc', 'ht', 'runner-deliver', 'systemctl']) writeFileSync(join(home, 'bin', name), fake, { mode: 0o755 });
  const env = { ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}), HOME: home, PATH: join(home, 'bin'), ERROR_COLLECTOR_FIXTURE: join(home, 'fixture.json') };
  const statePath = join(home, '.local/state/error-collector/state.json');
  const calls = () => existsSync(join(home, 'calls.jsonl')) ? readFileSync(join(home, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const events = data => writeFileSync(env.ERROR_COLLECTOR_FIXTURE, JSON.stringify(data));
  events([]);
  return {
    home, env, statePath, calls, events,
    config: data => writeFileSync(join(home, 'mock.json'), JSON.stringify(data)),
    remote: data => writeFileSync(join(home, 'remote.json'), JSON.stringify(data)),
    state: () => JSON.parse(readFileSync(statePath, 'utf8')),
    seed: state => { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(state)); },
    run: (options = {}) => collect({ env, now: NOW, sources: [fixture], ...options }),
    cli: (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8', timeout: 30000 }),
    close: () => rmSync(home, { recursive: true, force: true }),
  };
}
async function withHarness(fn) { const h = harness(); try { await fn(h); } finally { h.close(); } }
const longValue = 'Xy'.repeat(20);
const event = (overrides = {}) => ({ service: 'web', board: 15, message: 'Checkout failed for user 123', route: '/checkout/123', stack: 'Error: checkout failed\n  at checkout', ts: new Date(NOW - 1000).toISOString(), ...overrides });
const creates = h => h.calls().filter(c => c.name === 'vcc' && c.args.includes('create'));
const activities = (h, ticket) => h.calls().filter(c => c.name === 'vcc' && c.args[0] === 'activity' && (!ticket || c.args[2] === ticket));

check('sources', 'normalization strips every dynamic value and hash matches independent SHA-256', () => {
  const values = ['123e4567-e89b-12d3-a456-426614174000', 'abcdefabcdef1234567890', 'person@example.invalid', '"quoted value"', "'literal 7'", '`a b`', 'clm123456789abcdefghijklmn'];
  for (const value of values) {
    assert.equal(normalize(`  failed\n ${value}  now `), 'failed <id> now');
    assert.equal(normalize(`/users/${value}`, true), '/users/:id');
  }
  assert.equal(normalize('failed 42 now'), 'failed <n> now');
  assert.equal(normalize('/users/42', true), '/users/:id');
  assert.equal(normalize('Invalid `prisma.task.deleteMany()` invocation'), 'Invalid `prisma.task.deleteMany()` invocation');
  assert.equal(normalize('failed https://example.invalid/x?token=anything'), 'failed https://example.invalid/x');
  assert.equal(normalize('/users/42?email=test', true), '/users/:id');
  assert.equal(normalize('x'.repeat(400)).length, 300);
  const expected = createHash('sha256').update('web|failed <n>').digest('hex').slice(0, 16);
  assert.equal(fingerprint('web', 'failed 42', '/users/1'), expected);
  assert.equal(fingerprint('web', 'failed 42', '/users/1'), fingerprint('web', 'failed 7', '/teams/2'));
  assert.notEqual(fingerprint('web', 'failed 42', '/users/1'), fingerprint('api', 'failed 42', '/users/1'));
});

check('sources', 'PowerShell genuine pipe failures count as one new kind across transient scopes', () => withHarness(async h => {
  const messages = [
    ['run-u2003472.scope', '7.6.7:B:80', 2169841],
    ['run-u2003644.scope', '7.6.7:C:80', 2863890],
    ['run-r1b66062f07d0426abf597f7579b30ec8.scope', '7.6.7:C:80', 3021000],
    ['run-r536fa8835f1f416693556a3156812a26.scope', '7.4.6:C:99', 3051000],
  ].map(([unit, session, pid]) => `${unit}: (${session}) [NamedPipeIPC_ServerListenerError:NamedPipe.Exception.Error] An error has occurred in PowerShell IPC listening thread on process: ${pid} in AppDomain: None. Error Message: Access denied.`);
  assert.equal(new Set(messages.map(message => fingerprint('vps-journal', message))).size, 1);
  assert.notEqual(fingerprint('vps-journal', messages[0]), fingerprint('vps-journal', messages[0].replace('Access denied.', 'Connection refused.')));
  assert.notEqual(fingerprint('vps-journal', messages[0]), fingerprint('vercel', messages[0]));
  h.events(messages.map(message => event({ service: 'vps-journal', board: 4060, message })));
  assert.equal(await h.run(), 0);
  assert.equal(creates(h).length, 1);
  assert.equal(h.state().days['2026-10-14']['vps-journal'].newGroups, 1);
  assert.equal(h.state().days['2026-10-14']['vps-journal'].errors, messages.length);
}));

check('sources', 'leading ISO timestamps and rejected Better Auth origins do not split one error into many tickets', () => withHarness(async h => {
  const host = 'https://hypertask-git-yper4-399-guest-demo-hypertask.vercel.app';
  const lines = [
    [`2026-10-15T01:33:10.523Z ERROR [Better Auth]: Invalid origin: ${host}`, '/api/demo/guest'],
    [`2026-10-15T01:33:09.342Z ERROR [Better Auth]: Invalid origin: ${host}`, '/api/demo/guest'],
    [`2026-10-15T01:33:06.967Z ERROR [Better Auth]: Invalid origin: ${host}/demo`, '/api/auth/bridge-legacy-session'],
    [`2026-10-15T01:33:06.945Z ERROR [Better Auth]: Invalid origin: ${host}/demo`, '/api/auth/bridge-legacy-session'],
  ];
  h.events(lines.map(([message, route]) => event({ service: 'vercel', message, route })));
  assert.equal(await h.run(), 0);
  assert.equal(creates(h).length, 1);
  assert.equal(Object.values(h.state().fingerprints)[0].total, 4);
  assert.equal(normalize(lines[0][0]), 'ERROR [Better Auth]: Invalid origin: <url>');
  assert.equal(normalize('2026-10-15 01:33:06,945+02:00 boom 7'), 'boom <n>');
  assert.equal(normalize('failed at 2026-10-15T01:33:06.945Z'), 'failed at <time>');
  assert.equal(normalize('Invalid callbackURL: https://other.example/x'), 'Invalid callbackURL: <url>');
  assert.notEqual(fingerprint('vercel', lines[0][0]), fingerprint('vercel', 'ERROR [Better Auth]: Invalid callbackURL: https://x.example'));
}));

check('tickets', 'groups parked before a fingerprint rule change join the current fingerprint instead of filing duplicates', () => withHarness(async h => {
  const parked = [
    ['8e2912a350500b38', '2026-10-15T01:46:59.060Z', '', '/api/demo/guest'],
    ['3c221db2496d9ced', '2026-10-15T01:46:59.025Z', '', '/api/demo/guest'],
    ['768f089384b26376', '2026-10-15T01:46:58.277Z', '/demo', '/api/auth/bridge-legacy-session'],
    ['502ccac81c34360a', '2026-10-15T01:46:57.514Z', '/demo', '/api/auth/bridge-legacy-session'],
  ];
  const pending = Object.fromEntries(parked.map(([fp, ts, path, route]) => {
    const message = `${ts} ERROR [Better Auth]: Invalid origin: https://[redacted].vercel.app${path}`;
    return [fp, { board: 15, service: 'vercel', normalized: normalize(message), message, stack: '', routes: [route], count: 1, firstSeen: ts, lastSeen: ts }];
  }));
  const seedState = () => h.seed({ version: 1, sources: {}, fingerprints: {}, pending, days: {}, summaries: {}, activities: {}, created: [] });
  const current = fingerprint('vercel', 'ERROR [Better Auth]: Invalid origin: https://x.vercel.app');
  seedState();
  h.remote([{ ticketNumber: 'HTPR-7239', projectId: 15, status: 'Normal', description: `<p>error-fingerprint:${current}</p>` }]);
  assert.equal(await h.run(), 0);
  assert.equal(creates(h).length, 0);
  assert.deepEqual(Object.keys(h.state().pending), []);
  assert.equal(h.state().fingerprints[current].ticket, 'HTPR-7239');
  assert.equal(h.state().fingerprints[current].total, 4);
  h.remote([]);
  seedState();
  assert.equal(await h.run(), 0);
  assert.equal(creates(h).length, 1);
  assert.match(creates(h)[0].description, new RegExp(`error-fingerprint:${current}<`));
}));

check('tickets', 'a group parked under the current rules keeps its key even when its saved sample is redacted', () => withHarness(async h => {
  const message = `Upstream refused ${longValue}`;
  h.events([event({ message })]);
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '0';
  assert.equal(await h.run(), 0);
  const raw = fingerprint('web', message);
  assert.notEqual(raw, fingerprint('web', redact(message)));
  assert.deepEqual(Object.keys(h.state().pending), [raw]);
  h.events([]);
  assert.equal(await h.run({ now: NOW + 1000 }), 0);
  assert.deepEqual(Object.keys(h.state().pending), [raw]);
  const legacy = h.state();
  delete legacy.pending[raw].rules;
  h.seed(legacy);
  assert.equal(await h.run({ now: NOW + 2000 }), 0);
  assert.deepEqual(Object.keys(h.state().pending), [raw]);
}));

for (const [kind, hidden] of [['long-value', longValue], ['email', 'person@example.invalid']]) check('tickets', `a parked group whose ${kind}-redacted sample cannot rebuild its fingerprint keeps its key and gets one ticket`, () => withHarness(async h => {
  const message = `2026-10-15T01:46:59.060Z Upstream refused ${hidden}`;
  h.events([event({ message })]);
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '0';
  assert.equal(await h.run(), 0);
  const raw = fingerprint('web', message);
  const legacy = h.state();
  delete legacy.pending[raw].rules;
  h.seed(legacy);
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '5';
  assert.equal(await h.run({ now: NOW + 1000 }), 0);
  assert.equal(creates(h).length, 1);
  h.events([event({ message, ts: new Date(NOW + 1500).toISOString() })]);
  assert.equal(await h.run({ now: NOW + 2000 }), 0);
  assert.equal(creates(h).length, 1);
  assert.equal(h.state().fingerprints[raw].total, 2);
}));

check('tickets', 'a ticket already filed under a parked group\'s old fingerprint is adopted, not filed again', () => withHarness(async h => {
  const message = '2026-10-15T01:46:59.060Z ERROR [Better Auth]: Invalid origin: https://[redacted].vercel.app';
  const old = '8e2912a350500b38';
  h.seed({ version: 1, sources: {}, fingerprints: {}, pending: { [old]: { board: 15, service: 'vercel', normalized: normalize(message), message, stack: '', routes: ['/api/demo/guest'], count: 1, firstSeen: '2026-10-15T01:46:59.060Z', lastSeen: '2026-10-15T01:46:59.060Z' } }, days: {}, summaries: {}, activities: {}, created: [] });
  h.remote([{ ticketNumber: 'HTPR-7244', projectId: 15, status: 'Normal', description: `<p>error-fingerprint:${old}</p>` }]);
  assert.equal(await h.run(), 0);
  assert.equal(creates(h).length, 0);
  assert.equal(h.state().fingerprints[fingerprint('vercel', message)].ticket, 'HTPR-7244');
}));

check('sources', 'independent source windows, cap, partial failure and all-failed exit', () => withHarness(async h => {
  const windows = [];
  const ok = { name: 'good', fetch: async context => { windows.push(context); return []; } };
  const bad = { name: 'bad', fetch: async () => { throw new Error('do not log upstream body'); } };
  assert.equal(await h.run({ sources: [ok, bad] }), 0);
  assert.equal(windows[0].since, new Date(NOW - DAY).toISOString());
  assert.equal(windows[0].until, new Date(NOW).toISOString());
  assert.equal(windows[0].env, h.env);
  assert.equal(h.state().sources.good, windows[0].until);
  assert.equal(h.state().sources.bad, undefined);
  await h.run({ now: NOW + 1000, sources: [ok] });
  assert.equal(windows[1].since, new Date(NOW).toISOString());
  await h.run({ now: NOW + 3 * DAY, sources: [ok] });
  assert.equal(windows[2].since, new Date(NOW + 2 * DAY).toISOString());
  const before = readFileSync(h.statePath);
  assert.equal(await h.run({ sources: [bad] }), 1);
  assert.deepEqual(readFileSync(h.statePath), before);
  assert.equal(h.cli('--once', '--sources', 'missing').status, 1);
}));

check('sources', 'fixture filters boundaries, groups counts/times/routes and repeats do not recount', () => withHarness(async h => {
  h.events([event({ count: 2, ts: new Date(NOW - 5000).toISOString() }), event({ message: 'Checkout failed for user 456', route: '/checkout/456', count: 3 }), event({ ts: new Date(NOW - DAY).toISOString() }), event({ ts: new Date(NOW + 1).toISOString() })]);
  assert.equal(await h.run(), 0);
  const records = Object.values(h.state().fingerprints);
  assert.equal(records.length, 1);
  assert.equal(records[0].total, 5);
  assert.equal(records[0].firstSeen, new Date(NOW - 5000).toISOString());
  assert.equal(records[0].lastSeen, new Date(NOW - 1000).toISOString());
  const body = creates(h)[0].description;
  assert.match(body, /\/checkout\/123, \/checkout\/456/);
  assert.match(body, /Count in window: 5/);
  h.events([]);
  await h.run({ now: NOW + 1000 });
  assert.equal(Object.values(h.state().fingerprints)[0].total, 5);
  assert.equal(creates(h).length, 1);
  assert.equal(h.state().days['2026-10-14'].web.errors, 5);
}));

check('sources', 'invalid event/source fail without advancing', () => withHarness(async h => {
  for (const item of [event({ board: 99 }), event({ count: 0 }), event({ count: 1.5 }), event({ ts: 'invalid' }), event({ service: '__proto__' }), event({ route: {} })]) {
    assert.equal(await h.run({ sources: [{ name: 'invalid', fetch: async () => [item] }] }), 1);
    assert.equal(existsSync(h.statePath), false);
  }
  assert.equal(await h.run({ sources: [{ name: 'invalid', fetch: async () => ({}) }] }), 1);
  assert.equal(h.cli('--sources', '../bad').status, 1);
  assert.equal(h.cli('--sources', 'fixture,fixture').status, 1);
  assert.equal((await loadSources())[0].name, 'vercel');
}));

check('tickets', 'redaction removes credential formats but preserves a useful nonsecret sample', () => {
  const values = [
    ['email=user@example.invalid', 'user@example.invalid'],
    ['Authorization: Bearer fixture-bearer', 'fixture-bearer'],
    ['password="fixture-password"', 'fixture-password'],
    ["api_key='fixture-key'", 'fixture-key'],
    ['token: fixture-token', 'fixture-token'],
    ['eyJfixture.payload.signature', 'eyJfixture.payload.signature'],
    ['ghp_abcdefghijklmnopqrstuvwxyz', 'ghp_abcdefghijklmnopqrstuvwxyz'],
    [['https://fixture-user', 'fixture-pass@example.invalid/path?token=fixture-query'].join(':'), 'fixture-pass'],
    ['https://fixture-user@example.invalid/path', 'fixture-user'],
    ['abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN', 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN'],
  ];
  for (const [sample, value] of values) assert.ok(!redact(sample).includes(value), 'fixture credential not removed');
  assert.equal(redact('Checkout failed at checkout.mjs:12'), 'Checkout failed at checkout.mjs:12');
});

check('tickets', 'malformed state fails closed without changing it or invoking CLI tools', () => withHarness(async h => {
  mkdirSync(dirname(h.statePath), { recursive: true }); writeFileSync(h.statePath, 'not JSON');
  const before = readFileSync(h.statePath); const result = h.cli('--once');
  assert.equal(result.status, 1); assert.deepEqual(readFileSync(h.statePath), before); assert.deepEqual(h.calls(), []);
}));

check('tickets', 'creation options, redacted escaped HTML, atomic private state and restart dedupe', () => withHarness(async h => {
  const fakeStripe = ['sk', 'test', 'Ab3dEf6hIj9kLm2nOp5qRs8t'].join('_');
  const unsafe = `password=fake-password bearer fake-bearer user@example.invalid api_key=\"fake-key\" ${fakeStripe} <script>alert(1)</script>`;
  h.events([event({ message: `Checkout failed ${unsafe}`, stack: Array.from({ length: 50 }, (_, i) => `${i}: ${unsafe}`).join('\n') })]);
  await h.run();
  const call = creates(h)[0];
  assert.deepEqual(call.args.slice(0, 12), ['--json', 'task', 'create', '--project', '15', '--section', '4389', '--labels', 'Error Log', '--priority', 'high', '--title']);
  assert.match(call.description, /^<p><strong>/);
  assert.match(call.description, /error-fingerprint:[a-f0-9]{16}<\/p>$/);
  assert.ok(!call.description.includes('<script>'));
  const stack = call.description.match(/<pre>([\s\S]*?)<\/pre>/)[1];
  assert.equal(stack.split('\n').length, 40);
  const sensitive = ['fake-password', 'fake-bearer', 'user@example.invalid', 'fake-key', fakeStripe];
  const output = JSON.stringify(h.calls()) + readFileSync(h.statePath, 'utf8');
  for (const value of sensitive) assert.ok(!output.includes(value), 'redaction leaked a fixture value');
  assert.equal(statSync(dirname(h.statePath)).mode & 0o777, 0o700);
  assert.equal(statSync(h.statePath).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dirname(h.statePath)), ['state.json']);
  assert.equal(h.cli('--once', '--sources', 'fixture').status, 0);
  assert.equal(creates(h).length, 1);
  assert.equal(statSync(join(dirname(h.statePath), 'run.lock')).mode & 0o777, 0o600);
  for (const key of ['ticket', 'board', 'firstSeen', 'lastSeen', 'total', 'lastActivityAt']) assert.ok(key in Object.values(h.state().fingerprints)[0]);
}));

check('tickets', 'adopts Normal, Archive and Deleted, searches all statuses and paginates', async () => {
  for (const status of ['Normal', 'Archive', 'Deleted']) await withHarness(async h => {
    const fp = fingerprint('web', event().message, event().route);
    h.remote([{ ticketNumber: 'HTPR-777', projectId: 15, status, description: `<p>error-fingerprint:${fp}</p>` }]);
    h.config({ pages: true });
    h.events([event()]);
    await h.run();
    assert.equal(creates(h).length, 0);
    assert.equal(h.state().fingerprints[fp].ticket, 'HTPR-777');
    assert.equal(h.state().fingerprints[fp].deleted, status === 'Deleted');
    assert.equal(activities(h, 'HTPR-777').length, status === 'Deleted' ? 0 : 1);
    const queries = h.calls().filter(c => c.name === 'ht').map(c => new URL(c.args[1], 'https://fake.invalid').searchParams);
    assert.deepEqual([...new Set(queries.map(q => q.get('status')))], ['Normal', 'Archive', 'Deleted']);
    assert.ok(queries.every(q => q.get('projectId') === '15' && q.get('search') === `error-fingerprint:${fp}`));
    assert.ok(queries.some(q => q.get('offset') === '100'));
    h.events([event({ ts: new Date(NOW + HOUR).toISOString() })]);
    await h.run({ now: NOW + HOUR });
    assert.equal(h.state().fingerprints[fp].total, 2);
    assert.equal(activities(h, 'HTPR-777').length, status === 'Deleted' ? 0 : 1);
  });
});

check('tickets', 'routes 4060 to live Backlog, falls back to Todo and refuses absent intake', async () => {
  for (const title of ['Backlog', 'To Do', 'Todo']) await withHarness(async h => {
    h.events([event({ board: 4060 })]);
    h.config({ sections: [{ id: 1, section_title: 'Backlog', projectId: 4060, deleted: true }, { id: 2, section_title: title, projectId: 4060, deleted: false }] });
    await h.run();
    const args = creates(h)[0].args;
    assert.equal(args[args.indexOf('--project') + 1], '4060');
    assert.equal(args[args.indexOf('--section') + 1], '2');
    assert.ok(h.calls().some(c => c.name === 'ht' && c.args[1] === '/mcp/projects/4060/sections'));
  });
  await withHarness(async h => { h.events([event({ board: 4060 })]); h.config({ sections: [] }); await h.run(); assert.equal(creates(h).length, 0); assert.equal(Object.keys(h.state().pending).length, 1); });
});

check('tickets', 'activity aggregates six hours, retries failures and throttles per ticket', () => withHarness(async h => {
  h.events([event()]); await h.run();
  const ticket = Object.values(h.state().fingerprints)[0].ticket;
  h.events([event({ count: 2, ts: new Date(NOW + HOUR).toISOString() })]); await h.run({ now: NOW + HOUR });
  assert.equal(activities(h, ticket).length, 0);
  h.events([event({ count: 3, ts: new Date(NOW + 6 * HOUR).toISOString() })]);
  h.config({ activityFail: true }); await h.run({ now: NOW + 6 * HOUR });
  assert.equal(h.state().activities[ticket].count, 5);
  h.config({}); h.events([]); await h.run({ now: NOW + 6 * HOUR + 1000 });
  assert.match(activities(h, ticket).at(-1).args[3], /^5 more since .*?, 6 total, last seen /);
  assert.equal(h.state().activities[ticket].count, 0);
  h.events([event({ ts: new Date(NOW + 7 * HOUR).toISOString() })]); await h.run({ now: NOW + 7 * HOUR });
  assert.equal(activities(h, ticket).length, 2);
}));

check('tickets', 'different fingerprints sharing a ticket get one activity per six hours', () => withHarness(async h => {
  const a = event();
  const b = event({ message: 'Upload failure', route: '/uploads' });
  const fpa = fingerprint(a.service, a.message, a.route);
  const fpb = fingerprint(b.service, b.message, b.route);
  h.remote([{ ticketNumber: 'HTPR-777', projectId: 15, status: 'Normal', description: `<p>error-fingerprint:${fpa}</p><p>error-fingerprint:${fpb}</p>` }]);
  h.events([a, b]); await h.run();
  assert.equal(activities(h, 'HTPR-777').length, 1);
  assert.match(activities(h, 'HTPR-777')[0].args[3], /^2 more since .*?, 2 total,/);
  h.events([a, b].map(item => ({ ...item, ts: new Date(NOW + HOUR).toISOString() })));
  await h.run({ now: NOW + HOUR });
  assert.equal(activities(h, 'HTPR-777').length, 1);
  h.events([]); await h.run({ now: NOW + 6 * HOUR });
  assert.equal(activities(h, 'HTPR-777').length, 2);
  assert.match(activities(h, 'HTPR-777')[1].args[3], /^2 more since .*?, 4 total,/);
}));

check('tickets', 'real CLI runs are serialized and concurrent ticks create one ticket', () => withHarness(async h => {
  h.events([event({ ts: new Date(Date.now() - 1000).toISOString() })]);
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, '--once', '--sources', 'fixture'], { env: h.env, stdio: 'ignore' });
    child.on('error', reject); child.on('exit', resolve);
  });
  const statuses = await Promise.all([run(), run(), run()]);
  assert.ok(statuses.includes(0)); assert.ok(statuses.every(status => status === 0 || status === 1));
  assert.equal(creates(h).length, 1);
  assert.equal(Object.values(h.state().fingerprints)[0].total, 1);
}));

check('tickets', 'negative control rejects a known-group data-loss mutation', () => withHarness(async h => {
  const directory = join(h.home, 'mutant'); mkdirSync(directory);
  const source = readFileSync(SCRIPT, 'utf8');
  const old = 'const known = state.fingerprints[fp];';
  assert.equal(source.split(old).length - 1, 1);
  writeFileSync(join(directory, 'collector.mjs'), source.replace(old, 'const known = undefined;'));
  writeFileSync(join(directory, 'io.mjs'), readFileSync(join(HERE, 'io.mjs')));
  writeFileSync(join(directory, 'noise.json'), readFileSync(join(HERE, 'noise.json')));
  writeFileSync(join(directory, 'incident.mjs'), readFileSync(join(HERE, 'incident.mjs')));
  const mutant = await import(pathToFileURL(join(directory, 'collector.mjs')));
  h.events([event()]); await mutant.collect({ env: h.env, now: NOW, sources: [fixture] });
  h.events([event({ ts: new Date(NOW + HOUR).toISOString() })]);
  await mutant.collect({ env: h.env, now: NOW + HOUR, sources: [fixture] });
  assert.throws(() => assert.equal(Object.values(h.state().fingerprints)[0].total, 2));
}));

check('tickets', 'ambiguous or malformed receipt reconciles without duplicate; failed reads fail closed', async () => {
  for (const flag of ['ambiguousCreate', 'badReceipt']) await withHarness(async h => {
    h.events([event()]); h.config({ [flag]: true }); await h.run();
    assert.equal(Object.keys(h.state().pending).length, 1);
    h.config({}); await h.run({ now: NOW + 1000 });
    assert.equal(creates(h).length, 1);
    assert.equal(Object.keys(h.state().pending).length, 0);
  });
  for (const flag of ['searchFail', 'badSearch', 'createFail']) await withHarness(async h => {
    h.events([event()]); h.config({ [flag]: true }); assert.equal(await h.run(), 0);
    assert.equal(Object.keys(h.state().pending).length, 1);
    if (flag !== 'createFail') assert.equal(creates(h).length, 0);
    h.config({}); await h.run({ now: NOW + 1000 });
    assert.equal(Object.keys(h.state().pending).length, 0);
  });
});

check('reporting', 'default rolling cap, pending counts/routes survive and exactly one hold notice per run', () => withHarness(async h => {
  const items = Array.from({ length: 7 }, (_, i) => event({ message: `failure kind ${String.fromCharCode(65 + i)}` }));
  h.events(items); await h.run();
  assert.equal(creates(h).length, 5);
  assert.equal(Object.keys(h.state().pending).length, 2);
  assert.equal(activities(h, 'YPER4-354').filter(c => c.args[3].includes('held back')).length, 1);
  h.events([event({ message: 'failure kind F', route: '/checkout/456', count: 4, ts: new Date(NOW + HOUR / 2).toISOString() })]);
  await h.run({ now: NOW + HOUR / 2 });
  assert.equal(creates(h).length, 5);
  assert.equal(Object.values(h.state().pending).find(g => g.normalized === 'failure kind F').count, 5);
  h.events([]); await h.run({ now: NOW + HOUR });
  assert.equal(creates(h).length, 7);
  assert.equal(Object.keys(h.state().pending).length, 0);
  const record = Object.values(h.state().fingerprints).find(r => r.total === 5);
  assert.ok(record);
  assert.match(creates(h)[5].description, /Count in window: 5/);
  assert.match(creates(h)[5].description, /\/checkout\/123, \/checkout\/456/);
  assert.equal(h.state().days['2026-10-14'].web.newGroups, 7);
}));

check('reporting', 'cap override including zero and invalid cap', () => withHarness(async h => {
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '0'; h.events([event()]); await h.run(); assert.equal(creates(h).length, 0);
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '1'; await h.run({ now: NOW + 1000 }); assert.equal(creates(h).length, 1);
  h.env.ERROR_COLLECTOR_HOURLY_CAP = 'invalid'; await assert.rejects(h.run());
}));

check('reporting', 'noise alert threshold plans exactly one ticket above the limit, not at it', async () => {
  for (const count of [50, 51]) await withHarness(async h => {
    h.events(Array.from({ length: count }, (_, i) => event({ service: 'vercel', message: `Warning: SECURITY WARNING: The SSL modes detail ${i}`, route: `/route/${i % 2}`, ts: new Date(NOW - 30 * 60000 + i * 1000).toISOString() })));
    const clock = join(h.home, 'clock.mjs'); writeFileSync(clock, `Date.now = () => ${NOW};`);
    h.env.NODE_OPTIONS = `--import=${clock}`;
    const planned = h.cli('--once', '--sources', 'fixture', '--dry-run');
    assert.equal(planned.status, 0, planned.stderr);
    assert.equal((planned.stdout.match(/"create"/g) ?? []).length, count > 50 ? 1 : 0);
    if (count > 50) {
      assert.match(planned.stdout, /SSL configuration warning repeated 51 times in one hour/);
      assert.match(planned.stdout, /warning on stderr/);
      assert.match(planned.stdout, /Fix it at the source/);
      assert.match(planned.stdout, /\/route\/0, \/route\/1/);
    }
    assert.equal(existsSync(h.statePath), false);
    assert.ok(h.calls().every(call => call.name === 'ht' && call.args[0] === 'GET'));
  });
});

check('reporting', 'noise alert rolling windows reject spread matches and combine collection passes without recounting', async () => {
  await withHarness(async h => {
    h.events(Array.from({ length: 120 }, (_, i) => event({ service: 'vercel', message: 'Warning: SECURITY WARNING: The SSL modes', ts: new Date(NOW - 4 * HOUR + i * 2 * 60000).toISOString() })));
    await h.run();
    assert.equal(creates(h).length, 0);
    assert.equal(h.state().days['2026-10-14'].vercel.noise, 120);
    assert.equal(h.state().days['2026-10-14'].vercel.errors, 0);
    assert.equal(h.state().days['2026-10-14'].vercel.newGroups, 0);
  });
  await withHarness(async h => {
    h.events([event({ service: 'vercel', message: 'Warning: SECURITY WARNING: The SSL modes', count: 30 })]);
    await h.run();
    assert.equal(creates(h).length, 0);
    h.events([event({ service: 'vercel', message: 'Warning: SECURITY WARNING: The SSL modes changed sample', route: '/other', count: 21, ts: new Date(NOW + HOUR / 2).toISOString() })]);
    await h.run({ now: NOW + HOUR / 2 });
    assert.equal(creates(h).length, 1);
    assert.match(creates(h)[0].description, /Occurrences in one hour: 51/);
    assert.equal(Object.values(h.state().fingerprints)[0].total, 51);
    await h.run({ now: NOW + HOUR / 2 + 1000 });
    assert.equal(Object.values(h.state().fingerprints)[0].total, 51);
    assert.equal(h.state().days['2026-10-14'].vercel.noise, 51);
    h.events([]); await h.run({ now: NOW + 2 * HOUR });
    assert.deepEqual(h.state().noiseWindows, {});
  });
  await withHarness(async h => {
    h.events([event({ service: 'vercel', message: 'Warning: SECURITY WARNING: The SSL modes', count: 30, ts: new Date(NOW - HOUR).toISOString() }), event({ service: 'vercel', message: 'Warning: SECURITY WARNING: The SSL modes', count: 21, ts: new Date(NOW).toISOString() })]);
    await h.run(); assert.equal(creates(h).length, 0);
  });
});

check('reporting', 'noise alert opt-ins are explicit, never alert expected responses or forced tests, and respect service scope', () => withHarness(async h => {
  const rules = JSON.parse(readFileSync(join(HERE, 'noise.json')));
  assert.deepEqual(rules.filter(rule => rule.alert).map(rule => rule.id), ['stripe-webhook-bad-signature', 'ssl-mode-warning', 'ai-sdk-warning', 'pg-query-deprecation', 'url-parse-deprecation', 'aws-sdk-v2-note', 'console-time-warning', 'qstash-cancel-404']);
  const messages = ['HTTP 404', 'Authenticated agents cannot archive or delete tasks in Done', 'Warning: SECURITY WARNING: The SSL modes [ht-forced-test]', 'AbortError'];
  h.events(messages.map(message => event({ service: 'vercel', message, count: 500 })));
  await h.run();
  assert.equal(creates(h).length, 0);
  assert.deepEqual(h.state().pending, {});
  assert.deepEqual(h.state().noiseWindows, {});
  h.events([event({ service: 'other', message: 'Warning: SECURITY WARNING: The SSL modes', ts: new Date(NOW + 1000).toISOString() })]);
  await h.run({ now: NOW + 1000 });
  assert.equal(creates(h).length, 1);
  assert.match(creates(h)[0].description, /Count in window: 1/);
}));

check('reporting', 'noise alert second run reuses its ticket via activity, and cold state adopts the exact marker', () => withHarness(async h => {
  h.events([event({ service: 'vercel', message: 'Warning: SECURITY WARNING: The SSL modes', count: 51 })]);
  await h.run();
  const fp = createHash('sha256').update('noise|vercel|ssl-mode-warning').digest('hex').slice(0, 16);
  assert.equal(Object.keys(h.state().fingerprints)[0], fp);
  const ticket = h.state().fingerprints[fp].ticket;
  h.events([event({ service: 'vercel', message: 'Warning: SECURITY WARNING: The SSL modes different details', route: '/new-route', count: 60, ts: new Date(NOW + 6 * HOUR).toISOString() })]);
  await h.run({ now: NOW + 6 * HOUR });
  assert.equal(creates(h).length, 1);
  assert.equal(activities(h, ticket).length, 1);
  assert.match(activities(h, ticket)[0].args[3], /^60 more since .*?, 111 total,/);
  assert.match(activities(h, ticket)[0].args[3], /\/new-route/);
  rmSync(h.statePath);
  await h.run({ now: NOW + 6 * HOUR });
  assert.equal(creates(h).length, 1);
  assert.equal(activities(h, ticket).length, 2);
  assert.ok(h.calls().filter(call => call.name === 'ht').every(call => call.args[1].includes(`error-fingerprint%3A${fp}`)));
}));

check('reporting', 'noise alert overrides, pending cap, retry reconciliation and sample redaction', async () => {
  await withHarness(async h => {
    h.env.ERROR_COLLECTOR_NOISE_HOURLY_LIMIT = '100';
    h.events([event({ service: 'vercel', message: 'Warning: SECURITY WARNING: The SSL modes', count: 51 })]);
    await h.run(); assert.equal(creates(h).length, 0);
    h.env.ERROR_COLLECTOR_NOISE_HOURLY_LIMIT = 'invalid'; await assert.rejects(h.run());
  });
  await withHarness(async h => {
    h.env.ERROR_COLLECTOR_NOISE_HOURLY_LIMIT = '1'; h.env.ERROR_COLLECTOR_HOURLY_CAP = '0';
    h.events([event({ service: 'vercel', message: 'Warning: SECURITY WARNING: The SSL modes password=fixture-password', route: '/safe?token=fixture-token', stack: 'Authorization: Basic fixture-credential', count: 2 })]);
    await h.run();
    assert.equal(creates(h).length, 0); assert.equal(Object.keys(h.state().pending).length, 1);
    h.env.ERROR_COLLECTOR_HOURLY_CAP = '1'; h.config({ ambiguousCreate: true });
    await h.run({ now: NOW + 1000 });
    assert.equal(creates(h).length, 1); assert.equal(Object.keys(h.state().pending).length, 1);
    h.config({}); await h.run({ now: NOW + 2000 });
    assert.equal(creates(h).length, 1); assert.deepEqual(h.state().pending, {});
    const text = JSON.stringify(h.calls()) + readFileSync(h.statePath, 'utf8');
    for (const value of ['fixture-password', 'fixture-token', 'fixture-credential']) assert.ok(!text.includes(value));
    assert.match(creates(h)[0].description, /Redacted sample/);
  });
  await withHarness(async h => {
    h.events([event({ service: 'vercel', message: '[Upstash QStash] DELETE https://qstash.invalid/messages/fixture failed with status 404', count: 51 })]);
    await h.run(); assert.equal(creates(h).length, 1);
    assert.match(creates(h)[0].description, /QStash cancellation warning/);
    assert.equal(h.state().days['2026-10-14'].vercel.errors, 0);
  });
});

check('reporting', 'noise alert each opted-in warning uses its own rule fingerprint, not an ordinary error group', () => withHarness(async h => {
  const messages = [
    'Warning: SECURITY WARNING: The SSL modes',
    'Warning: AI SDK Warning: unsupported setting',
    'DeprecationWarning: Calling client.query() when the client is already executing a query',
    'DeprecationWarning: `url.parse()` behavior is not standardized',
    'NOTE: The AWS SDK for JavaScript (v2) has reached end-of-support',
    "Warning: Label 'fixture' already exists for console.time()",
    '[Upstash QStash] DELETE https://qstash.invalid/messages/fixture failed with status 404',
  ];
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '10';
  h.events(messages.map(message => event({ service: 'vercel', message, count: 51 })));
  await h.run();
  assert.equal(creates(h).length, messages.length);
  assert.equal(new Set(creates(h).map(call => call.description.match(/error-fingerprint:([a-f0-9]+)/)[1])).size, messages.length);
  assert.equal(h.state().days['2026-10-14'].vercel.errors, 0);
  assert.equal(h.state().days['2026-10-14'].vercel.newGroups, 0);
  assert.equal(h.state().days['2026-10-14'].vercel.noise, messages.length * 51);
}));

check('reporting', 'noise alert fingerprints cannot merge into ordinary message grouping', () => withHarness(async h => {
  h.events([event({ service: 'vercel', message: 'Warning: SECURITY WARNING: The SSL modes', count: 51 }), event({ service: 'vercel', message: 'noise-rule:ssl-mode-warning' })]);
  await h.run();
  assert.equal(creates(h).length, 2);
  assert.equal(h.state().days['2026-10-14'].vercel.errors, 1);
  assert.equal(h.state().days['2026-10-14'].vercel.newGroups, 1);
  assert.ok(h.state().fingerprints[fingerprint('vercel', 'noise-rule:ssl-mode-warning')]);
}));

check('reporting', 'noise alert dry run preserves existing state and only plans repeat activity', () => withHarness(async h => {
  h.events([event({ service: 'vercel', message: 'Warning: SECURITY WARNING: The SSL modes', count: 51 })]);
  await h.run();
  const ticket = Object.values(h.state().fingerprints)[0].ticket;
  const before = readFileSync(h.statePath);
  const callsBefore = h.calls().length;
  const clock = join(h.home, 'clock.mjs'); writeFileSync(clock, `Date.now = () => ${NOW + 6 * HOUR};`);
  h.env.NODE_OPTIONS = `--import=${clock}`;
  h.events([event({ service: 'vercel', message: 'Warning: SECURITY WARNING: The SSL modes', count: 51, ts: new Date(NOW + 6 * HOUR).toISOString() })]);
  const result = h.cli('--once', '--sources', 'fixture', '--dry-run');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes('"create"'));
  assert.ok(result.stdout.includes(`"activity","add","${ticket}"`));
  assert.deepEqual(readFileSync(h.statePath), before);
  assert.deepEqual(readdirSync(dirname(h.statePath)), ['state.json']);
  assert.ok(h.calls().slice(callsBefore).every(call => call.name === 'ht' && call.args[0] === 'GET'));
}));

check('reporting', 'noise alert fixture dry run prints the planned ticket for 120 SSL warnings without writing', () => withHarness(async h => {
  const clock = join(h.home, 'clock.mjs'); writeFileSync(clock, `Date.now = () => ${NOW};`);
  h.env.NODE_OPTIONS = `--import=${clock}`;
  const rows = Array.from({ length: 120 }, (_, i) => event({ service: 'vercel', message: 'Warning: SECURITY WARNING: The SSL modes require explicit configuration', route: '/api/fixture', stack: '', ts: new Date(NOW - 30 * 60000 + i * 1000).toISOString() }));
  h.events(rows);
  assert.equal(rows.reduce((sum, row) => sum + (row.count ?? 1), 0), 120);
  assert.ok(Date.parse(rows.at(-1).ts) - Date.parse(rows[0].ts) < HOUR);
  const result = h.cli('--once', '--sources', 'fixture', '--dry-run');
  assert.equal(result.status, 0, result.stderr);
  assert.equal((result.stdout.match(/"create"/g) ?? []).length, 1);
  assert.match(result.stdout, /SSL configuration warning repeated 120 times in one hour/);
  assert.match(result.stdout, /Occurrences in one hour: 120/);
  assert.match(result.stdout, /"errors":0,"noise":120,"newGroups":0/);
  assert.equal(existsSync(dirname(h.statePath)), false);
  assert.ok(h.calls().every(call => call.name === 'ht' && call.args[0] === 'GET'));
  console.log(result.stdout.trim());
  console.log('SSL fixture planned ticket verified');
}));

check('reporting', 'a rejected Stripe webhook signature is noise, so one probe files no ticket', () => withHarness(async h => {
  const messages = [
    '[stripe-webhook] signature verification failed: No signatures found matching the expected signature for payload. Are you passing the raw request body you received from Stripe?',
    '[stripe-webhook] signature verification failed: Unable to extract timestamp and signatures from header',
  ];
  h.events(messages.map(message => event({ service: 'vercel', route: '/api/stripe/webhook', message })));
  await h.run();
  assert.equal(creates(h).length, 0);
  assert.equal(activities(h).length, 0);
  assert.equal(h.state().days['2026-10-14'].vercel.noise, 2);
  assert.equal(h.state().days['2026-10-14'].vercel.errors, 0);
}));

check('reporting', 'noise counted per service and day, no tickets; daily summary once after 06 or forced', () => withHarness(async h => {
  const noise = [event({ route: '/wp-admin/' }), event({ route: '/.env' }), event({ route: '/index.php' }), event({ message: 'AbortError' }), event({ message: 'request aborted' }), event({ message: 'HTTP 401' }), event({ message: 'status: 403' }), event({ message: '404 Not Found', service: 'api' })];
  h.events(noise); await h.run(); assert.equal(creates(h).length, 0); assert.equal(activities(h).length, 0);
  assert.equal(h.state().days['2026-10-14'].web.noise, 7);
  h.events([event({ message: 'Unexpected internal 500 error', count: 2, ts: new Date(NOW + 1000).toISOString() })]);
  await h.run({ now: NOW + 1000 });
  assert.equal(creates(h).length, 1);
  assert.equal(activities(h, 'YPER4-354').length, 0);
  h.events([]); await h.run({ now: NOW + DAY, summary: true });
  assert.ok(activities(h).some(c => c.args[3] === 'web on 2026-10-14: 2 errors (2026-10-13: no complete data), 1 new kinds, 7 noise'));
  const posted = activities(h, 'YPER4-354').length;
  await h.run({ now: NOW + DAY + 2 * HOUR }); await h.run({ now: NOW + DAY + 2 * HOUR, summary: true });
  assert.equal(activities(h, 'YPER4-354').length, posted);
  await h.run({ now: NOW + 2 * DAY + 2 * HOUR });
  assert.ok(activities(h).some(c => c.args[3] === 'web on 2026-10-15: 0 errors (2026-10-14: 2), 0 new kinds, 0 noise'));
}));

check('reporting', 'errors marked [ht-forced-test] are skipped for every source, unmarked ones still file (YPER4-384)', () => withHarness(async h => {
  h.events([
    event({ message: 'Error: [ht-forced-test] YPER4-384 forced server test 1' }),
    event({ service: 'browser', message: 'Error: [ht-forced-test] YPER4-384 forced browser test 2' }),
    event({ service: 'github-actions', board: 4060, route: '', message: 'Smoke failed [ht-forced-test]' }),
    event({ message: 'Error: YPER4-377 forced browser test 3' }),
  ]);
  await h.run();
  assert.equal(creates(h).length, 1);
  assert.equal(h.state().days['2026-10-14'].web.noise, 1);
  assert.equal(h.state().days['2026-10-14'].browser.noise, 1);
  assert.equal(h.state().days['2026-10-14']['github-actions'].noise, 1);
  assert.equal(h.state().days['2026-10-14'].web.errors, 1);
}));

check('reporting', 'CLI reports named HtForcedTest are skipped, a real CLI error still files (YPER4-396)', () => withHarness(async h => {
  const cli = { service: 'cli', board: 15, route: '/api/mcp/cli-error' };
  h.events([
    event({ ...cli, message: '[cli-error] task get: HtForcedTest (HTTP 502)' }),
    event({ ...cli, message: '[cli-error] task create: HtForcedTest' }),
    event({ ...cli, message: '[cli-error] task get: HtForcedTestX (HTTP 502)' }),
    event({ ...cli, message: '[cli-error] task get: ServerError (HTTP 502)' }),
  ]);
  await h.run();
  assert.equal(creates(h).length, 2);
  assert.equal(h.state().days['2026-10-14'].cli.noise, 2);
  assert.equal(h.state().days['2026-10-14'].cli.errors, 2);
}));

check('reporting', 'outside PR guard dry runs are noise, other workflow failures are errors (YPER4-364)', () => withHarness(async h => {
  const ci = { service: 'github-actions', board: 4060, route: '', stack: 'https://github.com/hypertask-ai/hypertask/actions/runs/1' };
  h.events([event({ ...ci, message: 'Outside PR guard failed: outside-pr-guard' }), event({ ...ci, message: 'CI Tests failed: browser-smoke' })]);
  await h.run();
  assert.equal(creates(h).length, 1);
  assert.equal(h.state().days['2026-10-14']['github-actions'].noise, 1);
  assert.equal(h.state().days['2026-10-14']['github-actions'].errors, 1);
}));

check('reporting', 'an SSH client hanging up is noise, other sshd failures are errors (YPER4-406)', () => withHarness(async h => {
  const vps = { service: 'vps-journal', board: 4060, route: 'ssh.service', stack: '' };
  h.events([event({ ...vps, message: 'ssh.service: fatal: ssh_packet_send_debug: send DEBUG: Broken pipe' }), event({ ...vps, message: 'ssh.service: error: bind [127.0.0.1]:7979: Address already in use' })]);
  await h.run();
  assert.equal(creates(h).length, 1);
  assert.equal(h.state().days['2026-10-14']['vps-journal'].noise, 1);
  assert.equal(h.state().days['2026-10-14']['vps-journal'].errors, 1);
}));

check('reporting', 'SSH client resets under session scopes are noise, real failures still file (YPER4-450)', () => withHarness(async h => {
  const vps = { service: 'vps-journal', board: 4060, stack: '' };
  h.events([
    event({ ...vps, route: 'session-924033.scope', message: 'session-924033.scope: fatal: ssh_packet_send_debug: send DEBUG: Connection reset by peer' }),
    event({ ...vps, route: 'ssh.service', message: 'ssh.service: fatal: ssh_packet_send_debug: send DEBUG: Connection reset by peer' }),
    event({ ...vps, route: 'session-123.scope', message: 'session-123.scope: fatal: ssh_packet_send_debug: send DEBUG: Broken pipe' }),
    event({ ...vps, route: 'session-123.scope', message: 'session-123.scope: error: bind [127.0.0.1]:7979: Address already in use' }),
    event({ ...vps, route: 'database.service', message: 'database.service: fatal: ssh_packet_send_debug: send DEBUG: Connection reset by peer' }),
    event({ service: 'vercel', message: 'session-924033.scope: fatal: ssh_packet_send_debug: send DEBUG: Connection reset by peer' }),
  ]);
  await h.run();
  assert.equal(creates(h).length, 3);
  assert.equal(h.state().days['2026-10-14']['vps-journal'].noise, 3);
  assert.equal(h.state().days['2026-10-14']['vps-journal'].errors, 2);
  assert.equal(h.state().days['2026-10-14'].vercel.errors, 1);
}));

check('reporting', 'a one-shot gate observer exiting 1 on purpose is noise, other failed units still file (YPER4-833)', () => withHarness(async h => {
  const vps = { service: 'vps-journal', board: 4060, route: 'init.scope', stack: '' };
  const failed = unit => `init.scope: Failed to start ${unit} - /usr/bin/bash /home/valentin/projects/ceo/runs/IGSH-976/observe-once.sh.`;
  h.events([
    event({ ...vps, message: failed('igsh976-observe-180200.service') }),
    event({ ...vps, message: failed('igsh976-observe-181819.service') }),
    event({ ...vps, message: failed('igsh976-collect-180200.service') }),
    event({ ...vps, message: failed('error-collector.service') }),
    event({ service: 'vercel', message: failed('igsh976-observe-180200.service') }),
  ]);
  await h.run();
  assert.equal(creates(h).length, 3);
  assert.equal(h.state().days['2026-10-14']['vps-journal'].noise, 2);
  assert.equal(h.state().days['2026-10-14']['vps-journal'].errors, 2);
  assert.equal(h.state().days['2026-10-14'].vercel.errors, 1);
}));

check('reporting', 'SSH daemon identifier fallback ignores client resets but retains genuine failures (YPER4-541)', () => withHarness(async h => {
  const row = (message, overrides = {}) => JSON.stringify({ SYSLOG_IDENTIFIER: 'sshd', MESSAGE: message, __REALTIME_TIMESTAMP: String((NOW - 1000) * 1000), ...overrides });
  const events = journal.parseJournal([
    row('fatal: ssh_packet_send_debug: send DEBUG: Connection reset by peer'),
    row('fatal: ssh_packet_send_debug: send DEBUG: Broken pipe'),
    row('error: bind [127.0.0.1]:7979: Address already in use'),
    row('fatal: ssh_packet_send_debug: send DEBUG: Permission denied'),
    row('fatal: ssh_packet_send_debug: send DEBUG: Connection reset by peer', { SYSLOG_IDENTIFIER: 'database' }),
    row('fatal: ssh_packet_send_debug: send DEBUG: Connection reset by peer', { _SYSTEMD_UNIT: 'sshd.service' }),
  ].join('\n'));
  h.events(events);
  await h.run();
  assert.equal(creates(h).length, 3);
  assert.equal(h.state().days['2026-10-14']['vps-journal'].noise, 3);
  assert.equal(h.state().days['2026-10-14']['vps-journal'].errors, 3);
  assert.ok(creates(h).some(call => call.description.includes('Address already in use')));
  assert.ok(creates(h).some(call => call.description.includes('Permission denied')));
  assert.ok(creates(h).some(call => call.description.includes('database: fatal: ssh_packet_send_debug')));
}));

check('reporting', 'PowerShell shutdown cancellation is noise, genuine pipe failures still file', () => withHarness(async h => {
  const message = 'run-u2003644.scope: (7.6.7:C:80) [NamedPipeIPC_ServerListenerError:NamedPipe.Exception.Error] An error has occurred in PowerShell IPC listening thread on process: 1990196 in AppDomain: None.  Error Message: Operation canceled.';
  const vps = { service: 'vps-journal', board: 4060, route: 'run-u2003644.scope', stack: '' };
  h.events([
    event({ ...vps, message }),
    event({ ...vps, message: message.replace('run-u2003644.scope', 'run-r1b66062f07d0426abf597f7579b30ec8.scope') }),
    event({ ...vps, message: message.replace('Operation canceled.', 'Access denied.') }),
    event({ ...vps, message: message.replace('Operation canceled.', 'Operation canceled. Unexpected failure.') }),
    event({ ...vps, message: `${message}\nAccess denied.` }),
    event({ ...vps, route: 'worker.service', message: message.replace('run-u2003644.scope', 'worker.service') }),
    event({ ...vps, service: 'vercel', message }),
  ]);
  assert.equal(await h.run(), 0);
  assert.equal(h.state().days['2026-10-14']['vps-journal'].noise, 2);
  assert.equal(h.state().days['2026-10-14']['vps-journal'].errors, 4);
  assert.equal(h.state().days['2026-10-14'].vercel.errors, 1);
  assert.equal(creates(h).length, 5);
  assert.ok(creates(h).some(call => call.description.includes('Access denied.')));
}));

check('reporting', 'upstream resets are errors, client resets remain noise', () => withHarness(async h => {
  h.events([event({ message: 'database ECONNRESET' }), event({ message: 'client request ECONNRESET' })]);
  await h.run();
  assert.equal(creates(h).length, 1);
  assert.equal(h.state().days['2026-10-14'].web.errors, 1);
  assert.equal(h.state().days['2026-10-14'].web.noise, 1);
}));

check('reporting', 'spike threshold, delivery target/id and fallback log; counts retained fourteen days', async () => {
  for (const count of [49, 50, 60, 61]) await withHarness(async h => {
    const state = { version: 1, sources: {}, fingerprints: {}, pending: {}, activities: {}, created: [], summaries: {}, days: {} };
    for (let i = 1; i <= 16; i++) state.days[new Date(NOW - i * DAY).toISOString().slice(0, 10)] = { web: { errors: 20, noise: 0, newGroups: 0, complete: true } };
    for (const date of Object.keys(state.days)) state.summaries[date] = { web: true, fixture: true };
    state.sources.fixture = new Date(NOW).toISOString();
    state.coverage = { fixture: { since: '2026-10-01T00:00:00.000Z', until: state.sources.fixture, services: ['fixture', 'web'] } };
    h.seed(state); h.events([event({ count, ts: new Date(NOW + 1000).toISOString() })]); await h.run({ now: NOW + DAY, summary: true });
    const deliveries = h.calls().filter(c => c.name === 'runner-deliver');
    assert.equal(deliveries.length, count > 60 ? 1 : 0);
    if (deliveries.length) { assert.deepEqual(deliveries[0].args, ['ht-product-lead']); assert.equal(deliveries[0].id, 'error-collector:2026-10-14:web'); assert.match(deliveries[0].input, /SPIKE/); }
    assert.equal(Object.keys(h.state().days).length, 14);
    assert.ok(h.state().days['2026-10-02']); assert.equal(h.state().days['2026-10-01'], undefined);
  });
  await withHarness(async h => {
    await h.run({ now: NOW - DAY });
    await h.run();
    rmSync(join(h.home, 'bin/runner-deliver')); h.events([event({ service: 'fixture', count: 50, ts: new Date(NOW + 1000).toISOString() })]); await h.run({ now: NOW + DAY, summary: true });
    const path = join(dirname(h.statePath), 'spikes.log'); assert.match(readFileSync(path, 'utf8'), /SPIKE.*fixture on 2026-10-14: 50 errors/); assert.equal(statSync(path).mode & 0o777, 0o600);
  });
});

check('reporting', 'dry-run plans create/activity/summary/spike and never changes state or performs writes', () => withHarness(async h => {
  const clock = join(h.home, 'dry-clock.mjs');
  writeFileSync(clock, `Date.now = () => ${NOW};`);
  h.env.NODE_OPTIONS = `--import=${clock}`;
  h.seed({ version: 1, sources: { fixture: '2026-10-13T05:00:00.000Z' }, coverage: { fixture: { since: '2026-10-12T00:00:00.000Z', until: '2026-10-13T05:00:00.000Z', services: ['fixture', 'web'] } }, fingerprints: {}, pending: {}, activities: {}, created: [], summaries: {}, days: { '2026-10-12': { web: { errors: 0, noise: 0, newGroups: 0, complete: true } } } });
  const initial = readFileSync(h.statePath);
  h.events([event({ count: 50, ts: new Date(NOW - DAY + HOUR).toISOString() }), event({ message: 'Fresh dry-run failure' })]);
  const result = h.cli('--once', '--sources', 'fixture', '--dry-run', '--summary');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DRY-RUN.*"vcc".*"create"/);
  assert.match(result.stdout, /DRY-RUN.*"activity".*"YPER4-354"/);
  assert.match(result.stdout, /DRY-RUN.*"runner-deliver"/);
  assert.ok(h.calls().every(c => c.name === 'ht' && c.args[0] === 'GET'));
  assert.deepEqual(readFileSync(h.statePath), initial);
  assert.deepEqual(readdirSync(dirname(h.statePath)), ['state.json']);
  h.events([event({ count: 50 })]);
  await h.run(); const before = readFileSync(h.statePath);
  h.events([event({ ts: new Date(NOW + 7 * HOUR).toISOString() })]);
  const callsBefore = h.calls().filter(c => c.name !== 'ht').length;
  await h.run({ now: NOW + 7 * HOUR, dryRun: true, summary: true });
  assert.deepEqual(readFileSync(h.statePath), before);
  assert.equal(h.calls().filter(c => c.name !== 'ht').length, callsBefore);
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '0';
  const held = h.cli('--dry-run', '--sources', 'fixture'); assert.equal(held.status, 0);
}));

check('reporting', 'dry-run plans one held-back notice without writes', () => withHarness(async h => {
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '0';
  h.events([event({ ts: new Date(Date.now() - 1000).toISOString() })]);
  const result = h.cli('--dry-run', '--sources', 'fixture');
  assert.equal(result.status, 0);
  assert.equal(result.stdout.split('held back').length - 1, 1);
  assert.equal(existsSync(h.statePath), false);
  assert.ok(h.calls().every(call => call.name === 'ht'));
}));

check('reporting', 'summary failure retries; secret detector rejects positive controls', () => withHarness(async h => {
  h.events([event({ count: 50 })]); h.config({ activityFail: true }); await h.run({ summary: true });
  assert.equal(h.state().summaries['2026-10-13'], undefined);
  h.config({}); h.events([]); await h.run({ now: NOW + 1000, summary: true });
  assert.equal(h.state().summaries['2026-10-13'].web, true);
  const secret = 'password=fake-secret';
  const oracle = text => assert.ok(!text.includes('fake-secret'), 'fixture secret detected');
  assert.throws(() => oracle(secret)); oracle(redact(secret));
  assert.notEqual(normalize('/users/1', true), '/users/1');
  const mutation = fingerprint('web', 'failed 42', '/users/1');
  assert.notEqual(createHash('sha256').update('web|failed 42|/users/1').digest('hex').slice(0, 16), mutation);
}));

check('tickets', 'R1: entire Authorization value is redacted for every scheme', () => withHarness(async h => {
  const credential = Buffer.from('fixture:password').toString('base64');
  for (const scheme of ['Basic', 'Bearer', 'Digest', 'Custom']) {
    const sample = `Authorization: ${scheme} ${credential} extra=value\nUseful failure`;
    assert.equal(redact(sample), 'Authorization: [redacted]\nUseful failure');
  }
  h.events([event({ message: `Failure Authorization: Basic ${credential}`, stack: `Authorization: Basic ${credential}` })]);
  await h.run();
  assert.ok(!(JSON.stringify(h.calls()) + readFileSync(h.statePath, 'utf8')).includes(credential));
}));

check('reporting', 'R5: quiet successful sources have zero-error daily coverage', () => withHarness(async h => {
  const quiet = { name: 'quiet', fetch: async () => [] };
  const bad = { name: 'broken', fetch: async () => { throw new Error('fixture failure'); } };
  await h.run({ sources: [quiet, bad] });
  assert.deepEqual(h.state().days['2026-10-13'].quiet, { errors: 0, noise: 0, newGroups: 0, complete: false });
  assert.deepEqual(h.state().days['2026-10-14'].quiet, { errors: 0, noise: 0, newGroups: 0, complete: false });
  await h.run({ sources: [quiet], now: NOW + 2 * HOUR });
  assert.ok(activities(h).some(call => call.args[3] === 'quiet on 2026-10-13: no complete data, collection did not cover the full day (partial count 0)'));
  assert.ok(!Object.values(h.state().days).some(counts => counts.broken));
}));

check('review', 'one error on a product route and an infra route keeps its first board and the source keeps reading', () => withHarness(async h => {
  h.events([event({ route: '/mcp' }), event({ route: '/sse', board: 4060 })]);
  assert.equal(await h.run(), 0);
  assert.equal(creates(h).length, 1);
  assert.equal(creates(h)[0].args[4], '15');
  h.events([event({ route: '/sse', board: 4060, ts: new Date(NOW + 1000).toISOString() })]);
  assert.equal(await h.run({ now: NOW + 2000 }), 0);
  assert.equal(creates(h).length, 1);
  assert.equal(Object.values(h.state().fingerprints)[0].total, 3);
}));

check('review', 'upstream and Prisma connection resets are errors, client disconnects stay noise', () => withHarness(async h => {
  h.events([event({ message: 'PrismaClientKnownRequestError: ECONNRESET' }), event({ message: 'upstream request ECONNRESET' }), event({ message: 'client closed request ECONNRESET' })]);
  await h.run();
  assert.equal(h.state().days['2026-10-14'].web.errors, 2);
  assert.equal(h.state().days['2026-10-14'].web.noise, 1);
}));

check('review', 'a day is summarised only after its source read past the day end, and a dead source is reported as missing', () => withHarness(async h => {
  const ok = { name: 'ok', fetch: async () => [] };
  let fail = false;
  const flaky = { name: 'flaky', fetch: async () => { if (fail) throw new Error('down'); return [{ ...event({ service: 'flaky', ts: new Date(NOW - HOUR).toISOString() }) }]; } };
  await h.run({ sources: [ok, flaky] });
  fail = true;
  await h.run({ sources: [ok, flaky], now: NOW + DAY, summary: true });
  const lines = () => activities(h, 'YPER4-354').map(call => call.args[3]);
  assert.ok(lines().some(line => line.startsWith('ok on 2026-10-14:')));
  assert.ok(!lines().some(line => line.startsWith('flaky on 2026-10-14')));
  await h.run({ sources: [ok, flaky], now: NOW + 3 * DAY, summary: true });
  assert.ok(lines().some(line => line === 'flaky on 2026-10-14: no complete data, the source kept failing (partial count 1)'));
  assert.ok(!h.calls().some(call => call.name === 'runner-deliver'));
}));

check('tickets', 'R8: known fingerprints persist routes and report bounded new routes after throttle', () => withHarness(async h => {
  h.events([event()]); await h.run();
  const fp = Object.keys(h.state().fingerprints)[0];
  const ticket = h.state().fingerprints[fp].ticket;
  assert.deepEqual(h.state().fingerprints[fp].routes, ['/checkout/123']);
  const routes = ['/new-a?secret=fixture', '/new-b', '/new-c', '/new-d', '/long/'.repeat(40)];
  h.events(routes.map(route => event({ route, ts: new Date(NOW + HOUR).toISOString() })));
  await h.run({ now: NOW + HOUR });
  assert.equal(activities(h, ticket).length, 0);
  assert.deepEqual(h.state().fingerprints[fp].routes, ['/checkout/123', ...routes.map(redact)]);
  h.events([]); h.config({ activityFail: true }); await h.run({ now: NOW + 6 * HOUR });
  h.config({}); await h.run({ now: NOW + 6 * HOUR + 1000 });
  const line = activities(h, ticket).at(-1).args[3];
  assert.match(line, /new routes: \/new-a\?secret=\[redacted\], \/new-b, \/new-c/);
  assert.ok(!line.includes('/new-d') && !line.includes('fixture'));
  h.events([event({ route: routes.at(-1) + 'y', ts: new Date(NOW + 7 * HOUR).toISOString() })]);
  await h.run({ now: NOW + 7 * HOUR });
  h.events([]); await h.run({ now: NOW + 12 * HOUR + 1000 });
  assert.ok(activities(h, ticket).at(-1).args[3].split('new routes: ')[1].length <= 120);
}));

check('reporting', 'R9: retained unsent summaries retry oldest first in three-day batches', () => withHarness(async h => {
  const dates = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
  h.seed({ version: 1, sources: {}, fingerprints: {}, pending: {}, activities: {}, created: [], summaries: {}, days: Object.fromEntries(dates.map((date, i) => [date, { web: { errors: i === 0 ? 50 : 0, noise: 0, newGroups: i + 1, complete: true } }])) });
  h.config({ activityFail: true }); await h.run({ summary: true });
  assert.deepEqual(h.state().summaries, {});
  h.config({}); await h.run({ now: NOW + DAY, summary: true });
  assert.deepEqual(Object.keys(h.state().summaries), dates.slice(0, 3));
  const lines = activities(h).filter(call => call.args[3].startsWith('web on ')).slice(-3).map(call => call.args[3]);
  assert.deepEqual(lines.map(line => Number(line.match(/(\d+) new kinds/)[1])), [1, 2, 3]);
  assert.ok(!h.calls().some(call => call.name === 'runner-deliver'));
  await h.run({ now: NOW + DAY + 1000, summary: true });
  assert.equal(h.state().summaries['2026-10-13'].web, true);
}));

check('reporting', 'R11: dry-run fixture remains deterministic in the last UTC minute', () => withHarness(async h => {
  const clock = join(h.home, 'clock.mjs');
  writeFileSync(clock, "Date.now = () => Date.parse('2026-10-14T23:59:45Z');");
  const childEnv = { ...process.env, NODE_OPTIONS: `--import=${clock}` };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--import', clock, '--test', '--test-name-pattern', 'reporting: dry-run plans create/activity/summary/spike', new URL('./collector.test.mjs', import.meta.url).pathname], { encoding: 'utf8', env: childEnv, timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}));

check('install', 'units mirror precedent, installer copies modules/noise and fake systemctl enables user timer', () => withHarness(async h => {
  h.env.USER_UNIT_CHECK = '/usr/bin/true';
  assert.ok(readdirSync(join(HERE, 'sources')).includes('fixture.mjs'));
  assert.match(readFileSync(join(HERE, 'README.md'), 'utf8'), /Backlog, section 10414/);
  const service = readFileSync(join(HERE, '../error-collector.service'), 'utf8');
  const timer = readFileSync(join(HERE, '../error-collector.timer'), 'utf8');
  assert.ok(service.match(/Environment="PATH=([^"]+)"/)[1].split(':').includes('%h/.local/lib/hypertask/runner-pickup'));
  assert.match(service, /Type=oneshot/); assert.match(service, /UMask=0077/);
  assert.match(service, /\/usr\/bin\/flock --nonblock %h\/\.local\/state\/error-collector\/timer.lock/);
  assert.match(service, /%h\/\.local\/lib\/hypertask\/error-collector\/collector.mjs --once/);
  assert.match(timer, /OnCalendar=\*:0\/15/); assert.match(timer, /Persistent=true/);
  const result = h.cli('--install'); assert.equal(result.status, 0, result.stderr);
  const target = join(h.home, '.local/lib/hypertask/error-collector');
  for (const name of ['collector.mjs', 'noise.json', 'sources/fixture.mjs']) assert.deepEqual(readFileSync(join(target, name)), readFileSync(join(HERE, name)));
  assert.equal(statSync(join(target, 'collector.mjs')).mode & 0o777, 0o755);
  for (const suffix of ['service', 'timer']) assert.deepEqual(readFileSync(join(h.home, `.config/systemd/user/error-collector.${suffix}`)), readFileSync(join(HERE, `../error-collector.${suffix}`)));
  assert.deepEqual(h.calls().filter(c => c.name === 'systemctl').map(c => c.args), [['--user', 'daemon-reload'], ['--user', 'enable', '--now', 'error-collector.timer']]);
  assert.equal(h.cli('--install', '--dry-run').status, 1);
  const installed = spawnSync(process.execPath, [join(target, 'collector.mjs'), '--install'], { env: h.env, encoding: 'utf8' }); assert.equal(installed.status, 0, installed.stderr);
  h.config({ installFail: true }); assert.equal(h.cli('--install').status, 1);
}));

check('reporting', 'summary-only events are counted but never searched, ticketed or fingerprinted', () => withHarness(async h => {
  h.events([event({ service: 'posthog', ticket: false, count: 7 }), event({ service: 'posthog', ticket: false, board: 4060, count: 2 })]);
  await h.run({ summary: true });
  assert.equal(creates(h).length, 0);
  assert.equal(h.calls().filter(call => call.name === 'ht').length, 0);
  assert.deepEqual(h.state().fingerprints, {});
  assert.deepEqual(h.state().pending, {});
  assert.equal(h.state().days['2026-10-14'].posthog.errors, 9);
  assert.equal(h.state().days['2026-10-14'].posthog.newGroups, 0);
  h.events([]); await h.run({ now: NOW + DAY, summary: true });
  assert.ok(activities(h).some(call => call.args[3] === 'posthog on 2026-10-14: 9 errors (2026-10-13: no complete data), 0 new kinds, 0 noise'));
}));

check('followups', 'delivery uses the installed runner-pickup PATH and HT Product Lead alias', () => withHarness(async h => {
  const unit = readFileSync(join(HERE, '../error-collector.service'), 'utf8');
  const path = unit.match(/Environment="PATH=([^"]+)"/)[1];
  assert.ok(path.split(':').includes('%h/.local/lib/hypertask/runner-pickup'));
  const installed = join(h.home, '.local/lib/hypertask/runner-pickup');
  mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, 'runner-deliver'), fake, { mode: 0o755 });
  rmSync(join(h.home, 'bin/runner-deliver'));
  h.env.PATH += ':' + path.replaceAll('%h', h.home);
  await h.run({ now: NOW - DAY });
  await h.run();
  h.events([event({ service: 'fixture', ticket: false, count: 50, ts: new Date(NOW + HOUR).toISOString() })]);
  await h.run({ now: NOW + DAY, summary: true });
  const deliveries = h.calls().filter(call => call.name === 'runner-deliver');
  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0].args, ['ht-product-lead']);
  assert.equal(deliveries[0].id, 'error-collector:2026-10-14:fixture');
  assert.match(deliveries[0].input, /^SPIKE 2026-10-14 fixture/);
  assert.equal(existsSync(join(dirname(h.statePath), 'spikes.log')), false);
  const deliver = readFileSync(join(HERE, '../runner-deliver'), 'utf8');
  assert.match(deliver, /\[ "\$n" != ht-product-lead \] \|\| n=infra-manager/);
  assert.match(deliver, /infra-manager\|HT Product Lead\|0/);
}));

check('followups', 'baseline rejects first-run, partial and legacy days, then detects a real spike', () => withHarness(async h => {
  h.events([event({ service: 'fixture', ticket: false, count: 1134, ts: '2026-10-13T12:00:00Z' })]);
  await h.run({ summary: true });
  assert.equal(h.state().days['2026-10-13'].fixture.complete, false);
  assert.ok(!h.calls().some(call => call.name === 'runner-deliver'));
  assert.equal(existsSync(join(dirname(h.statePath), 'spikes.log')), false);
  h.events([event({ service: 'fixture', ticket: false, count: 200, ts: '2026-10-14T12:00:00Z' })]);
  await h.run({ now: NOW + DAY, summary: true });
  assert.equal(h.state().days['2026-10-14'].fixture.complete, true);
  assert.ok(!h.calls().some(call => call.name === 'runner-deliver'));
  h.events([event({ service: 'fixture', ticket: false, count: 1000, ts: '2026-10-15T12:00:00Z' })]);
  await h.run({ now: NOW + 2 * DAY, summary: true });
  assert.equal(h.calls().filter(call => call.name === 'runner-deliver').length, 1);
  assert.match(h.calls().find(call => call.name === 'runner-deliver').input, /2026-10-14: 200/);
  await withHarness(async fresh => {
    fresh.events([event({ service: 'fixture', ticket: false, count: 1134, ts: '2026-10-13T12:00:00Z' })]);
    await fresh.run({ now: Date.parse('2026-10-14T00:00:00Z'), summary: true });
    assert.equal(fresh.state().days['2026-10-13'].fixture.complete, true);
    assert.ok(!fresh.calls().some(call => call.name === 'runner-deliver'));
    const state = fresh.state();
    delete state.coverage;
    delete state.days['2026-10-13'].fixture.complete;
    state.days['2026-10-13'].fixture.errors = 0;
    fresh.seed(state);
    fresh.events([event({ service: 'fixture', ticket: false, count: 50, ts: '2026-10-14T12:00:00Z' })]);
    await fresh.run({ now: Date.parse('2026-10-15T00:00:00Z'), summary: true });
    assert.equal(fresh.state().days['2026-10-14'].fixture.complete, true);
    assert.ok(!fresh.calls().some(call => call.name === 'runner-deliver'));
  });
}));

check('followups', 'outage marks every skipped day incomplete and recovers a real baseline', () => withHarness(async h => {
  await h.run({ now: NOW - DAY });
  await h.run();
  assert.equal(h.state().days['2026-10-13'].fixture.complete, true);
  h.events([event({ service: 'fixture', ticket: false, count: 100, ts: '2026-10-17T12:00:00Z' })]);
  await h.run({ now: NOW + 4 * DAY, summary: true });
  const days = h.state().days;
  assert.equal(days['2026-10-13'].fixture.complete, true);
  for (const date of ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']) assert.equal(days[date].fixture.complete, false, date);
  assert.ok(!h.calls().some(call => call.name === 'runner-deliver'));
  h.events([event({ service: 'fixture', ticket: false, count: 200, ts: '2026-10-18T12:00:00Z' })]);
  await h.run({ now: NOW + 5 * DAY, summary: true });
  assert.equal(h.state().days['2026-10-18'].fixture.complete, true);
  assert.ok(!h.calls().some(call => call.name === 'runner-deliver'));
  h.events([event({ service: 'fixture', ticket: false, count: 1000, ts: '2026-10-19T12:00:00Z' })]);
  await h.run({ now: NOW + 6 * DAY, summary: true });
  const deliveries = h.calls().filter(call => call.name === 'runner-deliver');
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].id, 'error-collector:2026-10-19:fixture');
}));

check('followups', 'journal classifies raw status codes before normalized grouping', () => withHarness(async h => {
  const rows = ['HTTP 500', 'HTTP 401', 'HTTP 403', 'HTTP 404', 'HTTP 502', 'HTTP 401', 'Failed job 123', 'Failed job 456'].map((message, index) => ({
    _SYSTEMD_UNIT: 'api.service', MESSAGE: index === 2 ? [...Buffer.from(message)] : message,
    __REALTIME_TIMESTAMP: String((NOW - 1000 + index) * 1000),
  }));
  const events = journal.parseJournal(rows.map(row => JSON.stringify(row)).join('\n'));
  assert.equal(events.length, 3);
  assert.match(events.find(item => item.message.includes('HTTP 401')).message, /401/);
  assert.equal(events.find(item => item.message.includes('HTTP 401')).count, 4);
  const source = { name: journal.name, fetch: async () => events };
  await h.run({ sources: [source] });
  const counts = h.state().days['2026-10-14']['vps-journal'];
  assert.equal(counts.noise, 4);
  assert.equal(counts.errors, 4);
  assert.equal(creates(h).length, 2);
  assert.equal(Object.values(h.state().fingerprints).find(item => item.total === 2)?.board, 4060);
}));

check('followups', 'deadline default is twelve minutes and below the service limit', () => withHarness(async h => {
  const unit = readFileSync(join(HERE, '../error-collector.service'), 'utf8');
  const serviceLimit = Number(unit.match(/TimeoutStartSec=(\d+)min/)[1]) * 60 * 1000;
  const original = globalThis.setTimeout;
  const scheduled = [];
  globalThis.setTimeout = (fn, delay, ...args) => { scheduled.push(delay); return original(fn, delay, ...args); };
  try { await h.run(); }
  finally { globalThis.setTimeout = original; }
  assert.equal(scheduled[0], 12 * 60 * 1000);
  assert.ok(scheduled[0] < serviceLimit);
}));

check('followups', 'deadline checkpoints fast sources, skips unreached sources and retries without recounting', () => withHarness(async h => {
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '0';
  let blocked = true;
  let reached = 0;
  let finishedSignal;
  let firstSignal;
  const first = { name: 'fast', fetch: async ({ signal }) => { firstSignal = signal; return [event({ count: 7 })]; } };
  const second = { name: 'blocked', fetch: async ({ signal }) => {
    finishedSignal = signal;
    assert.equal(signal, firstSignal);
    assert.equal(h.state().sources.fast, new Date(blocked ? NOW : NOW + 1000).toISOString());
    assert.equal(Object.values(h.state().pending)[0].count, 7);
    return blocked ? new Promise(() => {}) : [];
  } };
  const third = { name: 'later', fetch: async () => { reached++; return []; } };
  const start = performance.now();
  assert.equal(await h.run({ sources: [first, second, third], timeoutMs: 100 }), 0);
  assert.ok(performance.now() - start < 2000);
  assert.equal(finishedSignal.aborted, true);
  assert.equal(reached, 0);
  assert.equal(h.state().sources.blocked, undefined);
  assert.equal(h.state().sources.later, undefined);
  assert.equal(Object.values(h.state().pending)[0].count, 7);
  assert.deepEqual(h.calls(), []);
  blocked = false;
  await h.run({ sources: [first, second, third], now: NOW + 1000 });
  assert.equal(reached, 1);
  assert.equal(h.state().sources.blocked, new Date(NOW + 1000).toISOString());
  assert.equal(Object.values(h.state().pending)[0].count, 7);
  assert.equal(h.state().days['2026-10-14'].web.errors, 7);
}));

check('followups', 'deadline bounds synchronous reads, HTTP reads and reporting commands', async () => {
  await withHarness(async h => {
    writeFileSync(join(h.home, 'bin/gh'), `#!${process.execPath}\nprocess.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`, { mode: 0o755 });
    const source = { name: 'slow', fetch: async () => { readCommand('gh', [], h.env); return []; } };
    const start = performance.now();
    assert.equal(await h.run({ sources: [source], timeoutMs: 100 }), 1);
    assert.ok(performance.now() - start < 2000);
    assert.equal(existsSync(h.statePath), false);
  });
  await withHarness(async h => {
    const original = globalThis.fetch;
    let signal;
    globalThis.fetch = async (_, options) => {
      signal = options.signal;
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('expired')), { once: true }));
    };
    try {
      const source = { name: 'slow', fetch: async () => { await query('https://fake.invalid', 'fixture'); return []; } };
      assert.equal(await h.run({ sources: [source], timeoutMs: 100 }), 1);
      assert.equal(signal.aborted, true);
      assert.equal(existsSync(h.statePath), false);
    } finally { globalThis.fetch = original; }
  });
  await withHarness(async h => {
    h.events([event()]); h.config({ stall: 'vcc' });
    const start = performance.now();
    assert.equal(await h.run({ timeoutMs: 1000 }), 0);
    assert.ok(performance.now() - start < 3000);
    assert.equal(creates(h).length, 1);
    assert.equal(Object.values(h.state().pending)[0].count, 1);
    assert.equal(h.state().sources.fixture, new Date(NOW).toISOString());
    h.config({}); h.events([]);
    await h.run({ now: NOW + 1000 });
    assert.equal(Object.keys(h.state().pending).length, 0);
    assert.equal(Object.values(h.state().fingerprints)[0].total, 1);
  });
});

check('followups', 'deadline progress survives a process killed during the next source', () => withHarness(async h => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
import { collect } from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
const keepAlive = setInterval(() => {}, 1000);
await collect({ now: ${NOW}, sources: [
  { name: 'fast', fetch: async () => [${JSON.stringify(event({ count: 9 }))}] },
  { name: 'blocked', fetch: async () => { process.stdout.write('BLOCKED\\n'); await new Promise(() => {}); } },
] });
clearInterval(keepAlive);
`], { env: h.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.on('exit', resolve));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('child did not reach blocked source')), 5000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.stdout.once('data', data => { clearTimeout(timer); assert.match(String(data), /BLOCKED/); resolve(); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('child exited before blocked source')); });
    });
    assert.equal(h.state().sources.fast, new Date(NOW).toISOString());
    assert.equal(h.state().sources.blocked, undefined);
    assert.equal(Object.values(h.state().pending)[0].count, 9);
  } finally { child.kill('SIGKILL'); await exited; }
  await h.run({ sources: [{ name: 'fast', fetch: async () => [] }, { name: 'blocked', fetch: async () => [] }], now: NOW + 1000 });
  assert.equal(Object.values(h.state().fingerprints)[0].total, 9);
  assert.equal(h.state().days['2026-10-14'].web.errors, 9);
}));

after(() => {
  assert.ok(passed > 0, 'unknown test suite');
  assert.equal(failed, 0);
  console.log(suite === 'all' ? 'ERROR COLLECTOR TESTS PASSED' : `${suite.toUpperCase()} PASS`);
});

check('sources', 'optional source cursor persists with its timestamp, survives restart and cannot be mutated on failure', () => withHarness(async h => {
  const contexts = [];
  const source = { name: 'stateful', fetch: async context => { contexts.push(context); return { events: [], cursor: { counter: String(contexts.length) } }; } };
  await h.run({ sources: [source] });
  assert.equal(contexts[0].cursor, undefined);
  assert.deepEqual(h.state().sourceCursors.stateful, { counter: '1' });
  assert.equal(h.state().sources.stateful, new Date(NOW).toISOString());
  await h.run({ now: NOW + 1000, sources: [source] });
  assert.deepEqual(contexts[1].cursor, { counter: '1' });
  assert.equal(contexts[1].since, new Date(NOW).toISOString());
  const before = readFileSync(h.statePath);
  for (const fetch of [
    async ({ cursor }) => { cursor.counter = 'changed'; throw new Error('unavailable'); },
    async () => ({ events: [event({ count: 0 })], cursor: { counter: 'changed' } }),
    async () => ({ events: [], cursor: 'x'.repeat(4097) }),
    async () => ({ events: [] }),
    async () => ({ events: [], cursor: 1n }),
  ]) {
    assert.equal(await h.run({ now: NOW + 2000, sources: [{ name: 'stateful', fetch }] }), 1);
    assert.deepEqual(readFileSync(h.statePath), before);
  }
  await h.run({ now: NOW + 3000, sources: [{ name: 'stateful', fetch: async ({ cursor }) => { cursor.counter = 'changed'; throw new Error('unavailable'); } }, { name: 'other', fetch: async () => [] }] });
  assert.deepEqual(h.state().sourceCursors.stateful, { counter: '2' });
  assert.equal(h.state().sources.stateful, new Date(NOW + 1000).toISOString());
  assert.equal(h.state().sources.other, new Date(NOW + 3000).toISOString());
}));

check('sources', 'Neon collector advances snapshots atomically, failures leave both cursors unchanged and dry-run writes nothing', () => withHarness(async h => {
  const neon = await import('./sources/neon.mjs');
  const data = JSON.parse(readFileSync(join(HERE, 'fixtures/sources.json'))).neon;
  const connection = ['postgresql://stats_reader', 'fixture-password@ep-fixture.neon.invalid/stats'].join(':');
  h.env.NEON_STATS_URL_FILE = join(h.home, 'neon.url');
  writeFileSync(h.env.NEON_STATS_URL_FILE, connection, { mode: 0o600 });
  const original = globalThis.fetch;
  let readings = structuredClone(data.counters);
  let counterStatus = 200;
  globalThis.fetch = async (url, options) => ({ status: JSON.parse(options.body).query.includes('db_counters') ? counterStatus : 200, json: async () => JSON.parse(options.body).query.includes('db_counters') ? readings : data.slow });
  try {
    assert.equal(await h.run({ sources: [neon] }), 0);
    const baseline = h.state();
    assert.equal(baseline.sources.neon, new Date(NOW).toISOString());
    assert.equal(baseline.sourceCursors.neon.deadlocks, '2');
    assert.equal(creates(h).length, 1);
    const before = readFileSync(h.statePath);
    counterStatus = 500;
    assert.equal(await h.run({ now: NOW + HOUR, sources: [neon] }), 1);
    assert.deepEqual(readFileSync(h.statePath), before);
    for (const path of [join(h.home, 'missing.url'), h.home]) {
      assert.equal(await h.run({ now: NOW + HOUR, sources: [neon], env: { ...h.env, NEON_STATS_URL_FILE: path } }), 1);
      assert.deepEqual(readFileSync(h.statePath), before);
    }
    counterStatus = 200;
    Object.assign(readings.rows[0], { deadlocks: '4', xact_rollback: '601', read_at: '2026-10-14T09:29:03Z' });
    const filesBefore = readdirSync(dirname(h.statePath));
    const writesBefore = h.calls().filter(call => call.name !== 'ht').length;
    assert.equal(await h.run({ now: NOW + HOUR, sources: [neon], dryRun: true }), 0);
    assert.deepEqual(readFileSync(h.statePath), before);
    assert.deepEqual(readdirSync(dirname(h.statePath)), filesBefore);
    assert.equal(h.calls().filter(call => call.name !== 'ht').length, writesBefore);
    const freshRoot = join(h.home, 'fresh-neon-dry-run');
    assert.equal(await h.run({ sources: [neon], dryRun: true, env: { ...h.env, ERROR_COLLECTOR_STATE_DIR: freshRoot } }), 0);
    assert.equal(existsSync(freshRoot), false);
    assert.equal(await h.run({ now: NOW + HOUR, sources: [neon] }), 0);
    assert.equal(h.state().sources.neon, new Date(NOW + HOUR).toISOString());
    assert.equal(h.state().sourceCursors.neon.deadlocks, '4');
    assert.equal(h.state().sourceCursors.neon.xact_rollback, '601');
    assert.equal(creates(h).length, 3);
    assert.ok(!readFileSync(h.statePath, 'utf8').includes(connection));
    assert.ok(!readFileSync(h.statePath, 'utf8').includes('fixture-password'));
    assert.equal(Object.values(h.state().fingerprints).find(record => record.total === 2).board, 4060);
  } finally { globalThis.fetch = original; }
}));

check('tickets', 'stale replay: cap-held HTPR-7481..7490 groups never file at 10:30 or 13:30', () => withHarness(async h => {
  const rows = JSON.parse(readFileSync(join(HERE, 'fixtures/stale-replay.json'), 'utf8'));
  const filling = Array.from({ length: 5 }, (_, i) => event({ service: 'vercel', message: `Active failure ${String.fromCharCode(65 + i)}`, route: '/cap-fixture', ts: '2026-10-20T08:00:00Z' }));
  h.events([...filling, ...rows.filter(row => row.message !== 'MCP context task id out of range')]);
  await h.run({ now: Date.parse('2026-10-20T08:01:00Z') });
  assert.equal(creates(h).length, 5);
  assert.equal(Object.keys(h.state().pending).length, 12);
  await h.run({ now: Date.parse('2026-10-20T08:02:00Z') });
  assert.equal(creates(h).length, 5);
  await h.run({ now: Date.parse('2026-10-20T10:30:00Z') });
  const at1030 = creates(h).length;
  await h.run({ now: Date.parse('2026-10-20T13:30:00Z') });
  console.log(`stale replay creates: 10:30=${at1030 - 5}, 13:30=${creates(h).length - at1030}`);
  assert.equal(creates(h).length, 5, 'cap-held stale groups must not create tickets');
  assert.deepEqual(Object.keys(h.state().pending), []);
  assert.equal(Object.keys(h.state().stale).length, 12);
  assert.equal(h.state().days['2026-10-20'].vercel.stale, 12);
}));

check('tickets', 'stale replay: the later context pending group also expires before 13:30', () => withHarness(async h => {
  const rows = JSON.parse(readFileSync(join(HERE, 'fixtures/stale-replay.json'), 'utf8'));
  h.events(rows.filter(row => row.message === 'MCP context task id out of range'));
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '0';
  await h.run({ now: Date.parse('2026-10-20T09:54:00Z') });
  assert.equal(Object.keys(h.state().pending).length, 1);
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '5';
  await h.run({ now: Date.parse('2026-10-20T13:30:00Z') });
  assert.equal(creates(h).length, 0);
  assert.deepEqual(Object.keys(h.state().pending), []);
}));

check('tickets', 'stale records ignore old sightings but a newer recurrence files normally under the cap', () => withHarness(async h => {
  const old = event({ ts: new Date(NOW - 3 * HOUR).toISOString(), count: 7 });
  const fp = fingerprint(old.service, old.message);
  h.events([old]);
  await h.run();
  assert.equal(creates(h).length, 0);
  assert.equal(h.state().fingerprints[fp], undefined);
  assert.deepEqual(h.state().stale[fp], { board: old.board, service: old.service, firstSeen: old.ts, lastSeen: old.ts, count: 7, routes: [old.route], aliases: [] });
  const retry = h.state();
  delete retry.sources.fixture;
  h.seed(retry);
  h.events([old, { ...old, ts: new Date(NOW - 4 * HOUR).toISOString() }]);
  await h.run({ now: NOW + 1000 });
  assert.equal(creates(h).length, 0);
  assert.equal(h.state().days['2026-10-14'].web.stale, 1);
  assert.equal(h.state().stale[fp].count, 7);
  assert.deepEqual(h.state().pending, {});
  h.events([event({ ts: new Date(NOW + 2000).toISOString(), count: 2 }), old]);
  const recurrence = h.state();
  delete recurrence.sources.fixture;
  h.seed(recurrence);
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '0';
  await h.run({ now: NOW + 2000 });
  assert.equal(creates(h).length, 0);
  assert.equal(h.state().fingerprints[fp], undefined);
  assert.equal(h.state().stale[fp], undefined);
  assert.equal(h.state().pending[fp].count, 2);
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '5';
  await h.run({ now: NOW + 3000 });
  assert.equal(creates(h).length, 1);
  assert.equal(h.state().fingerprints[fp].stale, undefined);
  assert.equal(h.state().fingerprints[fp].total, 2);
}));

check('tickets', 'stale-only activity survives revival, retries under the six-hour throttle and preserves fingerprint totals', () => withHarness(async h => {
  h.events([event()]);
  await h.run();
  const ticket = Object.values(h.state().fingerprints)[0].ticket;
  h.events([event({ message: 'Different checkout failure', ts: new Date(NOW - 3 * HOUR).toISOString(), count: 4 })]);
  const rewind = h.state();
  delete rewind.sources.fixture;
  h.seed(rewind);
  await h.run({ now: NOW + 1000 });
  assert.equal(creates(h).length, 1);
  assert.equal(activities(h, ticket).length, 0);
  assert.deepEqual(Object.keys(h.state().pending), []);
  assert.equal(h.state().activities[ticket].count, 0);
  const staleFp = fingerprint('web', 'Different checkout failure');
  h.events([event({ message: 'Different checkout failure', ts: new Date(NOW + HOUR).toISOString(), count: 2 })]);
  await h.run({ now: NOW + HOUR });
  assert.equal(h.state().stale[staleFp], undefined);
  assert.equal(creates(h).length, 2);
  assert.equal(h.state().activities[ticket].count, 0);
  assert.equal(h.state().activities[ticket].stale.count, 4);
  h.events([]);
  await h.run({ now: NOW + 6 * HOUR - 1 });
  assert.equal(activities(h, ticket).length, 0);
  h.config({ activityFail: true });
  await h.run({ now: NOW + 6 * HOUR });
  assert.equal(activities(h, ticket).length, 1);
  assert.equal(h.state().activities[ticket].stale.count, 4);
  h.config({});
  await h.run({ now: NOW + 6 * HOUR + 1000 });
  assert.equal(activities(h, ticket).length, 2);
  assert.equal(activities(h, ticket)[1].args[3], '0 more since 2026-10-14T02:00:00.000Z, 1 total, last seen 2026-10-14T04:59:59.000Z; stale sighting: 4 occurrences, first seen 2026-10-14T02:00:00.000Z, last seen 2026-10-14T02:00:00.000Z');
  assert.equal(h.state().activities[ticket].stale, undefined);
  await h.run({ now: NOW + 7 * HOUR });
  assert.equal(activities(h, ticket).length, 2);
}));

for (const kind of ['deleted', 'other-board', 'other-route', 'empty-route']) check('tickets', `stale route adoption excludes ${kind} records`, () => withHarness(async h => {
  h.events([event({ route: kind === 'empty-route' ? '' : '/checkout/123' })]);
  await h.run();
  const state = h.state();
  const record = Object.values(state.fingerprints)[0];
  if (kind === 'deleted') record.deleted = true;
  if (kind === 'other-board') record.board = 4060;
  if (kind === 'other-route') record.routes = ['/unrelated'];
  delete state.sources.fixture;
  h.seed(state);
  h.events([event({ message: 'Different checkout failure', route: kind === 'empty-route' ? '' : '/checkout/123', ts: new Date(NOW - 3 * HOUR).toISOString() })]);
  await h.run({ now: NOW + 1000 });
  assert.equal(creates(h).length, 1);
  assert.equal(activities(h, record.ticket).length, 0);
  assert.equal(h.state().days['2026-10-14'].web.stale, 1);
}));

for (const setting of [undefined, '0', 'invalid', '-1', 'Infinity', '1', '2.5']) check('tickets', `stale window setting ${setting} uses a positive finite value or defaults to two hours`, () => withHarness(async h => {
  if (setting !== undefined) h.env.ERROR_COLLECTOR_STALE_HOURS = setting;
  h.events([event({ message: 'Fresh failure' }), event({ message: 'Boundary failure', ts: new Date(NOW - 2 * HOUR).toISOString() }), event({ message: 'Older failure', ts: new Date(NOW - 2 * HOUR - 1).toISOString() })]);
  await h.run();
  assert.equal(creates(h).length, setting === '1' ? 1 : setting === '2.5' ? 3 : 2);
  assert.equal(Object.keys(h.state().stale).length, setting === '1' ? 2 : setting === '2.5' ? 0 : 1);
}));

check('reporting', 'stale unfiled groups count once in daily summaries without ticket references', () => withHarness(async h => {
  h.events([event({ ts: new Date(NOW - 3 * HOUR).toISOString(), count: 9 })]);
  await h.run();
  assert.equal(creates(h).length, 0);
  h.events([]);
  await h.run({ now: NOW + DAY, summary: true });
  const summary = activities(h, 'YPER4-354').find(call => /web on 2026-10-14/.test(call.args[3]));
  assert.match(summary.args[3], /9 errors.*1 stale, not filed/);
  assert.doesNotMatch(summary.args[3], /HTPR-/);
  await h.run({ now: NOW + DAY + 1000, summary: true });
  assert.equal(h.state().days['2026-10-14'].web.stale, 1);
  assert.equal(activities(h, 'YPER4-354').filter(call => /web on 2026-10-14/.test(call.args[3])).length, 1);
}));

check('tickets', 'stale same-route groups emit one due activity and newer events can file their own tickets', () => withHarness(async h => {
  const prior = new Date(NOW - 7 * HOUR).toISOString();
  h.seed({ version: 1, sources: {}, fingerprints: { existing: { ticket: 'HTPR-777', board: 15, firstSeen: prior, lastSeen: prior, total: 3, routes: ['/checkout/123'], lastActivityAt: prior } }, pending: {}, days: {}, summaries: {}, activities: {}, created: [] });
  const rows = ['Checkout connection failed', 'Checkout transaction failed'].map(message => event({ message, ts: new Date(NOW - 3 * HOUR).toISOString(), count: 4 }));
  h.events(rows);
  await h.run();
  assert.equal(creates(h).length, 0);
  assert.equal(activities(h, 'HTPR-777').length, 1);
  assert.equal(activities(h, 'HTPR-777')[0].args[3], `0 more since 2026-10-14T02:00:00.000Z, 3 total, last seen ${prior}; stale sighting: 8 occurrences, first seen 2026-10-14T02:00:00.000Z, last seen 2026-10-14T02:00:00.000Z`);
  assert.equal(h.state().days['2026-10-14'].web.stale, undefined);
  await h.run({ now: NOW + 1000 });
  assert.equal(activities(h, 'HTPR-777').length, 1);
  h.events(rows.map(row => ({ ...row, ts: new Date(NOW + 2000).toISOString(), count: 1 })));
  await h.run({ now: NOW + 2000 });
  assert.equal(creates(h).length, 2);
}));

check('tickets', 'stale alias marker is reconciled before disposition and recurrence never duplicates the ticket', () => withHarness(async h => {
  const ts = new Date(NOW - 3 * HOUR).toISOString();
  const message = `${ts} Legacy checkout failure`;
  const alias = '8e2912a350500b38';
  const fp = fingerprint('web', message);
  h.seed({ version: 1, sources: {}, fingerprints: {}, pending: { [alias]: { board: 15, service: 'web', normalized: normalize(message), message, stack: '', routes: ['/checkout'], count: 2, firstSeen: ts, lastSeen: ts } }, days: {}, summaries: {}, activities: {}, created: [] });
  h.remote([{ ticketNumber: 'HTPR-777', projectId: 15, status: 'Normal', description: `<p>error-fingerprint:${alias}</p>` }]);
  await h.run();
  assert.equal(h.state().fingerprints[fp].ticket, 'HTPR-777');
  assert.equal(h.state().stale[fp], undefined);
  h.events([event({ message, ts: new Date(NOW + 1000).toISOString() })]);
  await h.run({ now: NOW + 1000 });
  assert.equal(creates(h).length, 0);
  assert.equal(h.state().fingerprints[fp].total, 3);
}));

check('tickets', 'stale unresolved aliases survive revival into pending and adopt a legacy marker', () => withHarness(async h => {
  const ts = new Date(NOW - 3 * HOUR).toISOString();
  const message = `${ts} Legacy checkout failure`;
  const alias = '8e2912a350500b38';
  const fp = fingerprint('web', message);
  h.seed({ version: 1, sources: {}, fingerprints: {}, pending: { [alias]: { board: 15, service: 'web', normalized: normalize(message), message, stack: '', routes: ['/checkout'], count: 2, firstSeen: ts, lastSeen: ts } }, days: {}, summaries: {}, activities: {}, created: [] });
  await h.run();
  assert.deepEqual(h.state().stale[fp].aliases, [alias]);
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '0';
  h.events([event({ message, board: 4060, ts: new Date(NOW + 1000).toISOString() })]);
  await h.run({ now: NOW + 1000 });
  assert.deepEqual(h.state().pending[fp].aliases, [alias]);
  assert.equal(h.state().pending[fp].board, 15);
  assert.equal(h.state().stale[fp], undefined);
  h.remote([{ ticketNumber: 'HTPR-777', projectId: 15, status: 'Archive', description: `<p>error-fingerprint:${alias}</p>` }]);
  await h.run({ now: NOW + 2000 });
  h.events([event({ message, ts: new Date(NOW + 3000).toISOString() })]);
  await h.run({ now: NOW + 3000 });
  assert.equal(creates(h).length, 0);
  assert.equal(h.state().fingerprints[fp].ticket, 'HTPR-777');
  assert.equal(h.state().fingerprints[fp].total, 2);
}));

check('reporting', 'stale warning revival still requires more than the normal hourly threshold', () => withHarness(async h => {
  const message = 'Warning: SECURITY WARNING: The SSL modes';
  const fp = createHash('sha256').update('noise|vercel|ssl-mode-warning').digest('hex').slice(0, 16);
  const old = event({ service: 'vercel', message, count: 51, ts: new Date(NOW - 3 * HOUR).toISOString() });
  h.events([old]);
  await h.run();
  assert.equal(creates(h).length, 0);
  assert.equal(h.state().stale[fp].count, 51);
  assert.equal(h.state().fingerprints[fp], undefined);
  const state = h.state();
  delete state.sources.fixture;
  h.seed(state);
  h.events([old, { ...old, ts: new Date(NOW - 4 * HOUR).toISOString() }]);
  await h.run({ now: NOW + 1000 });
  assert.deepEqual(h.state().noiseWindows, {});
  assert.equal(h.state().stale[fp].count, 51);
  const reads = h.calls().length;
  h.events([event({ service: 'vercel', message, ts: new Date(NOW + 2000).toISOString() })]);
  await h.run({ now: NOW + 2000 });
  assert.equal(h.state().stale[fp], undefined);
  assert.deepEqual(h.state().pending, {});
  assert.equal(h.calls().length, reads);
  h.events([event({ service: 'vercel', message, count: 49, ts: new Date(NOW + 3000).toISOString() })]);
  await h.run({ now: NOW + 3000 });
  assert.equal(creates(h).length, 0);
  h.events([event({ service: 'vercel', message, ts: new Date(NOW + 4000).toISOString() })]);
  await h.run({ now: NOW + 4000 });
  assert.equal(creates(h).length, 1);
  assert.equal(h.state().fingerprints[fp].total, 51);
  assert.match(creates(h)[0].description, /Occurrences in one hour: 51/);
}));

check('reporting', 'midnight-spanning stale group is counted on disposition day after the first day was summarized', () => withHarness(async h => {
  const start = Date.parse('2026-10-13T23:30:00Z');
  const end = Date.parse('2026-10-14T00:30:00Z');
  h.env.ERROR_COLLECTOR_HOURLY_CAP = '0';
  h.events([event({ ts: new Date(start).toISOString(), count: 2 })]);
  await h.run({ now: start });
  h.events([event({ ts: new Date(end).toISOString(), count: 3 })]);
  await h.run({ now: end, summary: true });
  assert.equal(h.state().summaries['2026-10-13'].web, true);
  h.events([]);
  await h.run();
  assert.equal(creates(h).length, 0);
  assert.equal(h.state().days['2026-10-13'].web.stale, undefined);
  assert.equal(h.state().days['2026-10-14'].web.stale, 1);
  assert.equal(Object.values(h.state().stale)[0].count, 5);
  await h.run({ now: NOW + DAY, summary: true });
  const lines = activities(h, 'YPER4-354').map(call => call.args[3]);
  assert.equal(lines.filter(line => /web on 2026-10-13/.test(line)).length, 1);
  assert.ok(lines.some(line => /web on 2026-10-14:.*1 stale, not filed/.test(line)));
}));

check('tickets', 'stale records retain fourteen UTC days without pruning ticket fingerprints or queued sightings', () => withHarness(async h => {
  const ts = new Date(NOW - 3 * HOUR).toISOString();
  h.events([event({ ts })]);
  await h.run();
  const fp = fingerprint('web', event().message);
  const stale = h.state().stale[fp];
  const state = h.state();
  state.stale.expired = { ...stale, lastSeen: '2026-09-30T23:59:59.999Z' };
  state.stale.boundary = { ...stale, lastSeen: '2026-10-01T00:00:00.000Z' };
  state.fingerprints.existing = { ticket: 'HTPR-777', board: 15, total: 3, routes: [], firstSeen: ts, lastSeen: ts, lastActivityAt: new Date(NOW).toISOString() };
  state.activities['HTPR-777'] = { count: 0, since: ts, at: new Date(NOW).toISOString(), stale: { count: 2, firstSeen: ts, lastSeen: ts } };
  h.seed(state);
  h.events([]);
  await h.run({ now: NOW + 1000 });
  assert.equal(h.state().stale.expired, undefined);
  assert.deepEqual(h.state().stale.boundary, state.stale.boundary);
  assert.deepEqual(h.state().stale[fp], stale);
  assert.deepEqual(h.state().fingerprints, state.fingerprints);
  assert.deepEqual(h.state().activities, state.activities);
}));

check('incidents', 'recorded MCP wrapper and four Vercel payloads become one ticket with five activities', async () => withHarness(async h => {
  const { plain } = await import('./incident.mjs');
  const recorded = JSON.parse(readFileSync(join(HERE, 'fixtures/project-validation.json'), 'utf8')).tasks;
  const first = { ...recorded[0], id: 8017, projectId: 15, status: 'Normal', section: 'Bugs' };
  h.remote([first]);
  const replay = recorded.slice(1).map((task, index) => event({ service: 'vercel', message: plain(task.description).split('Sample message: ')[1].replace(/\s+error-fingerprint:.*/s, '').trim(), route: index === 0 ? '/mcp' : '/api/mcp/projects', ts: new Date(NOW - 1000 - index).toISOString(), stack: '' }));
  first.description = first.description.replace('2026-10-26T08:52:23.162Z', new Date(NOW - 2000).toISOString());
  h.remote([first]);
  h.events(replay);
  assert.equal(await h.run(), 0);
  assert.equal(creates(h).length, 0);
  assert.equal(activities(h, 'HTPR-8017').filter(call => call.args[3].includes('error-occurrence:')).length, 5);
  assert.equal(Object.keys(h.state().fingerprints).length, 1);
  assert.equal(Object.keys(h.state().occurrences).length, 0);
  await h.run();
  assert.equal(activities(h, 'HTPR-8017').filter(call => call.args[3].includes('error-occurrence:')).length, 5);
  h.events([event({ service: 'vercel', message: replay[1].message.replaceAll('updatedAt', 'otherField'), route: '/api/mcp/projects', ts: new Date(NOW + 1000).toISOString(), stack: '' })]);
  await h.run({ now: NOW + 2000 });
  assert.equal(creates(h).length, 1, 'different field on the same route must get its own ticket');
  assert.match(creates(h)[0].description, /unknown-argument:otherField/);
}));

check('incidents', 'new root ticket groups operations and preserves activities after ambiguous writes', async () => withHarness(async h => {
  const message = 'PrismaClientValidationError: Invalid `prisma.project.findMany()` invocation: Unknown argument `updatedAt`.';
  h.events([event({ service: 'vercel', message, route: '/api/mcp/projects' }), event({ service: 'vercel', message: message.replace('findMany', 'count'), route: '/api/mcp/projects' })]);
  h.config({ ambiguousActivity: true });
  await h.run();
  assert.equal(creates(h).length, 1);
  assert.equal(Object.keys(h.state().occurrences).length, 2);
  h.config({});
  await h.run();
  assert.equal(activities(h, 'HTPR-100').length, 2, 'saved activity markers recover ambiguous writes');
  assert.equal(Object.keys(h.state().occurrences).length, 0);
}));

check('incidents', 'simultaneous distinct fields never reserve the same untyped MCP report', async () => withHarness(async h => {
  h.remote([{ id: 8017, ticketNumber: 'HTPR-8017', projectId: 15, status: 'Normal', section: 'Bugs', description: `<p>Tool: hypertask_projects</p><p>HTTP status: 500</p><p>Last seen: ${new Date(NOW - 2000).toISOString()}</p>` }]);
  const message = 'PrismaClientValidationError: Invalid `prisma.project.findMany()` invocation: Unknown argument `updatedAt`.';
  h.events([event({ service: 'vercel', message, route: '/api/mcp/projects' }), event({ service: 'vercel', message: message.replace('updatedAt', 'otherField'), route: '/api/mcp/projects' })]);
  await h.run();
  assert.equal(creates(h).length, 2);
  assert.equal(new Set(Object.values(h.state().fingerprints).map(record => record.ticket)).size, 2);
  assert.equal(activities(h, 'HTPR-8017').length, 0);
}));

check('incidents', 'legacy message fingerprint on another route cannot own the new route', async () => withHarness(async h => {
  const message = 'PrismaClientValidationError: Invalid `prisma.project.findMany()` invocation: Unknown argument `updatedAt`.';
  h.remote([{ id: 8000, ticketNumber: 'HTPR-8000', projectId: 15, status: 'Normal', description: `<p>Routes: /api/projects</p><p>First seen: ${new Date(NOW - 2000).toISOString()}</p><p>${message}</p><p>error-fingerprint:${fingerprint('vercel', message)}</p>` }]);
  h.events([event({ service: 'vercel', message, route: '/api/mcp/projects' })]);
  await h.run();
  assert.equal(creates(h).length, 1);
  assert.equal(activities(h, 'HTPR-8000').length, 0);
}));

check('incidents', 'retained legacy pending roots migrate before filing; deleted legacy matches stay deleted', async () => withHarness(async h => {
  await h.run();
  const state = h.state();
  const message = 'PrismaClientValidationError: Invalid `prisma.project.count()` invocation: Unknown argument `updatedAt`.';
  const fp = fingerprint('vercel', message);
  state.pending[fp] = { board: 15, service: 'vercel', rules: 3, message, normalized: normalize(message), stack: '', routes: ['/api/mcp/projects'], count: 2, firstSeen: new Date(NOW - 1000).toISOString(), lastSeen: new Date(NOW - 1000).toISOString() };
  h.seed(state);
  h.remote([{ id: 8000, ticketNumber: 'HTPR-8000', projectId: 15, status: 'Deleted', description: `<p>Routes: /api/mcp/projects</p><p>First seen: ${new Date(NOW - 1000).toISOString()}</p><p>${message}</p><p>error-fingerprint:${fp}</p>` }]);
  await h.run();
  assert.equal(creates(h).length, 0);
  assert.equal(Object.keys(h.state().pending).length, 0);
  assert.equal(Object.values(h.state().fingerprints)[0].deleted, true);
  assert.equal(activities(h, 'HTPR-8000').length, 0);
}));

check('incidents', 'repeated hits in one collection window make one counted activity', async () => withHarness(async h => {
  const message = 'PrismaClientValidationError: Invalid `prisma.project.count()` invocation: Unknown argument `updatedAt`.';
  h.events(Array.from({ length: 50 }, (_, index) => event({ service: 'vercel', message, route: '/api/mcp/projects', ts: new Date(NOW - index - 1).toISOString() })));
  await h.run();
  assert.equal(creates(h).length, 1);
  assert.equal(activities(h, 'HTPR-100').length, 1);
  assert.match(activities(h, 'HTPR-100')[0].args[3], /50 hits/);
}));

check('incidents', 'long matching dumps keep distinct-root activities and redact canonical paths', async () => withHarness(async h => {
  const prefix = 'PrismaClientValidationError: Invalid `prisma.project.count()` invocation: ' + 'argument dump '.repeat(40);
  const route = '/api/projects/person@example.invalid/sk-abcdefghijklmnopqrstuv';
  h.events(['firstField', 'secondField'].map(field => event({ service: 'vercel', route, message: prefix + `Unknown argument \`${field}\`.` })));
  await h.run();
  assert.equal(creates(h).length, 2);
  assert.equal(activities(h).filter(call => call.args[2] !== 'YPER4-354').length, 2);
  assert.doesNotMatch(JSON.stringify(h.state()) + JSON.stringify(creates(h)), /person@example|sk-abcdefghijkl/);
}));

check('incidents', 'wrapper-only windows never renew actual root timestamps', async () => withHarness(async h => {
  const message = 'PrismaClientValidationError: Invalid `prisma.project.count()` invocation: Unknown argument `updatedAt`.';
  h.events([event({ service: 'vercel', message, route: '/api/mcp/projects' })]); await h.run();
  const root = Object.values(h.state().fingerprints)[0].incident.ts;
  for (const minutes of [9, 18]) {
    h.events([event({ service: 'vercel', message: 'Failed to list projects | Internal server error', route: '/mcp', ts: new Date(NOW + minutes * 60000).toISOString() })]);
    await h.run({ now: NOW + minutes * 60000 });
  }
  assert.equal(creates(h).length, 2);
  assert.equal(Object.values(h.state().fingerprints).find(record => record.incident)?.incident.ts, root);
}));
