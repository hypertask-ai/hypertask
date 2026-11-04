const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const listQuery = load('src/lib/mcp/listQuery.ts')
const PARKED = 'Valentin Review, UX needed,UX Sign-off, Agent Blocked'

const rows = [
  { id: 'a', section: 'Bugs', title: 'Pickable bug' },
  { id: 'b', section: 'Valentin Review', title: 'Waits on Valentin' },
  { id: 'c', section: 'UX needed', title: 'Waits on design' },
  { id: 'd', section: 'Agent Blocked (Infra)', title: 'Broken tool' },
  { id: 'e', section: 'Improvements', title: 'Pickable improvement' },
]

test('the dotted filter param reads a comma-separated list of column titles', () => {
  const parsed = listQuery.parseListQueryFromSearchParams(new URLSearchParams({
    'filter.section_not': PARKED,
  }))
  assert.deepEqual(parsed.filter.section_not, [
    'Valentin Review',
    'UX needed',
    'UX Sign-off',
    'Agent Blocked',
  ])
  assert.equal(parsed.filter.section, undefined)
})

test('the JSON filter object keeps its own order and drops repeats', () => {
  const parsed = listQuery.parseListQueryFromArgs({
    filter: { section_not: ['UX needed', 'Valentin Review', 'UX needed'] },
  })
  assert.deepEqual(parsed.filter.section_not, ['UX needed', 'Valentin Review'])
})

test('array entries preserve commas while string input splits them', () => {
  const titles = [' Bugs, urgent ', 'UX needed', 'Bugs, urgent']
  const parsed = listQuery.parseListQueryFromArgs({ filter: { section_not: titles } })
  assert.deepEqual(parsed.filter.section_not, ['Bugs, urgent', 'UX needed'])
  assert.deepEqual(listQuery.parseSectionNot(parsed.filter.section_not), ['Bugs, urgent', 'UX needed'])
  assert.deepEqual(listQuery.parseSectionNot('Bugs, urgent'), ['Bugs', 'urgent'])
})

test('a repeated dotted param also collects into one list', () => {
  const params = new URLSearchParams()
  params.append('filter.section_not', 'Valentin Review, UX needed')
  params.append('filter.section_not', 'UX needed, Bugs')
  assert.deepEqual(listQuery.parseListQueryFromSearchParams(params).filter.section_not, [
    'Valentin Review',
    'UX needed',
    'Bugs',
  ])
})

test('parsing conflicting filters does not reject unauthorized exclusions', () => {
  const query = listQuery.parseListQueryFromSearchParams(new URLSearchParams({
    'filter.section': 'Bugs', 'filter.section_not': 'UX needed',
  }))
  assert.equal(query.filter.section, 'Bugs')
  assert.deepEqual(listQuery.applyCollectionQuery(rows, query).items.map((item) => item.id), ['a'])
})

test('shared collections ignore exclusions without authorization', () => {
  const query = listQuery.parseListQueryFromArgs({ filter: { section_not: PARKED } })
  assert.deepEqual(listQuery.applyCollectionQuery(rows, query).items.map((item) => item.id),
    ['a', 'b', 'c', 'd', 'e'])
})

test('the exclusion survives the round trip back into query params', () => {
  const params = new URLSearchParams()
  listQuery.appendListQueryParams(params, { filter: { section_not: ['UX needed'] } })
  assert.deepEqual(JSON.parse(params.get('filter') ?? '{}').section_not, ['UX needed'])
})

test('the dotted param name is declared, or the read would ignore it', () => {
  assert.ok(listQuery.LIST_FILTER_KEYS.includes('section_not'))
})

