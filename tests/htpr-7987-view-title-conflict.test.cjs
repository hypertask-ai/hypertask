const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/htpr-7166-fixture.cjs');

function setup({ databaseError } = {}) {
  const h = fixture({ owner: true });
  delete h.mocks['@/lib/mcp/views/services'];
  h.mocks['@/utils/helperFunctions/Views/ViewsHelperFunctions'] = { sanitizeSortingStack: () => [] };
  h.mocks['@/lib/mcp/agents/readRoleGuard'] = { requireAgentWriteRole: async () => null };
  h.mocks['@/lib/mcp/operationCrashReport'] = { reportMcpOperationCrash: () => {} };
  h.mocks['@/lib/mcp/routeWrapper'].readMcpRouteJsonBody = async request => ({ ok: true, body: await request.json() });
  h.mocks['@/utils/controllers/projects/views/viewsHelperAPIfunctions'] = {
    getUniqueSlug: async () => null,
    getViewUrl: () => null,
  };
  h.mocks['@/utils/controllers/projects/views/boardFilterWriteLock'].validateBoardFilterLabelReferences = async () => {};
  h.mocks['@/lib/mcp/tasks/services'].validateProjectMemberIds = async () => ({ invalidIds: [], error: null });
  if (databaseError) h.prisma.view.findFirst = async () => { throw databaseError; };
  return { ...h, post: h.load('src/lib/mcp/operations/view/operation.ts').POST };
}

async function invoke(t, h, title) {
  const errors = t.mock.method(console, 'error', () => {});
  const response = await h.post(h.request({ project_id: 17, title }));
  return { status: response.status, body: await response.json(), errors: errors.mock.calls };
}

for (const title of ['view', 'default']) {
  test(`duplicate ${title} retains its refusal without error logs or writes`, async t => {
    const h = setup();
    const result = await invoke(t, h, title);
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, {
      success: false,
      error: `A view titled "${title}" already exists on this board`,
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.effects, []);
  });
}

test('new titles still persist settings and broadcast once', async t => {
  const h = setup();
  const result = await invoke(t, h, 'New view');
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.view.title, 'New view');
  assert.deepEqual(h.writes.map(([name]) => name), ['container-upsert', 'view-create']);
  assert.equal(h.writes[1][1].data.project_view_id, 'pv');
  assert.equal(h.writes[1][1].data.userId, 42);
  assert.equal(h.writes[1][1].data.visibility, 'Public');
  assert.equal(h.effects.filter(effect => effect === 'broadcast').length, 1);
  assert.deepEqual(result.errors, []);
});

for (const message of ['Database unavailable', 'A view titled "view" already exists on this board']) {
  test(`untyped unexpected failure remains logged: ${message}`, async t => {
    const error = new Error(message);
    const h = setup({ databaseError: error });
    const result = await invoke(t, h, 'New view');
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { success: false, error: message });
    assert.deepEqual(result.errors.map(call => call.arguments), [['Error creating view:', error]]);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.effects, []);
  });
}
