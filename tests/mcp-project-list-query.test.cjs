const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { load } = require('./task-route-loader.cjs');

function fixture() {
  const queries = [];
  const scope = { ownerId: 985 };
  const project = {
    id: 7049,
    title: 'QA board',
    name: 'project-7049',
    ownerId: 985,
    status: 'Normal',
    sections: ['Todo'],
    section: [{ id: 19409, section_title: 'Todo' }],
    labels: [],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    _count: { members: 1, tasks: 2 },
  };
  const { GET } = load('src/lib/mcp/operations/projects/operation.ts', {
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: handler => handler,
      validateMcpRouteAuth: async () => ({ user: { id: 985 }, agentId: null }),
      checkMcpRouteRateLimit: async () => null,
    },
    '@/lib/auth/agentScope': { recordAgentBoardScopeMiss: () => {} },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    '@/utils/controllers/projects/getAllIncludes': { getProjectListingWhere: () => scope },
    '@/lib/prisma': { default: { project: {
      count: async query => { queries.push({ method: 'count', ...query }); return 1; },
      findMany: async query => { queries.push({ method: 'findMany', ...query }); return [project]; },
    } } },
  });
  return {
    queries,
    scope,
    async get(params = {}) {
      const response = await GET(new NextRequest(`https://app.hypertask.ai/api/mcp/projects?${new URLSearchParams(params)}`));
      return { status: response.status, body: await response.json() };
    },
  };
}

for (const params of [
  { sort_by: 'updatedAt', sort_order: 'desc' },
  { sort: 'updatedAt:desc' },
  { sort: '-updatedAt' },
  { sort_by: 'priority' },
  { sort_by: 'createdAt', sort_order: 'invalid' },
  { filter: JSON.stringify({ updated_since: '2026-10-01T00:00:00Z' }) },
]) {
  test(`project query rejects unavailable fields before storage: ${JSON.stringify(params)}`, async () => {
    const f = fixture();
    const result = await f.get(params);
    assert.equal(result.status, 400);
    assert.equal(result.body.success, false);
    assert.equal(result.body.error, 'Validation error');
    assert.match(result.body.message, /title or createdAt|asc or desc|updated_since is not supported/);
    assert.deepEqual(f.queries, []);
  });
}

for (const params of [{}, { sort_by: 'title', sort_order: 'desc' }, { sort: 'createdAt:desc' }]) {
  test(`project query preserves supported sorting and pagination: ${JSON.stringify(params)}`, async () => {
    const f = fixture();
    const result = await f.get({ ...params, limit: '1', cursor: '7000', fields: 'id,title' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.projects, [{ id: 7049, title: 'QA board' }]);
    assert.equal(result.body.total, 1);
    assert.equal(result.body.nextCursor, '7049');
    const query = f.queries.find(query => query.method === 'findMany');
    assert.deepEqual(query.where, { status: 'Normal', AND: [f.scope] });
    assert.deepEqual(query.orderBy, [
      params.sort ? { createdAt: 'desc' } : { title: params.sort_order || 'asc' },
      { id: 'asc' },
    ]);
    assert.deepEqual(query.cursor, { id: 7000 });
    assert.equal(query.skip, 1);
    assert.equal(query.take, 1);
  });
}

test('project MCP schema advertises only supported legacy sort fields', () => {
  const { ListProjectsInputSchema } = load('src/lib/mcp-server/validations/project.validation.ts', {});
  for (const sort_by of ['title', 'createdAt']) {
    assert.equal(ListProjectsInputSchema.safeParse({ sort_by }).success, true);
  }
  for (const sort_by of ['updatedAt', 'priority', 'dueDate', 'lastUsedAt']) {
    assert.equal(ListProjectsInputSchema.safeParse({ sort_by }).success, false);
  }
});
