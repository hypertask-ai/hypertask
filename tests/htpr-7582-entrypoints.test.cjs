const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, loader, source, ctx, session, NOW, ID, FLAG, ts, root } = require('./htpr-7582-fixtures.cjs');
const { NextRequest } = require('next/server');
const { z } = require('zod');
const POST_PATH = 'src/lib/mcp/operations/agents/board-access-requests/operation.ts';
const GET_PATH = 'src/lib/mcp/operations/agents/board-access-requests/[requestId]/operation.ts';
const DECIDE_PATH = 'src/app/api/agents/board-access-requests/[requestId]/decision/route.ts';
const contracts = loader()('src/lib/agents/boardAccessRequests/contracts.ts');
function routes(f, auth = ctx(), human = session(), guest = false) {
  const stubs = { ...f.stubs, '@/lib/agents/boardAccessRequests/service': f.service,
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: run => run, checkMcpRouteRateLimit: async () => null, validateMcpRouteAuth: async () => auth },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => human }, '@/lib/demo/guestGuard': { isGuestUserId: async () => guest } };
  const load = loader(stubs);
  return { post: load(POST_PATH).POST, get: load(GET_PATH).GET, decide: load(DECIDE_PATH).POST };
}
const request = (body, path = '/api/mcp/agents/board-access-requests', headers = {}) => new NextRequest(`https://app.hypertask.ai${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const params = id => ({ params: Promise.resolve({ requestId: id }) });
const humanRequest = (body, id = ID, headers = {}) => request(body, `/api/agents/board-access-requests/${id}/decision`, { Cookie: 'session=offline-fixture', Origin: 'https://app.hypertask.ai', ...headers });

test('strict request schema rejects spoofed agent, owner, role and recipient fields', () => {
  for (const extra of [{ agent_id: 'other' }, { owner_id: 7 }, { role: 'admin' }, { permissions: {} }, { recipient: 7 }]) assert.equal(contracts.createBoardAccessRequestSchema.safeParse({ project_id: 15, reason: 'x', ...extra }).success, false);
  for (const input of [{ project_id: 0, reason: 'x' }, { project_id: 1.5, reason: 'x' }, { project_id: '15', reason: 'x' }, { project_id: 15, reason: '   ' }, { project_id: 15, reason: 'x'.repeat(1001) }]) assert.equal(contracts.createBoardAccessRequestSchema.safeParse(input).success, false);
});
test('strict request schema permits and trims plain untrusted text', () => {
  assert.deepEqual(contracts.createBoardAccessRequestSchema.parse({ project_id: 15, reason: ' <b>not authority</b> ' }), { project_id: 15, reason: '<b>not authority</b>' });
});
test('strict status/decision reject identity inputs and non-UUID locators', () => {
  assert.equal(contracts.getBoardAccessRequestSchema.safeParse({ request_id: 'not-a-uuid' }).success, false);
  assert.equal(contracts.getBoardAccessRequestSchema.safeParse({ request_id: ID, agent_id: 'other' }).success, false);
  assert.equal(contracts.decideBoardAccessRequestSchema.safeParse({ decision: 'approve', ownerId: 6 }).success, false);
});
test('strict status/decision permit only UUID and approve/decline', () => {
  assert.equal(contracts.getBoardAccessRequestSchema.parse({ request_id: ID }).request_id, ID);
  for (const decision of ['approve', 'decline']) assert.equal(contracts.decideBoardAccessRequestSchema.parse({ decision }).decision, decision);
});
test('REST unauthenticated create/status are refused', async () => {
  const f = fixture(); const r = routes(f, null);
  assert.equal((await r.post(request({ project_id: 15, reason: 'x' }))).status, 401);
  assert.equal((await r.get(new NextRequest('https://app.hypertask.ai/api/mcp/agents/board-access-requests/' + ID), params(ID))).status, 401);
});
test('REST agent create returns 201, replay 200, status 200 and quotas Retry-After', async () => {
  const f = fixture(); const r = routes(f);
  const first = await r.post(request({ project_id: 15, reason: 'x' })); assert.equal(first.status, 201);
  const id = (await first.json()).request.id;
  assert.equal((await r.post(request({ project_id: 15, reason: 'x' }))).status, 200);
  assert.equal((await r.get(new NextRequest('https://app.hypertask.ai/api/mcp/agents/board-access-requests/' + id), params(id))).status, 200);
  Object.assign(f.state.requests[0], { status: 'declined', resolvedAt: new Date() });
  const quota = await r.post(request({ project_id: 15, reason: 'again' })); assert.equal(quota.status, 429); assert.ok(Number(quota.headers.get('Retry-After')) > 0);
});
test('REST create rejects malformed identity payload and unavailable board', async () => {
  const f = fixture(); const r = routes(f);
  assert.equal((await r.post(request({ project_id: 15, reason: 'x', agent_id: 'other' }))).status, 400);
  f.state.board = null;
  assert.equal((await r.post(request({ project_id: 15, reason: 'x' }))).status, 404);
});
test('REST owner-visible board still accepts proper request', async () => { const f = fixture(); assert.equal((await routes(f).post(request({ project_id: 15, reason: 'x' }))).status, 201); });
test('decision route rejects agent cookie, bearer, management key, guest, non-owner and cross-origin request', async () => {
  for (const scenario of ['agent', 'bearer', 'management', 'guest', 'foreignOwner', 'csrf', 'missingOrigin', 'noCookie', 'notJson']) {
    const f = fixture(); const id = (await f.create()).request.id;
    const human = scenario === 'agent' ? session({ agentId: 'agent-1' }) : scenario === 'foreignOwner' ? session({ userId: 7 }) : session();
    const r = routes(f, ctx(), human, scenario === 'guest');
    const headers = scenario === 'bearer' || scenario === 'management' ? { Authorization: `Bearer ${scenario}-offline-fixture` } : scenario === 'csrf' ? { Origin: 'https://evil.example' } : scenario === 'missingOrigin' ? { Origin: '' } : scenario === 'noCookie' ? { Cookie: '' } : scenario === 'notJson' ? { 'Content-Type': 'text/plain' } : {};
    const response = await r.decide(humanRequest({ decision: 'approve' }, id, headers), params(id));
    assert.ok([403, 404].includes(response.status), `${scenario}: ${response.status}`); assert.equal(f.state.grants, 0);
    assert.equal(f.state.logs.at(-1).outcome, 'denied');
  }
});
test('human owner cookie with same-origin JSON still approves in one POST', async () => {
  const f = fixture(); const id = (await f.create()).request.id;
  const response = await routes(f).decide(humanRequest({ decision: 'approve' }, id), params(id));
  assert.equal(response.status, 200); assert.equal((await response.json()).request.status, 'approved'); assert.equal(f.state.members.length, 1);
});
test('decision rejects client-supplied role/identity data and absent session', async () => {
  const f = fixture(); const id = (await f.create()).request.id;
  assert.equal((await routes(f).decide(humanRequest({ decision: 'approve', agentId: 'agent-1' }, id), params(id))).status, 400);
  assert.equal((await routes(f, ctx(), null).decide(humanRequest({ decision: 'approve' }, id), params(id))).status, 401);
});
test('authorized owner decline remains allowed without granting or changing role', async () => {
  const f = fixture(); const id = (await f.create()).request.id;
  assert.equal((await routes(f).decide(humanRequest({ decision: 'decline' }, id), params(id))).status, 200); assert.equal(f.state.members.length, 0);
});
test('portable tools execute through service POST/GET with same calling token', async () => {
  const calls = []; const token = 'offline-agent-caller';
  const load = loader({
    '@/utils/controllers/reports/reportService': { REPORT_CAPABILITIES: 'offline' },
    '@/lib/mcp/auth': { validateMcpAuth: async request => { assert.equal(request.headers.get('Authorization'), `Bearer ${token}`); return ctx(); } },
    '@/lib/mcp/directOperationClient': { createDirectOperationClient: value => {
      assert.equal(value, token);
      return { makeRequest: async (path, options, correlationId) => { calls.push({ path, options, correlationId }); return { success: true }; } };
    } },
  });
  const tools = load('src/lib/mcp-server/tools/board-access-request.tool.ts');
  await tools.requestBoardAccessTool.execute({ project_id: 15, reason: 'Request' }, token);
  const receipts = load('src/lib/mcp-server/tools/get-board-access-request.tool.ts');
  await receipts.getBoardAccessRequestTool.execute({ request_id: ID }, token);
  assert.equal(calls[0].path, '/mcp/agents/board-access-requests'); assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { project_id: 15, reason: 'Request' });
  assert.equal(calls[1].path, '/mcp/agents/board-access-requests/' + ID); assert.equal(calls[1].options.method, 'GET');
  assert.ok(calls.every(call => typeof call.correlationId === 'string'));
});
test('portable catalog hides new tools from humans, management, flag-off and read creation', async () => {
  const f = fixture(); const load = loader({ ...f.stubs, '@/lib/agents/boardAccessRequests/service': f.service });
  const { boardAccessCatalog } = load('src/lib/mcp-server/board-access-catalog.ts');
  const tools = [{ name: 'hypertask_request_board_access' }, { name: 'hypertask_get_board_access_request' }, { name: 'existing' }];
  for (const auth of [undefined, ctx({ agentId: null }), ctx({ management: { keyId: 'key' } })]) assert.deepEqual((await boardAccessCatalog(tools, auth)).map(t => t.name), ['existing']);
  f.state.flag = false; assert.deepEqual((await boardAccessCatalog(tools, ctx())).map(t => t.name), ['existing']);
  f.state.flag = true; f.state.agent.permissions.role = 'read'; assert.deepEqual((await boardAccessCatalog(tools, ctx())).map(t => t.name), ['hypertask_get_board_access_request', 'existing']);
});
test('portable catalog still exposes create and status to write/admin agents', async () => {
  const f = fixture(); const load = loader({ ...f.stubs, '@/lib/agents/boardAccessRequests/service': f.service });
  const { boardAccessCatalog } = load('src/lib/mcp-server/board-access-catalog.ts');
  const tools = [{ name: 'hypertask_request_board_access' }, { name: 'hypertask_get_board_access_request' }];
  assert.equal((await boardAccessCatalog(tools, ctx())).length, 2);
});
function consolidated() {
  const descriptors = JSON.parse(source('src/lib/mcp-server/config/descriptions/agents.json'));
  const load = loader({ '@/lib/mcp/managementPermissions': { hasDataPermission: () => true, hasManagementReadPermission: () => true, hasManagementWritePermission: () => true },
    './config/consolidated-descriptions': { CONSOLIDATED_TOOL_DESCRIPTIONS: [descriptors] },
    './tool-response': { CONSOLIDATED_OUTPUT_SCHEMA: {}, formatToolResponse: value => value }, './deferred-tools': { createMetaTools: () => [] } });
  const { selectMcpTools } = load('src/lib/mcp-server/consolidated-tools.ts');
  const calls = [];
  const tools = ['hypertask_request_board_access', 'hypertask_get_board_access_request'].map((name, i) => ({ name, parameters: i ? contracts.getBoardAccessRequestSchema : contracts.createBoardAccessRequestSchema, execute: async args => { calls.push({ name, args }); return 'receipt'; } }));
  return { selectMcpTools, tools, calls };
}
test('consolidated catalog refuses human access-request actions and restricts read agent creation', () => {
  const { selectMcpTools, tools } = consolidated();
  assert.equal(selectMcpTools(tools, true, { agent: false }, true).length, 0);
  const catalog = selectMcpTools(tools, true, { agent: true, agentRole: 'read' }, true);
  const group = catalog.find(tool => tool.name === 'hypertask_agents');
  assert.equal(group.parameters.shape.action.safeParse('request_board_access').success, false);
  assert.equal(group.parameters.shape.action.safeParse('get_board_access_request').success, true);
});
test('consolidated write agent action dispatches strict request and status to portable tools with annotations', async () => {
  const { selectMcpTools, tools, calls } = consolidated();
  const group = selectMcpTools(tools, true, { agent: true, agentRole: 'write' }, true).find(tool => tool.name === 'hypertask_agents');
  assert.equal(group.annotations.readOnlyHint, false);
  await group.execute({ action: 'request_board_access', input: { project_id: 15, reason: 'Request' } }, 'caller');
  await group.execute({ action: 'get_board_access_request', input: { request_id: ID } }, 'caller');
  assert.equal(calls[0].name, 'hypertask_request_board_access'); assert.deepEqual(calls[0].args, { project_id: 15, reason: 'Request' });
  assert.equal(calls[1].name, 'hypertask_get_board_access_request');
  await assert.rejects(group.execute({ action: 'request_board_access', input: { project_id: 15, reason: 'x', owner_id: 7 } }, 'caller'));
});
test('REST wrappers and in-process registry include literal routes before agent catch-all', () => {
  const registry = source('src/lib/mcp/operations/index.ts');
  assert.ok(registry.indexOf("import('./agents/board-access-requests/operation')") < registry.indexOf("import('./agents/[agentId]/operation')"));
  assert.match(source('src/app/api/mcp/agents/board-access-requests/route.ts'), /export \{ POST \}/);
  assert.match(source('src/app/api/mcp/agents/board-access-requests/[requestId]/route.ts'), /export \{ GET \}/);
  for (const file of ['handler.ts', 'legacy-sse.ts']) assert.match(source('src/lib/mcp-server/' + file), /await boardAccessCatalog\(/);
  assert.match(source('src/lib/mcp-server/tools/index.ts'), /requestBoardAccessTool,/);
  assert.match(source('src/lib/mcp-server/tools/index.ts'), /getBoardAccessRequestTool,/);
});
test('existing self-grant refusal is preserved, owner manual grant remains available', async () => {
  const f = fixture(); const { checkAgentBoardDelegation } = f.load('src/lib/mcp/agents/delegatedAccess.ts');
  assert.equal((await checkAgentBoardDelegation(ctx(), 'agent-1')).status, 403);
  assert.equal(await checkAgentBoardDelegation(ctx({ agentId: null }), 'agent-1'), null);
  const { addAgentToBoard } = f.load('src/utils/controllers/agents/boardMembers.ts');
  assert.equal((await addAgentToBoard(15, 'agent-1', 6)).ok, true); assert.equal(f.state.grants, 1);
});
test('manual addAgent endpoint refuses agent sessions while human owner still succeeds', async () => {
  const f = fixture(); let actor = session({ agentId: 'agent-1' });
  const load = loader({ ...f.stubs, '@/lib/auth/getSessionUser': { getSessionUser: async () => actor }, '@/lib/demo/guestGuard': { isGuestRequest: async () => false } });
  const route = load('src/pages/api/members/addAgent.ts').default;
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  const req = { method: 'POST', headers: {}, body: { projectId: 15, agentId: 'agent-1' } };
  await route(req, response); assert.equal(response.code, 403); assert.equal(f.state.grants, 0);
  actor = session(); await route(req, response); assert.equal(response.code, 200); assert.equal(f.state.grants, 1);
});
test('ticket flag is one access-risk Owner + QA feature definition', () => {
  const definition = loader()('src/lib/flags/definitions/' + FLAG + '.ts').default;
  assert.equal(definition.key, FLAG); assert.equal(definition.kind, 'feature'); assert.equal(definition.defaultMode, 'OWNER_AND_QA'); assert.equal(definition.releaseRisk.highRisk, 'access');
});
