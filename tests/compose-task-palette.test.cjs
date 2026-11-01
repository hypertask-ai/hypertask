const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test: nodeTest } = require('node:test');
const { Worker } = require('node:worker_threads');
const STALL_MS = Number(process.env.COMPOSE_PALETTE_STALL_MS ?? 120_000);
const watchdog = new Worker(`
  const { parentPort } = require('node:worker_threads');
  const stall = setTimeout(() => {
    require('node:fs').writeSync(2, 'compose-task-palette made no progress for ${STALL_MS}ms\\n');
    process.kill(process.pid, 'SIGKILL');
  }, ${STALL_MS});
  parentPort.on('message', () => stall.refresh());
`, { eval: true });
watchdog.unref();
const test = (name, check) => nodeTest(name, { timeout: 30_000 }, async (t) => {
  try {
    return await check(t);
  } finally {
    watchdog.postMessage(0);
  }
});
const React = require('react');
const { JSDOM } = require('jsdom');
const { createJiti } = require('jiti');
const query = require('@tanstack/react-query');
const root = path.resolve(__dirname, '..');
const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: path.join(require('node:os').tmpdir(), 'jiti-compose-task-palette'), extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'], jsx: { runtime: 'automatic' } });
const flag = 'htpr-6929-compose-task-writer';
const newFlag = 'htpr-6937-new-task-window';
const tooltipFlag = 'htpr-6950-tooltip-top-layer';
const keepClosedFlag = 'htpr-7530-keep-ai-chat-closed';
const boardChipFlag = 'htpr-7053-compose-board-chip';

const oneWindowPerFile = () => {
  const state = { dom: null };
  return (url) => {
    if (!state.dom) {
      state.dom = new JSDOM('<div id="root"></div>', { url: `https://example.test${url}` });
      const proto = state.dom.window.HTMLElement.prototype;
      proto.attachEvent = () => {};
      proto.detachEvent = () => {};
      proto.scrollIntoView = () => {};
      state.focus = proto.focus;
      proto.focus = function (...args) {
        if (this.tagName === 'TEXTAREA' && state.focusFailures-- > 0) return;
        return state.focus.apply(this, args);
      };
    } else {
      state.dom.window.history.replaceState({}, '', url);
      state.dom.window.localStorage.clear();
    }
    return state;
  };
};
const windowState = oneWindowPerFile();

const Module = require('node:module');
const stubTargets = [...new Set([...fs.readFileSync(__filename, 'utf8').matchAll(/\b(?:source\('([^']+)'|stub\(require\.resolve\('([^']+)'\))/g)]
  .map(([, file, id]) => file ? path.join(root, file) : require.resolve(id)))];
const setupStubs = new Map();
const testStubs = new Map();
let replacingStubs = false;
const proxies = new Map();
const pinned = new Map();
const realModules = new Map();
const TaskContext = React.createContext(undefined);
const MobileViewContext = React.createContext(false);

const cacheSlot = (filename, value) => {
  if (value === undefined) delete require.cache[filename];
  else require.cache[filename] = value;
};
const realExports = (filename) => {
  if (!realModules.has(filename)) {
    realModules.set(filename, {});
    const proxy = proxies.get(filename);
    const installed = proxy !== undefined && require.cache[filename] === proxy;
    if (installed) cacheSlot(filename, undefined);
    try {
      const loaded = jiti(filename);
      realModules.set(filename, loaded === proxy?.exports ? {} : loaded);
    } catch {
      realModules.set(filename, {});
    } finally {
      if (installed) cacheSlot(filename, proxy);
    }
  }
  return realModules.get(filename);
};
const stubLayers = (filename) => [testStubs.get(filename), setupStubs.get(filename)];
const readStub = (filename, prop) => {
  for (const layer of stubLayers(filename)) if (layer && prop in layer) return layer[prop];
  return realExports(filename)?.[prop];
};
const stubKeys = (filename) => [...new Set(stubLayers(filename).flatMap((layer) => layer ? Reflect.ownKeys(layer) : []))];
const plainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value) && typeof value.$$typeof !== 'symbol';
const resolving = new Set();
const live = (key, read) => {
  if (pinned.has(key)) return pinned.get(key);
  if (resolving.has(key)) return read();
  resolving.add(key);
  let first;
  try {
    const current = () => read();
    first = current();
    if (typeof first === 'function') pinned.set(key, (...args) => {
      const fn = current();
      return fn === undefined || fn === pinned.get(key) ? undefined : fn(...args);
    });
    else if (!plainObject(first) && typeof first === 'object' && first !== null) pinned.set(key, first);
    else if (plainObject(first)) pinned.set(key, new Proxy({}, {
      get: (_, prop) => live(`${key}\u0000${String(prop)}`, () => read()?.[prop]),
      has: (_, prop) => prop in (read() ?? {}),
      ownKeys: () => Reflect.ownKeys(read() ?? {}),
      set: (_, prop, value) => { const target = read(); if (!target) return false; target[prop] = value; return true; },
      deleteProperty: (_, prop) => { const target = read(); if (!target) return true; delete target[prop]; return true; },
      getOwnPropertyDescriptor: (_, prop) => {
        const value = read()?.[prop];
        return value === undefined ? undefined : { value, enumerable: true, configurable: true, writable: true };
      },
    }));
  } finally {
    resolving.delete(key);
  }
  return pinned.has(key) ? pinned.get(key) : first;
};
const moduleProxy = (filename) => {
  if (!proxies.has(filename)) {
    const cached = new Module(filename, null);
    cached.filename = filename;
    cached.loaded = true;
    cached.exports = new Proxy({}, {
      get: (_, prop) => live(`${filename}\u0000${String(prop)}`, () => readStub(filename, prop)),
      has: (_, prop) => stubKeys(filename).length ? stubKeys(filename).includes(prop) : prop in (realExports(filename) ?? {}),
      ownKeys: () => stubKeys(filename).length ? stubKeys(filename) : Reflect.ownKeys(realExports(filename) ?? {}),
      getOwnPropertyDescriptor: (_, prop) => {
        const value = readStub(filename, prop);
        return value === undefined ? undefined : { value, enumerable: true, configurable: true, writable: true };
      },
    });
    proxies.set(filename, cached);
  }
  return proxies.get(filename);
};
const installStubProxy = (filename) => cacheSlot(filename, moduleProxy(filename));
const releaseStubProxy = (filename) => {
  const proxy = proxies.get(filename);
  if (proxy && require.cache[filename] === proxy) cacheSlot(filename, undefined);
};
const isAppSource = (filename) => filename.startsWith(`${path.join(root, 'src')}${path.sep}`);
stubTargets.filter(isAppSource).forEach(installStubProxy);

