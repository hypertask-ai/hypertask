const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./task-route-loader.cjs');
const store = load('src/lib/webhooks/signingKeyStore.ts', {});
const flagKey = 'htpr-7905-agent-webhook-auth-header';
let original;
beforeEach(() => {
  original = process.env.BYOK_CIPHER_SECRET;
  process.env.BYOK_CIPHER_SECRET = 'synthetic-webhook-root-aaaaaaaaaaaa';
});
afterEach(() => {
  if (original === undefined) delete process.env.BYOK_CIPHER_SECRET;
  else process.env.BYOK_CIPHER_SECRET = original;
});

function management(enabled) {
  let current = null;
  const writes = [];
  const base = {
    id: 'subscription', agentId: 'agent', projectId: null, url: 'https://receiver.example.invalid/hook',
    secret: 'whsec_legacy', authHeaderName: null, authHeaderValue: null, events: ['task.created'], active: true,
    createdAt: new Date(0), updatedAt: new Date(0), lastDeliveryAt: null, lastDeliveryOk: null,
  };
  const delegate = {
    findUnique: async () => current,
    upsert: async ({ create, update }) => {
      writes.push({ create, update });
      current = current ? { ...current, ...update } : { ...base, ...create };
      return current;
    },
  };
  const db = {
    agentWebhookSubscription: delegate,
    agent: { findFirst: async () => ({ id: 'agent' }), findUnique: async () => ({ userId: 42, revokedAt: null, credentialTeamId: null, credentialTeamAccessBinding: null }) },
    project: { findFirst: async () => ({ id: 17 }) },
    $executeRaw: async () => {},
  };
  db.$transaction = operation => operation(db);
  const mocks = {
    '@/lib/prisma': { default: db },
    '@prisma/client': { Prisma: { sql: () => ({}) } },
    '@/lib/flags': { isFeatureEnabled: async key => key === flagKey && enabled },
    '@/lib/mcp/webhooks/ssrfGuard': { assertSafeWebhookTarget: async () => ({ ok: true }) },
    '@/utils/controllers/agents/boardMembers': { isAgentOnBoard: async () => true },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({}) },
    './outbox': {},
  };
  return { writes, current: () => current, set: row => { current = row; }, base, service: () => load('src/lib/agentWebhooks/management.ts', mocks) };
}

const configure = (h, body) => h.service().upsertAgentWebhook({ userId: 42, agentId: 'agent', body: { url: h.base.url, ...body } });

test('flag off refuses every header input and stores nothing', async () => {
  for (const body of [{ bearerSecret: 'k' }, { authHeaderName: 'X-Api-Key', authHeaderValue: 'placeholder' }, { clearAuthHeader: true }]) {
    const h = management(false);
    await assert.rejects(configure(h, body), /not available yet/);
    assert.deepEqual(h.writes, []);
  }
});

test('flag off still lets a webhook save without any header input', async () => {
  const h = management(false);
  const result = await configure(h, {});
  assert.equal(result.subscription.authHeaderSet, false);
  assert.equal('authHeaderValue' in h.writes[0].create, false);
});

test('custom header is stored sealed and never returned', async () => {
  const h = management(true);
  const result = await configure(h, { authHeaderName: 'X-Api-Key', authHeaderValue: 'placeholder-value' });
  const stored = h.current();
  assert.equal(stored.authHeaderName, 'X-Api-Key');
  assert.equal(store.isSealedWebhookSigningKey(stored.authHeaderValue), true);
  assert.equal(store.openWebhookSigningKey(stored.authHeaderValue), 'placeholder-value');
  assert.equal(result.subscription.authHeaderName, 'X-Api-Key');
  assert.equal(result.subscription.authHeaderSet, true);
  const everything = JSON.stringify(result);
  assert.equal(everything.includes('placeholder-value'), false);
  assert.equal(everything.includes(stored.authHeaderValue), false);
});

test('bearerSecret becomes an Authorization Bearer header', async () => {
  const h = management(true);
  await configure(h, { bearerSecret: ' abc ' });
  assert.equal(h.current().authHeaderName, 'Authorization');
  assert.equal(store.openWebhookSigningKey(h.current().authHeaderValue), 'Bearer abc');
});

test('unrelated updates keep the header and clearAuthHeader removes it', async () => {
  const h = management(true);
  await configure(h, { bearerSecret: 'abc' });
  const sealed = h.current().authHeaderValue;
  const kept = await h.service().upsertAgentWebhook({ userId: 42, agentId: 'agent', body: { active: false } });
  assert.equal(h.current().authHeaderValue, sealed);
  assert.equal('authHeaderValue' in h.writes[1].update, false);
  assert.equal(kept.subscription.authHeaderSet, true);
  const cleared = await h.service().upsertAgentWebhook({ userId: 42, agentId: 'agent', body: { clearAuthHeader: true } });
  assert.equal(h.current().authHeaderName, null);
  assert.equal(h.current().authHeaderValue, null);
  assert.equal(cleared.subscription.authHeaderSet, false);
});

