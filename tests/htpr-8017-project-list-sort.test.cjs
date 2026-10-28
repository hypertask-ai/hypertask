const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { load } = require('./helpers/agent-connection.cjs');

const listQuery = load('src/lib/mcp/listQuery.ts');
const { withListQueryDescription } = load('src/lib/mcp-server/listQueryDescriptions.ts', {
  './config/mcp-standards': load('src/lib/mcp-server/config/mcp-standards.ts'),
});
const querySchema = load('src/lib/mcp-server/validations/common/listQuery.ts', { '@/lib/mcp/listQuery': listQuery });
const { ListProjectsInputSchema } = load('src/lib/mcp-server/validations/project.validation.ts', {
  './common/pagination': load('src/lib/mcp-server/validations/common/pagination.ts'),
  './common/listQuery': querySchema,
  './common/filters': load('src/lib/mcp-server/validations/common/filters.ts', {
    '../../utils/constants': load('src/lib/mcp-server/utils/constants.ts'),
  }),
  '@/lib/mcp/listQuery': listQuery,
});

function fixture() {
  const queries = [];
  const scope = { teamId: 'allowed-team' };
  const { GET } = load('src/lib/mcp/operations/projects/operation.ts', {
    '@/lib/auth/agentScope': { recordAgentBoardScopeMiss() {} },
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/lib/flags/keys': { HTPR_8018_PROJECT_PAGE_SIZE_FLAG: 'htpr-8018-project-page-size' },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash() {} },
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: handler => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 985 }, agentId: 'agent-8017', teamScope: scope }),
    },
    '@/utils/controllers/projects/getAllIncludes': { getProjectListingWhere: (userId, agentId, teamScope) => {
      assert.equal(userId, 985);
      assert.equal(agentId, 'agent-8017');
      assert.equal(teamScope, scope);
      return scope;
    } },
    '@/lib/prisma': { __esModule: true, default: { project: {
      count: async args => { queries.push({ method: 'count', ...args }); return 2; },
      findMany: async args => { queries.push({ method: 'findMany', ...args }); return [{
        id: 8017, title: 'Board', name: 'board-8017', ownerId: 985, owner: null,
        status: 'Normal', sections: ['Todo'], section: [], labels: [],
        createdAt: new Date('2026-10-01T00:00:00Z'), _count: { members: 1, tasks: 2 },
      }]; },
    } } },
    '@/lib/mcp/listQuery': listQuery,
    '@/lib/mcp/listParams': load('src/lib/mcp/listParams.ts'),
    '@/lib/mcp/readListQuery': load('src/lib/mcp/readListQuery.ts', { './listQuery': listQuery }),
  });
  return { queries, get: query => GET(new NextRequest(`https://app.hypertask.ai/api/mcp/projects?${query}`)) };
}

for (const query of [
  'sort_by=updatedAt', 'sort=updatedAt:desc', 'sort=-updatedAt',
  'sort_by=priority', 'sort=lastUsedAt', 'sort_by=title&sort_order=sideways',
  'filter.updated_since=2026-10-01T00:00:00Z',
  'filter=' + encodeURIComponent(JSON.stringify({ updated_since: '2026-10-01T00:00:00Z' })),
]) {
  test(`unsupported board query is a readable 400 before any database call: ${query}`, async () => {
    const f = fixture();
    const response = await f.get(query);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Validation error');
    assert.match(body.message, /title|createdAt|updated_since|asc.*desc/);
    assert.deepEqual(f.queries, []);
  });
}

for (const [query, orderBy] of [
  ['', { title: 'asc' }],
  ['sort_by=title&sort_order=desc', { title: 'desc' }],
  ['sort_by=createdAt&sort_order=desc', { createdAt: 'desc' }],
  ['sort=createdAt:asc', { createdAt: 'asc' }],
  ['sort=-title', { title: 'desc' }],
]) {
  test(`supported board sort preserves scope and cursor pagination: ${query}`, async () => {
    const f = fixture();
    const response = await f.get(`${query}&limit=1&cursor=8016&filter=${encodeURIComponent(JSON.stringify({ status: 'Archive' }))}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.projects[0].id, 8017);
    assert.equal(body.nextCursor, '8017');
    assert.equal(body.projects[0].taskCount, 2);
    assert.equal(f.queries.length, 2);
    const find = f.queries[1];
    assert.deepEqual(find.orderBy, [orderBy, { id: 'asc' }]);
    assert.deepEqual(find.where, { status: 'Archive', AND: [{ teamId: 'allowed-team' }] });
    assert.deepEqual(find.cursor, { id: 8016 });
    assert.equal(find.skip, 1);
    assert.equal(find.take, 1);
  });
}

test('project tool schema advertises only supported sort fields and filters', () => {
  for (const sort_by of ['updatedAt', 'priority', 'dueDate', 'lastUsedAt']) {
    assert.equal(ListProjectsInputSchema.safeParse({ sort_by }).success, false);
  }
  for (const sort_by of ['createdAt', 'title']) {
    assert.equal(ListProjectsInputSchema.safeParse({ sort_by }).success, true);
  }
  assert.equal(ListProjectsInputSchema.safeParse({ filter: { updated_since: '2026-10-01T00:00:00Z' } }).success, false);
  assert.equal(ListProjectsInputSchema.safeParse({ sort: 'updatedAt:desc' }).success, false);
  assert.equal(ListProjectsInputSchema.safeParse({ sort: 'createdAt:desc', filter: { status: 'Normal' } }).success, true);
});

test('board discovery explains supported sorts without changing other list help', () => {
  const boards = withListQueryDescription('hypertask_list_projects', 'List boards.');
  assert.match(boards, /sort \(title or createdAt/);
  assert.match(boards, /updatedAt sorting and filter.updated_since are unsupported/);
  assert.equal(withListQueryDescription('hypertask_list_projects', boards), boards);
  assert.match(withListQueryDescription('hypertask_search_tasks', 'Search tickets.'), /filter \(section, label, assignee, status, updated_since, has_pr\)/);
});
