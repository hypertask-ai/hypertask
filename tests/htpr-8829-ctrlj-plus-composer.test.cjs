const { assert, fs, path, React, root, jiti, test, withPalette } = require('./helpers/compose-task-palette-fixture.cjs');

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

test('HTPR-8829 the white mic and compact pill are reused, not copied', () => {
  const audio = fs.readFileSync(path.join(root, 'src/components/RTE/Components/AudioButton.tsx'), 'utf8');
  assert.match(audio, /const primaryDesktopAiMic = !isMobileView && compactListeningPill && \(\(isDesktopAiMic && isAiChat\) \|\| primaryMic\);/);
  const writer = fs.readFileSync(path.join(root, 'src/components/Modals/commands/HTC/ComposeTaskWriter.tsx'), 'utf8');
  assert.match(writer, /plusLayout \? \{ compactListeningPill: true, primaryMic: true, hideDevicePicker: true, stopButtonId: stopDictationButtonId/);
});
