const watchdog = setTimeout(() => {
  console.error('[htpr-7627 watchdog] still alive after 5 minutes', __filename, JSON.stringify(process.getActiveResourcesInfo()),
    process._getActiveHandles().map(handle => handle?.constructor?.name));
  process.exit(1);
}, 5 * 60_000);
watchdog.unref();
console.error('[htpr-7627 watchdog] start', __filename);
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { hydrateRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const { QueryClientProvider } = require('@tanstack/react-query');
const ts = require('typescript');
require('tsx/cjs');
const root = path.resolve(__dirname, '..');
function load(relative, mocks = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)(name => name in mocks ? mocks[name] : require(name), exports);
  return exports;
}
const hydration = load('src/hooks/General/useHydrated.ts');
const state = load('src/lib/state.tsx', { '@/hooks/General/useHydrated': hydration });
const mobile = load('src/lib/contexts/mobileContext.tsx', { '@/hooks/General/useHydrated': hydration });
const flags = load('src/hooks/useFlag.tsx', {
  '@/hooks/General/useHydrated': hydration,
  '@/lib/realtime/client': { connectRealtimeClient: async () => null, releaseRealtimeClientIfIdle() {} },
  '@/lib/realtime/shared': { FEATURE_FLAGS_EVENT: 'flags', featureFlagsChannel: () => 'flags' },
});
let pathname = '/detail/project-15/7627';
const navigation = { usePathname: () => pathname, useSearchParams: () => new URLSearchParams() };
const surface = load('src/lib/firstScreen/SurfaceContext.tsx', { 'next/navigation': navigation,
  './contract': require('../src/lib/firstScreen/contract.ts') });
const atomNames = ['globalNotificationFocusAtom', 'currentUserAtom', 'currentProjectAtom', 'boardLayoutAtom', 'boardLayoutPreferenceAtom',
  'appShellRailAtom', 'appShellRailExpandedAtom', 'showQuickTipsAtom', 'showEmptyViewTabsAtom', 'hiddenViewTabIdsAtom', 'viewTabsOrderAtom',
  'tableVisibleColumnsAtom', 'tableColumnWidthsAtom', 'tableTitleWrapAtom', 'openAiChatByDefaultAtom', 'keepAiChatClosedAtom',
  'aiChatAutoOpenSuppressedAtom', 'aiChatPinnedAtom', 'aiChatSidebarWidthPxAtom', 'isAiChatSidebarModeAtom'];
const atoms = Object.fromEntries(atomNames.map(key => [key, state.atom({ key, default: null })]));
const pass = ({ children }) => children;
const empty = () => null;
const clients = [];
const Provider = load('src/utils/Providers.tsx', {
  '@/lib/firstScreen/SurfaceContext': surface,
  '@/lib/firstScreen/boardDocument': require('../src/lib/firstScreen/boardDocument.ts'),
  '@/lib/firstScreen/inboxDocument': require('../src/lib/firstScreen/inboxDocument.ts'),
  '@/lib/firstScreen/ticketShell': require('../src/lib/firstScreen/ticketShell.ts'),
  '@/lib/firstScreen/boardAdoption': { adoptBoardDocument() { throw Error('Shell reached board adoption'); } },
  '@/lib/firstScreen/inboxAdoption': { adoptInboxDocument() { throw Error('Shell reached inbox adoption'); } },
  '@/lib/firstScreen/BoardDisplayMirror': { default: empty }, '@/lib/contexts/MobileViewFlagBridge': { default: empty },
  '@/store': atoms, 'next/navigation': navigation, 'react-hot-toast': { Toaster: empty }, '@/lib/contexts/mobileContext': mobile,
  '@tanstack/react-query-persist-client': { PersistQueryClientProvider: ({ client, children }) => {
    clients.push(client); return React.createElement(QueryClientProvider, { client }, children);
  } },
  '@/lib/state': state, '@/hooks/General/useAuth': { AuthProvider: pass },
  '@/components/ProviderGlobal/GloablProviders': { default: pass }, '@/hooks/General/useUndo': { UndoProvider: pass },
  '@/lib/contexts/deviceContext': { DeviceProvider: pass }, '@/lib/contexts/ThemeListener': { default: empty },
  '@/lib/contexts/mobileBlockingContext': { MobileBlockingProvider: pass }, '@/lib/contexts/TourContext': { TourProvider: pass },
  '@/utils/queryPersistence': { shouldDehydratePersistedQuery: () => true }, '@/hooks/useFlag': flags,
  '@/lib/flags/definitions/htpr-7555-persist-size-once': { HTPR_7555_PERSIST_SIZE_ONCE_FLAG: 'persist-size' },
  '@/utils/queryIndexedDbPersister': { createQueryPersister: () => ({ dispose() {} }) },
  '@/utils/helperFunctions/chunkLoadRecovery': { CHUNK_RELOAD_STORAGE_KEY: 'recovery', stripChunkRecoveryParam: () => null },
}).default;
const values = { 'htpr-6934-server-first-screen': true, 'htpr-7627-ticket-first-screen': true, 'visible-ticket-flag': true };
const seed = { accountId: 985, flags: { accountId: 985, evaluatedAt: new Date().toISOString(), values },
  display: { version: 1, accountId: 985, timeZone: 'UTC', locale: 'en-US', boardLayout: 'table', theme: 'graphite',
    railCollapsed: true, quickTips: false, draftsFirst: false, isMobile: true,
    board: { railOn: false, showEmptyViewTabs: false, hiddenViewTabIds: {}, viewTabsOrder: {}, tableColumns: ['title'], tableWidths: {},
      tableTitleWrap: true, openChat: true, keepChatClosed: true, chatSuppressed: false, chatPinned: true, chatWidth: 517, chatSidebarMode: true } } };
