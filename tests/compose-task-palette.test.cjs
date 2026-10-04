const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const React = require('react');
const { JSDOM } = require('jsdom');
const { createJiti } = require('jiti');
const root = path.resolve(__dirname, '..');
const flag = 'htpr-6929-compose-task-writer';

async function withPalette(t, config, check) {
  const dom = new JSDOM('<div id="root"></div>', { url: `https://example.test${config.url ?? '/project?id=7'}` });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT', 'File', 'requestAnimationFrame', 'fetch']
    .map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, File: dom.window.File, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (fn) => fn() });
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  let focusFailures = config.focusFailures ?? 0;
  const focus = dom.window.HTMLElement.prototype.focus;
  dom.window.HTMLElement.prototype.focus = function (...args) {
    if (this.tagName === 'TEXTAREA' && focusFailures-- > 0) return;
    return focus.apply(this, args);
  };
  const cached = new Map(Object.entries(require.cache));
  const stub = (filename, exports) => { require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
  const source = (file, exports) => stub(path.join(root, file), exports);
  const flags = { [flag]: config.enabled ?? true };
  const atomNames = ['boardLayoutAtom', 'calendarSettingsAtom', 'currentProjectAtom', 'currentUserAtom', 'frequentlyUsedHTCAton', 'tableTitleWrapAtom', 'showCommandsAtom', 'lastUsedBoardsAtom', 'composeTaskChatIntroAtom', 'showAIChatInterfaceAtom', 'isAiChatSidebarModeAtom', 'aiChatAutoOpenSuppressedAtom', 'aiChatExplicitOpenAtAtom', 'dockedChatScopeAtom', 'showCreateTaskModalAtom', 'showShortcutsAtom', 'showSidebarAtom', 'showBoardManagerAtom'];
  const atoms = Object.fromEntries(atomNames.map((name) => [name, name]));
  const project = { id: 7, title: 'QA Sandbox', uniqueIdentifier: 'QASA' };
  const values = new Map(Object.entries({
    currentProjectAtom: config.project ?? project, currentUserAtom: { id: 985, uid: 'qa' },
    boardLayoutAtom: 'board', calendarSettingsAtom: {}, frequentlyUsedHTCAton: {}, lastUsedBoardsAtom: config.recency ?? {},
    showCommandsAtom: { show: config.open ?? true, mode: 0, paletteTab: config.tab ?? 'search' }, composeTaskChatIntroAtom: null,
  }));
  const listeners = new Set();
  const set = (atom, next) => { values.set(atom, typeof next === 'function' ? next(values.get(atom)) : next); listeners.forEach((fn) => fn()); };
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const useValue = (atom) => React.useSyncExternalStore(subscribe, () => values.get(atom));
  const setters = new Map(atomNames.map((name) => [name, (next) => set(name, next)]));
  const state = { useRecoilValue: useValue, useRecoilState: (atom) => [useValue(atom), setters.get(atom)], useSetRecoilState: (atom) => setters.get(atom) };
  const requests = [], navigations = [], cacheAdds = [], viewedTasks = [], loadedBoards = [];
  let legacyJ = 0, reactRoot;
  const legacy = (e) => { if (e.ctrlKey && e.code === 'KeyJ' && !e.shiftKey) legacyJ++; };
  const resetShowCommands = () => set('showCommandsAtom', { show: false, mode: 0 });
  const toggleShowCommands = () => set('showCommandsAtom', (prev) => ({ show: !prev.show, mode: 0 }));
  const shells = [];
  try {
    source('src/utils/undoActions/helperFuncs.ts', { cn: (...args) => require('tailwind-merge').twMerge(require('clsx').clsx(args)) });
    source('src/store/index.ts', atoms);
    source('src/store/currentPageActions.ts', { currentPageActionsAtom: 'currentPageActionsAtom' });
    source('src/lib/state.tsx', state);
    source('src/hooks/useFlag.tsx', { useFlag: (key) => flags[key] ?? false });
    source('src/lib/contexts/deviceContext.tsx', { useDeviceContext: () => config.apple ?? false });
    source('src/lib/contexts/mobileContext.tsx', { MobileViewContext: React.createContext(config.mobile ?? false) });
    source('src/hooks/RecoilRoot/useHypertasksRecoilStates.ts', { default: () => ({ resetShowCommands, toggleShowCommands }) });
    source('src/lib/contexts/TourContext.tsx', { useTourContext: () => ({ endTour() {} }) });
    source('src/components/PageComponents/Interactive-Onboarding/Components/TutorialTip.tsx', { default: () => null });
    source('src/hooks/MultiPages/useGetAllProjectsMinimal.ts', { useGetAllProjectsMinimal: () => ({ data: [] }) });
    source('src/utils/helperFunctions/Views/ViewsHelperFunctions.ts', { getActiveEmptySectionSettingFromProject: () => '', getActiveStalenessFromProject: () => false });
    source('src/styles/linksModal.module.scss', { default: { links_modal: 'links_modal' } });
    source('src/components/Common/Tooltip.tsx', { default: () => null });
    source('src/hooks/MultiPages/useClickOutside.ts', { default: () => {} });
    source('src/lib/constants/index.ts', { default: {} });
    source('src/utils/helperFunctions/helperFunctions.ts', { processFiles: config.processImages ?? (async (files, start) => [...files].map((file, id) => ({ id: start + id, file }))) });
    source('src/utils/api/global/index.ts', { default: { getAllProjectsMinimal: async () => { loadedBoards.push(true); return config.boards ?? [project, { ...project, id: 8 }]; } } });
    source('src/hooks/MultiPages/useAddDeleteTaskInBoards.tsx', { default: () => ({ createTaskGlobally: (body) => cacheAdds.push(body) }) });
    source('src/hooks/General/useProjectQuery.ts', { useProjectQuery: () => ({ updateActiveItemAndItemInView: (task) => viewedTasks.push(task) }) });
    const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } });
    // Exercise the real greeting/board resolution, but defer the network workflow
    // (covered independently in compose-task-writer.test.cjs) to inspect UI state.
    source('src/lib/deriveCurrentBoardBilling.ts', { deriveCurrentBoardBilling: () => null });
    source('src/lib/createTaskAttachmentUploads.ts', { discardUnboundCreateTaskUploads() {} });
    source('src/utils/api/global/apiHelpers/createTaskGloballycontroller.ts', {});
    const compose = jiti(path.join(root, 'src/lib/ai/composeTask.ts'));
    source('src/lib/ai/composeTask.ts', { ...compose, createComposedTask: (body) => new Promise((resolve, reject) => requests.push({ body, resolve, reject })) });
    source('src/components/Common/AttachmentsUpload/ImageGalleryView.tsx', { default: ({ files, handleRemove }) => React.createElement('div', { 'data-thumbnails': true }, files.map(({ file }) => React.createElement('button', { key: file.name, onClick: () => handleRemove(file.name), 'aria-label': `Remove ${file.name}` }, file.name))) });
    const commands = [{ group: 'Board', commandLists: [{ key: 'createTaskWithAiWriter', name: 'AI Task Writer', commandMode: 135 }] }];
    const enums = jiti(path.join(root, 'src/models/enums.ts'));
    commands[0].commandLists[0].commandMode = enums.CommandMode.CreateTaskWithAiWriter;
    if (config.dismissCommand) commands[0].commandLists.push({ key: 'toggleTableTitleWrap', name: 'Wrap task titles', commandMode: 1 });
    source('src/components/Modals/commands/HTC/AllCommands.ts', { getAllCommands: () => commands.map((group) => ({ ...group, commandLists: [...group.commandLists] })), getBoardMenuCommands: (items) => items, getMobileCommandGroups: (items) => items });
    source('src/hooks/MultiPages/HTC/useHTC.tsx', { default: (all) => {
      const [keyword, setKeyword] = React.useState('');
      return { keyword, onKeyChange: (e) => setKeyword(e.target.value), selectedCommand: all[0]?.commandLists[0], filterCommands: all,
        hoveredGroup: 0, setHoveredGroupIndex() {}, setCurrentCommandIndex() {}, setSelectedCommand() {}, handleCommandSelect() {} };
    } });
    source('src/components/Modals/commands/HTC/CommandGroup.tsx', { default: ({ filterCommands, onClickHandler }) => React.createElement('div', { 'data-search-commands': true }, filterCommands.flatMap((group) => group.commandLists.map((command) => React.createElement('button', { key: `${group.group}-${command.key}`, onClick: () => onClickHandler(command) }, command.name)))) });
    stub(require.resolve('next/navigation'), { useRouter: () => ({ push: (url) => navigations.push(url) }), usePathname: () => dom.window.location.pathname });
    stub(require.resolve('nookies'), { parseCookies: () => ({ previousBoard: config.previousBoard }) });
    const shell = ({ children, ...props }) => {
      shells.push(props);
      return React.createElement('section', { 'data-shell': true, className: props.contentClassName }, props.aboveSlot, children, props.bottomSlot);
    };
    // Keep the real common input/footer and replace only the portal shell.
    const common = jiti(path.join(root, 'src/components/Common/CommonModalComponents/index.tsx'));
    source('src/components/Common/CommonModalComponents/index.tsx', { ...common, ModalContainerCustom: shell });
    source('src/components/Modals/Sheets/index.ts', { MobileBottomSheet: shell });
    const { useCommandCenterShortcut } = jiti(path.join(root, 'src/hooks/General/useCommandCenterShortcut.ts'));
    let Palette = jiti(path.join(root, 'src/components/Modals/commands/HTC/commands.tsx')).default;
    let Probe = () => null;
    function Harness() {
      const shown = useValue('showCommandsAtom');
      useCommandCenterShortcut(Object.hasOwn(config, 'userId') ? config.userId : 985, config.apple ?? false, dom.window.location.pathname, config.trial ?? false, false, toggleShowCommands);
      return React.createElement(React.Fragment, null,
        shown.show ? React.createElement(Palette, { isOpen: true }) : null,
        React.createElement(Probe));
    }
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'));
    await React.act(async () => reactRoot.render(React.createElement(config.strict ? React.StrictMode : React.Fragment, null, React.createElement(Harness))));
    document.addEventListener('keydown', legacy);
    const press = async (key, extra = {}, target = document.activeElement) => {
      const event = new dom.window.KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true, ...extra });
      await React.act(async () => target.dispatchEvent(event));
      return event;
    };
    const input = () => document.querySelector('textarea');
    const type = async (value) => React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input(), value);
      input().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    const clickTab = async (label) => React.act(async () => [...document.querySelectorAll('[role="tab"]')].find((button) => button.textContent === label).click());
    const finish = async (writerFailed = false) => React.act(async () => requests.at(-1).resolve({ writerFailed, task: { id: 91, projectId: requests.at(-1).body.project.id, sectionId: 12, uniqueIndex: 44, ticketNumber: 'QASA-44' } }));
    const fail = async () => React.act(async () => requests.at(-1).reject(new Error('Couldn’t create the task. Your note is still here — try again.')));
    const rerender = async () => React.act(async () => reactRoot.render(React.createElement(config.strict ? React.StrictMode : React.Fragment, null, React.createElement(Harness))));
    const mountProbe = async (component) => { Probe = component; await rerender(); };
    const capture = (name) => { if (process.env.COMPOSE_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.COMPOSE_EVIDENCE_DIR, `${name}.html`), document.getElementById('root').innerHTML); };
    const baseline = async (directory) => {
      const current = document.getElementById('root').innerHTML;
      await React.act(async () => reactRoot.unmount());
      // Relative imports in the archived palette need the same controlled
      // dependencies as the current palette, not the archive's real app shell.
      for (const [filename, module] of Object.entries(require.cache)) {
        if (filename.startsWith(`${root}/src/`) && !cached.has(filename)) {
          stub(path.join(directory, path.relative(root, filename)), module.exports);
        }
      }
      const filename = path.join(directory, 'src/components/Modals/commands/HTC/commands.tsx');
      delete require.cache[filename];
      Palette = jiti(filename).default;
      reactRoot = require('react-dom/client').createRoot(document.getElementById('root'));
      await React.act(async () => reactRoot.render(React.createElement(config.strict ? React.StrictMode : React.Fragment, null, React.createElement(Harness))));
      assert.equal(document.getElementById('root').innerHTML, current);
    };
    await check({ dom, input, type, press, clickTab, finish, fail, rerender, flags, values, set, requests, navigations, cacheAdds, viewedTasks, loadedBoards, shells, capture, baseline, source, stub, jiti, mountProbe, legacyJ: () => legacyJ });
  } finally {
    document.removeEventListener('keydown', legacy);
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    for (const key of Object.keys(require.cache)) if (!cached.has(key)) delete require.cache[key];
    for (const [key, value] of cached) require.cache[key] = value;
    for (const [key, descriptor] of globals) descriptor ? Object.defineProperty(global, key, descriptor) : delete global[key];
    dom.window.close();
  }
}