async function withPalette(t, config, check) {
  const shared = windowState(config.url ?? '/project?id=7');
  const dom = shared.dom;
  shared.focusFailures = config.focusFailures ?? 0;
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT', 'File', 'requestAnimationFrame', 'fetch', 'DOMParser']
    .map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  const animationFrames = [];
  Object.assign(global, { DOMParser: dom.window.DOMParser, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage, File: dom.window.File, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (fn) => config.deferAnimationFrames ? animationFrames.push(fn) : fn() });
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
  const focus = shared.focus;
  const focusProxy = { current: null, compose: !config.legacyProxy, pendingEnter: config.pendingEnter };
  if (config.bufferedText !== undefined) {
    focusProxy.current = document.createElement('textarea');
    focusProxy.current.value = config.bufferedText;
    document.body.appendChild(focusProxy.current);
    focus.call(focusProxy.current);
    focusProxy.current.setSelectionRange(2, 5);
  }
  const stub = (filename, exports) => { (replacingStubs ? testStubs : setupStubs).set(filename, exports); installStubProxy(filename); };
  const source = (file, exports) => stub(path.join(root, file), exports);
  const flags = { 'htpr-8015-amoled-mode-outline': config.modeOutline ?? false, 'htpr-7650-ai-chat-open-switches': config.autoOpenSwitches ?? false, 'htpr-7547-search-lazy-closed': config.preserveColdCommandInput ?? false, [keepClosedFlag]: config.keepClosedFlag ?? false, [flag]: config.enabled ?? true, [newFlag]: config.newWindow ?? false, 'htpr-6951-task-writing-progress': config.progress ?? config.newWindow ?? false, [tooltipFlag]: config.topLayer ?? false, [boardChipFlag]: config.boardChip ?? false, 'htpr-7317-ctrlj-ticket-questions': config.ticketQuestions ?? false };
  const atomNames = ['aiChatNewTicketPathAtom', 'keepAiChatClosedAtom', 'boardLayoutAtom', 'calendarSettingsAtom', 'currentProjectAtom', 'currentUserAtom', 'frequentlyUsedHTCAton', 'tableTitleWrapAtom', 'showCommandsAtom', 'lastUsedBoardsAtom', 'composeTaskChatIntroAtom', 'composeTaskSkillFollowupAtom', 'composeTaskOriginalNoteAtom', 'composeTaskQuestionsTaskIdAtom', 'showAIChatInterfaceAtom', 'isAiChatSidebarModeAtom', 'aiChatAutoOpenSuppressedAtom', 'aiChatExplicitOpenAtAtom', 'dockedChatScopeAtom', 'showCreateTaskModalAtom', 'showShortcutsAtom', 'showSidebarAtom', 'showBoardManagerAtom', 'inViewObjectAtom', 'uploadingStateCreateTaskModalAtom'];
  const atoms = Object.fromEntries(atomNames.map((name) => [name, name]));
  const project = { id: 7, title: 'QA Sandbox', uniqueIdentifier: 'QASA' };
  const values = new Map(Object.entries({
    keepAiChatClosedAtom: config.keepClosed ?? false,
    inViewObjectAtom: config.inView ?? { taskId: null },
    currentProjectAtom: config.project === null ? null : config.project ?? project, currentUserAtom: { id: 985, uid: 'qa' },
    boardLayoutAtom: 'board', calendarSettingsAtom: {}, frequentlyUsedHTCAton: {}, lastUsedBoardsAtom: config.recency ?? {},
    showCommandsAtom: { show: config.open ?? true, mode: 0, paletteTab: config.tab ?? 'search', composeProject: config.destinationProject }, composeTaskChatIntroAtom: null, composeTaskQuestionsTaskIdAtom: null,
  }));
  const listeners = new Set();
  const set = (atom, next) => { values.set(atom, typeof next === 'function' ? next(values.get(atom)) : next); listeners.forEach((fn) => fn()); };
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const useValue = (atom) => React.useSyncExternalStore(subscribe, () => values.get(atom));
  const setters = new Map(atomNames.map((name) => [name, (next) => set(name, next)]));
  const state = { useRecoilValue: useValue, useRecoilState: (atom) => [useValue(atom), setters.get(atom)], useSetRecoilState: (atom) => setters.get(atom) };
  const requests = [], navigations = [], cacheAdds = [], cacheUpdates = [], viewedTasks = [], loadedBoards = [];
  const queryClient = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 1_000 } } });
  if (config.boards) queryClient.setQueryData(['projectsAllMinimal', 985], config.boards);
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
    source('src/hooks/useFlag.tsx', { useFlagReady: () => true, useFlag: (key) => flags[key] ?? false });
    source('src/lib/contexts/TaskDetail/TaskProvider.tsx', { TaskContext, useTaskContext: () => React.useContext(TaskContext) });
    source('src/lib/contexts/deviceContext.tsx', { useDeviceContext: () => config.apple ?? false });
    source('src/lib/contexts/mobileContext.tsx', { MobileViewContext });
    source('src/hooks/RecoilRoot/useHypertasksRecoilStates.ts', { default: () => ({ resetShowCommands, toggleShowCommands }) });
    source('src/lib/contexts/TourContext.tsx', { useTourContext: () => ({ endTour() {} }) });
    source('src/components/PageComponents/Interactive-Onboarding/Components/TutorialTip.tsx', { default: () => null });
    source('src/hooks/MultiPages/useGetAllProjectsMinimal.ts', { useGetAllProjectsMinimal: () => ({ data: config.boards ?? [] }) });
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
    source('src/hooks/MultiPages/useUpdateTaskInBoards.tsx', { default: () => ({ updateTaskInCache: (...args) => {
      jiti(path.join(root, 'src/lib/taskDetailReads.ts')).refreshTaskDetailReadAfterWrite(queryClient, 985, args[1], args[0]);
      cacheUpdates.push(args);
    } }) });
    source('src/lib/deriveCurrentBoardBilling.ts', { deriveCurrentBoardBilling: () => null });
    source('src/lib/createTaskAttachmentUploads.ts', { discardUnboundCreateTaskUploads() {} });
    source('src/utils/api/global/apiHelpers/createTaskGloballycontroller.ts', {});
    const compose = realExports(path.join(root, 'src/lib/ai/composeTask.ts'));
    source('src/lib/ai/composeTask.ts', { ...compose, createComposedTask: (body) => new Promise((resolve, reject) => requests.push({ body, resolve, reject })) });
    const Thumbnails = ({ files, handleRemove }) => React.createElement('div', { 'data-thumbnails': true }, files.map(({ file }) => React.createElement('button', { key: file.name, onClick: () => handleRemove(file.name), 'aria-label': `Remove ${file.name}` }, React.createElement('img', { alt: file.name }), file.name)));
    const gallery = config.previewLoad ? React.lazy(() => config.previewLoad.then(() => ({ default: Thumbnails }))) : Thumbnails;
    source('src/components/Common/AttachmentsUpload/ImageGalleryView.tsx', { default: (props) => React.createElement(gallery, props) });
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
    const common = realExports(path.join(root, 'src/components/Common/CommonModalComponents/index.tsx'));
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
          React.createElement(MobileViewContext.Provider, { value: config.mobile ?? false },
          shown.show ? React.createElement(React.Suspense, { fallback: React.createElement('div', { 'data-palette-suspended': true }) }, React.createElement(Palette, { isOpen: true, focusProxy: config.bufferedText !== undefined ? focusProxy : undefined })) : null,
          React.createElement(Probe))));
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
      for (const [filename, module] of Object.entries(require.cache)) {
        if (filename.startsWith(`${root}/src/`)) {
          stub(path.join(directory, path.relative(root, filename)), module.exports);
        }
      }
      const filename = path.join(directory, 'src/components/Modals/commands/HTC/commands.tsx');
      delete require.cache[path.join(directory, 'src/components/Modals/commands/HTC/ComposeTaskWriter.tsx')];
      delete require.cache[filename];
      Palette = jiti(filename).default;
      reactRoot = require('react-dom/client').createRoot(document.getElementById('root'));
      await React.act(async () => reactRoot.render(React.createElement(config.strict ? React.StrictMode : React.Fragment, null, React.createElement(Harness))));
      assert.equal(document.getElementById('root').innerHTML, current);
    };
    const flushAnimationFrame = () => React.act(async () => {
      const callbacks = animationFrames.splice(0);
      assert.ok(callbacks.length, 'a focus retry must be pending');
      callbacks.forEach((callback) => callback());
    });
    replacingStubs = true;
    await check({ dom, flushAnimationFrame, focusProxy, input, type, press, clickTab, finish, fail, rerender, flags, values, set, requests, navigations, cacheAdds, cacheUpdates, queryClient, viewedTasks, loadedBoards, shells, capture, baseline, source, stub, jiti, mountProbe, headerState: () => headerState, legacyJ: () => legacyJ });
  } finally {
    document.removeEventListener('keydown', legacy);
    try {
      if (reactRoot) await React.act(async () => reactRoot.unmount());
    } finally {
      queryClient.clear();
      replacingStubs = false;
      const replaced = testStubs.size > 0;
      setupStubs.clear();
      testStubs.clear();
      if (replaced) for (const key of Object.keys(require.cache)) if (key.startsWith(`${root}/src/`)) cacheSlot(key, undefined);
      stubTargets.forEach((filename) => isAppSource(filename) ? installStubProxy(filename) : releaseStubProxy(filename));
      for (const [key, descriptor] of globals) descriptor ? Object.defineProperty(global, key, descriptor) : delete global[key];
      dom.window.document.body.replaceChildren(Object.assign(dom.window.document.createElement('div'), { id: 'root' }));
    }
  }
}

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

