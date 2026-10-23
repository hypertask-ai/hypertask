const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { load } = require('./task-route-loader.cjs');
const store = load('src/lib/webhooks/signingKeyStore.ts', {});
const flagKey = 'htpr-7624-sealed-webhook-keys';
let original;
beforeEach(() => {
  original = process.env.BYOK_CIPHER_SECRET;
  process.env.BYOK_CIPHER_SECRET = 'synthetic-webhook-root-aaaaaaaaaaaa';
});
afterEach(() => {
  if (original === undefined) delete process.env.BYOK_CIPHER_SECRET;
  else process.env.BYOK_CIPHER_SECRET = original;
});

function fixture(enabled) {
  const writes = [], flags = [];
  const base = {
    id: 'subscription', agentId: 'agent', projectId: null, teamId: 'team',
    url: 'https://receiver.example.invalid/hook', secret: 'whsec_legacy', events: ['task.created'], active: true,
    createdAt: new Date(0), updatedAt: new Date(0), lastDeliveryAt: null, lastDeliveryOk: null,
    project: null, createdBy: { displayName: 'Owner' }, agent: { id: 'agent', displayName: 'Agent' }, deliveries: [],
  };
  let current = null;
  const delegate = {
    findFirst: async () => current,
    findUnique: async () => current,
    findMany: async () => current ? [current] : [],
    count: async () => current ? 1 : 0,
    create: async ({ data }) => { writes.push({ action: 'create', data }); current = { ...base, ...data }; return current; },
    update: async ({ data }) => { writes.push({ action: 'update', data }); current = { ...current, ...data }; return current; },
    upsert: async ({ create, update }) => {
      writes.push({ action: 'upsert', create, update });
      current = current ? { ...current, ...update } : { ...base, ...create };
      return current;
    },
    delete: async () => { current = null; return {}; },
  };
  const db = {
    webhookSubscription: delegate,
    agentWebhookSubscription: delegate,
    team: { findFirst: async () => ({ id: 'team' }) },
    agent: { findFirst: async () => ({ id: 'agent' }), findUnique: async () => ({ userId: 42, revokedAt: null, credentialTeamId: null, credentialTeamAccessBinding: null }) },
    project: { findFirst: async () => ({ id: 17 }) },
    $executeRaw: async () => {},
  };
  db.$transaction = operation => operation(db);
  const mocks = {
    '@/lib/prisma': { default: db },
    '@prisma/client': { Prisma: { sql: () => ({}) } },
    '@/lib/flags': { isFeatureEnabled: async (key, userId) => {
      flags.push({ key, userId });
      return key === flagKey && enabled;
    } },
    './ssrfGuard': { assertSafeWebhookTarget: async () => ({ ok: true }) },
    '@/lib/mcp/webhooks/ssrfGuard': { assertSafeWebhookTarget: async () => ({ ok: true }) },
    '@/utils/controllers/agents/boardMembers': { isAgentOnBoard: async () => true },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({}) },
    './outbox': {},
    '@/lib/agentWebhooks/management': {},
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: handler => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 42 }, agentId: null }),
    },
  };
  return {
    writes, flags, db, mocks, base,
    set: row => { current = row; },
    current: () => current,
    workspace: () => load('src/lib/mcp/webhooks/workspaceManagement.ts', mocks),
    agent: () => load('src/lib/agentWebhooks/management.ts', mocks),
    mcp: () => load('src/lib/mcp/operations/webhooks/operation.ts', mocks),
  };
}
function assertSecret(result, stored, enabled) {
  assert.match(result.secret, /^whsec_[a-f0-9]{48}$/);
  assert.equal(store.isSealedWebhookSigningKey(stored), enabled);
  assert.equal(store.openWebhookSigningKey(stored), result.secret);
  if (enabled) assert.notEqual(stored, result.secret);
  assert.equal(JSON.stringify(result).split(result.secret).length - 1, 1);
  if (enabled) assert.equal(JSON.stringify(result).includes(stored), false);
}
function assertFlag(h) {
  assert.deepEqual(h.flags.filter(({ key }) => key === flagKey), [{ key: flagKey, userId: 42 }]);
}