test('flag off leaves desktop and phone palettes unchanged and Ctrl+J belongs to its legacy handler', async (t) => {
  for (const mobile of [false, true]) {
    await withPalette(t, { enabled: false, mobile }, async ({ press, legacyJ, values, capture, baseline }) => {
      assert.equal(document.querySelector('[role="tablist"]'), null);
      assert.equal(document.querySelector('[data-compose-task-writer]'), null);
      assert.ok(document.querySelector('[data-search-commands]'));
      const event = await press('j', { ctrlKey: true });
      assert.equal(event.defaultPrevented, false);
      assert.equal(legacyJ(), 1);
      assert.equal(values.get('showCommandsAtom').show, true);
      capture(`off-${mobile ? 'phone' : 'desktop'}`);
      if (process.env.COMPOSE_BASELINE_DIR) await baseline(process.env.COMPOSE_BASELINE_DIR);
      await press('k', { ctrlKey: true });
      assert.equal(values.get('showCommandsAtom').show, false, 'legacy Ctrl+K still toggles closed');
    });
  }
});

test('Ctrl+J globally opens Compose from every signed-in surface and prevents browser/legacy task creation', async (t) => {
  for (const url of ['/project?id=7', '/settings/profile', '/search', '/inbox', '/detail/project-7/4', '/chat', '/new']) {
    await withPalette(t, { open: false, url }, async ({ press, input, values, legacyJ }) => {
      const event = await press('j', { ctrlKey: true }, document.body);
      assert.equal(event.defaultPrevented, true);
      assert.equal(legacyJ(), 0);
      assert.equal(values.get('showCommandsAtom').paletteTab, 'compose');
      assert.equal(input().placeholder, 'Describe the task');
      assert.equal(document.activeElement, input());
    });
  }
});

