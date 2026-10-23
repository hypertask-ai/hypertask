process.env.FEATURE_FLAG_TYPESCRIPT_PATH = require.resolve("typescript");
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
require('tsx/cjs');
const { parseBoardDisplay } = require('../src/lib/firstScreen/boardDisplay.ts');
const { DEFAULT_TABLE_COLUMNS } = require('../src/utils/helperFunctions/Views/TableColumnsHelperFunctions.ts');
const { AI_CHAT_SIDEBAR_MIN_PX } = require('../src/lib/configs/style.config.ts');
const root = path.resolve(__dirname, '..');
const flagKey = 'htpr-7406-desktop-server-board';
const display = { version: 1, accountId: 985, timeZone: 'UTC', locale: 'en-US', boardLayout: 'board', theme: 'porcelain',
  railCollapsed: true, quickTips: true, draftsFirst: false, isMobile: false,
  board: { railOn: true, showEmptyViewTabs: false, hiddenViewTabIds: {}, viewTabsOrder: {}, tableColumns: DEFAULT_TABLE_COLUMNS,
    tableWidths: {}, tableTitleWrap: true, openChat: true, chatSuppressed: false, chatPinned: false,
    chatWidth: 517, chatSidebarMode: true } };
const parse = (value = display, options = { desktopChat: true }) => parseBoardDisplay(JSON.stringify(value), 985, options);
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
function load(file, mocks) {
  const exports = {};
  new Function('require', 'exports', transpile(read(file)))(name => {
    assert.ok(Object.hasOwn(mocks, name), name);
    return mocks[name];
  }, exports);
  return exports;
}

test('desktop open and pinned chat require explicit opt-in with saved geometry; phones keep their existing path', () => {
  assert.ok(parse());
  assert.equal(parse(display, {}), null);
  assert.ok(parse({ ...display, board: { ...display.board, openChat: false, chatPinned: true, chatSidebarMode: false } }));
  assert.equal(parse({ ...display, board: { ...display.board, openChat: false, chatPinned: true } }, {}), null);
  const { chatWidth, chatSidebarMode, ...board } = display.board;
  assert.ok(parse({ ...display, isMobile: true, board }, {}));
  assert.ok(parse({ ...display, isMobile: true, board }));
  assert.ok(parse({ ...display, board: { ...board, chatSuppressed: true } }, {}));
});

test('chat geometry validates presence, finite width bounds and boolean mode without breaking old cookies', () => {
  assert.ok(parse());
  for (const key of ['chatWidth', 'chatSidebarMode']) {
    const board = { ...display.board };
    delete board[key];
    assert.equal(parse({ ...display, board }), null, key);
  }
  for (const chatWidth of [AI_CHAT_SIDEBAR_MIN_PX - 1, 2001, null, '517']) {
    assert.equal(parse({ ...display, board: { ...display.board, chatWidth } }), null, String(chatWidth));
  }
  assert.equal(parseBoardDisplay(JSON.stringify(display).replace('517', '1e400'), 985, { desktopChat: true }), null);
  for (const chatSidebarMode of [null, 1, 'true']) {
    assert.equal(parse({ ...display, board: { ...display.board, chatSidebarMode } }), null);
  }
  for (const chatWidth of [AI_CHAT_SIDEBAR_MIN_PX, 2000]) {
    assert.ok(parse({ ...display, board: { ...display.board, chatWidth } }));
  }
  const { chatWidth, chatSidebarMode, ...board } = display.board;
  assert.ok(parse({ ...display, board: { ...board, openChat: false } }, {}));
  assert.equal(parse({ ...display, isMobile: true, board: { ...board, chatWidth: 0 } }), null);
});

const atoms = new Proxy({}, { get: (_, key) => key });
function reservations(overrides = {}, width = 517, sidebar = true) {
  const { usePageLoadReservations } = load('src/hooks/General/usePageLoadReservations.ts', {
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/definitions/htpr-7650-ai-chat-open-switches": { HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG: "htpr-7650-ai-chat-open-switches" },
    '@/hooks/General/useKeepAiChatClosed': { useKeepAiChatClosed: () => ({ keepAiChatClosed: false, ready: true }) },
    '@/lib/state': { useRecoilValue: atom => ({ aiChatPinnedAtom: false, openAiChatByDefaultAtom: true,
      isAiChatSidebarModeAtom: sidebar, aiChatSidebarWidthPxAtom: width })[atom] },
    '@/store': atoms,
    '@/lib/configs/style.config': { AI_CHAT_SIDEBAR_MIN_PX },
    '@/components/Global/mobileShellVisibility': { shouldShowMobileTabBar: () => true, shouldShowMobileDock: () => true,
      shouldShowMobilePrimaryDock: () => true, isTicketPagePath: () => false },
  });
  return usePageLoadReservations({ mbl: false, pathname: '/project', authenticatedUserId: 985, currentUserId: 985,
    showAiChatInterface: false, aiChatAutoOpenSuppressed: false, commentComposerOpen: false,
    agentChatHidesMobileShell: false, reserveBoardChat: true, ...overrides });
}