function routeFixture(surface, enabled) {
  const { z } = require('zod')
  const queries = []
  class NextResponse {
    static json(body, init = {}) { return Object.assign(new NextResponse(), { body, status: init.status ?? 200 }) }
  }
  const mocks = {
    ai: { tool: (definition) => definition },
    'next/server': { NextResponse },
    '@/lib/mcp/routeWrapper': {
      wrapMcpRoute: (handler) => handler,
      validateMcpRouteAuth: async () => ({ user: { id: 6 }, agentId: null }),
      checkMcpRouteRateLimit: async () => null,
    },
    '@/lib/auth/agentScope': { agentScopeEnforced: () => false, recordAgentBoardScopeMiss: () => {} },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: (request, error) => { throw error } },
    '@/lib/prisma': { default: {
      project: { findMany: async () => [{ id: 15 }] },
      task: {
        count: async ({ where }) => { queries.push(structuredClone(where)); return 0 },
        findMany: async ({ where }) => { queries.push(structuredClone(where)); return [] },
      },
    } },
    '@/lib/flags/keys': { HTPR_8536_SECTION_NOT_FILTER_FLAG: 'section-not' },
    '@/lib/flags': { isFeatureEnabled: async (key) => key === 'section-not' && enabled },
    '@/utils/controllers/projects/getAllIncludes': { getProjectWhere: () => ({}) },
    '@/lib/mcp/agents': { mcpVisibleAgentSelect: () => ({}), mapVisibleMcpAgent: () => undefined },
    '@/lib/agents/visibility': { accessibleAgentWhere: () => ({}) },
    '@/lib/mcp/tasks/mappers': { mcpTaskUserCommentCount: true, mcpTaskLabelSelect: {} },
    '@/lib/mcp/tasks/resolveTask': { taskIdentifierErrorResponse: () => null },
    '@/lib/pullRequests/taskPullRequests': { refreshTaskPullRequests: async () => [] },
    '@/lib/mcp/pagination/cursor': { encodeCursor: () => null },
    '@/lib/mcp/priorityFilter': { parsePriorityFilter: () => [] },
    '@/lib/ai/chatStream/request': { statusSchema: z.string(), sortOrderSchema: z.string() },
    '@/utils/controllers/notifications/inboxZero': { loadDoneTitlesByProject: async () => new Map() },
    '@/utils/controllers/search/document': { turbopufferSearchTaskIds: async () => [9, 3] },
    '@/lib/search/serverOperators': { parseSearchWithChipNames: async (query) => ({ text: query, filters: {} }) },
    '@/lib/search/rankedWhere': {},
  }
  const file = surface === 'search' ? 'src/lib/mcp/operations/tasks/search/operation.ts' : 'src/lib/mcp/operations/tasks/operation.ts'
  const route = load(file, mocks)
  return {
    queries,
    run: (params) => route.GET({ nextUrl: { searchParams: new URLSearchParams({ q: 'needle', ...params }) } }),
  }
}

for (const surface of ['list', 'search']) {
  test(`${surface} gates exclusion and conflicting filter validation`, async () => {
    for (const enabled of [false, true]) {
      const f = routeFixture(surface, enabled)
      const response = await f.run({ 'filter.section_not': 'UX needed, Valentin Review' })
      assert.equal(response.status, 200)
      assert.deepEqual(f.queries[0].section, enabled
        ? { notIn: ['UX needed', 'Valentin Review'], mode: 'insensitive' }
        : undefined)
      const conflict = await f.run({ 'filter.section': 'Bugs', 'filter.section_not': 'UX needed' })
      assert.equal(conflict.status, enabled ? 400 : 200)
      if (!enabled) assert.equal(f.queries.at(-1).section, 'Bugs')
    }
  })

  test(`${surface} rejects legacy section filters only when exclusion is enabled`, async () => {
    for (const enabled of [false, true]) {
      for (const params of [{ section: 'Bugs' }, { section: '42' }, { section_id: '42' }]) {
        const f = routeFixture(surface, enabled)
        const response = await f.run({ ...params, 'filter.section_not': 'UX needed' })
        assert.equal(response.status, enabled ? 400 : 200)
        if (enabled) assert.equal(f.queries.length, 0)
        else if (params.section === 'Bugs') assert.equal(f.queries[0].section, 'Bugs')
        else if (params.section || surface === 'list') assert.equal(f.queries[0].sectionId, 42)
      }
    }
  })
}

test('flag-off search keeps the ranked window', async () => {
  const f = routeFixture('search', false)
  const response = await f.run({ 'filter.section_not': 'UX needed' })
  assert.equal(response.status, 200)
  assert.deepEqual(f.queries[0].id, { in: [9, 3] })
  assert.equal(f.queries[0].OR, undefined)
})

test('enabled search applies exclusion outside the ranked window', async () => {
  const f = routeFixture('search', true)
  const response = await f.run({ 'filter.section_not': 'UX needed' })
  assert.equal(response.status, 200)
  assert.equal(f.queries[0].id, undefined)
  assert.ok(f.queries[0].OR)
})
