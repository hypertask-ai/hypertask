const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
require('tsx/cjs');
const navigationId = require.resolve('next/navigation');
require.cache[navigationId] = { id: navigationId, filename: navigationId, loaded: true,
  exports: { usePathname: () => '/project', useSearchParams: () => new URLSearchParams('id=15'), useRouter: () => ({ replace() {} }) } };
const { QueryClient } = require('@tanstack/react-query');
const { adoptBoardDocument, excludeBoardDocumentRestore } = require('../src/lib/firstScreen/boardAdoption.ts');
const { getBoardDocument, mergeBoardDocumentProjects } = require('../src/lib/firstScreen/boardDocument.ts');
const root = path.resolve(__dirname, '..');
const source = p => fs.readFileSync(path.join(root, p), 'utf8');
const project = { id: 15, title: 'Document board', tasks: [{ id: 1, title: 'Fresh task' }], section: [], sections: [] };
const snapshot = { schemaVersion: 1, scope: { accountId: 985, route: '/project', generation: 'request-A' },
  authorization: { outcome: 'authorized' }, fetchedAt: '2026-10-04T12:00:00.000Z', completeness: 'complete', flags: { accountId: 985, values: { 'htpr-6934-server-first-screen': true } },
  data: { projectId: 15, user: { id: 985 }, payload: { project, tasks: project.tasks, allViews: [] },
    projects: { accountId: 985, dataOrigin: 'network', projectsCompleteness: 'active-board-only', serverDocumentGeneration: 'request-A',
      updatedProjects: [project], notificationsCount: { all: 3, unseen: 1 } } } };

function client() { return new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } }); }

test('document seeds normal live boardTasks and projectsAll before the first renderer, with real updatedAt', () => {
  const cache = client();
  adoptBoardDocument(cache, snapshot);
  assert.deepEqual(cache.getQueryData(['boardTasks', 985, 15]), snapshot.data.payload);
  assert.deepEqual(cache.getQueryData(['projectsAll']), snapshot.data.projects);
  assert.deepEqual(cache.getQueryData(['inbox', 'count', 985]), { all: 3, unseen: 1 });
  assert.equal(cache.getQueryState(['boardTasks', 985, 15]).dataUpdatedAt, Date.parse(snapshot.fetchedAt));
  assert.equal(cache.getQueryState(['projectsAll']).dataUpdatedAt, Date.parse(snapshot.fetchedAt));
  assert.equal(cache.getQueryData(['projectsAll', 'hydrating']), undefined);
  cache.clear();
});

test('active-board-only merge preserves other same-account metadata without claiming absence is revocation', () => {
  const other = { id: 16, title: 'Other authorized board' };
  const current = { accountId: 985, projectsCompleteness: 'all-authorized', updatedProjects: [{ id: 15, title: 'Old active board' }, other], notificationsCount: { all: 0, unseen: 0 } };
  const result = mergeBoardDocumentProjects(current, snapshot.data.projects);
  assert.deepEqual(result.updatedProjects.map(p => p.id), [15, 16]);
  assert.equal(result.updatedProjects[1], other);
  assert.equal(result.projectsCompleteness, 'all-authorized');
  assert.equal(mergeBoardDocumentProjects({ ...current, projectsCompleteness: 'active-board-only' }, snapshot.data.projects).projectsCompleteness, 'active-board-only');
  assert.equal(mergeBoardDocumentProjects({ ...current, accountId: 6 }, snapshot.data.projects), snapshot.data.projects);
});

test('restoration excludes route keys even when the persisted snapshot claims a future wall-clock timestamp', () => {
  const keys = [['projectsAll'], ['boardTasks', 985, 15], ['boardTasks', 985, 16], ['feature-flags', 985], ['fetchUser', 985], ['inbox', 'count', 985], ['other']];
  const stored = { timestamp: Date.parse(snapshot.fetchedAt) + 999999, buster: 'test', clientState: {
    mutations: [], queries: keys.map(queryKey => ({ queryKey, queryHash: JSON.stringify(queryKey), state: { dataUpdatedAt: Number.MAX_SAFE_INTEGER } })) } };
  const restored = excludeBoardDocumentRestore(stored, snapshot);
  assert.deepEqual(restored.clientState.queries.map(q => q.queryKey), [['boardTasks', 985, 16], ['other']]);
  assert.equal(stored.clientState.queries.length, keys.length);
  assert.equal(excludeBoardDocumentRestore(undefined, snapshot), undefined);
});

