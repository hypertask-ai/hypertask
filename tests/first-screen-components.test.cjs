const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PassThrough } = require('node:stream');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
require('tsx/cjs');
const React = require('react');
const { renderToString, renderToPipeableStream } = require('react-dom/server');
const { hydrateRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const state = require('../src/lib/state.tsx');
const root = path.resolve(__dirname, '..');
const noop = () => {};
let pathname = '/project';
const user = { id: 985, displayName: 'QA', email: 'qa@example.test', photoURL: '' };
const view = { id: 'default', title: 'Default', slug: 'default' };
const project = { id: 15, title: 'SSR fixture board', name: 'SSR fixture board', section: [], sections: [], project_view: {
  default_view_id: 'default', default_view: view, allViews: [view], user_project_views: [],
} };
const task = { id: 6934, projectId: 15, uniqueIndex: 6934, ticketNumber: 'HTPR-6934', title: 'Same real card', status: 'Normal',
  createdAt: '2026-09-01T00:00:00.000Z', sectionChangedAt: '2026-09-20T00:00:00.000Z', dueDate: '2027-01-01T01:30:00.000Z',
  taskLabels: [{ id: 1, label: { value: 'SSR' } }], subTasks: [], assignees: [], notifications: [] };
const snapshot = { schemaVersion: 1, buildVersion: 'test', scope: { accountId: 985, route: '/project', generation: 'request-A' },
  authorization: { outcome: 'authorized', checkedAt: '2026-10-04T00:30:00.000Z' }, now: '2026-10-04T00:30:00.000Z',
  fetchedAt: '2026-10-04T00:30:00.000Z', flags: { accountId: 985, evaluatedAt: '2026-10-04T00:30:00.000Z', values: { 'htpr-6934-server-first-screen': true } },
  display: { version: 1, accountId: 985, timeZone: 'America/Los_Angeles', locale: 'en-US', boardLayout: 'board',
    theme: 'porcelain', railCollapsed: false, quickTips: false, draftsFirst: false },
  completeness: 'complete', projectsCompleteness: 'active-board-only',
  selection: { view: 'default', surface: 'board', split: 0, focus: null }, data: {} };
const atoms = Object.fromEntries(['currentUserAtom', 'currentProjectAtom', 'mobileTopBarTitleAtom', 'activeBuiltinViewsAtom',
  'agentChatMobileFullscreenAtom', 'mobileCommentComposerOpenAtom', 'showCommandsAtom'].map(key => [key, state.atom({ key: `ssr2-${key}`, default: key === 'activeBuiltinViewsAtom' ? {} : null })]));
const mobile = React.createContext(false);
const cache = new Map();
const mocks = {
  '@/store': atoms,
  '@/lib/state': state,
  'next/dynamic': require('next/dist/shared/lib/app-dynamic').default,
  'next/navigation': { usePathname: () => pathname, useRouter: () => ({ push: noop, refresh: noop }), useSearchParams: () => new URLSearchParams() },
  '@/lib/contexts/mobileContext': { MobileViewContext: mobile, useMobileView: () => React.useContext(mobile) },
  '@/lib/contexts/deviceContext': { useDeviceContext: () => false },
  '@/hooks/useFlag': { useFlag: () => false },
  '@/hooks/Task Detail/useTimeTracking': { useBoardRunningTimers: () => ({ showTimeTotals: false, timers: new Map(), timeTotals: new Map() }) },
  '@/components/PageComponents/TaskDetail/TaskInfoColumn/TaskTime': { useTimerNow: () => Date.parse(snapshot.now), formatElapsed: () => '' },
  '@/hooks/Homepage/Views/useKanbanViews': { __esModule: true, default: () => ({ switchViewHandler: noop, resetView: noop }) },
  '@/hooks/Homepage/Views/useRenderedViews': { __esModule: true, default: () => ({ renderedViews: [view], viewTaskCounts: new Map([['default', 1]]) }) },
  '@/hooks/RecoilRoot/useHypertasksRecoilStates': { __esModule: true, default: () => ({ toggleShowCommands: noop }) },
  '@/components/Modals/Settings/settingsNavigation': { useSettingsNavigation: () => ({ openSettings: noop }) },
  '@/components/ProviderGlobal/useGlobalUIState': { useGlobalUIState: () => ({ showAiChatInterface: false, toggleAIChatInterface: noop, closeAIChatInterface: noop }) },
  '@/hooks/Homepage/useAppShellSurfaceShortcuts': { __esModule: true, default: () => ({ navigateToBoard: noop }) },
  '@/hooks/Inbox/useGetNotifications': { useGetNotificationCount: () => ({ data: { all: 0, unseen: 0 } }) },
  '@/utils/helperFunctions/helperFunctions': { convertToPlain: html => { const div = document.createElement('div'); div.innerHTML = html; return div.textContent; } },
  '@/lib/contexts/Inbox/BulkSelectionContext': { useBulkSelectionContext: () => ({ selectedNotifications: [] }) },
  '@/hooks/General/useGetUserDrafts': { USER_DRAFTS_QUERY_KEY: id => ['userDrafts', id] },
};
// Load the production markup. Only network/lifecycle services and closed overlays
// are replaced; the card, row, chips, avatars, links and DnD are real components.
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const loadedModule = { exports: {} }; cache.set(file, loadedModule);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    transformers: { before: [() => source => ts.factory.updateSourceFile(source, [
      ...source.statements.filter(ts.isImportDeclaration), ...source.statements.filter(s => !ts.isImportDeclaration(s)),
    ])] },
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    if (mocks[id]) return mocks[id];
    if (/Tooltip$|RemindMeComponent$|HTCButton$/.test(id)) return { __esModule: true, default: () => null };
    if (id.startsWith('@/') || id.startsWith('.')) {
      const base = id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : path.resolve(path.dirname(file), id);
      const target = [base + '.tsx', base + '.ts', path.join(base, 'index.tsx'), path.join(base, 'index.ts')].find(fs.existsSync);
      assert.ok(target, `resolve ${id}`); return load(target);
    }
    return createRequire(file)(id);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const { FirstScreenSurfaceProvider, useFirstScreenSurface } = load(path.join(root, 'src/lib/firstScreen/SurfaceContext.tsx'));
const Card = load(path.join(root, 'src/components/PageComponents/Kanban/KanbanTaskComponents/KanbanTaskCard.tsx')).default;
const Row = load(path.join(root, 'src/components/notifications/NotificationRow.tsx')).default;
const { NotificationProvider } = load(path.join(root, 'src/lib/contexts/NotificationContext.tsx'));
const Chrome = load(path.join(root, 'src/components/Global/FirstScreenMobileChrome.tsx')).default;
const Draft = load(path.join(root, 'src/components/notifications/InboxDraftRow.tsx')).default;
const { createTableRowRenderer } = load(path.join(root, 'src/components/PageComponents/Kanban/TableView/TableTaskRow.tsx'));
const { DragDropContext, Droppable, Draggable } = require('@hello-pangea/dnd');
function wrap(child, seed = snapshot, phone = false) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, gcTime: 0 } } });
  const inner = React.createElement(QueryClientProvider, { client }, React.createElement(state.StateRoot, {
    initialValues: [[atoms.currentUserAtom, user], [atoms.currentProjectAtom, project]],
  }, React.createElement(mobile.Provider, { value: phone }, child)));
  return seed ? React.createElement(FirstScreenSurfaceProvider, { snapshot: seed }, inner) : inner;
}
function card(provided) {
  return React.createElement(Card, { task, project, provided, currentSetting: 'None', assignedUsers: [], agentAssignees: [],
    active: false, hover: false, hasDraft: false, selected: false, openDetail: noop, updateActiveItemAndItemInView: noop,
    setShowAssignModal: noop, setShowEstimateModal: noop, setShowPriorityModal: noop, setShowCreateLabelModal: noop,
    toggleDueDate: noop, toggleDelete: noop, markTaskAsDone: noop, archiveNotificationCallback: noop, handleStarTask: noop,
    eHandler: noop, onParentTaskClick: noop, onSubtaskClick: noop });
}
function board() {
  return React.createElement(DragDropContext, { onDragEnd: noop }, React.createElement(Droppable, { droppableId: '0' }, provided =>
    React.createElement('section', { ...provided.droppableProps, ref: provided.innerRef },
      React.createElement(Draggable, { draggableId: `task-${task.id}`, index: 0 }, drag => card(drag)), provided.placeholder)));
}
function row(type) {
  const notification = { id: 42, userId: 985, type, createdAt: '2026-10-03T23:30:00.000Z', seen: false,
    fromUser: { displayName: 'Sender', photoURL: '' }, task, commentId: type === 'Mentioned' ? 1 : undefined,
    comment: { text: '<p>Before <span data-type="mention" data-label="name-985">QA</span> after &amp; more</p>' },
    reaction: { emoji: '👍' }, message: '<p>Agent &amp; team</p>' };
  return React.createElement(NotificationProvider, { notification, isIbxSlctd: false, selectedSplit: 'All', displayAvatar: 'Show' },
    React.createElement(Row, { index: 0, selected: false, taskRef: { current: null }, disableButtons: true,
      markAsDone: noop, openTask: noop, handleMouseLeave: noop, handleMouseEnter: noop, eHandler: noop }));
}
function draft() {
  const value = { id: 1, task, content: '<p>Same draft preview</p>', updatedAt: '2026-10-03T23:30:00.000Z' };
  return React.createElement(Draft, { draft: value, activeDrafts: [value], userId: 985, selected: false, onFocus: noop, onOpen: noop });
}
function table() {
  const columns = ['ticket', 'title', 'labels', 'due', 'inColumn', 'noComment', 'onBoard', 'created', 'updated'];
  const { renderTaskRow } = createTableRowRenderer({ snapshot, selectedIndex: -1, dragOverSectionId: null,
    currentProjectSectionIds: new Set(), sortState: [], customFieldBySortColumn: new Map(), frozenColumnOffset: () => 0,
    getTicketText: () => 'HTPR-6934', _currentProject: project, sectionTitleBySid: new Map(), timeTotals: new Map(),
    timeNow: Date.parse(snapshot.now), draggedTaskRef: { current: null }, clearTaskDrag: noop, handleMouseEnter: noop,
    handleMouseLeave: noop, gridTemplateColumns: '90px minmax(200px,1fr) repeat(7,100px)', openTask: noop,
    enableMyTasksBulkSelection: false, visibleColumns: columns.map(key => ({ key })) });
  return React.createElement('ul', null, renderTaskRow(task, 0));
}
function stream(tree) {
  return new Promise((resolve, reject) => {
    const output = new PassThrough(); const chunks = [];
    output.on('data', chunk => chunks.push(chunk)); output.on('end', () => resolve(Buffer.concat(chunks).toString()));
    const rendered = renderToPipeableStream(tree, { onAllReady() { rendered.pipe(output); }, onError: reject });
  });
}
async function hydrate(tree, html) {
  const dom = new JSDOM(`<!doctype html><div id="root">${html}</div>`, { url: 'https://example.test/project', pretendToBeVisual: true });
  const keys = ['self', 'window', 'document', 'HTMLElement', 'Element', 'Node', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = Object.fromEntries(keys.map(key => [key, global[key]]));
  Object.assign(global, { self: dom.window, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    Node: dom.window.Node, ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.scrollBy = noop;
  const errors = []; let instance;
  const before = document.getElementById('root').innerHTML;
  const nodes = [...document.querySelectorAll('#root a, #root button, #root [id^="task-"], #root [id^="inbox-"]')];
  try {
    await React.act(async () => { instance = hydrateRoot(document.getElementById('root'), tree, { onRecoverableError: error => errors.push(error.message) }); });
    assert.deepEqual(errors, []);
    const after = document.getElementById('root').innerHTML;
    const structure = text => {
      const container = document.createElement('div'); container.innerHTML = text;
      const visit = node => node.nodeType === 3 ? node.textContent : node.nodeType !== 1 ? null : {
        tag: node.tagName,
        attributes: [...node.attributes].map(attribute => [attribute.name, attribute.name === 'style'
          ? [...node.style].sort().map(name => [name, node.style.getPropertyValue(name).trim(), node.style.getPropertyPriority(name)]) : attribute.value]).sort(),
        children: [...node.childNodes].map(visit).filter(child => child !== null),
      };
      return visit(container);
    };
    assert.deepEqual(structure(after), structure(before), 'DOM, text and CSS declarations must be identical');
    assert.deepEqual(nodes.filter(node => !node.isConnected).map(node => node.outerHTML), [], 'hydration must attach to existing nodes');
  } finally {
    if (instance) await React.act(async () => instance.unmount());
    dom.window.close();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
}

function serverFixture(name) {
  return JSON.parse(execFileSync(process.execPath, [__filename], {
    env: { ...process.env, FIRST_SCREEN_SSR_FIXTURE: name }, encoding: 'utf8',
  }));
}

// Server and browser are separate runtimes in production. Keep their React
// renderer ownership separate here too, rather than muting context warnings.
if (process.env.FIRST_SCREEN_SSR_FIXTURE) {
  const fixture = process.env.FIRST_SCREEN_SSR_FIXTURE;
  pathname = fixture.includes('inbox') || fixture.startsWith('row:') || fixture === 'draft' ? '/inbox' : '/project';
  const seed = { ...snapshot, scope: { ...snapshot.scope, route: pathname } };
  const render = async () => {
    if (fixture === 'parallel') {
      const trees = [wrap(board()), wrap(board(), { ...snapshot, scope: { ...snapshot.scope, generation: 'request-B' } })];
      const [a, b] = await Promise.all(trees.map(stream));
      return [a, b, await stream(trees[0])];
    }
    const child = fixture === 'card' ? card() : fixture === 'table' ? table() : fixture === 'draft' ? draft() : fixture.startsWith('row:') ? row(fixture.slice(4)) : React.createElement(Chrome, { currentUser: user });
    return stream(wrap(child, seed, fixture.startsWith('chrome:')));
  };
  if (fixture.startsWith('chrome:')) {
    const OriginalDate = Date;
    global.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [snapshot.now])); } };
  }
  render().then(html => process.stdout.write(JSON.stringify(html))).catch(error => { console.error(error); process.exitCode = 1; });
} else {
test('seeded card SSR uses the existing native link, metadata and identical hydration nodes', async () => {
  pathname = '/project';
  const tree = wrap(card()); const html = serverFixture('card');
  assert.match(html, /Same real card/); assert.match(html, /href="\/detail\/project-15\/6934"/); assert.match(html, /Dec 31/);
  await hydrate(tree, html);
});

test('populated inbox rows SSR and hydrate identically without document parsing or suppressed recovery', async () => {
  pathname = '/inbox';
  for (const type of ['Comment', 'Mentioned', 'Assigned', 'TaskDueDate', 'Reacted', 'AgentMessage']) {
    const seed = { ...snapshot, scope: { ...snapshot.scope, route: '/inbox' } };
    const tree = wrap(row(type), seed); const html = serverFixture(`row:${type}`);
    assert.match(html, /Same real card/);
    if (type === 'Comment' || type === 'Mentioned') assert.match(html, /Before/);
    if (type === 'Mentioned') assert.match(html, /bg-mention-highlight/);
    await hydrate(tree, html);
  }
});

test('seeded table and draft rows keep every date, age, preview and existing hydration node', async () => {
  for (const [fixture, child, route] of [['table', table(), '/project'], ['draft', draft(), '/inbox']]) {
    pathname = route;
    const seed = { ...snapshot, scope: { ...snapshot.scope, route } };
    const html = serverFixture(fixture);
    assert.match(html, /Same real card/);
    assert.match(html, fixture === 'table' ? /33d/ : /Same draft preview/);
    await hydrate(wrap(child, seed), html);
  }
});

test('parallel and interleaved SSR DnD requests have stable request-local context IDs and hydrate the same wrappers', async () => {
  pathname = '/project';
  const trees = [wrap(board()), wrap(board(), { ...snapshot, scope: { ...snapshot.scope, generation: 'request-B' } })];
  const [a, b, repeated] = serverFixture('parallel');
  assert.equal(a, b); assert.match(a, /data-rfd-draggable-id="task-6934"/);
  assert.equal(repeated, a);
  await hydrate(trees[0], a);
});

test('mobile chrome reuses named board header and dock markup, while inbox keeps its own split dock', async () => {
  const OriginalDate = Date;
  global.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [snapshot.now])); } };
  try {
    for (const route of ['/project', '/inbox']) {
      pathname = route;
      const seed = { ...snapshot, scope: { ...snapshot.scope, route } };
      const tree = wrap(React.createElement(Chrome, { currentUser: user }), seed, true);
      const html = serverFixture(`chrome:${route}`);
      assert.match(html, /calc\(48px \+ env\(safe-area-inset-top\)\)/);
      assert.match(html, route === '/project' ? /SSR fixture board/ : /Inbox/);
      assert.equal(html.includes('aria-label="Primary navigation"'), route === '/project');
      await hydrate(tree, html);
    }
  } finally { global.Date = OriginalDate; }
});