test('board reservation uses actual desktop sidebar width, never mobile or floating chat, and preserves detail reservations', () => {
  assert.equal(reservations().sidebarWidthPx, 517);
  assert.equal(reservations({}, 1).sidebarWidthPx, AI_CHAT_SIDEBAR_MIN_PX);
  assert.equal(reservations({ mbl: true }).sidebarWidthPx, 0);
  assert.equal(reservations({}, 517, false).sidebarWidthPx, 0);
  assert.equal(reservations({ reserveBoardChat: false }).sidebarWidthPx, 0);
  assert.equal(reservations({ reserveBoardChat: false, showAiChatInterface: true }).sidebarWidthPx, 517);
  assert.equal(reservations({ reserveBoardChat: false, pathname: '/detail/15/1' }).sidebarWidthPx, 517);
});

test('board snapshot seeds width and sidebar mode before server render while legacy cookies keep atom defaults', () => {
  const source = read('src/utils/Providers.tsx');
  const body = source.slice(source.indexOf('const boardInitialValues ='), source.indexOf('const inboxInitialValues ='));
  const names = [...new Set(body.match(/\b\w+Atom\b/g))];
  const initial = new Function(...names, transpile(body) + '\nreturn boardInitialValues;')(...names);
  const snapshot = board => ({ display: { ...display, board }, data: { user: { id: 985 }, projects: { updatedProjects: [{ id: 15 }] } },
    selection: { surface: 'board' } });
  for (const chatSidebarMode of [true, false]) {
    const values = new Map(initial(snapshot({ ...display.board, chatSidebarMode })));
    assert.equal(values.get('aiChatSidebarWidthPxAtom'), 517);
    assert.equal(values.get('isAiChatSidebarModeAtom'), chatSidebarMode);
  }
  const { chatWidth, chatSidebarMode, ...board } = display.board;
  assert.equal(new Map(initial(snapshot(board))).has('aiChatSidebarWidthPxAtom'), false);
});

test('reservation latch requires the flagged authenticated desktop board snapshot and never rearms after open or navigation', () => {
  const source = read('src/components/ProviderGlobal/GloablProviders.tsx');
  const start = source.indexOf('  const [reserveBoardChat, setReserveBoardChat]');
  assert.notEqual(start, -1);
  const body = source.slice(start, source.indexOf('  const setShowAiChatInterface', start));
  const render = new Function('useState', 'useEffect', 'firstScreen', 'pathname', 'mbl', 'authenticatedUserId',
    'chatAutoOpenReady', 'keepAiChatClosed', 'aiChatPinned', 'openAiChatByDefault', 'aiChatAutoOpenSuppressed', 'showAiChatInterface',
    'HTPR_7406_DESKTOP_SERVER_BOARD_FLAG', 'aiChatOpenSwitchesEnabled', transpile(body) + '\nreturn reserveBoardChat;');
  const snapshot = { scope: { route: '/project' }, flags: { values: { [flagKey]: true } } };
  const initial = { firstScreen: snapshot, pathname: '/project', mbl: false, authenticatedUserId: 985,
    chatAutoOpenReady: true, keepAiChatClosed: false, aiChatPinned: false, openAiChatByDefault: true, aiChatAutoOpenSuppressed: false, showAiChatInterface: false };
  function harness() {
    let state;
    return overrides => {
      const input = { ...initial, ...overrides };
      const effects = [];
      const result = render(init => { if (state === undefined) state = init(); return [state, value => { state = value; }]; },
        effect => effects.push(effect), ...Object.values(input), flagKey, false);
      effects.forEach(effect => effect());
      return result;
    };
  }
  assert.equal(harness()(), true);
  for (const overrides of [{ firstScreen: null }, { pathname: '/inbox' }, { mbl: true }, { authenticatedUserId: null },
    { keepAiChatClosed: true }, { chatAutoOpenReady: false }, { openAiChatByDefault: false }, { aiChatAutoOpenSuppressed: true },
    { firstScreen: { ...snapshot, scope: { route: '/inbox' } } },
    { firstScreen: { ...snapshot, flags: { values: { [flagKey]: false } } } }]) {
    assert.equal(harness()(overrides), false, JSON.stringify(overrides));
  }
  assert.equal(harness()({ aiChatPinned: true, openAiChatByDefault: false, aiChatAutoOpenSuppressed: true }), true);
  for (const release of [{ showAiChatInterface: true }, { pathname: '/inbox' }]) {
    const update = harness();
    assert.equal(update(), true);
    update(release);
    assert.equal(update(), false);
  }
  const guard = source.slice(source.indexOf('  let reserveFlaggedBoardChat'), source.indexOf('  const { sidebarWidthPx'));
  const reserve = new Function('useFlag', 'reserveBoardChat', 'HTPR_7406_DESKTOP_SERVER_BOARD_FLAG', 'aiChatOpenSwitchesEnabled',
    transpile(guard) + '\nreturn reserveFlaggedBoardChat;');
  assert.equal(reserve(() => false, true, flagKey, false), false);
  assert.equal(reserve(() => true, false, flagKey, false), false);
  assert.equal(reserve(() => true, true, flagKey, false), true);
  assert.equal(reserve(() => true, true, flagKey, true), false);
});

