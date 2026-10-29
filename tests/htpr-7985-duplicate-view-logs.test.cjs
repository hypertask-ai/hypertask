const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule: load } = require('./helpers/loadModule.cjs');

const errors = load('src/lib/mcp-server/utils/errors.ts', {});
const { logger } = load('src/lib/mcp-server/utils/logger.ts', {});
function service({ duplicate = true, labels = [], viewLabelError = true } = {}) {
  const saved = [];
  const prisma = {
    label: { findMany: async () => labels },
    project_View: { upsert: async () => ({ id: 'project-view' }) },
    view: {
      findFirst: async () => duplicate ? { id: 'existing-view' } : null,
      create: async ({ data }) => {
        const view = { id: 'new-view', ...data };
        saved.push(view);
        return view;
      },
    },
    $transaction: async run => run(prisma),
  };
  const { createView } = load('src/lib/mcp/views/services.ts', {
    '@/lib/prisma': { __esModule: true, default: prisma },
    '@/utils/controllers/projects/getAllIncludes': {},
    '@/utils/controllers/projects/views/viewsHelperAPIfunctions': { getUniqueSlug: async () => null },
    '@/lib/mcp/tasks/services': {
      matchLabelIds: (available, names) => ({
        ids: available.filter(label => names.includes(label.value)).map(label => label.id),
        unresolved: names.filter(name => !available.some(label => label.value === name)),
      }),
    },
    '@/lib/realtime/server': { broadcastBoardChange: () => undefined },
    '@/utils/helperFunctions/Views/BoardFilterSanitizer': { sanitizeBoardFilters: value => value },
    '@/models/Views/model': {},
    '@/utils/helperFunctions/Views/ViewsHelperFunctions': { sanitizeSortingStack: () => [] },
    '@/utils/controllers/projects/views/boardFilterWriteLock': {
      acquireBoardFilterWriteLock: async () => undefined,
      validateBoardFilterLabelReferences: async () => undefined,
    },
    './nativeBoardSettings': {},
    '@/lib/mcp-server/utils/errors': errors,
    '@/lib/flags': { isFeatureEnabled: async () => viewLabelError },
    '@/lib/flags/definitions/htpr-8135-view-label-error': {},
  });
  return { createView, saved };
}

function pipeline(create, filters) {
  const { POST } = load('src/lib/mcp/operations/view/operation.ts', {
    '@/lib/mcp/agents/readRoleGuard': { requireAgentWriteRole: async () => null },
    '@/lib/mcp/operationCrashReport': {},
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: handler => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 985 } }),
      readMcpRouteJsonBody: async () => ({ ok: true, body: { project_id: 15, title: 'Onboarding', filters } }),
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
    await assert.rejects(pipeline(service().createView).createView(input), error => {
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

test('missing view label is a readable refusal, with warnings across both create layers', async () => {
  const { createView, saved } = service({ duplicate: false, labels: [{ id: 'label-ai', value: 'AI' }] });
  const calls = await capture(async () => {
    await assert.rejects(pipeline(createView, { label_names: ['Management'] }).createView(input), error => {
      assert.equal(error.code, -32602);
      assert.equal(error.message, 'Label(s) not found in project: Management. Available labels: AI');
      return true;
    });
  });
  assert.deepEqual(calls.map(call => call.level), ['warn', 'warn']);
  assert.deepEqual(saved, []);
});

test('with the flag off the view refusal keeps its old wording', async () => {
  const { createView, saved } = service({ duplicate: false, labels: [{ id: 'label-ai', value: 'AI' }], viewLabelError: false });
  await assert.rejects(pipeline(createView, { label_names: ['Management'] }).createView(input), error => {
    assert.equal(error.code, -32602);
    assert.equal(error.message, 'Label(s) not found in project: Management');
    return true;
  });
  assert.deepEqual(saved, []);
});

test('valid label still saves its filter through both create layers', async () => {
  const { createView, saved } = service({ duplicate: false, labels: [{ id: 'label-management', value: 'Management' }] });
  const calls = await capture(async () => {
    const response = await pipeline(createView, { label_names: ['Management'] }).createView(input);
    assert.equal(response.success, true);
    assert.equal(response.view.id, 'new-view');
    assert.deepEqual(response.view.filters, {
      matchFilters: 'ANY', addedFilters: [{ type: 'Labels', searchPayload: [{ id: 'label-management' }] }],
    });
  });
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].board_filters, {
    matchFilters: 'ANY', addedFilters: [{ type: 'Labels', searchPayload: [{ id: 'label-management' }] }],
  });
  assert.deepEqual(calls.map(call => call.level), ['info']);
});
