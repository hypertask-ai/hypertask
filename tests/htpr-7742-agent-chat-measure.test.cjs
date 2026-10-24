const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createJiti } = require('jiti');
const { NextRequest } = require('next/server');
const root = path.resolve(__dirname, '..');
let ctx, enabled, queries;
const stub = (file, exports) => { const id = path.join(root, file); require.cache[id] = { id, filename: id, loaded: true, exports }; };
const agents = [
  { active: true, archived: false, webhook: { active: true, events: ['task.assigned'] }, age: 1000 },
  { active: true, archived: false, webhook: { active: true, events: ['chat.message'] }, age: 1000 },
  { active: true, archived: false, webhook: null, age: 120000 },
  { active: false, archived: false, webhook: { active: true, events: [] }, age: 1000 },
  { active: true, archived: true, webhook: { active: true, events: [] }, age: 1000 },
];
const prisma = {
  agent: { count: async ({ where }) => {
    queries.push(where);
    assert.equal(where.revokedAt, null); assert.equal(where.archivedAt, null);
    const active = agents.filter((agent) => agent.active && !agent.archived);
    if (where.heartbeatAt) {
      assert.ok(Math.abs(Date.now() - where.heartbeatAt.gt.getTime() - 120000) < 5000);
      return active.filter((agent) => agent.age < 120000).length;
    }
    assert.deepEqual(where.agentWebhookSubscription, { is: { active: true, NOT: { events: { has: 'chat.message' } } } });
    return active.filter((agent) => agent.webhook?.active && !agent.webhook.events.includes('chat.message')).length;
  } },
  $queryRaw: async (strings, since) => {
    const sql = strings.join('?'); queries.push(sql);
    assert.match(sql, /SELECT COUNT\(\*\)/); assert.match(sql, /session\."agentId" IS NOT NULL/);
    assert.match(sql, /message\.role = 'human'/); assert.match(sql, /message\."createdAt" >=/);
    assert.match(sql, /NOT EXISTS[\s\S]*reply\."replyToMessageId" = message\.id/);
    assert.doesNotMatch(sql, /UPDATE|INSERT|DELETE/);
    assert.ok(Math.abs(Date.now() - since.getTime() - 7 * 86400000) < 5000);
    return [{ count: 3n }];
  },
  project: { findFirst: async () => ({ id: 15, section: [] }) },
  task: { groupBy: async () => [] },
};
stub('src/lib/prisma.ts', { default: prisma });
stub('src/lib/mcp/routeWrapper.ts', { wrapMcpRoute: (fn) => fn, checkMcpRouteRateLimit: async () => null, validateMcpRouteAuth: async () => ctx });
stub('src/utils/controllers/projects/getAllIncludes.ts', { getProjectWhere: () => ({}) });
stub('src/lib/flags.ts', { isFeatureFlagOwnerUserId: async (id) => id === 6, isFeatureEnabled: async (key) => key === 'htpr-7742-agent-chat-all' && enabled });
const load = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true });
const route = load(path.join(root, 'src/app/api/mcp/agents/analytics/route.ts'));
const request = (query = 'chat=true') => new NextRequest(`https://app.hypertask.ai/api/mcp/agents/analytics?${query}`);
test.beforeEach(() => { ctx = { user: { id: 6 }, agentId: null }; enabled = true; queries = []; });
test('measurement refuses non-owner users, owner agents, management and anonymous callers without querying counts', async () => {
  for (const caller of [null, { user: { id: 985 } }, { user: { id: 6 }, agentId: 'agent-1' }, { user: { id: 6 }, management: {} }]) {
    ctx = caller;
    assert.equal((await route.GET(request())).status, caller ? 403 : 401);
    assert.equal(queries.length, 0);
  }
});
test('measurement still allows the owner and returns read-only bounded counts with no-store', async () => {
  const response = await route.GET(request());
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json();
  assert.equal(body.activeWebhookWithoutChat, 1); assert.equal(body.freshHeartbeat, 2); assert.equal(body.unansweredLast7Days, 3);
  assert.equal(new Date(body.asOf) - new Date(body.since), 7 * 86400000);
  assert.equal(queries.length, 3);
});
test('measurement refuses flag-off, and still allows flag-on', async () => {
  enabled = false; assert.equal((await route.GET(request())).status, 404); assert.equal(queries.length, 0);
  enabled = true; assert.equal((await route.GET(request())).status, 200);
});
test('existing project analytics remains available to ordinary authorized users with the flag off', async () => {
  enabled = false; ctx = { user: { id: 985 }, agentId: null };
  const response = await route.GET(request('project_id=15'));
  assert.equal(response.status, 200); assert.equal((await response.json()).projectId, 15); assert.equal(queries.length, 0);
});
test('measurement docs provide the exact owner-only call and count definitions', () => {
  const docs = fs.readFileSync(path.join(root, 'docs/mcp-tools.md'), 'utf8');
  assert.match(docs, /https:\/\/app.hypertask.ai\/api\/mcp\/agents\/analytics\?chat=true/);
  for (const name of ['activeWebhookWithoutChat', 'freshHeartbeat', 'unansweredLast7Days']) assert.ok(docs.includes(name));
});