const composeBoards = [
  { id: 7, title: 'QA Sandbox', uniqueIdentifier: 'QASA' },
  { id: 8, title: 'Product', uniqueIdentifier: 'PROD' },
  { id: 9, title: 'Design', uniqueIdentifier: 'DES' },
];
const chip = () => document.querySelector('[data-compose-board-chip]');
const boardList = () => document.querySelector('input[id="input-addTask"]');
const boardKey = (apple = false) => ({ code: 'KeyB', keyCode: 66, shiftKey: true, ...(apple ? { metaKey: true } : { ctrlKey: true }) });

test('board chip flag off preserves legacy inbox board selection, Tab and shortcuts', async (t) => {
  await withPalette(t, { boardChip: false, newWindow: true, tab: 'compose', url: '/inbox?split=Board&projectId=8', previousBoard: 'project-7|&|QA Sandbox', inView: { taskId: 42, taskProjectId: 9 } }, async ({ type, press, requests, values, queryClient, loadedBoards }) => {
    assert.equal(chip(), null);
    assert.equal(queryClient.getQueryData(['projectsAllMinimal', 985]), undefined, 'flag off must not seed an empty shared board cache');
    assert.equal(loadedBoards.length, 0, 'flag off must not fetch the new board list');
    assert.doesNotMatch(document.querySelector('[data-compose-task-writer]').textContent, /CTRL\+SHIFT\+B/);
    await press('B', boardKey());
    assert.equal(boardList(), null);
    await type('Legacy target');
    await press('Enter', { code: 'Enter' });
    assert.equal(requests[0].body.project.id, 7);
    assert.equal(values.get('showCommandsAtom').paletteTab, 'compose');
  });
  await withPalette(t, { boardChip: false, newWindow: true, tab: 'compose', url: '/inbox' }, async ({ press, values }) => {
    await press('Tab', { code: 'Tab' });
    assert.equal(values.get('showCommandsAtom').paletteTab, 'search');
  });
});

