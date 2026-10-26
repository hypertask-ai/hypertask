const { test } = require('node:test');
const { assert, session, id } = require('./ai-chat-session-fixture.cjs');
const flag = 'htpr-6971-chat-history-paging';
const { load } = require('./task-route-loader.cjs');
const React = require('react');
const query = require('@tanstack/react-query');
const { JSDOM } = require('jsdom');
const apiFile = 'src/utils/api/ai_chat/aiChatHelpers.ts';
const wire = load(apiFile, { '@/lib/constants': { default: { getAllAiChatSessionsRoute: '/api/ai-chat/all-sessions' } }, '@/utils/axiosClient': { default: {} } });
const response = (data) => ({ data, status: 200, headers: {}, config: {}, statusText: 'OK' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function withHistory(config, check) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/chat' });
  const original = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const requests = [];
  const rows = config.rows ?? [session(9, { projectId: 4 }), session(1, { taskId: config.taskId === 91 ? 91 : null, projectId: 4 })];
  let enabled = config.on ?? true, taskId = config.taskId, user = { id: 6, uid: 'user-6' }, pathname = config.demo ? '/demo' : '/chat', intro = config.intro ?? null;
  const api = {
    getAllSessions: async () => { requests.push(['legacy', user.id]); return response({ success: true, sessions: [...rows.filter((row) => row.userId === user.id)] }); },
    getSessionPage: async (options = {}) => {
      requests.push(['page', { ...options }, user.id]);
      if (config.page) return config.page(options, user);
      let visible = rows.filter((row) => row.userId === user.id && (!options.taskId || row.taskId === options.taskId) && (!options.projectId || row.projectId === options.projectId) && (!options.emptyOnly || row.messages.length === 0));
      if (config.legacyServer) return response({ success: true, sessions: visible });
      if (options.cursor) visible = visible.slice(1);
      const summaries = visible.slice(0, config.pageSize ?? 1).map(({ messages, ...row }) => ({ ...row, hasMessages: messages.length > 0 }));
      return response({ success: true, sessions: summaries, nextCursor: options.cursor || options.taskId || options.projectId || visible.length <= 1 ? null : 'next' });
    },
    getSessionTranscript: async (sessionId) => { requests.push(['transcript', sessionId, user.id]); if (config.transcript) return config.transcript(sessionId, user); return rows.find((row) => row.id === sessionId && row.userId === user.id) ?? null; },
    createSessionNext: async (scope) => { requests.push(['create', scope]); if (config.create) return config.create(scope); if (config.createError) throw config.createError; const row = session(50, { taskId: scope ?? null, messages: [] }); rows.unshift(row); return response({ success: true, session: row }); },
    addMessage: async (sessionId, message) => { requests.push(['message', sessionId, message.id]); if (config.message) return config.message(sessionId, message); const index = rows.findIndex((row) => row.id === sessionId); if (index >= 0) rows[index] = { ...rows[index], updatedAt: new Date(), messages: [...rows[index].messages.filter((row) => row.id !== message.id), message] }; return response({ message }); },
    updateSession: async (sessionId, title) => { requests.push(['rename', sessionId]); if (config.rename) return config.rename(sessionId, title); if (config.renameError) throw config.renameError; const row = rows.find((row) => row.id === sessionId); row.title = title; return response({ success: true, session: row }); },
    deleteSession: async (sessionId) => { requests.push(['delete', sessionId]); if (config.delete) return config.delete(sessionId); if (config.deleteError) throw config.deleteError; rows.splice(rows.findIndex((row) => row.id === sessionId), 1); if (!rows.length) rows.push(session(60, { messages: [] })); return response({ message: 'Deleted' }); },
  };
  const { useSessionAndChatHistory } = load('src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts', {
    '@/hooks/useFlag': { useFlag: (key) => key === flag ? enabled : key === 'htpr-6929-compose-task-writer' && !!config.compose },
    '@/lib/state': { useRecoilValue: (atom) => atom === 'user' ? user : null, useRecoilState: () => [intro, (next) => { intro = next; }] },
    '@/store': { currentUserAtom: 'user', composeTaskChatIntroAtom: 'intro' },
    '@/utils/api/ai_chat': { ...wire, AI_Chat_API: api },
    'next/navigation': { usePathname: () => pathname },
  });
  let resolver, history;
  const mapChanges = [];
  const useAiChatSessions = config.boardMap ? load('src/hooks/MultiPages/AIChat/useAiChatSessions.ts', {
    '@/lib/flags/definitions/htpr-7762-chat-new-session-focus': { HTPR_7762_CHAT_NEW_SESSION_FOCUS_FLAG: 'htpr-7762-chat-new-session-focus' },
    '@/hooks/useFlag': { useFlag: (key) => key === flag && enabled },
    '@/lib/constants': { default: {} }, '@/lib/contexts/deviceContext': { useDeviceContext: () => false },
    '@/components/Common/AttachmentsUpload/FileUploadHandler': { useFileUpload: () => ({}) },
    '@/lib/byokSelectedProviderGate': { shouldBlockAiDueToByokProvider: () => false },
    '@/lib/demo/isGuestClient': { isGuestCookieUser: () => false },
  }).useAiChatSessions : undefined;
  const observers = [];
  let Chat;
  if (config.rail) {
    original.push(['IntersectionObserver', Object.getOwnPropertyDescriptor(global, 'IntersectionObserver')]);
    global.IntersectionObserver = class {
      constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
      observe(target) { this.target = target; } disconnect() { this.disconnected = true; }
    };
    const mocks = {
      '@/components/AI_CHAT/AI_Tiptap_Container': { AI_Tiptap_Container: () => null },
      '@/components/AI_CHAT/MessageList': { MessageList: () => null },
      '@/components/AI_CHAT/WelcomeScreen': { WelcomeScreen: () => null },
      '@/hooks/MultiPages/useGetAllTeamsMinimal': { useGetAllTeamsMinimal: () => ({ data: [{ id: 1, title: 'Team', projects: [{ id: 4, title: 'Board four' }, { id: 5, title: 'Board five' }] }] }) },
      '@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context': { useAiChatContext: () => history },
      '@/hooks/useFlag': { useFlag: (key) => key === flag && enabled },
      '@/lib/flags/keys': { HTPR_6971_CHAT_HISTORY_PAGING_FLAG: flag },
      '@/lib/flags/definitions/htpr-7762-chat-new-session-focus': { HTPR_7762_CHAT_NEW_SESSION_FOCUS_FLAG: 'htpr-7762-chat-new-session-focus' },
      '@/lib/flags/definitions/htpr-7763-ctrl-tab-session-switch': { HTPR_7763_CTRL_TAB_SESSION_SWITCH_FLAG: 'htpr-7763-ctrl-tab-session-switch' },
      '@/lib/state': { useRecoilValue: () => user, useRecoilState: (atom) => React.useState(atom === 'width' ? 280 : atom === 'scope' ? null : []) },
      '@/store': { fullScreenChatRailWidthAtom: 'width', fullScreenChatScopeAtom: 'scope' },
      '@/utils/aiChat/sortBoardsByRecent': { sortBoardsByRecent: (teams) => teams },
      '@/utils/undoActions/helperFuncs': { cn: (...values) => values.filter(Boolean).join(' ') },
      '@/utils/generateTime': { __esModule: true, default: () => '' },
      '@/lib/aiChatDisplayMode': { buildFullScreenChatPath: (_, sessionId) => `/chat/${sessionId}`, resolveFullScreenChatReturnPath: () => '/my-tasks' },
      'next/navigation': { useRouter: () => ({ replace() {} }), useSearchParams: () => new URLSearchParams() },
    };
    const ts = require('typescript');
    const compiled = ts.transpileModule(require('node:fs').readFileSync('src/app/chat/Chat.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', compiled)((name) => mocks[name] ?? require(name), loaded, loaded.exports);
    Chat = loaded.exports.default;
  }
  function Probe() { history = useSessionAndChatHistory(taskId, config.historyEnabled ?? true, taskId !== undefined);
    if (useAiChatSessions) {
      const sessionsRef = React.useRef(history.sessions); sessionsRef.current = history.sessions;
      const chatHistoryReadyRef = React.useRef(history.isSuccess); chatHistoryReadyRef.current = history.isSuccess;
      resolver = useAiChatSessions({
        sessionsRef, chatHistoryReadyRef, sessionIntentGenerationRef: React.useRef(0), sessionSetupRef: React.useRef(null), resolvedBoardSessionRef: React.useRef(null), previousProjectIdRef: React.useRef(undefined),
        messageQueueRef: React.useRef([]), sendInFlightRef: React.useRef(false), currentProject: { id: 4 }, currentUser: user, taskId, pathname: '/board', sessionContextKey: 'fixture-board', dockedChatScope: null,
        aiChatBoardSessionMap: config.boardMap, setAiChatBoardSessionMap: (update) => mapChanges.push(update(config.boardMap)), setRecentChatBoardIds: () => {}, setQueuedMessages: () => {},
        clearMessageQueue: () => {}, selectSessionInHistory: history.selectSession, createSession: history.startNewSession, deleteSessionInHistory: history.deleteSession, resolveHistorySession: history.resolveHistorySession, getDisplayedSession: history.getDisplayedSession, sessionPagingEnabled: history.sessionPagingEnabled, shouldLoadChatHistory: false,
        isFullScreenChat: !!config.fullscreen, setDockedChatScope: () => {},
      });
    }
    if (config.observe) config.observe(history, taskId);
    return Chat ? React.createElement(Chat) : React.createElement('div', { 'data-ready': history.isSuccess, 'data-pending': history.isSessionPending }, history.currentSession?.messages.map((message) => React.createElement('p', { key: message.id }, message.content))); }
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  const flush = async () => { for (let i = 0; i < 4; i++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); };
  const render = async () => { await React.act(async () => root.render(React.createElement(query.QueryClientProvider, { client }, React.createElement(Probe)))); await flush(); };
  try {
    await render();
    await check({ history: () => history, resolver: () => resolver, mapChanges, client, requests, rows, flush, render, dom, observers, intro: () => intro, setIntro: (next) => { intro = next; }, setFlag: (next) => { enabled = next; }, setTask: (next) => { taskId = next; }, setUser: (next) => { user = next; }, api });
  } finally {
    await React.act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key]; }
  }
}

