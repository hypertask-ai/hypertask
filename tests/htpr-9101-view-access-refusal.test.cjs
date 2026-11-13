const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { loadModule: load } = require('./helpers/loadModule.cjs');

const viewId = 'd706b192-9425-4ca0-99c9-3ebd88ddd16b';
const deniedMessage = 'User does not have permission to create tasks in this project';

function fixture({ denied = false, failure } = {}) {
  const writes = [];
  const accessCalls = [];
  const view = {
    id: viewId, userId: 985, title: 'Existing view', visibility: 'Public',
    project_view: { id: 'project-view', projectId: 15, default_view_id: viewId },
  };
  const prisma = {
    view: {
      findUnique: async () => {
        if (failure) throw failure;
        return view;
      },
      update: async args => {
        writes.push(args);
        return { ...view, ...args.data };
      },
    },
    $transaction: async operation => operation(prisma),
  };
  const errors = load('src/lib/mcp-server/utils/errors.ts');
  const stubs = {
    '@/lib/prisma': { default: prisma },
    '@/lib/mcp/agents/readRoleGuard': { requireAgentWriteRole: async () => null },
    '@/lib/mcp/operationCrashReport': {},
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: handler => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 985 }, agentId: 'runner-6' }),
    },
    '@/lib/mcp/tasks/services': {
      validateProjectAccess: async (...args) => {
        accessCalls.push(args);
        return denied
          ? { project: null, error: { status: 403, message: deniedMessage } }
          : { project: { id: 15 }, error: null };
      },
    },
    '@/lib/mcp-server/utils/errors': errors,
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/lib/realtime/server': { broadcastBoardChange: () => {} },
    '@/utils/controllers/projects/getAllIncludes': {},
    '@/utils/controllers/projects/views/viewsHelperAPIfunctions': {},
    '@/utils/controllers/projects/views/boardFilterWriteLock': {
      acquireBoardFilterWriteLock: async () => {},
      assertViewIsNotManagedSmartSplit: async () => {},
    },
    '@/utils/helperFunctions/Views/BoardFilterSanitizer': { sanitizeBoardFilters: value => value },
    '@/utils/helperFunctions/Views/ViewsHelperFunctions': {},
    '@/models/Views/model': { isSubtaskSetting: () => true },
  };
  stubs['@/lib/mcp/views/viewRefusal'] = load('src/lib/mcp/views/viewRefusal.ts', stubs);
  stubs['@/lib/mcp/views/services'] = load('src/lib/mcp/views/services.ts', stubs);
  const { PATCH } = load('src/lib/mcp/operations/view/[viewId]/operation.ts', stubs);
  return {
    writes,
    accessCalls,
    patch: () => PATCH(
      new NextRequest(`https://app.hypertask.ai/api/mcp/view/${viewId}`, {
        method: 'PATCH', body: JSON.stringify({ sorting_order: 'Descending' }),
      }),
      { params: Promise.resolve({ viewId }) },
    ),
  };
}

test('out-of-scope view update returns forbidden without writes or a crash log', async t => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args));
  const f = fixture({ denied: true });
  const response = await f.patch();
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { success: false, error: deniedMessage });
  assert.deepEqual(f.accessCalls, [[15, 985, 'runner-6', undefined]]);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(logged, []);
});

test('authorized view update still persists the requested setting', async t => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args));
  const f = fixture();
  const response = await f.patch();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.view.id, viewId);
  assert.equal(body.view.sorting_order, 'Descending');
  assert.deepEqual(f.accessCalls, [[15, 985, 'runner-6', undefined]]);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].where, { id: viewId });
  assert.deepEqual(f.writes[0].data, { board_sorting_order: 'Descending' });
  assert.deepEqual(logged, []);
});

test('unexpected database errors still reach the crash log', async t => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args));
  const failure = new Error('Database unavailable');
  const f = fixture({ failure });
  const response = await f.patch();
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: 'Database unavailable' });
  assert.deepEqual(logged, [['Error updating view:', failure]]);
  assert.deepEqual(f.writes, []);
});
