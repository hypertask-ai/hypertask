const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/loadModule.cjs');

const FLAG_KEY = 'htpr-9017-smart-page-search';

const pageRow = (overrides) => ({
  id: 1, publicId: 'page-public-1', title: 'Indexed title', contentText: 'Indexed text',
  projectId: 15, task: { id: 500 }, parentPageId: null, updatedAt: new Date('2026-11-10T00:00:00.000Z'), ...overrides,
});

function loadPageService({ indexRows = [], findMany } = {}) {
  const calls = { index: [], findMany: [] };
  const service = loadModule('src/utils/controllers/pages/pageService.ts', {
    '@/lib/prisma': { default: { page: { findMany: async (args) => {
      calls.findMany.push(args);
      return findMany ? findMany(args, calls.findMany.length) : [];
    } } } },
    '@/utils/controllers/projects/getAllIncludes': {
      getProjectWhere: (userId, agentId) => ({ OR: [{ ownerId: userId }, { members: { some: { userId } } }], agentId }),
    },
    '@/utils/controllers/turbopuffer/pageSearch': {
      searchPagesInTurbopuffer: async (args) => {
        calls.index.push(args);
        assert.equal(args.userId, 985);
        return indexRows;
      },
    },
    '@/utils/controllers/turbopuffer/turbopufferHelper': {
      convertToPlain: (value) => value, deletePageFromTurbopuffer: async () => {}, upsertPageToTurbopuffer: async () => {},
    },
    '@/utils/helperFunctions/markdownToHtml': { markdownToHtml: (value) => value },
    '@/utils/helperFunctions/sanitizeRichHtml': { sanitizeRichHtml: (value) => value },
  });
  return { service, calls };
}

function loadPageSearch({ query, keywordOnly = false, flagOn = true } = {}) {
  const queries = [];
  const flags = [];
  const pageSearch = loadModule('src/utils/controllers/turbopuffer/pageSearch.ts', {
    '@/lib/flags': { isFeatureEnabled: async (key, userId) => {
      flags.push({ key, userId });
      return flagOn;
    } },
    '@/lib/turbopuffer': {
      default: { namespace: (name) => ({ query: async (request) => {
        queries.push({ name, request });
        return query(request, queries.length);
      } }) },
      turbopufferNamespaces: { page: { name: 'pages' } },
    },
    '@/utils/controllers/turbopuffer/turbopufferHelper': {
      embedQueryForSearch: async () => (keywordOnly ? null : Array.from({ length: 8 }, () => 0.1)),
      buildProjectFilter: (projectIds) => (projectIds.length === 1 ? ['projectId', 'Eq', projectIds[0]] : projectIds.length ? ['projectId', 'In', projectIds] : null),
      getMultiQueryRows: (response) => response.results?.[0]?.rows ?? [],
    },
  });
  return { pageSearch, queries, flags };
}

const args = { query: 'quarterly planning notes', projectIds: [15], userId: 985, standalonePagesEnabled: true };
const rowsFor = (byRanked) => (call) => (call.where.id ? byRanked.ranked : byRanked.literal);

test('no viewer keeps the literal database match and never reads the page index', async () => {
  const { service, calls } = loadPageService({ findMany: () => [pageRow({ id: 3 })] });
  const pages = await service.searchPages({ ...args, userId: undefined });
  assert.deepEqual(calls.index, []);
  assert.equal(calls.findMany.length, 1);
  assert.equal(calls.findMany[0].where.OR[0].title.contains, args.query);
  assert.equal(calls.findMany[0].orderBy.updatedAt, 'desc');
  assert.deepEqual(pages.map((page) => page.id), [3]);
});

test('the flag off means the reader never asks the index', async () => {
  const { pageSearch, queries, flags } = loadPageSearch({ flagOn: false, query: () => ({ rows: [] }) });
  assert.deepEqual(await pageSearch.searchPagesInTurbopuffer({ searchQuery: 'planning notes', projectIds: [15], userId: 985 }), []);
  assert.deepEqual(flags, [{ key: FLAG_KEY, userId: 985 }]);
  assert.equal(queries.length, 0);
});

test('index hits are rehydrated in index order from current rows, keeping every access filter', async () => {
  const { service, calls } = loadPageService({
    indexRows: [{ id: '31' }, { id: '17' }, { id: 'nope' }, { id: '31' }],
    findMany: rowsFor({ literal: [], ranked: [pageRow({ id: 17, contentText: 'Current text' }), pageRow({ id: 31 })] }),
  });
  const pages = await service.searchPages({ ...args, agentId: 'agent-7', teamScope: { teamId: 'team-1' } });
  assert.deepEqual(calls.index, [{ searchQuery: args.query, projectIds: [15], userId: 985 }]);
  assert.deepEqual(calls.findMany.map((call) => Boolean(call.where.id)), [false, true]);
  assert.deepEqual(calls.findMany[1].where.id, { in: [31, 17] });
  assert.deepEqual(pages.map((page) => page.id), [31, 17]);
  assert.deepEqual(pages.map((page) => page.contentText), ['Indexed text', 'Current text']);
  assert.equal(pages[0].taskId, 500);
  const where = calls.findMany[1].where;
  assert.equal(where.archived, false);
  assert.deepEqual(where.projectId, { in: [15] });
  assert.equal(where.project.status, 'Normal');
  assert.ok(where.project.OR, 'board access is rechecked on the current row');
  assert.equal(where.OR, undefined, 'index hits never fall back to an unfiltered read');
  assert.equal(calls.findMany[1].select.task.where.status.not, 'Deleted');
});

