import { createHash } from 'node:crypto';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, loadSources, fingerprint, isNoise } from './collector.mjs';
import * as vercel from './sources/vercel.mjs';
import * as proxy from './sources/vercel-5xx.mjs';
import * as realtime from './sources/realtime.mjs';
import * as github from './sources/github-actions.mjs';
import * as journal from './sources/vps-journal.mjs';
import * as workers from './sources/cloudflare-workers.mjs';
import * as posthog from './sources/posthog.mjs';
import * as neon from './sources/neon.mjs';

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
  assert.deepEqual((await loadSources()).map(source => source.name), ['vercel', 'vercel-5xx', 'realtime', 'github-actions', 'vps-journal', 'cloudflare-workers', 'posthog', 'neon']);
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
console.log(JSON.stringify(args[1] === 'list' ? (args[args.indexOf('--repo') + 1] === 'hypertask-ai/docs' ? data.docsRuns : data.runs) : { jobs: data.jobs }));`);
  const events = await github.fetch(context);
  assert.equal(events.length, 4);
  const docs = events.filter(event => event.message.startsWith('docs: '));
  assert.equal(docs.length, 2);
  assert.equal(docs[0].message, 'docs: Build and Deploy failed: Build');
  assert.equal(docs[0].stack, 'https://github.com/hypertask-ai/docs/actions/runs/100');
  assert.equal(events.find(event => event.message === 'Deploy failed: Build').stack, 'https://github.com/hypertask-ai/hypertask/actions/runs/100');
  assert.notEqual(fingerprint(github.name, docs[0].message), fingerprint(github.name, 'Build and Deploy failed: Build'));
  assert.ok(events.every(event => event.board === 4060));
  const calls = readFileSync(join(home, 'gh-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(args => args[1] === 'view').length, 4);
  for (const [repo, branch] of [['hypertask-ai/hypertask', 'production'], ['hypertask-ai/docs', 'main']]) {
    assert.ok(calls.some(args => args.includes(repo) && args.includes(branch)));
    assert.ok(calls.some(args => args.includes(repo) && args.includes('schedule')));
  }
  assert.ok(calls.some(args => args.includes('schedule')));
  assert.ok(calls.some(args => args.includes('completed')));
  data.runs = Array.from({ length: 21 }, (_, i) => ({ ...data.runs[0], databaseId: i }));
  writeFileSync(join(home, 'github.json'), JSON.stringify(data));
  assert.equal((await github.fetch(context)).length, 23);
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

test('every h1 group replays through core: REAL/INFRA pending, noise stays noise with opted-in hourly alerts', async () => {
  const groups = JSON.parse(readFileSync(new URL('./fixtures/h1-groups.json', import.meta.url)));
  const root = join(home, 'replay-state');
  const rules = JSON.parse(readFileSync(new URL('./noise.json', import.meta.url)));
  let noiseCount = 0;
  for (const group of groups) {
    const matched = rules.filter(rule => (!rule.service || rule.service === group.service) && new RegExp(rule.match, 'i').test(`${group.message}\n${group.route}`));
    assert.equal(matched.length > 0, group.classification === 'NOISE', `research group ${group.id}`);
    if (group.classification === 'NOISE') noiseCount += group.count;
  }
  // This classification replay spans a full day; keep all groups inside its filing window.
  await collect({ env: { ...env, ERROR_COLLECTOR_STATE_DIR: root, ERROR_COLLECTOR_HOURLY_CAP: '0', ERROR_COLLECTOR_STALE_HOURS: '24' }, now: Date.parse(until), sources: [{ name: 'research', fetch: async () => groups }] });
  const state = JSON.parse(readFileSync(join(root, 'state.json')));
  const expected = [...new Set(groups.filter(group => group.classification !== 'NOISE').map(group => fingerprint(group.service, group.message, group.route)))].sort();
  assert.deepEqual(Object.keys(state.pending).filter(fp => !state.pending[fp].noiseRule).sort(), expected);
  const alerts = new Map();
  for (const group of groups.filter(group => group.classification === 'NOISE')) {
    const rule = rules.find(rule => rule.alert && (!rule.service || rule.service === group.service) && new RegExp(rule.match, 'i').test(`${group.message}\n${group.route}`));
    if (!rule) continue;
    const fp = createHash('sha256').update(`noise|${group.service}|${rule.id}`).digest('hex').slice(0, 16);
    if (!alerts.has(fp)) alerts.set(fp, []);
    alerts.get(fp).push(group);
  }
  const expectedAlerts = [...alerts].filter(([, events]) => events.some(end => events.filter(event => Date.parse(event.ts) > Date.parse(end.ts) - 3600000 && event.ts <= end.ts).reduce((count, event) => count + event.count, 0) > 50)).map(([fp]) => fp).sort();
  assert.deepEqual(Object.keys(state.pending).filter(fp => state.pending[fp].noiseRule).sort(), expectedAlerts);
  assert.equal(Object.values(state.days).reduce((sum, day) => sum + day.vercel.errors, 0), groups.filter(group => group.classification !== 'NOISE').reduce((sum, group) => sum + group.count, 0));
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
console.log(JSON.stringify(args[1] === 'list' ? (args.includes('hypertask-ai/docs') ? [] : JSON.parse(readFileSync(process.env.HOME + '/backlog.json'))) : { jobs: [{ name: 'Build', conclusion: 'failure' }] }));`);
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