test('fullscreen rail renders title-only history independently of the active transcript and pages on scroll', async () => {
  const transcript = deferred();
  const rows = [session(9, { messages: [], projectId: 4 }), session(8, { projectId: 4 }), session(7, { projectId: 5 }), session(1, { projectId: 4 })];
  await withHistory({ rail: true, rows, transcript: (sessionId) => sessionId === id(9) ? transcript.promise : rows.find((row) => row.id === sessionId), page: (options) => response({
    success: true, sessions: (options.cursor ? rows.slice(3) : rows.slice(0, 3)).map(({ messages, ...row }) => ({ ...row, hasMessages: messages.length > 0 })), nextCursor: options.cursor ? null : 'next',
  }) }, async ({ history, requests, flush, dom }) => {
    const titles = () => [...document.querySelectorAll('aside li > div > button')].map((button) => button.textContent.trim());
    assert.deepEqual(titles(), ['Chat 8', 'Chat 7'], 'summary titles must render before any transcript resolves, excluding empty chats');
    assert.equal(history().currentSession, undefined);
    assert.equal(requests.filter(([type]) => type === 'page').length, 1, 'opening fullscreen must not drain history');
    await React.act(async () => transcript.resolve(rows[0])); await flush();
    assert.deepEqual(titles(), ['Chat 8', 'Chat 7'], 'an empty active transcript must not hide previous conversations');
    const rail = document.querySelector('aside .overflow-y-auto');
    Object.defineProperties(rail, { scrollTop: { configurable: true, value: 800 }, clientHeight: { configurable: true, value: 200 }, scrollHeight: { configurable: true, value: 1000 } });
    await React.act(async () => rail.dispatchEvent(new dom.window.Event('scroll', { bubbles: true }))); await flush();
    assert.deepEqual(titles(), ['Chat 8', 'Chat 7', 'Chat 1']);
    assert.equal(requests.filter(([type]) => type === 'page').length, 2);
    assert.equal(requests.filter(([type]) => type === 'transcript').length, 1, 'paging must not load other transcripts');
    await React.act(async () => document.querySelectorAll('aside li > div > button')[2].click()); await flush();
    assert.equal(history().currentSession.id, id(1));
    assert.deepEqual(titles(), ['Chat 8', 'Chat 7', 'Chat 1']);
    await React.act(async () => document.querySelector('aside button[aria-haspopup="menu"]').click());
    const boardFour = [...document.querySelectorAll('aside [role="menu"] button')].find((button) => button.textContent.includes('Board four'));
    assert.equal(boardFour.textContent.trim(), 'Board four2', 'board counts use summary message-presence metadata');
    await React.act(async () => boardFour.click());
    assert.deepEqual(titles(), ['Chat 8', 'Chat 1']);
  });
});

test('fullscreen rail search can reveal older summary pages and OFF/server rollback keep legacy history', async () => {
  await withHistory({ rail: true }, async ({ observers, requests, flush, dom }) => {
    const input = document.querySelector('input[aria-label="Search chats"]');
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'chat 1');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.equal(document.querySelectorAll('aside li').length, 0);
    assert.match(document.querySelector('aside').textContent, /No chats found/);
    const observer = observers.at(-1);
    assert.ok(observer.target, 'filtered empty/short histories keep the next page reachable');
    assert.equal(observer.options.root, observer.target.parentElement);
    await React.act(async () => observer.callback([{ isIntersecting: true }])); await flush();
    assert.equal(document.querySelector('aside li button').textContent.trim(), 'Chat 1');
    assert.equal(requests.filter(([type]) => type === 'page').length, 2);
  });
  for (const config of [{ on: false }, { legacyServer: true }]) {
    await withHistory({ rail: true, ...config, rows: [session(9, { messages: [] }), session(1)] }, async ({ history, requests, dom, observers }) => {
      assert.equal(history().sessionPagingEnabled, false);
      assert.equal(document.querySelector('aside li button').textContent.trim(), 'Chat 1');
      assert.equal(observers.length, 0);
      const pages = requests.filter(([type]) => type === 'page').length;
      await React.act(async () => document.querySelector('aside .overflow-y-auto').dispatchEvent(new dom.window.Event('scroll', { bubbles: true })));
      assert.equal(requests.filter(([type]) => type === 'page').length, pages);
      if (config.on === false) assert.deepEqual(requests.map(([type]) => type), ['legacy']);
    });
  }
});

test('client API negotiates only explicit page/detail calls and accepts both wire shapes on rollback', async () => {
  const calls = [], row = session(1);
  let rollback = false;
  const api = load(apiFile, {
    '@/lib/constants': { default: { getAllAiChatSessionsRoute: '/api/ai-chat/all-sessions' } },
    '@/utils/axiosClient': { default: { get: async (url, config) => { calls.push([url, config]); return response(config?.params?.sessionId && !rollback ? { success: true, session: row } : { success: true, sessions: [row] }); } } },
  });
  await api.AI_Chat_API.getAllSessions();
  assert.equal(calls[0][1], undefined);
  await api.AI_Chat_API.getSessionPage({ cursor: 'opaque' });
  assert.deepEqual(calls[1][1].params, { compat: 'htpr-6924', limit: 30, cursor: 'opaque' });
  assert.equal(await api.AI_Chat_API.getSessionTranscript(row.id), row);
  rollback = true;
  assert.equal(await api.AI_Chat_API.getSessionTranscript(row.id), row);
  assert.equal(calls.at(-1)[1], undefined, 'detail rollback explicitly retries legacy request');
  assert.equal(api.isPagedChatSessions({ success: true, sessions: [] }), false);
  assert.equal(api.isPagedChatSessions({ success: true, sessions: [], nextCursor: null }), true);
});

test('late transcript merge preserves streaming content and optimistic message IDs', () => {
  const incoming = session(1), local = { ...incoming, messages: [{ ...incoming.messages[0], content: 'streaming newer' }, { id: 'optimistic', content: 'new turn' }] };
  const merged = wire.mergeSessionTranscript(incoming, local, new Set(local.messages.map(({ id }) => id)));
  assert.deepEqual(merged.messages.map((message) => message.id), ['message-1', 'optimistic']);
  assert.equal(merged.messages[0].content, 'streaming newer');
});

test('ON loads one summary page and only active transcript; next page retains every session in order, dedupes and accepts legacy rollback', async () => {
  await withHistory({}, async ({ history, requests, flush }) => {
    assert.equal(history().isSuccess, true);
    assert.deepEqual(history().historySessions.map((row) => row.id), [id(9)]);
    assert.equal(requests.filter(([type]) => type === 'page').length, 1, 'mount must not drain history');
    assert.equal(requests.filter(([type]) => type === 'transcript').length, 1);
    await React.act(async () => history().loadMoreSessions()); await flush();
    assert.deepEqual(history().historySessions.map((row) => row.id), [id(9), id(1)]);
    assert.equal(history().hasMoreSessions, false);
    await React.act(async () => history().selectSession(id(1))); await flush();
    assert.equal(history().currentSession.id, id(1));
    assert.ok(history().currentSession.messages[0].attachments);
  });
  await withHistory({ legacyServer: true }, async ({ history }) => {
    assert.equal(history().historySessions.length, 2);
    assert.equal(history().hasMoreSessions, false);
    assert.equal(history().currentSession.messages[0].content, 'saved '.repeat(100));
  });
});

