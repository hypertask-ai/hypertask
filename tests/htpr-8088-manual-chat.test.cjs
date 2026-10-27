const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { JSDOM } = require('jsdom');
const query = require('@tanstack/react-query');
const { load } = require('./task-route-loader.cjs');
const flag = 'htpr-8088-manual-chat';

async function withRoot(check) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/project?id=15' });
  const original = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const flush = async () => {
    for (let i = 0; i < 4; i++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  };
  const render = async (Probe) => {
    await React.act(async () => root.render(React.createElement(query.QueryClientProvider, { client }, React.createElement(Probe))));
    await flush();
  };
  try { await check({ render, flush, client }); }
  finally {
    await React.act(async () => root.unmount());
    client.clear(); dom.window.close();
    for (const [key, value] of original) {
      if (value) Object.defineProperty(global, key, value);
      else delete global[key];
    }
  }
}

for (const mobile of [false, true]) test(`manual visibility survives navigation and preference refresh, mobile=${mobile}`, async () => {
  await withRoot(async ({ render }) => {
    const values = { user: { id: 985 }, open: false, suppressed: true, last: null, pinned: true, newTicket: null };
    const atoms = { currentUserAtom: 'user', showAIChatInterfaceAtom: 'open', aiChatAutoOpenSuppressedAtom: 'suppressed', aiChatAutoOpenPageAtom: 'last', aiChatPinnedAtom: 'pinned', aiChatNewTicketPathAtom: 'newTicket' };
    let pathname = '/project', search = 'id=15', manual = true, ready = true, preferences = { aiChatOpenBoards: true, aiChatOpenTickets: true, aiChatOpenNewTickets: true };
    const setters = new Map();
    const setter = (atom) => {
      if (!setters.has(atom)) setters.set(atom, (next) => { values[atom] = typeof next === 'function' ? next(values[atom]) : next; });
      return setters.get(atom);
    };
    const { useAiChatAutoOpen } = load('src/hooks/General/useAiChatAutoOpen.ts', {
      '@/hooks/useFlag': { useFlag: () => manual, useFlagReady: () => ready },
      '@/lib/state': { useRecoilValue: (atom) => values[atom], useRecoilState: (atom) => [values[atom], setter(atom)], useSetRecoilState: setter },
      '@/store': atoms,
      'next/navigation': { usePathname: () => pathname, useSearchParams: () => new URLSearchParams(search) },
      './useAiChatOpenPreferences': { useSyncAiChatOpenPreferences() {}, useAiChatOpenPreferences: () => ({ enabled: true, ready: true, flagReady: true, values: preferences }) },
    });
    let reserve;
    function Probe() { reserve = useAiChatAutoOpen(mobile).reserve; return null; }
    await render(Probe);
    assert.equal(values.open, false);
    assert.equal(reserve, false);
    pathname = '/detail/project-15/1'; search = ''; values.newTicket = pathname;
    await render(Probe);
    assert.equal(values.open, false, 'creating a ticket never opens a closed sidebar');
    values.open = true; values.suppressed = false;
    await render(Probe);
    for (const route of ['/detail/project-15/2', '/project', '/inbox', '/detail/project-16/3']) {
      pathname = route; search = route === '/project' ? 'id=16' : '';
      preferences = { aiChatOpenBoards: false, aiChatOpenTickets: false, aiChatOpenNewTickets: false };
      await render(Probe);
      assert.equal(values.open, true, 'navigation and saved preferences must not close a manually opened chat');
      assert.equal(reserve, false, 'only actual open state may reserve sidebar space');
    }
    values.open = false; values.suppressed = true;
    pathname = '/detail/project-15/4';
    preferences = { aiChatOpenBoards: true, aiChatOpenTickets: true, aiChatOpenNewTickets: true };
    ready = false; manual = false;
    await render(Probe);
    assert.equal(values.open, false, 'late flag loading must not briefly auto-open');
    ready = true;
    await render(Probe);
    pathname = '/detail/project-15/5';
    await render(Probe);
    assert.equal(values.open, true, 'turning the new policy off restores automatic opening');
  });
});

