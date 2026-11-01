const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { createJiti } = require('jiti');

const root = path.resolve(__dirname, '..');
const flag = 'htpr-7307-ctrlj-footer-clickable';
const { withPalette } = require('./helpers/compose-task-palette-fixture.cjs');
const config = { newWindow: true, boardChip: true, tab: 'compose', boards: [
  { id: 7, title: 'QA Sandbox', uniqueIdentifier: 'QASA' },
  { id: 8, title: 'Product', uniqueIdentifier: 'PROD' },
] };
const writer = () => document.querySelector('[data-compose-task-writer]');
const footer = () => [...writer().children].find((node) => node.classList.contains('border-t'));
const button = (name) => footer().querySelector(`button[aria-label="${name}"]`);
const click = async (node) => React.act(async () => node.click());
const enable = async ({ flags, rerender }) => { flags[flag] = true; await rerender(); };

test('flag registers a default-Everyone low-risk feature', () => {
  const jiti = createJiti(__filename, { fsCache: false });
  const definition = jiti(path.join(root, `src/lib/flags/definitions/${flag}.ts`));
  assert.equal(definition.HTPR_7307_CTRLJ_FOOTER_CLICKABLE_FLAG, flag);
  assert.equal(definition.default.key, flag);
  assert.equal(definition.default.kind, 'feature');
  assert.equal(definition.default.defaultMode, 'EVERYONE');
  assert.equal(definition.default.releaseRisk.risk, 'small');
  assert.ok(definition.default.releaseRisk.reason);
  assert.equal(definition.default.releaseRisk.highRisk, undefined);
});

for (const apple of [false, true]) {
  test(`flag on makes the same footer labels accessible ghost buttons; off restores plain text (${apple ? 'Apple' : 'PC'})`, async (t) => {
    await withPalette(t, { ...config, apple }, async (ui) => {
      const original = footer().outerHTML;
      const labels = [...footer().children].map((node) => node.textContent);
      assert.equal(footer().querySelectorAll('button').length, 0);
      assert.ok([...footer().children].every((node) => node.tagName === 'SPAN'));
      await enable(ui);
      assert.deepEqual([...footer().children].map((node) => node.textContent), labels);
      assert.equal(footer().querySelectorAll('button[type="button"]').length, 5);
      for (const name of ['Send', 'Attach files', 'Search', 'Board', 'Close']) {
        assert.ok(button(name), `${name} has an accessible name`);
        assert.match(button(name).className, /hover:bg-hover-active/);
        assert.match(button(name).className, /hover:text-white-black/);
        assert.match(button(name).className, /focus-visible:bg-hover-active/);
        assert.match(button(name).className, /focus-visible:outline-none/);
      }
      assert.equal(footer().className, new ui.dom.window.DOMParser().parseFromString(original, 'text/html').body.firstElementChild.className);
      ui.flags[flag] = false;
      await ui.rerender();
      assert.equal(footer().outerHTML, original);
      for (const node of footer().children) await click(node);
      assert.equal(ui.values.get('showCommandsAtom').paletteTab, 'compose');
      assert.equal(ui.values.get('showCommandsAtom').show, true);
      assert.equal(ui.requests.length, 0);
      assert.equal(document.getElementById('input-addTask'), null);
    });
  });
}

test('Send click and Enter call the same existing send, preserving empty-input and busy guards', async (t) => {
  await withPalette(t, config, async (ui) => {
    await enable(ui);
    assert.equal(button('Send').disabled, true);
    await click(button('Send'));
    assert.equal(ui.requests.length, 0);
    await ui.type('Keep the existing send');
    await click(button('Send'));
    assert.equal(ui.requests.length, 1);
    const clicked = ui.requests[0].body;
    assert.equal(clicked.viewProject, ui.values.get('currentProjectAtom'));
    for (const name of ['Send', 'Attach files', 'Board', 'Close']) assert.equal(button(name).disabled, true);
    assert.equal(button('Search').disabled, false, 'Search stays available while writing, like Ctrl+K');
    await click(button('Close'));
    assert.equal(ui.values.get('showCommandsAtom').show, true);
    assert.equal(ui.values.get('showCommandsAtom').paletteTab, 'compose');
    await ui.fail();
    await ui.press('Enter', { code: 'Enter' }, ui.input());
    assert.equal(typeof ui.requests[1].body.onProgress, 'function');
    assert.equal(typeof clicked.onProgress, 'function');
    assert.deepEqual({ ...ui.requests[1].body, onProgress: undefined }, { ...clicked, onProgress: undefined });
    await ui.fail();
  });
});

test('pressing a footer button with the mouse keeps the caret in the textbox', async (t) => {
  await withPalette(t, config, async (ui) => {
    await enable(ui);
    await ui.type('Keep typing');
    for (const name of ['Send', 'Attach files', 'Search', 'Board', 'Close']) {
      const press = new ui.dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
      button(name).dispatchEvent(press);
      assert.equal(press.defaultPrevented, true, `${name} does not take focus from the textbox`);
    }
  });
});