test('inbox chip shows the rule target and submission uses exactly the displayed board', async (t) => {
  for (const [url, inView, previousBoard, expected] of [
    ['/inbox?split=Board&projectId=8', { taskId: 42, taskProjectId: 9 }, 'project-7', 9],
    ['/inbox?split=Board&projectId=8', { taskId: null, taskProjectId: 9 }, 'project-7', 8],
    ['/inbox?split=All', { taskId: null }, 'project-7', 7],
    ['/inbox?split=Important', { taskId: null }, undefined, 8],
  ]) {
    await withPalette(t, { boardChip: true, newWindow: true, tab: 'compose', boards: composeBoards, url, inView, previousBoard, recency: { 7: 1, 8: 2 } }, async ({ type, press, requests }) => {
      assert.equal(chip().textContent, composeBoards.find((board) => board.id === expected).title);
      await type('Use this board');
      await press('Enter', { code: 'Enter' });
      assert.equal(requests[0].body.project.id, expected);
    });
  }
});

test('mixed-board views show a chip; board and ticket views hide it until choosing a different board', async (t) => {
  for (const url of ['/my-tasks', '/search', '/all-tasks', '/calendar', '/starred', '/inbox']) {
    await withPalette(t, { boardChip: true, newWindow: true, tab: 'compose', boards: composeBoards, previousBoard: 'project-7', url }, async () => {
      assert.equal(chip().textContent, 'QA Sandbox');
    });
  }
  for (const url of ['/project?id=7', '/detail/project-7/42']) {
    await withPalette(t, { boardChip: true, newWindow: true, tab: 'compose', boards: composeBoards, url, previousBoard: 'project-8', inView: { taskId: 42, taskProjectId: 7 }, targetTask: { id: 42, projectId: 7, uniqueIndex: 42, title: '', description_: { content: '' } } }, async ({ input, type, press, requests }) => {
      assert.equal(chip(), null);
      await type('Keep my draft');
      input().setSelectionRange(3, 7, 'backward');
      await press('B', boardKey());
      assert.ok(boardList(), 'shortcut works even while chip is hidden');
      await press('ArrowDown', { code: 'ArrowDown' });
      await press('Enter', { code: 'Enter' });
      await React.act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
      assert.equal(chip().textContent, 'Product');
      assert.equal(document.activeElement, input());
      assert.deepEqual([input().selectionStart, input().selectionEnd, input().selectionDirection], [3, 7, 'backward']);
      assert.equal(input().value, 'Keep my draft');
      await press('Enter', { code: 'Enter' });
      assert.equal(requests[0].body.project.id, 8);
      assert.equal(requests[0].body.existingTaskId, undefined);
    });
  }
});

