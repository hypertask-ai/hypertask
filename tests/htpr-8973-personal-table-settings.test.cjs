const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/htpr-7166-fixture.cjs');

const stack = [{ column: 'priority', direction: 'desc' }, { column: 'updated', direction: 'desc' }];
const columns = { keys: ['ticket', 'title', 'updated', 'priority'], widths: { updated: 173, title: 420 } };
const body = (settings, viewId = 'view') => ({ projectId: 17, viewId, updateMode: 'personal-table-settings', view_settings: settings });

function setup(options = {}) {
  const h = fixture({ member: 'Accepted', unsaved: true, ...options });
  h.mocks['@/lib/flags'].isFeatureEnabled = async () => options.enabled !== false;
  const personalRow = (userId, viewId) => {
    const view = [h.view, h.defaultView, h.draft].find((row) => row.id === viewId);
    return view?.ViewLastUsed.find((row) => row.userId === userId) ?? null;
  };
  h.prisma.view_Last_Used.findUnique = async ({ where }) => {
    const { userId, viewId } = where.user_view_last_used;
    return personalRow(userId, viewId);
  };
  h.prisma.view_Last_Used.upsert = async ({ where, create, update }) => {
    const { userId, viewId } = where.user_view_last_used;
    const view = [h.view, h.defaultView, h.draft].find((row) => row.id === viewId);
    assert.ok(view, `unknown view ${viewId}`);
    const existing = view.ViewLastUsed.find((row) => row.userId === userId);
    if (existing) Object.assign(existing, update);
    else view.ViewLastUsed.push(create);
    return existing ?? create;
  };
  h.prisma.user_Project_View.upsert = async ({ update }) => {
    Object.assign(h.uv, update);
    h.uv.appliedView = update.appliedViewId === 'view' ? h.view : update.appliedViewId === 'default' ? h.defaultView : null;
    return h.uv;
  };
  h.prisma.view.delete = async () => {
    h.uv.unsavedViewId = null;
    h.uv.unsavedView = null;
    return h.draft;
  };
  const update = h.load('src/lib/api/project-writes/views/update-view.ts').POST;
  const switchView = h.load('src/lib/api/project-writes/views/switch-view.ts').POST;
  const read = h.load('src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts').default;
  const helpers = h.load('src/utils/helperFunctions/Views/ViewsHelperFunctions.ts');
  const call = (settings, viewId = 'view') => update(h.request(body(settings, viewId)));
  const project = async () => ({ id: 17, project_view: await read(17, 42) });
  const go = (newViewId) => switchView(h.request({ projectId: 17, newViewId }));
  return { ...h, call, project, helpers, go };
}

test('account sort and columns survive leaving the view and coming back', async () => {
  const h = setup();
  assert.equal((await h.call({ table_sort_stack: stack })).status, 200);
  assert.equal((await h.call({ table_columns: columns })).status, 200);
  assert.equal(h.view.table_sort_stack, undefined);
  assert.equal(h.view.table_columns, undefined);
  assert.equal((await h.go('default')).status, 200);
  assert.equal(h.uv.unsavedView, null);
  assert.equal((await h.go('view')).status, 200);
  let fresh = JSON.parse(JSON.stringify(await h.project()));
  assert.deepEqual(h.helpers.getActiveTableSortStackFromProject(fresh), stack);
  assert.deepEqual(h.helpers.getActiveTableColumnsFromProject(fresh), columns);
  fresh = JSON.parse(JSON.stringify(await h.project()));
  assert.deepEqual(h.helpers.getActiveTableColumnsFromProject(fresh).keys.includes('due'), false);
});

test('an explicit cleared sort stays cleared without clearing columns', async () => {
  const h = setup();
  await h.call({ table_columns: columns });
  await h.call({ table_sort_stack: stack });
  await h.call({ table_sort_stack: [] });
  const fresh = await h.project();
  assert.deepEqual(h.helpers.getActiveTableSortStackFromProject(fresh), []);
  assert.deepEqual(h.helpers.getActiveTableColumnsFromProject(fresh), columns);
});