test('a later edit uses the same query client and the old document is not replayed by route rendering', () => {
  const cache = client(); adoptBoardDocument(cache, snapshot);
  cache.setQueryData(['boardTasks', 985, 15], { ...snapshot.data.payload, tasks: [{ id: 1, title: 'Live edit' }] });
  assert.equal(cache.getQueryData(['boardTasks', 985, 15]).tasks[0].title, 'Live edit');
  assert.equal(getBoardDocument(snapshot, 985, 15), snapshot);
  for (const [accountId, projectId] of [[6, 15], [985, 16], [985, null]]) assert.equal(getBoardDocument(snapshot, accountId, projectId), null);
  assert.equal(getBoardDocument({ ...snapshot, completeness: 'display-only' }, 985, 15), null);
  assert.equal(getBoardDocument({ ...snapshot, flags: { values: {} } }, 985, 15), null);
  const providers = source('src/utils/Providers.tsx');
  assert.match(providers, /useState\(\(\) => getBoardDocument/);
  assert.match(providers, /initialValues=\{initialValues\}/);
  assert.match(providers, /initialFlags=\{snapshot\?\.flags\}/);
  assert.equal((providers.match(/<StateRoot\b/g) || []).length, 1);
  cache.clear();
});

test('a matching document bypasses the hydrating keys; unseeded paths retain their existing guards', () => {
  const hooks = source('src/hooks/Homepage/useGetBoards.ts');
  assert.match(hooks, /hydrated \|\| document/);
  assert.match(hooks, /projectAuthorizationScopeRef.*useRef/s);
  assert.match(hooks, /useRef<[\s\S]*document \? \{ scopeKey:/);
  assert.match(hooks, /if \(document && projectAuthorizationScopeRef.current\?\.scopeKey === currentScopeKey\)/);
  assert.match(hooks, /PROJECTS_ALL_HYDRATING_QUERY_KEY/);
  const landing = source('src/app/[...boardURL]/LandingPage.tsx');
  assert.match(landing, /status: document \? "authorized" : "pending"/);
  assert.match(landing, /requestId: document\?\.scope.generation \?\? null/);
});

test('local snapshot publication is fenced by the server document and existing route/revocation guards remain', () => {
  const publication = source('src/hooks/Homepage/useSyncedBoardReadModel.ts');
  assert.match(publication, /currentCache\?\.serverDocumentGeneration/);
  assert.match(publication, /isBoardRevocationTombstoned\(currentScope.accountId, proof.projectId\)/);
  assert.match(publication, /didNetworkResultPublishAfterAuthorization/);
  assert.match(publication, /currentScope.activeKey !== authorizedKey/);
});

test('parser-time board requests are omitted only after a successful matching document; unrelated shell bootstrap stays', () => {
  const page = source('src/app/[...boardURL]/page.tsx');
  const fast = page.slice(page.indexOf('const firstScreen ='), page.indexOf('let userObjString'));
  assert.match(fast, /if \(firstScreen\)/);
  assert.match(fast, /return <LandingPage/);
  assert.equal(fast.includes('buildEarlyBoardBootstrapScript'), false);
  assert.match(page, /buildEarlyBoardBootstrapScript\(\{/);
  assert.match(source('src/app/layout.tsx'), /buildEarlyAppShellBootstrapScript\(\{/);
});

test('subscription acknowledgment catches up the document in place and reconnect retains account-wide authorization', () => {
  const realtime = source('src/hooks/realtime/useBoardRealtime.ts');
  assert.match(realtime, /pusher:subscription_succeeded/);
  assert.match(realtime, /seeded && options\?\.accountId !== undefined[\s\S]*reconcileActiveBoardTasks\(queryClient, projectId, options.accountId, \{ background: true \}\)/);
  assert.match(realtime, /refetch\("reconnect"\)/);
  assert.match(realtime, /initialCatchUpComplete = true/);
});

test('the real board query hydrates the same DOM node from normal live keys, then adopts an in-place edit', async () => {
  const React = require('react');
  const { renderToString } = require('react-dom/server');
  const { hydrateRoot } = require('react-dom/client');
  const { JSDOM } = require('jsdom');
  const { QueryClientProvider, notifyManager } = require('@tanstack/react-query');
  const { FirstScreenSurfaceProvider } = require('../src/lib/firstScreen/SurfaceContext.tsx');
  const { useGetAllBoards } = require('../src/hooks/Homepage/useGetBoards.ts');
  const { useGetNotificationCount } = require('../src/hooks/Inbox/useGetNotifications.ts');
  const seed = { ...snapshot, display: { version: 1, accountId: 985, timeZone: 'UTC', locale: 'en-US', boardLayout: 'board',
    theme: 'porcelain', railCollapsed: true, quickTips: true, draftsFirst: false },
    authorization: { outcome: 'authorized' }, now: snapshot.fetchedAt };
  notifyManager.setScheduler(queueMicrotask);
  const cache = client(); adoptBoardDocument(cache, seed);
  function Board() {
    const query = useGetAllBoards({ id: 985 }, '15', { enabled: false });
    const counts = useGetNotificationCount(985, { enabled: false });
    assert.deepEqual(counts.data, { all: 3, unseen: 1 });
    return React.createElement('a', { href: '/detail/project-15/1' }, query.data?.updatedProjects[0].tasks[0].title ?? 'EMPTY');
  }
  const BoardDocumentBoundary = require('../src/lib/firstScreen/BoardDocumentBoundary.tsx').default;
  const tree = React.createElement(FirstScreenSurfaceProvider, { snapshot: seed },
    React.createElement(QueryClientProvider, { client: cache },
      React.createElement(BoardDocumentBoundary, { fallback: 'OLD LOADER' }, React.createElement(Board))));
  const html = renderToString(tree);
  assert.equal(html, '<a href="/detail/project-15/1">Fresh task</a>');
  const dom = new JSDOM(`<div id="root">${html}</div>`, { url: 'https://example.invalid/project?id=15' });
  const previous = { window: global.window, document: global.document, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const node = document.querySelector('a'), errors = [];
  let instance;
  try {
    await React.act(async () => { instance = hydrateRoot(document.getElementById('root'), tree, { onRecoverableError: e => errors.push(e.message) }); });
    assert.deepEqual(errors, []);
    assert.equal(document.querySelector('a'), node);
    assert.equal(document.getElementById('root').innerHTML, html);
    await React.act(async () => {
      cache.setQueryData(['projectsAll'], { ...seed.data.projects, updatedProjects: [{ ...project, tasks: [{ id: 1, title: 'Live edit' }] }] });
      await new Promise(resolve => setImmediate(resolve));
    });
    assert.equal(document.querySelector('a'), node);
    assert.equal(node.textContent, 'Live edit');
  } finally {
    if (instance) await React.act(async () => instance.unmount());
    cache.clear(); dom.window.close();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
  }
});

test('delayed document metadata preserves a newer scoped catch-up without resurrecting a revoked board', async () => {
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { JSDOM } = require('jsdom');
  const { QueryClientProvider } = require('@tanstack/react-query');
  const { FirstScreenSurfaceProvider } = require('../src/lib/firstScreen/SurfaceContext.tsx');
  const { useGetAllBoards } = require('../src/hooks/Homepage/useGetBoards.ts');
  const { patchProjectIntoCache } = require('../src/utils/api/Homepage/index.ts');
  const axios = require('axios').default;
  const originalPost = axios.post;
  const seed = { ...snapshot, fetchedAt: new Date().toISOString(), now: new Date().toISOString(),
    display: { version: 1, accountId: 985, timeZone: 'UTC', locale: 'en-US', boardLayout: 'board',
      theme: 'porcelain', railCollapsed: true, quickTips: true, draftsFirst: false } };
  try {
    for (const revoked of [false, true]) {
      const cache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
      adoptBoardDocument(cache, seed);
      const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.invalid/project?id=15' });
      const previous = { window: global.window, document: global.document, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
      Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
      let releaseMetadata, metadataStarted, query, pending;
      const started = new Promise(resolve => { metadataStarted = resolve; });
      axios.post = async url => {
        assert.equal(url, '/api/projects/getAll'); metadataStarted();
        return new Promise(resolve => { releaseMetadata = () => resolve({ data: revoked ? [] : [project] }); });
      };
      function Board() { query = useGetAllBoards({ id: 985 }, '15', { enabled: false }); return null; }
      const instance = createRoot(document.getElementById('root'));
      try {
        await React.act(async () => instance.render(React.createElement(FirstScreenSurfaceProvider, { snapshot: seed },
          React.createElement(QueryClientProvider, { client: cache }, React.createElement(Board)))));
        await React.act(async () => { pending = query.refetch(); await started; });
        const newer = { ...seed.data.payload, tasks: [{ id: 1, title: 'Edit between document and subscription' }] };
        await React.act(async () => {
          cache.setQueryData(['boardTasks', 985, 15], newer);
          patchProjectIntoCache(cache, 15, newer, 985);
          releaseMetadata(); await pending;
        });
        const result = cache.getQueryData(['projectsAll']);
        assert.equal(result.projectsCompleteness, 'all-authorized');
        assert.deepEqual(result.updatedProjects.map(p => p.id), revoked ? [] : [15]);
        if (!revoked) assert.equal(result.updatedProjects[0].tasks[0].title, newer.tasks[0].title);
      } finally {
        releaseMetadata?.();
        await React.act(async () => instance.unmount()); cache.clear(); dom.window.close();
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
      }
    }
  } finally { axios.post = originalPost; }
});

test('document critical references do not stream real cards into JavaScript-only hidden segments', async () => {
  const React = require('react');
  const { renderToPipeableStream } = require('react-dom/server');
  const { PassThrough } = require('node:stream');
  const { FirstScreenSurfaceProvider } = require('../src/lib/firstScreen/SurfaceContext.tsx');
  const BoardDocumentBoundary = require('../src/lib/firstScreen/BoardDocumentBoundary.tsx').default;
  const documentSeed = { ...snapshot, display: { version: 1, accountId: 985, timeZone: 'UTC', locale: 'en-US', boardLayout: 'board',
    theme: 'porcelain', railCollapsed: true, quickTips: true, draftsFirst: false } };
  async function render(seeded) {
    let resolve, rendered, shellReady;
    const deferred = new Promise(r => { resolve = r; });
    const started = new Promise(r => { rendered = r; });
    const shell = new Promise(r => { shellReady = r; });
    const Card = React.lazy(() => { rendered(); return deferred; });
    const output = new PassThrough();
    let html = '';
    output.on('data', chunk => { html += chunk; });
    const complete = new Promise((done, reject) => { output.on('end', done); output.on('error', reject); });
    const stream = renderToPipeableStream(React.createElement('main', null,
      React.createElement(FirstScreenSurfaceProvider, { snapshot: seeded ? documentSeed : null },
        React.createElement(BoardDocumentBoundary, { fallback: 'old fallback' }, React.createElement(Card)))), {
      bootstrapScripts: ['/document-client.js'],
      onShellReady() { stream.pipe(output); shellReady(); }, onError(error) { output.destroy(error); },
    });
    await started;
    if (!seeded) await shell;
    resolve({ default: () => React.createElement('a', { href: '/detail/project-15/1' }, 'Real card') });
    await complete;
    return html;
  }
  const old = await render(false), document = await render(true);
  assert.ok(old.includes('old fallback') && old.includes('hidden'));
  assert.ok(document.includes('<main><a href="/detail/project-15/1">Real card</a></main>'));
  assert.ok(!document.includes('hidden') && !document.includes('old fallback'));
});

test('a delayed IndexedDB publication cannot overwrite the adopted server document', async () => {
  const { publishPreparedLocalBoard } = require('../src/hooks/Homepage/useSyncedBoardReadModel.ts');
  const cache = client(); adoptBoardDocument(cache, snapshot);
  const before = cache.getQueryData(['projectsAll']);
  let claim = false;
  const result = await publishPreparedLocalBoard({
    proof: { accountId: 985, projectId: 15, authorizedProjectIds: [15], generation: 0, requestId: 'request-A',
      queryUpdateCountAtAuthorization: cache.getQueryState(['projectsAll']).dataUpdateCount, isCurrent: () => true },
    prepareLocalRead: async () => ({ project, tasks: [{ id: 1, title: 'Old local task' }], allViews: [] }),
    getCurrentScope: () => ({ activeKey: '985:15', accountId: 985, projectId: 15, enabled: true }),
    queryClient: cache, claimPublication: () => { claim = true; return true; },
  });
  assert.equal(result, false); assert.equal(claim, false);
  assert.equal(cache.getQueryData(['projectsAll']), before);
  cache.clear();
});


test('the document retains the old lazy import graph and LandingPage client identity', () => {
  const page = source('src/app/[...boardURL]/page.tsx');
  assert.match(page, /if \(firstScreen\) \{\s*return <LandingPage/);
  const shared = source('src/app/[...boardURL]/LandingPageShared.ts');
  assert.match(shared, /export const TableView = lazy/);
  assert.match(source('src/components/Global/FirstScreenMobileChrome.tsx'), /const MobileTopBar = dynamic/);
  assert.match(source('src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx'), /const SeededTask = dynamic/);
  const boundary = source('src/lib/firstScreen/BoardDocumentBoundary.tsx');
  assert.match(boundary, /useState\(\(\) => !hydrated/);
});