test('Tab and Shift+Tab connect textarea and chip, Enter/Space open shared picker, Esc closes only list', async (t) => {
  for (const mobile of [false, true]) {
    await withPalette(t, { boardChip: true, newWindow: true, mobile, tab: 'compose', boards: composeBoards, url: '/inbox', previousBoard: 'project-7' }, async ({ input, type, press, values, requests, capture }) => {
      await type('Caret stays here');
      capture(`board-chip-${mobile ? 'mobile' : 'desktop'}`);
      input().setSelectionRange(6, 6);
      const tab = await press('Tab', { code: 'Tab' });
      assert.equal(tab.defaultPrevented, true);
      assert.equal(document.activeElement, chip());
      assert.equal(values.get('showCommandsAtom').paletteTab, 'compose');
      await press('Tab', { code: 'Tab', shiftKey: true });
      assert.equal(document.activeElement, input());
      assert.equal(input().selectionStart, 6);
      for (const key of ['Enter', ' ']) {
        await press('Tab', { code: 'Tab' });
        await press(key, { code: key === ' ' ? 'Space' : 'Enter' });
        assert.equal(document.activeElement, boardList());
        assert.ok(document.getElementById('command-0'), 'real Shift+M Select Board rows are rendered');
        capture(`board-list-${mobile ? 'mobile' : 'desktop'}`);
        assert.equal(requests.length, 0);
        await press('Escape', { code: 'Escape' });
        assert.equal(boardList(), null);
        assert.ok(values.get('showCommandsAtom').show);
        assert.equal(document.activeElement, input());
        assert.equal(input().selectionStart, 6);
      }
      await press('Escape', { code: 'Escape' });
      assert.equal(values.get('showCommandsAtom').show, false);
    });
  }
});

test('board shortcut matches platform footer, filters list, and restores caret after Enter picks', async (t) => {
  for (const apple of [false, true]) {
    await withPalette(t, { boardChip: true, newWindow: true, apple, tab: 'compose', boards: composeBoards, url: '/search', previousBoard: 'project-7' }, async ({ dom, input, type, press, requests }) => {
      assert.match(document.querySelector('[data-compose-task-writer]').textContent, apple ? /CMD\+SHIFT\+B/ : /CTRL\+SHIFT\+B/);
      await type('Still writing');
      input().setSelectionRange(4, 4);
      await press('B', { ...boardKey(apple), shiftKey: false });
      assert.equal(boardList(), null, 'browser bookmark shortcut is not stolen');
      const event = await press('B', boardKey(apple));
      assert.equal(event.defaultPrevented, true);
      assert.equal(document.activeElement, boardList());
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(boardList(), 'Design');
        boardList().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
      assert.equal(document.querySelectorAll('[id^="command-"]').length, 1);
      await press('Enter', { code: 'Enter' });
      await React.act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
      assert.equal(boardList(), null);
      assert.equal(chip().textContent, 'Design');
      assert.equal(document.activeElement, input());
      assert.equal(input().selectionStart, 4);
      assert.equal(requests.length, 0, 'picker Enter must not send the task');
      await press('Enter', { code: 'Enter' });
      assert.equal(requests[0].body.project.id, 9);
    });
  }
});

test('board chip flag off renders exactly clean production Compose on desktop and phone', async (t) => {
  for (const mobile of [false, true]) {
    await withPalette(t, { boardChip: false, newWindow: true, mobile, tab: 'compose', url: '/inbox', previousBoard: 'project-7' }, async ({ baseline, loadedBoards }) => {
      assert.equal(chip(), null);
      assert.equal(loadedBoards.length, 0);
      if (process.env.COMPOSE_BASELINE_DIR) await baseline(process.env.COMPOSE_BASELINE_DIR);
    });
  }
});

