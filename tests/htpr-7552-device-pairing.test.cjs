const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { NextRequest } = require('next/server');
const { fixture, ORIGIN, SECRET, CLAIMANT, CHALLENGE } = require('./helpers/device-pairing.cjs');

test('real POST dispatch requires browser approval and gives only the newly scoped agent credential', async () => {
  const f = fixture(); const flow = await f.start();
  assert.equal(f.state.flows[0].codeHash, createHash('sha256').update(flow.code).digest('hex'));
  assert.equal(JSON.stringify(f.state.flows).includes(flow.code), false);
  await f.claim(flow);
  const credentials = { id: flow.id, claimant: CLAIMANT, verifier: SECRET };
  assert.deepEqual((await f.request('token', credentials)).data, { error: 'authorization_pending' });
  const approved = await f.request('approve', { id: flow.id }, flow);
  assert.equal(approved.status, 200);
  assert.equal(f.state.agents.length, 1);
  assert.deepEqual(f.state.agents[0].permissions, { role: 'write' });
  assert.equal(f.state.agents[0].crossTeamHomeTeamId, f.state.teams[0].id);
  assert.equal(f.state.agents[0].crossTeamAccessGranted, false);
  assert.equal(f.state.agents[0].credentialTeamId, f.state.teams[0].id);
  assert.equal(f.state.agents[0].credentialTeamAccessBinding, 'owner:existing-account:0');
  assert.equal(f.state.lastTeamScope.teamId, f.state.teams[0].id);
  assert.equal(f.state.lastTeamScope.accessBinding, 'owner:existing-account:0');
  assert.equal(f.state.agents[0].members.create.projectId, f.state.boards[0].id);
  assert.equal(JSON.stringify(approved.data).includes('credential'), false);
  const delivered = await f.request('token', credentials);
  assert.equal(delivered.status, 200);
  assert.equal(delivered.data.token, `agent-only-test-credential:${f.state.agents[0].id}`);
  assert.equal(f.state.flows[0].state, 'DELIVERED');
  const retry = await f.request('token', credentials);
  assert.deepEqual(retry.data, delivered.data);
  await f.domain.acknowledgeDevicePairing(f.state.agents[0].id, 'wrong-generation');
  assert.equal(f.state.flows[0].state, 'DELIVERED');
  await f.domain.acknowledgeDevicePairing(f.state.agents[0].id, f.state.flows[0].tokenGeneration);
  const status = await f.request('status', { id: flow.id }, flow);
  assert.equal(status.data.state, 'CONNECTED');
  assert.equal(status.data.boardUrl, `/projects/project-${f.state.boards[0].id}`);
  assert.equal(f.state.flows[0].deliveryResult, null);
  assert.equal((await f.request('token', credentials)).status, 400);
});

test('claim retry proves the verifier without replacing the original claimant', async () => {
  const f = fixture(); const flow = await f.start(); await f.claim(flow);
  const input = { code: flow.code, claimant: CLAIMANT, challenge: CHALLENGE, clientName: 'Test terminal' };
  assert.equal((await f.request('claim', input)).status, 400);
  const recovered = await f.request('claim', { ...input, verifier: SECRET });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.data.id, flow.id);
  assert.equal((await f.request('claim', { ...input, claimant: 'x'.repeat(43), verifier: SECRET })).status, 400);
  assert.equal((await f.request('claim', { ...input, verifier: 'x'.repeat(43) })).status, 400);
});

test('the five-minute deadline applies after claim and after approval', async () => {
  for (const approve of [false, true]) {
    const f = fixture(); const flow = approve ? await f.approved() : await f.start();
    if (!approve) await f.claim(flow);
    f.state.flows[0].expiresAt = new Date(Date.now() - 1);
    assert.equal((await f.request('approve', { id: flow.id }, flow)).data.error, 'expired_token');
    assert.equal((await f.request('token', { id: flow.id, claimant: CLAIMANT, verifier: SECRET })).data.error, 'expired_token');
    assert.equal((await f.request('status', { id: flow.id }, flow)).data.state, 'EXPIRED');
    assert.notEqual(f.state.flows[0].state, 'DELIVERED');
  }
});