test('a draft still supplies sort and columns before the account has them', () => {
  const h = setup();
  const project = {
    id: 17,
    project_view: {
      default_view: { id: 'default', table_columns: null, table_sort_stack: null },
      user_project_views: [{
        appliedView: { id: 'view', table_columns: null, table_sort_stack: null, ViewLastUsed: [] },
        unsavedView: { id: 'draft', table_columns: columns, table_sort_stack: stack },
      }],
    },
  };
  assert.deepEqual(h.helpers.getActiveTableColumnsFromProject(project), columns);
  assert.deepEqual(h.helpers.getActiveTableSortStackFromProject(project), stack);
});

test('an account sort wins over an older draft and stays after leaving', async () => {
  const older = [{ column: 'title', direction: 'asc' }];
  const olderColumns = { keys: ['ticket', 'title', 'due'], widths: { title: 200 } };
  const h = setup({ draft: { table_sort_stack: older, table_columns: olderColumns } });
  assert.equal((await h.call({ table_sort_stack: stack, table_columns: columns })).status, 200);
  assert.equal((await h.go('default')).status, 200);
  assert.equal((await h.go('view')).status, 200);
  const back = await h.project();
  assert.deepEqual(h.helpers.getActiveTableSortStackFromProject(back), stack);
  assert.deepEqual(h.helpers.getActiveTableColumnsFromProject(back), columns);
  assert.equal(h.helpers.getActiveTableColumnsFromProject(back).keys.includes('due'), false);
});

test('a view with no personal setting falls back to its own saved columns', () => {
  const h = setup();
  const project = {
    id: 17,
    project_view: {
      default_view: { id: 'default', table_columns: null, table_sort_stack: null },
      user_project_views: [{
        appliedView: { id: 'view', table_columns: columns, table_sort_stack: stack, ViewLastUsed: [] },
        unsavedView: { id: 'draft', table_columns: null, table_sort_stack: null },
      }],
    },
  };
  assert.deepEqual(h.helpers.getActiveTableColumnsFromProject(project), columns);
  assert.deepEqual(h.helpers.getActiveTableSortStackFromProject(project), stack);
  assert.equal(h.helpers.getTableSettingsViewFromProject(project).id, 'view');
});

test('personal table settings stay behind the ticket flag', async () => {
  const h = setup({ enabled: false });
  assert.equal((await h.call({ table_columns: columns })).status, 403);
  assert.deepEqual(h.view.ViewLastUsed, []);
});

test('legacy draft settings move to the account when the draft is deleted', async () => {
  const h = setup({ draft: { table_columns: columns, table_sort_stack: stack } });
  assert.equal((await h.go('default')).status, 200);
  const fresh = await h.project();
  assert.deepEqual(h.helpers.getActiveTableColumnsFromProject(fresh), null);
  assert.deepEqual(h.helpers.getActiveTableSortStackFromProject(fresh), []);
  assert.equal((await h.go('view')).status, 200);
  const back = await h.project();
  assert.deepEqual(h.helpers.getActiveTableColumnsFromProject(back), columns);
  assert.deepEqual(h.helpers.getActiveTableSortStackFromProject(back), stack);
});

test('another account cannot write personal table settings', async () => {
  const h = setup({ view: { visibility: 'Private' } });
  const response = await h.call({ table_columns: columns });
  assert.equal(response.status, 404);
  assert.deepEqual(h.view.ViewLastUsed, []);
});

test('a personal write needs a view and at least one setting', async () => {
  const h = setup();
  assert.equal((await h.call({ table_columns: columns }, null)).status, 404);
  assert.equal((await h.call({})).status, 400);
  assert.deepEqual(h.view.ViewLastUsed, []);
});
