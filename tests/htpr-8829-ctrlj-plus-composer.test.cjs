const { assert, path, root, jiti, test, withPalette } = require('./helpers/compose-task-palette-fixture.cjs');

const boards = [
  { id: 7, title: 'QA Sandbox', uniqueIdentifier: 'QASA' },
  { id: 8, title: 'Product', uniqueIdentifier: 'PROD' },
];

test('HTPR-8829 flag is a small improvement that defaults to Everyone', () => {
  const { default: flag, HTPR_8829_CTRLJ_PLUS_COMPOSER_FLAG: key } = jiti(path.join(root, 'src/lib/flags/definitions/htpr-8829-ctrlj-plus-composer.ts'));
  assert.equal(key, 'htpr-8829-ctrlj-plus-composer');
  assert.equal(flag.key, key);
  assert.equal(flag.kind, 'improvement');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
});

test('HTPR-8829 Ctrl+J keeps + attach, mic and text Send in the box, pickers below, no shortcut row', async (t) => {
  await withPalette(t, { tab: 'compose', boards, url: '/my-tasks', previousBoard: 'project-7' }, async ({ flags, rerender }) => {
    flags['htpr-8829-ctrlj-plus-composer'] = true;
    flags['htpr-8260-ctrlj-composer-keys'] = true;
    await rerender();
    const writer = document.querySelector('[data-compose-task-writer]');
    const row = writer.querySelector('[data-compose-plus-row]');
    assert.ok(row, 'the + row renders inside the box');
    assert.ok(row.querySelector('[aria-label="Attach files"]'), '+ opens the file picker');
    assert.ok(row.querySelector('[aria-label="Start dictation"]'), 'the mic sits in the box');
    assert.match(row.textContent, /Send/);
    assert.equal(writer.querySelector('[aria-label="Create task"]'), null);
    const below = writer.querySelector('[data-compose-below-row]');
    assert.ok(below?.querySelector('[data-compose-board-chip]'), 'the board picker moves below the box');
    assert.equal([...writer.children].find((child) => child.className.includes('border-t')), undefined, 'no shortcut row');
    assert.match(writer.querySelector('textarea').className, /placeholder:opacity-50/);
    flags['htpr-8829-ctrlj-plus-composer'] = false;
    await rerender();
    assert.equal(writer.querySelector('[data-compose-plus-row]'), null);
    assert.ok([...document.querySelector('[data-compose-task-writer]').children].find((child) => child.className.includes('border-t')), 'flag off keeps the shortcut row');
  });
});


test('HTPR-8829 Tab leaves the textarea and the board chip to the browser so Send stays reachable', async (t) => {
  await withPalette(t, { tab: 'compose', boards, url: '/my-tasks', previousBoard: 'project-7' }, async ({ flags, rerender, press, input }) => {
    flags['htpr-8829-ctrlj-plus-composer'] = true;
    await rerender();
    const tabFromTextarea = await press('Tab', {}, input());
    assert.equal(tabFromTextarea.defaultPrevented, false, 'Tab from the textarea is not redirected to the board chip');
    const chip = document.querySelector('[data-compose-board-chip]');
    const shiftTabFromChip = await press('Tab', { shiftKey: true }, chip);
    assert.equal(shiftTabFromChip.defaultPrevented, false, 'Shift+Tab from the board chip is not redirected to the textarea');
    flags['htpr-8829-ctrlj-plus-composer'] = false;
    await rerender();
    const legacyTab = await press('Tab', {}, input());
    assert.equal(legacyTab.defaultPrevented, true, 'flag off keeps the old textarea to chip jump');
  });
});
