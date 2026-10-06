const { test } = require('node:test');
const { assert, session, id, flag } = require('./ai-chat-session-fixture.cjs');
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
  const rows = config.rows ?? [session(9), session(1, { taskId: 91, projectId: 4 })];
  let enabled = config.on ?? true, taskId = config.taskId, user = { id: 6, uid: 'user-6' }, pathname = config.demo ? '/demo' : '/chat', intro = config.intro ?? null;
  const api = {
    getAllSessions: async () => { requests.push(['legacy', user.id]); return response({ success: true, sessions: rows.filter((row) => row.userId === user.id) }); },
    getSessionPage: async (options = {}) => {
      requests.push(['page', { ...options }, user.id]);
      if (config.page) return config.page(options, user);
      let visible = rows.filter((row) => row.userId === user.id && (!options.taskId || row.taskId === options.taskId) && (!options.projectId || row.projectId === options.projectId));
      if (config.legacyServer) return response({ success: true, sessions: visible });
      if (options.cursor) visible = visible.slice(1);
      const summaries = visible.slice(0, options.limit ?? 1).map(({ messages, ...row }) => ({ ...row, hasMessages: messages.length > 0 }));
      return response({ success: true, sessions: summaries, nextCursor: options.cursor || options.taskId || options.projectId || visible.length <= 1 ? null : 'next' });
    },
    getSessionTranscript: async (sessionId) => { requests.push(['transcript', sessionId, user.id]); if (config.transcript) return config.transcript(sessionId, user); return rows.find((row) => row.id === sessionId && row.userId === user.id) ?? null; },
    createSessionNext: async (scope) => { requests.push(['create', scope]); if (config.create) return config.create(scope); if (config.createError) throw config.createError; const row = session(50, { taskId: scope ?? null, messages: [] }); rows.unshift(row); return response({ success: true, session: row }); },
    addMessage: async (sessionId, message) => { requests.push(['message', sessionId, message.id]); if (config.message) return config.message(sessionId, message); return response({ message }); },
    updateSession: async (sessionId, title) => { requests.push(['rename', sessionId]); if (config.rename) return config.rename(sessionId, title); if (config.renameError) throw config.renameError; const row = rows.find((row) => row.id === sessionId); row.title = title; return response({ success: true, session: row }); },
    deleteSession: async (sessionId) => { requests.push(['delete', sessionId]); if (config.delete) return config.delete(sessionId); if (config.deleteError) throw config.deleteError; rows.splice(rows.findIndex((row) => row.id === sessionId), 1); if (!rows.length) rows.push(session(60, { messages: [] })); return response({ message: 'Deleted' }); },
  };
  const { useSessionAndChatHistory } = load('src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts', {
    '@/hooks/useFlag': { useFlag: (key) => key === flag ? enabled : !!config.compose },
    '@/lib/state': { useRecoilValue: () => user, useRecoilState: () => [intro, (next) => { intro = next; }] },
    '@/store': { currentUserAtom: 'user', composeTaskChatIntroAtom: 'intro' },
    '@/utils/api/ai_chat': { ...wire, AI_Chat_API: api },
    'next/navigation': { usePathname: () => pathname },
  });
  let resolver, history;
  const mapChanges = [];
  const useAiChatSessions = config.boardMap ? load('src/hooks/MultiPages/AIChat/useAiChatSessions.ts', {
    '@/hooks/useFlag': { useFlag: (key) => key === flag && enabled },
    '@/lib/constants': { default: {} }, '@/lib/contexts/deviceContext': { useDeviceContext: () => false },
    '@/components/Common/AttachmentsUpload/FileUploadHandler': { useFileUpload: () => ({}) },
    '@/lib/byokSelectedProviderGate': { shouldBlockAiDueToByokProvider: () => false },
    '@/lib/demo/isGuestClient': { isGuestCookieUser: () => false },
  }).useAiChatSessions : undefined;
  function Probe() { history = useSessionAndChatHistory(taskId, true, taskId !== undefined);
    if (useAiChatSessions) {
      const sessionsRef = React.useRef(history.sessions); sessionsRef.current = history.sessions;
      const chatHistoryReadyRef = React.useRef(history.isSuccess); chatHistoryReadyRef.current = history.isSuccess;
      resolver = useAiChatSessions({
        sessionsRef, chatHistoryReadyRef, sessionIntentGenerationRef: React.useRef(0), sessionSetupRef: React.useRef(null), resolvedBoardSessionRef: React.useRef(null), previousProjectIdRef: React.useRef(undefined),
        messageQueueRef: React.useRef([]), sendInFlightRef: React.useRef(false), currentProject: { id: 4 }, currentUser: user, taskId, pathname: '/board', sessionContextKey: 'fixture-board', dockedChatScope: null,
        aiChatBoardSessionMap: config.boardMap, setAiChatBoardSessionMap: (update) => mapChanges.push(update(config.boardMap)), setRecentChatBoardIds: () => {}, setQueuedMessages: () => {},
        clearMessageQueue: () => {}, selectSessionInHistory: history.selectSession, createSession: history.startNewSession, deleteSessionInHistory: history.deleteSession, resolveHistorySession: history.resolveHistorySession, shouldLoadChatHistory: false,
        isFullScreenChat: !!config.fullscreen, setDockedChatScope: () => {},
      });
    }
    if (config.observe) config.observe(history, taskId);
    return React.createElement('div', { 'data-ready': history.isSuccess, 'data-pending': history.isSessionPending }, history.currentSession?.messages.map((message) => React.createElement('p', { key: message.id }, message.content))); }
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  const flush = async () => { for (let i = 0; i < 4; i++) await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); }); };
  const render = async () => { await React.act(async () => root.render(React.createElement(query.QueryClientProvider, { client }, React.createElement(Probe)))); await flush(); };
  try {
    await render();
    await check({ history: () => history, resolver: () => resolver, mapChanges, client, requests, rows, flush, render, intro: () => intro, setFlag: (next) => { enabled = next; }, setTask: (next) => { taskId = next; }, setUser: (next) => { user = next; }, api });
  } finally {
    await React.act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key]; }
  }
}

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
  assert.deepEqual(calls[1][1].params, { compat: 'htpr-6924', cursor: 'opaque' });
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
    assert.equal(requests.length, 0);
    await React.act(async () => history().startNewSession());
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

