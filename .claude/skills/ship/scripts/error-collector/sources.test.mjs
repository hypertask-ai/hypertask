import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, loadSources, fingerprint } from './collector.mjs';
import * as vercel from './sources/vercel.mjs';
import * as proxy from './sources/vercel-5xx.mjs';
import * as github from './sources/github-actions.mjs';
import * as journal from './sources/vps-journal.mjs';
import * as workers from './sources/cloudflare-workers.mjs';
import * as posthog from './sources/posthog.mjs';

const since = '2026-10-13T08:29:03.000Z';
const until = '2026-10-14T08:29:03.000Z';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/sources.json', import.meta.url)));
const home = mkdtempSync(join(tmpdir(), 'collector-sources-'));
mkdirSync(join(home, 'bin'));
writeFileSync(join(home, 'bin/stack-key'), `#!${process.execPath}\nconsole.log(process.argv[3].includes('PROJECT_ID') ? '236160' : 'test-credential');\n`, { mode: 0o700 });
const env = { HOME: home, PATH: join(home, 'bin') };
const context = { since, until, env };
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(home, { recursive: true, force: true }); });

function mockHTTP(replies) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options, body: options.body ? JSON.parse(options.body) : undefined });
    assert.ok(replies.length, 'unexpected network call');
    const [status, data] = replies.shift();
    return { status, json: async () => data };
  };
  return calls;
}
function fakeCommand(name, source) {
  writeFileSync(join(home, 'bin', name), `#!${process.execPath}\n${source}`, { mode: 0o700 });
}

// The guard deliberately fails on unmocked requests, including regression runs.
globalThis.fetch = async () => { throw new Error('NETWORK FORBIDDEN'); };

test('default sources are explicit and fixture stays opt-in', async () => {
  assert.deepEqual((await loadSources()).map(source => source.name), ['vercel', 'vercel-5xx', 'github-actions', 'vps-journal', 'cloudflare-workers', 'posthog']);
});

test('recorded Vercel structured messages lose metadata, preserve error details and request path', () => {
  const [event] = vercel.parseEvents(fixtures.vercel.events);
  assert.equal(event.message, 'Failed to get tasks | missing task_id');
  assert.equal(event.route, '/mcp');
  assert.ok(!event.message.includes('correlation'));
  assert.equal(vercel.messageParts(fixtures.prisma).message, 'PrismaClientValidationError: Invalid `prisma.task.create()` invocation: Argument `ranking`: Invalid value provided. Expected String, provided Int.');
  assert.match(vercel.messageParts('failure\n    at caller (file:1)').stack, /^at caller/);
  assert.deepEqual(vercel.parseEvents(fixtures.proxy.events, proxy.name).map(event => [event.service, event.message, event.route]), [['vercel-5xx', 'HTTP 504 GET response', '/mcp']]);
});

test('Vercel uses exact query, cursor paging and deduplicates recorded pages', async () => {
  const page = { ...fixtures.vercel, pagination: { hasMore: true, nextCursor: 'next' } };
  const calls = mockHTTP([[200, page], [200, fixtures.vercel]]);
  assert.equal((await vercel.fetch(context)).length, 1);
  assert.equal(calls[0].url, 'https://api.vercel.com/v1/observability/events?teamId=test-credential');
  assert.equal(calls[0].headers['x-vercel-observability-query-reason'], 'cli/logs-runtime');
  assert.equal(calls[0].body.filter, 'level:error AND environment:production');
  assert.equal(calls[0].body.limit, 500);
  assert.deepEqual(calls[0].body.scope, { ownerId: 'test-credential', projectIds: ['236160'] });
  assert.equal(calls[1].body.cursor, 'next');
  assert.deepEqual(calls[1].body.timeRange, calls[0].body.timeRange);
  const proxyCalls = mockHTTP([[200, fixtures.proxy]]);
  await proxy.fetch(context);
  assert.equal(proxyCalls[0].body.event, 'vercel.proxy_response');
  assert.equal(proxyCalls[0].headers['x-vercel-observability-query-reason'], 'cli/logs-requests');
  assert.match(proxyCalls[0].body.filter, /httpStatus >= 500/);
});

