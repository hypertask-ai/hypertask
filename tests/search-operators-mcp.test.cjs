const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
let state
function matches(row, where) {
  if (where.projectId && !(where.projectId.in ?? [where.projectId]).includes(row.projectId)) return false
  if (where.id?.in && !where.id.in.includes(row.id)) return false
  if (where.AND && !where.AND.every((group) => matches(row, group))) return false
  if (where.OR && !where.OR.some((group) => matches(row, group))) return false
  if (where.project && row.project.title.toLowerCase() !== where.project.title.equals.toLowerCase()) return false
  return true
}
const mocks = new Map([
  ['src/lib/mcp/auth.ts', {
    validateMcpAuth: async () => ({ user: { id: 6, email: 'user@example.com' }, agentId: null }),
    checkMcpRateLimit: async () => null,
  }],
  ['src/lib/flags.ts', {
    HTPR_6881_SEARCH_FUZZY_PERSON_FLAG: 'htpr-6881-search-fuzzy-person',
    HTPR_6369_SEARCH_OPERATORS_FLAG: 'htpr-6369-search-operators',
    HTPR_6370_SEARCH_CHIPS_FLAG: 'htpr-6370-search-chips',
    HTPR_6530_MCP_LIST_QUERY_FLAG: 'htpr-6530-mcp-list-query',
    isFeatureEnabled: async (key) => key === 'htpr-6881-search-fuzzy-person' ? false : key === 'htpr-6369-search-operators' ? state.flag : state.listFlag,
  }],
  ['src/lib/mcp/readListQuery.ts', { readEnabledListQuery: (_, params) => ({ listQuery: state.listFlag
    ? { query: null, cursor: params.get('cursor'), filter: {}, fields: [], sortBy: state.sortBy, sortOrder: state.sortOrder }
    : null }) }],
  ['src/lib/mcp/agents.ts', { mcpVisibleAgentSelect: () => ({ id: true }), mapVisibleMcpAgent: () => null }],
  ['src/utils/controllers/projects/getAllIncludes.ts', { getProjectWhere: () => ({ ownerId: 6 }) }],
  ['src/utils/controllers/search/document.ts', { turbopufferSearchTaskIds: async () => { state.legacyCalls++; return [8, 123] } }],
  ['src/utils/controllers/turbopuffer/turbopufferHelper.ts', {
    searchTasks: async ({ topK }) => { state.windows.push(topK); return state.taskHits.slice(0, topK) },
    searchComments: async ({ limit }) => state.commentHits.slice(0, limit),
  }],
  ['src/lib/prisma.ts', { default: {
    project: { findMany: async () => [{ id: 7 }] },
    label: { findMany: async () => [{ value: 'bug' }] },
    section: { findMany: async () => [{ projectId: 7, section_title: 'Done', isDone: true }] },
    task: {
      count: async ({ where }) => state.rows.filter((row) => matches(row, where)).length,
      findMany: async ({ where, orderBy, take, skip, cursor, select }) => {
        state.where = where
        state.queries.push({ where, orderBy, take, cursor })
        if (cursor && !orderBy) throw Error('Cursor requires orderBy')
        let rows = state.rows.filter((row) => matches(row, where))
        if (orderBy) rows = rows.sort((a, b) => {
          for (const order of orderBy) {
            const [field, direction] = Object.entries(order)[0]
            const comparison = a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0
            if (comparison) return direction === 'desc' ? -comparison : comparison
          }
          return 0
        })
        if (cursor) rows = rows.slice(rows.findIndex((row) => row.id === cursor.id) + (skip ?? 0))
        if (take) rows = rows.slice(0, take)
        return select.id && Object.keys(select).length === 1 ? rows.map(({ id }) => ({ id })) : rows
      },
    },
  } }],
])
mocks.get('src/lib/flags.ts').isFeatureEnabled = async (key) => key === 'htpr-6881-search-fuzzy-person' ? false : key === 'htpr-6369-search-operators' ? state.flag : key === 'htpr-6370-search-chips' ? state.chipsFlag : state.listFlag
mocks.get('src/lib/prisma.ts').default.project.findMany = async ({ select }) => select.title ? [{ title: 'Visible' }] : [{ id: 7 }]
for (const [file, exports] of mocks) {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false, interopDefault: true })
const { GET } = jiti(path.join(root, 'src/app/api/mcp/tasks/search/route.ts'))
const { NextRequest } = require('next/server')
function row(id, projectId = 7, updatedAt = new Date('2026-09-01')) {
  return { id, projectId, title: 'Cleanup', description: '', ticketNumber: `X-${id}`, section: 'Todo',
    project: { id: projectId, title: projectId === 7 ? 'Visible' : 'Private' },
    createdAt: new Date('2026-08-01'), updatedAt, dueDate: null }
}
async function search(query, overrides = {}, options = '') {
  state = { flag: true, listFlag: false, legacyCalls: 0, windows: [], taskHits: [], commentHits: [], queries: [],
    rows: [row(8, 8), row(123)], ...overrides }
  const response = await GET(new NextRequest(`http://localhost/api/mcp/tasks/search?q=${encodeURIComponent(query)}${options}`))
  return { response, body: await response.json(), state }
}