test('Cmd+J on Apple works; shift, alt, IME and signed-out/public paths do not claim a new shortcut', async (t) => {
  await withPalette(t, { apple: true, open: false }, async ({ press, input }) => {
    await press('j', { metaKey: true }, document.body);
    assert.ok(input());
  });
  for (const config of [{ open: false, url: '/login' }, { open: false, userId: null }, { open: false, trial: true }]) {
    await withPalette(t, config, async ({ press, input }) => {
      const event = await press('j', { ctrlKey: true }, document.body);
      assert.equal(event.defaultPrevented, false);
      assert.equal(input(), null);
    });
  }
  await withPalette(t, { open: false }, async ({ press, input }) => {
    for (const extra of [{ shiftKey: true }, { altKey: true }, { isComposing: true }]) {
      const event = await press('j', { ctrlKey: true, ...extra }, document.body);
      assert.equal(event.defaultPrevented, false);
      assert.equal(input(), null);
    }
  });
});

test('switch and Ctrl+K/Ctrl+J toggle modes inside the palette without losing the note', async (t) => {
  await withPalette(t, {}, async ({ clickTab, input, type, press, values, capture }) => {
    assert.equal(document.querySelector('[role="tab"][aria-selected="true"]').textContent, 'Search');
    await clickTab('Compose');
    await type('Keep this draft\nand its new line');
    capture('compose-typed-desktop');
    await press('k', { ctrlKey: true });
    assert.equal(values.get('showCommandsAtom').paletteTab, 'search');
    assert.ok(document.querySelector('input[type="search"]'));
    await clickTab('Compose');
    assert.equal(input().value, 'Keep this draft\nand its new line');
    await clickTab('Search');
    await press('j', { ctrlKey: true });
    assert.equal(input().value, 'Keep this draft\nand its new line');
    const esc = await press('Escape');
    assert.equal(esc.defaultPrevented, true);
    assert.equal(values.get('showCommandsAtom').show, false);
  });
});