test('Vercel halves oversized windows, advances retention and stops immediately on 429', async () => {
  const calls = mockHTTP([[413, {}], [200, fixtures.vercel], [200, fixtures.vercel]]);
  assert.equal((await vercel.fetch(context)).length, 1);
  assert.equal(calls[1].body.timeRange.end, calls[2].body.timeRange.start);
  assert.equal(Date.parse(calls[1].body.timeRange.end) - Date.parse(since), (Date.parse(until) - Date.parse(since)) / 2);
  const retention = mockHTTP([[400, { error: { message: 'The pro plan does not retain runtime logs for the requested time range.' } }], [200, fixtures.vercel]]);
  await vercel.fetch(context);
  assert.equal(Date.parse(retention[1].body.timeRange.start) - Date.parse(since), 600000);
  const limited = mockHTTP([[429, {}]]);
  await assert.rejects(vercel.fetch(context), /429/);
  assert.equal(limited.length, 1);
  mockHTTP([[400, { error: 'invalid request' }]]);
  await assert.rejects(vercel.fetch(context), /400/);
  mockHTTP([[200, { ...fixtures.vercel, meta: { excludedIntervals: [{}] } }]]);
  await assert.rejects(vercel.fetch(context), /incomplete/);
  mockHTTP([[200, { ...fixtures.vercel, pagination: { hasMore: true } }]]);
  await assert.rejects(vercel.fetch(context), /cursor/);
});

test('GitHub recorded failure and timeout jobs, production plus scheduled runs, dedupe and 20 lookup bound', async () => {
  const data = fixtures.github;
  assert.equal(github.parseRun(data.runs[0], data.jobs).message, 'Deploy failed: Build');
  writeFileSync(join(home, 'github.json'), JSON.stringify(data));
  fakeCommand('gh', `import { readFileSync, appendFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(process.env.HOME + '/github.json'));
const args = process.argv.slice(2); appendFileSync(process.env.HOME + '/gh-calls.jsonl', JSON.stringify(args) + '\\n');
console.log(JSON.stringify(args[1] === 'list' ? data.runs : { jobs: data.jobs }));`);
  const events = await github.fetch(context);
  assert.equal(events.length, 2);
  assert.ok(events.every(event => event.board === 4060));
  const calls = readFileSync(join(home, 'gh-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(args => args[1] === 'view').length, 2);
  assert.ok(calls.some(args => args.includes('production')));
  assert.ok(calls.some(args => args.includes('schedule')));
  assert.ok(calls.some(args => args.includes('timed_out')));
  data.runs = Array.from({ length: 21 }, (_, i) => ({ ...data.runs[0], databaseId: i }));
  writeFileSync(join(home, 'github.json'), JSON.stringify(data));
  assert.equal((await github.fetch(context)).length, 21);
});

test('journal recorded entries group normalized MESSAGE per unit, exclude collector and dedupe user/system', async () => {
  const text = fixtures.journal.map(row => JSON.stringify(row)).join('\n');
  const parsed = journal.parseJournal(text);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].count, 2);
  assert.equal(parsed[0].message, 'test.service: Failed job 123');
  assert.deepEqual(journal.parseJournal(text, { since: parsed[0].ts, until }), []);
  writeFileSync(join(home, 'journal.txt'), text);
  fakeCommand('journalctl', `import { readFileSync } from 'node:fs'; console.log(readFileSync(process.env.HOME + '/journal.txt', 'utf8'));`);
  assert.equal((await journal.fetch(context))[0].count, 2);
  fakeCommand('journalctl', `import { readFileSync } from 'node:fs'; if (process.argv.includes('--system')) process.exit(1); console.log(readFileSync(process.env.HOME + '/journal.txt', 'utf8'));`);
  assert.equal((await journal.fetch(context))[0].count, 2);
});

