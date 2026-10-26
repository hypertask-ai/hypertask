const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { load } = require('./task-route-loader.cjs');

function fixture({ anonymous = false, rateLimited = false } = {}) {
  const queries = [];
  const crashes = [];
  const scope = { members: { some: { agentId: 'own-agent' } } };
  const project = {
    id: 17, title: 'Project', name: 'project', description: null,
    uniqueIdentifier: 'DEMO', ownerId: 42, owner: null,
    status: 'Normal', sections: ['Todo'], section: [{ id: 1, section_title: 'Todo' }],
    labels: [{ id: 'tag', value: 'Work' }], createdAt: new Date('2026-10-01T00:00:00Z'),
    _count: { members: 1, tasks: 2 },
  };
  const { GET } = load('src/lib/mcp/operations/projects/operation.ts', {
    '@/lib/auth/agentScope': { recordAgentBoardScopeMiss: () => {} },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: (_request, error) => crashes.push(error) },
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: handler => handler,
      validateMcpRouteAuth: async () => anonymous ? null : { user: { id: 42 }, agentId: 'own-agent' },
      checkMcpRouteRateLimit: async () => rateLimited ? new Response(null, { status: 429 }) : null,
    },
    '@/utils/controllers/projects/getAllIncludes': {
      getProjectListingWhere: (userId, agentId, teamScope) => {
        assert.equal(userId, 42);
        assert.equal(agentId, 'own-agent');
        assert.equal(teamScope, undefined);
        return scope;
      },
    },
    '@/lib/prisma': { default: { project: {
      count: async query => { queries.push(['count', query]); return 1; },
      findMany: async query => { queries.push(['findMany', query]); return [project]; },
    } } },
  });
  return {
    queries, crashes, scope,
    request: params => GET(new NextRequest('https://app.hypertask.ai/api/mcp/projects?' + new URLSearchParams(params))),
  };
}

for (const params of [
  { filter: JSON.stringify({ updated_since: '2026-10-01T00:00:00Z' }) },
  { 'filter.updated_since': '2026-10-01T00:00:00Z' },
  { sort: 'updatedAt:desc' },
  { sort_by: 'updatedAt' },
  { sort_by: 'createdAt', sort_order: 'invalid' },
]) {
  test('unsupported project query returns 400 before database reads: ' + JSON.stringify(params), async () => {
    const f = fixture();
    const response = await f.request(params);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error, 'Validation error');
    assert.match(body.message, /not supported for projects|title or createdAt|asc or desc/);
    assert.deepEqual(f.queries, []);
    assert.deepEqual(f.crashes, []);
  });
}

for (const [params, orderBy] of [
  [{}, { title: 'asc' }],
  [{ sort: 'title:desc' }, { title: 'desc' }],
  [{ sort: 'createdAt:desc' }, { createdAt: 'desc' }],
  [{ sort_by: 'createdAt', sort_order: 'asc' }, { createdAt: 'asc' }],
]) {
  test('supported discovery retains scope, projection and pagination: ' + JSON.stringify(params), async () => {
    const f = fixture();
    const response = await f.request({ ...params, fields: 'id,title,createdAt', limit: '1', cursor: '9' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.projects, [{ id: 17, title: 'Project', createdAt: '2026-10-01T00:00:00.000Z' }]);
    assert.equal(body.total, 1);
    assert.equal(body.nextCursor, '17');
    assert.equal(body.offset, 0);
    const query = f.queries[1][1];
    assert.deepEqual(query.where, { status: 'Normal', AND: [f.scope] });
    assert.deepEqual(query.orderBy, [orderBy, { id: 'asc' }]);
    assert.deepEqual(query.cursor, { id: 9 });
    assert.equal(query.skip, 1);
    assert.equal(query.take, 1);
    assert.deepEqual(f.crashes, []);
  });
}

test('validation leaves authentication and rate limits first', async () => {
  for (const [options, expected] of [[{ anonymous: true }, 401], [{ rateLimited: true }, 429]]) {
    const f = fixture(options);
    const response = await f.request({ sort: 'updatedAt' });
    assert.equal(response.status, expected);
    assert.deepEqual(f.queries, []);
  }
});
