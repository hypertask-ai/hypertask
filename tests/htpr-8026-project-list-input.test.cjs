const test = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest } = require('next/server')
const { load } = require('./task-route-loader.cjs')

const queries = []
let authorized = true
const rows = [1, 2, 3].map(id => ({
  id, title: `Board ${id}`, name: `board-${id}`, ownerId: 985,
  uniqueIdentifier: `B${id}`, status: 'Normal', createdAt: new Date('2026-10-26'),
  owner: null, sections: ['Todo'], section: [], labels: [],
  _count: { members: 1, tasks: 2 },
}))
const route = load('src/lib/mcp/operations/projects/operation.ts', {
  '@/lib/auth/agentScope': { recordAgentBoardScopeMiss() {} },
    '@/lib/flags': { isFeatureEnabled: async () => false },
  '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash() {} },
  '@/lib/mcp/routeWrapper': {
    wrapMcpRoute: handler => handler,
    checkMcpRouteRateLimit: async () => null,
    validateMcpRouteAuth: async () => authorized
      ? { user: { id: 985 }, agentId: 'test-agent', teamScope: 'test-team' }
      : null,
  },
  '@/utils/controllers/projects/getAllIncludes': {
    getProjectListingWhere: (userId, agentId, teamScope) => ({ userId, agentId, teamScope }),
  },
  '@/lib/prisma': { default: { project: {
    count: async query => { queries.push(query); return rows.length },
    findMany: async query => {
      queries.push(query)
      assert.ok(Number.isSafeInteger(query.take) && query.take > 0)
      assert.ok(Number.isSafeInteger(query.skip) && query.skip >= 0)
      assert.ok(['asc', 'desc'].includes(Object.values(query.orderBy[0])[0]))
      const start = query.cursor ? rows.findIndex(row => row.id === query.cursor.id) + 1 : query.skip
      return rows.slice(start, start + query.take)
    },
  } } },
})

async function read(query = '') {
  queries.length = 0
  authorized = true
  const response = await route.GET(new NextRequest(`https://app.hypertask.ai/api/mcp/projects${query}`))
  return { status: response.status, body: await response.json() }
}

test('invalid pagination returns 400 before any project query', async () => {
  for (const parameter of ['limit', 'offset']) {
    const values = ['nope', '-1', '1.5', '9007199254740992', 'Infinity']
    if (parameter === 'limit') values.push('0', '')
    for (const value of values) {
      const result = await read(`?${parameter}=${value}`)
      assert.equal(result.status, 400, `${parameter}=${value}`)
      assert.equal(result.body.success, false)
      assert.equal(queries.length, 0)
    }
  }
})

test('ordinary scoped listings preserve metadata, pagination and projections', async () => {
  const first = await read('?limit=2')
  assert.equal(first.status, 200)
  assert.equal(first.body.total, 3)
  assert.deepEqual(first.body.projects.map(row => row.id), [1, 2])
  assert.equal(first.body.projects[0].uniqueIdentifier, 'B1')
  assert.equal(first.body.projects[0].taskCount, 2)
  assert.equal(first.body.nextCursor, '2')
  assert.deepEqual(queries[0].where.AND[0], {
    userId: 985, agentId: 'test-agent', teamScope: 'test-team',
  })
  const next = await read(`?limit=2&cursor=${first.body.nextCursor}&fields=id,title`)
  assert.equal(next.status, 200)
  assert.deepEqual(next.body.projects, [{ id: 3, title: 'Board 3' }])
  assert.equal(next.body.nextCursor, null)
  const offset = await read('?limit=1&offset=2')
  assert.equal(offset.status, 200)
  assert.deepEqual(offset.body.projects.map(row => row.id), [3])
  const defaults = await read()
  assert.equal(defaults.status, 200)
  assert.equal(defaults.body.limit, 50)
  assert.equal(defaults.body.offset, 0)
  const capped = await read('?limit=1000')
  assert.equal(capped.status, 200)
  assert.equal(capped.body.limit, 100)
})

test('invalid sort orders return 400; uppercase sort remains usable', async () => {
  const invalid = await read('?sort_order=sideways')
  assert.equal(invalid.status, 400)
  assert.equal(queries.length, 0)
  const valid = await read('?sort_order=DESC')
  assert.equal(valid.status, 200)
  assert.deepEqual(queries[1].orderBy, [{ title: 'desc' }, { id: 'asc' }])
})

test('unauthenticated callers remain rejected before project queries', async () => {
  queries.length = 0
  authorized = false
  const response = await route.GET(new NextRequest('https://app.hypertask.ai/api/mcp/projects'))
  assert.equal(response.status, 401)
  assert.equal(queries.length, 0)
})
