const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule: load } = require('./helpers/loadModule.cjs');

const planLimits = { isPlanLimitReachedError: () => false, planLimitResponse: () => ({ status: 402, body: {} }) };
const refusal = load('src/lib/api/refusal.ts', { '@/lib/planLimits': planLimits });
const errorMessage = load('src/lib/api/errorMessage.ts');
const agentDoneLifecycle = load('src/lib/mcp/tasks/agentDoneLifecycle.ts', {
  '@/lib/api/refusal': refusal,
  '@/lib/mcp/boards/columnRole': { columnRoleFor: () => null },
});
const status = load('src/lib/mcp/tasks/fields/status.ts', {
  '@/lib/api/errorMessage': errorMessage,
  '@/lib/api/refusal': refusal,
  '@/lib/mcp/tasks/agentDoneLifecycle': agentDoneLifecycle,
});
const types = load('src/lib/mcp/tasks/fields/types.ts');

const fieldUpdaters = Object.fromEntries(
  ['section', 'text', 'dueDate', 'priority', 'estimate', 'labels', 'contract', 'pullRequest', 'assignees']
    .map((name) => [`./${name}`, { [`updateTask${name[0].toUpperCase()}${name.slice(1)}`]: async () => {} }]),
);

function loadPersist() {
  return load('src/lib/mcp/tasks/fields/persist.ts', {
    '@/lib/planLimits': planLimits,
    '@/lib/api/refusal': refusal,
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({}) },
    '@/lib/mcp/agents': { getMcpSessionAgentSummary: async () => null },
    '@/lib/prisma': { __esModule: true, default: { task: { findMany: async () => [] }, agent: { findUnique: async () => null } } },
    '@/lib/mcp/tasks/mappers': { taskDetailInclude: () => ({}), mapTaskToDetail: (row) => row },
    '@/lib/mcp/tasks/broadcastTaskUpdates': { broadcastTaskUpdates: async () => {} },
    '@/lib/mcp/tasks/agentMutationFence': { assertAgentAssignmentChangeAllowed: async () => {} },
    '@/lib/api/errorMessage': errorMessage,
    '@/lib/agents/activityAttribution': { actingAgentSelect: {} },
    '@/lib/pullRequests/taskPullRequests': { PullRequestLinkError: class extends Error {} },
    './types': types,
    './status': status,
    ...fieldUpdaters,
  });
}

const context = {
  ctx: { user: { id: 985 }, agentId: null, teamScope: null },
  user: { id: 985 },
  requestBody: { status: 'Archive' },
  sectionInfo: undefined,
  baseUrl: 'https://app.hypertask.ai',
  authCookieHeader: 'test-session',
};
const task = { id: 42, projectId: 15, sectionId: 4309, status: 'Normal' };

const archiveRefusals = [
  { status: 409, code: 'FLAG_COLUMN_MISMATCH', message: 'This task has flags. Move them before changing the column.' },
  { status: 409, code: 'OPEN_OBSERVATION_GATE', message: 'Resolve the open observation before archiving.' },
  { status: 409, code: 'TASK_IDENTITY_CONFLICT', message: 'Task identity is already in use' },
  { status: 400, code: 'PLAIN_LANGUAGE_TICKET_REQUIRED', message: 'Rewrite the ticket in plain language before archiving.' },
];

function archiveFetch(status, body) {
  return async () => ({ ok: false, status, json: async () => body });
}

for (const item of archiveRefusals) {
  test(`the archive hop keeps ${item.code} a ${item.status} refusal with a warning, not a 500 (HTPR-9612)`, async (t) => {
    const warnings = [];
    const errors = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args));
    t.mock.method(console, 'error', (...args) => errors.push(args));
    const original = global.fetch;
    global.fetch = archiveFetch(item.status, { message: item.message, code: item.code });
    try {
      const { persistTaskUpdates } = loadPersist();
      await assert.rejects(() => persistTaskUpdates(context, [task]), (error) => {
        assert.equal(error.name, 'UpdateTaskPersistenceError');
        assert.equal(error.status, item.status);
        assert.equal(error.response.code, item.code);
        assert.ok(error.response.error.includes(item.message));
        return true;
      });
    } finally {
      global.fetch = original;
    }
    assert.equal(errors.length, 0);
    const refusals = warnings.filter(([message]) => message.startsWith('[MCP Update Task] Refused update of'));
    assert.equal(refusals.length, 1);
    assert.equal(refusals[0][1].name, 'RefusalError');
  });
}

test('a 500 from the archive hop is still a server fault that logs as an error (HTPR-9612)', async (t) => {
  const warnings = [];
  const errors = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  t.mock.method(console, 'error', (...args) => errors.push(args));
  const original = global.fetch;
  global.fetch = archiveFetch(500, { message: 'Database unavailable' });
  try {
    const { persistTaskUpdates } = loadPersist();
    await assert.rejects(() => persistTaskUpdates(context, [task]), (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.response.code, undefined);
      return true;
    });
  } finally {
    global.fetch = original;
  }
  const logged = errors.filter(([message]) => message.startsWith('[MCP Update Task] Error updating'));
  assert.equal(logged.length, 1);
  assert.equal(warnings.filter(([message]) => message.includes('Refused update of')).length, 0);
});

test('every Refusal reason is caller-fixable so it never files a feedback ticket (HTPR-9612)', () => {
  const { NAMED_REFUSAL_REASONS } = load('src/lib/api/refusalReason.ts');
  const fixable = load('src/lib/aiFeedback/callerFixable.ts');
  assert.ok(NAMED_REFUSAL_REASONS.length > 0);
  for (const reason of NAMED_REFUSAL_REASONS) {
    assert.equal(fixable.callerCanFixRefusal({ code: reason }, 400), true, reason);
    assert.equal(fixable.callerCanFixRefusal({ code: reason, field: 'target' }, 400), true, reason);
    assert.equal(fixable.callerCanFixRefusal({ code: reason }, 500), false, reason);
  }
  assert.equal(fixable.callerCanFixRefusal({ code: 'tool-exception' }, 400), false);
});
