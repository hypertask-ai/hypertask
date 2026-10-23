const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { load } = require('./task-route-loader.cjs');

const store = load('src/lib/webhooks/signingKeyStore.ts', {});
const plain = 'whsec_synthetic-signing-key-1234';
let original;
beforeEach(() => {
  original = process.env.BYOK_CIPHER_SECRET;
  process.env.BYOK_CIPHER_SECRET = 'synthetic-webhook-root-aaaaaaaaaaaa';
});
afterEach(() => {
  if (original === undefined) delete process.env.BYOK_CIPHER_SECRET;
  else process.env.BYOK_CIPHER_SECRET = original;
});

function transport(db = {}) {
  const requests = [];
  let resolutions = 0;
  let agents = 0;
  const delivery = load('src/lib/mcp/webhooks/delivery.ts', {
    '@/lib/prisma': { default: db },
    './ssrfGuard': { resolveSafeAddresses: async () => {
      resolutions++;
      return { ok: true, addresses: [{ address: '8.8.8.8', family: 4 }] };
    } },
    undici: {
      Agent: class { constructor() { agents++; } async close() {} },
      request: async (url, options) => {
        requests.push({ url, ...options });
        return { statusCode: 204, body: { dump: async () => {} } };
      },
    },
  });
  return { ...delivery, requests, resolutions: () => resolutions, agents: () => agents };
}
const input = secret => ({ url: 'https://receiver.example.invalid/hook', secret, body: '{"event":"webhook.test"}', event: 'webhook.test', deliveryId: 'delivery' });

function unreadable(kind) {
  const sealed = store.sealWebhookSigningKey(plain);
  if (kind === 'tampered') {
    const bytes = Buffer.from(sealed.slice(7), 'base64');
    bytes[bytes.length - 1] ^= 1;
    return 'enc:v1:' + bytes.toString('base64');
  }
  if (kind === 'wrong-root') {
    process.env.BYOK_CIPHER_SECRET = 'synthetic-wrong-webhook-root-bbbbbbb';
    return sealed;
  }
  if (kind === 'missing-root') {
    delete process.env.BYOK_CIPHER_SECRET;
    return sealed;
  }
  return kind;
}

test('seal/open round trips authenticated versioned storage, with an independent HKDF/AES receiver', () => {
  const sealed = store.sealWebhookSigningKey(plain);
  assert.notEqual(sealed, plain);
  assert.equal(sealed.includes(plain), false);
  assert.equal(store.isSealedWebhookSigningKey(sealed), true);
  assert.equal(store.isSealedWebhookSigningKey(plain), false);
  assert.equal(store.openWebhookSigningKey(sealed), plain);
  assert.notEqual(store.sealWebhookSigningKey(plain), sealed);
  const raw = Buffer.from(sealed.slice(7), 'base64');
  assert.equal(raw[0], 1);
  const key = crypto.hkdfSync('sha256', process.env.BYOK_CIPHER_SECRET, '', 'hypertask:webhook-signing-key:v1', 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(1, 13));
  decipher.setAuthTag(raw.subarray(13, 29));
  assert.equal(Buffer.concat([decipher.update(raw.subarray(29)), decipher.final()]).toString(), plain);
  const byokKey = crypto.createHash('sha256').update(process.env.BYOK_CIPHER_SECRET).digest();
  const byokDecipher = crypto.createDecipheriv('aes-256-gcm', byokKey, raw.subarray(1, 13));
  byokDecipher.setAuthTag(raw.subarray(13, 29));
  assert.throws(() => Buffer.concat([byokDecipher.update(raw.subarray(29)), byokDecipher.final()]));
  assert.equal(store.openWebhookSigningKey(store.sealWebhookSigningKey('')), '');
});

for (const format of ['legacy', 'sealed']) {
  test(`still allowed: ${format} delivery has unchanged receiver-verifiable HMAC`, async () => {
    const h = transport();
    const secret = format === 'legacy' ? plain : store.sealWebhookSigningKey(plain);
    const result = await h.postSignedWebhook(input(secret));
    assert.equal(result.ok, true);
    assert.equal(result.statusCode, 204);
    assert.equal(h.requests.length, 1);
    const sent = h.requests[0];
    const timestamp = sent.headers['x-hypertask-timestamp'];
    const signature = 'sha256=' + crypto.createHmac('sha256', plain).update(`${timestamp}.${sent.body}`).digest('hex');
    assert.equal(sent.headers['x-hypertask-signature'], signature);
    assert.equal(JSON.stringify(sent.headers).includes(secret), false);
    assert.equal(store.webhookSigningKeyHint(secret), 'whsec_…1234');
  });
}

