const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { load } = require('./task-route-loader.cjs');

function recovery({ enabled = true, session = { userId: 985 }, ownerId = 985, revoked = true, grant = true, race = false } = {}) {
  const writes = [];
  const agent = {
    id: 'existing-agent', userId: ownerId, runtimeType: 'EXTERNAL', runtimeGeneration: 4,
    revokedAt: revoked ? new Date() : null,
    credentialTeamId: 'existing-team', credentialTeamAccessBinding: 'existing-grant',
  };
  const scope = { teamId: agent.credentialTeamId, accessBinding: agent.credentialTeamAccessBinding };
  let mintedScope;
  const auth = {
    agentTokenCredentialFields: () => ({ mcpTokenHash: 'new-hash', mcpTokenJti: 'new-generation', mcpToken: null }),
    createMcpToken: (userId, email, expiry, id, teamScope) => {
      assert.equal(userId, 985);
      assert.equal(id, agent.id);
      mintedScope = teamScope;
      return 'shown-once-fixture';
    },
    checkMcpRateLimit: async () => null,
    managementAgentTokenScope: () => null,
    validateMcpAuth: async () => session && ({ user: { id: session.userId, email: 'qa@example.invalid' }, agentId: session.agentId }),
  };
  const prisma = {
    agent: {
      findFirst: async ({ where }) => Object.entries(where).every(([key, value]) => agent[key] === value) ? agent : null,
      updateMany: async args => {
        if (race) return { count: 0 };
        assert.equal(args.where.userId, ownerId);
        assert.equal(args.where.runtimeGeneration, 4);
        writes.push(args.data);
        return { count: 1 };
      },
    },
    user: { findUnique: async () => ({ email: 'qa@example.invalid' }) },
  };
  const stubs = {
    '@/lib/prisma': { default: prisma },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => session },
    '@/lib/flags': { isFeatureEnabled: async () => enabled },
    '@/lib/auth/agentTeamScope': { resolveAgentTeamScope: async () => {
      if (!grant) throw new Error('grant removed');
      return scope;
    } },
    '@/lib/mcp/auth': auth,
    '@/lib/mcp/managementKeyTeamScope': { agentWithinTeamWhere: () => ({}) },
  };
  const route = load('src/app/api/agents/[agentId]/mcp-token/route.ts', stubs);
  const rotate = load('src/lib/mcp/agents/rotateToken.ts', stubs);
  const request = () => new NextRequest('https://app.hypertask.ai/api/agents/existing-agent/mcp-token', { method: 'POST' });
  return {
    writes, scope,
    mintedScope: () => mintedScope,
    post: () => route.POST(request(), { params: Promise.resolve({ agentId: agent.id }) }),
    rotate: () => rotate.handleRotateAgentTokenRequest(request(), agent.id),
  };
}

test('owner recovers the same revoked agent once without widening its grant', async () => {
  const f = recovery();
  const response = await f.post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await response.json()).token, 'shown-once-fixture');
  assert.deepEqual(f.mintedScope(), f.scope);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].revokedAt, null);
  assert.equal(f.writes[0].mcpToken, null);
  assert.deepEqual(f.writes[0].runtimeGeneration, { increment: 1 });
});

for (const [name, options, expected] of [
  ['flag off keeps revoked-agent recovery unavailable', { enabled: false }, 404],
  ['another owner cannot recover it', { ownerId: 2343 }, 404],
  ['agent session cannot issue logins', { session: { userId: 985, agentId: 'caller-agent' } }, 401],
  ['signed out cannot issue logins', { session: null }, 401],
  ['removed grant cannot turn into an unbound token', { grant: false }, 403],
  ['concurrent rotation never returns an unusable token', { race: true }, 409],
]) {
  test(name, async () => {
    const f = recovery(options);
    const response = await f.post();
    assert.equal(response.status, expected);
    assert.equal((await response.json()).token, undefined);
    assert.deepEqual(f.writes, []);
  });
}

test('flag-off still allows an owner to rotate an active login', async () => {
  const f = recovery({ enabled: false, revoked: false });
  const response = await f.post();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).token, 'shown-once-fixture');
  assert.deepEqual(f.mintedScope(), f.scope);
});

test('CLI owner renewal preserves the stored team binding', async () => {
  const f = recovery();
  const response = await f.rotate();
  assert.equal(response.status, 200);
  assert.deepEqual(f.mintedScope(), f.scope);
  assert.equal(f.writes[0].credentialTeamId, f.scope.teamId);
  assert.equal(f.writes[0].credentialTeamAccessBinding, f.scope.accessBinding);
});

for (const [name, options, status] of [
  ['non-owner', { ownerId: 2343 }, 404],
  ['agent', { session: { userId: 985, agentId: 'caller-agent' } }, 403],
  ['stale grant', { grant: false }, 403],
  ['concurrent rotation', { race: true }, 409],
]) {
  test(`CLI renewal refuses ${name}`, async () => {
    const f = recovery(options);
    const response = await f.rotate();
    assert.equal(response.status, status);
    assert.equal((await response.json()).token, undefined);
    assert.deepEqual(f.writes, []);
  });
}

test('owner recovery ships restricted for independent access and visual review', () => {
  const { default: definition } = load('src/lib/flags/definitions/htpr-8861-agent-login-recovery.ts');
  assert.equal(definition.key, 'htpr-8861-agent-login-recovery');
  assert.equal(definition.kind, 'bugfix');
  assert.equal(definition.defaultMode, 'OWNER_AND_QA');
  assert.equal(definition.releaseRisk.highRisk, 'access');
});
