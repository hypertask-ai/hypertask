const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { loadModule: load } = require('./helpers/loadModule.cjs');

const errors = load('src/lib/mcp-server/utils/errors.ts');
const { actionableToolError } = load('src/lib/mcp-server/tool-response.ts');
const { callerCanFixRefusal } = load('src/lib/aiFeedback/callerFixable.ts');
const { feedbackFingerprint } = load('src/lib/aiFeedback/input.ts');

function listFixture() {
  const queries = [];
  const { GET } = load('src/lib/mcp/operations/view/operation.ts', {
    '@/lib/mcp/agents/readRoleGuard': { requireAgentWriteRole: async () => null },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash() {} },
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: handler => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 985 } }),
      readMcpRouteJsonBody: async () => ({ ok: true, body: {} }),
    },
    '@/lib/prisma': { __esModule: true, default: { project: { findFirst: async () => ({ id: 15 }) }, view: {
      count: async args => { queries.push({ method: 'count', ...args }); return 0; },
      findMany: async args => { queries.push({ method: 'findMany', ...args }); return []; },
    } } },
    '@/utils/controllers/projects/getAllIncludes': { savedViewBoardAccessWhere: () => ({}) },
    '@/lib/mcp/views/services': { createView: async () => ({}) },
    '@/lib/mcp/tasks/services': { validateProjectAccess: async () => ({}) },
    '@/utils/controllers/projects/views/viewsHelperAPIfunctions': {},
    '@/models/Views/model': { isSubtaskSetting: () => true, SORTING_MODES: ['Manual'], SUBTASK_SETTINGS: ['None'] },
    '@/utils/helperFunctions/Views/BoardFilterSanitizer': { sanitizeBoardFilters: v => v, projectVisibleViewRelations: v => v },
    '@/lib/mcp/views/viewRefusal': load('src/lib/mcp/views/viewRefusal.ts', { '@/lib/mcp-server/utils/errors': errors }),
    '@/lib/mcp-server/utils/errors': errors,
  });
  return {
    queries,
    get: query => GET(new NextRequest(`https://app.hypertask.ai/api/mcp/view?${query}`)),
  };
}

for (const query of [
  'projectId=abc',
  'sort_by=updatedAt',
  'sort_by=priority',
  'sort_order=sideways',
  'visibility=Hidden',
]) {
  test(`unsupported view list query is a readable 400 before any database call: ${query}`, async () => {
    const f = listFixture();
    const response = await f.get(query);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Validation error');
    assert.ok(body.details?.field);
    assert.equal(body.details.code, query.startsWith('projectId') ? 'invalid_type' : 'invalid_value');
    assert.deepEqual(f.queries, []);
  });
}

test('supported view list sort still queries the database', async () => {
  const f = listFixture();
  const response = await f.get('projectId=15&sort_by=title&sort_order=asc');
  assert.equal(response.status, 200);
  assert.equal(f.queries.length, 2);
  assert.deepEqual(f.queries[1].orderBy, { title: 'asc' });
});

test('HTPR-8825: unsupported sort_by refusal is caller-fixable and not a generic tool-exception fingerprint', async () => {
  const response = await listFixture().get('sort_by=updatedAt');
  const body = await response.json();
  const error = errors.mapHttpErrorToMcpError(400, body.message, 'corr', body);
  assert.match(actionableToolError(error), /sort_by must be one of title, createdAt, lastUsedAt/);
  assert.equal(callerCanFixRefusal({ code: body.details.code, field: body.details.field }, 400), true);
  assert.notEqual(
    feedbackFingerprint({ surface: 'mcp', tool: 'hypertask_views', status: 400, errorCode: body.details.code, field: body.details.field, category: 'call_failed' }).slice(0, 12),
    '963ae80fe8bc',
  );
});

test('duplicate view title maps to a field-specific refusal', async () => {
  const { POST } = load('src/lib/mcp/operations/view/operation.ts', {
    '@/lib/mcp/agents/readRoleGuard': { requireAgentWriteRole: async () => null },
    '@/lib/mcp/operationCrashReport': {},
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: handler => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 985 } }),
      readMcpRouteJsonBody: async () => ({ ok: true, body: { project_id: 15, title: 'Onboarding' } }),
    },
    '@/lib/prisma': {},
    '@/utils/controllers/projects/getAllIncludes': {},
    '@/lib/mcp/views/services': {
      createView: async () => {
        throw new errors.ValidationError('A view titled "Onboarding" already exists on this board');
      },
    },
    '@/lib/mcp/tasks/services': { validateProjectAccess: async () => ({}) },
    '@/utils/controllers/projects/views/viewsHelperAPIfunctions': {},
    '@/models/Views/model': { isSubtaskSetting: () => true, SORTING_MODES: ['Manual'], SUBTASK_SETTINGS: ['None'] },
    '@/utils/helperFunctions/Views/BoardFilterSanitizer': {},
    '@/lib/mcp/views/viewRefusal': load('src/lib/mcp/views/viewRefusal.ts', { '@/lib/mcp-server/utils/errors': errors }),
    '@/lib/mcp-server/utils/errors': errors,
  });
  const response = await POST({});
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.deepEqual(body.details, { field: 'title', code: 'invalid_value' });
});
