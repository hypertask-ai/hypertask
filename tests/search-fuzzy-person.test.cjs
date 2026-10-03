const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const flag = 'htpr-6881-search-fuzzy-person'
let state
const people = [
  { id: 1, displayName: 'Valentin Yeo', email: 'owner@example.com', boards: [7] },
  { id: 2, displayName: 'valentin', email: 'other@example.com', boards: [7] },
  { id: 3, displayName: 'valentinyeo', email: 'third@example.com', boards: [7] },
  { id: 4, displayName: 'JOSÉ Álvarez', email: 'jose@example.com', boards: [7] },
  { id: 5, displayName: 'Unrelated', email: 'typed.person@example.com', boards: [7] },
  { id: 6, displayName: null, email: 'null.name@example.com', boards: [7] },
  { id: 9, displayName: 'Valentin Other Board', email: 'nine@example.com', boards: [9] },
  { id: 99, displayName: 'Valentin Private', email: 'private@example.com', boards: [8] },
]
function matches(row, where) {
  if (where.AND && !where.AND.every((part) => matches(row, part))) return false
  if (where.OR && !where.OR.some((part) => matches(row, part))) return false
  if (where.NOT && matches(row, where.NOT)) return false
  for (const key of ['id', 'projectId', 'userId', 'status', 'displayName', 'email', 'title']) {
    if (where[key] === undefined) continue
    const condition = where[key]
    if (condition?.in) { if (!condition.in.includes(row[key])) return false }
    else if (condition?.equals !== undefined) {
      if (row[key]?.toLowerCase() !== condition.equals.toLowerCase()) return false
    } else if (typeof condition?.startsWith === 'string') {
      if (!row[key]?.toLowerCase().startsWith(condition.startsWith.toLowerCase())) return false
    } else if (row[key] !== condition) return false
  }
  if (where.project && !matches(row.project, where.project)) return false
  if (where.user && !matches(row.user, where.user)) return false
  if (where.assignees?.some && !row.assignees.some((person) => matches(person, where.assignees.some))) return false
  return true
}
function reset(fuzzy = true, chips = true, match = false) {
  state = { fuzzy, chips, match, poolQueries: 0, flagCalls: [], taskQueries: [] }
}
const tasks = people.map((person) => ({
  id: 100 + person.id, userId: person.id, user: person, projectId: person.boards[0],
  assignees: [{ userId: person.id, user: person }], title: 'Fixture', status: 'Normal',
  description_: { content: '' }, ticketNumber: `TEST-${person.id}`, section: 'Todo',
  uniqueIndex: person.id, project: { id: person.boards[0], title: person.boards[0] === 9 ? 'Other Board' : 'Visible' },
  updatedAt: new Date('2026-10-01'), createdAt: new Date('2026-10-01'), dueDate: null,
}))
const db = {
  project: { findMany: async ({ where }) => [
    { id: 7, title: 'Visible', status: 'Normal' }, { id: 9, title: 'Other Board', status: 'Normal' },
  ].filter((row) => matches(row, where)) },
  user: { findMany: async ({ where, select }) => {
    const ids = where.OR[0].tasks.some.projectId.in
    assert.deepEqual(where.OR, [
      { tasks: { some: { projectId: { in: ids } } } },
      { assignees: { some: { task: { projectId: { in: ids } } } } },
      { members: { some: { projectId: { in: ids } } } },
    ])
    assert.ok(ids.every((id) => [7, 9].includes(id)))
    if (select.id) {
      state.poolQueries++
      assert.deepEqual(select, { id: true, displayName: true, email: true })
    }
    return people.filter((person) => person.boards.some((id) => ids.includes(id)) &&
      (!where.displayName || matches(person, { displayName: where.displayName })))
  } },
  task: {
    count: async ({ where }) => tasks.filter((row) => matches(row, where)).length,
    findMany: async ({ where }) => { state.taskQueries.push(where); return tasks.filter((row) => matches(row, where)) },
  },
}
const mocks = new Map([
  ['src/lib/prisma.ts', { default: db }],
  ['src/lib/auth/getSessionUser.ts', { getSessionUser: async () => ({ userId: 42 }) }],
  ['src/lib/mcp/auth.ts', { validateMcpAuth: async () => ({ user: { id: 42 }, agentId: null }), checkMcpRateLimit: async () => null }],
  ['src/lib/flags.ts', {
    HTPR_6881_SEARCH_FUZZY_PERSON_FLAG: flag,
    HTPR_6369_SEARCH_OPERATORS_FLAG: 'operators', HTPR_6370_SEARCH_CHIPS_FLAG: 'chips',
    HTPR_6372_SEARCH_RANKING_FLAG: 'htpr-6372-search-ranking',
    HTPR_6880_SEARCH_COMMENTER_FLAG: 'htpr-6880-search-commenter',
    HTPR_6878_SEARCH_LABEL_SCOPE_FLAG: 'htpr-6878-search-label-scope',
    HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG: 'htpr-6882-search-match-highlights',
    HTPR_6865_SEARCH_LAYOUT_FLAG: 'htpr-6865-search-layout',
    HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG: 'htpr-6688-search-autocomplete',
    isFeatureEnabled: async (key, userId) => {
      state.flagCalls.push([key, userId])
      assert.equal(userId, 42)
      return key === flag ? state.fuzzy : key === 'chips' ? state.chips
        : ['htpr-6882-search-match-highlights', 'htpr-6865-search-layout', 'htpr-6688-search-autocomplete'].includes(key) ? state.match
        : key === 'operators'
    },
  }],
  ['src/utils/controllers/projects/getAllIncludes.ts', { getProjectWhere: () => ({}), projectContentAccessWhere: () => ({}) }],
  ['src/lib/mcp/readListQuery.ts', { readListQuery: () => ({ listQuery: null }) }],
  ['src/lib/mcp/agents.ts', { mcpVisibleAgentSelect: () => ({}), mapVisibleMcpAgent: () => null }],
  ['src/utils/controllers/turbopuffer/turbopufferHelper.ts', { searchPreviewText: (text) => text }],
])
for (const [file, exports] of mocks) {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false, interopDefault: true })
const { parseSearchWithNames, parseSearchWithChipNames } = jiti(path.join(root, 'src/lib/search/serverOperators.ts'))
const { searchFilterWhere } = jiti(path.join(root, 'src/lib/search/filters.ts'))
const handler = jiti(path.join(root, 'src/pages/api/search/document.ts')).default
const { GET } = jiti(path.join(root, 'src/app/api/mcp/tasks/search/route.ts'))
const { NextRequest } = require('next/server')
async function filter(query, fuzzy = true, chips = false) {
  reset(fuzzy, chips)
  const parsed = await (chips ? parseSearchWithChipNames : parseSearchWithNames)(query, [7], fuzzy)
  const where = await searchFilterWhere(parsed, [7], 'Normal')
  return { parsed, where, ids: tasks.filter((row) => matches(row, where)).map((row) => row.userId) }
}

