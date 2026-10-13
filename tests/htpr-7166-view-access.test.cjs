const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/htpr-7166-fixture.cjs');
const deniedBody = { message: 'View not found on this board' };
async function invoke(h, mode, body) {
  if (mode === 'sync') {
    const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await h.load('src/pages/api/projects/views/sync-view.ts').default({ method: 'POST', headers: {}, body: body ?? { projectId: 17, board_columns_view: [{ id: 2 }] } }, res);
    return { status: res.statusCode, body: res.body };
  }
  const file = mode === 'switch' ? 'switch-view' : 'delete-rename-view';
  const response = await h.load(`src/lib/api/project-writes/views/${file}.ts`)[mode === 'delete' ? 'DELETE' : 'POST'](h.request(body ?? (mode === 'switch' ? { projectId: 17, newViewId: 'view' } : { viewId: 'view', title: 'Rename' }), mode === 'delete' ? (body ?? { viewId: 'view' }) : {}));
  return { status: response.status, body: await response.json() };
}
for (const mode of ['rename', 'delete', 'switch', 'sync']) {
  for (const [actor, options] of Object.entries({ outsider: {}, 'same-team nonmember': {}, Invited: { member: 'Invited' }, removed: { view: { visibility: 'Private', userId: 42 } }, 'agent-only human': { agent: true }, 'other private': { owner: true, view: { visibility: 'Private' } } })) {
    test(`${mode}: ${actor} denied without writes, slug lookup, lock or broadcast`, async () => {
      const h = fixture(options);
      const result = await invoke(h, mode);
      assert.equal(result.status, 404);
      assert.deepEqual(result.body, deniedBody);
      assert.deepEqual(h.writes, []);
      assert.deepEqual(h.effects, []);
    });
  }
  for (const [actor, options] of Object.entries({ owner: { owner: true }, Accepted: { member: 'Accepted' }, 'teamless owner': { owner: true, teamless: true }, 'own private': { member: 'Accepted', view: { userId: 42, visibility: 'Private' } }, Archive: { owner: true, status: 'Archive' }, Deleted: { owner: true, status: 'Deleted' } })) {
    test(`${mode}: ${actor} retains legitimate operation`, async () => {
      const h = fixture(options);
      assert.equal((await invoke(h, mode)).status, 200);
      assert.ok(h.writes.length > 0);
      if (mode === 'sync' && options.view?.visibility === 'Private') assert.deepEqual(h.writes.map(([, query]) => query.where.id), ['view']);
    });
  }
  for (const race of [({ board }) => { board.members = []; board.ownerId = 99; }, ({ view }) => { view.visibility = 'Private'; view.userId = 99; }]) {
    test(`${mode}: authorization lost at lock causes zero writes`, async () => {
      const h = fixture({ owner: true, race });
      assert.deepEqual(await invoke(h, mode), { status: 404, body: deniedBody });
      assert.deepEqual(h.writes, []);
      assert.ok(!h.effects.includes('broadcast'));
    });
  }
  test(`${mode}: anonymous denial precedes queries`, async () => {
    const h = fixture({ anonymous: true });
    assert.equal((await invoke(h, mode)).status, 401);
    assert.deepEqual(h.queries, []);
    assert.deepEqual(h.writes, []);
  });
}
for (const mode of ['rename', 'delete', 'switch']) {
  test(`${mode}: missing, foreign and invisible IDs are indistinguishable`, async () => {
    const outsider = fixture();
    const missing = fixture({ owner: true });
    const body = mode === 'switch' ? { projectId: 17, newViewId: 'missing' } : { viewId: 'missing', title: 'Rename' };
    assert.deepEqual(await invoke(outsider, mode), await invoke(missing, mode, body));
  });
  test(`${mode}: wrong supplied board is denied`, async () => {
    const h = fixture({ owner: true });
    assert.equal((await invoke(h, mode, mode === 'switch' ? { projectId: 18, newViewId: 'view' } : { projectId: mode === 'delete' ? '18' : 18, viewId: 'view', title: 'Rename' })).status, 404);
    assert.deepEqual(h.writes, []);
  });
  for (const id of [undefined, '', ['view'], {}, 42]) test(`${mode}: invalid ID ${JSON.stringify(id)} never omits filter`, async () => {
    const h = fixture({ owner: true });
    assert.equal((await invoke(h, mode, mode === 'switch' ? { projectId: 17, newViewId: id } : { viewId: id, title: 'Rename' })).status, 400);
    assert.deepEqual(h.queries, []);
  });
}
test('sync resolves every shared target before writes; inaccessible default cannot partially update applied view', async () => {
  const h = fixture({ member: 'Accepted', defaultView: { visibility: 'Private' } });
  assert.deepEqual(await invoke(h, 'sync'), { status: 404, body: deniedBody });
  assert.deepEqual(h.writes, []);
});
for (const [actor, options] of Object.entries({ owner: { owner: true }, Accepted: { member: 'Accepted' }, 'teamless owner': { owner: true, teamless: true } })) {
  test(`sync: ${actor} can update only their own active Private default`, async () => {
    const h = fixture({ ...options, defaultView: { userId: 42, visibility: 'Private' } });
    h.uv.appliedViewId = null;
    assert.equal((await invoke(h, 'sync')).status, 200);
    assert.deepEqual(h.writes.map(([name, query]) => [name, query.where.id, query.data.board_columns_view]), [['view-update', 'default', [{ id: 2 }]]]);
    assert.equal(h.writes[0][1].where.visibility, 'Private');
    assert.deepEqual(h.view.board_columns_view, [{ id: 1, section_title: 'view' }]);
  });
}
for (const [name, options, race] of [
  ['another owner Private default', { defaultView: { visibility: 'Private' } }],
  ['foreign-container Private default', { defaultView: { userId: 42, visibility: 'Private', project_view_id: 'foreign' } }],
  ['default ownership lost at lock', { defaultView: { userId: 42, visibility: 'Private' } }, ({ defaultView }) => { defaultView.userId = 99; }],
  ['board access lost at lock', { defaultView: { userId: 42, visibility: 'Private' } }, ({ board }) => { board.ownerId = 99; }],
]) test(`sync: ${name} denied without writes`, async () => {
  const h = fixture({ owner: true, ...options, race });
  h.uv.appliedViewId = null;
  assert.deepEqual(await invoke(h, 'sync'), { status: 404, body: deniedBody });
  assert.deepEqual(h.writes, []);
});
test('sync: Public applied view cannot propagate columns into even an owned Private default', async () => {
  const h = fixture({ owner: true, defaultView: { userId: 42, visibility: 'Private' } });
  assert.deepEqual(await invoke(h, 'sync'), { status: 404, body: deniedBody });
  assert.deepEqual(h.writes, []);
});
test('sync unauthorized board with no prior state does not create a container', async () => {
  const h = fixture({ noState: true });
  assert.equal((await invoke(h, 'sync')).status, 404);
  assert.deepEqual(h.writes, []);
});
for (const mode of ['rename', 'delete']) test(`${mode}: smart-split protection remains 409 only after authorization`, async () => {
  assert.equal((await invoke(fixture({ owner: true, managed: true }), mode)).status, 409);
  const denied = fixture({ managed: true });
  assert.equal((await invoke(denied, mode)).status, 404);
  assert.deepEqual(denied.effects, []);
});
test('switching default retains null applied pointer and deletes only owned same-container draft', async () => {
  const h = fixture({ owner: true, unsaved: true });
  assert.equal((await invoke(h, 'switch', { projectId: 17, newViewId: 'default' })).status, 200);
  const state = h.writes.find(([name]) => name === 'state-upsert')[1];
  assert.equal(state.update.appliedViewId, null);
  assert.equal(state.create.appliedViewId, null);
  assert.deepEqual(h.writes.filter(([name]) => name === 'view-delete').map(([, query]) => query.where.id), ['draft']);
});
for (const [name, overrides] of [['foreign default', { project_view_id: 'foreign' }], ['Private default at lock', null]]) test(`sync: ${name} cannot cause a partial applied update`, async () => {
  const h = fixture({ owner: true, ...(overrides ? { defaultView: overrides } : { race: ({ defaultView }) => { defaultView.visibility = 'Private'; } }) });
  assert.deepEqual(await invoke(h, 'sync'), { status: 404, body: deniedBody });
  assert.deepEqual(h.writes, []);
});
for (const mode of ['rename', 'delete', 'switch']) test(`${mode}: poisoned draft never deletes another user's view`, async () => {
  const h = fixture({ owner: true, unsaved: true, draft: { userId: 99, project_view_id: 'foreign' } });
  assert.equal((await invoke(h, mode)).status, 200);
  assert.ok(!h.writes.some(([name, query]) => name === 'view-delete' && query.where.id === 'draft'));
});