test('OFF uses only legacy request/cache and demo never persists or negotiates', async () => {
  await withHistory({ on: false }, async ({ history, requests }) => {
    assert.equal(history().sessions.length, 2);
    assert.deepEqual(requests.map(([type]) => type), ['legacy']);
  });
  await withHistory({ demo: true }, async ({ history, requests }) => {
    assert.equal(history().isSuccess, true);
    assert.equal(history().sessions.length, 1);
    const firstId = history().currentSession.id;
    assert.match(firstId, /^demo-chat-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(requests.length, 0);
    await React.act(async () => history().startNewSession());
    assert.notEqual(history().currentSession.id, firstId);
    assert.equal(history().currentSession.userId, 6);
    assert.equal(history().sessions.length, 2);
    assert.equal(requests.length, 0);
  });
});

test('old task session beyond page one resolves scope before any create and Compose greeting waits for transcript', async () => {
  const pending = deferred();
  await withHistory({ taskId: 91, compose: true, intro: { taskId: 91, content: 'Compose greeting' }, transcript: () => pending.promise }, async ({ history, requests, flush, intro }) => {
    assert.equal(history().isSuccess, false);
    assert.equal(history().showWelcomeScreen, false);
    assert.equal(history().isSessionPending, true);
    assert.ok(intro());
    assert.equal(requests.some(([type]) => type === 'create' || type === 'message'), false);
    assert.ok(requests.some(([type, options]) => type === 'page' && options.taskId === 91));
    await React.act(async () => pending.resolve(session(1, { taskId: 91, projectId: 4 }))); await flush();
    assert.equal(history().currentSession.id, id(1));
    assert.equal(history().isSuccess, true);
    assert.equal(requests.filter(([type]) => type === 'message').length, 1);
    assert.equal(intro(), null);
  });
});

test('Compose greeting stays queued while history cannot take it, then lands once', async () => {
  const config = { taskId: 91, compose: true, rows: [session(1, { taskId: 91, messages: [] })] };
  await withHistory(config, async ({ history, requests, setIntro, intro, render }) => {
    assert.equal(history().currentSession.taskId, 91);
    const greeting = { taskId: 91, content: 'I created QA-1 from your note.' };
    config.historyEnabled = false;
    setIntro(greeting);
    await render();
    assert.equal(requests.filter(([type]) => type === 'message').length, 0);
    assert.deepEqual(intro(), greeting);
    config.historyEnabled = true;
    await render();
    assert.equal(requests.filter(([type]) => type === 'message').length, 1);
    assert.equal(history().currentSession.messages.length, 1);
    assert.equal(history().showWelcomeScreen, false);
    assert.equal(intro(), null);
    setIntro(greeting);
    await render();
    assert.equal(requests.filter(([type]) => type === 'message').length, 1);
  });
});

test('selection races discard stale active selection and optimistic messages survive later fetches', async () => {
  const older = deferred();
  await withHistory({ transcript: (sessionId) => sessionId === id(1) ? older.promise : session(9) }, async ({ history, flush }) => {
    let selection;
    await React.act(async () => { selection = history().selectSession(id(1)); });
    assert.equal(history().isSuccess, false);
    await React.act(async () => history().selectSession(id(9)));
    const optimistic = { id: 'optimistic', sessionId: id(9), content: 'stream', createdAt: new Date(), role: 'assistant' };
    await React.act(async () => history().appendMessageToSessionCache(id(9), optimistic));
    await React.act(async () => { older.resolve(session(1)); await selection; }); await flush();
    assert.equal(history().currentSession.id, id(9));
    assert.equal(history().sessions[0].id, id(9), 'stale fetch must not reorder the send resolver cache');
    assert.equal(history().currentSession.messages.at(-1).id, 'optimistic');
  });
});

test('send target always matches the displayed session on fullscreen and initialized boards', async () => {
  for (const fullscreen of [false, true]) {
    await withHistory({ boardMap: { 4: id(9) }, fullscreen }, async ({ history, resolver, requests, flush }) => {
      await React.act(async () => resolver().ensureSessionForCurrentBoard()); await flush();
      await React.act(async () => resolver().selectSession(id(1))); await flush();
      const transcriptRequests = requests.filter(([type]) => type === 'transcript').length;
      await React.act(async () => resolver().selectSession(id(9))); await flush();
      assert.equal(requests.filter(([type]) => type === 'transcript').length, transcriptRequests + 1, 'explicit cached selection revalidates its transcript');
      assert.equal(history().currentSession.id, id(9));
      assert.equal(history().sessions[0].id, id(9));
      let target;
      await React.act(async () => { target = await resolver().ensureSessionForCurrentBoard(); });
      assert.equal(target.id, history().currentSession.id, 'the next send belongs to the displayed cached conversation');
    });
  }
});

test('New chat cancels a pending older selection', async () => {
  for (const fullscreen of [false, true]) {
    const older = deferred();
    await withHistory({ boardMap: { 4: id(9) }, fullscreen, transcript: (sessionId) => sessionId === id(1) ? older.promise : session(9) }, async ({ history, resolver, flush }) => {
      await React.act(async () => resolver().ensureSessionForCurrentBoard()); await flush();
      let selection;
      await React.act(async () => { selection = history().selectSession(id(1)); });
      assert.equal(history().isSuccess, false);
      await React.act(async () => resolver().startNewSession()); await flush();
      assert.equal(history().currentSession.id, id(50));
      assert.equal(history().isSuccess, true);
      await React.act(async () => { older.resolve(session(1)); await selection; }); await flush();
      assert.equal(history().currentSession.id, id(50));
      assert.equal(history().sessions[0].id, id(50), 'a stale transcript must not prepend itself after New chat');
      let target;
      await React.act(async () => { target = await resolver().ensureSessionForCurrentBoard(); });
      assert.equal(target.id, history().currentSession.id, 'the next send remains in the new displayed conversation');
    });
  }
});

test('paging error retains already loaded chats and retries without duplicates', async () => {
  let fails = true;
  await withHistory({ page: async (options) => {
    if (options.cursor && fails) throw new Error('429');
    const row = session(options.cursor ? 1 : 9); const { messages, ...summary } = row;
    return response({ success: true, sessions: [{ ...summary, hasMessages: messages.length > 0 }], nextCursor: options.cursor ? null : 'next' });
  } }, async ({ history, flush }) => {
    await React.act(async () => history().loadMoreSessions()); await flush();
    assert.equal(history().pagingError, true);
    assert.deepEqual(history().historySessions.map((row) => row.id), [id(9)]);
    fails = false;
    await React.act(async () => history().loadMoreSessions()); await flush();
    assert.equal(history().pagingError, false);
    assert.deepEqual(history().historySessions.map((row) => row.id), [id(9), id(1)]);
  });
});

test('flag/account/task changes isolate caches and reject stale transcript completion', async () => {
  const pending = deferred();
  await withHistory({ rows: [session(9), session(1, { taskId: 91 }), session(2, { taskId: 92 }), session(10, { userId: 7 })], transcript: (sessionId, user) => sessionId === id(1) ? pending.promise : session(Number(sessionId.slice(-12)), { userId: user.id, taskId: sessionId === id(2) ? 92 : null }) }, async ({ history, client, setTask, setUser, setFlag, render, flush }) => {
    let selecting;
    await React.act(async () => { selecting = history().selectSession(id(1)); });
    setTask(92); await render();
    assert.equal(history().currentSession.taskId, 92);
    setUser({ id: 7, uid: 'user-7' }); setTask(undefined); await render();
    await React.act(async () => { pending.resolve(session(1, { taskId: 91 })); await selecting; }); await flush();
    assert.equal(history().currentSession.userId, 7);
    assert.equal(client.getQueriesData({ queryKey: ['aiChatTranscript', 'user-6'] }).length, 0);
    setFlag(false); await render();
    assert.equal(history().currentSession.userId, 7);
    assert.ok(client.getQueriesData({ queryKey: ['chat-session-summaries', 'user-7'] }).every(([, data]) => data === undefined));
    assert.ok(client.getQueryData(['chat-sessions', 'user-7']));
  });
});

test('deleting last loaded transcript does not treat unloaded older sessions as absent; actual final delete refetches blank session', async () => {
  for (const rows of [[session(9), session(1)], [session(9)]]) await withHistory({ rows }, async ({ history, requests, flush }) => {
    await React.act(async () => history().deleteSession(id(9))); await flush();
    assert.equal(requests.filter(([type]) => type === 'create').length, 0);
    assert.equal(history().currentSession.id, rows[0].id);
    assert.equal(history().historySessions.some((row) => row.id === id(9)), false);
  });
});


test('board map outside page one resolves its transcript before removing map or creating; scoped lookup and metadata-empty reuse are safe', async () => {
  await withHistory({ boardMap: { 4: id(1) } }, async ({ resolver, history, requests, mapChanges, flush }) => {
    let resolved;
    await React.act(async () => { resolved = await resolver().ensureSessionForCurrentBoard(); }); await flush();
    assert.equal(resolved.id, id(1));
    assert.equal(history().currentSession.id, id(1));
    assert.equal(mapChanges.length, 0);
    assert.equal(requests.filter(([type]) => type === 'create').length, 0);
    assert.ok(requests.some(([type, sessionId]) => type === 'transcript' && sessionId === id(1)));
  });
  await withHistory({ boardMap: {}, rows: [session(9), session(1, { projectId: 4 })] }, async ({ resolver, requests }) => {
    let resolved;
    await React.act(async () => { resolved = await resolver().ensureSessionForCurrentBoard(); });
    assert.equal(resolved.id, id(1));
    assert.ok(requests.some(([type, options]) => type === 'page' && options.projectId === 4));
    assert.equal(requests.some(([type]) => type === 'create'), false);
  });
  await withHistory({ boardMap: {}, rows: [session(9), session(1, { messages: [] })] }, async ({ resolver, history, requests, flush }) => {
    await React.act(async () => history().loadMoreSessions()); await flush();
    let resolved;
    await React.act(async () => { resolved = await resolver().ensureSessionForCurrentBoard(); });
    assert.equal(resolved.id, id(1));
    assert.equal(resolved.messages.length, 0);
    assert.equal(requests.some(([type]) => type === 'create'), false);
  });
});

test('board transcript failure preserves its map and never creates a replacement conversation', async () => {
  await withHistory({ boardMap: { 4: id(1) }, transcript: (sessionId) => sessionId === id(1) ? Promise.reject(new Error('429')) : session(9) }, async ({ resolver, requests, mapChanges }) => {
    await React.act(async () => assert.rejects(() => resolver().ensureSessionForCurrentBoard(), /429/));
    assert.equal(mapChanges.length, 0);
    assert.equal(requests.some(([type]) => type === 'create'), false);
  });
});

test('summary dedupe refuses stale page metadata over optimistic newer updates', () => {
  const fresh = session(1, { title: 'new title', updatedAt: new Date('2026-06-01T00:00:00.000Z') });
  const result = wire.mergeSessionHistory([session(1)], [fresh, session(2)]);
  assert.equal(result.find((row) => row.id === id(1)).title, 'new title');
  assert.equal(result.length, 2);
});

test('real history menu pages on end visibility/scroll, preserves list order, exposes failure, and OFF retains legacy menu', async () => {
  const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/chat' });
  const original = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'IntersectionObserver'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
  const observers = [];
  global.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
    observe(target) { this.target = target; } disconnect() { this.disconnected = true; }
  };
  let enabled = true, loads = 0, selected;
  const refreshes = [];
  const queryClient = { refetchQueries: async (options) => { refreshes.push(options); } };
  const state = { sessions: [session(9)], historySessions: [session(9), session(1)], currentSession: session(9), hasMoreSessions: true,
    refreshHistorySessions: () => queryClient.refetchQueries({ queryKey: ["chat-session-summaries"], type: "active", stale: true }),
    isLoadingMoreSessions: false, pagingError: false, loadMoreSessions: async () => { loads++; }, selectSession: (value) => { selected = value; } };
  const tooltip = () => ({ text: '', keyCombination: [] });
  const mocks = {
    '@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context': { useAiChatContext: () => state },
    '@tanstack/react-query': { useQueryClient: () => queryClient },
    'next/navigation': { usePathname: () => '/chat', useRouter: () => ({ push() {} }), useSearchParams: () => new URLSearchParams() },
    './AgentSidebarChatCommands': { AgentSidebarChatCommands: () => null },
    '@/lib/configs/general.config': { MOBILE_TARGET: 'min-h-[44px] min-w-[44px]' },
    '@/utils/undoActions/helperFuncs': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/lib/flags/definitions/htpr-7773-chat-header-name': { HTPR_7773_CHAT_HEADER_NAME_FLAG: 'htpr-7773-chat-header-name' },
    '@/hooks/useFlag': { useFlag: (key) => key === flag && enabled },
    '@/lib/flags/keys': { HTPR_6971_CHAT_HISTORY_PAGING_FLAG: flag },
    '@/lib/flags/definitions/htpr-7575-phone-chat-delete': { HTPR_7575_PHONE_CHAT_DELETE_FLAG: 'htpr-7575-phone-chat-delete' },
    '../Common/Tooltip': { __esModule: true, default: () => null },
    '@/lib/contexts/mobileContext': { MobileViewContext: React.createContext(false) },
    '@/lib/contexts/deviceContext': { useDeviceContext: () => false },
    '@/lib/configs/aiTaskWriter.config': { aiTaskWriterConfig: { shortcutsAndTooltips: { ai_chat: { new_chat_button: tooltip, minimize_button: tooltip } } } },
    '@/lib/aiChatDisplayMode': { buildFullScreenChatPath: () => '/chat' },
    '@/lib/aiModelOptions': { getMobileAiChatModelLabel: () => 'AI' },
    '@/lib/state': { useRecoilState: () => [false, () => {}] }, '@/store': {},
  };
  const filename = path.join(__dirname, '../src/components/AI_CHAT/ChatHeader.tsx');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name) => mocks[name] ?? require(name), loaded, loaded.exports);
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  const render = () => React.act(async () => root.render(React.createElement(loaded.exports.ChatHeader)));
  try {
    await render();
    await React.act(async () => document.querySelector('button[title]').click());
    assert.deepEqual(refreshes, [{ queryKey: ['chat-session-summaries'], type: 'active', stale: true }]);
    const menu = document.getElementById('ai-chat-session-history');
    assert.deepEqual([...menu.querySelectorAll('li button')].map((button) => button.textContent), ['Chat 9', 'Chat 1']);
    assert.equal(observers.at(-1).options.root, menu);
    await React.act(async () => observers.at(-1).callback([{ isIntersecting: true }]));
    assert.equal(loads, 1);
    await React.act(async () => menu.dispatchEvent(new dom.window.Event('scroll', { bubbles: true })));
    assert.equal(loads, 2);
    state.pagingError = true; await render();
    assert.match(menu.querySelector('[role="alert"]').textContent, /Scroll to try again/);
    assert.equal(menu.querySelectorAll('li').length, 2);
    state.isLoadingMoreSessions = true; await render();
    await React.act(async () => menu.dispatchEvent(new dom.window.Event('scroll', { bubbles: true })));
    assert.equal(loads, 2);
    enabled = false; state.isLoadingMoreSessions = false; await render();
    assert.equal(menu.querySelectorAll('li').length, 1);
    assert.equal(menu.querySelector('[role="alert"]'), null);
    await React.act(async () => menu.dispatchEvent(new dom.window.Event('scroll', { bubbles: true })));
    assert.equal(loads, 2);
    await React.act(async () => menu.querySelector('li button').click());
    assert.equal(selected, id(9));
    assert.equal(document.getElementById('ai-chat-session-history'), null);
    await React.act(async () => document.querySelector('button[title]').click());
    assert.equal(refreshes.length, 1, 'flag-off history does not refresh the summary cache');
  } finally {
    await React.act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key]; }
  }
});