test('board list bounds arrows to filtered rows, tolerates no matches, and reveals same-board choice', async (t) => {
  await withPalette(t, { boardChip: true, newWindow: true, tab: 'compose', boards: composeBoards, url: '/project?id=7' }, async ({ dom, input, type, press, requests }) => {
    await type('Do not send from the board list');
    input().setSelectionRange(4, 8, 'backward');
    await press('B', boardKey());
    const filter = async (value) => React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(boardList(), value);
      boardList().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await filter('no matching board');
    await press('ArrowDown', { code: 'ArrowDown' });
    await press('Enter', { code: 'Enter' });
    assert.ok(boardList());
    assert.equal(requests.length, 0);
    await filter('Sandbox');
    await press('ArrowDown', { code: 'ArrowDown' });
    await press('ArrowUp', { code: 'ArrowUp' });
    await press('Enter', { code: 'Enter' });
    assert.equal(boardList(), null);
    assert.equal(chip().textContent, 'QA Sandbox');
    assert.equal(document.activeElement, input());
    assert.deepEqual([input().selectionStart, input().selectionEnd, input().selectionDirection], [4, 8, 'backward']);
    assert.equal(requests.length, 0);
  });
});

test('board chip without a current or remembered board lets the user pick before creating', async (t) => {
  await withPalette(t, { boardChip: true, newWindow: true, tab: 'compose', boards: composeBoards, project: null, url: '/inbox' }, async ({ type, press, requests }) => {
    assert.equal(chip().textContent, 'Choose a board');
    await press('B', boardKey());
    await press('Enter', { code: 'Enter' });
    assert.equal(chip().textContent, 'QA Sandbox');
    await type('Create on the chosen board');
    await press('Enter', { code: 'Enter' });
    assert.equal(requests[0].body.project.id, 7);
  });
});

for (const keepClosedFlag of [false, true]) {
  for (const keepClosed of [false, true]) {
    test(`Ctrl+J creation: keep closed flag=${keepClosedFlag}, preference=${keepClosed}`, async (t) => {
      await withPalette(t, { open: false, newWindow: true, keepClosedFlag, keepClosed }, async ({ press, type, finish, values, set, navigations, cacheAdds }) => {
        await React.act(async () => {
          set('showAIChatInterfaceAtom', false);
          set('aiChatAutoOpenSuppressedAtom', true);
        });
        await press('j', { ctrlKey: true }, document.body);
        await type('Create a task without forcing the chat open');
        await press('Enter');
        await finish();
        assert.equal(cacheAdds.length, 1, 'task creation still succeeds');
        assert.deepEqual(navigations, ['/detail/project-7/44']);
        assert.equal(values.get('showCommandsAtom').show, false, 'creation window closes');
        const prevented = keepClosedFlag && keepClosed;
        assert.equal(values.get('showAIChatInterfaceAtom'), !prevented);
        assert.equal(values.get('aiChatAutoOpenSuppressedAtom'), prevented, 'veto must not clear a previous manual close');
        assert.equal(Boolean(values.get('aiChatExplicitOpenAtAtom')), !prevented);
        assert.equal(values.get('keepAiChatClosedAtom'), keepClosed);
      });
    });
  }
}

test('Ctrl+J uses the latest saved veto if it changes while task creation is pending', async (t) => {
  await withPalette(t, { open: false, newWindow: true, keepClosedFlag: true }, async ({ press, type, finish, values, set, navigations }) => {
    await press('j', { ctrlKey: true }, document.body);
    await type('Create while the preference changes');
    await press('Enter');
    await React.act(async () => {
      set('keepAiChatClosedAtom', true);
      set('showAIChatInterfaceAtom', false);
      set('aiChatAutoOpenSuppressedAtom', true);
    });
    await finish();
    assert.deepEqual(navigations, ['/detail/project-7/44']);
    assert.equal(values.get('showAIChatInterfaceAtom'), false);
    assert.equal(values.get('aiChatAutoOpenSuppressedAtom'), true);
  });
});

test('HTPR-7547 cold Compose receives text and selection from the command focus proxy', async (t) => {
  for (const mobile of [false, true]) {
    await withPalette(t, { tab: 'compose', mobile, preserveColdCommandInput: true, bufferedText: 'draft from cold open' }, async ({ input, focusProxy }) => {
      assert.equal(input().value, 'draft from cold open');
      assert.equal(document.activeElement, input());
      assert.equal(input().selectionStart, 2);
      assert.equal(input().selectionEnd, 5);
      assert.equal(focusProxy.current.value, '', 'the handoff consumes the buffer');
    });
  }
});


test('HTPR-7547 flag off keeps the previous Compose focus behavior', async (t) => {
  for (const mobile of [false, true]) {
    await withPalette(t, { tab: 'compose', mobile, preserveColdCommandInput: false, legacyProxy: true, bufferedText: 'unconsumed legacy proxy' }, async ({ input, focusProxy }) => {
      assert.equal(input().value, '');
      assert.equal(focusProxy.current.value, 'unconsumed legacy proxy');
    });
  }
});


