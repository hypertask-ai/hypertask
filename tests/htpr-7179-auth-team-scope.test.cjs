const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { NextRequest } = require('next/server');
const { fixture } = require('./helpers/agent-board-scope.cjs');

process.env.JWT_SECRET = 'fixture';
process.env.SESSION_SECRET = 'fixture';
process.env.JWT_ISSUER = 'hypertask';
const scopeA = { teamId: 'team-a', accessBinding: 'owner:account-a:0' };
const scopeB = { teamId: 'team-b', accessBinding: 'owner:account-b:0' };

function authFixture() {
  const f = fixture();
  f.projects.forEach(project => { project.teamId = scopeA.teamId; });
  f.agent.members = f.projects.map(project => ({ project }));
  Object.assign(f.agent, { credentialTeamId: scopeA.teamId, credentialTeamAccessBinding: scopeA.accessBinding });
  const team = { id: scopeA.teamId, title: 'A', googleAccount: { id: 'account-a', userId: f.user.id }, managementKeyOwnerGeneration: 0, members: [] };
  f.prisma.team.findFirst = async () => {
    if (f.state.lookupError) throw new Error('fixture lookup failed');
    return f.state.noGrant ? null : team;
  };
  const auth = f.load('src/lib/mcp/auth/verifyJwt.ts', { '@/lib/flags': { isFeatureEnabled: async () => { if (f.state.authFlagError) throw new Error('fixture flag lookup failed'); return true; } } });
  const mint = (scope = scopeA) => {
    const token = auth.createMcpToken(f.user.id, f.user.email, undefined, f.agent.id, scope ?? undefined);
    Object.assign(f.agent, auth.agentTokenCredentialFields(token));
    return token;
  };
  return { ...f, auth, mint, team };
}

for (const kind of ['direct', 'OAuth']) {
  test(`${kind}: current A-bound credential retains verified scope and generation`, async () => {
    const f = authFixture();
    const direct = f.mint();
    f.prisma.oAuthClient = { findUnique: async () => ({ client_id: 'fixture-client' }) };
    const token = kind === 'direct' ? direct : f.auth.createOAuthToken('fixture-user', f.user.id, f.user.email, 'fixture-client', 60, f.agent.id, f.agent.mcpTokenJti, scopeA);
    const ctx = await f.auth.validateJwtToken(token);
    assert.deepEqual(ctx.teamScope, scopeA);
    assert.equal(ctx.agentId, f.agent.id);
    assert.equal(ctx.agentTokenGeneration, f.agent.mcpTokenJti);
  });

  for (const fault of ['signed-unbound', 'stored-unbound', 'persisted-different-team', 'persisted-stale-binding', 'different-team', 'different-binding', 'stored-half-team', 'stored-half-binding', 'signed-half-team', 'signed-half-binding', 'removed-grant', 'changed-grant', 'lookup-error', 'feature-error']) {
    test(`${kind}: ${fault} rejects rather than becoming unbound`, async () => {
      const f = authFixture();
      f.prisma.oAuthClient = { findUnique: async () => ({ client_id: 'fixture-client' }) };
      const direct = f.mint();
      const good = kind === 'direct' ? direct : f.auth.createOAuthToken('fixture-user', f.user.id, f.user.email, 'fixture-client', 60, f.agent.id, f.agent.mcpTokenJti, scopeA);
      assert.deepEqual((await f.auth.validateJwtToken(good)).teamScope, scopeA);
      const payload = jwt.decode(good);
      if (fault === 'signed-unbound') { delete payload.agentTeamId; delete payload.agentTeamAccessBinding; }
      if (fault === 'stored-unbound') Object.assign(f.agent, { credentialTeamId: null, credentialTeamAccessBinding: null });
      if (fault === 'persisted-different-team') f.agent.credentialTeamId = scopeB.teamId;
      if (fault === 'persisted-stale-binding') f.agent.credentialTeamAccessBinding = 'owner:account-a:1';
      if (fault === 'different-team') payload.agentTeamId = scopeB.teamId;
      if (fault === 'different-binding') payload.agentTeamAccessBinding = 'owner:account-a:1';
      if (fault === 'stored-half-team') f.agent.credentialTeamAccessBinding = null;
      if (fault === 'stored-half-binding') f.agent.credentialTeamId = null;
      if (fault === 'signed-half-team') delete payload.agentTeamAccessBinding;
      if (fault === 'signed-half-binding') delete payload.agentTeamId;
      if (fault === 'removed-grant') f.state.noGrant = true;
      if (fault === 'changed-grant') f.team.managementKeyOwnerGeneration = 1;
      if (fault === 'lookup-error') f.state.lookupError = true;
      if (fault === 'feature-error') f.state.authFlagError = true;
      const token = jwt.sign(payload, process.env.JWT_SECRET);
      if (kind === 'direct') f.agent.mcpTokenHash = f.auth.hashAgentToken(token);
      assert.equal(await f.auth.validateJwtToken(token), null);
    });
  }
}