test('pending creation blocks tab clicks and dismissing Search commands without losing the retry draft', async (t) => {
  await withPalette(t, { tab: 'compose', dismissCommand: true }, async ({ type, press, clickTab, fail, input, values }) => {
    await type('Keep this retry draft');
    await press('Enter', { code: 'Enter' });
    assert.ok([...document.querySelectorAll('[role="tab"]')].every((tab) => tab.disabled));
    await clickTab('Search');
    assert.equal(values.get('showCommandsAtom').paletteTab, 'compose');
    await press('k', { ctrlKey: true }, document.body);
    assert.equal(values.get('showCommandsAtom').paletteTab, 'search');
    const command = [...document.querySelectorAll('[data-search-commands] button')].find((button) => button.textContent === 'Wrap task titles');
    await React.act(async () => command.click());
    assert.equal(values.get('showCommandsAtom').show, true);
    await fail();
    await clickTab('Compose');
    assert.equal(input().value, 'Keep this retry draft');
    assert.match(document.body.textContent, /Couldn’t create the task/);
    await clickTab('Search');
    const resumedCommand = [...document.querySelectorAll('[data-search-commands] button')].find((button) => button.textContent === 'Wrap task titles');
    await React.act(async () => resumedCommand.click());
    assert.equal(values.get('showCommandsAtom').show, false, 'commands resume once creation settles');
  });
});

