const { assert, path, root, jiti, test, withPalette } = require('./helpers/compose-task-palette-fixture.cjs');

const boards = [
  { id: 7, title: 'QA Sandbox', uniqueIdentifier: 'QASA' },
  { id: 8, title: 'Product', uniqueIdentifier: 'PROD' },
];
const key = 'htpr-7871-ctrlk-ellipsis';

test('HTPR-7871 flag is an improvement that defaults to Everyone', () => {
  const { default: flag, HTPR_7871_CTRLK_ELLIPSIS_FLAG: exported } = jiti(path.join(root, 'src/lib/flags/definitions/htpr-7871-ctrlk-ellipsis.ts'));
  assert.equal(exported, key);
  assert.equal(flag.key, key);
  assert.equal(flag.kind, 'improvement');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
});

test('HTPR-7871 Ctrl+K search placeholder ends with a real ellipsis', async (t) => {
  await withPalette(t, { tab: 'search', boards, url: '/my-tasks', previousBoard: 'project-7' }, async ({ flags, rerender }) => {
    flags[key] = true;
    await rerender();
    const input = document.querySelector('#htc-search');
    assert.ok(input, 'search input renders');
    assert.equal(input.getAttribute('placeholder'), 'Type a command or search…');
  });
});

test('HTPR-7871 flag off keeps the three full stops', async (t) => {
  await withPalette(t, { tab: 'search', boards, url: '/my-tasks', previousBoard: 'project-7' }, async ({ flags, rerender }) => {
    flags[key] = false;
    await rerender();
    const input = document.querySelector('#htc-search');
    assert.ok(input, 'search input renders');
    assert.equal(input.getAttribute('placeholder'), 'Type a command or search...');
  });
});