for (const enabled of [false, true]) {
  test(`board MCP create persists ${enabled ? 'sealed' : 'legacy'} and returns plaintext once for the acting user`, async () => {
    const h = fixture(enabled);
    const response = await h.mcp().POST(new NextRequest('https://app.example.invalid/api/mcp/webhooks', {
      method: 'POST', body: JSON.stringify({ project_id: 17, url: h.base.url, events: ['task.created'] }),
    }));
    assert.equal(response.status, 201);
    const result = await response.json();
    assertSecret(result, h.current().secret, enabled);
    assert.equal(result.subscription.secretHint, 'whsec_…' + result.secret.slice(-4));
    assert.equal('secret' in result.subscription, false);
    assertFlag(h);
  });

  test(`workspace create and rotate persist ${enabled ? 'sealed' : 'legacy'} values with one-time plaintext`, async () => {
    const h = fixture(enabled);
    const service = h.workspace();
    const created = await service.createWorkspaceWebhook({ userId: 42, teamId: 'team', projectId: null, url: h.base.url, events: ['task.created'] });
    assertSecret(created, h.current().secret, enabled);
    assert.equal(created.endpoint.secretHint, 'whsec_…' + created.secret.slice(-4));
    assert.equal('secret' in created.endpoint, false);
    assertFlag(h);
    h.flags.length = 0;
    const rotated = await service.rotateWorkspaceWebhookSecret({ userId: 42, teamId: 'team', id: 'subscription' });
    assertSecret(rotated, h.current().secret, enabled);
    assert.notEqual(rotated.secret, created.secret);
    assert.equal(rotated.secretHint, 'whsec_…' + rotated.secret.slice(-4));
    assertFlag(h);
  });

  test(`agent create and rotate persist ${enabled ? 'sealed' : 'legacy'} values with one-time plaintext`, async () => {
    const h = fixture(enabled);
    const service = h.agent();
    const created = await service.upsertAgentWebhook({ userId: 42, agentId: 'agent', body: { url: h.base.url, events: ['task.created'] } });
    assertSecret(created, h.current().secret, enabled);
    assert.equal(created.subscription.secretHint, 'whsec_…' + created.secret.slice(-4));
    assertFlag(h);
    h.flags.length = 0;
    const rotated = await service.upsertAgentWebhook({ userId: 42, agentId: 'agent', body: { rotateSecret: true } });
    assertSecret(rotated, h.current().secret, enabled);
    assert.notEqual(rotated.secret, created.secret);
    assert.equal(rotated.subscription.secretHint, 'whsec_…' + rotated.secret.slice(-4));
    assertFlag(h);
  });

  for (const format of ['legacy', 'sealed', 'corrupt']) {
    test(`agent non-rotate update preserves exact ${format} bytes with sealed-write flag ${enabled ? 'on' : 'off'}`, async () => {
      const h = fixture(enabled);
      const stored = format === 'legacy' ? 'whsec_original-1234' : format === 'sealed' ? store.sealWebhookSigningKey('whsec_original-1234') : 'enc:v1:corrupt';
      h.set({ ...h.base, secret: stored });
      delete process.env.BYOK_CIPHER_SECRET;
      const result = await h.agent().upsertAgentWebhook({ userId: 42, agentId: 'agent', body: { active: false } });
      assert.equal(h.current().secret, stored);
      assert.equal(h.current().active, false);
      assert.equal('secret' in h.writes[0].update, false);
      assert.equal('secret' in result, false);
      assert.equal('secret' in result.subscription, false);
      assert.equal(result.subscription.secretHint, format === 'legacy' ? 'whsec_…1234' : 'unavailable');
      assert.equal(h.flags.some(({ key }) => key === flagKey), false);
    });
  }
}

for (const writer of ['workspace-create', 'workspace-rotate', 'agent-create', 'agent-rotate']) {
  test(`missing cipher root aborts ${writer} without partial persistence`, async () => {
    const h = fixture(true);
    if (writer.endsWith('rotate')) h.set({ ...h.base, secret: 'enc:v1:corrupt' });
    delete process.env.BYOK_CIPHER_SECRET;
    const operation = writer === 'workspace-create'
      ? () => h.workspace().createWorkspaceWebhook({ userId: 42, teamId: 'team', projectId: null, url: h.base.url, events: ['task.created'] })
      : writer === 'workspace-rotate'
        ? () => h.workspace().rotateWorkspaceWebhookSecret({ userId: 42, teamId: 'team', id: 'subscription' })
        : () => h.agent().upsertAgentWebhook({ userId: 42, agentId: 'agent', body: { url: h.base.url, rotateSecret: writer.endsWith('rotate') } });
    await assert.rejects(operation(), /^Error: Webhook signing key encryption is unavailable$/);
    assert.deepEqual(h.writes, []);
  });
}

test('all hint serializers tolerate corrupt rows and agent management still rotates and deletes them', async () => {
  const h = fixture(true);
  h.set({ ...h.base, projectId: 17, secret: 'enc:v1:corrupt' });
  const mcp = h.mcp();
  const list = await mcp.GET(new NextRequest('https://app.example.invalid/api/mcp/webhooks?project_id=17'));
  assert.equal(list.status, 200);
  assert.equal((await list.json()).subscriptions[0].secretHint, 'unavailable');
  const workspace = h.workspace();
  const listed = await workspace.listWorkspaceWebhooks({ userId: 42, teamId: 'team' });
  assert.equal(listed.endpoints[0].secretHint, 'unavailable');
  const agent = h.agent();
  const get = await agent.manageAgentWebhook({ userId: 42, agentId: 'agent', action: 'get' });
  assert.equal(get.subscription.secretHint, 'unavailable');
  const rotated = await agent.manageAgentWebhook({ userId: 42, agentId: 'agent', action: 'rotate' });
  assertSecret(rotated, h.current().secret, true);
  h.set({ ...h.base, secret: 'enc:v1:corrupt' });
  assert.equal((await agent.manageAgentWebhook({ userId: 42, agentId: 'agent', action: 'delete' })).success, true);
});


test('missing cipher root returns a sanitized MCP failure without any persistence', async t => {
  const h = fixture(true);
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.map(value => value instanceof Error ? value.message : value)));
  delete process.env.BYOK_CIPHER_SECRET;
  const response = await h.mcp().POST(new NextRequest('https://app.example.invalid/api/mcp/webhooks', {
    method: 'POST', body: JSON.stringify({ project_id: 17, url: h.base.url, events: ['task.created'] }),
  }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { success: false, error: 'Internal server error' });
  assert.deepEqual(h.writes, []);
  assert.equal(JSON.stringify(logs).includes('whsec_'), false);
});
