const { assert, path, root, jiti, test, withPalette } = require('./helpers/compose-task-palette-fixture.cjs');

const boards = [
  { id: 7, title: 'QA Sandbox', uniqueIdentifier: 'QASA' },
  { id: 8, title: 'Product', uniqueIdentifier: 'PROD' },
];
const flagKey = 'htpr-8931-ctrlk-integrated-tabs';
const tabList = () => document.querySelector('[aria-label="Commands mode"]');
const floatingWrapper = () => tabList().parentElement;

test('HTPR-8931 flag is an improvement that defaults to Everyone', () => {
  const { default: flag, HTPR_8931_CTRLK_INTEGRATED_TABS_FLAG: key } = jiti(path.join(root, 'src/lib/flags/definitions/htpr-8931-ctrlk-integrated-tabs.ts'));
  assert.equal(key, flagKey);
  assert.equal(flag.key, key);
  assert.equal(flag.kind, 'improvement');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
});

test('HTPR-8931 Ctrl+J puts the tab row inside the panel above the composer, flag off keeps the floating pill', async (t) => {
  await withPalette(t, { tab: 'compose', boards, url: '/my-tasks', previousBoard: 'project-7' }, async ({ flags, rerender }) => {
    flags[flagKey] = true;
    await rerender();
    const writer = document.querySelector('[data-compose-task-writer]');
    assert.ok(tabList(), 'tab row renders');
    assert.ok(writer.parentElement.contains(tabList()), 'tab row sits inside the panel body');
    assert.equal(document.querySelector('[class*="-top-12"]'), null, 'no floating wrapper');
    assert.match(floatingWrapper().className, /border-b/, 'divider under the tab row');
    assert.ok(floatingWrapper().compareDocumentPosition(writer) & 4, 'tab row comes before the composer');
    const labels = [...tabList().querySelectorAll('[role="tab"]')].map((node) => node.textContent);
    assert.equal(labels.length, 2);
    assert.ok(labels[0].startsWith('Search') && labels[1].startsWith('New Task'));
    assert.match(writer.querySelector('textarea').closest('div.bg-ai-tiptap').className, /rounded-\[4px\]/);
    flags[flagKey] = false;
    await rerender();
    assert.ok(document.querySelector('[class*="-top-12"]'), 'flag off restores the floating wrapper');
    assert.ok(!document.querySelector('[data-compose-task-writer]').parentElement.contains(tabList()), 'flag off keeps the tabs outside the panel body');
  });
});

test('HTPR-8931 Ctrl+K puts the tab row inside the panel above the search input', async (t) => {
  await withPalette(t, { tab: 'search', boards, url: '/my-tasks', previousBoard: 'project-7' }, async ({ flags, rerender, clickTab }) => {
    flags[flagKey] = true;
    await rerender();
    const search = document.querySelector('#htc-search');
    assert.ok(search, 'search input renders');
    assert.ok(tabList(), 'tab row renders');
    assert.equal(document.querySelector('[class*="-top-12"]'), null, 'no floating wrapper');
    assert.ok(tabList().compareDocumentPosition(search) & 4, 'tab row sits above the search input');
    assert.match(floatingWrapper().className, /border-b/, 'divider under the tab row');
    const searchRow = floatingWrapper();
    assert.equal(searchRow.parentElement.firstElementChild, searchRow, 'tab row is the first row of the panel in Search');
    await clickTab('New Task');
    assert.ok(document.querySelector('[data-compose-task-writer]'), 'tabs still switch to New Task');
    assert.equal(floatingWrapper().parentElement.firstElementChild, floatingWrapper(), 'tab row is the first row of the panel in New Task');
    assert.equal(floatingWrapper(), searchRow, 'tab row keeps the same node across modes');
    assert.equal(document.querySelector('[class*="-top-12"]'), null);
    flags[flagKey] = false;
    await rerender();
    assert.ok(document.querySelector('[class*="-top-12"]'), 'flag off restores the floating wrapper');
  });
});
