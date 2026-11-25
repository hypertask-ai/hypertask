const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { loadModule: load } = require('./helpers/loadModule.cjs');

const planLimits = { isPlanLimitReachedError: error => error?.code === 'PLAN_LIMIT_REACHED', isPlanLimitsEnabled: async () => false };
const refusal = load('src/lib/api/refusal.ts', { '@/lib/planLimits': planLimits });
const errors = load('src/lib/mcp-server/utils/errors.ts');

function harness(t, fault) {
  const warnings = [], logs = [], reports = [], feedback = [], pending = [];
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const auth = { user: { id: 985, email: 'qa@example.com', displayName: 'QA', photoURL: null }, agentId: null };
  const operationContext = load('src/lib/mcp/operationContext.ts');
  const crashReport = load('src/lib/mcp/operationCrashReport.ts', {
    '@vercel/functions': { waitUntil: promise => pending.push(promise) },
    '@/lib/errors/reportError': { reportError: async report => reports.push(report) },
  });
  const authMethods = { checkMcpRateLimit: async () => null, validateMcpAuth: async () => auth };
  const wrapper = load('src/lib/mcp/routeWrapper.ts', {
    '@/lib/api/refusal': refusal,
    '@/lib/auth/agentScope': { withAgentScopeRequest: (_request, run) => run(), prepareAgentScope: async () => {} },
    '@/lib/aiFeedback/automatic': { queueRestFailure: (_request, status) => feedback.push(status) },
    '@/lib/mcp/auth': authMethods,
    './operationContext': operationContext,
    './operationCrashReport': crashReport,
    '@/lib/mcp/tasks/agentMutationLeaseAdoption': {},
  });
  const prisma = {
    user: { findUnique: async () => { if (fault) throw fault; return auth.user; } },
    task: { findMany: async () => [{ id: 1, projectId: 15, sectionId: 4309, status: 'Normal' }] },
    section: {
      findUnique: async () => ({ projectId: 11514, section_title: 'Backlog' }),
      findMany: async () => [{ id: 4309, section_title: 'In Progress' }],
    },
  };
  const { POST } = load('src/app/api/mcp/tasks/update/route.ts', {
    '@/lib/api/refusal': refusal,
    '@/lib/planLimits': planLimits,
    '@/lib/prisma': { default: prisma },
    '@/lib/mcp/routeWrapper': wrapper,
    '@/lib/mcp/auth': authMethods,
    '@/lib/mcp/tasks/agentMutationLeaseAdoption': { withAdoptedAgentMutationLease: (_db, _actor, run) => run() },
    '@/lib/mcp/idempotency/idempotencyStore': {
      IdempotencyAccessError: class extends Error {}, IdempotencyInProgressError: class extends Error {},
      normalizeIdempotencyKey: () => null, withIdempotency: (_op, _user, _key, _body, run) => run(),
    },
    '@/lib/auth/session': { signSession: () => 'test-session', SESSION_COOKIE: 'session' },
    '@/lib/mcp/agents/scopes': { requireRole: async () => null },
    '@/lib/mcp/agents': { getMcpSessionAgentSummary: async () => null },
    '@/lib/mcp/tasks/mappers': { taskDetailInclude: () => ({}), mapTaskToDetail: row => row },
    '@/lib/mcp/tasks/broadcastTaskUpdates': { broadcastTaskUpdates: async () => {} },
    '@/lib/agents/activityAttribution': {},
    '@/lib/pullRequests/taskPullRequests': { PullRequestLinkError: class extends Error {} },
    '@/lib/pullRequests/githubPullRequests': {},
    '@/lib/mcp/tasks/services': {},
    '@/utils/controllers/assignees/assign': {},
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({}) },
    '@/utils/controllers/urls/extractUrlsFromContent': {},
    '@/utils/helperFunctions/sanitizeRichHtml': {},
    '@/utils/helperFunctions/markdownToHtml': {},
    '@/lib/flags': { isFeatureEnabled: async () => true },
  });
  const operations = load('src/lib/mcp/operations/index.ts', {
    '@/lib/mcp-server/utils/errors': errors,
    './tasks/update/operation': { POST },
  });
  const { createDirectOperationClient } = load('src/lib/mcp/directOperationClient.ts', {
    '@/lib/mcp-server/utils/errors': errors,
    './auth': authMethods, './operationContext': operationContext, './operations': operations, './routeWrapper': wrapper,
  });
  const options = { method: 'POST', body: JSON.stringify({ task_id: 1, sectionId: 32923 }) };
  return {
    warnings, logs, reports, feedback,
    http: () => POST(new NextRequest('https://app.hypertask.ai/api/mcp/tasks/update', options)),
    direct: () => createDirectOperationClient('test-token', auth).makeRequest('/mcp/tasks/update', options),
    methodNotAllowed: () => createDirectOperationClient('test-token', auth).makeRequest('/mcp/tasks/update'),
    settle: () => Promise.all(pending),
    wrapper,
  };
}

