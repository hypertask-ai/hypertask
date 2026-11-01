const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { loader, mount } = require('./helpers/htpr-7260-ui.cjs');
const root = path.resolve(__dirname, '..');
const flag = 'htpr-6891-phone-task-writer-sheet';
const { withPalette } = require('./helpers/compose-task-palette-fixture.cjs');

for (const mobile of [false, true]) {
  test(`phone writer flag preserves ${mobile ? 'legacy phone output and fills only compose when enabled' : 'desktop output byte-for-byte'}`, async (t) => {
    await withPalette(t, { mobile, newWindow: true, boardChip: true, tab: 'compose', url: '/inbox', previousBoard: 'project-7' }, async ({ flags, rerender, input, type, shells, dom, baseline }) => {
      const clickTab = async (label) => React.act(async () => [...document.querySelectorAll('[role="tab"]')].find((button) => button.textContent.startsWith(label)).click());
      const markup = () => document.getElementById('root').innerHTML;
      const writer = () => document.querySelector('[data-compose-task-writer]');
      const searchMarkup = () => {
        const search = document.getElementById('root').cloneNode(true);
        search.querySelector('[data-compose-task-writer]').remove();
        return search.innerHTML;
      };
      const original = markup();
      const searchOriginal = await (async () => {
        await clickTab('Search');
        const html = searchMarkup();
        await clickTab('New Task');
        return html;
      })();
      assert.equal(writer().className, mobile ? 'max-h-[65dvh] overflow-y-auto' : '');
      assert.ok(input().classList.contains('max-h-52'));
      assert.equal(input().style.height, '64px');
      assert.match(writer().textContent, /Enter Send/);
      flags[flag] = true;
      await rerender();
      if (!mobile) assert.equal(markup(), original);
      else {
        assert.equal(shells.at(-1).fullHeight, true);
        assert.equal(shells.at(-1).keyboardAware, true);
        assert.equal(shells.at(-1).contentClassName, 'flex flex-col overflow-hidden');
        assert.equal(writer().className, 'flex min-h-0 flex-1 flex-col');
        assert.equal(input().classList.contains('max-h-52'), false);
        assert.ok(input().classList.contains('flex-1'));
        assert.equal(input().style.height, '');
        assert.doesNotMatch(writer().textContent, /Enter Send|Attach files|Search|Esc Close|CTRL\+SHIFT\+B/);
        const box = input().parentElement;
        assert.equal(box.className, 'flex min-h-0 w-full flex-1 flex-col rounded-[5px] bg-ai-tiptap px-3 py-2');
        assert.equal(box.parentElement.className, 'flex min-h-0 flex-1 flex-col p-2');
        assert.ok(box.querySelector('[data-compose-board-chip]'));
        assert.ok(box.querySelector('button[aria-label="Start dictation"]'));
        assert.ok(box.lastElementChild.classList.contains('shrink-0'));
        const picker = writer().querySelector('input[type="file"]');
        Object.defineProperty(picker, 'files', { configurable: true, value: [new dom.window.File(['png'], 'image.png', { type: 'image/png' })] });
        await React.act(async () => picker.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
        const previews = writer().querySelector('[data-thumbnails]');
        assert.ok(previews);
        assert.equal(previews.parentElement.nextElementSibling, input());
        assert.equal(previews.parentElement.className, 'min-h-0 overflow-y-auto');
        await React.act(async () => previews.querySelector('button').click());
        await type('A draft\n'.repeat(80));
        assert.equal(input().style.height, '');
        await type('');
      }
      await clickTab('Search');
      assert.ok(writer().hidden, 'the flex writer must stay hidden on Search');
      assert.equal(writer().className, mobile ? 'max-h-[65dvh] overflow-y-auto' : '');
      assert.equal(searchMarkup(), searchOriginal, 'flag does not change the Search tab');
      await clickTab('New Task');
      flags[flag] = false;
      await rerender();
      assert.equal(markup(), original, 'switching the flag off restores exact legacy output');
      if (mobile) assert.equal(shells.at(-1).fullHeight, false);
      if (process.env.COMPOSE_BASELINE_DIR) await baseline(process.env.COMPOSE_BASELINE_DIR);
    });
  });
}

test('full-height MobileBottomSheet uses visible keyboard height and keeps its existing resting cap', () => {
  const ui = mount();
  let viewport = { layoutHeight: 844, visibleHeight: 420, bottomInset: 424 };
  let sheet;
  const load = loader({
    '@/hooks/General/useMobileVisualViewport': { useMobileVisualViewport: () => viewport },
    '@/hooks/useFlag': { useFlag: () => true },
    './AppSheet': {
      AppSheet: ({ children, ...props }) => { sheet = props; return React.createElement('div', null, children); },
      SheetScroller: ({ children }) => React.createElement('div', null, children),
    },
  });
  const { MobileBottomSheet } = load('src/components/Modals/Sheets/MobileBottomSheet.tsx');
  const render = (fullHeight) => ui.render(React.createElement(MobileBottomSheet, {
    fullHeight, keyboardAware: true, aboveSlot: React.createElement('div'), onClose() {},
  }));
  try {
    render(true);
    assert.equal(sheet.detent, 'default');
    assert.deepEqual(sheet.containerStyle, { bottom: 424, maxHeight: '372px', height: '372px' });
    render(false);
    assert.equal(sheet.detent, 'content');
    assert.deepEqual(sheet.containerStyle, { bottom: 424, maxHeight: '372px' });
    viewport = { layoutHeight: 844, visibleHeight: 844, bottomInset: 0 };
    render(true);
    assert.equal(sheet.containerStyle.height, `${844 * 0.82}px`);
    assert.equal(sheet.containerStyle.bottom, 0);
  } finally { ui.close(); }
});

test('phone writer flag registers exactly the requested feature metadata', () => {
  const load = loader();
  const definition = load(`src/lib/flags/definitions/${flag}.ts`);
  assert.equal(definition.HTPR_6891_PHONE_TASK_WRITER_SHEET_FLAG, flag);
  assert.equal(definition.default.key, flag);
  assert.equal(definition.default.kind, 'feature');
  assert.equal(definition.default.shippedOn, '2026-10-18');
  assert.equal(definition.default.releaseRisk.risk, 'new');
  assert.ok(definition.default.releaseRisk.reason);
  assert.equal(definition.default.defaultMode, undefined);
});