test('MCP operator-only query excludes private row even if mock DB has it', async () => {
  const { response, body, state } = await search('label:bug is:open in:8')
  assert.equal(response.status, 200)
  assert.deepEqual(state.windows, [])
  assert.deepEqual(body.tasks, [])
  assert.deepEqual(state.where.projectId, { in: [7] })
})

test('MCP operator-only pagination orders by updatedAt then id, and accepts cursor', async () => {
  const rows = [row(8, 8), ...Array.from({ length: 15 }, (_, i) => row(i + 100, 7,
    new Date(`2026-09-${String(i < 2 ? 30 : 31 - i).padStart(2, '0')}`)))]
  const first = await search('label:bug', { rows, listFlag: true }, '&limit=10')
  assert.equal(first.response.status, 200)
  assert.deepEqual(first.state.queries[0].orderBy, [{ updatedAt: 'desc' }, { id: 'asc' }])
  assert.deepEqual(first.body.tasks.slice(0, 2).map((task) => task.id), [100, 101])
  assert.equal(first.body.nextCursor, String(first.body.tasks[9].id))
  const second = await search('label:bug', { rows, listFlag: true }, `&limit=10&cursor=${first.body.nextCursor}`)
  assert.equal(second.response.status, 200)
  assert.deepEqual(second.body.tasks.map((task) => task.id), [110, 111, 112, 113, 114])
})

test('MCP filtered engine includes description match beyond 200 without SQL contains', async () => {
  const taskHits = [...Array.from({ length: 240 }, (_, i) => ({ id: String(i + 1000), descriptionText: 'zebra-quark' })),
    { id: '123', descriptionText: 'zebra-quark' }]
  const { body, state } = await search('zebra-quark label:bug', { taskHits })
  assert.deepEqual(state.windows, [100, 200, 400])
  assert.deepEqual(body.tasks.map((task) => task.id), [123])
})

test('MCP totals and explicit sort cover later matches, not only the first page of relevance', async () => {
  const taskHits = Array.from({ length: 120 }, (_, i) => ({ id: String(1000 + i), descriptionText: '' }))
  const rows = [...Array.from({ length: 10 }, (_, i) => row(1000 + i)),
    row(1119, 7, new Date('2026-01-01'))]
  const { body, state } = await search('zebra label:bug', { taskHits, rows, listFlag: true,
    sortBy: 'updatedAt', sortOrder: 'asc' }, '&limit=10')
  assert.deepEqual(state.windows, [100, 200])
  assert.equal(body.total, 11)
  assert.equal(body.partial, undefined)
  assert.equal(body.tasks[0].id, 1119)
})

test('MCP capped results mark total and sorted page as partial', async () => {
  const taskHits = Array.from({ length: 5000 }, (_, i) => ({ id: String(1000 + i), descriptionText: '' }))
  const rows = [row(1000), row(5999)]
  const { body, state } = await search('zebra label:bug', { taskHits, rows, listFlag: true,
    sortBy: 'updatedAt', sortOrder: 'asc' }, '&limit=10')
  assert.deepEqual(state.windows, [100, 200, 400, 800])
  assert.equal(body.total, 1)
  assert.equal(body.partial, true)
  assert.deepEqual(body.tasks.map((task) => task.id), [1000])
  assert.ok(state.queries.filter(({ where }) => where.id?.in).every(({ where }) => where.id.in.length <= 1600))
})

test('MCP hash board lookup stays behind the chips flag', async () => {
  const off = await search('in:#Visible', { chipsFlag: false })
  assert.deepEqual(off.body.tasks, [])
  const on = await search('in:#Visible', { chipsFlag: true })
  assert.deepEqual(on.body.tasks.map((item) => item.id), [123])
})
test('MCP flag off preserves current search contract', async () => {
  const { response, state } = await search('label:bug', { flag: false })
  assert.equal(response.status, 200)
  assert.equal(state.legacyCalls, 1)
  assert.equal(state.where.AND, undefined)
})
