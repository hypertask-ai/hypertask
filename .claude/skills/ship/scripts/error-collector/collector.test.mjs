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
const exit = () => { console.error('fake credential-bearing failure suppressed'); process.exit(1); };
const remote = read('remote.json', []);
if (name === 'systemctl') { if (cfg.installFail) exit(); process.exit(0); }
if (name === 'runner-deliver') { if (cfg.deliverFail) exit(); process.exit(0); }
if (name === 'ht') {
  if (args[0] !== 'GET') throw new Error('WRITE FORBIDDEN');
  if (cfg.searchFail) exit();
  const url = new URL(args[1], 'https://fake.invalid');
  if (url.pathname === '/mcp/projects/4060/sections') {
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
  // A quoted code name says what failed, so it stays readable in the ticket title.
  assert.equal(normalize('Invalid `prisma.task.deleteMany()` invocation'), 'Invalid `prisma.task.deleteMany()` invocation');
  assert.equal(normalize('failed https://example.invalid/x?token=anything'), 'failed https://example.invalid/x');
  assert.equal(normalize('/users/42?email=test', true), '/users/:id');
  assert.equal(normalize('x'.repeat(400)).length, 300);
  const expected = createHash('sha256').update('web|failed <n>').digest('hex').slice(0, 16);
  assert.equal(fingerprint('web', 'failed 42', '/users/1'), expected);
  assert.equal(fingerprint('web', 'failed 42', '/users/1'), fingerprint('web', 'failed 7', '/teams/2'));
  assert.notEqual(fingerprint('web', 'failed 42', '/users/1'), fingerprint('api', 'failed 42', '/users/1'));
});

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
    // Built at run time so secret scanners do not read the fake login as a real one.
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
  assert.deepEqual(call.args.slice(0, 12), ['--json', 'task', 'create', '--project', '15', '--section', 'Bugs', '--labels', 'prod-error', '--priority', 'high', '--title']);
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
  writeFileSync(join(directory, 'noise.json'), readFileSync(join(HERE, 'noise.json')));
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

check('reporting', 'noise counted per service and day, no tickets; daily summary once after 06 or forced', () => withHarness(async h => {
  const noise = [event({ route: '/wp-admin/' }), event({ route: '/.env' }), event({ route: '/index.php' }), event({ message: 'AbortError' }), event({ message: 'request aborted' }), event({ message: 'HTTP 401' }), event({ message: 'status: 403' }), event({ message: '404 Not Found', service: 'api' })];
  h.events(noise); await h.run(); assert.equal(creates(h).length, 0); assert.equal(activities(h).length, 0);
  assert.equal(h.state().days['2026-10-14'].web.noise, 7);
  h.events([event({ message: 'Unexpected internal 500 error', count: 2, ts: new Date(NOW + 1000).toISOString() })]);
  await h.run({ now: NOW + 1000 });
  assert.equal(creates(h).length, 1);
  assert.equal(activities(h, 'YPER4-354').length, 0);
  // The summary covers the last full UTC day, so 2026-10-14 is reported on the 15th.
  h.events([]); await h.run({ now: NOW + DAY, summary: true });
  assert.ok(activities(h).some(c => c.args[3] === 'web on 2026-10-14: 2 errors (2026-10-13: 0), 1 new kinds, 7 noise'));
  const posted = activities(h, 'YPER4-354').length;
  await h.run({ now: NOW + DAY + 2 * HOUR }); await h.run({ now: NOW + DAY + 2 * HOUR, summary: true });
  assert.equal(activities(h, 'YPER4-354').length, posted);
  await h.run({ now: NOW + 2 * DAY + 2 * HOUR });
  assert.ok(activities(h).some(c => c.args[3] === 'web on 2026-10-15: 0 errors (2026-10-14: 2), 0 new kinds, 0 noise'));
}));