for (const transport of ['http', 'direct']) {
  test(`${transport}: cross-board sectionId is a 400 refusal, warns, and sends no error log, crash report, or feedback`, async t => {
    const h = harness(t);
    if (transport === 'http') {
      const response = await h.http();
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.code, 'invalid_field');
      assert.equal(body.field, 'sectionId');
    } else {
      await assert.rejects(h.direct, error => {
        assert.equal(error.code, -32602);
        assert.deepEqual(error.details, { code: 'invalid_field', field: 'sectionId' });
        return true;
      });
    }
    await h.settle();
    assert.ok(h.warnings.length > 0);
    assert.deepEqual(h.logs, []);
    assert.deepEqual(h.reports, []);
    assert.deepEqual(h.feedback, []);
  });

  test(`${transport}: unauthorized refusals keep 401 without false crash reports`, async t => {
    const h = harness(t, new refusal.RefusalError({ status: 401, reason: 'unauthorized', message: 'Sign in first' }));
    if (transport === 'http') {
      const response = await h.http();
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { success: false, error: 'Sign in first', code: 'unauthorized' });
    } else {
      await assert.rejects(h.direct, error => error.code === -32001 && error.message === 'Sign in first');
    }
    await h.settle();
    assert.equal(h.warnings.length, 1);
    assert.deepEqual(h.logs, []);
    assert.deepEqual(h.reports, []);
    assert.deepEqual(h.feedback, []);
  });

  test(`${transport}: a plain Error stays a server fault and logs, reports, and queues feedback once`, async t => {
    const fault = new Error('Database unavailable');
    const h = harness(t, fault);
    await assert.rejects(h[transport], error => {
      if (transport === 'http') assert.equal(error, fault);
      else assert.equal(error.httpStatus, 500);
      return true;
    });
    await h.settle();
    assert.equal(h.logs.length, 1);
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0].extra.errorName, 'Error');
    assert.deepEqual(h.feedback, [500]);
  });
}

test('an uncaught typed refusal is handled by the shared boundary', async t => {
  const h = harness(t);
  const response = await h.wrapper.wrapMcpRoute(async () => {
    throw new refusal.RefusalError({ status: 400, reason: 'invalid_field', field: 'title', message: 'Bad title', allowedValues: ['Valid'] });
  })(new NextRequest('https://app.hypertask.ai/api/mcp/tasks/update'));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { success: false, error: 'Bad title', code: 'invalid_field', field: 'title', allowed_values: ['Valid'] });
  assert.equal(h.warnings.length, 1);
  assert.deepEqual(h.logs, []);
  assert.deepEqual(h.feedback, []);
});

test('method not allowed stays a caller error on the direct client', async t => {
  const h = harness(t);
  await assert.rejects(h.methodNotAllowed, error => error.code === -32602 && error.message === 'Method Not Allowed');
  assert.equal(h.warnings.length, 1);
  assert.deepEqual(h.logs, []);
  assert.deepEqual(h.reports, []);
  assert.deepEqual(h.feedback, []);
});
