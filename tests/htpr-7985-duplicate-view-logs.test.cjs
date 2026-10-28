const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule: load } = require('./helpers/loadModule.cjs');

const errors = load('src/lib/mcp-server/utils/errors.ts', {});
const { logger } = load('src/lib/mcp-server/utils/logger.ts', {});
const { createView } = load('src/lib/mcp/views/services.ts', {
  '@/lib/prisma': { __esModule: true, default: { view: { findFirst: async () => ({ id: 'existing-view' }) } } },
  '@/utils/controllers/projects/getAllIncludes': {},
  '@/utils/controllers/projects/views/viewsHelperAPIfunctions': {},
  '@/lib/mcp/tasks/services': {},
  '@/lib/realtime/server': {},
  '@/utils/helperFunctions/Views/BoardFilterSanitizer': {},
  '@/models/Views/model': {},
  '@/utils/helperFunctions/Views/ViewsHelperFunctions': {},
  '@/utils/controllers/projects/views/boardFilterWriteLock': {},
  './nativeBoardSettings': {},
  '@/lib/mcp-server/utils/errors': errors,
});

function pipeline(create) {
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
    '@/lib/mcp/views/services': { createView: create },
    '@/lib/mcp/tasks/services': { validateProjectAccess: async () => ({}) },
    '@/utils/controllers/projects/views/viewsHelperAPIfunctions': {},
    '@/models/Views/model': {},
    '@/utils/helperFunctions/Views/BoardFilterSanitizer': {},
    '@/lib/mcp-server/utils/errors': errors,
  });
  const { ViewService } = load('src/lib/mcp-server/lib/services/view.service.ts', {
    '../../utils/logger': { logger },
    '../../utils/correlation': { generateCorrelationId: () => 'correlation-7985' },
    '../../utils/pagination': {},
    '../../validations/view.validation': { CreateViewInputSchema: { parse: value => value } },
  });
  return new ViewService({
    async makeRequest() {
      const response = await POST({});
      const body = await response.json();
      if (!response.ok) throw errors.mapHttpErrorToMcpError(response.status, body.error);
      return body;
    },
  });
}

async function capture(run) {
  const calls = [];
  const original = { error: console.error, warn: console.warn, info: console.info };
  for (const level of Object.keys(original)) console[level] = (...args) => calls.push({ level, args });
  try { await run(); } finally { Object.assign(console, original); }
  return calls;
}

const input = { project_id: 15, title: 'Onboarding' };

test('duplicate title stays a caller refusal, with warnings across both create layers', async () => {
  const calls = await capture(async () => {
    await assert.rejects(pipeline(createView).createView(input), error => {
      assert.equal(error.code, -32602);
      assert.equal(error.message, 'A view titled "Onboarding" already exists on this board');
      return true;
    });
  });
  assert.deepEqual(calls.map(call => call.level), ['warn', 'warn']);
});

test('unexpected create failure still reaches the server-error stream', async () => {
  const failure = new Error('database unavailable');
  const calls = await capture(async () => {
    await assert.rejects(pipeline(async () => { throw failure; }).createView(input),
      { message: 'database unavailable' });
  });
  assert.ok(calls.some(call => call.level === 'error' && call.args.includes(failure))); 
});

test('successful create still returns the saved view', async () => {
  const view = { id: 'new-view', title: 'Onboarding' };
  const calls = await capture(async () => {
    assert.deepEqual(await pipeline(async () => view).createView(input), { success: true, view });
  });
  assert.deepEqual(calls.map(call => call.level), ['info']);
});