test('Enter sends the current board and opens its detail with regular task-scoped chat and exact no-model greeting', async (t) => {
  await withPalette(t, { tab: 'compose' }, async ({ type, press, requests, finish, navigations, values, cacheAdds, viewedTasks, capture }) => {
    await type('Fix login button spacing');
    await press('Enter', { code: 'Enter' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.project.id, 7);
    assert.equal(requests[0].body.userId, 985);
    assert.equal(requests[0].body.text, 'Fix login button spacing');
    assert.match(document.body.textContent, /Writing your ticket…/);
    assert.ok(document.querySelector('.animate-spin'));
    capture('writing-desktop');
    await press('Enter', { code: 'Enter' }, document.body);
    await press('Escape', { code: 'Escape' }, document.body);
    assert.equal(requests.length, 1);
    assert.equal(values.get('showCommandsAtom').show, true, 'do not discard a create in flight');
    await finish();
    assert.deepEqual(navigations, ['/detail/project-7/44']);
    assert.equal(values.get('showAIChatInterfaceAtom'), true);
    assert.equal(values.get('isAiChatSidebarModeAtom'), true);
    assert.equal(values.get('aiChatAutoOpenSuppressedAtom'), false);
    assert.equal(values.get('dockedChatScopeAtom'), 7);
    assert.equal(values.get('composeTaskChatIntroAtom').taskId, 91);
    assert.equal(values.get('composeTaskChatIntroAtom').content, 'I created QASA-44 from your note. Want me to refine it? I can tighten the title, add acceptance criteria or split it into sub-tasks.');
    assert.equal(cacheAdds[0].sectionId, 12);
    assert.equal(viewedTasks[0].id, 91);
    assert.equal(values.get('showCommandsAtom').show, false);
  });
});

test('non-board page uses previousBoard instead of stale currentProject and reports raw fallback in chat', async (t) => {
  await withPalette(t, { url: '/settings', previousBoard: 'project-8|&|view', tab: 'compose' }, async ({ type, press, requests, finish, navigations, values, loadedBoards }) => {
    await type('Raw note');
    await press('Enter', { code: 'Enter' });
    assert.equal(requests[0].body.project.id, 8);
    assert.equal(loadedBoards.length, 1);
    await finish(true);
    assert.deepEqual(navigations, ['/detail/project-8/44']);
    assert.match(values.get('composeTaskChatIntroAtom').content, /original text as the title and description/);
  });
});

test('create failure keeps the palette open, text unchanged and retry available', async (t) => {
  await withPalette(t, { tab: 'compose' }, async ({ type, press, fail, input, requests, values, navigations, capture }) => {
    await type('  Preserve <every> character\nand line  ');
    await press('Enter', { code: 'Enter' });
    await fail();
    assert.equal(input().value, '  Preserve <every> character\nand line  ');
    assert.equal(values.get('showCommandsAtom').show, true);
    assert.equal(values.get('composeTaskChatIntroAtom'), null);
    assert.equal(navigations.length, 0);
    assert.match(document.querySelector('[role="alert"]').textContent, /Your note is still here/);
    capture('create-failure-desktop');
    await press('Enter', { code: 'Enter' });
    assert.equal(requests.length, 2);
    await fail();
  });
});

test('Shift+Enter/IME Enter retain native multiline editing; blank input cannot send', async (t) => {
  await withPalette(t, { tab: 'compose' }, async ({ type, press, requests }) => {
    await press('Enter', { code: 'Enter' });
    assert.equal(requests.length, 0);
    await type('First line');
    assert.equal((await press('Enter', { code: 'Enter', shiftKey: true })).defaultPrevented, false);
    assert.equal((await press('Enter', { code: 'Enter', isComposing: true })).defaultPrevented, false);
    assert.equal(requests.length, 0);
  });
});

test('phone Commands entry has the same switch, composer and existing keyboard-aware sheet', async (t) => {
  await withPalette(t, { mobile: true }, async ({ clickTab, input, type, requests, finish, shells, navigations, capture }) => {
    assert.equal(shells.at(-1).fullHeight, true);
    assert.equal(shells.at(-1).keyboardAware, true);
    await clickTab('Compose');
    assert.equal(shells.at(-1).fullHeight, false);
    assert.equal(shells.at(-1).bottomSlot, undefined);
    assert.ok(shells.at(-1).aboveSlot);
    assert.match(document.querySelector('[aria-label="Send message"]').className, /h-11 w-11.*bg-shadcn-primary/);
    await type('Fix on phone');
    capture('compose-phone');
    await React.act(async () => document.querySelector('[aria-label="Send message"]').click());
    assert.equal(requests[0].body.text, 'Fix on phone');
    await finish();
    assert.deepEqual(navigations, ['/detail/project-7/44']);
    assert.equal(input(), null);
  });
});

test('paperclip/Ctrl+U/paste attach images with thumbnails, keep files on create failure and remove them', async (t) => {
  await withPalette(t, { tab: 'compose' }, async ({ dom, input, type, press, requests, fail, finish }) => {
    const fileInput = document.querySelector('input[type="file"]');
    assert.equal(fileInput.accept, 'image/*');
    let picks = 0;
    fileInput.addEventListener('click', () => picks++);
    await React.act(async () => document.querySelector('[aria-label="Attach files"]').click());
    const shortcut = await press('u', { ctrlKey: true }, document.body);
    assert.equal(shortcut.defaultPrevented, true);
    assert.equal(picks, 2);
    const first = new dom.window.File(['png'], 'screen.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [first] });
    await React.act(async () => fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    assert.ok(document.querySelector('[aria-label="Remove screen.png"]'));
    const second = new dom.window.File(['png'], 'pasted.png', { type: 'image/png' });
    const paste = new dom.window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => second }] } });
    await React.act(async () => input().dispatchEvent(paste));
    assert.equal(paste.defaultPrevented, true);
    assert.ok(document.querySelector('[aria-label="Remove pasted.png"]'));
    await type('Match my screenshots');
    await press('Enter', { code: 'Enter' });
    assert.deepEqual(requests[0].body.files, [first, second]);
    await fail();
    assert.ok(document.querySelector('[aria-label="Remove screen.png"]'));
    await React.act(async () => document.querySelector('[aria-label="Remove screen.png"]').click());
    await press('Enter', { code: 'Enter' });
    assert.deepEqual(requests[1].body.files, [second]);
    await finish();
  });
});

