const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/htpr-7166-fixture.cjs');

// HTPR-7188: an open invite still loads the board, but never its shared views.
for (const [name, options, expected] of [
  ['Invited member', { member: 'Invited' }, []],
  ['Accepted member', { member: 'Accepted' }, ['view', 'default']],
  ['owner', { owner: true }, ['view', 'default']],
]) {
  test(`board load gives ${name} shared views: ${expected.join(', ') || 'none'}`, async () => {
    const h = fixture(options);
    const full = await h.load('src/utils/controllers/projects/getBoardTasks.ts').default(17, 42, 42);
    assert.equal(full.status, 200);
    assert.deepEqual(full.json.allViews.map(view => view.id), expected);
  });
}

test('invited member still sees their own Private view', async () => {
  const h = fixture({ member: 'Invited', view: { userId: 42, visibility: 'Private' } });
  const full = await h.load('src/utils/controllers/projects/getBoardTasks.ts').default(17, 42, 42);
  assert.deepEqual(full.json.allViews.map(view => view.id), ['view']);
});
