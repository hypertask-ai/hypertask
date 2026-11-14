const test = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { loadModule: load } = require('./helpers/loadModule.cjs');

const errors = load('src/lib/mcp-server/utils/errors.ts');
const { actionableToolError } = load('src/lib/mcp-server/tool-response.ts');
const { callerCanFixRefusal } = load('src/lib/aiFeedback/callerFixable.ts');
const viewId = 'd706b192-9425-4ca0-99c9-3ebd88ddd16b';

function fixture(body) {
  const writes = [];
  const save = async input => {
    writes.push(input);
    return { id: viewId };
  };
  const stubs = {
    '@/lib/mcp/agents/readRoleGuard': { requireAgentWriteRole: async () => null },
    '@/lib/mcp/operationCrashReport': {},
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: handler => handler,
      checkMcpRouteRateLimit: async () => null,
      validateMcpRouteAuth: async () => ({ user: { id: 985 } }),
      readMcpRouteJsonBody: async () => ({ ok: true, body }),
    },
    '@/lib/prisma': {},
    '@/utils/controllers/projects/getAllIncludes': {},
    '@/lib/mcp/views/services': { createView: save, updateView: save },
    '@/lib/mcp/tasks/services': { validateProjectAccess: async () => ({}) },
    '@/utils/controllers/projects/views/viewsHelperAPIfunctions': {},
    '@/models/Views/model': { isSubtaskSetting: () => true },
    '@/utils/helperFunctions/Views/BoardFilterSanitizer': {},
    '@/lib/mcp/views/viewRefusal': load('src/lib/mcp/views/viewRefusal.ts', {
      '@/lib/mcp-server/utils/errors': errors,
    }),
    '@/lib/mcp-server/utils/errors': errors,
  };
  return {
    writes,
    create: () => load('src/lib/mcp/operations/view/operation.ts', stubs).POST(
      new NextRequest('https://app.hypertask.ai/api/mcp/view', { method: 'POST' }),
    ),
    update: () => load('src/lib/mcp/operations/view/[viewId]/operation.ts', stubs).PATCH(
      new NextRequest(`https://app.hypertask.ai/api/mcp/view/${viewId}`, {
        method: 'PATCH', body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ viewId }) },
    ),
  };
}

async function assertFixable(response, field, message) {
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.message, message);
  assert.deepEqual(body.details, { field, code: 'invalid_value' });
  assert.equal(callerCanFixRefusal(body.details, 400), true);
  const mapped = errors.mapHttpErrorToMcpError(400, body.message, 'corr', body);
  assert.ok(actionableToolError(mapped).includes(message));
}

test('create rejects mixed filter formats with caller-fixable details before writing', async () => {
  const f = fixture({ project_id: 15, title: 'Filter refusal', filters: {}, board_filters: {} });
  await assertFixable(await f.create(), 'filters', 'Use either filters or board_filters, not both');
  assert.deepEqual(f.writes, []);
});

for (const filters of [{ label_names: [] }, { assignee_ids: [] }, { match: 'ANY' }, { label_match: 'HIDE' }]) {
  test(`update accepts ${Object.keys(filters)[0]} plus native filters and hands both to the write`, async () => {
    const f = fixture({ ...filters, board_filters: {} });
    const response = await f.update();
    assert.equal(response.status, 200);
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.writes[0].board_filters, {});
    for (const [key, value] of Object.entries(filters)) assert.deepEqual(f.writes[0].filters[key], value);
  });
}

for (const body of [{ filters: { label_names: ['Bug'] } }, { board_filters: {} }]) {
  test(`create still accepts ${Object.keys(body)[0]} alone`, async () => {
    const f = fixture({ project_id: 15, title: 'Single filter format', ...body });
    const response = await f.create();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, view: { id: viewId } });
    assert.equal(f.writes.length, 1);
    for (const [key, value] of Object.entries(body)) assert.deepEqual(f.writes[0][key], value);
  });
}

for (const body of [{ label_names: ['Bug'] }, { assignee_ids: [985] }, { match: 'ANY' }, { label_match: 'HIDE' }, { board_filters: {} }]) {
  test(`update still accepts ${Object.keys(body)[0]} alone`, async () => {
    const f = fixture(body);
    const response = await f.update();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, view: { id: viewId } });
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].viewId, viewId);
    if ('board_filters' in body) assert.deepEqual(f.writes[0].board_filters, body.board_filters);
    else for (const [key, value] of Object.entries(body)) assert.deepEqual(f.writes[0].filters[key], value);
  });
}