for (const paging of [false, true]) test(`same-team history stays selected; another team gets its own chat, paging=${paging}`, async () => {
  await withRoot(async ({ render, flush, client }) => {
    const user = { id: 985, uid: 'qa-985' };
    let project = { id: 15, teamId: 'A' }, taskId = 1, history;
    const rows = [], requests = [];
    const response = (data) => ({ data });
    const api = {
      addMessage: async (_id, message) => response({ message }),
      getAllSessions: async () => response({ success: true, sessions: [...rows] }),
      getSessionPage: async () => response({ success: true, sessions: rows.map(({ messages, ...row }) => ({ ...row, hasMessages: !!messages.length })), nextCursor: null }),
      getSessionTranscript: async (id) => rows.find((row) => row.id === id),
      createSessionNext: async (scope, board) => {
        requests.push({ scope, board });
        const row = { id: `chat-${requests.length}`, userId: user.id, projectId: board, taskId: scope ?? null, title: 'New chat', messages: [], createdAt: new Date(), updatedAt: new Date() };
        rows.unshift(row);
        return response({ success: true, session: row });
      },
    };
    const wire = load('src/utils/api/ai_chat/aiChatHelpers.ts', { '@/lib/constants': { default: {} }, '@/utils/axiosClient': { default: {} } });
    const { useSessionAndChatHistory } = load('src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts', {
      '@/hooks/useFlag': { useFlag: (key) => (key === 'htpr-6971-chat-history-paging' && paging) || key === 'htpr-7052-chat-names' },
      '@/lib/state': { useRecoilValue: (atom) => atom === 'user' ? user : atom === 'project' ? project : null, useRecoilState: () => [null, () => {}] },
      '@/store': { currentUserAtom: 'user', currentProjectAtom: 'project' },
      '@/utils/api/ai_chat': { ...wire, AI_Chat_API: api },
      'next/navigation': { usePathname: () => `/detail/project-${project.id}/${taskId}` },
    });
    function Probe() { history = useSessionAndChatHistory(undefined, true, false, true, project.teamId); return null; }
    await render(Probe);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], { scope: undefined, board: 15 });
    const first = history.currentSession;
    assert.ok(first?.id, 'history initialized through the real hook');
    await React.act(async () => {
      history.addMessageToSessionQuery(first.id, { id: 'message-A', sessionId: first.id, role: 'assistant', content: 'Keep this history', createdAt: new Date(), isDelivered: true });
    });
    await flush();
    for (const next of [{ id: 15, teamId: 'A' }, { id: 16, teamId: 'A' }]) {
      project = next; taskId++;
      await render(Probe);
      assert.equal(history.currentSession?.id, first.id);
      assert.equal(history.currentSession.messages[0].content, 'Keep this history');
      assert.equal(requests.length, 1, 'ticket and board changes do not create chats');
    }
    project = { id: 20, teamId: 'B' };
    await render(Probe);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], { scope: undefined, board: 20 });
    assert.notEqual(history.currentSession?.id, first.id);
    assert.deepEqual(history.currentSession.messages, []);
    assert.equal(history.currentSession.taskId, null);
    assert.ok(client.getQueryCache().getAll().length);
  });
});

test('first-paint boot never reserves a closed manual chat, rollback retains auto-open', () => {
  const { buildTicketSidebarBootScript } = load('src/lib/ticketSidebarBoot.ts', {});
  const vm = require('node:vm');
  for (const manualChat of [false, true]) {
    const attributes = {};
    vm.runInNewContext(buildTicketSidebarBootScript({ manualChat, keepClosed: false, overlayTicket: false, autoOpenSwitches: true, userId: 985 }), {
      location: { pathname: '/detail/project-15/1', search: '' }, window: { innerWidth: 1440 }, URLSearchParams,
      localStorage: { getItem: () => JSON.stringify({ aiChatPinned: true, aiChatAutoOpenPreferences: { 985: { aiChatOpenTickets: true } } }) },
      document: { documentElement: { style: { setProperty() {} }, setAttribute: (key, value) => { attributes[key] = value; } } },
    });
    assert.equal(attributes['data-ticket-sidebar'], manualChat ? 'closed' : 'reserved');
  }
});

test('manual flag is reversible and live by default', () => {
  const definition = require('./helpers/flag-files.cjs').load(require('node:path').resolve('src/lib/flags/definitions/htpr-8088-manual-chat.ts'));
  assert.equal(definition.default.key, flag);
  assert.equal(definition.default.defaultMode, 'EVERYONE');
  assert.equal(definition.default.kind, 'improvement');
});

test('session dispatch never selects a task or board chat over the manually selected conversation', async () => {
  const selected = { id: 'chosen', userId: 985, projectId: 15, taskId: null, messages: [] };
  const { useAiChatSessions } = load('src/hooks/MultiPages/AIChat/useAiChatSessions.ts', {
    react: { useCallback: (fn) => fn, useRef: (current) => ({ current }), useEffect() {} },
    '@/hooks/useFlag': { useFlag: (key) => key === flag },
    '@/lib/constants': { default: {} },
    '@/lib/contexts/deviceContext': { useDeviceContext: () => false },
    '@/components/Common/AttachmentsUpload/FileUploadHandler': { useFileUpload: () => ({}) },
    '@/lib/byokSelectedProviderGate': { shouldBlockAiDueToByokProvider: () => false },
    '@/lib/demo/isGuestClient': { isGuestCookieUser: () => false },
  });
  const resolver = useAiChatSessions({
    currentProject: { id: 16 }, currentUser: { id: 985 }, pathname: '/detail/project-16/99',
    taskId: 99, isFullScreenChat: false, dockedChatScope: null,
    getDisplayedSession: () => selected, chatHistoryReadyRef: { current: true }, sessionsRef: { current: [selected] },
  });
  assert.equal(await resolver.ensureSessionForCurrentBoard(), selected);
});
