const assert = require('node:assert/strict');
const test = require('node:test');
const { run, contract, operations, baseline } = require('./rest-route-entry-compat.test.cjs');
const { run: runPage, contract: pageContract, operations: pages, baseline: pageBaseline } = require('./page-route-entry-compat.test.cjs');
const { load } = require('./task-route-loader.cjs');
const chat = { taskSessions: 'read', allSessions: 'read', createSession: 'write', updateSession: 'write', addMessage: 'write', deleteSession: 'write' };
const text429 = '{"error":"Rate limit exceeded. Please try again shortly."}';
const limitHeaders = [['content-type', 'application/json'], ['retry-after', '17']];

for (const [operation, bucket] of Object.entries(chat)) {
  test(`${operation}: trusted ON is charged once; below-limit response, queries and side effects are unchanged`, async () => {
    const result = await run(operation, 'ON');
    assert.deepEqual(result.limits, [[985, bucket]]);
    assert.deepEqual(contract(result), baseline[operation]);
    assert.deepEqual(result.probes.filter(([kind]) => kind === 'flag'), [['flag', 'htpr-6924-rest-compat', 985]]);
  });
  test(`${operation}: ON 429 precedes JSON, DB, uploads/deletes, transcript reads and empty-session creation`, async () => {
    for (const options of [{}, { emptyHistory: true, lastSession: true }, { query: { delete: 'ALL' } }]) {
      const result = await run(operation, 'ON', { ...options, limited: true });
      assert.equal(result.status, 429);
      assert.equal(result.text, text429);
      assert.deepEqual(result.headers, limitHeaders);
      assert.deepEqual(result.limits, [[985, bucket]]);
      assert.deepEqual(result.calls, []);
      assert.equal(result.jsonReads, 0);
      assert.deepEqual(result.readers, []);
    }
  });
  test(`${operation}: OFF, absent identity and failed flag probe never charge or inject headers`, async () => {
    for (const mode of ['OFF', 'FLAG_FAILURE', 'NO_SESSION', 'USER_FAILURE']) {
      const result = await run(operation, mode, { limited: true });
      assert.deepEqual(result.limits, []);
      assert.ok(!result.headers.some(([name]) => name === 'retry-after'));
      if (['OFF', 'FLAG_FAILURE'].includes(mode)) assert.deepEqual(contract(result), baseline[operation]);
    }
  });
}
for (const [operation, [, method]] of Object.entries(pages)) {
  const bucket = method === 'GET' ? 'read' : 'write';
  test(`page ${operation}: one trusted ON charge, exact below-limit bytes and service arguments`, async () => {
    const limits = [];
    const mocks = { '@/lib/api/rateLimit': { checkRestRateLimit: async (...args) => { limits.push(args); return null; } } };
    const result = await runPage(operation, 'ON', { mocks });
    assert.deepEqual(pageContract(result), pageBaseline[operation]);
    assert.deepEqual(limits, [[985, bucket]]);
  });
  test(`page ${operation}: only trusted ON gets 429; rejected request has no parser/query/write effects`, async () => {
    for (const [mode, options] of [['ON', {}], ['OFF', {}], ['FLAG_FAILURE', {}], ['USER_FAILURE', {}], ['NO_SESSION', {}], ['ON', { profileId: 7 }], ['ON', { noProfile: true }]]) {
      const limits = [];
      const mocks = { '@/lib/api/rateLimit': { checkRestRateLimit: async (...args) => { limits.push(args); return new Response(text429, { status: 429, headers: Object.fromEntries(limitHeaders) }); } } };
      const result = await runPage(operation, mode, { ...options, mocks });
      if (mode === 'ON' && !Object.keys(options).length) {
        assert.deepEqual({ status: result.status, text: result.text, headers: result.headers }, { status: 429, text: text429, headers: limitHeaders });
        assert.deepEqual(result.calls, []);
        assert.deepEqual(limits, [[985, bucket]]);
      } else {
        assert.deepEqual(limits, []);
        assert.ok(!result.headers.some(([name]) => name === 'retry-after'));
        if (!Object.keys(options).length) assert.deepEqual(pageContract(result), pageBaseline[operation]);
      }
    }
  });
}

test('calendar/connections/custom-fields/CLI/raw-profile routes are not charged even with flag ON', async () => {
  for (const operation of Object.keys(operations).filter((op) => !Object.hasOwn(chat, op))) {
    const result = await run(operation, 'ON', { limited: true });
    assert.deepEqual(result.limits, []);
    assert.deepEqual(contract(result), baseline[operation]);
  }
});

test('existing chat transport rejects 429 rather than returning empty history or successful deletion', async () => {
  const error = Object.assign(new Error('Request failed with status code 429'), { response: { status: 429, data: JSON.parse(text429) } });
  const api = load('src/utils/api/ai_chat/aiChatHelpers.ts', {
    '@/utils/axiosClient': { default: { get: async () => { throw error; }, post: async () => { throw error; }, delete: async () => { throw error; } } },
    '@/lib/constants': { default: {} },
  });
  for (const action of [() => api.AI_Chat_API.getAllSessions(), () => api.AI_Chat_API.deleteSession('session-1'), () => api.AI_Chat_API.createSessionNext()]) {
    await assert.rejects(action, (value) => value === error);
  }
});

