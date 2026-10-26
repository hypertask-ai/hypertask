const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { load } = require('./task-route-loader.cjs');

function fixture() {
  const calls = [];
  const scope = { ownerId: 985, teamId: 'qa-team' };
  const project = {
    id: 7283, title: 'QA Board', name: 'qa-board', ownerId: 985,
    status: 'Normal', createdAt: new Date('2026-10-01T00:00:00.000Z'),
    sections: ['Todo'], section: [{ id: 1, section_title: 'Todo' }],
    labels: [], _count: { members: 1, tasks: 2 },
  };
  const { GET } = load('src/lib/mcp/operations/projects/operation.ts', {
    '@/lib/auth/agentScope': { recordAgentBoardScopeMiss: () => {} },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: handler => handler,
      validateMcpRouteAuth: async () => ({ user: { id: 985 }, agentId: 'qa-agent', teamScope: 'qa-team' }),
      checkMcpRouteRateLimit: async () => null,
    },
    '@/utils/controllers/projects/getAllIncludes': {
      getProjectListingWhere: (id, agentId, teamScope) => {
        assert.deepEqual([id, agentId, teamScope], [985, 'qa-agent', 'qa-team']);
        return scope;
      },
    },
    '@/lib/prisma': { default: { project: {
      count: async args => { calls.push(['count', args]); return 1; },
      findMany: async args => { calls.push(['findMany', args]); return [project]; },
    } } },
  });
  return { calls, scope, invoke: query => GET(new NextRequest(`https://app.hypertask.ai/api/mcp/projects?${query}`)) };
}

for (const query of ['sort=updatedAt:desc', 'sort_by=updatedAt&sort_order=asc']) {
  test(`unsupported project timestamp sort is a client error: ${query}`, async () => {
    const f = fixture();
    const response = await f.invoke(query);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      success: false, error: 'Validation error',
      message: 'Projects do not have updatedAt; sort by title or createdAt instead',
    });
    assert.deepEqual(f.calls, []);
  });
}

test('project updated_since cannot query a nonexistent timestamp', async () => {
  const f = fixture();
  const response = await f.invoke('filter.updated_since=2026-10-01T00:00:00Z');
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    success: false, error: 'Validation error',
    message: 'Projects do not have updatedAt; filter.updated_since is not supported',
  });
  assert.deepEqual(f.calls, []);
});

for (const [query, orderBy, paging] of [
  ['', { title: 'asc' }, { skip: 0 }],
  ['sort=title:desc&limit=1&offset=2', { title: 'desc' }, { skip: 2 }],
  ['sort=createdAt:desc&limit=1&cursor=7283', { createdAt: 'desc' }, { skip: 1, cursor: { id: 7283 } }],
  ['sort_by=createdAt&sort_order=asc', { createdAt: 'asc' }, { skip: 0 }],
]) {
  test(`supported project listing preserves scope, sorting and paging: ${query}`, async () => {
    const f = fixture();
    const response = await f.invoke(query);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.total, 1);
    assert.equal(body.projects[0].id, 7283);
    assert.equal(body.projects[0].createdAt, '2026-10-01T00:00:00.000Z');
    assert.equal(body.projects[0].taskCount, 2);
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.calls[0], ['count', { where: { status: 'Normal', AND: [f.scope] } }]);
    const args = f.calls[1][1];
    assert.deepEqual(args.where, f.calls[0][1].where);
    assert.deepEqual(args.orderBy, [orderBy, { id: 'asc' }]);
    assert.equal(args.skip, paging.skip);
    assert.deepEqual(args.cursor, paging.cursor);
    assert.equal(body.nextCursor, query.includes('limit=1') ? '7283' : null);
  });
}

for (const [query, message] of [
  ['sort_by=title&sort_order=sideways', 'sort_order must be asc or desc'],
  ['filter.updated_since=not-a-date', 'filter.updated_since must be an ISO datetime'],
]) {
  test(`malformed project query stays a client error: ${query}`, async () => {
    const f = fixture();
    const response = await f.invoke(query);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, message);
    assert.deepEqual(f.calls, []);
  });
}