test('rejects reserved names, bad names, newlines and mixed inputs', async () => {
  const cases = [
    [{ authHeaderName: 'Content-Type', authHeaderValue: 'x' }, /reserved/],
    [{ authHeaderName: 'x-hypertask-signature', authHeaderValue: 'x' }, /reserved/],
    [{ authHeaderName: 'Bad Name', authHeaderValue: 'x' }, /letters, digits or hyphens/],
    [{ authHeaderName: 'X-Key', authHeaderValue: 'a\r\nInjected: 1' }, /one line/],
    [{ authHeaderName: 'X-Key' }, /authHeaderValue is required/],
    [{ authHeaderValue: 'x' }, /authHeaderName is required/],
    [{ bearerSecret: 'a', authHeaderName: 'X-Key', authHeaderValue: 'b' }, /not both/],
    [{ clearAuthHeader: true, bearerSecret: 'a' }, /cannot be combined/],
  ];
  for (const [body, message] of cases) {
    const h = management(true);
    await assert.rejects(configure(h, body), message);
    assert.deepEqual(h.writes, []);
  }
});

function delivery({ enabled, header, corrupt }) {
  const sent = [];
  const row = {
    id: 'd1', subscriptionId: 's1', status: 'pending', attemptCount: 0, processingAt: null, nextAttemptAt: new Date(0),
    event: 'webhook.test', payload: { event: 'webhook.test' },
    subscription: {
      id: 's1', agentId: 'agent', projectId: null, url: 'https://receiver.example.invalid/hook', secret: 'whsec_x', active: true,
      agent: { revokedAt: null, userId: 42 },
      authHeaderName: header || corrupt ? 'Authorization' : null,
      authHeaderValue: corrupt ? 'enc:garbage' : header ? store.sealWebhookSigningKey('Bearer live-key') : null,
    },
  };
  const update = async ({ data }) => { Object.assign(row, data); return row; };
  const db = {
    agentWebhookDelivery: {
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => row,
      update,
    },
    agentWebhookSubscription: { update: async () => ({}) },
    $transaction: async ops => Promise.all(ops),
  };
  const mocks = {
    '@/lib/prisma': { default: db },
    '@/lib/flags': { isFeatureEnabled: async key => key === flagKey && enabled },
    '@/lib/webhooks/credentialScope': { webhookCredentialAllows: async () => true },
    '@/lib/mcp/webhooks/delivery': { postSignedWebhook: async input => { sent.push(input); return { ok: true, statusCode: 204, error: null }; } },
    './queue': { queueAgentWebhookDelivery: async () => {} },
  };
  return { sent, run: () => load('src/lib/agentWebhooks/delivery.ts', mocks).deliverAgentWebhook('d1') };
}

test('delivery sends the opened header when the flag is on', async () => {
  const d = delivery({ enabled: true, header: true });
  assert.equal((await d.run()).status, 'delivered');
  assert.deepEqual(d.sent[0].authHeader, { name: 'Authorization', value: 'Bearer live-key' });
});

test('an unreadable saved header fails the delivery instead of sending without it', async () => {
  const d = delivery({ enabled: true, corrupt: true });
  const result = await d.run();
  assert.equal(result.status, 'retrying');
  assert.equal(d.sent.length, 0);
  assert.equal(result.error, 'Saved auth header could not be read');
});

test('delivery sends no header when the flag is off or none is saved', async () => {
  for (const [enabled, header] of [[false, true], [true, false]]) {
    const d = delivery({ enabled, header });
    assert.equal((await d.run()).status, 'delivered');
    assert.equal(d.sent[0].authHeader, null);
  }
});

test('postSignedWebhook puts the header on the request and keeps it out of the result', async () => {
  const requests = [];
  const mod = load('src/lib/mcp/webhooks/delivery.ts', {
    '@/lib/prisma': { default: {} },
    '@/lib/webhooks/credentialScope': { webhookCredentialAllows: async () => true },
    './ssrfGuard': { resolveSafeAddresses: async () => ({ ok: true, addresses: [{ address: '203.0.113.5', family: 4 }] }) },
    undici: {
      Agent: class { async close() {} },
      request: async (url, options) => { requests.push(options.headers); return { statusCode: 200, body: { dump: async () => {} } }; },
    },
  });
  const result = await mod.postSignedWebhook({
    url: 'https://receiver.example.invalid/hook', secret: 'whsec_x', event: 'webhook.test', deliveryId: 'd1', body: '{}',
    authHeader: { name: 'X-Api-Key', value: 'live-key' },
  });
  assert.equal(result.ok, true);
  assert.equal(requests[0]['X-Api-Key'], 'live-key');
  assert.ok(requests[0]['x-hypertask-signature']);
  assert.equal(JSON.stringify(result).includes('live-key'), false);
});