function Probe() {
  const flag = flags.useFlag('visible-ticket-flag');
  const loaded = flags.useFlagLoaded('visible-ticket-flag');
  const isMobile = mobile.useMobileView();
  const rail = state.useRecoilValue(atoms.appShellRailAtom);
  const expanded = state.useRecoilValue(atoms.appShellRailExpandedAtom);
  const width = state.useRecoilValue(atoms.aiChatSidebarWidthPxAtom);
  const user = state.useRecoilValue(atoms.currentUserAtom);
  const project = state.useRecoilValue(atoms.currentProjectAtom);
  const snapshot = surface.useFirstScreenSurface(985);
  return React.createElement('output', null, JSON.stringify({ flag, loaded, isMobile, rail, expanded, width, user, project, surface: snapshot }));
}
const tree = (FlagProvider, shellSeed = seed, accountId = 985) => React.createElement(Provider, {
  initialIsMobile: false, initialIsApple: false, authenticatedUserId: accountId, shellSeed, flagProvider: FlagProvider,
}, React.createElement(Probe));
const expected = (accepted) => ({ flag: accepted, loaded: accepted, isMobile: accepted,
  rail: accepted ? false : null, expanded: accepted ? false : null, width: accepted ? 517 : null, user: null, project: null, surface: null });
function clearClients() { for (const client of clients.splice(0)) client.clear(); }
console.error('[htpr-7627 watchdog] modules loaded');
test.after(() => console.error('[htpr-7627 watchdog] tests finished', JSON.stringify(process.getActiveResourcesInfo())));

test('both real flag readers seed flags/mobile/preferences but never route data, and reject another account', { timeout: 60_000 }, () => {
  try {
    for (const FlagProvider of [flags.FeatureFlagProvider, flags.SubscribedFeatureFlagProvider]) {
      for (const [shellSeed, accountId, accepted] of [[seed, 985, true], [seed, 6, false], [null, 985, false],
        [{ ...seed, flags: { ...seed.flags, accountId: 6 } }, 985, false]]) {
        const html = renderToString(tree(FlagProvider, shellSeed, accountId));
        const dom = new JSDOM(html);
        assert.deepEqual(JSON.parse(dom.window.document.querySelector('output').textContent), expected(accepted));
        const client = clients.at(-1);
        assert.equal(client.getQueryData(['feature-flags', accountId])?.['visible-ticket-flag'] === true, accepted);
        assert.ok(client.getQueryCache().getAll().every(query => query.queryKey[0] === 'feature-flags'));
        dom.window.close();
      }
    }
  } finally { clearClients(); }
});

test('matching shell markup hydrates in place with either flag reader, without replay on client navigation', { timeout: 60_000 }, async () => {
  for (const FlagProvider of [flags.FeatureFlagProvider, flags.SubscribedFeatureFlagProvider]) {
    for (const seeded of [true, false]) {
      pathname = seeded ? '/detail/project-15/7627' : '/project';
      const initial = seeded ? seed : null;
      const html = renderToString(tree(FlagProvider, initial));
      const dom = new JSDOM(`<div id="root">${html}</div>`, { url: 'https://app.hypertask.ai/detail/project-15/7627' });
      const names = ['window', 'document', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'];
      const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(global, name)]);
      Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
      global.fetch = async () => { throw new Error('Network disabled in this test'); };
      window.matchMedia = () => ({ matches: !seeded, addEventListener() {}, removeEventListener() {} });
      Object.defineProperty(window, 'innerWidth', { value: seeded ? 390 : 1440, configurable: true });
      const node = document.querySelector('output'), errors = [];
      let instance;
      try {
        await React.act(async () => { instance = hydrateRoot(document.getElementById('root'), tree(FlagProvider, initial), {
          onRecoverableError: error => errors.push(error.message),
        }); });
        assert.deepEqual(errors, []); assert.equal(document.querySelector('output'), node);
        assert.deepEqual(JSON.parse(node.textContent), expected(seeded));
        pathname = '/detail/project-15/7628';
        await React.act(async () => instance.render(tree(FlagProvider, { ...seed, display: { ...seed.display, railCollapsed: false } })));
        assert.equal(document.querySelector('output'), node);
        assert.deepEqual(JSON.parse(node.textContent), expected(seeded));
      } finally {
        if (instance) await React.act(async () => instance.unmount());
        clearClients(); dom.window.close();
        for (const [name, descriptor] of previous) {
          if (descriptor) Object.defineProperty(global, name, descriptor); else delete global[name];
        }
      }
    }
  }
});