test('real task chat hook persists the Compose greeting once, scoped to the created task, without a model turn', async (t) => {
  for (const scenario of [
    { name: 'new task session', existing: false },
    { name: 'existing task session in StrictMode', existing: true },
    { name: 'wrong task', existing: true, taskId: 92, blocked: true },
    { name: 'global chat', existing: true, scoped: false, blocked: true },
    { name: 'flag off', existing: true, enabled: false, blocked: true },
  ]) {
    await withPalette(t, { tab: 'compose', strict: true }, async ({ type, press, finish, values, flags, source, stub, jiti, mountProbe, rerender, set, capture }) => {
      await type('Fix login button spacing');
      await press('Enter', { code: 'Enter' });
      await finish();
      const intro = values.get('composeTaskChatIntroAtom');
      const otherSession = { id: 'other-session', taskId: 92, messages: [] };
      const taskSession = { id: 'created-task-session', taskId: 91, messages: [] };
      let data = { data: { success: true, sessions: scenario.existing ? [taskSession, otherSession] : [otherSession] } };
      const subscribers = new Set();
      const queryClient = { setQueryData(_key, updater) {
        data = updater(data);
        subscribers.forEach((fn) => fn());
      } };
      stub(require.resolve('@tanstack/react-query'), {
        useQueryClient: () => queryClient,
        useQuery: () => ({
          data: React.useSyncExternalStore((fn) => { subscribers.add(fn); return () => subscribers.delete(fn); }, () => data),
          isSuccess: true, isLoading: false, isFetching: false, isError: false,
        }),
      });
      const persisted = [], sessionsCreated = [], modelCalls = [];
      global.fetch = (...args) => { modelCalls.push(args); throw new Error('No model request is allowed for the greeting'); };
      source('src/utils/api/ai_chat/index.ts', { AI_Chat_API: {
        createSessionNext: async (taskId) => { sessionsCreated.push(taskId); return { data: { success: true, session: taskSession } }; },
        addMessage: async (sessionId, message) => { persisted.push({ sessionId, message }); return { data: { message } }; },
      } });
      flags[flag] = scenario.enabled ?? true;
      const { useSessionAndChatHistory } = jiti(path.join(root, 'src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts'));
      let chat;
      function ChatProbe() {
        chat = useSessionAndChatHistory(scenario.taskId ?? 91, true, scenario.scoped ?? true);
        return React.createElement('div', { 'data-chat-session': chat.currentSession?.id },
          chat.currentSession?.messages.map((message) => React.createElement('p', { key: message.id, 'data-role': message.role }, message.content)));
      }
      await mountProbe(() => React.createElement(React.StrictMode, null, React.createElement(ChatProbe)));
      await rerender();
      assert.equal(modelCalls.length, 0, scenario.name);
      assert.equal(persisted.length, scenario.blocked ? 0 : 1, scenario.name);
      if (scenario.blocked) {
        assert.deepEqual(values.get('composeTaskChatIntroAtom'), intro, scenario.name);
        assert.equal(otherSession.messages.length, 0);
      } else {
        assert.equal(persisted[0].sessionId, taskSession.id);
        assert.equal(persisted[0].message.role, 'assistant');
        assert.equal(persisted[0].message.isDelivered, true);
        assert.equal(persisted[0].message.content, intro.content);
        assert.equal(chat.currentSession.taskId, 91);
        assert.equal(chat.currentSession.messages.length, 1);
        assert.equal(chat.showWelcomeScreen, false);
        assert.equal(values.get('composeTaskChatIntroAtom'), null);
        assert.deepEqual(sessionsCreated, scenario.existing ? [] : [91]);
        capture(`task-chat-${scenario.existing ? 'existing' : 'new'}`);
        await React.act(async () => set('composeTaskChatIntroAtom', intro));
        assert.equal(persisted.length, 1, 're-delivering the same intro does not duplicate the stored message');
      }
    });
  }
});

