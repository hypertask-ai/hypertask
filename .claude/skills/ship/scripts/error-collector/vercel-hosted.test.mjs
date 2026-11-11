import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seal, open, selectWindow } from './vercel-hosted.mjs';
import { collect } from './collector.mjs';

const since = '2026-11-10T00:00:00.000Z';
const until = '2026-11-10T23:55:00.000Z';
const now = Date.parse('2026-11-11T00:00:00.000Z');
const event = { service: 'vercel-5xx', board: 15, message: 'HTTP 500 response', ts: until, ticket: false };
const snapshot = { version: 1, sources: { 'vercel-5xx': { since, until, events: [event] } } };

test('only the private recipient can read production data; altered ciphertext fails', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const encrypted = seal(snapshot, keys.publicKey);
  assert.ok(!encrypted.includes(event.message));
  assert.deepEqual(open(encrypted, keys.privateKey), snapshot);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => open(encrypted, other.privateKey));
  const changed = JSON.parse(encrypted);
  const bytes = Buffer.from(changed.data, 'base64');
  bytes[0] ^= 1;
  changed.data = bytes.toString('base64');
  assert.throws(() => open(JSON.stringify(changed), keys.privateKey));
});

test('complete hosted windows select new events; gaps, missing, stale and future batches fail closed', () => {
  assert.deepEqual(selectWindow(snapshot, 'vercel-5xx', since, new Date(now).toISOString()).events, [event]);
  for (const [service, start, end] of [
    ['vercel', since, new Date(now).toISOString()],
    ['vercel-5xx', '2026-11-09T23:59:59.000Z', new Date(now).toISOString()],
    ['vercel-5xx', until, new Date(now).toISOString()],
    ['vercel-5xx', since, '2026-11-10T23:54:00.000Z'],
  ]) assert.throws(() => selectWindow(snapshot, service, start, end));
});

test('collector advances to the hosted end, not wall clock; replay cannot recount or claim full-day coverage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hosted-collector-'));
  const env = { HOME: root, PATH: '', ERROR_COLLECTOR_STATE_DIR: root };
  const sources = [{ name: 'vercel-5xx', fetch: async context => selectWindow(snapshot, 'vercel-5xx', context.since, context.until) }];
  try {
    assert.equal(await collect({ env, now, sources }), 0);
    const first = JSON.parse(readFileSync(join(root, 'state.json')));
    assert.equal(first.sources['vercel-5xx'], until);
    assert.equal(first.days['2026-11-10']['vercel-5xx'].errors, 1);
    assert.equal(first.days['2026-11-10']['vercel-5xx'].complete, false);
    assert.equal(await collect({ env, now: now + 60000, sources }), 1);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'state.json'))), first);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid source end cannot advance a collector checkpoint', async () => {
  for (const end of ['invalid', new Date(now + 1).toISOString(), '2026-11-09T00:00:00.000Z']) {
    const root = mkdtempSync(join(tmpdir(), 'hosted-invalid-'));
    try {
      assert.equal(await collect({ env: { HOME: root, PATH: '', ERROR_COLLECTOR_STATE_DIR: root }, now, sources: [{ name: 'vercel', fetch: async () => ({ events: [], cursor: null, until: end }) }] }), 1);
      assert.throws(() => readFileSync(join(root, 'state.json')));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('three source reads share one authenticated artifact download, without Vercel credentials', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hosted-download-'));
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sources = Object.fromEntries(['vercel', 'vercel-5xx', 'realtime'].map(service => [service, { since, until, events: [] }]));
  writeFileSync(join(root, 'private.pem'), keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  writeFileSync(join(root, 'snapshot.enc'), seal({ version: 1, sources }, keys.publicKey));
  writeFileSync(join(root, 'gh-app-token'), `#!${process.execPath}
process.stdout.write('app-token-sentinel\\n');
`, { mode: 0o700 });
  writeFileSync(join(root, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (process.env.GH_TOKEN !== 'app-token-sentinel' || process.env.GITHUB_TOKEN !== 'app-token-sentinel') process.exit(1);
fs.appendFileSync(path.join(process.env.HOME, 'calls'), args[1] + '\\n');
if (args[0] !== 'run') process.exit(1);
if (args[1] === 'list') console.log(JSON.stringify([{ databaseId: 123 }]));
else if (args[1] === 'download') fs.copyFileSync(path.join(process.env.HOME, 'snapshot.enc'), path.join(args[args.indexOf('--dir') + 1], 'feed.enc'));
else process.exit(1);
`, { mode: 0o700 });
  const env = { HOME: root, PATH: root, GH_TOKEN: 'human-token', GITHUB_TOKEN: 'human-token', ERROR_COLLECTOR_VERCEL_HOSTED: '1', ERROR_COLLECTOR_VERCEL_PRIVATE_KEY: join(root, 'private.pem') };
  try {
    const { fetchVercel } = await import('./sources/vercel.mjs');
    for (const service of Object.keys(sources)) {
      assert.deepEqual(await fetchVercel({ since, until: new Date(now).toISOString(), env }, service), { events: [], cursor: null, until });
    }
    assert.equal(readFileSync(join(root, 'calls'), 'utf8'), 'list\ndownload\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('production feed hands off after failed collection without holding the collection lock', async () => {
  const yaml = readFileSync(new URL('../../../../../.github/workflows/error-collector-vercel.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(yaml, /^concurrency:/m);
  const chain = yaml.slice(yaml.indexOf('\n  chain:'));
  assert.match(chain, /needs: \[collect\]/);
  assert.match(chain, /if: \$\{\{ !cancelled\(\) && github.ref == 'refs\/heads\/production' \}\}/);
  assert.match(chain, /group: vercel-error-feed-chain/);
  assert.match(chain, /actions: write/);
  assert.match(chain, /schedule-chain\.cjs hand-off --workflow error-collector-vercel\.yml --gap-minutes 15/);
  const { default: scheduler } = await import('../../../../../.github/scripts/schedule-chain.cjs');
  let clock = 1000;
  const calls = [];
  const result = await scheduler.handOff('hypertask-ai/hypertask', {
    workflowFile: 'error-collector-vercel.yml', ownRunId: '123', startMs: clock, gapMs: 15 * 60 * 1000,
    now: () => clock,
    sleep: async ms => { clock += ms; },
    api: async (path, method, fields) => {
      calls.push({ path, method, fields });
      return { workflow_runs: [{ id: 123, status: 'in_progress' }] };
    },
  });
  assert.equal(clock, 901000);
  assert.equal(result.dispatched, true);
  assert.deepEqual(calls[1], { path: '/repos/hypertask-ai/hypertask/actions/workflows/error-collector-vercel.yml/dispatches', method: 'POST', fields: { ref: 'production' } });
});