check('reporting', 'outside PR guard dry runs are noise, other workflow failures are errors (YPER4-364)', () => withHarness(async h => {
  const ci = { service: 'github-actions', board: 4060, route: '', stack: 'https://github.com/hypertask-ai/hypertask/actions/runs/1' };
  h.events([event({ ...ci, message: 'Outside PR guard failed: outside-pr-guard' }), event({ ...ci, message: 'CI Tests failed: browser-smoke' })]);
  await h.run();
  assert.equal(creates(h).length, 1);
  assert.equal(h.state().days['2026-10-14']['github-actions'].noise, 1);
  assert.equal(h.state().days['2026-10-14']['github-actions'].errors, 1);
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
    for (let i = 1; i <= 16; i++) state.days[new Date(NOW - i * DAY).toISOString().slice(0, 10)] = { web: { errors: 20, noise: 0, newGroups: 0 } };
    for (const date of Object.keys(state.days)) state.summaries[date] = { web: true, fixture: true };
    h.seed(state); h.events([event({ count, ts: new Date(NOW + 1000).toISOString() })]); await h.run({ now: NOW + DAY, summary: true });
    const deliveries = h.calls().filter(c => c.name === 'runner-deliver');
    assert.equal(deliveries.length, count > 60 ? 1 : 0);
    if (deliveries.length) { assert.deepEqual(deliveries[0].args, ['ht-product-lead']); assert.equal(deliveries[0].id, 'error-collector:2026-10-14:web'); assert.match(deliveries[0].input, /SPIKE/); }
    assert.equal(Object.keys(h.state().days).length, 14);
    assert.ok(h.state().days['2026-10-02']); assert.equal(h.state().days['2026-10-01'], undefined);
  });
  await withHarness(async h => {
    rmSync(join(h.home, 'bin/runner-deliver')); h.events([event({ count: 50, ts: new Date(NOW + 1000).toISOString() })]); await h.run({ now: NOW + DAY, summary: true });
    const path = join(dirname(h.statePath), 'spikes.log'); assert.match(readFileSync(path, 'utf8'), /SPIKE.*web on 2026-10-14: 50 errors/); assert.equal(statSync(path).mode & 0o777, 0o600);
  });
});

check('reporting', 'dry-run plans create/activity/summary/spike and never changes state or performs writes', () => withHarness(async h => {
  const clock = join(h.home, 'dry-clock.mjs');
  writeFileSync(clock, `Date.now = () => ${NOW};`);
  h.env.NODE_OPTIONS = `--import=${clock}`;
  h.events([event({ count: 50, ts: new Date(NOW - DAY + HOUR).toISOString() })]);
  const result = h.cli('--once', '--sources', 'fixture', '--dry-run', '--summary');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DRY-RUN.*"vcc".*"create"/);
  assert.match(result.stdout, /DRY-RUN.*"activity".*"YPER4-354"/);
  assert.match(result.stdout, /DRY-RUN.*"runner-deliver"/);
  assert.ok(h.calls().every(c => c.name === 'ht' && c.args[0] === 'GET'));
  assert.equal(existsSync(dirname(h.statePath)), false);
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
  assert.deepEqual(h.state().days['2026-10-13'].quiet, { errors: 0, noise: 0, newGroups: 0 });
  assert.deepEqual(h.state().days['2026-10-14'].quiet, { errors: 0, noise: 0, newGroups: 0 });
  await h.run({ sources: [quiet], now: NOW + 2 * HOUR });
  assert.ok(activities(h).some(call => call.args[3] === 'quiet on 2026-10-13: 0 errors (2026-10-12: 0), 0 new kinds, 0 noise'));
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
  h.seed({ version: 1, sources: {}, fingerprints: {}, pending: {}, activities: {}, created: [], summaries: {}, days: Object.fromEntries(dates.map((date, i) => [date, { web: { errors: i === 0 ? 50 : 0, noise: 0, newGroups: i + 1 } }])) });
  h.config({ activityFail: true }); await h.run({ summary: true });
  assert.deepEqual(h.state().summaries, {});
  h.config({}); await h.run({ now: NOW + DAY, summary: true });
  assert.deepEqual(Object.keys(h.state().summaries), dates.slice(0, 3));
  const lines = activities(h).filter(call => call.args[3].startsWith('web on ')).slice(-3).map(call => call.args[3]);
  assert.deepEqual(lines.map(line => Number(line.match(/(\d+) new kinds/)[1])), [1, 2, 3]);
  assert.equal(h.calls().find(call => call.name === 'runner-deliver').id, 'error-collector:2026-10-10:web');
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
  assert.ok(readdirSync(join(HERE, 'sources')).includes('fixture.mjs'));
  assert.match(readFileSync(join(HERE, 'README.md'), 'utf8'), /Backlog, section 10414/);
  const service = readFileSync(join(HERE, '../error-collector.service'), 'utf8');
  const timer = readFileSync(join(HERE, '../error-collector.timer'), 'utf8');
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
  assert.ok(activities(h).some(call => call.args[3] === 'posthog on 2026-10-14: 9 errors (2026-10-13: 0), 0 new kinds, 0 noise'));
}));

after(() => {
  assert.ok(passed > 0, 'unknown test suite');
  assert.equal(failed, 0);
  console.log(suite === 'all' ? 'ERROR COLLECTOR TESTS PASSED' : `${suite.toUpperCase()} PASS`);
});