test('existing history hook keeps cache/transcript on 429, invalidates failed optimistic title/delete, and does not fabricate a session', async () => {
  let cache = { data: { success: true, sessions: [{ id: 'session-1', title: 'Chat', messages: [{ id: 'message-1', content: 'Saved' }] }] } };
  const snapshot = structuredClone(cache);
  const invalidations = [], states = [];
  let query;
  const failure = Object.assign(new Error('Rate limited'), { response: { status: 429 } });
  const queryClient = {
    getQueryData: () => cache,
    setQueryData: (key, updater) => { cache = typeof updater === 'function' ? updater(cache) : updater; },
    invalidateQueries: async (args) => { invalidations.push(args); },
  };
  const hooks = load('src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts', {
    '@/hooks/useFlag': { useFlag: () => false }, '@/store': { currentUserAtom: 'user', composeTaskChatIntroAtom: 'compose' },
    '@/lib/state': { useRecoilValue: () => ({ id: 985, uid: 'fixture-user' }), useRecoilState: () => [null, () => {}] },
    'next/navigation': { usePathname: () => '/project' },
    react: { useCallback: (fn) => fn, useEffect: () => {}, useRef: (current) => ({ current }), useState: (initial) => [initial, (value) => states.push(value)] },
    '@tanstack/react-query': { useQueryClient: () => queryClient, useQuery: (options) => { query = options; return { data: cache, isSuccess: true }; } },
    '@/utils/api/ai_chat': { AI_Chat_API: { getAllSessions: async () => { throw failure; }, createSessionNext: async () => { throw failure; }, deleteSession: async () => { throw failure; }, updateSession: async () => { throw failure; } } },
  });
  const history = hooks.useSessionAndChatHistory();
  const oldLog = console.log, oldError = console.error;
  console.log = console.error = () => {};
  try {
    await assert.rejects(query.queryFn, (error) => error === failure);
    assert.deepEqual(cache, snapshot, 'history failure must not replace cached transcript with an empty list');
    await history.deleteSession('session-1');
    assert.deepEqual(cache, snapshot, 'failed deletion must retain the only session');
    assert.equal(await history.startNewSession(), undefined);
    assert.deepEqual(cache, snapshot, 'failed creation must not fabricate history or selection');
    await history.updateSessionTitle('session-1', 'Draft title');
    assert.equal(cache.data.sessions[0].title, 'Draft title');
    assert.deepEqual(cache.data.sessions[0].messages, snapshot.data.sessions[0].messages);
    assert.deepEqual(invalidations, [{ queryKey: ['chat-sessions', 'fixture-user'] }, { queryKey: ['chat-sessions', 'fixture-user'] }]);
    assert.deepEqual(states, []);
  } finally { console.log = oldLog; console.error = oldError; }
});

test('real page autosave functions retain local draft and version after 429 and save successfully on retry', async () => {
  const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
  const source = fs.readFileSync(path.join(__dirname, '../src/app/page/[publicId]/PageEditor.tsx'), 'utf8');
  const ast = ts.createSourceFile('PageEditor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const wanted = new Set(['markPending', 'finishSave', 'patchPage', 'saveTitle', 'saveContent']);
  const declarations = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && wanted.has(node.name.getText(ast))) declarations.push(`const ${node.getText(ast)};`);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(declarations.length, wanted.size);
  const compiled = ts.transpileModule(declarations.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const state = { status: 'saved', version: 3, title: 'Unsaved title', content: '<p>Unsaved content</p>' };
  const generationRef = { current: { title: 0, content: 0 } }, pendingRef = { current: { title: false, content: false } }, versionRef = { current: 3 };
  const requests = [], notifications = [];
  let limited = true;
  const saves = new Function('page', 'pageRoute', 'fetch', 'toast', 'window', 'generationRef', 'pendingRef', 'versionRef', 'setSaveStatus', 'setVersion', `${compiled}return {markPending, saveTitle, saveContent};`)(
    { publicId: 'opaque-id' }, (id) => `/api/pages/${id}`,
    async (url, request) => { requests.push([url, JSON.parse(request.body)]); return new Response(limited ? text429 : '{"page":{"version":4}}', { status: limited ? 429 : 200 }); },
    { error: (message) => notifications.push(message) }, { location: { reload: () => assert.fail('429 must not reload or clear the draft') } },
    generationRef, pendingRef, versionRef, (status) => { state.status = status; }, (version) => { state.version = version; },
  );
  const oldError = console.error;
  console.error = () => {};
  try {
    saves.markPending('title');
    await saves.saveTitle(state.title, generationRef.current.title);
    assert.equal(state.status, 'error');
    saves.markPending('content');
    await saves.saveContent(state.content, generationRef.current.content);
    assert.deepEqual(state, { status: 'error', version: 3, title: 'Unsaved title', content: '<p>Unsaved content</p>' });
    assert.equal(versionRef.current, 3);
    assert.deepEqual(notifications, ['Could not save the page title', 'Could not save the page']);
    limited = false;
    saves.markPending('content');
    await saves.saveContent(state.content, generationRef.current.content);
    assert.equal(state.status, 'saved');
    assert.equal(state.version, 4);
    assert.equal(versionRef.current, 4);
    assert.deepEqual(requests.at(-1), ['/api/pages/opaque-id', { content: '<p>Unsaved content</p>', content_type: 'html', if_version: 3 }]);
  } finally { console.error = oldError; }
});