test('unseeded, mismatched-account, flag-off, unknown-preference and off-route chrome does not take ownership', async () => {
  pathname = '/project';
  const child = React.createElement(Chrome, { currentUser: user });
  assert.equal(renderToString(wrap(child, null)), '');
  for (const seed of [{ ...snapshot, scope: { ...snapshot.scope, accountId: 7 } }, { ...snapshot, display: {} },
    { ...snapshot, flags: { ...snapshot.flags, values: {} } }]) assert.equal(renderToString(wrap(child, seed)), '');
  pathname = '/detail/project-15/6934';
  assert.equal(renderToString(wrap(child)), '');
  function Ownership() { return React.createElement('output', null, String(Boolean(useFirstScreenSurface(985)))); }
  assert.equal(renderToString(wrap(React.createElement(Ownership))), '<output>false</output>');
});

test('integration retains the old import/readiness path, offscreen policy and global live owners', () => {
  const source = name => fs.readFileSync(path.join(root, name), 'utf8');
  const section = source('src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx');
  assert.match(section, /const SeededTask = dynamic\(\(\) => import\("..\/KanbanTaskComponents\/task"\)\)/);
  assert.match(section, /const Task = dynamic\(loadTask, \{\s*ssr: false/);
  assert.match(section, /const TaskRenderer = seeded \? SeededTask : Task/);
  assert.match(section, /\[taskModuleReady, setTaskModuleReady\] = useState\(seeded\)/);
  assert.match(section, /\(!seeded && typeof IntersectionObserver === "undefined"\)/);
  const global = source('src/components/ProviderGlobal/GloablProviders.tsx');
  assert.match(global, /!routeOwnsMobileChrome && <MobileTopBar/);
  assert.match(global, /!routeOwnsMobileChrome && showMobileBottomNav/);
  assert.match(global, /mobileCreateTaskButtonVisible && <MobileCreateTaskButton/);
  assert.match(global, /mobilePullCommandVisible && \(\s*<MobilePullDownCommand/);
  assert.match(global, /<CachedTaskDetailNavigation accountId={authenticatedUserId}>/);
  for (const page of ['src/app/layout.tsx', 'src/utils/Providers.tsx', 'src/app/[...boardURL]/page.tsx', 'src/app/inbox/page.tsx']) {
    assert.doesNotMatch(source(page), /FirstScreenSurfaceProvider|initialFlags=|initialValues=/, `${page} must stay unseeded`);
  }
});

}
