const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./task-route-loader.cjs');
const { NextRequest } = require('next/server');
const store = load('src/lib/webhooks/signingKeyStore.ts', {});
const { sweepWebhookSigningKeys } = load('src/lib/webhooks/signingKeySweep.ts', {});

let originalRoot, originalCron;
beforeEach(() => {
  originalRoot = process.env.BYOK_CIPHER_SECRET;
  originalCron = process.env.CRON_SECRET;
  process.env.BYOK_CIPHER_SECRET = 'synthetic-webhook-root-aaaaaaaaaaaa';
  process.env.CRON_SECRET = 'synthetic-webhook-cron-aaaaaaaaaaaa';
});
afterEach(() => {
  for (const [key, value] of [['BYOK_CIPHER_SECRET', originalRoot], ['CRON_SECRET', originalCron]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function fixture(mode = 'EVERYONE') {
  const tables = { webhookSubscription: [], agentWebhookSubscription: [] };
  const calls = [];
  let beforeUpdate;
  const db = { featureFlag: { findUnique: async ({ where, select }) => {
    assert.deepEqual(where, { key: 'htpr-7624-sealed-webhook-keys' });
    assert.deepEqual(select, { mode: true });
    return mode === null ? null : { mode };
  } } };
  for (const model of Object.keys(tables)) {
    const rows = tables[model];
    const pending = query => {
      assert.deepEqual(query.where, { NOT: { secret: { startsWith: 'enc:' } } });
      return rows.filter(row => !row.secret.startsWith('enc:'));
    };
    db[model] = {
      findMany: async query => {
        calls.push({ model, operation: 'findMany', query });
        assert.deepEqual(query.select, { id: true, secret: true });
        assert.deepEqual(query.orderBy, { id: 'asc' });
        assert.equal(query.take, 100);
        return pending(query).sort((a, b) => a.id.localeCompare(b.id)).slice(0, query.take).map(({ id, secret }) => ({ id, secret }));
      },
      updateMany: async query => {
        calls.push({ model, operation: 'updateMany', query });
        if (beforeUpdate) await beforeUpdate(model, query);
        assert.deepEqual(Object.keys(query.where).sort(), ['id', 'secret']);
        const row = rows.find(row => row.id === query.where.id && row.secret === query.where.secret);
        if (!row) return { count: 0 };
        Object.assign(row, query.data);
        return { count: 1 };
      },
      count: async query => { calls.push({ model, operation: 'count', query }); return pending(query).length; },
    };
  }
  return { db, tables, calls, beforeUpdate: fn => { beforeUpdate = fn; } };
}

for (const mode of ['OFF', 'OWNER_ONLY', 'OWNER_AND_QA', null]) {
  test(`no-op before either subscription model is read unless mode is EVERYONE (${mode ?? 'unset'})`, async () => {
    const h = fixture(mode);
    delete process.env.BYOK_CIPHER_SECRET;
    assert.deepEqual(await sweepWebhookSigningKeys(h.db), { scanned: 0, encrypted: 0, conflicts: 0, failed: 0, remaining: 0 });
    assert.deepEqual(h.calls, []);
  });
}

test('sweep includes active and inactive rows in both models, preserves sealed/reserved values and reruns as a no-op', async () => {
  const h = fixture();
  const stable = store.sealWebhookSigningKey('whsec_stable');
  for (const rows of Object.values(h.tables)) rows.push(
    { id: '1', secret: 'whsec_active', active: true },
    { id: '2', secret: 'whsec_inactive', active: false },
    { id: '3', secret: stable, active: false },
    { id: '4', secret: 'enc:v2:invalid', active: false },
  );
  assert.deepEqual(await sweepWebhookSigningKeys(h.db), { scanned: 4, encrypted: 4, conflicts: 0, failed: 0, remaining: 0 });
  for (const rows of Object.values(h.tables)) {
    assert.equal(store.openWebhookSigningKey(rows[0].secret), 'whsec_active');
    assert.equal(store.openWebhookSigningKey(rows[1].secret), 'whsec_inactive');
    assert.equal(rows[1].active, false);
    assert.equal(rows[2].secret, stable);
    assert.equal(rows[3].secret, 'enc:v2:invalid');
  }
  const snapshot = structuredClone(h.tables);
  h.calls.length = 0;
  assert.deepEqual(await sweepWebhookSigningKeys(h.db), { scanned: 0, encrypted: 0, conflicts: 0, failed: 0, remaining: 0 });
  assert.deepEqual(h.tables, snapshot);
  assert.equal(h.calls.some(call => call.operation === 'updateMany'), false);
});

for (const model of ['webhookSubscription', 'agentWebhookSubscription']) {
  test(`${model}: a rotation after read wins CAS and is never retried or overwritten`, async () => {
    const h = fixture();
    const s1 = 'whsec_before-rotation';
    const s2 = store.sealWebhookSigningKey('whsec_after-rotation');
    h.tables[model].push({ id: '1', secret: s1, active: false });
    h.beforeUpdate((currentModel, query) => {
      assert.equal(currentModel, model);
      assert.equal(query.where.secret, s1);
      assert.equal(store.openWebhookSigningKey(query.data.secret), s1);
      h.tables[model][0].secret = s2;
    });
    assert.deepEqual(await sweepWebhookSigningKeys(h.db), { scanned: 1, encrypted: 0, conflicts: 1, failed: 0, remaining: 0 });
    assert.equal(h.tables[model][0].secret, s2);
    assert.equal(h.calls.filter(call => call.operation === 'updateMany').length, 1);
    await sweepWebhookSigningKeys(h.db);
    assert.equal(h.tables[model][0].secret, s2);
  });
}

test('each model has a bounded ascending batch and writes stop at the deadline', async () => {
  const h = fixture();
  for (const rows of Object.values(h.tables)) {
    for (let i = 204; i >= 0; i--) rows.push({ id: String(i).padStart(3, '0'), secret: 'whsec_batched', active: false });
  }
  assert.deepEqual(await sweepWebhookSigningKeys(h.db), { scanned: 200, encrypted: 200, conflicts: 0, failed: 0, remaining: 210 });
  for (const model of Object.keys(h.tables)) {
    const writes = h.calls.filter(call => call.model === model && call.operation === 'updateMany');
    assert.deepEqual(writes.map(call => call.query.where.id), Array.from({ length: 100 }, (_, i) => String(i).padStart(3, '0')));
  }
  h.calls.length = 0;
  assert.deepEqual(await sweepWebhookSigningKeys(h.db, 0), { scanned: 0, encrypted: 0, conflicts: 0, failed: 0, remaining: 210 });
  assert.equal(h.calls.some(call => call.operation === 'updateMany'), false);
});

test('failed round-trip verification prevents writes and sanitizes the thrown error', async () => {
  const h = fixture();
  h.tables.webhookSubscription.push({ id: '1', secret: 'whsec_synthetic', active: true });
  const sweep = load('src/lib/webhooks/signingKeySweep.ts', {
    './signingKeyStore': { sealWebhookSigningKey: () => 'enc:v1:synthetic', openWebhookSigningKey: () => 'not-the-original' },
  });
  await assert.rejects(sweep.sweepWebhookSigningKeys(h.db), /^Error: webhook_signing_key_sweep_failed$/);
  assert.equal(h.calls.some(call => call.operation === 'updateMany'), false);
  assert.equal(h.tables.webhookSubscription[0].secret, 'whsec_synthetic');
});

test('HTPR-7630: one row that fails sealing is counted and skipped, every other row in both models is still encrypted', async () => {
  const h = fixture();
  h.tables.webhookSubscription.push(
    { id: '1', secret: 'whsec_poison', active: true },
    { id: '2', secret: 'whsec_good-board', active: true },
  );
  h.tables.agentWebhookSubscription.push({ id: '1', secret: 'whsec_good-agent', active: false });
  const sweep = load('src/lib/webhooks/signingKeySweep.ts', {
    './signingKeyStore': {
      sealWebhookSigningKey: plain => `enc:v1:${plain}`,
      openWebhookSigningKey: sealed => (sealed === 'enc:v1:whsec_poison' ? 'not-the-original' : sealed.slice('enc:v1:'.length)),
    },
  });
  assert.deepEqual(await sweep.sweepWebhookSigningKeys(h.db), { scanned: 3, encrypted: 2, conflicts: 0, failed: 1, remaining: 1 });
  assert.equal(h.tables.webhookSubscription[0].secret, 'whsec_poison');
  assert.equal(h.tables.webhookSubscription[1].secret, 'enc:v1:whsec_good-board');
  assert.equal(h.tables.agentWebhookSubscription[0].secret, 'enc:v1:whsec_good-agent');
  assert.equal(h.calls.some(call => call.operation === 'updateMany' && call.query.where.id === '1' && call.model === 'webhookSubscription'), false);
});

test('missing root refuses plaintext writes without disclosing key material', async () => {
  const h = fixture();
  h.tables.webhookSubscription.push({ id: '1', secret: 'whsec_synthetic', active: true });
  delete process.env.BYOK_CIPHER_SECRET;
  await assert.rejects(sweepWebhookSigningKeys(h.db), /^Error: webhook_signing_key_sweep_failed$/);
  assert.equal(h.calls.some(call => call.operation === 'updateMany'), false);
});

function route(db) {
  return load('src/app/api/cron/webhook-signing-key-sweep/route.ts', { '@/lib/prisma': { default: db } });
}
function request(authorization) {
  return new NextRequest('https://app.example.invalid/api/cron/webhook-signing-key-sweep', { headers: authorization ? { authorization } : {} });
}

test('cron rejects unauthorized requests and missing server credentials before any DB access, always no-store', async () => {
  const db = new Proxy({}, { get() { throw new Error('Unexpected database access'); } });
  const { GET } = route(db);
  for (const authorization of [undefined, 'Bearer incorrect', 'Basic synthetic']) {
    const response = await GET(request(authorization));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: 'unauthorized' });
  }
  delete process.env.CRON_SECRET;
  const response = await GET(request('Bearer undefined'));
  assert.equal(response.status, 401);
});

test('authorized cron returns counts only, and failures return a fixed error without logging row data', async t => {
  const logs = [];
  for (const method of ['log', 'warn', 'error']) t.mock.method(console, method, (...args) => logs.push(args));
  const h = fixture();
  h.tables.agentWebhookSubscription.push({ id: '1', secret: 'whsec_synthetic', active: false });
  const { GET } = route(h.db);
  const response = await GET(request(`Bearer ${process.env.CRON_SECRET}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { scanned: 1, encrypted: 1, conflicts: 0, failed: 0, remaining: 0 });
  h.db.featureFlag.findUnique = async () => { throw new Error(h.tables.agentWebhookSubscription[0].secret); };
  const failure = await GET(request(`Bearer ${process.env.CRON_SECRET}`));
  assert.equal(failure.status, 500);
  assert.equal(failure.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await failure.json(), { error: 'webhook_signing_key_sweep_failed' });
  assert.deepEqual(logs, []);
});
