const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { fixture } = require('./helpers/htpr-7166-fixture.cjs');

for (const [name, options] of Object.entries({ outsider: {}, Invited: { member: 'Invited' }, removed: {} })) {
  test(`getProjectView and section columns deny ${name}`, async () => {
    const h = fixture(options);
    assert.equal(await h.load('src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts').default(17, 42), null);
    assert.deepEqual(await h.load('src/utils/controllers/section/getProjectSections.ts').default(17, 42), { status: 404, json: { message: 'Project not found' } });
    assert.ok(!h.queries.some(([name]) => name === 'sections'));
  });
}
for (const [name, options] of Object.entries({ Public: {}, 'own Private': { visibility: 'Private', userId: 42 }, 'other Private': { visibility: 'Private' }, 'foreign container': { project_view_id: 'foreign' } })) {
  test(`helper and full/minimal bootstrap project ${name} pointers without extra queries`, async () => {
    const h = fixture({ owner: true, unsaved: true, view: options, defaultView: options, draft: { project_view_id: 'foreign' } });
    const allowed = name === 'Public' || name === 'own Private';
    const helper = await h.load('src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts').default(17, 42);
    assert.equal(helper.default_view?.id ?? null, allowed ? 'default' : null);
    assert.equal(helper.user_project_views[0].appliedView?.id ?? null, allowed ? 'view' : null);
    assert.equal(helper.user_project_views[0].unsavedView, null);
    h.queries.length = 0;
    const full = await h.load('src/utils/controllers/projects/getBoardTasks.ts').default(17, 42, 42);
    assert.equal(full.status, 200);
    const pv = full.json.project.project_view;
    assert.equal(pv.default_view?.id ?? null, allowed ? 'default' : null);
    assert.equal(pv.user_project_views[0].appliedView?.id ?? null, allowed ? 'view' : null);
    assert.equal(pv.user_project_views[0].unsavedView, null);
    assert.equal(h.queries.length, 2);
    h.queries.length = 0;
    // Execute ExtraMinimal with its real select, isolating only the unrelated board-list scope.
    const includes = h.load('src/utils/controllers/projects/getAllIncludes.ts');
    h.mocks['@/utils/controllers/projects/getAllIncludes'] = { ...includes, getProjectWhere: () => ({ ownerId: 42 }) };
    h.board.googleAccount = { id: 1 };
    const minimal = await h.load('src/utils/controllers/projects/getAllMinimal.ts').default(42, 'ExtraMinimal');
    assert.equal(minimal.status, 200);
    assert.equal(minimal.json.length, 1);
    const mpv = minimal.json[0].project_view;
    assert.equal(mpv.default_view?.slug ?? null, allowed ? 'default' : null);
    assert.equal(mpv.user_project_views[0].appliedView?.slug ?? null, allowed ? 'view' : null);
    assert.equal(mpv.user_project_views[0].unsavedView, null);
    if (allowed) assert.deepEqual(Object.keys(mpv.default_view).sort(), ['board_columns_view', 'board_filters', 'board_layout', 'board_show_archived', 'board_staleness', 'slug'].sort());
    assert.equal(h.queries.length, 1);
  });
}
test('Public to Private flip and membership removal apply on the next helper read', async () => {
  const h = fixture({ member: 'Accepted' });
  const get = h.load('src/utils/controllers/projects/views/viewsHelperAPIfunctions.ts').default;
  assert.equal((await get(17, 42)).user_project_views[0].appliedView.id, 'view');
  h.view.visibility = 'Private';
  assert.equal((await get(17, 42)).user_project_views[0].appliedView, null);
  h.board.members = [];
  assert.equal(await get(17, 42), null);
});
test('share guest never receives inviter Private or draft settings, Public sharing remains intact', async () => {
  const h = fixture({ owner: true, unsaved: true, view: { userId: 42, visibility: 'Private' }, defaultView: { userId: 42, visibility: 'Private' } });
  const get = h.load('src/utils/controllers/share/getProject.ts').default;
  const result = await get('capability');
  assert.equal(result.status, 200);
  assert.equal(result.json.project_view.default_view, null);
  assert.equal(result.json.project_view.user_project_views[0].appliedView, null);
  assert.equal(result.json.project_view.user_project_views[0].unsavedView, null);
  assert.equal(result.json.project_view.default_view_id, null);
  h.view.visibility = h.defaultView.visibility = 'Public';
  const publicResult = await get('capability');
  assert.equal(publicResult.json.project_view.default_view.title, 'default');
  assert.equal(publicResult.json.project_view.user_project_views[0].appliedView.title, 'view');
});
async function list(h, params = 'projectId=17&include_settings=true') {
  const res = await h.load('src/lib/mcp/operations/view/operation.ts').GET({ nextUrl: new URL(`https://example.invalid/api/mcp/view?${params}`) });
  return { status: res.status, body: await res.json() };
}
for (const [name, options, allowed] of [
  ['outsider', {}, false], ['Invited', { member: 'Invited' }, false], ['removed', {}, false],
  ['teamless owner', { owner: true, teamless: true }, true], ['Accepted', { member: 'Accepted' }, true],
  ['owned agent', { agent: true }, true], ['revoked agent', { agent: true, revokedAgent: true }, false], ['foreign agent', { agent: true, foreignAgent: true }, false],
]) test(`MCP/REST explicit-board listing: ${name}`, async () => {
  const h = fixture(options);
  const result = await list(h);
  assert.equal(result.status, allowed ? 200 : 404);
  if (allowed) { assert.equal(result.body.success, true); assert.equal(result.body.total, 2); assert.deepEqual(result.body.views.map(v => v.id), ['view', 'default']); }
  else { assert.equal(result.body.success, false); assert.ok(!h.queries.some(([name]) => ['views', 'count'].includes(name))); }
});
test('MCP list count, pagination and private filter agree', async () => {
  const h = fixture({ owner: true, view: { visibility: 'Private', userId: 42 } });
  const result = await list(h, 'projectId=17&visibility=Private&limit=1&offset=0');
  assert.equal(result.body.total, 1);
  assert.deepEqual(result.body.views.map(view => view.id), ['view']);
});
test('MCP no-project list suppresses stale private/cross-board relations and preserves fallback', async () => {
  const h = fixture({ owner: true, view: { visibility: 'Private' }, defaultView: { project_view_id: 'foreign' } });
  assert.deepEqual((await list(h, 'include_settings=true')).body.views, []);
  h.defaultView.project_view_id = 'pv';
  assert.deepEqual((await list(h, 'include_settings=true')).body.views.map(v => v.id), ['default']);
});
for (const [name, options, allowed] of [
  ['outsider', {}, false], ['Invited', { member: 'Invited' }, false], ['teamless owner', { owner: true, teamless: true }, true], ['Accepted', { member: 'Accepted' }, true], ['owned agent', { agent: true }, true], ['revoked agent', { agent: true, revokedAgent: true }, false],
]) test(`section create: ${name}`, async () => {
  const h = fixture(options);
  const result = await h.load('src/utils/controllers/section/sectionService.ts').createSection({ projectId: 17, title: 'New', userId: 42, agentId: options.agent ? 'owned-agent' : undefined });
  assert.equal(result.status, allowed ? 200 : 403);
  assert.deepEqual(h.effects, allowed ? ['section-create', 'fanout'] : []);
});
test('unused identity-trusting server actions are absent from the actual module exports', () => {
  const source = fs.readFileSync('src/app/[...boardURL]/serverActions.tsx', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(() => ({}), mod, mod.exports);
  assert.deepEqual(Object.keys(mod.exports).sort(), ['getAllSubTasks']);
});

for (const base of ['omitted', null]) test(`unsaved ${base} base cannot inherit private/default or cross-container draft settings`, async () => {
  const h = fixture({ owner: true, unsaved: true, view: { visibility: 'Private', board_layout: 'Table' }, defaultView: { visibility: 'Private', board_layout: 'Table' }, draft: { project_view_id: 'foreign', board_layout: 'Table' } });
  const request = { projectId: 17, board_columns_view: [], board_filters: { addedFilters: [] } };
  if (base !== 'omitted') request.baseViewId = base;
  const response = await h.load('src/lib/api/project-writes/views/unsaved-view.ts').POST(h.request(request));
  assert.equal(response.status, 200);
  const created = h.writes.find(([name]) => name === 'view-create');
  assert.ok(created, 'creates an owned draft rather than updating poisoned draft');
  assert.equal(created[1].data.board_layout, null);
  assert.equal(created[1].data.board_show_archived, null);
  assert.ok(!h.writes.some(([name, query]) => name === 'view-update' && query.where.id === 'draft'));
  const control = fixture({ owner: true });
  const positive = await control.load('src/lib/api/project-writes/views/unsaved-view.ts').POST(control.request(request));
  assert.equal(positive.status, 200);
  const controlDraft = control.writes.find(([name]) => name === 'view-create');
  assert.equal(controlDraft ? controlDraft[1].data.board_layout : (await positive.json()).user_project_views[0].unsavedView.board_layout, 'Table');
});
test('native AI list projects same-container visibility before resolving its fallback', async () => {
  const h = fixture({ owner: true, view: { visibility: 'Private' }, defaultView: { project_view_id: 'foreign' } });
  h.mocks['@/lib/ai/chatStream/request'] = { sortOrderSchema: require('zod').z.enum(['asc', 'desc']) };
  h.mocks['@/lib/ai/tools/execution'] = { withToolErrors: fn => fn };
  h.mocks['@/lib/ai/tools/helpers'] = { sanitizeForJson: value => value, mapViewToResponse: view => ({ id: view.id, title: view.title }) };
  const execute = h.load('src/lib/ai/tools/listViews.ts').createListViewsTool({ user: { id: 42 }, sendStatus() {} }).hypertask_list_views.execute;
  const input = { limit: 50, offset: 0, sort_by: 'title', sort_order: 'asc' };
  assert.deepEqual((await execute(input)).views, []);
  h.defaultView.project_view_id = 'pv';
  assert.deepEqual((await execute(input)).views, [{ id: 'default', title: 'default' }]);
});
test('section columns ignore another owner private default and fall back to board sections', async () => {
  const h = fixture({ member: 'Accepted', view: { visibility: 'Private' }, defaultView: { visibility: 'Private' } });
  const result = await h.load('src/utils/controllers/section/getProjectSections.ts').default(17, 42);
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.map(column => column.section_title), ['Safe column']);
});
for (const status of ['Normal', 'Archive', 'Deleted']) {
  for (const [name, options] of Object.entries({ owner: { owner: true }, Accepted: { member: 'Accepted' }, 'owned agent': { agent: true } })) {
    test(`MCP section create lifecycle: ${status} ${name}`, async () => {
      const h = fixture({ ...options, status });
      h.mocks['@/utils/controllers/agents/boardMembers'] = {};
      const result = await h.load('src/lib/mcp/sections/services.ts').createSection({ projectId: 17, title: 'New', userId: 42 }, options.agent ? 'owned-agent' : undefined);
      assert.equal(result.success, status === 'Normal');
      if (status !== 'Normal') {
        assert.equal(result.status, 404);
        assert.equal(result.error, 'Not found');
        assert.equal(result.message, 'Project with ID 17 not found');
        assert.ok(!h.queries.some(([name]) => ['section', 'sections'].includes(name)));
      }
      assert.deepEqual(h.effects, status === 'Normal' ? ['section-create', 'fanout'] : []);
    });
  }
  for (const [name, options] of Object.entries({ owner: { owner: true }, Accepted: { member: 'Accepted' } })) {
    test(`app section create preserves production lifecycle: ${status} ${name}`, async () => {
      const h = fixture({ ...options, status });
      const result = await h.load('src/lib/api/section-writes/create.ts').POST(h.request({ projectId: 17, title: 'New' }));
      assert.equal(result.status, status === 'Normal' ? 200 : 403);
      assert.deepEqual(h.effects, status === 'Normal' ? ['section-create', 'fanout', 'broadcast'] : []);
    });
  }
}

test('MCP section create passes the owned agent to the same accepted-only guard', async () => {
  const h = fixture({ agent: true, teamless: true });
  h.mocks['@/utils/controllers/agents/boardMembers'] = {};
  const result = await h.load('src/lib/mcp/sections/services.ts').createSection({ projectId: 17, title: 'New', userId: 42 }, 'owned-agent');
  assert.equal(result.success, true);
  assert.deepEqual(h.effects, ['section-create', 'fanout']);
});
