const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const React = require('react');
const { JSDOM } = require('jsdom');
const { createJiti } = require('jiti');
const query = require('@tanstack/react-query');
const root = path.resolve(__dirname, '..');
const flag = 'htpr-6929-compose-task-writer';
const newFlag = 'htpr-6937-new-task-window';

async function withPalette(t, config, check) {
  const dom = new JSDOM('<div id="root"></div>', { url: `https://example.test${config.url ?? '/project?id=7'}` });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT', 'File', 'requestAnimationFrame', 'fetch', 'DOMParser']
    .map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  Object.assign(global, { DOMParser: dom.window.DOMParser, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, File: dom.window.File, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (fn) => fn() });
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
  const flags = { [flag]: config.enabled ?? true, [newFlag]: config.newWindow ?? false, 'htpr-6951-task-writing-progress': config.progress ?? config.newWindow ?? false };
  const TaskContext = React.createContext(undefined);
  const atomNames = ['boardLayoutAtom', 'calendarSettingsAtom', 'currentProjectAtom', 'currentUserAtom', 'frequentlyUsedHTCAton', 'tableTitleWrapAtom', 'showCommandsAtom', 'lastUsedBoardsAtom', 'composeTaskChatIntroAtom', 'showAIChatInterfaceAtom', 'isAiChatSidebarModeAtom', 'aiChatAutoOpenSuppressedAtom', 'aiChatExplicitOpenAtAtom', 'dockedChatScopeAtom', 'showCreateTaskModalAtom', 'showShortcutsAtom', 'showSidebarAtom', 'showBoardManagerAtom', 'inViewObjectAtom', 'uploadingStateCreateTaskModalAtom'];
  const atoms = Object.fromEntries(atomNames.map((name) => [name, name]));
  const project = { id: 7, title: 'QA Sandbox', uniqueIdentifier: 'QASA' };
  const values = new Map(Object.entries({
    inViewObjectAtom: config.inView ?? { taskId: null },
    currentProjectAtom: config.project ?? project, currentUserAtom: { id: 985, uid: 'qa' },
    boardLayoutAtom: 'board', calendarSettingsAtom: {}, frequentlyUsedHTCAton: {}, lastUsedBoardsAtom: config.recency ?? {},
    showCommandsAtom: { show: config.open ?? true, mode: 0, paletteTab: config.tab ?? 'search', composeProject: config.destinationProject }, composeTaskChatIntroAtom: null,
  }));
  const listeners = new Set();
  const set = (atom, next) => { values.set(atom, typeof next === 'function' ? next(values.get(atom)) : next); listeners.forEach((fn) => fn()); };
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const useValue = (atom) => React.useSyncExternalStore(subscribe, () => values.get(atom));
  const setters = new Map(atomNames.map((name) => [name, (next) => set(name, next)]));
  const state = { useRecoilValue: useValue, useRecoilState: (atom) => [useValue(atom), setters.get(atom)], useSetRecoilState: (atom) => setters.get(atom) };
  const requests = [], navigations = [], cacheAdds = [], cacheUpdates = [], viewedTasks = [], loadedBoards = [];
  const queryClient = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
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
    source('src/lib/contexts/TaskDetail/TaskProvider.tsx', { TaskContext, useTaskContext: () => React.useContext(TaskContext) });
    source('src/lib/contexts/deviceContext.tsx', { useDeviceContext: () => config.apple ?? false });
    source('src/lib/contexts/mobileContext.tsx', { MobileViewContext: React.createContext(config.mobile ?? false) });
    source('src/hooks/RecoilRoot/useHypertasksRecoilStates.ts', { default: () => ({ resetShowCommands, toggleShowCommands }) });
    source('src/lib/contexts/TourContext.tsx', { useTourContext: () => ({ endTour() {} }) });
    source('src/components/PageComponents/Interactive-Onboarding/Components/TutorialTip.tsx', { default: () => null });
    source('src/hooks/MultiPages/useGetAllProjectsMinimal.ts', { useGetAllProjectsMinimal: () => ({ data: [] }) });
    source('src/utils/helperFunctions/Views/ViewsHelperFunctions.ts', { getActiveEmptySectionSettingFromProject: () => '', getActiveStalenessFromProject: () => false });
    source('src/styles/linksModal.module.scss', { default: { links_modal: 'links_modal' } });
    if (!config.realTooltip) source('src/components/Common/Tooltip.tsx', { default: ({ text, keyCombination }) => React.createElement('span', { 'data-tooltip': text }, keyCombination.join('+')) });
    const axios = { get: async () => ({ data: config.targetTask }) };
    stub(require.resolve('axios'), { default: axios });
    source('src/components/RTE/Components/AudioButton.tsx', { default: config.AudioButton ?? ((props) => React.createElement('button', { 'aria-label': props.ariaLabel, onClick: () => props.callbackHandler(' spoken note') }, 'Mic')) });
    source('src/hooks/MultiPages/useClickOutside.ts', { default: () => {} });
    source('src/lib/constants/index.ts', { default: {} });
    source('src/utils/helperFunctions/helperFunctions.ts', { processFiles: config.processImages ?? (async (files, start) => [...files].map((file, id) => ({ id: start + id, file }))) });
    source('src/utils/api/global/index.ts', { default: { getAllProjectsMinimal: async () => { loadedBoards.push(true); return config.boards ?? [project, { ...project, id: 8 }]; } } });
    source('src/hooks/MultiPages/useAddDeleteTaskInBoards.tsx', { default: () => ({ createTaskGlobally: (body) => cacheAdds.push(body) }) });
    source('src/hooks/General/useProjectQuery.ts', { useProjectQuery: () => ({ updateActiveItemAndItemInView: (task) => viewedTasks.push(task) }) });
    source('src/hooks/MultiPages/useUpdateTaskInBoards.tsx', { default: () => ({ updateTaskInCache: (...args) => cacheUpdates.push(args) }) });
    const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'], jsx: { runtime: 'automatic' } });
    // Exercise the real greeting/board resolution, but defer the network workflow
    // (covered independently in compose-task-writer.test.cjs) to inspect UI state.
    source('src/lib/deriveCurrentBoardBilling.ts', { deriveCurrentBoardBilling: () => null });
    source('src/lib/createTaskAttachmentUploads.ts', { discardUnboundCreateTaskUploads() {} });
    source('src/utils/api/global/apiHelpers/createTaskGloballycontroller.ts', {});
    const compose = jiti(path.join(root, 'src/lib/ai/composeTask.ts'));
    source('src/lib/ai/composeTask.ts', { ...compose, createComposedTask: (body) => new Promise((resolve, reject) => requests.push({ body, resolve, reject })) });
    const Thumbnails = ({ files, handleRemove }) => React.createElement('div', { 'data-thumbnails': true }, files.map(({ file }) => React.createElement('button', { key: file.name, onClick: () => handleRemove(file.name), 'aria-label': `Remove ${file.name}` }, React.createElement('img', { alt: file.name }), file.name)));
    source('src/components/Common/AttachmentsUpload/ImageGalleryView.tsx', { default: config.previewLoad ? React.lazy(() => config.previewLoad.then(() => ({ default: Thumbnails }))) : Thumbnails });
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
    stub(require.resolve('next/navigation'), { useRouter: () => ({ push: (url) => {
      navigations.push(url);
      if (config.navigate) dom.window.history.pushState({}, '', url);
    } }), usePathname: () => dom.window.location.pathname });
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
    let headerState;
    function Harness() {
      const shown = useValue('showCommandsAtom');
      const [currentTask, setCurrentTask] = React.useState(config.headerTask);
      const [description, setDescription] = React.useState(config.headerTask?.description_?.content ?? '');
      const [editorState, setEditorState] = React.useState({ editMode: null, hasDraft: false, hasDraftInit: false });
      headerState = { parsedTask: JSON.stringify(config.headerTask ?? {}), currentTask, setCurrentTask, description, setDescription, ...editorState, setEditorState };
      useCommandCenterShortcut(Object.hasOwn(config, 'userId') ? config.userId : 985, config.apple ?? false, dom.window.location.pathname, config.trial ?? false, false, toggleShowCommands);
      return React.createElement(query.QueryClientProvider, { client: queryClient },
        React.createElement(TaskContext.Provider, { value: config.headerTask ? headerState : undefined },
          shown.show ? React.createElement(React.Suspense, { fallback: React.createElement('div', { 'data-palette-suspended': true }) }, React.createElement(Palette, { isOpen: true })) : null,
          React.createElement(Probe)));
    }
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'));
    await React.act(async () => reactRoot.render(React.createElement(config.strict ? React.StrictMode : React.Fragment, null, React.createElement(Harness))));
    document.addEventListener('keydown', legacy);
    const press = async (key, extra = {}, target = document.activeElement) => {
      const event = new dom.window.KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true, ...extra });
      await React.act(async () => target.dispatchEvent(event));
      return event;
    };
    const input = () => document.querySelector(config.headerTask ? '[data-compose-task-writer] textarea' : 'textarea');
    const type = async (value) => React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input(), value);
      input().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    const clickTab = async (label) => React.act(async () => [...document.querySelectorAll('[role="tab"]')].find((button) => button.textContent === label).click());
    const finish = async (writerFailed = false, task = { id: 91, projectId: requests.at(-1).body.project.id, sectionId: 12, uniqueIndex: 44, ticketNumber: 'QASA-44' }) => React.act(async () => requests.at(-1).resolve({ writerFailed, task }));
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
    await check({ dom, input, type, press, clickTab, finish, fail, rerender, flags, values, set, requests, navigations, cacheAdds, cacheUpdates, queryClient, viewedTasks, loadedBoards, shells, capture, baseline, source, stub, jiti, mountProbe, headerState: () => headerState, legacyJ: () => legacyJ });
  } finally {
    document.removeEventListener('keydown', legacy);
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    queryClient.clear();
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

test('late creation success or failure cannot override navigation after Compose unmounts', async (t) => {
  for (const succeeds of [false, true]) {
    await withPalette(t, { tab: 'compose', strict: true }, async ({ type, press, finish, fail, set, values, navigations, cacheAdds, viewedTasks }) => {
      await type('Create without stealing navigation');
      await press('Enter', { code: 'Enter' });
      await React.act(async () => set('showCommandsAtom', { show: false, mode: 0 }));
      if (succeeds) await finish();
      else await fail();
      assert.deepEqual(navigations, []);
      assert.deepEqual(cacheAdds, []);
      assert.deepEqual(viewedTasks, []);
      assert.equal(values.get('composeTaskChatIntroAtom'), null);
      assert.equal(values.get('showAIChatInterfaceAtom'), undefined);
    });
  }
});

test('turning the flag off during creation restores Search commands once creation settles', async (t) => {
  await withPalette(t, { tab: 'compose', dismissCommand: true }, async ({ type, press, flags, rerender, finish, values, navigations }) => {
    await type('Do not open this task after disabling Compose');
    await press('Enter', { code: 'Enter' });
    flags[flag] = false;
    await rerender();
    assert.equal(document.querySelector('[data-compose-task-writer]'), null);
    await finish();
    assert.deepEqual(navigations, []);
    const command = [...document.querySelectorAll('[data-search-commands] button')].find((button) => button.textContent === 'Wrap task titles');
    await React.act(async () => command.click());
    assert.equal(values.get('showCommandsAtom').show, false);
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

test('New Task label, purple sparkle, dictation, tooltips and Tab require both flags on desktop and phone', async (t) => {
  for (const enabled of [false, true]) for (const newWindow of [false, true]) for (const mobile of [false, true]) {
    await withPalette(t, { enabled, newWindow, mobile, apple: true }, async ({ press, clickTab, input, type, values }) => {
      const both = enabled && newWindow;
      assert.equal(Boolean(document.querySelector('[data-tooltip="Search"]')), both);
      if (!enabled) {
        assert.equal(document.querySelector('[role="tablist"]'), null);
        return;
      }
      const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => node.textContent.startsWith(both ? 'New Task' : 'Compose'));
      assert.ok(tab);
      if (both) {
        assert.ok(tab.querySelector('.lucide-sparkles'));
        assert.match(tab.className, /text-hypertasks-ai-purple/);
        assert.equal(document.querySelector('[data-tooltip="Search"]').textContent, 'CMD+K');
        assert.equal(document.querySelector('[data-tooltip="New Task"]').textContent, 'CMD+J');
        const search = document.querySelector('input[type="search"]');
        const switched = await press('Tab', {}, search);
        assert.equal(switched.defaultPrevented, true);
      } else await clickTab('Compose');
      assert.equal(Boolean(document.querySelector('[aria-label="Start dictation"]')), both);
      assert.equal(input().rows, mobile ? 3 : 2);
      assert.equal(input().className.includes("max-h-52"), both);
      await type('Typed');
      if (both) {
        await React.act(async () => document.querySelector('[aria-label="Start dictation"]').click());
        assert.equal(input().value, 'Typed spoken note');
        const otherControl = document.querySelector('[aria-label="Attach files"]');
        assert.equal((await press('Tab', {}, otherControl)).defaultPrevented, false);
        assert.equal(values.get('showCommandsAtom').paletteTab, 'compose');
        assert.equal((await press('Tab', { shiftKey: true }, input())).defaultPrevented, true);
        assert.equal(values.get('showCommandsAtom').paletteTab, 'search');
      } else {
        assert.equal((await press('Tab', {}, input())).defaultPrevented, false);
        assert.equal(values.get('showCommandsAtom').paletteTab, 'compose');
      }
    });
  }
});

test('Ctrl+J fills only the visible new empty task when both flags are on and never inserts a second cache task', async (t) => {
  for (const newWindow of [false, true]) for (const title of ['Enter task title here', 'Already written']) {
    const targetTask = { id: 52, projectId: 7, uniqueIndex: 4, title, description_: { content: '<p></p>' } };
    await withPalette(t, { newWindow, url: '/detail/project-7/4', open: false, inView: { taskId: 52 }, targetTask, previousBoard: 'project-8|&|view' }, async ({ press, type, requests, finish, cacheAdds, values }) => {
      await press('j', { ctrlKey: true }, document.body);
      await type('Write this task');
      await press('Enter');
      const fills = newWindow && title === 'Enter task title here';
      assert.equal(requests[0].body.existingTaskId, fills ? 52 : undefined);
      assert.equal(requests[0].body.project.id, fills ? 7 : 8);
      await finish();
      assert.equal(cacheAdds.length, fills ? 0 : 1);
      assert.equal(values.get('showAIChatInterfaceAtom'), true);
    });
  }
});

test('New Task tab tooltips appear on keyboard focus and Tab leaves unrelated tablists alone', async (t) => {
  await withPalette(t, { newWindow: true, realTooltip: true }, async ({ press, values, dom }) => {
    const tabs = [...document.querySelectorAll('[aria-label="Commands mode"] [role="tab"]')];
    for (const [tab, shortcut] of [[tabs[0], 'CTRL'], [tabs[1], 'CTRL']]) {
      await React.act(async () => tab.focus());
      const portal = document.body.querySelector('[class*="z-[9999]"].fixed');
      assert.ok(portal, 'the actual Tooltip portal opens on the focusable tab');
      assert.ok(portal.textContent.includes(tab.textContent));
      assert.ok(portal.textContent.includes(shortcut));
    }
    const otherTab = document.createElement('button');
    otherTab.setAttribute('role', 'tab');
    document.body.append(otherTab);
    assert.equal((await press('Tab', {}, otherTab)).defaultPrevented, false);
    assert.equal(values.get('showCommandsAtom').paletteTab, 'search');
    otherTab.remove();
    const event = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await React.act(async () => tabs[1].dispatchEvent(event));
    assert.equal(event.defaultPrevented, true);
    assert.equal(values.get('showCommandsAtom').paletteTab, 'compose');
  });
});

test('dictation stays mounted across Search switches and disabling New Task releases the input lock', async (t) => {
  let audioProps, mounts = 0, unmounts = 0;
  function AudioButton(props) {
    audioProps = props;
    React.useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return React.createElement('button', { 'aria-label': props.ariaLabel }, 'Mic');
  }
  await withPalette(t, { newWindow: true, tab: 'compose', AudioButton }, async ({ type, press, input, flags, rerender, requests }) => {
    await type('Keep my typed note');
    assert.equal(audioProps.mobilePrimaryTone, 'primary', 'dictation confirmation uses canonical primary tokens');
    await React.act(async () => audioProps.toggleRecording(true));
    assert.equal(input().disabled, true);
    await press('k', { ctrlKey: true }, document.body);
    assert.equal(audioProps.disabled, true, 'the hidden mic cannot intercept Search keys');
    await press('j', { ctrlKey: true }, document.body);
    assert.equal(mounts, 1);
    assert.equal(unmounts, 0, 'switching tabs must not discard the recording');
    await React.act(async () => { audioProps.toggleRecording(false); audioProps.callbackHandler('<p>Spoken text</p>', true); });
    assert.equal(input().value, 'Keep my typed note Spoken text');
    assert.equal(input().disabled, false);
    await React.act(async () => audioProps.toggleRecording(true));
    flags[newFlag] = false;
    await rerender();
    assert.equal(input().disabled, false, 'flag off restores editable legacy Compose');
    flags[newFlag] = true;
    await rerender();
    assert.equal(input().disabled, false, 're-enabling the flag must not resurrect stale recording state');
    await press('Enter');
    assert.equal(requests[0].body.text, 'Keep my typed note Spoken text');
  });
});

test('creation-form New Task handlers forward the selected board ahead of stale current board', () => {
  const ts = require('typescript');
  const file = ts.createSourceFile('form.tsx', fs.readFileSync(path.join(root, 'src/components/RTE/TiptapCreateTaskModal.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers = new Map();
  let closeForm;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'closeComposedTaskForm') closeForm = node.initializer.getText(file);
    if (ts.isVariableDeclaration(node) && ['toggleAiTaskWriter', 'toggleAiTaskWriterVisibility'].includes(node.name.getText(file))) handlers.set(node.name.getText(file), node.initializer.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(handlers.size, 2);
  const selected = { id: 8, title: 'Selected board' }, stale = { id: 7, title: 'URL board' };
  for (const handler of handlers.values()) {
    let command;
    const closes = [];
    const invoke = new Function('newTaskWindow', 'setCommands', 'CommandMode', 'formValues', '_currentProject', 'closeHandler', 'isMbl', `const closeComposedTaskForm = ${closeForm}; return (${handler});`)(true, (value) => { command = value; }, { Command: 0 }, { currentProject: selected }, stale, (saved) => closes.push(saved), false);
    invoke();
    assert.equal(command.composeProject, selected);
    assert.equal(command.paletteTab, 'compose');
    assert.deepEqual(closes, [], 'opening New Task leaves the form intact');
    command.composeOnCreated();
    assert.deepEqual(closes, [true], 'successful handoff closes without a discard prompt');
  }
});

test('creation-form New Task handoff preserves board and dismissal, and closes only after flagged success on desktop and phone', async (t) => {
  const ts = require('typescript');
  const file = ts.createSourceFile('form.tsx', fs.readFileSync(path.join(root, 'src/components/RTE/TiptapCreateTaskModal.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect, closeForm;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'closeComposedTaskForm') closeForm = node.initializer.getText(file);
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect' && node.arguments[0].getText(file).includes('const openNewTask')) effect = node.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(effect);
  const javascript = ts.transpileModule(`const closeComposedTaskForm = ${closeForm}; ${effect}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  for (const mobile of [false, true]) for (const newWindow of [false, true]) for (const outcome of ['created', 'escape', 'search-close', 'failure']) {
    await withPalette(t, { mobile, newWindow, open: false, navigate: true, url: '/project?id=1', project: { id: 1, title: 'URL board' } }, async ({ mountProbe, set, press, type, requests, legacyJ, jiti, finish, fail, values, input }) => {
      const selected = { id: 2, title: 'Form board' };
      const closes = [];
      let disarm = () => {};
      const closeHandler = (saved) => { closes.push(saved); disarm(); };
      const { armBackDismiss, closeBackDismissBeforeNavigation } = jiti(path.join(root, 'src/lib/mobile/backDismiss.ts'));
      const { isComposePaletteShortcut } = jiti(path.join(root, 'src/lib/constants/commandCenterShortcut.ts'));
      const { CommandMode } = jiti(path.join(root, 'src/models/enums.ts'));
      const runEffect = new Function('useEffect', 'newTaskWindow', 'isApple', 'pathname', 'projectForContext', 'setCommands', 'CommandMode', 'isComposePaletteShortcut', 'closeHandler', 'isMbl', 'closeBackDismissBeforeNavigation', javascript);
      function Probe() { runEffect(React.useEffect, newWindow, false, '/project', selected, (value) => set('showCommandsAtom', value), CommandMode, isComposePaletteShortcut, closeHandler, mobile, closeBackDismissBeforeNavigation); return null; }
      await mountProbe(() => React.createElement(Probe));
      await press('j', { ctrlKey: true }, document.body);
      assert.equal(legacyJ(), 0, 'only one shortcut handles the opening');
      await type('Create on the selected board');
      assert.deepEqual(closes, [], 'opening and typing leave the form unchanged');
      await press('k', { ctrlKey: true });
      if (outcome !== 'search-close') await press('j', { ctrlKey: true });
      if (outcome === 'escape' || outcome === 'search-close') {
        await press('Escape');
        assert.equal(values.get('showCommandsAtom').show, false);
        assert.deepEqual(closes, [], 'dismissing either tab leaves the original form open');
        // Remove the form listener and reopen independently. A cancelled
        // handoff must not close the old form after unrelated creation.
        await mountProbe(() => null);
        await press('j', { ctrlKey: true }, document.body);
        await type('An unrelated task');
        await press('Enter');
        await finish();
        assert.deepEqual(closes, [], 'dismissal clears the handoff');
        return;
      }
      await press('Enter');
      assert.equal(requests[0].body.project.id, newWindow ? 2 : 1, 'flag off retains the global Compose destination');
      assert.deepEqual(closes, [], 'an in-flight creation does not close the form');
      if (outcome === 'failure') {
        await fail();
        assert.deepEqual(closes, [], 'a failed creation keeps the form open');
        assert.equal(input().value, 'Create on the selected board');
        await press('Enter');
      }
      let popped = Promise.resolve();
      if (mobile && newWindow) {
        disarm = armBackDismiss(window, { key: 'createTaskModal', onBack: () => {} });
        popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
      }
      await React.act(async () => {
        await finish(outcome === 'failure');
        await popped;
      });
      assert.deepEqual(closes, newWindow ? [true] : [], 'only flagged handoff success closes without discard, including fallback/retry');
      assert.equal(values.get('showCommandsAtom').show, false);
      assert.equal(window.location.pathname, `/detail/project-${newWindow ? 2 : 1}/44`, 'phone history cleanup must finish before pushing the new task');
      assert.equal(values.get('showAIChatInterfaceAtom'), true);
      assert.equal(values.get('composeTaskChatIntroAtom').taskId, 91);
    });
  }
});

test('explicit form destination wins over URL, recency and an empty task detail', async (t) => {
  const destinationProject = { id: 8, title: 'Selected board', uniqueIdentifier: 'FORM' };
  for (const url of ['/project?id=7', '/settings', '/detail/project-7/4']) {
    const targetTask = { id: 52, projectId: 7, uniqueIndex: 4, title: '', description: '' };
    await withPalette(t, { newWindow: true, tab: 'compose', url, destinationProject, previousBoard: 'project-9|&|view', recency: { 10: 99 }, inView: { taskId: 52 }, targetTask }, async ({ type, press, requests, finish, navigations, input, values }) => {
      await type('Create on my selected board');
      await press('k', { ctrlKey: true });
      await press('j', { ctrlKey: true });
      assert.equal(input().value, 'Create on my selected board');
      await press('Enter');
      assert.equal(requests[0].body.project, destinationProject);
      assert.equal(requests[0].body.existingTaskId, undefined, 'the creation form must not fill the task behind it');
      await finish();
      assert.deepEqual(navigations, ['/detail/project-8/44']);
    });
  }
});

for (const writerFailed of [false, true]) test(`same-task fill updates the mounted detail and board with all saved fields (writerFailed=${writerFailed})`, async (t) => {
  const targetTask = { id: 52, projectId: 7, sectionId: 12, uniqueIndex: 4, title: 'Enter task title here', description_: { content: '<p></p>' }, project: { id: 7, title: 'QA Sandbox', uniqueIdentifier: 'QASA', team: { id: 'team-a', title: 'Old team' } } };
  await withPalette(t, { newWindow: true, url: '/detail/project-7/4', open: false, inView: { taskId: 52 }, targetTask }, async ({ press, type, finish, cacheAdds, cacheUpdates, queryClient, values, source, jiti, mountProbe }) => {
    const Context = React.createContext(null);
    let detailState, pendingFetch;
    global.fetch = (_url, { signal }) => new Promise((resolve) => { pendingFetch = { signal, resolve }; });
    source('src/hooks/General/useGetUserPreferences.tsx', { useGetUserPreferences: () => ({ data: {} }) });
    source('src/lib/contexts/TaskDetail/FollowersProvider.tsx', { FollowersProvider: ({ children }) => children });
    source('src/lib/contexts/TaskDetail/TaskProvider.tsx', {
      TasksProvider: ({ parsedTask, children }) => {
        const [currentTask, setCurrentTask] = React.useState(() => JSON.parse(parsedTask));
        const [description, setDescription] = React.useState(currentTask.description_.content);
        detailState = { currentTask, setCurrentTask, description, setDescription, editMode: null, hasDraft: false, hasDraftInit: false };
        return React.createElement(Context.Provider, { value: detailState }, children);
      },
      useTaskContext: () => React.useContext(Context),
    });
    source('src/app/detail/[...slug]/TaskDetailComp.tsx', { default: () => React.createElement('h1', { 'data-task-title': true }, React.useContext(Context).currentTask.title) });
    source('src/app/unauthorized/page.tsx', { default: () => null });
    source('src/utils/api/Task Detail/index.ts', { fetchCommentsHelper: () => assert.fail('cached detail must not block on comments') });
    const Detail = jiti(path.join(root, 'src/components/Modals/SwipeUnread/EmbeddedTaskDetail.tsx')).default;
    const { cachedTaskDetailKey } = jiti(path.join(root, 'src/lib/navigation/cachedTaskDetail.ts'));
    const key = cachedTaskDetailKey(985, 52);
    queryClient.setQueryData(key, targetTask);
    await mountProbe(() => React.createElement(Detail, { taskId: 52, projectId: 7, uniqueIndex: 4, initialTask: targetTask, embedded: false }));
    assert.equal(document.querySelector('[data-task-title]').textContent, targetTask.title);
    assert.ok(pendingFetch, 'the old detail fetch is in flight');
    await press('j', { ctrlKey: true }, document.body);
    await type('Write this task');
    await press('Enter');
    const savedTask = { id: 52, projectId: 7, sectionId: 12, uniqueIndex: 4, ticketNumber: 'QASA-4', title: 'Saved writer title', description_: { content: '<p>Saved writer body</p>', attachments: [{ id: 9 }] }, priority: { id: 2 }, estimate: { id: 3 }, assignees: [{ userId: 985 }], project: { team: { id: 'team-a', title: 'Saved team' } } };
    const mergedTask = { ...targetTask, ...savedTask, project: { ...targetTask.project, ...savedTask.project } };
    await finish(writerFailed, savedTask);
    await React.act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
    assert.equal(document.querySelector('[data-task-title]').textContent, savedTask.title);
    assert.equal(detailState.description, savedTask.description_.content);
    for (const [field, value] of Object.entries(mergedTask)) {
      assert.deepEqual(queryClient.getQueryData(key)[field], value, field);
      assert.deepEqual(detailState.currentTask[field], value, field);
    }
    assert.deepEqual(detailState.currentTask.project, mergedTask.project, 'retain board metadata while refreshing the team-only updateTaskSingle response');
    assert.deepEqual(cacheUpdates, [[mergedTask, 52, 7, 12]]);
    assert.deepEqual(cacheAdds, []);
    assert.equal(values.get('composeTaskChatIntroAtom').content, `I filled in QASA-4 from your note. Want me to refine it? I can tighten the title, add acceptance criteria or split it into sub-tasks.${writerFailed ? '\n\nThe task writer was unavailable, so I kept your original text as the title and description.' : ''}`);
    assert.equal(pendingFetch.signal.aborted, true, 'cancel the old snapshot before publishing the saved task');
    await React.act(async () => pendingFetch.resolve({ ok: true, status: 200, json: async () => targetTask }));
    assert.equal(document.querySelector('[data-task-title]').textContent, savedTask.title, 'a stale fetch cannot overwrite the saved title');
  });
});

test('board quick-add same-task fill updates the mounted header, description editor and properties, with either flag off unchanged', async (t) => {
  // Quick-add cards have no description_ payload, so instant open falls back
  // to the regular detail provider, which does not subscribe to the query cache.
  const targetTask = { id: 52, projectId: 7, sectionId: 12, uniqueIndex: 4, title: 'Enter task title here', description: '' };
  for (const enabled of [false, true]) for (const newWindow of [false, true]) {
    await withPalette(t, { enabled, newWindow, headerTask: targetTask, targetTask, open: false, previousBoard: 'project-7|&|view', url: '/detail/project-7/4', inView: { taskId: 52 } }, async ({ source, jiti, mountProbe, press, type, finish, headerState, queryClient, cacheAdds, cacheUpdates, requests }) => {
      source('src/utils/api/Task Detail/index.ts', { updateTask: () => assert.fail('a fill must not save the placeholder title') });
      source('src/hooks/MultiPages/Route/useHypertasksNavigate.ts', { default: () => ({ navigate() {} }) });
      source('src/components/Modals/Common Modals/ConfirmActionModal.tsx', { default: () => null });
      source('src/hooks/General/useAutosizeTextarea.ts', { default: () => {} });
      source('src/hooks/General/useDebounce.jsx', { default: () => () => {} });
      source('src/components/PageComponents/TaskDetail/TopRow/RunningTimerIndicator.tsx', { default: () => null });
      const { findCachedTaskDetail } = jiti(path.join(root, 'src/lib/navigation/cachedTaskDetail.ts'));
      assert.equal(findCachedTaskDetail(queryClient, 985, 7, 4, targetTask), undefined, 'the quick-add card cannot use instant open');
      const Title = jiti(path.join(root, 'src/components/PageComponents/TaskDetail/TopRow/TaskTitle.tsx')).default;
      const noop = () => null;
      source('src/components/Common/AttachmentsView/index.tsx', { default: noop });
      source('src/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent.ts', { default: () => ({ redirectAPI: () => assert.fail('sync must not save a description') }) });
      source('src/lib/contexts/TaskDetail/DescriptionProvider.tsx', { useDescriptionAndCommentsContext: () => ({ ...headerState(), descriptionAttachments: [], setDescriptionAttachments: noop }) });
      source('src/hooks/General/useHasDrafts.ts', { isMeaningfulDescriptionDraft: () => false });
      source('src/components/PageComponents/TaskDetail/CommentAndDescription/ContextMenu/index.tsx', { HighlightMenu: noop });
      source('src/components/PageComponents/TaskDetail/CommentAndDescription/ContextMenu/QuoteButton.tsx', { default: noop });
      source('src/components/PageComponents/TaskDetail/CommentAndDescription/BackgroundTaskAttachments.tsx', { default: noop });
      source('src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/InnerHtmlDescription.tsx', { default: noop });
      const { useTaskDetailEditorFocus } = jiti(path.join(root, 'src/components/RTE/useTaskDetailEditorFocus.tsx'));
      const syncs = [];
      source('src/components/RTE/TipTapTaskDetail.tsx', { default: (props) => {
        // Keep a separate mounted editor document and exercise its real idle sync hook.
        const [html, setHtml] = React.useState(props.defaultContent ?? '');
        const htmlRef = React.useRef(html);
        htmlRef.current = html;
        const [editor] = React.useState(() => ({
          getHTML: () => htmlRef.current, setEditable: noop,
          view: { dispatch: noop, state: { tr: {} } },
          commands: { setContent: (content, options) => { syncs.push(options); setHtml(content); } },
        }));
        useTaskDetailEditorFocus({ ...props, editor, currentTask: headerState().currentTask,
          isReadOnlyContent: true, inViewObject: {},
          mobileEditSnapshotRef: React.useRef(null), mobileEditSessionActiveRef: React.useRef(false),
          pendingGuestDescriptionFocusTaskRef: React.useRef(null), handledDescriptionFocusNonceRef: React.useRef(null),
        });
        return React.createElement('div', { id: 'description-input', dangerouslySetInnerHTML: { __html: html } });
      } });
      const Body = jiti(path.join(root, 'src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptonBody.tsx')).default;
      let labels = [];
      await mountProbe(() => {
        const priority = query.useQuery({ queryKey: ['priority', 52], queryFn: async () => null, initialData: null, staleTime: Infinity }).data;
        const estimate = query.useQuery({ queryKey: ['estimate', 52], queryFn: async () => null, initialData: null, staleTime: Infinity }).data;
        const taskLabels = query.useQuery({ queryKey: ['taskLabels', 52], queryFn: async () => labels, initialData: [], staleTime: Infinity }).data;
        return React.createElement(React.Fragment, null, React.createElement(Title), React.createElement(Body, { draftTQ: [] }),
          React.createElement('output', { 'data-properties': true }, JSON.stringify({ priority, estimate, taskLabels })));
      });
      const descriptionNode = document.getElementById('description-input');
      assert.equal(descriptionNode.textContent, '');
      const header = document.getElementById('title-input');
      assert.equal(header.value, targetTask.title);
      await press('j', { ctrlKey: true }, document.body);
      if (!enabled) {
        assert.equal(document.querySelector('[data-compose-task-writer]'), null);
        assert.equal(header.value, targetTask.title);
        assert.equal(requests.length, 0);
        return;
      }
      await type('Write the empty board task');
      await press('Enter');
      const saved = { ...targetTask, title: 'Release checklist', description_: { content: '<p>Tests and rollout</p>', attachments: [] }, priority: { id: 2 }, estimate: { id: 3 }, taskLabels: [{ id: 9 }], assignees: [{ userId: 985 }], dueDate: '2026-10-10', startDate: '2026-10-09', acceptanceCriteria: 'All checks pass' };
      labels = saved.taskLabels;
      await finish(false, newWindow ? saved : { ...saved, id: 91, uniqueIndex: 5 });
      await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      assert.equal(document.getElementById('description-input'), descriptionNode, 'the editor stays mounted');
      assert.equal(descriptionNode.textContent, newWindow ? 'Tests and rollout' : '');
      assert.deepEqual(syncs, newWindow ? [{ emitUpdate: false }] : []);
      assert.deepEqual(JSON.parse(document.querySelector('[data-properties]').textContent), newWindow ? { priority: saved.priority, estimate: saved.estimate, taskLabels: saved.taskLabels } : { priority: null, estimate: null, taskLabels: [] });
      if (newWindow) for (const [field, value] of Object.entries(saved)) assert.deepEqual(headerState().currentTask[field], value, field);
      assert.equal(document.getElementById('title-input'), header, 'the header stays mounted without a reload');
      assert.equal(header.value, newWindow ? saved.title : targetTask.title);
      assert.equal(headerState().currentTask.title, newWindow ? saved.title : targetTask.title);
      assert.equal(headerState().parsedTask, JSON.stringify(targetTask), 'the initialization snapshot remains unchanged');
      assert.equal(requests[0].body.existingTaskId, newWindow ? targetTask.id : undefined);
      assert.equal(cacheAdds.length, newWindow ? 0 : 1);
      assert.equal(cacheUpdates.length, newWindow ? 1 : 0);
      if (newWindow) assert.equal(queryClient.getQueryData(['cached-task-detail', 985, 52]).title, saved.title);
    });
  }
});

test('a pending server fill preserves description work started while the writer was running', async (t) => {
  for (const editorState of [{ editMode: 'description' }, { editMode: 'description-ai' }, { hasDraft: true }, { hasDraftInit: true }, { uploadingDescription: { content: 'Uploading' } }]) {
    const targetTask = { id: 52, projectId: 7, sectionId: 12, uniqueIndex: 4, title: 'Enter task title here', description_: { content: '' } };
    await withPalette(t, { newWindow: true, headerTask: targetTask, targetTask, tab: 'compose', url: '/detail/project-7/4', inView: { taskId: 52 } }, async ({ type, press, finish, headerState }) => {
      await type('Fill the task');
      await press('Enter');
      const local = { ...targetTask, description_: { content: '<p>Unsaved work</p>' }, description: 'Unsaved work', descriptionJson: { local: true } };
      await React.act(async () => {
        headerState().setCurrentTask(local);
        headerState().setDescription(local.description_.content);
        headerState().setEditorState(editorState);
      });
      await finish(false, { ...targetTask, title: 'Saved title', priority: { id: 2 }, description_: { content: '<p>Server fill</p>' }, description: 'Server fill', descriptionJson: { server: true } });
      assert.equal(headerState().currentTask.title, 'Saved title');
      assert.deepEqual(headerState().currentTask.priority, { id: 2 });
      for (const field of ['description', 'description_', 'descriptionJson']) assert.deepEqual(headerState().currentTask[field], local[field], field);
      assert.equal(headerState().description, local.description_.content);
      await React.act(async () => headerState().setEditorState({ editMode: null }));
      assert.equal(headerState().description, local.description_.content, 'ending editing must not replay an old fill');
    });
  }
});

test('a pending fill cannot replace another task mounted before its response', async (t) => {
  const targetTask = { id: 52, projectId: 7, sectionId: 12, uniqueIndex: 4, title: 'Enter task title here', description_: { content: '' } };
  await withPalette(t, { newWindow: true, headerTask: targetTask, targetTask, tab: 'compose', url: '/detail/project-7/4', inView: { taskId: 52 } }, async ({ type, press, finish, headerState }) => {
    await type('Fill the task');
    await press('Enter');
    const otherTask = { ...targetTask, id: 53, uniqueIndex: 5, title: 'Other task' };
    await React.act(async () => { headerState().setCurrentTask(otherTask); headerState().setDescription('Other description'); });
    await finish(false, { ...targetTask, title: 'Saved title', description_: { content: '<p>Server fill</p>' } });
    assert.deepEqual(headerState().currentTask, otherTask);
    assert.equal(headerState().description, 'Other description');
  });
});

test('file drop works under Compose alone; New Task also accepts document tiles above the input', async (t) => {
  for (const newWindow of [false, true]) await withPalette(t, { tab: 'compose', newWindow }, async ({ dom, input, press, type, requests, fail }) => {
    const file = new dom.window.File(['png'], 'finder.png', { type: '' });
    const drop = new dom.window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
    await React.act(async () => input().dispatchEvent(drop));
    assert.equal(drop.defaultPrevented, true);
    assert.ok(document.querySelector('img[alt="finder.png"]'));
    assert.ok(document.querySelector('[aria-label="Remove finder.png"]'));
    if (newWindow) {
      assert.ok(document.querySelector('[data-thumbnails]').compareDocumentPosition(input()) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
      const doc = new dom.window.File(['text'], 'brief.txt', { type: 'text/plain' });
      const fileInput = document.querySelector('input[type="file"]');
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [doc] });
      await React.act(async () => fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
      assert.ok(document.querySelector('[aria-label="Remove brief.txt"]'));
      await React.act(async () => document.querySelector('[aria-label="Remove brief.txt"]').click());
      assert.equal(document.querySelector('[aria-label="Remove brief.txt"]'), null);
    }
    await type('Keep attachments');
    await press('Enter');
    assert.deepEqual(requests[0].body.files, [file]);
    await fail();
  });
});

test('edit-mode and empty writer events retain inline writer with 6937 off but redirect with both flags on', async (t) => {
  for (const enabled of [false, true]) for (const newWindow of [false, true]) {
    await withPalette(t, { enabled, newWindow, open: false }, async ({ source, jiti, mountProbe, dom, values }) => {
      source('src/components/PageComponents/TaskDetail/TopRow/CreateSummaryButton.tsx', { AI_TASK_WRITER_EVENT: 'test-open-writer' });
      source('src/components/RTE/Components/EmojiGifPicker.tsx', { OPEN_EMOJI_GIF_PICKER_EVENT: 'test-emoji' });
      const { useTaskDetailEditorEvents } = jiti(path.join(root, 'src/components/RTE/useTaskDetailEditorEvents.tsx'));
      const openings = [];
      const context = { mode: 'read-edit-description', id: 'description', shouldTriggerAiTaskWriter: true,
        setShouldShowAITaskWriter: (value) => openings.push(value), setAiTriggerData() {}, divIds: {}, currentTask: {}, handleFocus() {} };
      function Probe() { useTaskDetailEditorEvents(context); return null; }
      await mountProbe(() => React.createElement(Probe));
      assert.equal(openings.at(-1), !(enabled && newWindow));
      await React.act(async () => window.dispatchEvent(new dom.window.CustomEvent('test-open-writer', { detail: { targetId: 'description', prompt: '' } })));
      if (enabled && newWindow) {
        assert.equal(openings.at(-1), false);
        assert.equal(values.get('showCommandsAtom').paletteTab, 'compose');
      } else assert.equal(openings.at(-1), true);
    });
  }
});

test('description prompts and comment AI toggle, mode trigger, hidden trigger and reply events keep their writer with both flags on', async (t) => {
  for (const mode of ['read-edit-description', 'create-comment', 'read-edit-comments']) for (const mobile of [false, true]) {
    await withPalette(t, { newWindow: true, open: false, mobile }, async ({ source, stub, jiti, mountProbe, dom, values }) => {
      const task = { id: 52, title: 'Existing task', projectId: 7, description_: { content: '<p>Existing body</p>' } };
      source('src/hooks/General/useCurrentUserCheckFromCookies.tsx', { default: () => null });
      source('src/lib/contexts/TaskDetail/TaskProvider.tsx', { useTaskContext: () => ({ parsedTask: JSON.stringify(task) }) });
      source('src/lib/contexts/TaskDetail/DescriptionProvider.tsx', { useDescriptionAndCommentsContext: () => ({}) });
      source('src/hooks/General/useGetUserPreferences.tsx', { useGetUserPreferences: () => ({ data: {} }) });
      source('src/hooks/General/useMobileVisualViewport.ts', { useMobileVisualViewport: () => null });
      source('src/components/RTE/Tiptap.ts', { default: () => ({}) });
      stub(require.resolve('@tanstack/react-query'), { useQueryClient: () => ({}) });
      stub(require.resolve('next/navigation'), { useRouter: () => ({}), useSearchParams: () => new URLSearchParams() });
      source('src/components/RTE/Components/EmojiGifPicker.tsx', { default: () => null, OPEN_EMOJI_GIF_PICKER_EVENT: 'test-emoji' });
      source('src/lib/contexts/TaskDetail/TiptapProvider.tsx', { default: ({ children }) => children });
      source('src/components/RTE/Components/TiptapBubbleMenu.tsx', { default: () => null });
      source('src/components/RTE/Components/TiptapMainContainer.tsx', { default: () => null });
      source('src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/InnerHtmlDescription.tsx', { default: () => null });
      source('src/components/PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer.tsx', {
        AITaskWriterWithProvider: ({ initialPrompt, autoTrigger, currentTask }) => React.createElement('div', {
          'data-existing-writer': currentTask.id, 'data-auto-trigger': autoTrigger,
        }, initialPrompt),
      });
      stub(require.resolve('next/dynamic'), { default: () => () => null });
      const { triggerAITaskWriter } = jiti(path.join(root, 'src/components/PageComponents/TaskDetail/TopRow/CreateSummaryButton.tsx'));
      const { useTaskDetailEditorState } = jiti(path.join(root, 'src/components/RTE/useTaskDetailEditorState.tsx'));
      const { useTaskDetailEditorSave } = jiti(path.join(root, 'src/components/RTE/useTaskDetailEditorSave.tsx'));
      const { taskDetailEditorPresentation } = jiti(path.join(root, 'src/components/RTE/taskDetailEditorPresentation.tsx'));
      const { useTaskDetailEditorEvents } = jiti(path.join(root, 'src/components/RTE/useTaskDetailEditorEvents.tsx'));
      const { TaskDetailEditorPanels } = jiti(path.join(root, 'src/components/RTE/TaskDetailEditorPanels.tsx'));
      let state;
      function Probe() {
        state = useTaskDetailEditorState({ id: 'description', mode, isMbl: mobile, reply: mode === 'create-comment' ? '<p>Quoted reply</p>' : undefined, shouldTriggerAiTaskWriter: true });
        const context = { ...state, divIds: { popoverTriggerButtonId: 'test-hidden-writer' }, getDefaultMode: () => 'AiTaskWriter', handleFocus() {} };
        Object.assign(context, useTaskDetailEditorSave(() => context));
        const presentation = { ...context, ...taskDetailEditorPresentation(context), handleReadOnlyContentClick() {} };
        useTaskDetailEditorEvents({ ...presentation, shouldShowFullAiTaskWriter: false });
        return React.createElement(React.Fragment, null, React.createElement(TaskDetailEditorPanels, presentation),
          React.createElement('button', { 'data-comment-ai-toggle': true, onClick: context.toggleAiTaskWriter }, 'Toggle comment AI'));
      }
      await mountProbe(() => React.createElement(Probe));
      const isDescription = mode === 'read-edit-description';
      assert.equal(Boolean(document.querySelector('[data-existing-writer]')), !isDescription, 'comment edit-mode trigger is not suppressed');
      if (!isDescription) {
        await React.act(async () => document.getElementById('test-hidden-writer').click());
        assert.equal(state.shouldShowAiTaskWriter, false);
        await React.act(async () => document.getElementById('test-hidden-writer').click());
        assert.equal(state.shouldShowAiTaskWriter, true);
        await React.act(async () => document.querySelector('[data-comment-ai-toggle]').click());
        assert.equal(state.shouldShowAiTaskWriter, false);
        await React.act(async () => document.querySelector('[data-comment-ai-toggle]').click());
        assert.equal(state.shouldShowAiTaskWriter, true);
        assert.equal(values.get('showCommandsAtom').show, false, 'comment toggles never open New Task');
      }
      const saved = global.CustomEvent;
      global.CustomEvent = dom.window.CustomEvent;
      try {
        await React.act(async () => triggerAITaskWriter('another-editor', 'Ignore this'));
        assert.equal(Boolean(document.querySelector('[data-existing-writer]')), !isDescription);
        if (!isDescription) {
          await React.act(async () => triggerAITaskWriter('description', ''));
          assert.equal(state.shouldShowAiTaskWriter, true, 'empty comment/reply events retain the inline writer');
          assert.equal(values.get('showCommandsAtom').show, false);
        }
        await React.act(async () => triggerAITaskWriter('description', 'Summarize the existing task'));
      } finally {
        if (saved) global.CustomEvent = saved;
        else delete global.CustomEvent;
      }
      assert.deepEqual(state.aiTriggerData, { autoTrigger: true, initialPrompt: 'Summarize the existing task' });
      assert.equal(state.shouldShowAiTaskWriter, true);
      const writer = document.querySelector('[data-existing-writer="52"]');
      assert.ok(writer);
      assert.equal(writer.textContent, 'Summarize the existing task');
      assert.equal(writer.dataset.autoTrigger, 'true');
      assert.equal(values.get('showCommandsAtom').show, false);
    });
  }
});

test('lazy attachment previews cannot suspend the palette or lose the Compose draft under either window flag', async (t) => {
  for (const newWindow of [false, true]) {
    let resolvePreview;
    const previewLoad = new Promise((resolve) => { resolvePreview = resolve; });
    await withPalette(t, { tab: 'compose', newWindow, previewLoad }, async ({ dom, input, type, press, requests }) => {
      await type('Keep this note while the thumbnail loads');
      const field = input();
      const picker = document.querySelector('[data-compose-task-writer] input[type="file"]');
      const image = new dom.window.File(['png'], 'lazy.png', { type: 'image/png' });
      Object.defineProperty(picker, 'files', { configurable: true, value: [image] });
      await React.act(async () => picker.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
      assert.equal(document.querySelector('[data-palette-suspended]'), null, 'lazy previews stay inside the attachment boundary');
      assert.equal(input(), field);
      assert.equal(input().value, 'Keep this note while the thumbnail loads');
      await React.act(async () => resolvePreview());
      assert.ok(document.querySelector('img[alt="lazy.png"]'));
      await press('Enter', {}, input());
      assert.equal(requests.at(-1).body.text, 'Keep this note while the thumbnail loads');
      assert.equal(requests.at(-1).body.files[0], image);
    });
  }
});

test('real shared gallery paints image blobs, file icons and removable tiles without uploads', async (t) => {
  await withPalette(t, { open: false, newWindow: true }, async ({ source, stub, jiti, mountProbe, dom, flags, rerender }) => {
    const savedCreate = URL.createObjectURL, savedRevoke = URL.revokeObjectURL;
    const revoked = [];
    URL.createObjectURL = () => 'blob:compose-thumbnail';
    URL.revokeObjectURL = (url) => revoked.push(url);
    try {
      source('src/styles/AttachmentView.scss', {});
      stub(require.resolve('react-circular-progressbar/dist/styles.css'), {});
      source('src/lib/storage/uploadViaApi.ts', { uploadSingleFileViaApi: () => assert.fail('Preview must not upload') });
      const Preview = jiti(path.join(root, 'src/components/Common/AttachmentsUpload/SingleFileInputPreview.tsx')).default;
      stub(require.resolve('next/dynamic'), { default: () => Preview });
      delete require.cache[path.join(root, 'src/components/Common/AttachmentsUpload/ImageGalleryView.tsx')];
      const Gallery = jiti(path.join(root, 'src/components/Common/AttachmentsUpload/ImageGalleryView.tsx')).default;
      const image = new dom.window.File(['png'], 'image.png', { type: 'image/png' });
      const doc = new dom.window.File(['text'], 'brief.txt', { type: 'text/plain' });
      function Probe() {
        const [files, setFiles] = React.useState([{ id: 0, file: image }, { id: 1, file: doc }]);
        return React.createElement(Gallery, { files, images: [], allowDelete: true, shouldUpload: false, mode: 'others', variant: 'chat',
          handleRemove: (name) => setFiles((old) => old.filter(({ file }) => file.name !== name)) });
      }
      await mountProbe(() => React.createElement(Probe));
      assert.equal(document.querySelector('img[alt="image.png"]').getAttribute('src'), 'blob:compose-thumbnail');
      assert.ok(document.querySelector('.lucide-paperclip'));
      assert.ok(document.body.textContent.includes('brief.txt'));
      for (const offFlag of [flag, newFlag]) {
        flags[offFlag] = false;
        await rerender();
        assert.equal(document.querySelector('.lucide-x').getAttribute('role'), null, 'flag-off shared removal markup stays unchanged');
        assert.equal(document.querySelector('.lucide-x').getAttribute('aria-label'), null);
        flags[offFlag] = true;
        await rerender();
      }
      await React.act(async () => document.querySelector('[aria-label="Remove image.png"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      assert.equal(document.querySelector('img[alt="image.png"]'), null);
      assert.deepEqual(revoked, ['blob:compose-thumbnail']);
      await React.act(async () => document.querySelector('[aria-label="Remove brief.txt"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      assert.equal(document.querySelector('[aria-label="Remove brief.txt"]'), null);
    } finally {
      URL.createObjectURL = savedCreate;
      URL.revokeObjectURL = savedRevoke;
    }
  });
});

test('direct AI writer commands redirect to New Task instead of opening a parallel inline or create form', async (t) => {
  await withPalette(t, { open: false }, async ({ jiti }) => {
    const { createCommandDispatcher } = jiti(path.join(root, 'src/components/commandDispatcher.ts'));
    const { CommandMode } = jiti(path.join(root, 'src/models/enums.ts'));
    for (const newTaskWindow of [false, true]) {
      const opens = [], legacy = [];
      const { handleAction } = createCommandDispatcher({ newTaskWindow, setShowCommands: (value) => opens.push(value), setCommandMode() {},
        toggleCreateTaskGlobally: () => legacy.push('form'), openAiWriterHandler: () => legacy.push('inline'), boardCloseHandler() {} });
      handleAction(CommandMode.CreateTaskWithAiWriter);
      handleAction(CommandMode.OpenAiTaskWriter);
      assert.deepEqual(legacy, newTaskWindow ? [] : ['form', 'inline']);
      if (newTaskWindow) assert.deepEqual(opens, [
        { show: true, mode: CommandMode.Command, paletteTab: 'compose' },
        { show: true, mode: CommandMode.Command, paletteTab: 'compose' },
      ]);
    }
  });
});

test('modified Enter in New Task over a populated form never also saves the form, and flag off retains form shortcuts', async (t) => {
  const ts = require('typescript');
  const file = ts.createSourceFile('form.tsx', fs.readFileSync(path.join(root, 'src/components/RTE/TiptapCreateTaskModal.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler, listener;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleKeyDown') handler = node.initializer.getText(file);
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect' && node.arguments[0].getText(file).includes('document.addEventListener("keydown", handleKeyDown')) listener = node.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(handler);
  assert.ok(listener);
  const runHandler = new Function('isApple', 'showAssignModal', 'isRecording', 'newTaskWindow', 'showCommands', 'shouldShowAiTaskWriter', 'CtrlEnterHandler', 'editor', `${ts.transpileModule(`const handler = ${handler};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText} return handler;`);
  const runListener = new Function('useEffect', 'handleKeyDown', ts.transpileModule(listener, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText);
  for (const apple of [false, true]) for (const modifiers of [{}, { altKey: true }, { altKey: true, shiftKey: true }, { shiftKey: true }]) {
    await withPalette(t, { newWindow: true, apple, tab: 'compose' }, async ({ mountProbe, values, type, press, requests, finish, clickTab }) => {
      const formSaves = [];
      function Probe() {
        const handleKeyDown = runHandler(apple, false, false, true, values.get('showCommandsAtom'), false, (action) => formSaves.push(action), { isFocused: false });
        runListener(React.useEffect, handleKeyDown);
        return React.createElement('input', { value: 'Populated original task title', readOnly: true });
      }
      await mountProbe(() => React.createElement(Probe));
      await type('Only create this palette task');
      const commandKey = apple ? { metaKey: true } : { ctrlKey: true };
      await press('Enter', { code: 'Enter', ...commandKey, ...modifiers });
      assert.deepEqual(formSaves, [], 'document capture must not save the populated form');
      assert.equal(requests.length, modifiers.shiftKey ? 0 : 1);
      if (modifiers.shiftKey) await press('Enter', { code: 'Enter', ...commandKey });
      await press('k', commandKey, document.body);
      await press('Enter', { code: 'Enter', ...commandKey, altKey: true, shiftKey: true }, document.body);
      assert.deepEqual(formSaves, [], 'the form stays suspended on Search too');
      await finish();
      assert.equal(requests.length + formSaves.length, 1, 'exactly one task is created');
      await press('Enter', { code: 'Enter', ...commandKey }, document.body);
      assert.deepEqual(formSaves, ['Save'], 'form shortcuts resume after the palette closes');
    });
  }
  for (const newTaskWindow of [false, true]) {
    const saves = [];
    const handle = runHandler(false, false, false, newTaskWindow, { show: true }, false, (action) => saves.push(action), { isFocused: false });
    handle({ key: 'Enter', ctrlKey: true });
    handle({ key: 'Enter', ctrlKey: true, altKey: true });
    handle({ key: 'Enter', ctrlKey: true, altKey: true, shiftKey: true });
    assert.deepEqual(saves, newTaskWindow ? [] : ['Save', 'SaveAndClose', 'SaveAndNew'], 'flag off leaves all legacy form saves unchanged');
  }
});

test('New Task desktop leaves action tooltips unclipped and scrolls only attachments; phone and flag-off keep their layout', async (t) => {
  for (const mobile of [false, true]) for (const newWindow of [false, true]) {
    await withPalette(t, { tab: 'compose', mobile, newWindow }, async ({ dom, input, flags, rerender }) => {
      const writer = document.querySelector('[data-compose-task-writer]');
      assert.equal(writer.className, newWindow && mobile ? 'max-h-[65dvh] overflow-y-auto' : '');
      const picker = writer.querySelector('input[type="file"]');
      const images = Array.from({ length: 30 }, (_, i) => new dom.window.File(['png'], `image-${i}.png`, { type: 'image/png' }));
      Object.defineProperty(picker, 'files', { configurable: true, value: images });
      await React.act(async () => picker.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
      const previews = writer.querySelector('[data-thumbnails]');
      assert.equal(previews.children.length, 30);
      if (newWindow && !mobile) {
        assert.equal(previews.parentElement.className, 'max-h-[max(6rem,calc(65dvh-20rem))] overflow-y-auto');
        assert.equal(previews.parentElement.contains(input()), false, 'text and actions stay outside attachment scrolling');
      } else assert.equal(previews.parentElement.className, 'flex w-full flex-col rounded-[5px] bg-ai-tiptap px-3 py-2');
      assert.equal(input().className.includes('max-h-52 overflow-y-auto'), newWindow);
      flags[flag] = false;
      await rerender();
      assert.equal(document.querySelector('[data-compose-task-writer]'), null);
    });
  }
});

test('New Task keeps the palette width Search uses', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/Modals/commands/HTC/commands.tsx'), 'utf8');
  assert.match(source, /paletteModalSizing sm:top-\[24%\] sm:min-w-\[560px\]/);
  assert.doesNotMatch(source, /w-\[1120px\]/);
});

test('both flags enable stage labels in the existing live status and retries reset progress', async (t) => {
  for (const mobile of [false, true]) {
    await withPalette(t, { newWindow: true, mobile, tab: 'compose' }, async ({ type, press, requests, fail, input }) => {
      await type('Write this ticket');
      await press('Enter', { code: 'Enter' });
      const progress = requests[0].body.onProgress;
      assert.equal(typeof progress, 'function');
      const status = document.querySelector('[role="status"]');
      assert.equal(status.getAttribute('aria-live'), 'polite');
      const classes = status.className;
      for (const stage of ['Reading past tickets', 'Understanding the context', 'Writing the ticket', 'Saving the ticket']) {
        await React.act(async () => progress(stage));
        assert.equal(status.textContent, stage);
        assert.equal(status.className, classes, 'progress does not change layout or theme classes');
        assert.ok(status.querySelector('.animate-spin'));
      }
      await fail();
      assert.equal(input().value, 'Write this ticket');
      assert.ok(document.querySelector('[role="alert"]'));
      await press('Enter', { code: 'Enter' });
      assert.equal(document.querySelector('[role="status"]').textContent, 'Writing your ticket…');
    });
  }
});

test('new-window flag off preserves the legacy loading label and omits progress', async (t) => {
  for (const mobile of [false, true]) {
    await withPalette(t, { newWindow: false, mobile, tab: 'compose' }, async ({ type, press, requests }) => {
      await type('Legacy note');
      await press('Enter', { code: 'Enter' });
      assert.equal(requests[0].body.onProgress, undefined);
      assert.equal(document.querySelector('[role="status"]').textContent, 'Writing your ticket…');
    });
    await withPalette(t, { enabled: false, newWindow: true, mobile }, async ({ requests }) => {
      assert.equal(document.querySelector('[data-compose-task-writer]'), null);
      assert.equal(document.querySelector('[role="status"]'), null);
      assert.equal(requests.length, 0);
    });
  }
});

test('task-writing progress needs its own flag', async (t) => {
  await withPalette(t, { newWindow: true, progress: false, tab: 'compose' }, async ({ type, press, requests }) => {
    await type('Write this ticket');
    await press('Enter', { code: 'Enter' });
    assert.equal(requests[0].body.onProgress, undefined);
  });
});

test('progress steps keep the New Task window height', async (t) => {
  await withPalette(t, { newWindow: true, tab: 'compose' }, async ({ type, press }) => {
    const proto = Object.getPrototypeOf(document.createElement('div'));
    const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), 'offsetHeight') ?? Object.getOwnPropertyDescriptor(proto, 'offsetHeight');
    Object.defineProperty(proto, 'offsetHeight', { configurable: true, get: () => 184 });
    t.after(() => { delete proto.offsetHeight; if (original) Object.defineProperty(proto, 'offsetHeight', original); });
    await type('Write this ticket');
    await press('Enter', { code: 'Enter' });
    const status = document.querySelector('[role="status"]');
    assert.equal(status.closest('[style]')?.style.minHeight, '184px');
  });
});