test('optimistic message/title/create writes update summary metadata without inventing empty transcripts', async () => {
  await withHistory({ rows: [session(9, { messages: [] }), session(1)] }, async ({ history, client, flush }) => {
    await React.act(async () => history().addMessageToSessionQuery(id(9), { id: 'sent', sessionId: id(9), content: 'hello', createdAt: new Date(), role: 'human' })); await flush();
    const summaryKey = ['chat-session-summaries', 'user-6', 6, flag, 'history'];
    assert.equal(client.getQueryData(summaryKey).pages.flatMap((page) => page.sessions).find((row) => row.id === id(9)).hasMessages, true);
    await React.act(async () => history().updateSessionTitle(id(9), 'Renamed')); await flush();
    assert.equal(client.getQueryData(summaryKey).pages.flatMap((page) => page.sessions).find((row) => row.id === id(9)).title, 'Renamed');
    await React.act(async () => history().startNewSession()); await flush();
    assert.equal(history().currentSession.id, id(50));
    assert.ok(client.getQueryData(summaryKey).pages.flatMap((page) => page.sessions).some((row) => row.id === id(50)));
    assert.equal(history().isSuccess, true);
  });
});

test('failed task creation ends pending state and explicit retry recovers readiness', async () => {
  const config = { taskId: 93, createError: new Error('429') };
  const log = console.log; console.log = () => {};
  try {
    await withHistory(config, async ({ history, requests, flush }) => {
      assert.equal(history().isSessionPending, false);
      assert.equal(history().isError, true);
      assert.equal(history().isSuccess, false);
      assert.equal(requests.filter(([type]) => type === 'create').length, 1);
      config.createError = null;
      await React.act(async () => history().startNewSession()); await flush();
      assert.equal(history().isSuccess, true);
      assert.equal(history().currentSession.taskId, 93);
    });
  } finally { console.log = log; }
});

test('429 delete and rename retain transcript; failed optimistic title is restored in both caches', async () => {
  const error = new Error('429'); const original = console.error; console.error = () => {};
  try {
    await withHistory({ deleteError: error, renameError: error }, async ({ history, flush }) => {
      await React.act(async () => history().deleteSession(id(9))); await flush();
      assert.equal(history().currentSession.id, id(9));
      await React.act(async () => history().updateSessionTitle(id(9), 'unsaved')); await flush();
      assert.equal(history().currentSession.title, 'Chat 9');
      assert.equal(history().historySessions.find((row) => row.id === id(9)).title, 'Chat 9');
      assert.equal(history().currentSession.messages[0].id, 'message-9');
    });
  } finally { console.error = original; }
});


test('another tab update refreshes when a conversation is shown', async () => {
  const rows = [session(9), session(1)], detail = deferred(); let revalidating = false;
  await withHistory({ rows, transcript: (sessionId) => revalidating && sessionId === id(9) ? detail.promise : rows.find((row) => row.id === sessionId) }, async ({ history, client, requests, flush }) => {
    const cached = history().currentSession;
    await React.act(async () => history().selectSession(id(1))); await flush();
    const summaryKey = ['chat-session-summaries', 'user-6', 6, flag, 'history'];
    const summaries = client.getQueryData(summaryKey);
    const message = { id: 'second-context', sessionId: id(9), content: 'sent in another browser', role: 'human', createdAt: new Date() };
    await withHistory({ rows, message: async (sessionId, saved) => {
      const index = rows.findIndex((row) => row.id === sessionId);
      rows[index] = { ...rows[index], updatedAt: new Date('2026-02-01'), messages: [...rows[index].messages, saved] };
      return response({ message: saved });
    } }, async (second) => {
      assert.notEqual(second.client, client, 'browser contexts have independent query caches');
      await React.act(async () => second.history().addMessageToSessionQuery(id(9), message)); await second.flush();
      assert.ok(second.requests.some(([type, sessionId]) => type === 'message' && sessionId === id(9)));
    });
    assert.equal(client.getQueryData(summaryKey), summaries, 'the first context has not refreshed its summaries');
    const before = requests.length;
    revalidating = true; let selecting;
    await React.act(async () => { selecting = history().selectSession(id(9)); }); await flush();
    assert.deepEqual(requests.slice(before), [['transcript', id(9), 6]], 'only the selected session is revalidated');
    assert.equal(history().currentSession, cached, 'the cached transcript displays before the fetch completes');
    assert.equal(history().sessions[0].id, id(9));
    assert.equal(history().isSuccess, true, 'background revalidation does not block sending into the displayed session');
    await React.act(async () => { detail.resolve(rows[0]); await selecting; }); await flush();
    assert.equal(history().currentSession.messages.at(-1).content, message.content);
    assert.match(document.getElementById('root').textContent, /sent in another browser/);
  });
});

test('cached revalidation ignores late results after another selection or New chat', async () => {
  for (const newChat of [false, true]) {
    const detail = deferred(); let revalidating = false;
    await withHistory({ transcript: (sessionId) => revalidating && sessionId === id(1) ? detail.promise : session(Number(sessionId.slice(-12))) }, async ({ history, client, flush }) => {
      await React.act(async () => history().selectSession(id(1))); await flush();
      await React.act(async () => history().selectSession(id(9))); await flush();
      revalidating = true; let selecting;
      await React.act(async () => { selecting = history().selectSession(id(1)); }); await flush();
      assert.equal(history().currentSession.id, id(1));
      assert.equal(history().isSuccess, true);
      await React.act(async () => newChat ? history().startNewSession() : history().selectSession(id(9))); await flush();
      await React.act(async () => { detail.resolve(session(1, { title: 'stale result', messages: [{ id: 'stale', content: 'must not merge' }] })); await selecting; }); await flush();
      assert.equal(history().currentSession.id, id(newChat ? 50 : 9));
      assert.equal(history().sessions[0].id, history().currentSession.id);
      assert.equal(history().isSuccess, true);
      assert.ok(client.getQueryData(['aiChatTranscript', 'user-6', 6, flag, id(1)]), 'inactive cache is independent from the displayed transcript');
    });
  }
});

test('cached revalidation failures keep the displayed transcript usable', async () => {
  let failing = false;
  const original = console.error; console.error = () => {};
  try {
    await withHistory({ transcript: () => failing ? Promise.reject(new Error('429')) : session(9) }, async ({ history, flush }) => {
      failing = true;
      await React.act(async () => history().selectSession(id(9))); await flush();
      assert.equal(history().currentSession.id, id(9));
      assert.equal(history().isSuccess, true);
      assert.equal(history().isError, false);
    });
  } finally { console.error = original; }
});

