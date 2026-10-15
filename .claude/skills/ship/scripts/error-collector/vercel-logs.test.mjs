import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, logFilter, readLogs } from './vercel-logs.mjs';

const home = mkdtempSync(join(tmpdir(), 'vercel-logs-'));
mkdirSync(join(home, 'bin'));
writeFileSync(join(home, 'bin/stack-key'), `#!${process.execPath}\nconsole.log(process.argv[3].includes('TEAM_ID') ? 'team_1' : process.argv[3].includes('PROJECT_ID') ? 'prj_1' : 'test-credential');\n`, { mode: 0o700 });
const env = { HOME: home, PATH: join(home, 'bin') };
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; rmSync(home, { recursive: true, force: true }); });

const now = Date.parse('2026-10-15T03:00:00Z');

test('relative and absolute --since become an exact time range', () => {
  assert.deepEqual(parseArgs(['--since', '25m'], now), { since: '25m', limit: 50, start: '2026-10-15T02:35:00.000Z', end: '2026-10-15T03:00:00.000Z' });
  assert.equal(parseArgs(['--since', '2026-10-15T01:00:00Z', '-n', '5'], now).start, '2026-10-15T01:00:00.000Z');
});

test('bad arguments are refused before any network call', () => {
  for (const argv of [['--since', 'yesterday'], ['-n', '0'], ['-n', '501'], ['--level', 'debug'], ['--path', '/x" OR level:info'], ['--bogus', '1'], ['--since']]) {
    assert.throws(() => parseArgs(argv, now), undefined, argv.join(' '));
  }
});

test('the filter always pins production and adds only what was asked', () => {
  assert.equal(logFilter({}), 'environment:production');
  assert.equal(logFilter({ level: 'error', path: '/api/ai/chat/stream' }), 'environment:production AND level:error AND requestPath:"/api/ai/chat/stream"');
});

test('reads through api.vercel.com, never the challenged vercel.com host', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), auth: options.headers.Authorization });
    return { status: 200, json: async () => ({ events: [
      { timestamp: 't2', level: 'error', requestMethod: 'POST', requestPath: '/api/a', deploymentId: 'dpl_1', message: 'boom one', projectId: 'drop' },
      { timestamp: 't1', level: 'error', requestMethod: 'GET', requestPath: '/api/b', deploymentId: 'dpl_1', message: 'quiet' },
    ] }) };
  };
  const rows = await readLogs({ ...parseArgs(['--level', 'error', '--search', 'boom', '-n', '1'], now) }, env);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).host, 'api.vercel.com');
  assert.equal(calls[0].url, 'https://api.vercel.com/v1/observability/events?teamId=team_1');
  assert.equal(calls[0].auth, 'Bearer test-credential');
  assert.deepEqual(calls[0].body.scope, { ownerId: 'team_1', projectIds: ['prj_1'] });
  assert.equal(calls[0].body.filter, 'environment:production AND level:error');
  assert.deepEqual(rows, [{ timestamp: 't2', level: 'error', requestMethod: 'POST', requestPath: '/api/a', deploymentId: 'dpl_1', message: 'boom one' }]);
});

test('a refused request fails loudly instead of printing nothing', async () => {
  globalThis.fetch = async () => ({ status: 403, json: async () => ({}) });
  await assert.rejects(readLogs(parseArgs([], now), env), /Vercel HTTP 403/);
});
