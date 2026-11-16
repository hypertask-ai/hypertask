const { assert, path, root, test, withPalette } = require('./helpers/compose-task-palette-fixture.cjs');

const boards = [
  { id: 7, title: 'QA Sandbox', uniqueIdentifier: 'QASA' },
  { id: 8, title: 'Product', uniqueIdentifier: 'PROD' },
];

test('HTPR-7871 Ctrl+K search placeholder has no dots', async (t) => {
  await withPalette(t, { tab: 'search', boards, url: '/my-tasks', previousBoard: 'project-7' }, async () => {
    const input = document.querySelector('#htc-search');
    assert.ok(input, 'search input renders');
    assert.equal(input.getAttribute('placeholder'), 'Type a command or search');
  });
});