test('another browser, another owner, agent sessions and cross-site posts cannot approve', async () => {
  const f = fixture(); const flow = await f.start(); await f.claim(flow);
  const input = { id: flow.id };
  assert.equal((await f.request('approve', input, { cookie: '__Host-ht-device-pairing=' + 'x'.repeat(43) })).status, 400);
  f.state.owner = 7;
  assert.equal((await f.request('approve', input, flow)).status, 400);
  f.state.owner = 42;
  f.state.actor = { userId: 42, agentId: 'other-agent', source: 'legacy' };
  assert.equal((await f.request('approve', input, flow)).status, 403);
  f.state.actor = { userId: 42, source: 'cli-bearer' };
  assert.equal((await f.request('approve', input, flow)).status, 403);
  f.state.actor = null;
  assert.equal((await f.request('approve', input, { ...flow, origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request('approve', input, { ...flow, authorization: 'Bearer fake' })).status, 403);
  assert.equal(f.state.agents.length, 0);
  assert.equal((await f.request('approve', input, flow)).status, 200);
});

test('OFF and unavailable flag storage never issue a credential', async () => {
  for (const failure of ['off', 'error']) {
    const f = fixture(); const flow = await f.approved();
    f.state.flags = failure !== 'off'; f.state.flagError = failure === 'error';
    const result = await f.request('token', { id: flow.id, claimant: CLAIMANT, verifier: SECRET });
    assert.equal(result.status, failure === 'off' ? 403 : 503);
    assert.equal(result.data.token, undefined);
    assert.equal(f.state.flows[0].state, 'APPROVED');
    assert.equal((await f.request('start', {})).status, failure === 'off' ? 403 : 503);
  }
});

test('denial beats undelivered access, clears secrets and invalidates the new credential', async () => {
  const f = fixture(); const flow = await f.approved();
  assert.equal((await f.request('deny', { id: flow.id }, flow)).status, 200);
  assert.equal(f.state.flows[0].credential, null);
  assert.equal(f.state.agents[0].mcpTokenJti, null);
  assert.ok(f.state.agents[0].revokedAt instanceof Date);
  assert.equal((await f.request('token', { id: flow.id, claimant: CLAIMANT, verifier: SECRET })).status, 403);
});

test('failed provisioning rolls back resources and can retry without duplicates', async () => {
  const f = fixture(); const flow = await f.start(); await f.claim(flow);
  f.state.failProvision = true;
  assert.equal((await f.request('approve', { id: flow.id }, flow)).status, 503);
  assert.equal(f.state.flows[0].state, 'CLAIMED');
  assert.equal(f.state.teams.length, 0);
  assert.equal(f.state.agents.length, 0);
  f.state.failProvision = false;
  assert.equal((await f.request('approve', { id: flow.id }, flow)).status, 200);
  assert.equal((await f.request('approve', { id: flow.id }, flow)).status, 200);
  assert.equal(f.state.teams.length, 1);
  assert.equal(f.state.boards.length, 1);
  assert.equal(f.state.agents.length, 1);
});

test('wrong verifier, oversized/invalid bodies and rate-store failures fail closed', async () => {
  const f = fixture(); const flow = await f.approved();
  assert.equal((await f.request('token', { id: flow.id, claimant: CLAIMANT, verifier: 'x'.repeat(43) })).status, 400);
  assert.equal((await f.request('token', { id: flow.id, claimant: 'x'.repeat(43), verifier: SECRET })).status, 400);
  assert.equal((await f.request('start', 'not-json')).status, 400);
  assert.equal((await f.request('start', ' '.repeat(4097))).status, 413);
  f.state.rate = 1001;
  assert.equal((await f.request('start', {})).status, 429);
  f.state.rate = -1;
  assert.equal((await f.request('start', {})).status, 429);
  f.state.rateError = true;
  assert.equal((await f.request('start', {})).status, 503);
  assert.equal(f.state.flows[0].state, 'APPROVED');
});

test('paired agents keep own-board access and refuse foreign tasks with scope flags OFF or unavailable', async () => {
  const { fixture: scopeFixture } = require('./helpers/agent-board-scope.cjs');
  for (const unavailable of [false, true]) {
    const f = scopeFixture();
    f.agent.crossTeamHomeTeamId = 'team';
    f.agent.crossTeamAccessGranted = false;
    f.projects[1].members = [];
    f.state.enforce = false;
    if (unavailable) f.state.flagError = new Error('scope flag storage unavailable');
    f.mocks['@/lib/mcp/agents'] = { mcpVisibleAgentSelect: () => ({}), mapVisibleMcpAgent: () => null, getMcpSessionAgentSummary: async () => null };
    const { GET } = f.load('src/lib/mcp/operations/tasks/operation.ts');
    const own = await GET(new NextRequest(`${ORIGIN}/api/mcp/tasks?task_id=150`));
    assert.equal(own.status, 200);
    const foreign = await GET(new NextRequest(`${ORIGIN}/api/mcp/tasks?task_id=21280`));
    assert.equal(foreign.status, 404);
    assert.equal((await foreign.text()).includes('Task 2128'), false);
    f.state.ctx.agentId = null;
    assert.equal((await GET(new NextRequest(`${ORIGIN}/api/mcp/tasks?task_id=21280`))).status, 200);
  }
});

test('real JWT authentication acknowledges only the delivered credential generation', async () => {
  const { fixture: scopeFixture, matches } = require('./helpers/agent-board-scope.cjs');
  const jwt = require('jsonwebtoken');
  process.env.JWT_SECRET = 'device-pairing-test-only-secret';
  const f = scopeFixture();
  const generation = 'device-pairing-generation';
  const flow = { id: randomUUID(), agentId: f.agent.id, tokenGeneration: generation, state: 'DELIVERED', expiresAt: new Date(Date.now() + 60_000), deliveryResult: 'test-encrypted', credential: null };
  f.agent.devicePairingId = flow.id;
  f.prisma.devicePairing = { updateMany: async ({ where, data }) => {
    if (!matches(flow, where)) return { count: 0 };
    Object.assign(flow, data); return { count: 1 };
  } };
  const domain = f.load('src/lib/auth/devicePairing.ts', {
    '@/lib/mcp/auth/verifyJwt': {}, '@/utils/controllers/projects/createProjectWithStableName': {},
    '@/utils/controllers/projects/create': {}, '@/lib/crypto/byokCipher': {},
  });
  const auth = f.load('src/lib/mcp/auth/verifyJwt.ts', {
    '@/lib/mcp/managementKeyTeamScope': {}, '@/lib/auth/devicePairing': domain,
  });
  const sign = jti => jwt.sign({ userId: f.user.id, agentId: f.agent.id }, process.env.JWT_SECRET, { issuer: 'hypertask', audience: 'mcp-api', jwtid: jti });
  const token = sign(generation);
  f.agent.mcpTokenJti = generation;
  f.agent.mcpTokenHash = auth.hashAgentToken(token);
  assert.equal(await auth.validateJwtToken(sign('wrong-generation'), { boundedLogging: true }), null);
  assert.equal(flow.state, 'DELIVERED');
  flow.expiresAt = new Date(Date.now() - 1);
  assert.equal((await auth.validateJwtToken(token, { boundedLogging: true })).agentId, f.agent.id);
  assert.equal(flow.state, 'CONNECTED');
  assert.equal(flow.deliveryResult, null);
  assert.equal(f.agent.devicePairingId, null);
});

test('rotation or revocation between approval and delivery cannot hand out an obsolete credential', async () => {
  for (const change of ['rotate', 'revoke']) {
    const f = fixture(); const flow = await f.approved();
    if (change === 'rotate') f.state.agents[0].mcpTokenJti = 'replacement-generation';
    if (change === 'revoke') f.state.agents[0].revokedAt = new Date();
    const result = await f.request('token', { id: flow.id, claimant: CLAIMANT, verifier: SECRET });
    assert.equal(result.status, 403);
    assert.equal(result.data.token, undefined);
    assert.equal(f.state.flows[0].state, 'APPROVED');
  }
});

test('expired undelivered cleanup preserves delivered and independently rotated credentials', async () => {
  for (const state of ['approved', 'rotated', 'delivered']) {
    const f = fixture(); const flow = await f.approved();
    if (state === 'rotated') f.state.agents[0].mcpTokenJti = 'replacement-generation';
    if (state === 'delivered') assert.equal((await f.request('token', { id: flow.id, claimant: CLAIMANT, verifier: SECRET })).status, 200);
    f.state.flows[0].expiresAt = new Date(Date.now() - 1);
    const cleanup = f.load('src/lib/auth/devicePairingCleanup.ts');
    await cleanup.cleanupDevicePairings();
    if (state === 'approved') {
      assert.equal(f.state.flows[0].state, 'DENIED');
      assert.equal(f.state.flows[0].credential, null);
      assert.equal(f.state.agents[0].mcpTokenJti, null);
    } else {
      assert.equal(f.state.agents[0].revokedAt, null);
      assert.notEqual(f.state.agents[0].mcpTokenJti, null);
      if (state === 'delivered') assert.equal(f.state.flows[0].state, 'DELIVERED');
    }
    assert.equal(f.state.boards.length, 1);
    assert.equal(f.state.teams.length, 1);
  }
});