test('YPER4-358: dead outgoing board and agent webhooks go to infra, other webhook text stays on 15', () => {
  const row = { requestPath: '/api/webhooks/qstash', timestamp: '2026-10-14T10:00:00.000Z' };
  const messages = [
    '[board-webhook] delivery failed after 8 attempts (HTTP 500)',
    '[board-webhook] delivery failed after its worker stopped (no response)',
    '[agent-webhook] delivery failed after 6 attempts (no response)',
    'GitHub webhook [board-webhook] delivery failed',
  ];
  const events = vercel.parseEvents(messages.map(message => ({ ...row, message })));
  assert.deepEqual(events.map(event => event.board), [4060, 4060, 4060, 15]);
  assert.equal(events[0].message, messages[0]);
});

test('YPER4-359: email event prefix routes to email/infra, embedded text stays on vercel/15', () => {
  const row = { requestPath: '/api/webhooks/resend-events', timestamp: until };
  const messages = ['[email-event] email.bounced (Permanent, General)', 'other [email-event] text'];
  const events = vercel.parseEvents(messages.map(message => ({ ...row, message })));
  assert.deepEqual(events.map(event => [event.service, event.board]), [['email', 4060], ['vercel', 15]]);
  assert.deepEqual(events.map(event => event.message), messages);
});

test('YPER4-356: CLI error logs route to cli/15 and group across versions and OSes', async () => {
  const events = vercel.parseEvents(fixtures.cli.events);
  assert.deepEqual(events.map(event => [event.service, event.board]), [['cli', 15], ['cli', 15], ['cli', 15]]);
  assert.deepEqual(events.map(event => event.message), [
    '[cli-error] task create: ApiFailure (HTTP 503)',
    '[cli-error] task create: ApiFailure (HTTP 503)',
    '[cli-error] login: NoToken',
  ]);
  assert.deepEqual(events.map(event => event.stack), ['v0.2.0 linux', 'v0.3.1-beta.2+abc macos', 'v0.3.1 windows']);
  assert.equal(fingerprint(events[0].service, events[0].message, events[0].route), fingerprint(events[1].service, events[1].message, events[1].route));
  assert.notEqual(fingerprint(events[0].service, events[0].message, events[0].route), fingerprint(events[2].service, events[2].message, events[2].route));
  const calls = mockHTTP([[200, { events: fixtures.cli.events, pagination: { hasMore: false } }]]);
  assert.deepEqual(await vercel.fetch(context), events);
  assert.equal(calls[0].body.filter, 'level:error AND environment:production');
});