test('typed from and assignee match all three similar visible names, including @ and quotes', async () => {
  for (const operator of ['from', 'assignee']) {
    for (const value of ['valentin', '@valentin', '"@valentin"']) {
      const result = await filter(`${operator}:${value}`)
      assert.deepEqual(result.ids, [1, 2, 3])
      assert.deepEqual(result.parsed.filters[operator][0].userIds, [1, 2, 3])
      assert.equal(state.poolQueries, 1)
    }
  }
})
test('numeric picked chips stay exact and do not load the person pool', async () => {
  for (const query of ['from:1', 'assignee:2', 'from:"@3"']) {
    const result = await filter(query, true, true)
    assert.deepEqual(result.ids, [Number(query.match(/\d/)[0])])
    assert.equal(state.poolQueries, 0)
    assert.ok(Object.values(result.parsed.filters).every((filters) => filters.every((filter) => !('userIds' in filter))))
  }
})
test('names and emails match case/accent-insensitive substrings, with or without display names', async () => {
  for (const [value, ids] of [['JOSE', [4]], ['"@josé áL"', [4]], ['OSE', [4]], ['TYPED.PÉRSON', [5]], ['NULL.NAME', [6]]]) {
    assert.deepEqual((await filter(`assignee:${value}`)).ids, ids)
  }
})
test('negation excludes every similar person and combines with OR-valued inclusions', async () => {
  assert.deepEqual((await filter('-from:valentin')).ids, [4, 5, 6])
  assert.deepEqual((await filter('-assignee:"@Valentin"')).ids, [4, 5, 6])
  assert.deepEqual((await filter('from:valentin from:JOSE -from:2')).ids, [1, 3, 4])
  assert.equal(state.poolQueries, 1)
})
test('zero matches use an empty id set; negating zero matches excludes nobody', async () => {
  const result = await filter('from:nobody')
  assert.deepEqual(result.ids, [])
  assert.deepEqual(result.where.AND, [{ OR: [{ userId: { in: [] } }] }])
  assert.deepEqual((await filter('-from:nobody')).ids, [1, 2, 3, 4, 5, 6])
})
test('inaccessible and unrequested-board users are excluded from the resolved set', async () => {
  assert.deepEqual((await filter('from:valentin')).parsed.filters.from[0].userIds, [1, 2, 3])
  assert.deepEqual((await filter('from:private@example.com')).ids, [])
  assert.deepEqual((await filter('from:nine@example.com')).ids, [])
})
test('flag off retains byte-identical parsed filters and exact database predicates', async () => {
  for (const chips of [false, true]) {
    const result = await filter('from:@valentin', false, chips)
    assert.equal(JSON.stringify(result.parsed), '{"text":"","filters":{"from":[{"value":"@valentin","negated":false}]}}')
    assert.equal(JSON.stringify(result.where), '{"projectId":{"in":[7]},"status":"Normal","AND":[{"OR":[{"user":{"OR":[{"displayName":{"equals":"valentin","mode":"insensitive"}},{"email":{"equals":"valentin","mode":"insensitive"}}]}}]}]}')
    assert.deepEqual(result.ids, [2])
    assert.equal(state.poolQueries, 0)
  }
})
test('unquoted full names still consume their trailing words rather than searching them', async () => {
  assert.deepEqual((await filter('from:@Valentin Yeo', true, true)).parsed, {
    text: '', filters: { from: [{ value: '@Valentin Yeo', negated: false, userIds: [1] }] },
  })
})
for (const surface of ['API', 'MCP']) {
  test(`${surface} checks the requester flag and uses the shared rule in both chip modes`, async () => {
    for (const chips of [false, true]) {
      for (const fuzzy of [false, true]) {
        reset(fuzzy, chips)
        let ids
        if (surface === 'API') {
          const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
          await handler({ method: 'POST', headers: {}, body: { searchQuery: 'from:valentin', projectIds: [7], archive: 'Normal' } }, res)
          assert.equal(res.code, 200)
          ids = res.body.processedData.All.map((row) => row.taskId)
        } else {
          const res = await GET(new NextRequest('http://localhost/api/mcp/tasks/search?q=from:valentin&board_id=7'))
          assert.equal(res.status, 200)
          ids = (await res.json()).tasks.map((row) => row.id)
        }
        assert.deepEqual(ids, fuzzy ? [101, 102, 103] : [102])
        assert.ok(state.flagCalls.some(([key, userId]) => key === flag && userId === 42))
        assert.equal(state.poolQueries, Number(fuzzy))
      }
    }
  })
}
test('fuzzy people and match highlights work independently in every flag combination', async () => {
  for (const operator of ['from', 'assignee']) {
    for (const fuzzy of [false, true]) {
      for (const match of [false, true]) {
        reset(fuzzy, true, match)
        const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
        await handler({ method: 'POST', headers: {}, body: { searchQuery: `${operator}:valentin`, projectIds: [7], archive: 'Normal' } }, res)
        assert.equal(res.code, 200)
        const rows = res.body.processedData.All
        const expected = fuzzy ? people.slice(0, 3) : [people[1]]
        assert.deepEqual(rows.map((row) => row.taskId), expected.map((person) => 100 + person.id))
        assert.deepEqual(rows.map((row) => row.searchMatch?.people), expected.map((person) => match ? [person.displayName] : undefined))
      }
    }
  }
})

