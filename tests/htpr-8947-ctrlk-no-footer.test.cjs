const { assert, path, root, jiti, test, withPalette } = require('./helpers/compose-task-palette-fixture.cjs');

const boards = [
  { id: 7, title: 'QA Sandbox', uniqueIdentifier: 'QASA' },
  { id: 8, title: 'Product', uniqueIdentifier: 'PROD' },
];
const key = 'htpr-8947-ctrlk-no-footer';
const buildId = 'abc1234def5678';

const withBuild = async (check) => {
  const previous = process.env.NEXT_PUBLIC_BUILD_ID;
  process.env.NEXT_PUBLIC_BUILD_ID = buildId;
  try { await check(); } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BUILD_ID;
    else process.env.NEXT_PUBLIC_BUILD_ID = previous;
  }
};

test('HTPR-8947 flag is an improvement that defaults to Everyone', () => {
  const { default: flag, HTPR_8947_CTRLK_NO_FOOTER_FLAG: exported } = jiti(path.join(root, 'src/lib/flags/definitions/htpr-8947-ctrlk-no-footer.ts'));
  assert.equal(exported, key);
  assert.equal(flag.key, key);
  assert.equal(flag.kind, 'improvement');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
});

test('HTPR-8947 Ctrl+K Search and New Task show no shortcut hints or version, the build id stays as a hidden attribute', async (t) => {
  await withBuild(() => withPalette(t, { tab: 'search', boards, url: '/my-tasks', previousBoard: 'project-7' }, async ({ flags, rerender, clickTab }) => {
    flags[key] = true;
    await rerender();
    assert.ok(document.querySelector('#htc-search'), 'search input renders');
    assert.equal(document.querySelector('[data-cmdk-version]'), null, 'no version line in Search');
    assert.doesNotMatch(document.body.textContent, /↑↓|navigate|esc close|abc1234/);
    const panel = document.querySelector('[data-build]');
    assert.equal(panel.getAttribute('data-build'), buildId);
    assert.ok(panel.contains(document.querySelector('#htc-search')), 'build id sits on the panel body');
    await clickTab('New Task');
    assert.ok(document.querySelector('[data-compose-task-writer]'), 'New Task renders');
    assert.equal(document.querySelector('[data-cmdk-version]'), null, 'no version line in New Task');
    assert.doesNotMatch(document.body.textContent, /↑↓|navigate|abc1234/);
    assert.equal(document.querySelector('[data-build]').getAttribute('data-build'), buildId, 'build id still present in New Task');
  }));
});

test('HTPR-8947 flag off keeps the shortcut hints and the version line', async (t) => {
  await withBuild(() => withPalette(t, { tab: 'search', boards, url: '/my-tasks', previousBoard: 'project-7' }, async ({ flags, rerender }) => {
    flags[key] = false;
    await rerender();
    const version = document.querySelector('[data-cmdk-version]');
    assert.ok(version, 'version line renders');
    assert.match(version.textContent, /^v abc1234/);
    assert.match(version.previousElementSibling.textContent, /navigate.*select.*close/);
  }));
});
