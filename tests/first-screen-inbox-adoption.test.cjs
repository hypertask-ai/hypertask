const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require('tsx/cjs');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const { adoptInboxDocument, excludeInboxDocumentRestore } = require('../src/lib/firstScreen/inboxAdoption.ts');
const { currentInboxReadModelRevision, observeInboxReadModelRevision, compareInboxReadModelRevisions } = require('../src/lib/inboxSync/revision.ts');
const { updateInboxOptimistically } = require('../src/lib/inboxSync/optimistic.ts');
const root = path.resolve(__dirname, '..');
const now = '2026-10-05T00:00:00.000Z';
const rows = [{ id: 1, taskId: 1, userId: 985, projectId: 15, type: 'Comment', seen: false, status: 'Normal', createdAt: now,
  task: { id: 1, projectId: 15, title: 'Server row', status: 'Normal' }, project: { id: 15, title: 'Board', name: 'Board' } }];
const snapshot = { schemaVersion: 1, buildVersion: 'test', scope: { accountId: 985, route: '/inbox', generation: 'document-A' },
  authorization: { outcome: 'authorized', checkedAt: now }, fetchedAt: now, now,
  flags: { accountId: 985, evaluatedAt: now, values: { 'htpr-6934-server-first-screen': true } }, completeness: 'complete',
  selection: { split: 0 }, data: { user: { id: 985 }, payload: { accountId: 985, dataOrigin: 'network', notifications: rows,
    splitsNoImportant: [], showImportantSplit: false, structuredData: { tabs: [{ project: 'All', idx: 0, length: 1, hasUnseen: true }], data: [rows] } },
    drafts: [{ id: 1, userId: 985, content: 'Draft' }], counts: { all: 1, unseen: 1 } } };
const client = () => new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } });

test('document adopts complete live inbox/count/draft keys with server update time and no server logical revision', () => {
  const c = client(); try {
    adoptInboxDocument(c, snapshot);
    assert.equal(c.getQueryData(['inbox', 'data', 985]).notifications[0].task.title, 'Server row');
    assert.equal(c.getQueryData(['inbox', 'data', 985]).structuredData, snapshot.data.payload.structuredData);
    assert.equal(c.getQueryState(['inbox', 'data', 985]).dataUpdatedAt, Date.parse(now));
    assert.equal(c.getQueryData(['inbox', 'data', 985]).readModelRevision, undefined);
    assert.equal(c.getQueryData(['inbox', 'data', 985]).serverDocumentGeneration, snapshot.scope.generation);
    assert.equal(c.getQueryData(['inbox', 'data', 986]), undefined);
    assert.deepEqual(c.getQueryData(['inbox', 'count', 985]), { all: 1, unseen: 1 });
    assert.deepEqual(c.getQueryData(['drafts for user:', 985]), snapshot.data.drafts);
  } finally { c.clear(); }
});

test('browser adoption establishes a logical operation generation, subsequent archive fences it, and seed replay cannot resurrect', () => {
  const previous = global.window;
  const storage = new Map();
  global.window = { location: { search: '' }, localStorage: { get length() { return storage.size; }, key: i => [...storage.keys()][i],
    getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) } };
  const c = client(); try {
    adoptInboxDocument(c, snapshot);
    const seed = c.getQueryData(['inbox', 'data', 985]);
    assert.equal(seed.readModelRevision, currentInboxReadModelRevision(985));
    assert.notEqual(seed.readModelRevision, snapshot.fetchedAt);
    const later = `${String(Number(seed.readModelRevision.slice(0, 16)) + 1).padStart(16, '0')}:${'b'.repeat(32)}`;
    observeInboxReadModelRevision(985, later);
    assert.ok(compareInboxReadModelRevisions(currentInboxReadModelRevision(985), seed.readModelRevision) > 0);
    const updated = updateInboxOptimistically({ queryClient: c, queryKey: ['inbox', 'data', 985], accountId: 985,
      mutation: { type: 'remove', notificationIds: ['1'] } });
    assert.ok(updated); assert.equal(updated.notifications.length, 0);
    const revision = updated.readModelRevision;
    assert.ok(compareInboxReadModelRevisions(revision, seed.readModelRevision) > 0);
    adoptInboxDocument(c, snapshot);
    assert.equal(c.getQueryData(['inbox', 'data', 985]).notifications.length, 0);
    assert.equal(c.getQueryData(['inbox', 'data', 985]).readModelRevision, revision);
    assert.equal(snapshot.data.payload.readModelRevision, undefined, 'request data is not mutated');
  } finally { c.clear(); if (previous === undefined) delete global.window; else global.window = previous; }
});

test('future-dated persisted rows, drafts, identities and flags cannot replace a request snapshot; unrelated keys remain', () => {
  const keys = [['inbox', 'data', 985], ['inbox', 'count', 985], ['drafts for user:', 985], ['feature-flags', 985],
    ['fetchUser', 985], ['user-preferences'], ['boardTasks', 985, 15], ['unrelated', 985]];
  const persisted = { timestamp: Date.parse('2099-01-01'), clientState: { mutations: [], queries: keys.map(queryKey => ({ queryKey, state: { dataUpdatedAt: Date.parse('2099-01-01') } })) } };
  const restored = excludeInboxDocumentRestore(persisted, snapshot);
  assert.deepEqual(restored.clientState.queries.map(q => q.queryKey), keys.slice(-2));
  assert.equal(persisted.clientState.queries.length, keys.length, 'restoration input is untouched');
});

