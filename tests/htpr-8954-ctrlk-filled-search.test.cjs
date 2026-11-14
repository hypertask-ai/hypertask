const { assert, path, root, jiti, test, withPalette } = require('./helpers/compose-task-palette-fixture.cjs');

const boards = [
  { id: 7, title: 'QA Sandbox', uniqueIdentifier: 'QASA' },
  { id: 8, title: 'Product', uniqueIdentifier: 'PROD' },
];
const key = 'htpr-8954-ctrlk-filled-search';
const tabsKey = 'htpr-8931-ctrlk-integrated-tabs';
const topKey = 'htpr-8943-ctrlk-tabs-on-top';
const searchRow = () => document.querySelector('#htc-search').parentElement;
const tabRow = () => document.querySelector('[aria-label="Commands mode"]').parentElement;

test('HTPR-8954 flag is an improvement that defaults to Everyone', () => {
  const { default: flag, HTPR_8954_CTRLK_FILLED_SEARCH_FLAG: exported } = jiti(path.join(root, 'src/lib/flags/definitions/htpr-8954-ctrlk-filled-search.ts'));
  assert.equal(exported, key);
  assert.equal(flag.key, key);
  assert.equal(flag.kind, 'improvement');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
});

test('HTPR-8954 Ctrl+K Search is a filled inset box with no separator lines, New Task keeps its tab divider', async (t) => {
  await withPalette(t, { tab: 'search', boards, url: '/my-tasks', previousBoard: 'project-7' }, async ({ flags, rerender, clickTab }) => {
    flags[tabsKey] = true;
    flags[topKey] = true;
    flags[key] = true;
    await rerender();
    const row = searchRow();
    assert.match(row.className, /\bbg-ai-tiptap\b/, 'search row uses the New Task fill');
    assert.match(row.className, /rounded-\[4px\]/);
    assert.match(row.className, /\bmx-2\b/, 'inset 8px each side');
    assert.doesNotMatch(row.className, /border-b/, 'no line under the search row');
    assert.doesNotMatch(tabRow().className, /border-b/, 'no line under the tab row in Search');
    assert.ok(row.querySelector('input#htc-search'), 'input sits in the filled row');
    await clickTab('New Task');
    assert.match(tabRow().className, /border-b/, 'New Task keeps the divider under the tab row');
    assert.ok(document.querySelector('[data-compose-task-writer]'), 'New Task renders');
  });
});

test('HTPR-8954 flag off keeps the two separator lines and no fill', async (t) => {
  await withPalette(t, { tab: 'search', boards, url: '/my-tasks', previousBoard: 'project-7' }, async ({ flags, rerender }) => {
    flags[tabsKey] = true;
    flags[topKey] = true;
    flags[key] = false;
    await rerender();
    const row = searchRow();
    assert.match(row.className, /border-b/, 'line under the search row');
    assert.doesNotMatch(row.className, /bg-ai-tiptap/);
    assert.match(tabRow().className, /border-b/, 'line under the tab row');
  });
});
