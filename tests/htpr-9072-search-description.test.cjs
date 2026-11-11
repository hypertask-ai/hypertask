const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const FULL = '<h2>Done when</h2><p>full acceptance criteria stay in the JSON</p>'

let state
function matches(row, where) {
  if (!where || typeof where !== 'object') return true
  if (where.projectId?.in && !where.projectId.in.includes(row.projectId)) return false
  if (where.projectId && typeof where.projectId === 'number' && row.projectId !== where.projectId) return false
  if (where.id?.in && !where.id.in.includes(row.id)) return false
  if (where.AND && !where.AND.every((group) => matches(row, group))) return false
  if (where.OR && !where.OR.some((group) => matches(row, group))) return false
  if (where.title?.contains && !String(row.title).toLowerCase().includes(String(where.title.contains).toLowerCase())) return false
  if (where.description?.contains && !String(row.description || '').toLowerCase().includes(String(where.description.contains).toLowerCase())) return false
  if (where.ticketNumber?.contains && !String(row.ticketNumber || '').toLowerCase().includes(String(where.ticketNumber.contains).toLowerCase())) return false
  return true
}
function projectRow(row, select) {
  if (!select || typeof select !== 'object') return row
  const projected = {}
  for (const [key, value] of Object.entries(select)) {
    if (!value) continue
    projected[key] = row[key]
  }
  return projected
}
const mocks = new Map([
  ['src/lib/mcp/routeWrapper.ts', {
    validateMcpRouteAuth: async () => ({ user: { id: 6, email: 'user@example.com' }, agentId: null, teamScope: null }),
    checkMcpRouteRateLimit: async () => null,
    wrapMcpRoute: (handler) => handler,
  }],
  ['src/lib/mcp/auth.ts', {
    validateMcpAuth: async () => ({ user: { id: 6, email: 'user@example.com' }, agentId: null }),
    checkMcpRateLimit: async () => null,
  }],
  ['src/lib/flags.ts', {
    isFeatureEnabled: async (key) => key === 'htpr-9072-search-description' ? state.fullDescription : false,
  }],
  ['src/lib/mcp/readListQuery.ts', { readListQuery: () => ({ listQuery: null }) }],
  ['src/lib/mcp/agents.ts', { mcpVisibleAgentSelect: () => ({ id: true }), mapVisibleMcpAgent: () => null }],
  ['src/utils/controllers/projects/getAllIncludes.ts', { getProjectWhere: () => ({ ownerId: 6 }) }],
  ['src/utils/controllers/search/document.ts', { turbopufferSearchTaskIds: async () => [] }],
  ['src/lib/auth/agentScope.ts', { recordAgentBoardScopeMiss: () => {}, agentScopeEnforced: () => false }],
  ['src/lib/mcp/operationCrashReport.ts', { reportMcpOperationCrash: () => {} }],
  ['src/lib/prisma.ts', { default: {
    project: { findMany: async () => [{ id: 7 }] },
    label: { findMany: async () => [] },
    section: { findMany: async () => [] },
    task: {
      count: async ({ where }) => state.rows.filter((row) => matches(row, where)).length,
      findMany: async ({ where, select }) => {
        state.selects.push(select)
        return state.rows.filter((row) => matches(row, where)).map((row) => projectRow(row, select))
      },
    },
  } }],
])
for (const [file, exports] of mocks) {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
const jiti = require(path.join(root, 'node_modules/jiti'))(__filename, { alias: { '@': path.join(root, 'src') }, cache: false, interopDefault: true })
const { GET } = jiti(path.join(root, 'src/lib/mcp/operations/tasks/search/operation.ts'))
const { NextRequest } = require(path.join(root, 'node_modules/next/server'))

function row() {
  return {
    id: 42,
    projectId: 7,
    title: 'Full acceptance criteria',
    description: '',
    description_: { content: FULL },
    ticketNumber: 'HTPR-42',
    uniqueIndex: 42,
    section: 'Todo',
    project: { id: 7, title: 'Visible' },
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-09-01'),
    dueDate: null,
    agent: null,
  }
}

async function search(fullDescription) {
  state = { fullDescription, rows: [row()], selects: [] }
  const response = await GET(new NextRequest('http://localhost/api/mcp/tasks/search?q=acceptance'))
  return { status: response.status, body: await response.json(), selects: state.selects }
}

test('search JSON keeps the empty legacy column when the flag is off', async () => {
  const { status, body, selects } = await search(false)
  assert.equal(status, 200)
  assert.equal(body.tasks.length, 1)
  assert.equal(body.tasks[0].description, '')
  assert.equal(selects.some((select) => select && 'description_' in select), false)
})

test('search JSON returns the full description when the legacy column is empty', async () => {
  const { status, body, selects } = await search(true)
  assert.equal(status, 200)
  assert.equal(body.tasks[0].description, FULL)
  assert.equal(body.tasks[0].description.includes('full acceptance criteria'), true)
  assert.equal(selects.every((select) => select?.description_?.select?.content === true), true)
  console.log('full description ok')
})