test('summary focus and history-open refresh match legacy stale query options without draining pages', async () => {
  const focused = query.focusManager.isFocused();
  try {
    for (const on of [false, true]) await withHistory({ on }, async ({ history, client, requests, flush }) => {
      const key = on ? ['chat-session-summaries', 'user-6', 6, flag, 'history'] : ['chat-sessions', 'user-6'];
      const cachedQuery = client.getQueryCache().find({ queryKey: key, exact: true });
      assert.equal(cachedQuery.options.staleTime, 1000 * 60 * 3);
      assert.equal(cachedQuery.options.refetchOnWindowFocus ?? true, true);
      assert.equal(cachedQuery.options.refetchOnMount ?? true, true);
      const count = () => requests.filter(([type]) => type === (on ? 'page' : 'legacy')).length;
      await React.act(async () => query.focusManager.setFocused(false));
      await React.act(async () => query.focusManager.setFocused(true)); await flush();
      assert.equal(count(), 1, 'fresh queries do not refetch on focus');
      await React.act(async () => client.setQueryData(key, (old) => old, { updatedAt: Date.now() - 180001 }));
      await React.act(async () => query.focusManager.setFocused(false));
      await React.act(async () => query.focusManager.setFocused(true)); await flush();
      assert.equal(count(), 2, 'stale history refetches its first page on focus');
      await React.act(async () => client.setQueryData(key, (old) => old, { updatedAt: Date.now() - 180001 }));
      await React.act(async () => client.refetchQueries({ queryKey: key, type: 'active', stale: true })); await flush();
      assert.equal(count(), 3, 'opening stale history refreshes without changing the legacy stale policy');
      assert.equal(history().isSuccess, true);
      if (on) assert.ok(requests.filter(([type]) => type === 'page').every(([, options]) => !options.cursor));
    });
  } finally { query.focusManager.setFocused(focused); }
});

test('newer summaries refresh cached transcripts and replace acknowledged content, titles and removed messages', async () => {
  await withHistory({}, async ({ history, rows, client, requests, flush }) => {
    const initial = history().currentSession;
    rows[0] = { ...initial, title: 'Changed in another tab', updatedAt: new Date('2026-02-01'), messages: [
      { ...initial.messages[0], content: 'edited remotely' }, { id: 'remote', content: 'another tab', createdAt: new Date('2026-02-01') },
    ] };
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    assert.equal(requests.filter(([type]) => type === 'transcript').length, 2);
    assert.equal(history().currentSession.title, 'Changed in another tab');
    assert.deepEqual(history().currentSession.messages.map(({ content }) => content), ['edited remotely', 'another tab']);
    rows[0] = { ...rows[0], updatedAt: new Date('2026-03-01'), messages: [rows[0].messages[1]] };
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    assert.deepEqual(history().currentSession.messages.map(({ id }) => id), ['remote']);
    const count = requests.filter(([type]) => type === 'transcript').length;
    await React.act(async () => history().selectSession(initial.id)); await flush();
    assert.equal(requests.filter(([type]) => type === 'transcript').length, count + 1, 'explicit reopen revalidates even unchanged summaries');
  });
});

test('newer summaries preserve only pending local writes during refresh, then accept server edits after acknowledgement', async () => {
  const write = deferred(), transcript = deferred(); let refreshing = false;
  await withHistory({ message: () => write.promise, transcript: (sessionId) => refreshing ? transcript.promise : session(Number(sessionId.slice(-12))) }, async ({ history, rows, client, flush }) => {
    const pending = { id: 'local-write', sessionId: id(9), content: 'pending', role: 'human', createdAt: new Date() };
    await React.act(async () => history().addMessageToSessionQuery(id(9), pending)); await flush();
    rows[0] = { ...rows[0], updatedAt: new Date('2026-02-01'), messages: [{ ...rows[0].messages[0], content: 'remote edit' }] };
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    refreshing = true; let selection;
    await React.act(async () => { selection = history().selectSession(id(9)); });
    await React.act(async () => history().appendMessageToSessionCache(id(9), { id: 'stream', content: 'streaming', isDelivered: false, createdAt: new Date() }));
    await React.act(async () => { transcript.resolve(rows[0]); await selection; }); await flush();
    assert.deepEqual(history().currentSession.messages.map(({ content }) => content), ['remote edit', 'pending', 'streaming']);
    await React.act(async () => write.resolve(response({ message: pending }))); await flush();
    rows[0] = { ...rows[0], updatedAt: new Date('2026-03-01'), messages: [...rows[0].messages, { ...pending, content: 'server edited acknowledged write' }] };
    refreshing = false;
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    transcript.promise = Promise.resolve(rows[0]); refreshing = true;
    await React.act(async () => history().selectSession(id(9))); await flush();
    assert.equal(history().currentSession.messages.find(({ id }) => id === pending.id).content, 'server edited acknowledged write');
    assert.equal(history().currentSession.messages.at(-1).content, 'streaming');
  });
});

test('task initialization remains single-flight when paging and summary refresh finish during creation', async () => {
  const creating = deferred();
  await withHistory({ taskId: 93, create: () => creating.promise }, async ({ history, requests, client, flush }) => {
    assert.equal(requests.filter(([type]) => type === 'create').length, 1);
    await React.act(async () => history().loadMoreSessions()); await flush();
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    assert.equal(history().isError, false);
    assert.equal(requests.filter(([type]) => type === 'create').length, 1);
    await React.act(async () => creating.resolve(response({ success: true, session: session(50, { taskId: 93, messages: [] }) }))); await flush();
    assert.equal(history().currentSession?.taskId, 93);
    assert.equal(history().isSuccess, true);
    assert.equal(history().isLoading, false);
  });
});

test('task initialization rejects an old creation after navigation without disturbing the new task', async () => {
  const creating = deferred();
  await withHistory({ taskId: 93, rows: [session(9), session(2, { taskId: 92 })], create: () => creating.promise }, async ({ history, setTask, render, flush }) => {
    setTask(92); await render();
    await React.act(async () => creating.resolve(response({ success: true, session: session(50, { taskId: 93, messages: [] }) }))); await flush();
    assert.equal(history().currentSession.taskId, 92);
    assert.equal(history().isSuccess, true);
  });
});

test('background streaming and acknowledged writes cannot redirect the next send away from the displayed conversation', async () => {
  for (const fullscreen of [false, true]) {
    const write = deferred();
    await withHistory({ boardMap: { 4: id(9) }, fullscreen, message: () => write.promise }, async ({ history, resolver, flush }) => {
      await React.act(async () => resolver().ensureSessionForCurrentBoard()); await flush();
      const message = { id: 'background', content: 'old turn', createdAt: new Date() };
      await React.act(async () => history().addMessageToSessionQuery(id(9), message));
      await React.act(async () => resolver().selectSession(id(1))); await flush();
      await React.act(async () => history().appendMessageToSessionCache(id(9), { id: 'stream', content: 'old streaming turn', createdAt: new Date() }));
      await React.act(async () => write.resolve(response({ message }))); await flush();
      let target; await React.act(async () => { target = await resolver().ensureSessionForCurrentBoard(); });
      assert.equal(target.id, history().currentSession.id);
      assert.equal(target.id, id(1));
    });
  }
});

test('refresh removes deleted entries in its covered range, including loaded transcripts, without dropping older pages', async () => {
  const rows = [session(9), session(8), session(1)];
  await withHistory({ rows, page: async (options) => {
    const visible = options.cursor ? rows.slice(1) : rows.slice(0, 1);
    return response({ success: true, sessions: visible.map(({ messages, ...row }) => ({ ...row, hasMessages: messages.length > 0 })), nextCursor: options.cursor ? null : 'next' });
  } }, async ({ history, rows, client, flush }) => {
    await React.act(async () => history().loadMoreSessions()); await flush();
    await React.act(async () => history().selectSession(id(8))); await flush();
    rows.splice(rows.findIndex((row) => row.id === id(9)), 1);
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    assert.deepEqual(history().historySessions.map(({ id }) => id), [id(8), id(1)]);
    assert.equal(history().sessions.some((row) => row.id === id(9)), false);
    assert.equal(history().currentSession.id, id(8));
  });
});


test('task sends wait for the displayed transcript rather than using another cached task session', async () => {
  const loading = deferred(); let delayed = false;
  await withHistory({ taskId: 91, boardMap: {}, rows: [session(9), session(1, { taskId: 91 }), session(2, { taskId: 91 })], transcript: (sessionId) => delayed ? loading.promise : session(Number(sessionId.slice(-12)), { taskId: 91 }) }, async ({ history, resolver, flush }) => {
    delayed = true; let selection;
    await React.act(async () => { selection = history().selectSession(id(2)); });
    let target; await React.act(async () => { target = await resolver().ensureSessionForCurrentBoard(0); });
    assert.equal(target, undefined, 'an unloaded selection cannot send into the old cached task session');
    await React.act(async () => { loading.resolve(session(2, { taskId: 91 })); await selection; }); await flush();
    await React.act(async () => { target = await resolver().ensureSessionForCurrentBoard(0); });
    assert.equal(target.id, history().currentSession.id);
  });
});

test('late failed initialization cannot mark a newer explicit selection unready', async () => {
  const loading = deferred();
  const original = console.error; console.error = () => {};
  try {
    await withHistory({ taskId: 91, transcript: (sessionId) => sessionId === id(1) ? loading.promise : session(9) }, async ({ history, flush }) => {
      await React.act(async () => history().selectSession(id(9))); await flush();
      await React.act(async () => loading.reject(new Error('stale 429'))); await flush();
      assert.equal(history().currentSession.id, id(9));
      assert.equal(history().isSuccess, true);
      assert.equal(history().isError, false);
    });
  } finally { console.error = original; }
});