test('YPER4-356: only a leading CLI prefix routes to cli; metadata and existing frames stay in stack', () => {
  const row = { requestPath: '/api/mcp/cli-error', timestamp: until };
  const events = vercel.parseEvents([
    { ...row, message: 'other [cli-error] text v0.2.0 linux' },
    { ...row, message: '[cli-error] login: NoToken v0.2.0 other\n    at caller (file:1)' },
    { ...row, message: '[cli-error] malformed without metadata' },
    { ...row, message: '[cli-error] task create: ApiFailure (HTTP 500) v0.2.0 linux' },
  ]);
  assert.deepEqual(events.map(event => [event.service, event.board]), [['vercel', 15], ['cli', 15], ['cli', 15], ['cli', 15]]);
  assert.equal(events[0].message, 'other [cli-error] text v0.2.0 linux');
  assert.equal(events[1].message, '[cli-error] login: NoToken');
  assert.equal(events[1].stack, 'v0.2.0 other\nat caller (file:1)');
  assert.equal(events[2].message, '[cli-error] malformed without metadata');
  assert.equal(events[2].stack, '');
  assert.equal(events[3].message, '[cli-error] task create: ApiFailure (HTTP 500)');
  assert.deepEqual(vercel.parseEvents([{ ...row, message: fixtures.cli.events[0].message, httpStatus: 503 }], proxy.name).map(event => event.service), ['vercel-5xx']);
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

const neonURL = ['postgresql://stats_reader', 'fixture-password@ep-fixture.neon.invalid/stats?sslmode=require'].join(':');
const neonFile = join(home, '.local/state/error-collector/neon-stats.url');
mkdirSync(join(home, '.local/state/error-collector'), { recursive: true });
writeFileSync(neonFile, `${neonURL}\n`, { mode: 0o600 });

function neonHTTP({ slow = fixtures.neon.slow, counters = fixtures.neon.counters } = {}) {
  return mockHTTP([[200, structuredClone(slow)], [200, structuredClone(counters)]]);
}

test('Neon bounded HTTPS function reads, thresholds, stable query message and grouping despite changing metrics', async () => {
  const calls = neonHTTP();
  const first = await neon.fetch(context);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://ep-fixture.neon.invalid/sql');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls[0].headers['Neon-Connection-String'], neonURL);
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.deepEqual(calls[0].body, { query: 'SELECT * FROM ops_stats.slow_queries($1::double precision, $2::integer)', params: [1000, 50] });
  assert.deepEqual(calls[1].body, { query: 'SELECT * FROM ops_stats.db_counters()', params: [] });
  assert.equal(first.events.length, 1);
  const event = first.events[0];
  assert.equal(event.message, 'slow query: SELECT id FROM sample_tasks WHERE id = $1');
  assert.equal(event.service, 'neon');
  assert.equal(event.board, 4060);
  assert.equal(event.ts, until);
  assert.equal(event.count, 1);
  assert.match(event.stack, /calls: 9007199254740993\nmean_ms: 1600\nmax_ms: 4200\ntotal_ms: 16000/);
  const slow = structuredClone(fixtures.neon.slow);
  Object.assign(slow.rows[0], { calls: '9007199254740994', mean_ms: 1800, max_ms: 5000, total_ms: 20000, query: 'SELECT  id\nFROM sample_tasks WHERE id = $1' });
  neonHTTP({ slow });
  const second = await neon.fetch(context);
  assert.equal(second.events[0].message, event.message);
  assert.equal(fingerprint('neon', second.events[0].message), fingerprint('neon', event.message));
  assert.notEqual(second.events[0].stack, event.stack);
  const higher = neonHTTP();
  assert.deepEqual((await neon.fetch({ ...context, env: { ...env, NEON_SLOW_QUERY_MS: '1601' } })).events, []);
  assert.equal(higher[0].body.params[0], 1601);
  neonHTTP();
  assert.equal((await neon.fetch({ ...context, env: { ...env, NEON_SLOW_QUERY_MS: '1600' } })).events.length, 1);
  neonHTTP();
  assert.equal((await neon.fetch({ ...context, env: { ...env, HOME: '/missing', NEON_STATS_URL_FILE: neonFile } })).events.length, 1);
});

test('Neon missing/unreadable login, HTTP, network and malformed response failures never expose credentials', async () => {
  const safeFailure = error => {
    assert.equal(error.message, 'Neon statistics read failed');
    assert.ok(!String(error.stack).includes(neonURL));
    assert.ok(!String(error.stack).includes('fixture-password'));
    return true;
  };
  const calls = mockHTTP([]);
  for (const path of [join(home, 'absent.url'), home]) {
    await assert.rejects(neon.fetch({ ...context, env: { ...env, NEON_STATS_URL_FILE: path } }), safeFailure);
  }
  assert.equal(calls.length, 0);
  for (const status of [302, 401, 429, 500]) {
    const denied = mockHTTP([[status, { error: neonURL }]]);
    await assert.rejects(neon.fetch(context), safeFailure);
    assert.equal(denied.length, 1);
  }
  globalThis.fetch = async () => { throw new Error(neonURL); };
  await assert.rejects(neon.fetch(context), safeFailure);
  globalThis.fetch = async () => ({ status: 200, json: async () => { throw new Error(neonURL); } });
  await assert.rejects(neon.fetch(context), safeFailure);
  for (const slow of [{}, { rows: [{}] }, { rows: Array(51).fill(fixtures.neon.slow.rows[0]) }]) {
    mockHTTP([[200, slow]]);
    await assert.rejects(neon.fetch(context), safeFailure);
  }
  for (const counters of [{ rows: [] }, { rows: [{ ...fixtures.neon.counters.rows[0], deadlocks: '-1' }] }, { rows: [{ ...fixtures.neon.counters.rows[0], read_at: 'invalid' }] }]) {
    neonHTTP({ counters });
    await assert.rejects(neon.fetch(context), safeFailure);
  }
  for (const config of [{ NEON_SLOW_QUERY_MS: 'invalid' }, { NEON_SLOW_QUERY_MS: '-1' }, { NEON_ROLLBACK_ALERT: '1.5' }, { NEON_ROLLBACK_ALERT: '-1' }]) {
    const unused = mockHTTP([]);
    await assert.rejects(neon.fetch({ ...context, env: { ...env, ...config } }), safeFailure);
    assert.equal(unused.length, 0);
  }
});

test('Neon first reading is a baseline; exact bigint deltas and rollback threshold produce stable messages', async () => {
  neonHTTP({ slow: { rows: [] } });
  const first = await neon.fetch(context);
  assert.deepEqual(first.events, []);
  assert.equal(first.cursor.xact_commit, '9007199254740993');
  assert.equal(first.cursor.stats_reset, '2026-10-13T00:00:00.000Z');
  const counters = structuredClone(fixtures.neon.counters);
  Object.assign(counters.rows[0], { xact_rollback: '600', deadlocks: '4', conflicts: '6', read_at: '2026-10-14T08:44:03Z' });
  neonHTTP({ slow: { rows: [] }, counters });
  const second = await neon.fetch({ ...context, cursor: first.cursor });
  assert.deepEqual(second.events.map(event => [event.message, event.count]), [['database deadlocks increased', 2], ['database conflicts increased', 3]]);
  assert.ok(second.events.every(event => event.service === 'neon' && event.board === 4060 && event.ts === until));
  assert.match(second.events[0].stack, /delta: 2/);
  counters.rows[0].xact_rollback = '601';
  neonHTTP({ slow: { rows: [] }, counters });
  const third = await neon.fetch({ ...context, cursor: first.cursor });
  assert.equal(third.events.at(-1).message, 'database xact_rollback increased');
  assert.equal(third.events.at(-1).count, 501);
  neonHTTP({ slow: { rows: [] }, counters });
  assert.deepEqual((await neon.fetch({ ...context, cursor: third.cursor })).events, []);
  neonHTTP({ slow: { rows: [] }, counters });
  assert.equal((await neon.fetch({ ...context, cursor: first.cursor, env: { ...env, NEON_ROLLBACK_ALERT: '501' } })).events.length, 2);
  counters.rows[0].xact_rollback = '101';
  neonHTTP({ slow: { rows: [] }, counters });
  assert.equal((await neon.fetch({ ...context, cursor: first.cursor, env: { ...env, NEON_ROLLBACK_ALERT: '0' } })).events.at(-1).count, 1);
  // Precision is retained even when the cumulative value is above Number.MAX_SAFE_INTEGER.
  const huge = { ...first.cursor, deadlocks: '9007199254740993' };
  counters.rows[0].deadlocks = '9007199254740994';
  neonHTTP({ slow: { rows: [] }, counters });
  assert.equal((await neon.fetch({ ...context, cursor: huge })).events[0].count, 1);
});

test('Neon changed stats_reset or any decreasing counter establishes a fresh baseline without alerts', async () => {
  neonHTTP({ slow: { rows: [] } });
  const { cursor } = await neon.fetch(context);
  for (const change of [{ stats_reset: '2026-10-14T00:00:00Z' }, { deadlocks: '1' }, { xact_commit: '1' }, { temp_bytes: '0' }]) {
    const counters = structuredClone(fixtures.neon.counters);
    Object.assign(counters.rows[0], { conflicts: '100', xact_rollback: '10000' }, change);
    neonHTTP({ slow: { rows: [] }, counters });
    const reset = await neon.fetch({ ...context, cursor });
    assert.deepEqual(reset.events, []);
    assert.equal(reset.cursor.xact_rollback, '10000');
  }
  const counters = structuredClone(fixtures.neon.counters);
  counters.rows[0].stats_reset = null;
  neonHTTP({ slow: { rows: [] }, counters });
  const baseline = await neon.fetch(context);
  assert.equal(baseline.cursor.stats_reset, null);
  counters.rows[0].deadlocks = '3';
  neonHTTP({ slow: { rows: [] }, counters });
  assert.equal((await neon.fetch({ ...context, cursor: baseline.cursor })).events[0].count, 1);
});

const realtimeFixture = JSON.parse(readFileSync(new URL('./fixtures/realtime.json', import.meta.url)));

test('YPER4-360: realtime reads production warning/error logs, pages and dedupes before selecting broadcast failures', async () => {
  const first = { ...realtimeFixture.page, pagination: { hasMore: true, nextCursor: 'realtime-page-2' } };
  const calls = mockHTTP([[200, first], [200, realtimeFixture.page]]);
  const events = await realtime.fetch(context);
  assert.equal(calls[0].body.event, 'vercel.log');
  assert.equal(calls[0].body.filter, '(level:warn OR level:error) AND environment:production');
  assert.equal(calls[0].headers['x-vercel-observability-query-reason'], 'cli/logs-runtime');
  assert.equal(calls[0].body.limit, 500);
  assert.equal(calls[1].body.cursor, 'realtime-page-2');
  assert.equal(events.length, 2);
  assert.ok(events.every(event => event.service === 'realtime' && event.board === 4060 && event.count === 1));
  assert.deepEqual(events.map(event => event.route), ['/api/tasks/single', '/api/mcp/tasks/update']);
  assert.equal(events[0].ts, realtimeFixture.page.events[0].timestamp);
  assert.match(events[0].stack, /^at trigger/);
  assert.equal(fingerprint('realtime', events[0].message), fingerprint('realtime', events[1].message));
  // Error-level copies belong only to realtime, never both runtime sources.
  assert.deepEqual(vercel.parseEvents([realtimeFixture.page.events[1]]), []);
  mockHTTP([[200, realtimeFixture.empty]]);
  assert.deepEqual(await realtime.fetch(context), []);
});

test('YPER4-360: realtime ignores unrelated warnings and near-matching text; ordinary runtime errors remain collected', () => {
  const row = realtimeFixture.page.events[0];
  const unrelated = ['Other failure', 'prefix [realtime] broadcast failed', '[realtime] broadcast failedness', '[realtime] connected'];
  const rows = unrelated.map(message => ({ ...row, message }));
  assert.deepEqual(vercel.parseEvents(rows, realtime.name), []);
  assert.equal(vercel.parseEvents(rows).length, rows.length);
  assert.ok(vercel.parseEvents(rows).every(event => event.service === 'vercel' && event.board === 15));
  assert.equal(vercel.parseEvents([{ ...row, message: '[realtime] broadcast failed' }], realtime.name).length, 1);
  const callers = ['[cycle-rollover] realtime broadcast failed', '[tasks/single] task realtime broadcast failed', '[agent-run] runtime run board broadcast failed'];
  assert.equal(vercel.parseEvents(callers.map(message => ({ ...row, message })), realtime.name).length, callers.length);
});

test('YPER4-402: realtime collects console.warn broadcast failures, which Vercel stores as level warn', async () => {
  const messages = ['[feature-flags] realtime broadcast failed Error: socket hang up', '[agent-run] Agent Chat activity broadcast failed Error: 500'];
  const rows = messages.map(message => ({ ...realtimeFixture.page.events[0], level: 'warn', message }));
  const calls = mockHTTP([[200, { events: rows, pagination: { hasMore: false } }]]);
  const events = await realtime.fetch(context);
  assert.match(calls[0].body.filter, /\blevel:warn\b/);
  assert.doesNotMatch(calls[0].body.filter, /level:warning/);
  assert.deepEqual(events.map(event => event.message.split(' Error')[0]), ['[feature-flags] realtime broadcast failed', '[agent-run] Agent Chat activity broadcast failed']);
  assert.ok(events.every(event => event.service === 'realtime' && event.board === 4060));
});

test('YPER4-360: realtime query failures/incomplete pages fail closed without exposing provider bodies', async () => {
  for (const [status, data] of [[401, { error: 'private-provider-body' }], [429, {}], [200, {}], [200, { events: [{ ...realtimeFixture.page.events[0], truncated: true }] }], [200, { ...realtimeFixture.empty, meta: { excludedIntervals: [{}] } }], [200, { ...realtimeFixture.empty, pagination: { hasMore: true } }]]) {
    mockHTTP([[status, data]]);
    await assert.rejects(realtime.fetch(context), error => !String(error.stack).includes('private-provider-body'));
  }
});

test('YPER4-360: realtime collector groups normalized failures once and keeps its cursor on failure', async () => {
  const root = join(home, 'realtime-state');
  const collectorEnv = { ...env, ERROR_COLLECTOR_STATE_DIR: root, ERROR_COLLECTOR_HOURLY_CAP: '0' };
  fakeCommand('ht', 'console.log(JSON.stringify({ success: true, tasks: [], total: 0 }));');
  fakeCommand('vcc', 'throw new Error("WRITE FORBIDDEN");');
  mockHTTP([[200, realtimeFixture.page]]);
  assert.equal(await collect({ env: collectorEnv, now: Date.parse(until), sources: [realtime] }), 0);
  const before = readFileSync(join(root, 'state.json'), 'utf8');
  const state = JSON.parse(before);
  assert.equal(state.sources.realtime, until);
  assert.equal(state.days['2026-10-14'].realtime.errors, 2);
  assert.equal(Object.keys(state.pending).length, 1);
  assert.equal(Object.values(state.pending)[0].board, 4060);
  assert.equal(Object.values(state.pending)[0].count, 2);
  mockHTTP([[503, {}]]);
  assert.equal(await collect({ env: collectorEnv, now: Date.parse(until) + 1000, sources: [realtime] }), 1);
  assert.equal(readFileSync(join(root, 'state.json'), 'utf8'), before);
  mockHTTP([[200, realtimeFixture.empty]]);
  assert.equal(await collect({ env: collectorEnv, now: Date.parse(until) + 1000, sources: [realtime], dryRun: true }), 0);
  assert.equal(readFileSync(join(root, 'state.json'), 'utf8'), before);
});


test('YPER4-360: failed server-to-Pusher authentication and aborted publishes are errors, not expected client noise', () => {
  for (const detail of ['HTTP 401 Unauthorized', 'HTTP 403 Forbidden', 'HTTP 404 Not Found', 'AbortError']) {
    const message = `[realtime] broadcast failed private-board-123 board.changed ${detail}`;
    assert.equal(isNoise({ service: 'realtime', message, route: '/api/tasks/single' }), false);
    assert.equal(isNoise({ service: 'vercel', message, route: '/api/tasks/single' }), true);
  }
  assert.equal(isNoise({ service: 'realtime', message: '[realtime] broadcast failed [ht-forced-test]', route: '' }), true);
});


test('run boundaries include GitHub recovery and systemd completion, without multiplying failure runs', async () => {
  const githubSuccess = github.parseRun({ ...fixtures.github.runs[0], databaseId: 100, conclusion: 'success' }, []);
  assert.equal(githubSuccess.outcome, 'success');
  assert.equal(githubSuccess.unit, 'hypertask-ai/hypertask/Deploy');
  assert.equal(githubSuccess.runId, '100');
  assert.equal(github.parseRun({ ...fixtures.github.runs[0], workflowName: 'Prod Health Check + Auto-Rollback' }, []).userFacing, true);
  const lines = [
    { USER_UNIT: 'backup.service', _SYSTEMD_USER_UNIT: 'init.scope', MESSAGE: 'Failed to start backup.service', JOB_RESULT: 'failed', __CURSOR: 'run-a', __REALTIME_TIMESTAMP: '1791966000000000' },
    { USER_UNIT: 'backup.service', _SYSTEMD_USER_UNIT: 'init.scope', MESSAGE: 'Finished backup.service', JOB_RESULT: 'done', __CURSOR: 'run-b', __REALTIME_TIMESTAMP: '1791966001000000' },
    { _SYSTEMD_USER_UNIT: 'nginx.service', MESSAGE: 'Listen failed', __REALTIME_TIMESTAMP: '1791966002000000' },
  ];
  const events = journal.parseJournal(lines.map(row => JSON.stringify(row)).join('\n'));
  assert.deepEqual(events.map(row => [row.unit, row.outcome, row.userFacing]), [['backup.service', 'failure', false], ['backup.service', 'success', false], ['nginx.service', undefined, true]]);
  assert.equal(events[0].runId, 'run-a');
  const [observer] = journal.parseJournal(JSON.stringify({ ...lines[0], USER_UNIT: 'igsh976-observe-180200.service', MESSAGE: 'Failed to start igsh976-observe-180200.service - gate observer' }));
  assert.equal(isNoise(observer), true);
  assert.equal(isNoise(events[0]), false);
  const root = join(home, 'run-boundary-state');
  fakeCommand('ht', `console.log(JSON.stringify({ success: true, tasks: [], total: 0 }));`);
  fakeCommand('vcc', 'throw new Error("WRITE FORBIDDEN");');
  const failures = [1, 2, 3].map(n => ({ ...events[0], runId: String(n), ts: new Date(Date.parse(until) - (4 - n) * 1000).toISOString() }));
  await collect({ env: { ...env, ERROR_COLLECTOR_STATE_DIR: root, ERROR_COLLECTOR_HOURLY_CAP: '0' }, now: Date.parse(until), sources: [{ name: 'runs', fetch: async () => failures }] });
  const state = JSON.parse(readFileSync(join(root, 'state.json')));
  assert.equal(Object.keys(state.pending).length, 1);
  assert.equal(Object.values(state.pending)[0].escalation, true);
  assert.equal(Object.values(state.weekly['2026-10-12'].units)[0].count, 3);
});
