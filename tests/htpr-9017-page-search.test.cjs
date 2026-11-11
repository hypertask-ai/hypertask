const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');

function reader({ vector = true, failHybrid = false, failAll = false } = {}) {
  const queries = [];
  const embeddingProjects = [];
  const rows = [{ id: '12', title: 'Holiday policy', contentText: 'Annual leave allowance', projectId: 15 }];
  const helper = load('src/utils/controllers/turbopuffer/turbopufferHelper.ts', {
    '@/lib/prisma': { default: {} },
    '@/app/api/ai/_lib/aiUsage': { logAiUsage: async () => {} },
    '@/lib/ai/spend/embeddingRoute': {
      embeddingSpendMode: async (ids) => { embeddingProjects.push(ids); return { mode: vector ? 'current' : 'keyword' }; },
    },
    '@/lib/turbopuffer': {
      turbopufferNamespaces: { page: { name: 'pages' } },
      default: { namespace: (name) => {
        assert.equal(name, 'pages');
        return { query: async (query) => {
          queries.push(query);
          if (failAll || (failHybrid && query.queries)) throw new Error('index unavailable');
          return query.queries ? { results: [{ rows }] } : { rows };
        } };
      } },
    },
    '@/app/api/ai/_lib/boardMemoryContract': {},
  });
  return { helper, rows, queries, embeddingProjects };
}

test('page reader uses scoped ANN plus weighted BM25 and RRF', async () => {
  const oldFetch = global.fetch;
  const oldKey = process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
  process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = 'fixture-only';
  global.fetch = async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: Array(1536).fill(0.1) }] }));
  try {
    const h = reader();
    assert.deepEqual(await h.helper.searchPagesInTurbopuffer({ searchQuery: ' time off rules ', projectIds: [15] }), h.rows);
    assert.deepEqual(h.embeddingProjects, [[15]]);
    const query = h.queries[0];
    assert.deepEqual(query.rerank_by, ['RRF']);
    assert.equal(query.queries[0].rank_by[1], 'ANN');
    assert.equal(query.queries[1].rank_by[0], 'Sum');
    for (const subquery of query.queries) {
      assert.deepEqual(subquery.filters, ['projectId', 'Eq', 15]);
      assert.equal(subquery.top_k, 50);
    }
    const fallback = reader({ failHybrid: true });
    assert.deepEqual(await fallback.helper.searchPagesInTurbopuffer({ searchQuery: 'holiday policy', projectIds: [15] }), fallback.rows);
    assert.equal(fallback.queries.length, 2);
    assert.equal(fallback.queries[1].rank_by[0], 'Sum');
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
    else process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = oldKey;
  }
});

test('keyword-only spend route and unavailable index do not require embeddings', async () => {
  const h = reader({ vector: false });
  assert.deepEqual(await h.helper.searchPagesInTurbopuffer({ searchQuery: 'policy', projectIds: [15] }), h.rows);
  assert.equal(h.queries[0].rank_by[0], 'Sum');
  const broken = reader({ vector: false, failAll: true });
  assert.deepEqual(await broken.helper.searchPagesInTurbopuffer({ searchQuery: 'policy', projectIds: [15] }), []);
  assert.deepEqual(await h.helper.searchPagesInTurbopuffer({ searchQuery: ' ', projectIds: [15] }), []);
  assert.deepEqual(await h.helper.searchPagesInTurbopuffer({ searchQuery: 'policy', projectIds: [] }), []);
  assert.equal(h.queries.length, 1);
});

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(part => matches(row, part));
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      if ('contains' in value) return row[key].toLowerCase().includes(value.contains.toLowerCase());
      return row[key] != null && matches(row[key], value);
    }
    return row[key] === value;
  });
}