const mock = (name, exports) => { const id = name.startsWith('src/') ? path.join(root, name) : require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports }; };
let activeSnapshot = snapshot;
mock('next/navigation', { useSearchParams: () => new URLSearchParams() });
mock('src/hooks/General/useHydrated.ts', { useHydrated: () => false });
mock('src/lib/firstScreen/SurfaceContext.tsx', { useFirstScreenSurface: () => activeSnapshot });
const { useGetNotifications } = require('../src/hooks/Inbox/useGetNotifications.ts');
function ReadInbox() {
  const q = useGetNotifications(985);
  return React.createElement('output', null, q.data.notifications.map(row => row.task.title).join('|'));
}
test('the normal query key supplies the very first SSR render despite the legacy hydrating guard', () => {
  const c = client(); try {
    adoptInboxDocument(c, snapshot); activeSnapshot = snapshot;
    assert.equal(renderToString(React.createElement(QueryClientProvider, { client: c }, React.createElement(ReadInbox))), '<output>Server row</output>');
    activeSnapshot = null;
    assert.equal(renderToString(React.createElement(QueryClientProvider, { client: c }, React.createElement(ReadInbox))), '<output></output>', 'unseeded old path stays isolated');
  } finally { c.clear(); }
});

test('late account resolution enables document access filtering and keeps it after reconciliation without leaking across accounts', () => {
  const source = fs.readFileSync(path.join(root, 'src/hooks/Inbox/useGetNotifications.ts'), 'utf8');
  const start = source.indexOf('  const documentAccessRef =');
  const end = source.indexOf('\n  const queryClient =', start);
  assert.ok(start > 0 && end > start);
  const read = new Function('userId', 'document', 'useRef', source.slice(start, end) + '\nreturn requireProjectAccess;');
  const ref = { current: { accountId: 0, required: false } };
  assert.equal(read(0, null, () => ref), false);
  assert.equal(read(985, snapshot, () => ref), true);
  assert.equal(read(985, null, () => ref), true);
  assert.equal(read(986, null, () => ref), false);
});

function realtimeEffect(seed, fakeClient, queryClient) {
  const source = fs.readFileSync(path.join(root, 'src/hooks/realtime/useInboxRealtime.ts'), 'utf8');
  const start = source.indexOf('  useEffect(() => {'); const end = source.lastIndexOf('\n}');
  const effects = []; const timers = new Map(); let id = 0;
  const bindings = { userId: 985, seeded: seed, queryClient, wasConnected: { current: false },
    connectRealtimeClient: async () => fakeClient, releaseRealtimeClientIfIdle: () => {},
    userChannel: value => `private-user-${value}`, INBOX_EVENT: 'inbox-event', createInboxRealtimeEventHandler: callback => () => callback('event'),
    runRealtimeReconciliation: async ({ reconcile }) => reconcile(),
    setTimeout: (fn, delay) => { assert.equal(delay, 1500); timers.set(++id, fn); return id; }, clearTimeout: value => timers.delete(value) };
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('useEffect', ...Object.keys(bindings), js)(fn => effects.push(fn), ...Object.values(bindings));
  return { cleanup: effects[0](), timers };
}
test('subscription acknowledgment catches up once through the live query; the fallback does not duplicate it and OFF retains the old graph', async () => {
  const bindings = new Map(), calls = [];
  const channel = { subscribed: false, bind: (event, callback) => bindings.set(event, callback), unbind: event => bindings.delete(event) };
  const fake = { subscribe: () => channel, unsubscribe: () => {}, connection: { state: 'connected', bind: () => {}, unbind: () => {} } };
  const q = { refetchQueries: async options => calls.push(options) };
  const seeded = realtimeEffect(true, fake, q);
  await new Promise(resolve => setImmediate(resolve));
  bindings.get('pusher:subscription_succeeded')(); bindings.get('pusher:subscription_succeeded')();
  for (const callback of seeded.timers.values()) callback();
  assert.deepEqual(calls, [{ queryKey: ['inbox', 'data', 985], exact: true }]); seeded.cleanup();
  const old = realtimeEffect(false, fake, q); await new Promise(resolve => setImmediate(resolve));
  bindings.get('pusher:subscription_succeeded')(); assert.equal(calls.length, 1); assert.equal(old.timers.size, 0); old.cleanup();
});

test('document first render initializes visible arrays/selection, retains node keys and does not persist the seed or startup-scroll', () => {
  const inbox = fs.readFileSync(path.join(root, 'src/app/inbox/Inbox.tsx'), 'utf8');
  assert.match(inbox, /useState<INotification\[\]\[\] \| undefined>\(\(\) => inboxDocument\?\.data\.payload\.structuredData\.data\)/);
  assert.match(inbox, /initialDocumentRows.current === _notificationsTQ\?\.structuredData\?\.data && inboxDocument\) return/);
  assert.match(inbox, /key=\{`split-\$\{globalFocus.currSplit\}`\}/);
  const adoption = fs.readFileSync(path.join(root, 'src/lib/firstScreen/inboxAdoption.ts'), 'utf8');
  assert.doesNotMatch(adoption, /import\([^)]*indexedDb|writeInboxReadModel|persistInboxPayload/);
  const hook = fs.readFileSync(path.join(root, 'src/hooks/Inbox/useGetNotifications.ts'), 'utf8');
  assert.match(hook, /if \(hydrated \|\| document\) return/);
  assert.match(hook, /Ignored Inbox response after final revision check/);
});