test('server board reservation renders the existing empty chat slot at its final width before panels exist', () => {
  const width = reservations().sidebarWidthPx;
  assert.equal(width, 517);
  const { default: Layout } = load('src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx', {
    react: React, '@/hooks/useFlag': { useFlag: () => true, useFlagLoaded: () => true },
    '@/lib/flags/keys': {}, 'next/navigation': { usePathname: () => '/project' },
    'lucide-react': { ChevronLeft: () => null }, '@/components/Common/Tooltip': { __esModule: true, default: () => null },
    '@/lib/contexts/mobileContext': { MobileViewContext: React.createContext(false) },
    '@/utils/undoActions/helperFuncs': { cn: (...parts) => parts.filter(Boolean).join(' ') },
  });
  const html = renderToStaticMarkup(React.createElement(Layout, { sidebarWidthPx: width, onOpenAIChat: () => {} }, 'board'));
  assert.match(html, /data-ai-chat-slot="true"[^>]*style="width:517px"/);
});

test('new flag is discovered from its single client-safe definition with an Everyone improvement default', async () => {
  const filename = `src/lib/flags/definitions/${flagKey}.ts`;
  const { parseFlagFile } = await import('../.github/scripts/feature-flag-registry.mjs');
  const { definition } = parseFlagFile(read(filename), filename);
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, 'improvement');
  assert.equal(definition.defaultMode, 'EVERYONE');
  assert.equal(definition.shippedOn, '2026-10-20');
  assert.deepEqual(definition.related, ['htpr-6934-server-first-screen']);
  assert.equal(definition.releaseRisk.risk, 'small');
});

test('keep-chat-closed cookie is optional for old clients and validates new persisted booleans', () => {
  assert.ok(parse());
  for (const keepChatClosed of [false, true]) {
    const parsed = parse({ ...display, board: { ...display.board, keepChatClosed } });
    assert.equal(parsed.board.keepChatClosed, keepChatClosed);
  }
  for (const keepChatClosed of [null, 1, 'true']) {
    assert.equal(parse({ ...display, board: { ...display.board, keepChatClosed } }), null);
  }
});

test('board and inbox snapshots carry keep-chat-closed before hydration without changing default-open preference', () => {
  const source = read('src/utils/Providers.tsx');
  for (const [start, end, name] of [
    ['const boardInitialValues =', 'const inboxInitialValues =', 'boardInitialValues'],
    ['const inboxInitialValues =', 'function isPublicSharePath', 'inboxInitialValues'],
  ]) {
    const body = source.slice(source.indexOf(start), source.indexOf(end));
    const names = [...new Set(body.match(/\b\w+Atom\b/g))];
    const initial = new Function(...names, transpile(body) + `\nreturn ${name};`)(...names);
    for (const keepChatClosed of [undefined, false, true]) {
      const values = new Map(initial({ display: { ...display, board: { ...display.board, keepChatClosed } },
        data: { user: { id: 985 }, projects: { updatedProjects: [{ id: 15 }] } }, selection: { surface: 'board' } }));
      assert.equal(values.get('keepAiChatClosedAtom'), keepChatClosed ?? false);
      assert.equal(values.get('openAiChatByDefaultAtom'), true);
    }
  }
});