for (const kind of ['tampered', 'wrong-root', 'missing-root', 'enc:v2:AAAA', 'enc:', 'enc:v1:', 'enc:v1:AAAA', 'enc:v1:%%%']) {
  test(`now refused: ${kind} fails before DNS, agent creation or HTTP with a fixed safe error and hint`, async () => {
    const secret = unreadable(kind);
    const h = transport();
    assert.throws(() => store.openWebhookSigningKey(secret), /^Error: Webhook signing key is unavailable$/);
    const result = await h.postSignedWebhook(input(secret));
    assert.deepEqual({ ...result, durationMs: 0 }, { ok: false, statusCode: null, error: 'Webhook signing key is unavailable', durationMs: 0 });
    assert.equal(h.requests.length, 0);
    assert.equal(h.resolutions(), 0);
    assert.equal(h.agents(), 0);
    assert.equal(store.webhookSigningKeyHint(secret), 'unavailable');
    assert.equal(JSON.stringify(result).includes(plain), false);
  });
}

test('legacy fallback accepts all unmarked values even without the encryption root', () => {
  delete process.env.BYOK_CIPHER_SECRET;
  for (const legacy of [plain, '', 'old-key-without-whsec']) assert.equal(store.openWebhookSigningKey(legacy), legacy);
  assert.throws(() => store.sealWebhookSigningKey(plain), /^Error: Webhook signing key encryption is unavailable$/);
});

for (const model of ['board', 'agent']) {
  for (const finalAttempt of [false, true]) {
    test(`${model} worker records unreadable-key failure, increments attempt and releases lease (${finalAttempt ? 'exhausted' : 'retry'})`, async t => {
      t.mock.method(console, 'error', () => {});
      const writes = [], health = [], attempts = [], queued = [];
      const max = model === 'board' ? 6 : 4;
      const row = {
        id: 'delivery', subscriptionId: 'sub', event: 'task.created', payload: {},
        attemptCount: finalAttempt ? max - 1 : 0,
        subscription: { active: true, url: input('').url, secret: 'enc:v2:invalid', agent: { revokedAt: null, userId: 42 } },
      };
      const delegate = {
        updateMany: async ({ data }) => { if (data.status !== 'processing') writes.push(data); return { count: 1 }; },
        findFirst: async () => row,
        findUnique: async () => row,
        update: async ({ data }) => { writes.push(data); return {}; },
      };
      const db = {
        boardWebhookDelivery: delegate, agentWebhookDelivery: delegate,
        boardWebhookAttempt: { create: async ({ data }) => { attempts.push(data); return {}; } },
        webhookSubscription: { update: async ({ data }) => { health.push(data); return {}; } },
        agentWebhookSubscription: { update: async ({ data }) => { health.push(data); return {}; } },
      };
      db.$transaction = operation => Array.isArray(operation) ? Promise.all(operation) : operation(db);
      const h = transport(db);
      const worker = load(model === 'board' ? 'src/lib/mcp/webhooks/outboxDelivery.ts' : 'src/lib/agentWebhooks/delivery.ts', {
        '@/lib/prisma': { default: db },
        './delivery': h,
        '@/lib/mcp/webhooks/delivery': h,
        '@/lib/flags': { isFeatureEnabled: async () => true },
        './queue': { queueBoardWebhookDelivery: async (...args) => queued.push(args), queueAgentWebhookDelivery: async (...args) => queued.push(args) },
      });
      const result = await (model === 'board' ? worker.deliverBoardWebhook : worker.deliverAgentWebhook)('delivery');
      assert.equal(result.status, finalAttempt ? 'failed' : 'retrying');
      assert.equal(result.statusCode, null);
      assert.equal(result.error, 'Webhook signing key is unavailable');
      assert.equal(h.requests.length, 0);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].processingAt, null);
      assert.equal(writes[0].attemptCount, finalAttempt ? max : 1);
      assert.equal(health[0].lastDeliveryOk, false);
      assert.equal(queued.length, finalAttempt ? 0 : 1);
      if (model === 'board') assert.equal(attempts[0].error, result.error);
    });
  }
}

test('MCP direct test delivery records a refused key through the same boundary', async () => {
  const health = [];
  const h = transport({ webhookSubscription: { update: async ({ data }) => health.push(data) } });
  const ok = await h.deliverWebhook({ id: 'sub', url: input('').url, secret: 'enc:v2:invalid' }, { event: 'ping', data: { projectId: 1, message: 'test' } });
  assert.equal(ok, false);
  assert.equal(h.requests.length, 0);
  assert.equal(health[0].lastDeliveryOk, false);
});


for (const format of ['legacy', 'sealed']) {
  test(`MCP direct test delivery from a ${format} row signs with the original key`, async () => {
    const health = [];
    const h = transport({ webhookSubscription: { update: async ({ data }) => health.push(data) } });
    const stored = format === 'legacy' ? plain : store.sealWebhookSigningKey(plain);
    assert.equal(await h.deliverWebhook({ id: 'sub', url: input('').url, secret: stored }, { event: 'ping', data: { projectId: 1, message: 'test' } }), true);
    const sent = h.requests[0];
    const expected = 'sha256=' + crypto.createHmac('sha256', plain).update(`${sent.headers['x-hypertask-timestamp']}.${sent.body}`).digest('hex');
    assert.equal(sent.headers['x-hypertask-signature'], expected);
    assert.equal(health[0].lastDeliveryOk, true);
  });
}