test('New chat intent rejects a pending older transcript before creation commits', async () => {
  const older = deferred(), creating = deferred();
  await withHistory({ create: () => creating.promise, transcript: (sessionId) => sessionId === id(1) ? older.promise : session(9) }, async ({ history, flush }) => {
    let selection, creation;
    await React.act(async () => { selection = history().selectSession(id(1)); });
    await React.act(async () => { creation = history().startNewSession(); });
    await React.act(async () => { older.resolve(session(1)); await selection; }); await flush();
    assert.equal(history().isSuccess, false, 'old transcript must not enable sends during the New chat request');
    await React.act(async () => { creating.resolve(response({ success: true, session: session(50, { messages: [] }) })); await creation; }); await flush();
    assert.equal(history().currentSession.id, id(50));
    assert.equal(history().isSuccess, true);
  });
});

test('an old page cannot resurrect a deleted entry after a newer first-page refresh', async () => {
  const olderPage = deferred(); let refreshed = false;
  await withHistory({ page: (options) => {
    if (options.cursor) return olderPage.promise;
    const { messages, ...row } = session(refreshed ? 6 : 9);
    return response({ success: true, sessions: [{ ...row, hasMessages: true }], nextCursor: 'next' });
  } }, async ({ history, client, flush }) => {
    let paging; await React.act(async () => { paging = history().loadMoreSessions(); });
    refreshed = true;
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'], exact: false })); await flush();
    const { messages, ...removed } = session(8);
    await React.act(async () => { olderPage.resolve(response({ success: true, sessions: [{ ...removed, hasMessages: true }], nextCursor: null })); await paging; }); await flush();
    assert.deepEqual(history().historySessions.map(({ id }) => id), [id(6)]);
    assert.equal(history().hasMoreSessions, true, 'stale page cannot replace the refreshed cursor');
    assert.equal(history().isLoadingMoreSessions, false);
  });
});

test('first-page refresh cannot drop a new local session created after its request began', async () => {
  const refreshing = deferred(); let delay = false;
  await withHistory({ page: () => {
    if (delay) return refreshing.promise;
    const { messages, ...row } = session(9);
    return response({ success: true, sessions: [{ ...row, hasMessages: true }], nextCursor: null });
  } }, async ({ history, client, flush }) => {
    delay = true; let refresh;
    await React.act(async () => { refresh = client.invalidateQueries({ queryKey: ['chat-session-summaries'] }); });
    await React.act(async () => history().startNewSession()); await flush();
    const { messages, ...row } = session(9);
    await React.act(async () => { refreshing.resolve(response({ success: true, sessions: [{ ...row, hasMessages: true }], nextCursor: null })); await refresh; }); await flush();
    assert.equal(history().currentSession.id, id(50));
    assert.equal(history().historySessions.some((row) => row.id === id(50)), true);
  });
});

test('a refreshed deletion clears a resolved board bridge instead of sending into its missing conversation', async () => {
  const rows = [session(9), session(1, { projectId: 4 })];
  await withHistory({ rows, boardMap: { 4: id(1) }, page: () => response({ success: true, sessions: rows.map(({ messages, ...row }) => ({ ...row, hasMessages: true })), nextCursor: null }) }, async ({ history, resolver, client, flush }) => {
    await React.act(async () => resolver().ensureSessionForCurrentBoard()); await flush();
    assert.equal(history().currentSession.id, id(1));
    rows.splice(rows.findIndex((row) => row.id === id(1)), 1);
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    assert.equal(history().currentSession.id, id(9));
    let target; await React.act(async () => { target = await resolver().ensureSessionForCurrentBoard(); }); await flush();
    assert.equal(target.id, history().currentSession.id);
  });
});


test('a transcript snapshot cannot erase a local write acknowledged while that snapshot was loading', async () => {
  const writing = deferred(), detail = deferred(); let loading = false;
  await withHistory({ message: () => writing.promise, transcript: () => loading ? detail.promise : session(9) }, async ({ history, rows, client, flush }) => {
    const message = { id: 'ack-during-fetch', content: 'just saved', createdAt: new Date() };
    await React.act(async () => history().addMessageToSessionQuery(id(9), message));
    rows[0] = { ...rows[0], updatedAt: new Date('2026-02-01') };
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    loading = true; let selection;
    await React.act(async () => { selection = history().selectSession(id(9)); });
    await React.act(async () => writing.resolve(response({ message }))); await flush();
    await React.act(async () => { detail.resolve(rows[0]); await selection; }); await flush();
    assert.equal(history().currentSession.messages.at(-1).id, message.id);
  });
});

test('navigation never exposes another cached task conversation as ready before initialization selects the destination', async () => {
  const snapshots = [];
  await withHistory({ taskId: 91, rows: [session(9), session(1, { taskId: 91 }), session(2, { taskId: 92 })], observe: (history, taskId) => snapshots.push({ taskId, ready: history.isSuccess, selected: history.currentSession?.taskId }) }, async ({ history, setTask, render }) => {
    setTask(92); await render();
    assert.equal(history().currentSession.taskId, 92);
    assert.ok(snapshots.filter(({ ready }) => ready).every(({ taskId, selected }) => taskId === selected));
  });
});

test('deleting the active task conversation starts exactly one replacement task initialization', async () => {
  await withHistory({ taskId: 93 }, async ({ history, requests, flush }) => {
    assert.equal(history().currentSession.taskId, 93);
    await React.act(async () => history().deleteSession(history().currentSession.id)); await flush();
    assert.equal(history().currentSession?.taskId, 93);
    assert.equal(history().isSuccess, true);
    assert.equal(requests.filter(([type]) => type === 'create').length, 2);
  });
});


test('acknowledgements after task navigation are no longer treated as pending when that task is reopened', async () => {
  const writing = deferred();
  await withHistory({ taskId: 91, rows: [session(9), session(1, { taskId: 91 }), session(2, { taskId: 92 })], message: () => writing.promise }, async ({ history, rows, setTask, render, flush }) => {
    const message = { id: 'saved-after-navigation', content: 'pending turn', createdAt: new Date() };
    await React.act(async () => history().addMessageToSessionQuery(id(1), message));
    setTask(92); await render();
    await React.act(async () => writing.resolve(response({ message }))); await flush();
    const index = rows.findIndex((row) => row.id === id(1));
    rows[index] = { ...rows[index], updatedAt: new Date('2026-02-01'), messages: [{ ...message, content: 'edited after acknowledgement' }] };
    setTask(91); await render();
    assert.equal(history().currentSession.messages[0].content, 'edited after acknowledgement');
  });
});

test('a failed rename after task navigation rolls back its cached title before reopening', async () => {
  const renaming = deferred(); const original = console.error; console.error = () => {};
  try {
    await withHistory({ taskId: 91, rows: [session(9), session(1, { taskId: 91 }), session(2, { taskId: 92 })], rename: () => renaming.promise }, async ({ history, setTask, render, flush }) => {
      let rename; await React.act(async () => { rename = history().updateSessionTitle(id(1), 'not saved'); });
      setTask(92); await render();
      await React.act(async () => { renaming.reject(new Error('429')); await rename; }); await flush();
      setTask(91); await render();
      assert.equal(history().currentSession.title, 'Chat 1');
    });
  } finally { console.error = original; }
});

test('a completed delete after task navigation removes its old transcript without changing the destination', async () => {
  const deleting = deferred();
  await withHistory({ taskId: 91, rows: [session(9), session(1, { taskId: 91 }), session(2, { taskId: 92 })], delete: () => deleting.promise }, async ({ history, rows, setTask, render, flush }) => {
    let deletion; await React.act(async () => { deletion = history().deleteSession(id(1)); });
    setTask(92); await render();
    rows.splice(rows.findIndex((row) => row.id === id(1)), 1);
    await React.act(async () => { deleting.resolve(response({ success: true })); await deletion; }); await flush();
    assert.equal(history().currentSession.taskId, 92);
    assert.equal(history().sessions.some((row) => row.id === id(1)), false);
  });
});


test('active newer summary automatically refreshes its transcript while preserving pending local writes', async () => {
  const writing = deferred();
  await withHistory({ message: () => writing.promise }, async ({ history, rows, client, flush }) => {
    const pending = { id: 'pending-active', content: 'local question', role: 'human', createdAt: new Date('2026-12-31T00:00:00Z') };
    await React.act(async () => history().addMessageToSessionQuery(id(9), pending));
    rows[0] = { ...rows[0], updatedAt: new Date('2027-01-01'), messages: [...rows[0].messages, { id: 'remote-active', content: 'new in another tab', createdAt: new Date('2026-12-31T00:00:01Z') }] };
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    assert.equal(history().activeSession, id(9));
    assert.deepEqual(history().currentSession.messages.slice(-2).map(({ id }) => id), ['pending-active', 'remote-active']);
    assert.match(document.getElementById('root').textContent, /new in another tab/);
    await React.act(async () => writing.resolve(response({ message: pending }))); await flush();
  });
});

test('deleted conversation is evicted and never sent to', async () => {
  for (const fullscreen of [false, true]) {
    let missing = false;
    await withHistory({ boardMap: { 4: id(9) }, fullscreen, transcript: (sessionId) => {
      if (missing && sessionId === id(9)) throw Object.assign(new Error('deleted'), { response: { status: 404 } });
      return session(Number(sessionId.slice(-12)));
    } }, async ({ history, resolver, rows, client, flush }) => {
      await React.act(async () => resolver().ensureSessionForCurrentBoard()); await flush();
      await React.act(async () => resolver().selectSession(id(1))); await flush();
      missing = true; rows.splice(rows.findIndex((row) => row.id === id(9)), 1);
      await React.act(async () => resolver().selectSession(id(9))); await flush();
      assert.equal(client.getQueryData(['aiChatTranscript', 'user-6', 6, flag, id(9)]), undefined);
      assert.equal(history().historySessions.some((row) => row.id === id(9)), false);
      assert.equal(history().currentSession.id, id(1));
      let target; await React.act(async () => { target = await resolver().ensureSessionForCurrentBoard(0); });
      assert.equal(target.id, history().activeSession);
      assert.notEqual(target.id, id(9));
    });
  }
});

