const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const cp = require('node:child_process');
const { createJiti } = require('jiti');
const root = path.resolve(__dirname, '..');
let enabled, agents, updates, reads, limited, writes;
const contexts = {
  own: { user: { id: 6 }, agentId: 'agent-1' },
  other: { user: { id: 6 }, agentId: 'agent-2' },
  human: { user: { id: 6 }, agentId: null },
  management: { user: { id: 6 }, agentId: null, management: {} },
  wrongOwner: { user: { id: 7 }, agentId: 'agent-1' },
};
const stub = (file, exports) => {
  const id = path.join(root, file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const matches = (agent, where) => agent.id === where.id && agent.userId === where.userId && agent.revokedAt === where.revokedAt;
const prisma = { agent: {
  findFirst: async ({ where, select }) => {
    reads++;
    assert.deepEqual(select, { heartbeatAt: true });
    const agent = agents.find((agent) => matches(agent, where));
    return agent ? { heartbeatAt: agent.heartbeatAt } : null;
  },
  updateMany: async ({ where, data }) => {
    updates.push({ where, data });
    assert.deepEqual(Object.keys(data), ['heartbeatAt']);
    assert.deepEqual(where.OR[0], { heartbeatAt: null });
    assert.equal(data.heartbeatAt - where.OR[1].heartbeatAt.lte, 30000);
    const agent = agents.find((agent) => matches(agent, where) && (!agent.heartbeatAt || agent.heartbeatAt <= where.OR[1].heartbeatAt.lte));
    if (!agent) return { count: 0 };
    writes++;
    agent.heartbeatAt = data.heartbeatAt;
    return { count: 1 };
  },
} };
stub('src/lib/prisma.ts', { default: prisma });
stub('src/lib/mcp/routeWrapper.ts', {
  wrapMcpRoute: (fn) => fn,
  checkMcpRouteRateLimit: async () => limited,
  validateMcpRouteAuth: async (request) => contexts[request.headers.get('authorization')?.replace(/^Bearer /, '')] ?? null,
});
stub('src/lib/flags.ts', { isFeatureEnabled: async (key, userId) => {
  assert.equal(key, 'htpr-7742-agent-chat-all');
  assert.ok([6, 7].includes(userId));
  return enabled;
} });
const load = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true });
const route = load(path.join(root, 'src/app/api/mcp/chat/heartbeat/route.ts'));
const { refreshAgentChatHeartbeat } = load(path.join(root, 'src/lib/agents/chatHeartbeat.ts'));
const { agentChatDeliveryMode } = load(path.join(root, 'src/lib/agents/chatAvailability.ts'));
const now = new Date('2026-10-24T12:00:00Z');
test.beforeEach(() => {
  enabled = true; updates = []; reads = 0; limited = null; writes = 0;
  agents = [1, 2].map((id) => ({ id: `agent-${id}`, userId: 6, revokedAt: null, heartbeatAt: null, runtimeGeneration: 4 }));
});
const request = (token = 'own', body = '{}', query = '') => new Request(`https://app.hypertask.ai/api/mcp/chat/heartbeat${query}`, {
  method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body,
});
test('heartbeat refuses missing/invalid auth and human/management credentials without DB access; ordinary own agent is allowed', async () => {
  for (const [token, status] of [[null, 401], ['invalid', 401], ['human', 403], ['management', 403]]) {
    assert.equal((await route.POST(request(token))).status, status);
    assert.equal(reads, 0); assert.equal(updates.length, 0);
  }
  assert.equal((await route.POST(request())).status, 200);
  assert.equal(updates.length, 1);
});
test('flag off returns 404 without touching heartbeats; flag on permits own heartbeat', async () => {
  enabled = false;
  assert.equal((await route.POST(request())).status, 404);
  assert.equal(reads, 0); assert.equal(updates.length, 0);
  enabled = true;
  assert.equal((await route.POST(request())).status, 200);
});
test('own ordinary token updates only heartbeatAt and makes non-chat webhook polling fresh', async () => {
  const before = Date.now();
  const response = await route.POST(request());
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.success, true);
  assert.ok(agents[0].heartbeatAt.getTime() >= before);
  assert.equal(body.heartbeat_at, agents[0].heartbeatAt.toISOString());
  assert.equal(agents[1].heartbeatAt, null); assert.equal(agents[0].runtimeGeneration, 4);
  assert.equal(agentChatDeliveryMode({ heartbeatAt: agents[0].heartbeatAt, subscription: { active: true, events: ['run.created'] } }, new Date(), true), 'polling');
});
test('another agent token cannot target this agent via body or query; it can still update itself', async () => {
  assert.equal((await route.POST(request('other', '{"agentId":"agent-1"}'))).status, 400);
  assert.equal(updates.length, 0);
  assert.equal((await route.POST(request('other', '{}', '?agentId=agent-1'))).status, 200);
  assert.equal(agents[0].heartbeatAt, null); assert.ok(agents[1].heartbeatAt instanceof Date);
  assert.equal(updates[0].where.id, 'agent-2');
});
test('second heartbeat under 30 seconds does not call updateMany and returns existing timestamp', async () => {
  const first = await (await route.POST(request())).json();
  const second = await (await route.POST(request())).json();
  assert.equal(updates.length, 1); assert.equal(second.heartbeat_at, first.heartbeat_at);
});
test('throttle skips fresh heartbeat, writes at 30-second boundary and never moves a future heartbeat backwards', async () => {
  for (const age of [29999, -1000]) {
    agents[0].heartbeatAt = new Date(now.getTime() - age);
    assert.equal(await refreshAgentChatHeartbeat(prisma, 'agent-1', 6, now), agents[0].heartbeatAt);
    assert.equal(updates.length, 0);
  }
  agents[0].heartbeatAt = new Date(now.getTime() - 30000);
  assert.equal(await refreshAgentChatHeartbeat(prisma, 'agent-1', 6, now), now);
  assert.equal(updates.length, 1);
});
test('concurrent stale calls perform only one matching heartbeat write', async () => {
  const results = await Promise.all([1, 2].map(() => refreshAgentChatHeartbeat(prisma, 'agent-1', 6, now)));
  assert.deepEqual(results, [now, now]);
  assert.equal(updates.filter(({ where }) => where.id === 'agent-1').length, 2);
  assert.equal(agents[0].heartbeatAt, now);
  assert.equal(reads, 3);
  assert.equal(writes, 1);
});
test('missing, revoked and wrong-owner agent are refused; active own agent remains allowed', async () => {
  agents[0].revokedAt = new Date();
  assert.equal((await route.POST(request())).status, 404);
  agents[0].revokedAt = null;
  assert.equal((await route.POST(request('wrongOwner'))).status, 404);
  agents.shift();
  assert.equal((await route.POST(request())).status, 404);
  assert.equal(updates.length, 0);
  assert.equal((await route.POST(request('other'))).status, 200);
});
test('heartbeat rejects malformed/nonempty bodies without updates; empty object remains allowed', async () => {
  for (const body of ['{', 'null', '[]', '"hello"', '{"heartbeatAt":"2099-01-01"}']) {
    assert.equal((await route.POST(request('own', body))).status, 400);
    assert.equal(updates.length, 0);
  }
  assert.equal((await route.POST(request())).status, 200);
});
test('rate limiting refuses writes; non-limited request is still allowed', async () => {
  limited = Response.json({ error: 'Rate limited' }, { status: 429 });
  assert.equal((await route.POST(request())).status, 429);
  assert.equal(reads, 0); assert.equal(updates.length, 0);
  limited = null;
  assert.equal((await route.POST(request())).status, 200);
});
test('managed runtime heartbeat route and its generation requirement remain unchanged', () => {
  const file = 'src/app/api/mcp/agents/runtime-heartbeat/route.ts';
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(source, /if \(!ctx\?\.agentId \|\| !ctx\.agentRuntimeGeneration\)/);
  assert.equal(cp.execFileSync('git', ['diff', '--', file], { cwd: root, encoding: 'utf8' }), '');
});
