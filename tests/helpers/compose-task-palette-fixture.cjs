const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test: nodeTest, after } = require('node:test');
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
const esbuild = require('esbuild');
const query = require('@tanstack/react-query');
const root = path.resolve(__dirname, '../..');
const babelJiti = createJiti(__filename, { jsx: { runtime: 'automatic' } });
const loaders = { '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx', '.jsx': 'jsx', '.js': 'jsx' };
const transform = (options) => {
  if (options.source.includes('import.meta')) return { code: babelJiti.transform(options) };
  try {
    return { code: esbuild.transformSync(options.source, { loader: loaders[path.extname(options.filename)] ?? 'js', format: 'cjs', jsx: 'automatic', sourcefile: options.filename }).code };
  } catch {
    return { code: babelJiti.transform(options) };
  }
};
const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: path.join(require('node:os').tmpdir(), 'jiti-compose-task-palette'), extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'], jsx: { runtime: 'automatic' }, transform });
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
const declaredStubTargets = [
  '@tanstack/react-query',
  'axios',
  'next/dynamic',
  'next/navigation',
  'nookies',
  'react-circular-progressbar/dist/styles.css',
  'src/app/detail/[...slug]/TaskDetailComp.tsx',
  'src/app/unauthorized/page.tsx',
  'src/components/Common/AttachmentsUpload/ImageGalleryView.tsx',
  'src/components/Common/AttachmentsView/index.tsx',
  'src/components/Common/CommonModalComponents/index.tsx',
  'src/components/Common/Tooltip.tsx',
  'src/components/Modals/Common Modals/ConfirmActionModal.tsx',
  'src/components/Modals/Sheets/AppSheet.tsx',
  'src/components/Modals/Sheets/index.ts',
  'src/components/Modals/commands/HTC/AllCommands.ts',
  'src/components/Modals/commands/HTC/CommandGroup.tsx',
  'src/components/PageComponents/Interactive-Onboarding/Components/TutorialTip.tsx',
  'src/components/PageComponents/TaskDetail/AI Task Writer/AITaskWriterContainer.tsx',
  'src/components/PageComponents/TaskDetail/CommentAndDescription/BackgroundTaskAttachments.tsx',
  'src/components/PageComponents/TaskDetail/CommentAndDescription/ContextMenu/QuoteButton.tsx',
  'src/components/PageComponents/TaskDetail/CommentAndDescription/ContextMenu/index.tsx',
  'src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptionEditorSlot.tsx',
  'src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/InnerHtmlDescription.tsx',
  'src/components/PageComponents/TaskDetail/TopRow/CreateSummaryButton.tsx',
  'src/components/PageComponents/TaskDetail/TopRow/RunningTimerIndicator.tsx',
  'src/components/RTE/Components/AudioButton.tsx',
  'src/components/RTE/Components/EmojiGifPicker.tsx',
  'src/components/RTE/Components/TiptapBubbleMenu.tsx',
  'src/components/RTE/Components/TiptapMainContainer.tsx',
  'src/components/RTE/TipTapTaskDetail.tsx',
  'src/components/RTE/Tiptap.ts',
  'src/hooks/General/useAutosizeTextarea.ts',
  'src/hooks/General/useCurrentUserCheckFromCookies.tsx',
  'src/hooks/General/useDebounce.jsx',
  'src/hooks/General/useGetUserPreferences.tsx',
  'src/hooks/General/useHasDrafts.ts',
  'src/hooks/General/useMobileVisualViewport.ts',
  'src/hooks/General/useProjectQuery.ts',
  'src/hooks/MultiPages/HTC/useHTC.tsx',
  'src/hooks/MultiPages/Route/useHypertasksNavigate.ts',
  'src/hooks/MultiPages/useAddDeleteTaskInBoards.tsx',
  'src/hooks/MultiPages/useClickOutside.ts',
  'src/hooks/MultiPages/useGetAllProjectsMinimal.ts',
  'src/hooks/MultiPages/useUpdateTaskInBoards.tsx',
  'src/hooks/RecoilRoot/useHypertasksRecoilStates.ts',
  'src/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent.ts',
  'src/hooks/useFlag.tsx',
  'src/lib/ai/composeTask.ts',
  'src/lib/constants/index.ts',
  'src/lib/contexts/TaskDetail/DescriptionProvider.tsx',
  'src/lib/contexts/TaskDetail/FollowersProvider.tsx',
  'src/lib/contexts/TaskDetail/TaskProvider.tsx',
  'src/lib/contexts/TaskDetail/TiptapProvider.tsx',
  'src/lib/contexts/TourContext.tsx',
  'src/lib/contexts/deviceContext.tsx',
  'src/lib/contexts/mobileContext.tsx',
  'src/lib/createTaskAttachmentUploads.ts',
  'src/lib/deriveCurrentBoardBilling.ts',
  'src/lib/flags/definitions/htpr-7800-skill-runs-in-sidebar.ts',
  'src/lib/state.tsx',
  'src/lib/storage/uploadViaApi.ts',
  'src/store/currentPageActions.ts',
  'src/store/index.ts',
  'src/styles/AttachmentView.scss',
  'src/styles/linksModal.module.scss',
  'src/utils/api/Task Detail/index.ts',
  'src/utils/api/ai_chat/index.ts',
  'src/utils/api/global/apiHelpers/createTaskGloballycontroller.ts',
  'src/utils/api/global/index.ts',
  'src/utils/helperFunctions/Views/ViewsHelperFunctions.ts',
  'src/utils/helperFunctions/helperFunctions.ts',
  'src/utils/undoActions/helperFuncs.ts',
];
const stubTargets = [...new Set([
  ...[...fs.readFileSync(__filename, 'utf8').matchAll(/\b(?:source\('([^']+)'|stub\(require\.resolve\('([^']+)'\))/g)]
    .map(([, file, id]) => file ? path.join(root, file) : require.resolve(id)),
  ...declaredStubTargets.map((target) => target.startsWith('src/') ? path.join(root, target) : require.resolve(target)),
])];
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
    cacheSlot(filename, undefined);
    try {
      const loaded = jiti(filename);
      realModules.set(filename, loaded === proxy?.exports ? {} : loaded);
    } catch {
      realModules.set(filename, {});
    } finally {
      if (proxy) cacheSlot(filename, proxy);
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

after(() => {
  setupStubs.clear();
  testStubs.clear();
  pinned.clear();
  realModules.clear();
  for (const filename of stubTargets) if (isAppSource(filename) || proxies.get(filename) === require.cache[filename]) cacheSlot(filename, undefined);
  proxies.clear();
});

module.exports = { assert, fs, path, React, query, root, jiti, test, withPalette, flag, newFlag, tooltipFlag, keepClosedFlag, boardChipFlag };
