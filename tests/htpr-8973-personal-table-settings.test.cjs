const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/htpr-7166-fixture.cjs');

const stack = [{ column: 'priority', direction: 'desc' }, { column: 'updated', direction: 'desc' }];
const columns = { keys: ['ticket', 'title', 'updated', 'priority'], widths: { updated: 173, title: 420 } };
const body = (settings, viewId = 'view') => ({ projectId: 17, viewId, updateMode: 'personal-table-settings', view_settings: settings });

function setup(options = {}) {
  const h = fixture({ member: 'Accepted', unsaved: true, ...options });
  h.mocks['@/lib/flags'].isFeatureEnabled = async () => options.enabled !== false;
  h.prisma.view_Last_Used.upsert = async ({ where, create, update }) => {
    const { userId, viewId } = where.user_view_last_used;
    assert.equal(userId, 42);
    const view = [h.view, h.defaultView].find(view => view.id === viewId);
    const existing = view.ViewLastUsed.find(row => row.userId === userId);
    if (existing) Object.assign(existing, update);
    else view.ViewLastUsed.push(create);
    return existing ?? create;
  };
  h.prisma.user_Project_View.upsert = async ({ update }) => {
    Object.assign(h.uv, update);
    h.uv.appliedView = update.appliedViewId === 'view' ? h.view : null;
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
  const call = async (settings, viewId = 'view') => update(h.request(body(settings, viewId)));
  const project = async () => ({ id: 17, project_view: await read(17, 42) });
  return { ...h, call, project, helpers, switchView };
}

test('account sort, column order and widths survive draft deletion, switching and a fresh device read', async () => {
  const h = setup();
  assert.equal((await h.call({ table_sort_stack: stack })).status, 200);
  assert.equal((await h.call({ table_columns: columns })).status, 200);
  assert.deepEqual(h.view.table_columns, undefined);
  assert.deepEqual(h.draft.table_columns, undefined);
  assert.equal((await h.switchView(h.request({ projectId: 17, newViewId: 'default' }))).status, 200);
  assert.equal(h.uv.unsavedView, null);
  let fresh = JSON.parse(JSON.stringify(await h.project()));
  assert.equal(h.helpers.getActiveTableColumnsFromProject(fresh), null);
  assert.deepEqual(h.helpers.getActiveTableSortStackFromProject(fresh), []);
  assert.equal((await h.switchView(h.request({ projectId: 17, newViewId: 'view' }))).status, 200);
  fresh = JSON.parse(JSON.stringify(await h.project()));
  assert.deepEqual(h.helpers.getActiveTableColumnsFromProject(fresh), columns);
  assert.deepEqual(h.helpers.getActiveTableSortStackFromProject(fresh), stack);
  assert.equal(h.helpers.getTableSettingsViewFromProject(fresh).id, 'view');
  const outsider = { id: 17, project_view: { default_view: { ...h.view, ViewLastUsed: [] }, user_project_views: [] } };
  assert.equal(h.helpers.getActiveTableColumnsFromProject(outsider), null);
  assert.deepEqual(h.helpers.getActiveTableSortStackFromProject(outsider), []);
});

test('an explicit cleared sort overrides a saved sort without clearing saved columns', async () => {
  const h = setup({ view: { table_sort_stack: stack } });
  await h.call({ table_columns: columns });
  await h.call({ table_sort_stack: [] });
  const fresh = await h.project();
  assert.deepEqual(h.helpers.getActiveTableSortStackFromProject(fresh), []);
  assert.deepEqual(h.helpers.getActiveTableColumnsFromProject(fresh), columns);
});

test('a delayed write names its original view, even after switching', async () => {
  const h = setup();
  await h.switchView(h.request({ projectId: 17, newViewId: 'default' }));
  await h.call({ table_columns: columns }, 'view');
  assert.equal(h.helpers.getActiveTableColumnsFromProject(await h.project()), null);
  assert.deepEqual(h.view.ViewLastUsed.find(row => row.userId === 42).table_columns, columns);
});

test('table settings remain gated on the server', async () => {
  const h = setup({ enabled: false });
  assert.equal((await h.call({ table_columns: columns })).status, 403);
  assert.deepEqual(h.view.ViewLastUsed, []);
});

for (const [name, options] of Object.entries({ anonymous: { anonymous: true }, outsider: { member: null }, 'other private view': { view: { visibility: 'Private' } } })) {
  test(`${name} cannot write another account's table preferences`, async () => {
    const h = setup(options);
    assert.equal((await h.call({ table_columns: columns })).status, name === 'anonymous' ? 401 : 404);
    assert.deepEqual(h.view.ViewLastUsed, []);
  });
}

test('the table write entry points target the saved view, not its draft or the next cached view', async () => {
  const h = setup();
  const requests = [];
  const project = { id: 17, project_view: h.pv };
  const cached = { id: 17, project_view: { default_view: { id: 'default' }, user_project_views: [] } };
  const mocks = h.mocks;
  mocks['@/store'] = {};
  mocks['@/lib/state'] = {
    useRecoilState: () => ['table', () => {}],
    useRecoilValue: () => ({}),
    useSetRecoilState: () => () => {},
  };
  mocks['@/hooks/useFlag'] = { useFlag: key => key === 'htpr-8973-table-sort-columns' };
  mocks['@tanstack/react-query'] = { useQueryClient: () => ({}) };
  mocks['next/navigation'] = { useRouter: () => ({}) };
  mocks['@/hooks/MultiPages/useUpdateTaskInBoards'] = { default: () => ({
    getProjectIdxAndAllData: () => ({ allData: { updatedProjects: [cached] }, projectToUpdateIndex: 0 }),
    updateProjectView: () => {},
  }) };
  mocks['@/utils/helperFunctions/helperFunctions'].deepCopy = value => structuredClone(value);
  mocks.axios = { post: async (url, body) => { requests.push({ url, body }); return { status: 200, data: h.pv }; } };
  const hook = h.load('src/hooks/Homepage/Views/useKanbanViews.ts').default(project);
  await hook.setTableSortViewAndReturn(project, stack[0], stack);
  await hook.setTableColumnsViewAndReturn(project, columns);
  await hook.setTableSortViewAndReturn(project, stack[0]);
  await hook.setTableSortViewAndReturn(project, null);
  assert.deepEqual(requests, [
    { url: '/api/projects/views/update-view', body: body({ table_sort_stack: stack }) },
    { url: '/api/projects/views/update-view', body: body({ table_columns: columns }) },
    { url: '/api/projects/views/update-view', body: body({ table_sort_stack: [stack[0]] }) },
    { url: '/api/projects/views/update-view', body: body({ table_sort_stack: [] }) },
  ]);
});

for (const [name, screen, index] of [
  ['current view', 'SaveThisView', 0],
  ['board default', 'SaveThisView', 1],
  ['new team view', 'SaveForTeam', 0],
  ['new private view', 'SaveForMe', 0],
]) {
  test(`saving ${name} never publishes personal table settings`, async () => {
    const h = setup();
    h.mocks['@/utils/helperFunctions/helperFunctions'].deepCopy = value => structuredClone(value);
    const sharedStack = [{ column: 'title', direction: 'asc' }];
    const sharedColumns = { keys: ['ticket', 'title', 'due'], widths: { title: 300 } };
    Object.assign(h.view, { table_sort_stack: sharedStack, table_columns: sharedColumns,
      table_sort_column: 'title', table_sort_direction: 'asc' });
    await h.call({ table_sort_stack: stack, table_columns: columns });
    const project = await h.project();
    assert.deepEqual(h.helpers.getActiveTableSortStackFromProject(project), stack);
    assert.deepEqual(h.helpers.getActiveTableColumnsFromProject(project), columns);
    const requests = [];
    const overrides = {
      '@/components/Common/CommonModalComponents': {},
      '@/hooks/General/useHandleMouse': {},
      '@/hooks/General/useCurrentUserCheckFromCookies': { default: () => ({ id: 42 }) },
      '@/utils/helperFunctions/Views/ViewsHelperFunctions': h.helpers,
      'reactstrap': {},
      '@/hooks/Homepage/Views/useKanbanViews': { default: () => ({
        updateView: async body => requests.push(body),
        saveAsDefaultHandler: async body => requests.push(body),
      }) },
      '@/hooks/General/useHandleKeydownBasic': {},
      'react-hot-toast': {},
      'axios': {},
      '@tanstack/react-query': { useQueryClient: () => ({ getQueryData: () => ({ updatedProjects: [project] }) }) },
      '@/hooks/useFlag': { useFlag: () => true },
    };
    const fs = require('node:fs');
    const ts = require('typescript');
    const file = require('node:path').join(__dirname, '../src/components/Modals/ViewModals/SaveViewModal.tsx');
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const exports = {};
    new Function('require', 'exports', compiled)(specifier =>
      specifier in overrides ? { __esModule: true, ...overrides[specifier] } : require(specifier), exports);
    const modal = exports.default({ project, toggle: () => {} });
    const content = modal.type(modal.props);
    await content.props.onSelect({ id: screen }, index, 'New view');
    assert.equal(requests.length, 1);
    const settings = requests[0].view_settings;
    assert.deepEqual(settings.table_sort_stack, sharedStack);
    assert.deepEqual(settings.table_columns, sharedColumns);
    assert.equal(settings.table_sort_column, 'title');
    assert.equal(settings.table_sort_direction, 'asc');
    assert.deepEqual(h.helpers.getActiveTableSortStackFromProject(project), stack);
    assert.deepEqual(h.helpers.getActiveTableColumnsFromProject(project), columns);
  });
}

test('missing view IDs never turn into an unscoped query', async () => {
  const h = setup();
  const update = h.load('src/lib/api/project-writes/views/update-view.ts').POST;
  assert.equal((await update(h.request({ ...body({ table_columns: columns }), viewId: undefined }))).status, 400);
  assert.equal(h.queries.length, 0);
});