test('positively unbound human and agent JWTs retain null scope', async () => {
  const f = authFixture();
  Object.assign(f.agent, { credentialTeamId: null, credentialTeamAccessBinding: null });
  assert.equal((await f.auth.validateJwtToken(f.mint(null))).teamScope, null);
  const token = f.auth.createMcpToken(f.user.id, f.user.email);
  const human = await f.auth.validateJwtToken(token);
  assert.equal(human.agentId, null);
  assert.equal(human.teamScope, null);
});

test('legacy API keys and account management keys are unbound; team management contexts retain A without acquiring data capability', async () => {
  const f = authFixture();
  const apiKey = { id: 1, lastUsedAt: new Date(), user: f.user };
  f.prisma.apiKey = { findFirst: async () => apiKey };
  let prefix = 'htmk_';
  f.prisma.betterAuthApiKey = { findFirst: async () => ({ teamId: scopeA.teamId, teamAccessBinding: scopeA.accessBinding }) };
  const session = f.load('src/lib/mcp/auth/session.ts', {
    '@/lib/flags': { isFeatureEnabled: async () => true },
    '@/lib/auth/betterAuth': { auth: { api: { verifyApiKey: async () => ({ valid: true, key: { id: '1', referenceId: String(f.user.id), prefix, permissions: { management: ['read'] } } }) } } },
    '@/lib/mcp/clientTelemetry': { logMcpCliUsage() {} },
    '@/lib/telemetry/analyticsIntents': { enqueueOutsideSaveAndProcessSoon: async () => {} },
    '@/lib/telemetry/activationOccurrences': {},
  });
  const request = token => new NextRequest('http://localhost/api/mcp/tasks', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await session.validateMcpAuth(request('htk_fixture'))).teamScope, null);
  assert.equal((await session.validateManagementApiKey('htmk_fixture')).teamScope, null);
  prefix = 'httk_';
  assert.deepEqual((await session.validateManagementApiKey('httk_fixture')).teamScope, scopeA);
  assert.equal(await session.validateMcpAuth(request('httk_fixture')), null);
});

test('invalid bearer cannot fall back to a valid human cookie', async () => {
  const f = authFixture();
  const session = f.load('src/lib/mcp/auth/session.ts', {
    './verifyJwt': { validateJwtToken: async () => null, JWT_MCP_AUDIENCE: 'mcp-api' },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: f.user.id, teamScope: null }) },
  });
  assert.equal(await session.validateManagementOrSessionAuth(new NextRequest('http://localhost/api/mcp/admin/agents', { headers: { Authorization: 'Bearer invalid', Cookie: 'ht_session=fixture' } })), null);
  assert.equal((await session.validateManagementOrSessionAuth(new NextRequest('http://localhost/api/mcp/admin/agents', { headers: { Cookie: 'ht_session=fixture' } }))).teamScope, null);
});

test('owner re-mint preserves persisted scope and refuses a missing current grant', async () => {
  const f = authFixture();
  f.agent.runtimeType = 'EXTERNAL';
  f.mint();
  const route = f.load('src/app/api/agents/[agentId]/mcp-token/route.ts', {
    '@/lib/mcp/auth': f.auth,
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: f.user.id, teamScope: null }) },
  });
  const invoke = () => route.POST(new NextRequest('http://localhost/api/agents/fixture/mcp-token', { method: 'POST' }), { params: Promise.resolve({ agentId: f.agent.id }) });
  const result = await invoke();
  assert.equal(result.status, 200);
  const body = await result.json();
  const claims = jwt.verify(body.token, process.env.JWT_SECRET);
  assert.equal(claims.agentTeamId, scopeA.teamId);
  assert.equal(claims.agentTeamAccessBinding, scopeA.accessBinding);
  f.state.noGrant = true;
  f.writes.length = 0;
  assert.equal((await invoke()).status, 403);
  assert.deepEqual(f.writes, []);
});