test('phone Compose focuses after rejected entry-animation focus attempts', async (t) => {
  await withPalette(t, { mobile: true, tab: 'compose', focusFailures: 2 }, async ({ input }) => {
    assert.equal(document.activeElement, input());
  });
});

test('pending image preprocessing prevents Enter or send from dropping an attachment', async (t) => {
  let complete;
  await withPalette(t, { tab: 'compose', processImages: (files) => new Promise((resolve) => { complete = () => resolve(files.map((file, id) => ({ file, id }))); }) }, async ({ dom, type, press, requests, fail }) => {
    const file = new dom.window.File(['png'], 'processing.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]');
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    await React.act(async () => fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    await type('Keep the screenshot');
    await press('Enter', { code: 'Enter' });
    assert.equal(requests.length, 0);
    assert.equal(document.querySelector('[aria-label="Send message"]').disabled, true);
    await React.act(async () => complete());
    await press('Enter', { code: 'Enter' });
    assert.deepEqual(requests[0].body.files, [file]);
    await fail();
  });
});

test('actual phone sheet reserves visible space for Compose tabs only while the flag is on', async (t) => {
  await withPalette(t, { open: false }, async ({ source, jiti, mountProbe, flags, rerender }) => {
    source('src/hooks/General/useMobileVisualViewport.ts', { useMobileVisualViewport: () => ({ visibleHeight: 280, layoutHeight: 800, bottomInset: 500 }) });
    let sheet;
    source('src/components/Modals/Sheets/AppSheet.tsx', {
      AppSheet: (props) => { sheet = props; return React.createElement('div', null, props.aboveSlot, props.children); },
      SheetScroller: ({ children }) => React.createElement('div', null, children),
    });
    const { MobileBottomSheet } = jiti(path.join(root, 'src/components/Modals/Sheets/MobileBottomSheet.tsx'));
    await mountProbe(() => React.createElement(MobileBottomSheet, { keyboardAware: true, fullHeight: true, onClose() {}, aboveSlot: React.createElement('span', null, 'Search | Compose') }, 'Content'));
    assert.equal(sheet.containerStyle.maxHeight, '232px');
    assert.equal(sheet.containerStyle.bottom, 500);
    assert.ok(sheet.aboveSlot);
    assert.match(sheet.panelClassName, /!overflow-visible/);
    flags[flag] = false;
    await rerender();
    assert.equal(sheet.containerStyle.maxHeight, '280px');
    assert.equal(sheet.containerStyle.height, '280px');
    assert.equal(sheet.aboveSlot, undefined);
    assert.doesNotMatch(sheet.panelClassName, /!overflow-visible/);
  });
});