function service(indexRows) {
  const rows = [
    { id: 11, title: 'Expenses', contentText: 'Receipts for business travel', projectId: 15 },
    { id: 12, title: 'Holiday policy', contentText: 'Annual leave allowance', projectId: 15 },
    { id: 13, title: 'Private', contentText: 'Secret', projectId: 16 },
    { id: 14, title: 'Old policy', archived: true, contentText: 'annual leave', projectId: 15 },
    { id: 15, title: 'Moved board', contentText: 'annual leave', projectId: 15, ownerId: 2 },
    { id: 16, title: 'Deleted board', contentText: 'annual leave', projectId: 15, status: 'Deleted' },
  ].map(row => ({ archived: false, taskId: 10, task: { id: 10, projectId: row.projectId, status: 'Normal' }, ...row,
    project: { id: row.projectId, ownerId: row.ownerId ?? 1, status: row.status ?? 'Normal' } }));
  rows.push({ ...rows[1], id: 17, taskId: null, task: null });
  const queries = [];
  const searches = [];
  const helper = load('src/utils/controllers/pages/pageService.ts', {
    '@/lib/prisma': { default: { page: { findMany: async (query) => {
      queries.push(query);
      return rows.filter(row => matches(row, query.where)).slice(0, query.take ?? rows.length).map(row => ({ ...row }));
    } } } },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: (userId, agentId, teamScope) => {
      assert.equal(userId, 1);
      assert.equal(agentId, 'agent');
      assert.deepEqual(teamScope, { teamId: 'team' });
      return { ownerId: userId };
    } },
    '@/utils/controllers/turbopuffer/turbopufferHelper': {
      searchPagesInTurbopuffer: async (args) => { searches.push(args); return indexRows; },
      convertToPlain: text => text,
    },
    '@/utils/helperFunctions/markdownToHtml': { markdownToHtml: text => text },
    '@/utils/helperFunctions/sanitizeRichHtml': { sanitizeRichHtml: text => text },
  });
  return { helper, queries, searches };
}
const args = { projectIds: [15], userId: 1, agentId: 'agent', teamScope: { teamId: 'team' }, hybridSearchEnabled: true };

test('paraphrase page evaluation: authorized hits keep index relevance, stale access canaries disappear', async (t) => {
  const cases = [
    { query: 'time off rules', expected: [12], ids: [13, 14, 15, 16, 12, 999] },
    { query: 'money back for work trips', expected: [11], ids: [11, 13] },
    { query: 'staff guidance', expected: [12, 11], ids: [12, 11, 12] },
  ];
  for (const pair of cases) {
    const h = service(pair.ids.map(id => ({ id: String(id) })));
    const result = await h.helper.searchPages({ ...args, query: pair.query });
    assert.deepEqual(result.map(row => row.id), pair.expected);
    assert.equal(result[0].taskId, 10);
    assert.equal(h.queries[0].where.OR, undefined, 'paraphrases must not be subjected to substring matching');
    assert.equal(h.queries[0].take, 50);
  }
  t.diagnostic('Page retrieval wiring evaluation: 3/3 expected rankings; 0/4 stale-access canaries returned. Index ranking is stubbed; this is not a live relevance benchmark.');
});

test('flag-off preserves literal matching; empty index falls back; legacy-only excludes taskless pages', async () => {
  const h = service([{ id: '17' }, { id: '12' }]);
  const old = await h.helper.searchPages({ ...args, query: 'annual leave', hybridSearchEnabled: false });
  assert.deepEqual(old.map(row => row.id), [12, 17]);
  assert.equal(h.searches.length, 0);
  const legacy = await h.helper.searchPages({ ...args, query: 'time off', standalonePagesEnabled: false });
  assert.deepEqual(legacy.map(row => row.id), [12]);
  const empty = service([]);
  assert.deepEqual((await empty.helper.searchPages({ ...args, query: 'annual leave' })).map(row => row.id), [12, 17]);
  assert.deepEqual(await empty.helper.searchPages({ ...args, query: ' ' }), []);
  assert.deepEqual(await empty.helper.searchPages({ ...args, projectIds: [], query: 'policy' }), []);
  assert.equal(empty.searches.length, 1);
});


test('unavailable embedding key falls back to index BM25', async () => {
  const oldKey = process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
  delete process.env.TURBOPUFFER_EMBEDDINGS_API_KEY;
  try {
    const h = reader();
    assert.deepEqual(await h.helper.searchPagesInTurbopuffer({ searchQuery: 'policy', projectIds: [15] }), h.rows);
    assert.equal(h.queries[0].rank_by[0], 'Sum');
  } finally {
    if (oldKey !== undefined) process.env.TURBOPUFFER_EMBEDDINGS_API_KEY = oldKey;
  }
});