for (const apple of [false, true]) {
  test(`Attach files click opens the existing file chooser just like ${apple ? 'Cmd' : 'Ctrl'}+U`, async (t) => {
    await withPalette(t, { ...config, apple }, async (ui) => {
      await enable(ui);
      const fileInput = writer().querySelector('input[type="file"]');
      let picks = 0;
      fileInput.addEventListener('click', () => picks++);
      await click(button('Attach files'));
      assert.equal(picks, 1);
      const event = await ui.press('u', apple ? { metaKey: true } : { ctrlKey: true }, ui.input());
      assert.equal(event.defaultPrevented, true);
      assert.equal(picks, 2);
      assert.equal(fileInput.accept, '');
    });
  });
}

test('Search click uses the existing mode switch, keeps the draft and destination, and Ctrl+K still works', async (t) => {
  await withPalette(t, { ...config, destinationProject: config.boards[1] }, async (ui) => {
    await enable(ui);
    await ui.type('Keep my draft');
    await click(button('Search'));
    assert.equal(ui.values.get('showCommandsAtom').paletteTab, 'search');
    assert.equal(ui.values.get('showCommandsAtom').composeProject, config.boards[1]);
    assert.equal(writer().hidden, true);
    assert.ok(document.querySelector('[data-search-commands]'));
    await ui.press('j', { ctrlKey: true }, document.body);
    assert.equal(ui.input().value, 'Keep my draft');
    await ui.press('k', { ctrlKey: true }, ui.input());
    assert.equal(ui.values.get('showCommandsAtom').paletteTab, 'search');
    await ui.press('j', { ctrlKey: true }, document.body);
    await click(button('Send'));
    assert.equal(ui.requests[0].body.project.id, 8);
    assert.equal(ui.requests[0].body.viewProject, undefined);
    await ui.fail();
  });
});

for (const apple of [false, true]) {
  test(`Board click and ${apple ? 'Cmd' : 'Ctrl'}+Shift+B open the same shared searchable picker, keeping the caret and selected target`, async (t) => {
    await withPalette(t, { ...config, apple }, async (ui) => {
      await enable(ui);
      await ui.type('Keep this draft and caret');
      ui.input().setSelectionRange(5, 9, 'backward');
      const event = await ui.press('B', { code: 'KeyB', shiftKey: true, ...(apple ? { metaKey: true } : { ctrlKey: true }) }, ui.input());
      assert.equal(event.defaultPrevented, true);
      const picker = () => document.getElementById('input-addTask');
      assert.ok(picker());
      assert.ok(document.getElementById('command-0'));
      const shortcutMarkup = picker().closest('[data-shell]').outerHTML;
      await ui.press('Escape', { code: 'Escape' });
      assert.equal(picker(), null);
      assert.equal(ui.values.get('showCommandsAtom').show, true);
      await click(button('Board'));
      assert.ok(picker());
      assert.equal(picker().closest('[data-shell]').outerHTML, shortcutMarkup);
      assert.equal(document.activeElement, picker());
      await ui.press('ArrowDown', { code: 'ArrowDown' });
      await ui.press('Enter', { code: 'Enter' });
      assert.equal(picker(), null);
      assert.equal(ui.input().value, 'Keep this draft and caret');
      assert.equal(document.activeElement, ui.input());
      assert.deepEqual([ui.input().selectionStart, ui.input().selectionEnd, ui.input().selectionDirection], [5, 9, 'backward']);
      await click(button('Send'));
      assert.equal(ui.requests[0].body.project.id, 8);
      assert.equal(ui.requests[0].body.viewProject, undefined);
      await ui.fail();
    });
  });
}

test('Close click and Escape use the existing close action', async (t) => {
  for (const mouse of [false, true]) {
    await withPalette(t, config, async (ui) => {
      await enable(ui);
      if (mouse) await click(button('Close'));
      else await ui.press('Escape', { code: 'Escape' }, ui.input());
      assert.equal(ui.values.get('showCommandsAtom').show, false);
      assert.equal(writer(), null);
      assert.equal(ui.requests.length, 0);
    });
  }
});

test('Board label remains absent when its existing flag is off; the phone sheet still has no footer', async (t) => {
  await withPalette(t, { ...config, boardChip: false }, async (ui) => {
    await enable(ui);
    assert.equal(button('Board'), null);
    assert.equal(footer().querySelectorAll('button').length, 4);
  });
  await withPalette(t, { ...config, mobile: true }, async (ui) => {
    ui.flags['htpr-6891-phone-task-writer-sheet'] = true;
    await ui.rerender();
    const original = writer().outerHTML;
    await enable(ui);
    assert.equal(footer(), undefined);
    assert.equal(writer().outerHTML, original);
  });
});