test('board-name parsing keeps accessible boards separate from the scoped fuzzy person pool', async () => {
  for (const chips of [false, true]) {
    reset(true, chips)
    const parsed = await (chips ? parseSearchWithChipNames : parseSearchWithNames)(
      '-in:Other Board from:valentin', [7, 9], true, [7],
    )
    assert.equal(parsed.text, '')
    assert.deepEqual(parsed.filters.in, [{ value: 'Other Board', negated: true }])
    assert.deepEqual(parsed.filters.from[0].userIds, [1, 2, 3])
  }
})
for (const surface of ['API', 'MCP']) {
  test(`${surface} board-name parsing consumes other accessible board names with a board scope`, async () => {
    for (const chips of [false, true]) {
      reset(true, chips)
      const query = '-in:Other Board from:valentin'
      let ids
      if (surface === 'API') {
        const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
        await handler({ method: 'POST', headers: {}, body: { searchQuery: query, projectIds: [7, 9], contextProjectId: 7 } }, res)
        assert.equal(res.code, 200)
        ids = res.body.processedData.All.map((row) => row.taskId)
      } else {
        const res = await GET(new NextRequest(`http://localhost/api/mcp/tasks/search?q=${encodeURIComponent(query)}&board_id=7`))
        assert.equal(res.status, 200)
        ids = (await res.json()).tasks.map((row) => row.id)
      }
      assert.deepEqual(ids, [101, 102, 103])
      assert.ok(state.taskQueries.every((where) => where.AND.some((part) =>
        part.NOT?.project?.title?.equals === 'Other Board',
      )))
    }
  })
}
test('API denies inaccessible requested boards before resolving people', async () => {
  reset()
  const res = { status(code) { this.code = code; return this }, json(body) { this.body = body; return this } }
  await handler({ method: 'POST', headers: {}, body: { searchQuery: 'from:valentin', projectIds: [7, 8] } }, res)
  assert.equal(res.code, 403)
  assert.equal(state.poolQueries, 0)
})
test('MCP denies inaccessible requested boards before resolving people', async () => {
  reset()
  const res = await GET(new NextRequest('http://localhost/api/mcp/tasks/search?q=from:valentin&board_id=8'))
  assert.equal(res.status, 403)
  assert.equal(state.poolQueries, 0)
})