test('send and rename move a chat to the top', async () => {
  const writing = deferred(), renaming = deferred();
  await withHistory({ message: () => writing.promise, rename: () => renaming.promise }, async ({ history, rows, flush }) => {
    await React.act(async () => history().loadMoreSessions()); await flush();
    await React.act(async () => history().selectSession(id(1))); await flush();
    const loadedVersion = history().currentSession.updatedAt;
    const pending = { id: 'recency-write', content: 'new turn', createdAt: new Date() };
    await React.act(async () => history().addMessageToSessionQuery(id(1), pending)); await flush();
    assert.equal(history().historySessions[0].id, id(1));
    assert.ok(+new Date(history().historySessions[0].updatedAt) > +new Date(loadedVersion));
    assert.equal(history().currentSession.updatedAt, loadedVersion, 'optimistic recency must not pretend the transcript is freshly loaded');
    rows[1] = { ...rows[1], updatedAt: new Date('2026-01-02'), messages: [...rows[1].messages, pending] };
    await React.act(async () => writing.resolve(response({ message: pending }))); await flush();
    assert.equal(history().historySessions[0].id, id(9), 'server recency replaces the optimistic clock');
    let rename; await React.act(async () => { rename = history().updateSessionTitle(id(1), 'Recent title'); }); await flush();
    assert.equal(history().historySessions[0].id, id(1));
    assert.equal(history().historySessions[0].title, 'Recent title');
    rows[1] = { ...rows[1], title: 'Recent title', updatedAt: new Date('2026-01-02') };
    await React.act(async () => { renaming.resolve(response({ success: true })); await rename; }); await flush();
    assert.equal(history().historySessions[0].id, id(9));
  });
});

test('failed initial transcript retries on summary refresh without a selection latch', async () => {
  let failing = true;
  await withHistory({ transcript: () => failing ? Promise.reject(new Error('429')) : session(9) }, async ({ history, client, flush }) => {
    assert.equal(history().isSuccess, false);
    assert.equal(history().isError, true);
    assert.equal(history().isSessionPending, false);
    failing = false;
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    assert.equal(history().currentSession.id, id(9));
    assert.equal(history().isSuccess, true);
  });
});

test('board setup finds an unloaded empty session with a server filter before creating', async () => {
  await withHistory({ boardMap: {}, rows: [session(9), session(8), session(1, { messages: [] })] }, async ({ resolver, requests, history, flush }) => {
    let target; await React.act(async () => { target = await resolver().ensureSessionForCurrentBoard(); }); await flush();
    assert.equal(target.id, id(1));
    assert.equal(history().activeSession, id(1));
    assert.ok(requests.some(([type, options]) => type === 'page' && options.emptyOnly === true && options.limit === 1));
    assert.equal(requests.some(([type]) => type === 'create'), false);
    assert.equal(requests.some(([type, options]) => type === 'page' && options.cursor), false, 'empty reuse does not drain history');
  });
});

test('a newer summary arriving during transcript loading refreshes after the older snapshot completes', async () => {
  const detail = deferred(); let loading = true;
  await withHistory({ transcript: (sessionId) => loading ? detail.promise : session(Number(sessionId.slice(-12)), { updatedAt: new Date('2027-01-01'), title: 'Latest server title' }) }, async ({ history, rows, client, flush }) => {
    rows[0] = { ...rows[0], updatedAt: new Date('2027-01-01') };
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    loading = false;
    await React.act(async () => detail.resolve(session(9))); await flush();
    assert.equal(history().currentSession.title, 'Latest server title');
  });
});


test('a transcript snapshot cannot erase a rename acknowledged while it was loading', async () => {
  const renaming = deferred(), detail = deferred(); let loading = false;
  await withHistory({ rename: () => renaming.promise, transcript: () => loading ? detail.promise : session(9) }, async ({ history, rows, flush }) => {
    let rename, selection;
    await React.act(async () => { rename = history().updateSessionTitle(id(9), 'Just saved'); });
    loading = true;
    await React.act(async () => { selection = history().selectSession(id(9)); });
    await React.act(async () => { renaming.resolve(response({ success: true })); await rename; }); await flush();
    await React.act(async () => { detail.resolve(session(9)); await selection; }); await flush();
    assert.equal(history().currentSession.title, 'Just saved');
    rows[0] = { ...rows[0], title: 'Later remote title', updatedAt: new Date('2027-01-01') };
    detail.promise = Promise.resolve(rows[0]);
    await React.act(async () => history().selectSession(id(9))); await flush();
    assert.equal(history().currentSession.title, 'Later remote title', 'completed renames do not permanently override the server');
  });
});

test('sending in an unloaded scoped conversation adds its optimistic summary at the top', async () => {
  const writing = deferred();
  await withHistory({ boardMap: { 4: id(1) }, message: () => writing.promise }, async ({ resolver, history, flush }) => {
    await React.act(async () => resolver().ensureSessionForCurrentBoard()); await flush();
    assert.deepEqual(history().historySessions.map(({ id }) => id), [id(9)]);
    await React.act(async () => history().addMessageToSessionQuery(id(1), { id: 'unlisted-send', content: 'now recent', createdAt: new Date() })); await flush();
    assert.equal(history().historySessions[0].id, id(1));
    await React.act(async () => writing.resolve(response({ message: { id: 'unlisted-send', content: 'now recent', createdAt: new Date() } }))); await flush();
  });
});


test('paged send rejects a changed or deleted displayed session during attachment preparation', async () => {
  const { createAiChatSend } = load('src/hooks/MultiPages/AIChat/aiChatSend.ts', {
    './aiChatStream': { consumeAiChatStream: () => assert.fail('must not start a stream') },
    'react-hot-toast': { default: { error: () => {} } },
    '@/lib/mcp/bearerAuth': { mcpAuthorizationHeaders: () => ({}) }, '@/lib/aiChat/streamRefusal': {}, '@/lib/demo/guestBoardBuild': { isGuestBoardBuild: () => false },
  });
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('fixture stream');
  try { for (const deleted of [false, true]) {
    const preparation = deferred(); let displayed = session(9), writes = 0, cleared = 0;
    const { handleSendMessage } = createAiChatSend({
      sessionPagingEnabled: true, getDisplayedSession: () => displayed,
      waitForChatSession: async () => session(9), processAttachments: () => preparation.promise,
      editor: { getText: () => 'question', getHTML: () => '<p>question</p>', commands: { clearContent: () => { cleared++; } } },
      sendInFlightRef: { current: false }, handleSendMessageRef: { current: null },
      addMessageToSessionQuery: () => { writes++; }, drainQueuedMessage: () => {}, isFullScreenChat: true,
      setIsTyping: () => {}, setAgentStatus: () => {}, setCurrentStreamingSession: () => {},
      currentAiOption: { id: 'fixture', model: 'fixture', source: 'fixture' }, contextList: [],
      streamingSessionRef: { current: null }, streamingAssistantMessageRef: { current: null }, streamingRequestRef: { current: null },
      appendMessageToSessionCache: () => {}, updateLastMessageInSessionCache: () => {},
      fileUpload: { fileItems: [], clearFiles: () => {} },
    });
    const sending = handleSendMessage();
    displayed = deleted ? undefined : session(1);
    preparation.resolve([]);
    assert.equal(await sending, false);
    assert.equal(writes, 0);
    assert.equal(cleared, 0, 'do not erase the composer when its conversation changed');
  } } finally { global.fetch = originalFetch; }
});

test('New chat before initial summaries finish seeds its query-owned summary and keeps its send target', async () => {
  const page = deferred();
  await withHistory({ page: () => page.promise }, async ({ history, rows, flush }) => {
    await React.act(async () => history().startNewSession()); await flush();
    assert.equal(history().currentSession.id, id(50));
    assert.equal(history().historySessions[0].id, id(50));
    const summaries = rows.map(({ messages, ...row }) => ({ ...row, hasMessages: messages.length > 0 }));
    await React.act(async () => page.resolve(response({ success: true, sessions: summaries, nextCursor: null }))); await flush();
    assert.equal(history().activeSession, id(50));
    assert.equal(history().getDisplayedSession().id, id(50));
  });
});


test('displayed transcript uses legacy freshness and refetches on stale window focus', async () => {
  const focused = query.focusManager.isFocused();
  try {
    await withHistory({}, async ({ client, requests, flush }) => {
      const key = ['aiChatTranscript', 'user-6', 6, flag, id(9)];
      const cached = client.getQueryCache().find({ queryKey: key, exact: true });
      assert.equal(cached.options.staleTime, 180000);
      assert.equal(cached.options.refetchOnWindowFocus ?? true, true);
      assert.equal(cached.options.refetchOnMount ?? true, true);
      await React.act(async () => client.setQueryData(key, (old) => old, { updatedAt: Date.now() - 180001 }));
      await React.act(async () => query.focusManager.setFocused(false));
      await React.act(async () => query.focusManager.setFocused(true)); await flush();
      assert.equal(requests.filter(([type]) => type === 'transcript').length, 2);
    });
  } finally { query.focusManager.setFocused(focused); }
});


test('stream updates after an active refresh replace their message ID without erasing a later remote turn', async () => {
  await withHistory({}, async ({ history, rows, client, flush }) => {
    const stream = { id: 'ongoing-stream', role: 'assistant', content: 'partial', isDelivered: false, createdAt: new Date() };
    await React.act(async () => history().appendMessageToSessionCache(id(9), stream));
    rows[0] = { ...rows[0], updatedAt: new Date('2027-01-01'), messages: [...rows[0].messages, { ...stream, content: 'older snapshot' }, { id: 'later-remote', role: 'human', content: 'remote question', createdAt: new Date() }] };
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    await React.act(async () => history().updateLastMessageInSessionCache(id(9), { ...stream, content: 'newer stream chunk' })); await flush();
    assert.deepEqual(history().currentSession.messages.map(({ id }) => id), ['message-9', 'ongoing-stream', 'later-remote']);
    assert.equal(history().currentSession.messages[1].content, 'newer stream chunk');
    await React.act(async () => history().updateLastMessageInSessionCache(id(9), { ...stream, id: 'transport-notice', content: 'connection lost', isDelivered: true })); await flush();
    assert.deepEqual(history().currentSession.messages.map(({ id }) => id), ['message-9', 'transport-notice', 'later-remote']);
  });
});

