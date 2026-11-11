const assert = require('node:assert/strict')
const { test } = require('node:test')
const { loadModule } = require('./helpers/loadModule.cjs')

const FULL = '<h2>Done when</h2><p>full acceptance criteria stay in the JSON</p>'

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

function loadSearch(fullDescription) {
  const selects = []
  const prisma = {
    project: { findMany: async () => [{ id: 7 }] },
    task: {
      count: async () => 1,
      findMany: async ({ select }) => {
        selects.push(select)
        return [row()]
      },
    },
  }
  const route = loadModule('src/lib/mcp/operations/tasks/search/operation.ts', {
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: (handler) => handler,
      validateMcpRouteAuth: async () => ({ user: { id: 6, email: 'user@example.com' }, agentId: null, teamScope: null }),
      checkMcpRouteRateLimit: async () => null,
    },
    'next/server': {
      NextResponse: class NextResponse {
        static json(body, init = {}) {
          return { body, status: init.status ?? 200 }
        }
      },
    },
    '@/lib/flags': {
      isFeatureEnabled: async (key) => key === 'htpr-9072-search-description' ? fullDescription : false,
    },
    '@/lib/prisma': { __esModule: true, default: prisma },
    '@/lib/auth/agentScope': { recordAgentBoardScopeMiss: () => {}, agentScopeEnforced: () => false },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    '@/lib/mcp/agents': { mcpVisibleAgentSelect: () => ({ id: true }), mapVisibleMcpAgent: () => null },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({ ownerId: 6 }) },
    '@/utils/controllers/search/document': { turbopufferSearchTaskIds: async () => [] },
    '@/utils/controllers/turbopuffer/turbopufferHelper': {
      searchPreviewText: (text) => text,
      searchTasks: async () => [],
      searchComments: async () => [],
    },
    '@/lib/search/serverOperators': {
      parseSearchWithChipNames: async (query) => ({ text: query, filters: {} }),
    },
    '@/lib/agents/visibility': { accessibleAgentWhere: () => ({}) },
    '@/lib/mcp/tasks/mappers': {
      mapMcpTaskLabel: () => ({}),
      mapTaskAssignee: () => undefined,
      mapTaskDescriptionContent: () => '',
      mapTaskToMcpGetResponse: (task) => task,
      mcpTaskLabelSelect: {},
      taskMcpGetInclude: {},
      mcpTaskUserCommentCount: true,
    },
    '@/lib/mcp/pagination/cursor': { decodeCursor: () => null, encodeCursor: () => null },
    '@/lib/mcp/priorityFilter': { parsePriorityFilter: () => [] },
  })
  return { GET: route.GET, selects }
}

async function search(fullDescription) {
  const route = loadSearch(fullDescription)
  const response = await route.GET({
    nextUrl: { searchParams: new URLSearchParams({ q: 'acceptance' }) },
  })
  return { status: response.status, body: response.body, selects: route.selects }
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