test('a literal match that has not reached the index is still returned, last first and deduped', async () => {
  const { service } = loadPageService({
    indexRows: [{ id: '31' }, { id: '17' }],
    findMany: rowsFor({ ranked: [pageRow({ id: 31 }), pageRow({ id: 17 })], literal: [pageRow({ id: 12 }), pageRow({ id: 17 })] }),
  });
  assert.deepEqual((await service.searchPages(args)).map((page) => page.id), [12, 17, 31]);
});

test('standalone pages stay excluded when the standalone switch is off', async () => {
  const { service, calls } = loadPageService({ indexRows: [{ id: '5' }], findMany: () => [pageRow({ id: 5 })] });
  await service.searchPages({ ...args, standalonePagesEnabled: false });
  assert.deepEqual(calls.findMany[0].where.taskId, { not: null });
});

test('an empty index answer or fully filtered hits fall back to todays literal page search', async () => {
  const empty = loadPageService({ indexRows: [], findMany: () => [pageRow({ id: 44 })] });
  assert.deepEqual((await empty.service.searchPages(args)).map((page) => page.id), [44]);
  assert.equal(empty.calls.findMany.length, 1);
  assert.equal(empty.calls.findMany[0].where.OR[1].contentText.contains, args.query);

  const filtered = loadPageService({ indexRows: [{ id: '404' }], findMany: rowsFor({ literal: [pageRow({ id: 12 })], ranked: [] }) });
  assert.deepEqual((await filtered.service.searchPages(args)).map((page) => page.id), [12]);
  assert.deepEqual(filtered.calls.findMany.map((call) => Boolean(call.where.id)), [false, true]);
});

test('page search asks the index for the mixed ticket search shape, bounded to 50', async () => {
  const { pageSearch, queries, flags } = loadPageSearch({ query: () => ({ results: [{ rows: [{ id: 4, title: 'A' }, { id: 5, title: 'B' }] }] }) });
  const rows = await pageSearch.searchPagesInTurbopuffer({ searchQuery: '  planning notes  ', projectIds: [15], userId: 985 });
  assert.deepEqual(flags, [{ key: FLAG_KEY, userId: 985 }]);
  const request = queries[0].request;
  assert.equal(queries[0].name, 'pages');
  assert.equal(request.rerank_by[0], 'RRF');
  assert.deepEqual(request.queries.map((query) => query.top_k), [50, 50]);
  assert.equal(request.queries[0].rank_by[1], 'ANN');
  assert.deepEqual(request.queries[1].rank_by[1][0], ['Product', [4, ['title', 'BM25', 'planning notes', { last_as_prefix: true }]]]);
  assert.deepEqual(request.queries[0].filters, ['projectId', 'Eq', 15]);
  assert.deepEqual(rows.map((row) => row.id), ['4', '5']);
});

test('page search falls back to index keyword ranking, then to nothing, and never asks for no board', async () => {
  const failing = loadPageSearch({ query: (request, call) => {
    if (call === 1) throw new Error('vector namespace unavailable');
    assert.equal(request.rank_by[0], 'Sum');
    assert.deepEqual(request.filters, ['projectId', 'In', [15, 16]]);
    return { rows: [{ id: 8 }] };
  } });
  assert.deepEqual((await failing.pageSearch.searchPagesInTurbopuffer({ searchQuery: 'budget review', projectIds: [15, 16], userId: 985 })).map((row) => row.id), ['8']);
  assert.equal(failing.queries.length, 2);

  const keyword = loadPageSearch({ keywordOnly: true, query: () => ({ rows: [] }) });
  await keyword.pageSearch.searchPagesInTurbopuffer({ searchQuery: 'anything', projectIds: [15], userId: 985 });
  assert.equal(keyword.queries.length, 1);
  assert.equal(keyword.queries[0].request.top_k, 50);

  const noBoard = loadPageSearch({ query: () => ({ rows: [] }) });
  assert.deepEqual(await noBoard.pageSearch.searchPagesInTurbopuffer({ searchQuery: 'anything', projectIds: [], userId: 985 }), []);
  assert.deepEqual(await noBoard.pageSearch.searchPagesInTurbopuffer({ searchQuery: '   ', projectIds: [15], userId: 985 }), []);
  assert.equal(noBoard.queries.length, 0);
});
