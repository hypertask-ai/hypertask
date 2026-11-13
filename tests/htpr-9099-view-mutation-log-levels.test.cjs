const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { loadModule: load } = require('./helpers/loadModule.cjs');

const errors = load('src/lib/mcp-server/utils/errors.ts');
const { logger } = load('src/lib/mcp-server/utils/logger.ts');
const viewId = 'd706b192-9425-4ca0-99c9-3ebd88ddd16b';
const assigneeRefusal = 'assignee 46 is neither a project member nor an agent on this board';

function refusal() {
  return new Error(assigneeRefusal);
}

function fixture({ update, remove, create } = {}) {
  const stubs = {
    '@/lib/mcp/agents/readRoleGuard': { requireAgentWriteRole: async () => null },
    '@/lib/mcp/operationCrashReport': {},
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: handler => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 985 } }),
      readMcpRouteJsonBody: async () => ({ ok: true, body: { project_id: 15, title: 'Renamed' } }),
    },
    '@/lib/prisma': {},
    '@/utils/controllers/projects/getAllIncludes': {},
    '@/lib/mcp/views/services': {
      createView: create ?? (async () => ({ id: viewId })),
      updateView: update ?? (async () => ({ id: viewId })),
      deleteView: remove ?? (async () => ({ id: viewId })),
    },
    '@/lib/mcp/tasks/services': { validateProjectAccess: async () => ({}) },
    '@/utils/controllers/projects/views/viewsHelperAPIfunctions': {},
    '@/models/Views/model': { isSubtaskSetting: () => true },
    '@/utils/helperFunctions/Views/BoardFilterSanitizer': {},
    '@/lib/mcp/views/viewRefusal': load('src/lib/mcp/views/viewRefusal.ts', {
      '@/lib/mcp-server/utils/errors': errors,
    }),
    '@/lib/mcp-server/utils/errors': errors,
  };
  const route = load('src/lib/mcp/operations/view/[viewId]/operation.ts', stubs);
  return {
    create: () => load('src/lib/mcp/operations/view/operation.ts', stubs).POST(
      new NextRequest('https://app.hypertask.ai/api/mcp/view', { method: 'POST' }),
    ),
    update: () => route.PATCH(
      new NextRequest(`https://app.hypertask.ai/api/mcp/view/${viewId}`, {
        method: 'PATCH', body: JSON.stringify({ title: 'Renamed' }),
      }),
      { params: Promise.resolve({ viewId }) },
    ),
    delete: () => route.DELETE(
      new NextRequest(`https://app.hypertask.ai/api/mcp/view/${viewId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ viewId }) },
    ),
  };
}

async function capture(run) {
  const calls = [];
  const original = { error: console.error, warn: console.warn, info: console.info };
  for (const level of Object.keys(original)) console[level] = (...args) => calls.push({ level, args });
  try { return { calls, result: await run() }; } finally { Object.assign(console, original); }
}

for (const [method, label] of [['update', 'Error updating view'], ['delete', 'Error deleting view']]) {
  test(`${method} logs a caller refusal as a warning and still answers 400`, async () => {
    const route = fixture({ [method === 'update' ? 'update' : 'remove']: async () => { throw refusal(); } });
    const { calls, result } = await capture(() => route[method]());
    assert.equal(result.status, 400);
    const body = await result.json();
    assert.equal(body.message, assigneeRefusal);
    assert.deepEqual(body.details, { field: 'assignee_ids', code: 'invalid_value' });
    assert.deepEqual(calls.map(call => call.level), ['warn']);
    assert.equal(calls[0].args[0], `${label}:`);
  });

  test(`${method} keeps an unexpected failure on the error stream`, async () => {
    const failure = new Error('database unavailable');
    const route = fixture({ [method === 'update' ? 'update' : 'remove']: async () => { throw failure; } });
    const { calls, result } = await capture(() => route[method]());
    assert.equal(result.status, 400);
    assert.deepEqual(calls.map(call => call.level), ['error']);
    assert.equal(calls[0].args[1], failure);
  });
}

test('create logs an assignee refusal as a warning, not an error', async () => {
  const route = fixture({ create: async () => { throw refusal(); } });
  const { calls, result } = await capture(() => route.create());
  assert.equal(result.status, 400);
  const body = await result.json();
  assert.equal(body.message, assigneeRefusal);
  assert.deepEqual(body.details, { field: 'assignee_ids', code: 'invalid_value' });
  assert.deepEqual(calls.map(call => call.level), ['warn']);
  assert.equal(calls[0].args[0], 'Error creating view:');
});

test('create keeps an unexpected failure on the error stream', async () => {
  const failure = new Error('database unavailable');
  const route = fixture({ create: async () => { throw failure; } });
  const { calls, result } = await capture(() => route.create());
  assert.equal(result.status, 400);
  assert.deepEqual(calls.map(call => call.level), ['error']);
  assert.equal(calls[0].args[0], 'Error creating view:');
  assert.equal(calls[0].args[1], failure);
});

function service(method, failure) {
  const ViewService = load('src/lib/mcp-server/lib/services/view.service.ts', {
    '../../utils/logger': { logger },
    '../../utils/correlation': { generateCorrelationId: () => 'correlation-9099' },
    '../../utils/pagination': {},
    '../../validations/view.validation': {
      CreateViewInputSchema: { parse: value => value },
      UpdateViewInputSchema: { parse: value => value },
      DeleteViewInputSchema: { parse: value => value },
      ApplyViewInputSchema: { parse: value => value },
      ListViewsInputSchema: { parse: value => value },
      GetViewInputSchema: { parse: value => value },
    },
  }).ViewService;
  return new ViewService({ makeRequest: async () => { throw failure; } });
}

for (const method of ['updateView', 'deleteView']) {
  test(`${method} logs a caller refusal at warning level in the MCP server layer`, async () => {
    const callerRefusal = errors.mapHttpErrorToMcpError(400, assigneeRefusal, 'correlation-9099');
    const { calls } = await capture(async () => {
      await assert.rejects(service(method, callerRefusal)[method]({ viewId, title: 'Renamed' }));
    });
    assert.deepEqual(calls.map(call => call.level), ['warn']);
    assert.equal(JSON.parse(calls[0].args[0]).level, 'warn');
  });

  test(`${method} keeps a server failure at error level in the MCP server layer`, async () => {
    const { calls } = await capture(async () => {
      await assert.rejects(service(method, new Error('database unavailable'))[method]({ viewId, title: 'Renamed' }));
    });
    assert.deepEqual(calls.map(call => call.level), ['error']);
  });
}