test('cached older selection keeps displayed conversation and send target aligned on fullscreen and initialized boards', async () => {
  for (const fullscreen of [false, true]) {
    await withHistory({ boardMap: { 4: id(9) }, fullscreen }, async ({ history, resolver, requests, flush }) => {
      await React.act(async () => resolver().ensureSessionForCurrentBoard()); await flush();
      await React.act(async () => resolver().selectSession(id(1))); await flush();
      const transcriptRequests = requests.filter(([type]) => type === 'transcript').length;
      await React.act(async () => resolver().selectSession(id(9))); await flush();
      assert.equal(requests.filter(([type]) => type === 'transcript').length, transcriptRequests, 'cached selection needs no transcript request');
      assert.equal(history().currentSession.id, id(9));
      assert.equal(history().sessions[0].id, id(9));
      let target;
      await React.act(async () => { target = await resolver().ensureSessionForCurrentBoard(); });
      assert.equal(target.id, history().currentSession.id, 'the next send belongs to the displayed cached conversation');
    });
  }
});

test('New chat invalidates a pending older transcript so its late completion cannot become the send target', async () => {
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
    assert.equal(client.getQueriesData({ queryKey: ['chat-session-transcripts', 'user-6'] }).length, 0);
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
  await withHistory({ boardMap: {} }, async ({ resolver, requests }) => {
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
  const state = { sessions: [session(9)], historySessions: [session(9), session(1)], currentSession: session(9), hasMoreSessions: true,
    isLoadingMoreSessions: false, pagingError: false, loadMoreSessions: async () => { loads++; }, selectSession: (value) => { selected = value; } };
  const tooltip = () => ({ text: '', keyCombination: [] });
  const mocks = {
    '@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context': { useAiChatContext: () => state },
    'next/navigation': { usePathname: () => '/chat', useRouter: () => ({ push() {} }) },
    '@/hooks/useFlag': { useFlag: (key) => key === flag && enabled },
    '@/lib/flags/keys': { HTPR_6924_REST_COMPAT_FLAG: flag },
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
  } finally {
    await React.act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key]; }
  }
});


test('optimistic message/title/create writes update summary metadata without inventing empty transcripts', async () => {
  await withHistory({ rows: [session(9, { messages: [] }), session(1)] }, async ({ history, client, flush }) => {
    await React.act(async () => history().addMessageToSessionQuery(id(9), { id: 'sent', sessionId: id(9), content: 'hello', createdAt: new Date(), role: 'human' })); await flush();
    const summaryKey = ['chat-session-summaries', 'user-6', 6, flag, 'history'];
    assert.equal(client.getQueryData(summaryKey).data.sessions.find((row) => row.id === id(9)).hasMessages, true);
    await React.act(async () => history().updateSessionTitle(id(9), 'Renamed')); await flush();
    assert.equal(client.getQueryData(summaryKey).data.sessions.find((row) => row.id === id(9)).title, 'Renamed');
    await React.act(async () => history().startNewSession()); await flush();
    assert.equal(history().currentSession.id, id(50));
    assert.ok(client.getQueryData(summaryKey).data.sessions.some((row) => row.id === id(50)));
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


test('newer summaries refresh cached transcripts and replace acknowledged content, titles and removed messages', async () => {
  await withHistory({}, async ({ history, rows, client, requests, flush }) => {
    const initial = history().currentSession;
    rows[0] = { ...initial, title: 'Changed in another tab', updatedAt: new Date('2026-02-01'), messages: [
      { ...initial.messages[0], content: 'edited remotely' }, { id: 'remote', content: 'another tab', createdAt: new Date('2026-02-01') },
    ] };
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    await React.act(async () => history().selectSession(initial.id)); await flush();
    assert.equal(requests.filter(([type]) => type === 'transcript').length, 2);
    assert.equal(history().currentSession.title, 'Changed in another tab');
    assert.deepEqual(history().currentSession.messages.map(({ content }) => content), ['edited remotely', 'another tab']);
    rows[0] = { ...rows[0], updatedAt: new Date('2026-03-01'), messages: [rows[0].messages[1]] };
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'] })); await flush();
    await React.act(async () => history().selectSession(initial.id)); await flush();
    assert.deepEqual(history().currentSession.messages.map(({ id }) => id), ['remote']);
    const count = requests.filter(([type]) => type === 'transcript').length;
    await React.act(async () => history().selectSession(initial.id)); await flush();
    assert.equal(requests.filter(([type]) => type === 'transcript').length, count, 'unchanged summaries still reuse the transcript');
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
    await React.act(async () => client.invalidateQueries({ queryKey: ['chat-session-summaries'], exact: false }, { cancelRefetch: false })); await flush();
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