test('HTPR-7547 cold Search Compose handoff preserves drafts with the optimization On, Off or unresolved', async (t) => {
  for (const preserveColdCommandInput of [true, false, undefined]) {
    for (const mobile of [false, true]) {
      const bufferedText = 'first line\nsecond line';
      await withPalette(t, { tab: 'compose', mobile, preserveColdCommandInput, bufferedText }, async ({ input, focusProxy, requests }) => {
        assert.equal(input().value, bufferedText);
        assert.equal(document.activeElement, input());
        assert.equal(input().selectionStart, 2);
        assert.equal(input().selectionEnd, 5);
        assert.equal(focusProxy.current.value, '');
        assert.equal(requests.length, 0, 'transferring a draft does not submit it');
      });
    }
  }
});


test('HTPR-7547 buffered Compose Enter submits the transferred draft once after state commits', async (t) => {
  for (const preserveColdCommandInput of [true, false, undefined]) {
    for (const mobile of [false, true]) {
      const bufferedText = 'first line\nsecond line';
      await withPalette(t, { tab: 'compose', mobile, strict: true, preserveColdCommandInput, bufferedText, pendingEnter: bufferedText }, async ({ requests, rerender, focusProxy }) => {
        assert.equal(requests.length, 1);
        assert.equal(requests[0].body.text, bufferedText);
        assert.equal(focusProxy.pendingEnter, undefined);
        await rerender();
        assert.equal(requests.length, 1, 'rerenders and StrictMode must not resubmit');
      });
    }
  }
});


test('HTPR-7547 buffered Search Enter selects the matching command once after filtering', async (t) => {
  for (const mobile of [false, true]) {
    await withPalette(t, { mobile, bufferedText: 'AI Task Writer', pendingEnter: 'AI Task Writer' }, async ({ values, focusProxy, requests }) => {
      assert.equal(values.get('showCommandsAtom').paletteTab, 'compose');
      assert.equal(focusProxy.pendingEnter, undefined);
      assert.equal(requests.length, 0, 'selecting Compose is not a second Enter in Compose');
    });
  }
});


test('HTPR-7547 a mismatched queued Compose Enter is discarded at handoff, not retained for a later edit', async (t) => {
  for (const mobile of [false, true]) {
    await withPalette(t, { tab: 'compose', mobile, bufferedText: 'draft2', pendingEnter: 'draft' }, async ({ input, type, requests, focusProxy }) => {
      assert.equal(input().value, 'draft2');
      assert.equal(focusProxy.pendingEnter, undefined);
      assert.equal(requests.length, 0);
      await type('draft');
      assert.equal(requests.length, 0, 'editing back to an old Enter snapshot must not submit');
    });
  }
});


test('HTPR-7547 a mismatched queued Search Enter is discarded rather than executed after editing', async (t) => {
  for (const mobile of [false, true]) {
    await withPalette(t, { mobile, bufferedText: 'AI Task Writer2', pendingEnter: 'AI Task Writer' }, async ({ values, focusProxy }) => {
      assert.equal(values.get('showCommandsAtom').paletteTab, 'search');
      assert.equal(focusProxy.pendingEnter, undefined);
    });
  }
});


test('HTPR-7547 flag On preserves the opted-in Compose handoff for existing proxy hosts', async (t) => {
  for (const mobile of [false, true]) {
    await withPalette(t, { tab: 'compose', mobile, preserveColdCommandInput: true, legacyProxy: true, bufferedText: 'existing host draft' }, async ({ input, focusProxy }) => {
      assert.equal(input().value, 'existing host draft');
      assert.equal(focusProxy.current.value, '');
    });
  }
});


test('HTPR-7547 queued Compose Enter submits once when mobile focus lands in a later animation frame', async (t) => {
  for (const strict of [false, true]) {
    for (const preserveColdCommandInput of [true, false, undefined]) {
      const bufferedText = 'first line\nsecond line';
      await withPalette(t, { tab: 'compose', mobile: true, strict, preserveColdCommandInput, bufferedText, pendingEnter: bufferedText, focusFailures: strict ? 2 : 1, deferAnimationFrames: true }, async ({ input, focusProxy, requests, flushAnimationFrame, rerender }) => {
        assert.equal(input().value, bufferedText, 'text commits before the focus retry');
        assert.equal(document.activeElement, focusProxy.current);
        assert.equal(requests.length, 0, 'queued Enter waits for the focus handoff');
        assert.equal(focusProxy.pendingEnter, bufferedText);
        let focusLanded = false;
        input().addEventListener('focus', () => { focusLanded = true; });
        await flushAnimationFrame();
        assert.equal(focusLanded, true, 'the retry focuses Compose before submitting');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].body.text, bufferedText);
        assert.equal(focusProxy.pendingEnter, undefined);
        await rerender();
        assert.equal(requests.length, 1, 'focus changes and StrictMode cannot resubmit');
      });
    }
  }
});

test('three-switch creation marks the new ticket and leaves opening to its page policy', async (t) => {
  await withPalette(t, { open: false, newWindow: true, autoOpenSwitches: true }, async ({ press, type, finish, values, set, navigations }) => {
    await React.act(async () => {
      set('showAIChatInterfaceAtom', false);
      set('aiChatAutoOpenSuppressedAtom', true);
    });
    await press('j', { ctrlKey: true }, document.body);
    await type('Create a ticket with page-specific chat preferences');
    await press('Enter');
    await finish();
    assert.deepEqual(navigations, ['/detail/project-7/44']);
    assert.equal(values.get('aiChatNewTicketPathAtom'), '/detail/project-7/44');
    assert.equal(values.get('showAIChatInterfaceAtom'), false);
    assert.equal(values.get('aiChatAutoOpenSuppressedAtom'), true);
  });
});

