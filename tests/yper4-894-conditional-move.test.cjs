const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./helpers/agent-connection.cjs');
const { NextResponse } = require('next/server');
const { validateTaskUpdateFields } = load('src/lib/mcp/tasks/fields/validateFields.ts', {
  'next/server': { NextResponse },
  '@/lib/mcp/tasks/validators': {},
  '@/lib/mcp/normalizeBlockHtml': {},
  '@/utils/helperFunctions/markdownToHtml': {},
  '@/lib/mcp/fieldError': { buildFieldError: (code, field, error) => ({ code, field, error }) },
  '@/lib/mcp/tasks/contractFields': {},
  '@/lib/mcp/tasks/updateFields': { hasSingleTaskUpdate: () => false },
  '@/lib/pullRequests/githubPullRequests': {},
});
const body = { ticket_number: 'YPER4-894', sectionId: 30,
  expected_section_id: 20, expected_updated_at: '2026-10-28T10:00:00.000Z' };

test('conditional moves reject incomplete, invalid or mixed mutation preconditions', async () => {
  for (const changes of [
    { expected_section_id: undefined }, { expected_section_id: 0 },
    { expected_section_id: '20' }, { expected_section_id: 2147483648 },
    { ticket_number: ['YPER4-894', 'YPER4-895'] }, { expected_updated_at: undefined },
    { expected_updated_at: 'yesterday' }, { sectionId: undefined },
    { title: 'unrelated edit' }, { assignee: [6] }, { status: 'Archive' },
  ]) {
    const response = await validateTaskUpdateFields({ ...body, ...changes }, false);
    assert.equal(response.status, 400, JSON.stringify(changes));
  }
});

test('valid conditional section move remains available', async () => {
  const result = await validateTaskUpdateFields(body, false);
  assert.equal(result instanceof NextResponse, false);
  assert.equal(result.hasTextOrParentUpdate, false);
});

test('MCP section dispatcher carries both conditions to the actual move route', async () => {
  const { updateTaskSection } = load('src/lib/mcp/tasks/fields/section.ts', {
    '@/lib/api/errorMessage': { toErrorMessage: (_data, fallback) => fallback },
    '@/lib/flags': { isFeatureEnabled: async () => false },
    '@/lib/flags/definitions/htpr-7990-task-move-refusal': {},
  });
  const originalFetch = global.fetch;
  let observed;
  global.fetch = async (url, options) => {
    observed = { url, body: JSON.parse(options.body) };
    return Response.json({ message: 'state changed' }, { status: 409 });
  };
  try {
    await assert.rejects(updateTaskSection({
      requestBody: body, sectionInfo: { projectId: 4060, section_title: 'In Progress' },
      baseUrl: 'https://app.hypertask.ai', ctx: { user: { id: 985 }, agentId: 'runner-6' },
      authCookieHeader: 'test-only',
    }, { id: 894, projectId: 4060 }), error => error.status === 409 && error.code === 'task_move_refused');
    assert.equal(observed.url, 'https://app.hypertask.ai/api/tasks/moveTask');
    assert.equal(observed.body.expectedSectionId, 20);
    assert.equal(observed.body.expectedUpdatedAt, body.expected_updated_at);
    assert.equal(observed.body.agentId, 'runner-6');
  } finally { global.fetch = originalFetch; }
});

test('move route validates conditions and forwards them into the shared atomic controller', async () => {
  let received;
  const { PUT } = load('src/lib/api/task-writes/move.ts', {
    'next/server': { NextResponse },
    '@/lib/prisma': { __esModule: true, default: {
      task: { findUnique: async () => ({ projectId: 4060 }) },
      section: { findFirst: async () => ({ id: 30 }) },
      agent: { findUnique: async () => ({ id: 'runner-6', userId: 985, displayName: 'Runner 6' }) },
    } },
    '@/utils/generateRank': {},
    '@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove': {},
    '@/utils/controllers/tasks/single': { updateTaskSingle: async (...args) => {
      received = args;
      return { status: 409, json: { message: 'Task changed' } };
    } },
    '@/lib/realtime/server': {},
    '@/lib/api/errorMessage': { toErrorMessage: data => data.message },
    '@/lib/auth/sessionUserRecord': {},
    '@/lib/auth/resolveActingAgent': { resolveActingAgent: () => ({ ok: true, agentId: 'runner-6' }) },
    './route': { taskWriteRoute: definition => definition },
  });
  const input = { taskId: 894, section_title: 'In Progress', sectionId: 30,
    projectId: 4060, ranking: 'rank', expectedSectionId: 20, expectedUpdatedAt: body.expected_updated_at };
  assert.equal(PUT.schema.safeParse(input).success, true);
  assert.equal(PUT.schema.safeParse({ ...input, expectedUpdatedAt: 'invalid' }).success, false);
  const response = await PUT.operation(input, { user: { id: 985 }, session: { agentId: 'runner-6' } });
  assert.equal(response.status, 409);
  assert.equal(received[2], 'runner-6');
  assert.equal(received[3].expectedProjectId, 4060);
  assert.equal(received[3].expectedSectionId, 20);
  assert.equal(received[3].expectedStatus, 'Normal');
  assert.equal(received[3].expectedUpdatedAt.toISOString(), body.expected_updated_at);
});