test('signed bridge re-resolves a stored-bound agent even when legacy scope is absent', async () => {
  const f = authFixture();
  f.mint();
  const session = f.load('src/lib/auth/session.ts');
  const receiving = f.load('src/lib/auth/getSessionUser.ts', { '@/lib/auth/sessionRevocation': { isSessionTokenRevoked: async () => false } });
  const headers = payload => new Headers({ Cookie: `ht_session=${session.signSession({ id: f.user.id, agentId: f.agent.id, ...payload })}` });
  const explicit = await receiving.getSessionUser(headers({ teamScope: scopeA, agentTokenGeneration: f.agent.mcpTokenJti }));
  assert.deepEqual(explicit.teamScope, scopeA);
  assert.deepEqual((await receiving.getSessionUser(headers({}))).teamScope, scopeA);
  assert.equal(await receiving.getSessionUser(headers({ teamScope: scopeB })), null);
  assert.equal(await receiving.getSessionUser(headers({ agentTokenGeneration: 'old-generation' })), null);
  f.state.noGrant = true;
  assert.equal(await receiving.getSessionUser(headers({})), null);
  f.state.noGrant = false;
  Object.assign(f.agent, { credentialTeamId: null, credentialTeamAccessBinding: null });
  assert.equal((await receiving.getSessionUser(headers({}))).teamScope, null);
});

test('owner re-enable mints with the stored binding and refuses a removed grant before changing runtime state', async () => {
  const f = authFixture();
  f.mint();
  f.agent.runtimeType = 'EXTERNAL';
  f.agent.revokedAt = new Date('2026-01-01');
  f.prisma.agent.findUniqueOrThrow = f.prisma.agent.findUnique;
  const route = f.load('src/app/api/agents/[agentId]/route.ts', {
    '@/lib/mcp/auth': f.auth,
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: f.user.id, teamScope: null }) },
    '@/lib/agents/slug': { looksLikeAgentId: () => true },
    '@/lib/agents/ownedSlugs': {},
    '@/lib/agents/runtimeState': { clearAgentRuntimeSnapshot: async () => { f.writes.push('runtime'); } },
    '@/utils/controllers/agents/changeTeamAgentRole': {},
    '@/lib/aiModelOptions': {}, '@/lib/nativeAgent/modelPin': {},
    '@/lib/agents/working': {}, '@/lib/agents/poolScope': {},
    '@/lib/mcp/agents/ownedAgents': {}, '@/lib/agents/boardAccess': {},
    '@/lib/agents/visibility': {},
  });
  const invoke = () => route.PATCH(new NextRequest('http://localhost/api/agents/fixture', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revoked: false }) }), { params: Promise.resolve({ agentId: f.agent.id }) });
  f.state.noGrant = true;
  assert.equal((await invoke()).status, 403);
  assert.deepEqual(f.writes, []);
  f.state.noGrant = false;
  const result = await invoke();
  assert.equal(result.status, 200);
  const claims = jwt.verify((await result.json()).token, process.env.JWT_SECRET);
  assert.equal(claims.agentTeamId, scopeA.teamId);
  assert.equal(claims.agentTeamAccessBinding, scopeA.accessBinding);
});

test('accepted member binding is retained, but removed or reaccepted grants cannot revive it', async () => {
  const f = authFixture();
  const memberScope = { teamId: 'team-a', accessBinding: 'member:membership-a:0' };
  f.team.googleAccount.userId = 7;
  f.team.members = [{ id: 'membership-a', managementKeyAccessGeneration: 0 }];
  f.agent.credentialTeamAccessBinding = memberScope.accessBinding;
  const token = f.mint(memberScope);
  assert.deepEqual((await f.auth.validateJwtToken(token)).teamScope, memberScope);
  f.team.members = [];
  assert.equal(await f.auth.validateJwtToken(token), null);
  f.team.members = [{ id: 'membership-a', managementKeyAccessGeneration: 1 }];
  assert.equal(await f.auth.validateJwtToken(token), null);
});