for (const modeOutline of [false, true]) for (const mobile of [false, true]) {
  test(`AMOLED mode outline flag ${modeOutline} preserves tab switching on ${mobile ? 'phone' : 'desktop'}`, async (t) => {
    await withPalette(t, { newWindow: true, modeOutline, mobile }, async ({ press, input, values }) => {
      const tabs = document.querySelector('[aria-label="Commands mode"]');
      assert.ok(tabs);
      for (const token of ['[outline:var(--outline-floating-panel)]']) {
        assert.equal(tabs.classList.contains(token), modeOutline);
      }
      await React.act(async () => [...tabs.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.startsWith('New Task')).click());
      assert.equal(values.get('showCommandsAtom').paletteTab, 'compose');
      assert.ok(input());
      await press('Tab', {}, input());
      assert.equal(values.get('showCommandsAtom').paletteTab, 'search');
    });
  });
}

test('HTPR-8140 Ctrl+J dictation shortcut activates its existing microphone and keeps click and draft', async (t) => {
  for (const apple of [false, true]) {
    let starts = 0;
    const AudioButton = (props) => React.createElement('button', {
      id: props.id, 'aria-label': props.ariaLabel, onClick: () => { starts++; },
    }, 'Mic');
    await withPalette(t, { newWindow: true, tab: 'compose', apple, AudioButton }, async ({ flags, rerender, type, press, input, requests }) => {
      flags['htpr-8140-ctrlj-dictation-shortcut'] = true;
      await rerender();
      await type('Keep this draft');
      const modifiers = apple ? { metaKey: true } : { ctrlKey: true };
      const event = await press('D', { ...modifiers, shiftKey: true });
      assert.equal(starts, 1);
      assert.equal(event.defaultPrevented, true);
      assert.equal(input().value, 'Keep this draft');
      await React.act(async () => document.getElementById('compose-task-audio-button').click());
      assert.equal(starts, 2);
      for (const extra of [{ repeat: true }, { isComposing: true }, { altKey: true }, { ctrlKey: true, metaKey: true }, { shiftKey: false }]) {
        const ignored = await press('D', { ...modifiers, shiftKey: true, ...extra });
        assert.equal(ignored.defaultPrevented, false);
      }
      assert.equal(starts, 2);
      await press('k', modifiers);
      await press('D', { ...modifiers, shiftKey: true });
      assert.equal(starts, 2);
      await press('j', modifiers);
      assert.equal(input().value, 'Keep this draft');
      flags['htpr-8140-ctrlj-dictation-shortcut'] = false;
      await rerender();
      const off = await press('D', { ...modifiers, shiftKey: true });
      assert.equal(off.defaultPrevented, false);
      assert.equal(starts, 2);
      assert.equal(requests.length, 0);
    });
  }
});


test('HTPR-8141 board tooltip matches platform footer and preserves picker and flag-off behavior', async (t) => {
  for (const apple of [false, true]) {
    await withPalette(t, { boardChip: true, newWindow: true, apple, tab: 'compose', boards: composeBoards, url: '/my-tasks', previousBoard: 'project-7' }, async ({ flags, rerender, type, press, input }) => {
      const before = chip().outerHTML;
      assert.equal(document.querySelector('[data-tooltip="Change board"]'), null);
      flags['htpr-8141-board-shortcut-tooltip'] = true;
      await rerender();
      assert.equal(document.querySelector('[data-tooltip="Change board"]').textContent, apple ? 'CMD+SHIFT+B' : 'CTRL+SHIFT+B');
      assert.equal(chip().outerHTML, before);
      await type('Keep the draft');
      await React.act(async () => chip().click());
      assert.ok(boardList());
      await press('Escape', { code: 'Escape' });
      assert.equal(input().value, 'Keep the draft');
      await press('B', boardKey(apple));
      assert.ok(boardList());
      await press('Escape', { code: 'Escape' });
      assert.equal(input().value, 'Keep the draft');
      flags['htpr-8141-board-shortcut-tooltip'] = false;
      await rerender();
      assert.equal(document.querySelector('[data-tooltip="Change board"]'), null);
      assert.equal(chip().outerHTML, before);
    });
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
      const runEffect = new Function('useEffect', 'newTaskWindow', 'isApple', 'pathname', 'projectForContext', 'setCommands', 'CommandMode', 'isComposePaletteShortcut', 'closeHandler', 'isMbl', 'closeBackDismissBeforeNavigation', 'composeShortcutCapture', javascript);
      function Probe() { runEffect(React.useEffect, newWindow, false, '/project', selected, (value) => set('showCommandsAtom', value), CommandMode, isComposePaletteShortcut, closeHandler, mobile, closeBackDismissBeforeNavigation, true); return null; }
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