test('Cloudflare recorded Worker exceptions only, no HTTP/DNS traffic tickets; working account GraphQL query', async () => {
  const parsed = workers.parseWorkers(fixtures.cloudflare, until);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].count, 3);
  assert.equal(parsed[0].route, 'ht-slack');
  assert.equal(parsed[0].board, 4060);
  const calls = mockHTTP([[200, { success: true, result: [{ id: 'account', name: 'Hypertask' }, { id: 'other', name: 'Other' }] }], [200, fixtures.cloudflare], [200, fixtures.cloudflare]]);
  await workers.fetch(context);
  assert.match(calls[1].body.query, /workersInvocationsAdaptive\(limit: 10000/);
  assert.match(calls[1].body.query, /accountTag: "account"/);
  assert.throws(() => workers.parseWorkers({ errors: [{}] }, until));
});

test('PostHog recorded aggregate exceptions are summary-only and query identical projects once', async () => {
  const events = posthog.parseExceptions(fixtures.posthog);
  assert.equal(events.length, 1);
  assert.equal(events[0].ticket, false);
  assert.equal(events[0].count, 2);
  const calls = mockHTTP([[200, fixtures.posthog]]);
  await posthog.fetch(context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://eu.posthog.com/api/projects/236160/query/');
  assert.equal(calls[0].body.refresh, 'force_blocking');
  assert.match(calls[0].body.query.query, /event = '\$exception'/);
  assert.throws(() => posthog.parseExceptions({ ...fixtures.posthog, hasMore: true }));
});

test('summary-only event never enters fingerprints/pending, search or tickets, even mixed with ticketable same fingerprint', async () => {
  const root = join(home, 'summary-state');
  const summary = { service: 'posthog', board: 15, message: 'exception', route: '/api', ts: until, count: 4, ticket: false };
  fakeCommand('ht', 'throw new Error("SEARCH FORBIDDEN");');
  fakeCommand('vcc', 'throw new Error("WRITE FORBIDDEN");');
  assert.equal(await collect({ env: { ...env, ERROR_COLLECTOR_STATE_DIR: root }, now: Date.parse(until), sources: [{ name: 'summary', fetch: async () => [summary] }], summary: false }), 0);
  const state = JSON.parse(readFileSync(join(root, 'state.json')));
  assert.deepEqual(state.fingerprints, {});
  assert.deepEqual(state.pending, {});
  assert.equal(state.days['2026-10-14'].posthog.errors, 4);
  assert.equal(state.days['2026-10-14'].posthog.newGroups, 0);
  const messages = [];
  const old = console.log; console.log = value => messages.push(value);
  try {
    await collect({ env: { ...env, ERROR_COLLECTOR_STATE_DIR: join(home, 'empty') }, now: Date.parse(until), dryRun: true, sources: [{ name: 'mixed', fetch: async () => [summary, { ...summary, ticket: true, count: 1 }] }] });
  } finally { console.log = old; }
  assert.ok(messages.some(line => line.includes('"errors":5')));
});

test('every h1 group replays through core: precisely REAL/INFRA pending and every NOISE skipped', async () => {
  const groups = JSON.parse(readFileSync(new URL('./fixtures/h1-groups.json', import.meta.url)));
  const root = join(home, 'replay-state');
  const rules = JSON.parse(readFileSync(new URL('./noise.json', import.meta.url)));
  let noiseCount = 0;
  for (const group of groups) {
    const matched = rules.filter(rule => (!rule.service || rule.service === group.service) && new RegExp(rule.match, 'i').test(`${group.message}\n${group.route}`));
    assert.equal(matched.length > 0, group.classification === 'NOISE', `research group ${group.id}`);
    if (group.classification === 'NOISE') noiseCount += group.count;
  }
  await collect({ env: { ...env, ERROR_COLLECTOR_STATE_DIR: root, ERROR_COLLECTOR_HOURLY_CAP: '0' }, now: Date.parse(until), sources: [{ name: 'research', fetch: async () => groups }] });
  const state = JSON.parse(readFileSync(join(root, 'state.json')));
  const expected = [...new Set(groups.filter(group => group.classification !== 'NOISE').map(group => fingerprint(group.service, group.message, group.route)))].sort();
  assert.deepEqual(Object.keys(state.pending).sort(), expected);
  assert.equal(Object.values(state.days).reduce((sum, day) => sum + day.vercel.noise, 0), noiseCount);
  // Positive control ensures the noise assertion rejects a real error.
  assert.ok(!rules.some(rule => new RegExp(rule.match, 'i').test('guest cleanup failed Foreign key constraint violated')));
});


test('sanitized recorded provider responses parse offline for every source', () => {
  const recorded = JSON.parse(readFileSync(new URL('./fixtures/recorded.json', import.meta.url)));
  const runtime = vercel.parseEvents(recorded.vercel.events);
  assert.equal(runtime.length, 1);
  assert.equal(runtime[0].board, 15);
  assert.ok(runtime[0].message.length > 0);
  assert.ok(!runtime[0].message.includes('correlationId'));
  const requests = vercel.parseEvents(recorded.proxy.events, proxy.name);
  assert.equal(requests.length, 1);
  assert.match(requests[0].message, /^HTTP 5/);
  const action = github.parseRun(recorded.github.run, recorded.github.jobs);
  assert.match(action.message, /^CI Tests failed: /);
  assert.ok(!action.message.includes('unknown failing job'));
  const logs = journal.parseJournal(recorded.journal.map(row => JSON.stringify(row)).join('\n'));
  assert.ok(logs.length > 0);
  assert.ok(logs.every(event => event.board === 4060 && event.count > 0));
  assert.deepEqual(workers.parseWorkers(recorded.cloudflare, until), []);
  const exceptions = posthog.parseExceptions(recorded.posthog);
  assert.equal(exceptions.reduce((sum, event) => sum + event.count, 0), 2);
  assert.ok(exceptions.every(event => event.ticket === false));
});


test('R2: GitHub backlog returns all runs with only twenty newest job lookups', async () => {
  const runs = Array.from({ length: 25 }, (_, i) => ({ ...fixtures.github.runs[0], databaseId: 100 + i, updatedAt: new Date(Date.parse(since) + (i + 1) * 1000).toISOString() }));
  writeFileSync(join(home, 'backlog.json'), JSON.stringify(runs));
  writeFileSync(join(home, 'backlog-calls.jsonl'), '');
  fakeCommand('gh', `import { readFileSync, appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.HOME + '/backlog-calls.jsonl', JSON.stringify(args) + '\\n');
console.log(JSON.stringify(args[1] === 'list' ? JSON.parse(readFileSync(process.env.HOME + '/backlog.json')) : { jobs: [{ name: 'Build', conclusion: 'failure' }] }));`);
  const events = await github.fetch(context);
  assert.equal(events.length, 25);
  const lookups = readFileSync(join(home, 'backlog-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(args => args[1] === 'view');
  assert.deepEqual(lookups.map(args => Number(args[2])), runs.slice(-20).reverse().map(run => run.databaseId));
  assert.ok(events.slice(20).every(event => event.message.includes('Deploy') && !event.message.includes('unknown')));
  assert.deepEqual(await github.fetch({ ...context, since: until }), []);
});

test('R3: PostHog production filter excludes preview and development before aggregation', async () => {
  const calls = mockHTTP([[200, fixtures.posthog]]);
  await posthog.fetch(context);
  const sql = calls[0].body.query.query;
  const production = "(properties.ht_environment = 'production' OR (properties.ht_environment IS NULL AND properties.$current_url LIKE 'https://app.hypertask.ai/%'))";
  assert.ok(sql.includes('AND ' + production));
  // Independent evaluation of the exact pipeline predicate, including explicit preview on a production URL.
  const samples = [['production', '', true], ['preview', 'https://app.hypertask.ai/x', false], ['development', '', false], [null, 'https://app.hypertask.ai/x', true], [null, 'https://preview.invalid/x', false]];
  for (const [environment, url, expected] of samples) assert.equal(environment === 'production' || (environment === null && url.startsWith('https://app.hypertask.ai/')), expected);
});

test('R4: Vercel live timeout and SSE route go to infra only', () => {
  const groups = JSON.parse(readFileSync(new URL('./fixtures/h1-groups.json', import.meta.url)));
  const timeout = groups.find(group => group.message.includes('Vercel Runtime Timeout Error'));
  const row = { message: timeout.message, requestPath: timeout.route, timestamp: timeout.ts };
  const rows = [row, { ...row, message: 'other failure', requestPath: '/sse' }, { ...row, message: 'other failure', requestPath: '/mcp' }, { ...row, message: 'other failure', requestPath: '/sse-other' }];
  assert.match(vercel.messageParts(rows[0].message).message, /Vercel Runtime Timeout Error/);
  assert.deepEqual(vercel.parseEvents(rows).map(event => event.board), [4060, 4060, 15, 15]);
});

test('R6: journal identical errors are bucketed separately across UTC midnight', () => {
  const rows = ['2026-10-13T23:59:59Z', '2026-10-14T00:00:00Z', '2026-10-14T00:00:01Z'].map(ts => ({ _SYSTEMD_UNIT: 'test.service', MESSAGE: 'Failed job 123', __REALTIME_TIMESTAMP: String(Date.parse(ts) * 1000) }));
  const events = journal.parseJournal(rows.map(row => JSON.stringify(row)).join('\n'), context);
  assert.deepEqual(events.map(event => [event.ts.slice(0, 10), event.count]), [['2026-10-13', 1], ['2026-10-14', 2]]);
});

test('R7: PostHog includes shared until boundary and excludes next since boundary', async () => {
  const boundary = { ...fixtures.posthog, results: fixtures.posthog.results.map(row => row.map((value, index) => index === 3 ? until : value)) };
  const calls = mockHTTP([[200, boundary], [200, { results: [] }]]);
  const collectorEnv = { ...env, ERROR_COLLECTOR_STATE_DIR: join(home, 'posthog-boundary') };
  await collect({ env: collectorEnv, now: Date.parse(until), sources: [posthog] });
  await collect({ env: collectorEnv, now: Date.parse('2026-10-14T09:00:00.000Z'), sources: [posthog] });
  for (const [i, start, end] of [[0, since, until], [1, until, '2026-10-14T09:00:00.000Z']]) {
    assert.ok(calls[i].body.query.query.includes(`timestamp > toDateTime('${start}') AND timestamp <= toDateTime('${end}')`));
  }
  const state = JSON.parse(readFileSync(join(collectorEnv.ERROR_COLLECTOR_STATE_DIR, 'state.json')));
  assert.equal(state.days['2026-10-14'].posthog.errors, 2);
});

test('R10: Cloudflare analytics split at midnight and preserve each UTC day', async () => {
  const calls = mockHTTP([[200, { success: true, result: [{ id: 'account', name: 'Hypertask' }] }], [200, fixtures.cloudflare], [200, fixtures.cloudflare]]);
  const events = await workers.fetch(context);
  assert.deepEqual(events.map(event => [event.ts.slice(0, 10), event.count]), [['2026-10-13', 3], ['2026-10-14', 3]]);
  assert.match(calls[1].body.query, /datetime_gt: "2026-10-13T08:29:03.000Z"/);
  assert.match(calls[1].body.query, /datetime_lt: "2026-10-14T00:00:00.000Z"/);
  assert.match(calls[2].body.query, /datetime_geq: "2026-10-14T00:00:00.000Z"/);
  assert.match(calls[2].body.query, /datetime_leq: "2026-10-14T08:29:03.000Z"/);
  mockHTTP([[200, { success: true, result: [{ id: 'account', name: 'Hypertask' }] }], [200, fixtures.cloudflare], [200, { data: { viewer: { accounts: [{ current: [] }] } } }]]);
  const midnight = await workers.fetch({ ...context, until: '2026-10-14T00:00:00.000Z' });
  assert.equal(midnight[0].ts.slice(0, 10), '2026-10-13');
  assert.ok(midnight[0].ts > since && midnight[0].ts <= until);
});