test('new feature flag defaults Owner + QA', () => {
  const definition = require('./helpers/flag-files.cjs').load(require('node:path').resolve('src/lib/flags/definitions/htpr-6971-chat-history-paging.ts'));
  assert.equal(definition.HTPR_6971_CHAT_HISTORY_PAGING_FLAG, flag);
  assert.equal(definition.default.kind, 'feature');
  assert.equal(definition.default.defaultMode, 'OWNER_AND_QA');
  assert.ok(definition.default.releaseRisk.reason);
  const source = require('node:fs').readFileSync('src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts', 'utf8');
  assert.match(source, /useFlag\(HTPR_6971_CHAT_HISTORY_PAGING_FLAG\)/);
});

test('unavailable server paging falls back to the complete legacy cache without requesting transcripts', async () => {
  await withHistory({ legacyServer: true }, async ({ history, requests, flush }) => {
    assert.equal(history().sessionPagingEnabled, false);
    assert.equal(history().sessions.length, 2);
    assert.equal(history().hasMoreSessions, false);
    assert.equal(requests.some(([type]) => type === 'transcript'), false);
    await React.act(async () => history().selectSession(id(1))); await flush();
    assert.equal(history().currentSession.id, id(1));
    assert.equal(history().currentSession.messages[0].id, 'message-1');
    assert.equal(requests.some(([type]) => type === 'transcript'), false);
  });
});

test('thirty titles load per page and messages load only for the displayed conversation', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => session(60 - i));
  await withHistory({ rows, page: (options) => {
    assert.equal(options.limit, 30);
    const offset = options.cursor ? 30 : 0;
    const summaries = rows.slice(offset, offset + options.limit).map(({ messages, ...row }) => ({ ...row, hasMessages: messages.length > 0 }));
    return response({ success: true, sessions: summaries, nextCursor: offset ? null : 'page-two' });
  } }, async ({ history, requests, flush }) => {
    assert.equal(history().historySessions.length, 30);
    assert.equal(requests.filter(([type]) => type === 'page').length, 1);
    assert.deepEqual(requests.filter(([type]) => type === 'transcript').map(([, value]) => value), [id(60)]);
    await React.act(async () => history().loadMoreSessions()); await flush();
    assert.equal(history().historySessions.length, 60);
    assert.equal(history().hasMoreSessions, false);
    assert.equal(requests.filter(([type]) => type === 'transcript').length, 1);
    await React.act(async () => history().selectSession(id(1))); await flush();
    assert.equal(history().currentSession.id, id(1));
    assert.equal(requests.filter(([type]) => type === 'transcript').at(-1)[1], id(1));
  });
});

test('board lookup never picks a ticket conversation from a map, scoped lookup or empty reuse', async () => {
  const rows = [session(9, { taskId: 91, projectId: 4, messages: [] }), session(1, { projectId: 4 })];
  await withHistory({ rows, boardMap: { 4: id(9) }, page: (options) => {
    // Deliberately include the ticket in a board response to prove client validation too.
    const visible = options.projectId ? [rows[0], rows[1]] : rows.slice(0, 1);
    return response({ success: true, sessions: visible.map(({ messages, ...row }) => ({ ...row, hasMessages: messages.length > 0 })), nextCursor: null });
  } }, async ({ resolver, history, requests, flush, mapChanges }) => {
    let target;
    await React.act(async () => { target = await resolver().ensureSessionForCurrentBoard(); }); await flush();
    assert.equal(target.id, id(1));
    assert.equal(target.taskId, null);
    assert.equal(history().currentSession.id, id(1));
    assert.deepEqual(mapChanges, [{}]);
    assert.equal(requests.some(([type]) => type === 'create'), false);
  });
  await withHistory({ rows: [session(9, { taskId: 91, messages: [] })], boardMap: {} }, async ({ resolver, history, flush }) => {
    let target;
    await React.act(async () => { target = await resolver().ensureSessionForCurrentBoard(); }); await flush();
    assert.notEqual(target.id, id(9));
    assert.equal(target.taskId, null);
    assert.equal(target.id, history().currentSession.id);
  });
});

test('cancelled New chat does not leave history stuck loading', async () => {
  const creation = deferred();
  await withHistory({ create: () => creation.promise }, async ({ history, flush }) => {
    let starting;
    await React.act(async () => { starting = history().startNewSession(() => false); });
    assert.equal(history().isSessionPending, true);
    await React.act(async () => { creation.resolve(response({ success: true, session: session(50, { messages: [] }) })); await starting; }); await flush();
    assert.equal(history().isSessionPending, false);
    assert.equal(history().isSuccess, true);
    assert.equal(history().currentSession.id, id(9));
    assert.equal(history().historySessions.some((row) => row.id === id(50)), false);
  });
});

test('merging server and local messages keeps chronological and equal-time turn order', () => {
  const message = (id, time) => ({ id, content: id, createdAt: new Date(`2026-01-01T00:00:0${time}Z`) });
  const incoming = session(1, { messages: [message('start', 0), message('remote', 2), message('assistant', 3)] });
  const local = session(1, { messages: [message('start', 0), message('human', 1), message('assistant', 3), message('streaming', 4)] });
  assert.deepEqual(wire.mergeSessionTranscript(incoming, local, new Set(['human', 'streaming'])).messages.map(({ id }) => id), ['start', 'human', 'remote', 'assistant', 'streaming']);
  const sameTime = session(1, { messages: [message('human', 3), message('assistant', 3)] });
  assert.deepEqual(wire.mergeSessionTranscript(session(1, { messages: [message('assistant', 3)] }), sameTime, new Set(['human'])).messages.map(({ id }) => id), ['human', 'assistant']);
});

test('cancelled New chat also resumes initialization if summaries arrived during creation', async () => {
  const page = deferred(), creation = deferred();
  await withHistory({ page: () => page.promise, create: () => creation.promise }, async ({ history, flush }) => {
    let starting;
    await React.act(async () => { starting = history().startNewSession(() => false); });
    const { messages, ...summary } = session(9);
    await React.act(async () => page.resolve(response({ success: true, sessions: [{ ...summary, hasMessages: messages.length > 0 }], nextCursor: null }))); await flush();
    assert.equal(history().isSessionPending, true);
    await React.act(async () => { creation.resolve(response({ success: true, session: session(50) })); await starting; }); await flush();
    assert.equal(history().isSessionPending, false);
    assert.equal(history().isSuccess, true);
    assert.equal(history().getDisplayedSession().id, id(9));
  });
});

test('refreshHistorySessions keeps one identity across renders so the open history dropdown does not refetch in a loop', async () => {
  await withHistory({}, async ({ history, render, requests, flush }) => {
    const first = history().refreshHistorySessions;
    assert.equal(typeof first, 'function');
    await render(); await render();
    assert.equal(history().refreshHistorySessions, first, 'a new function each render re-runs the dropdown effect and refetches');
    const pages = requests.filter(([type]) => type === 'page').length;
    await render(); await flush();
    assert.equal(requests.filter(([type]) => type === 'page').length, pages, 're-rendering alone must not fetch summaries');
  });
});

test('chat orchestration passes the live ticket flag into resolution and send guards, preserving server rollback', () => {
  for (const enabled of [false, true]) for (const available of [false, true]) {
    let resolution, sending;
    const { useAiChat } = load('src/hooks/MultiPages/AIChat/useAiChat.ts', {
      "@/hooks/MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigateToTask() {} }) },
      '@/lib/state': { useRecoilState: () => [null, () => {}] },
      '@/store': {},
      '@/hooks/useFlag': { useFlag: (key) => key === flag && enabled },
      './useAiChatState': { useAiChatState: () => ({ sessionPagingEnabled: available }) },
      './useAiChatSessions': { useAiChatSessions: (context) => { resolution = context; return {}; } },
      './aiChatSend': { createAiChatSend: (context) => { sending = context; return {}; } },
      './useAiChatAttachments': { useAiChatAttachments: () => ({}) },
      './aiChatKeyboard': { createAiChatKeyboard: () => ({}) },
      './useAiChatPresentation': { useAiChatPresentation: () => ({}) },
    });
    require('react-dom/server').renderToString(React.createElement(() => { useAiChat(); return null; }));
    assert.equal(resolution.sessionPagingEnabled, enabled && available);
    assert.equal(sending.sessionPagingEnabled, enabled && available);
  }
});

test('flag-off session setup identity is exactly the production key without a paging suffix', () => {
  const fs = require('node:fs');
  const filename = 'src/hooks/MultiPages/AIChat/useAiChatState.ts';
  const changed = fs.readFileSync(filename, 'utf8').match(/const sessionContextKey = (\[[\s\S]*?\]\.join\(":"\))/)[1];
  const context = { surface: 'chat', isFullScreenChat: false, boardScopeIsExplicit: false, scopedProjectId: 4, currentProject: { id: 4 }, currentUser: { id: 6, uid: 'user-6' }, taskId: undefined, ticketScopeSelected: false, sessionPagingEnabled: false };
  const evaluate = (expression, values) => new Function(...Object.keys(values), `return ${expression}`)(...Object.values(values));
  for (const taskId of [undefined, 91]) {
    context.taskId = taskId;
    const legacyKey = `chat:docked:implicit:4:4:6:${taskId ?? 'no-task'}`;
    assert.equal(evaluate(changed, context), legacyKey);
    assert.equal(evaluate(changed, { ...context, sessionPagingEnabled: true }), `${legacyKey}:${flag}`);
  }
});
