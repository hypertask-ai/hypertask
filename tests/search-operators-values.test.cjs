const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
let state
const matches = (row, filter) => {
  if (filter.AND) return filter.AND.every((part) => matches(row, part))
  if (filter.NOT) return !matches(row, filter.NOT)
  if (filter.OR) return filter.OR.some((part) => matches(row, part))
  for (const field of ['value', 'displayName', 'email']) {
    if (!(field in filter)) continue
    if (filter[field] === null || typeof filter[field] === 'string') return row[field] === filter[field]
    const [kind, needle] = Object.entries(filter[field]).find(([key]) => key !== 'mode')
    const text = (row[field] ?? '').toLowerCase()
    return row[field] !== null && (kind === 'startsWith' ? text.startsWith(needle) : text.includes(needle))
  }
  return true // Board visibility is asserted separately below.
}
const query = (rows, args) => rows.filter((row) => matches(row, args.where))
  .sort((a, b) => {
    for (const order of args.orderBy ?? []) {
      const field = Object.keys(order)[0]
      const comparison = (a[field] ?? '').toString().localeCompare((b[field] ?? '').toString())
      if (comparison) return comparison
    }
    return 0
  }).slice(0, args.take)
const mocks = new Map([
  ['src/lib/auth/getSessionUser.ts', { getSessionUser: async () => state.session }],
  ['src/lib/flags.ts', { HTPR_6369_SEARCH_OPERATORS_FLAG: 'htpr-6369-search-operators', isFeatureEnabled: async () => state.flag }],
  ['src/utils/controllers/projects/getAllIncludes.ts', { getProjectWhere: (id) => ({ ownerId: id }) }],
  ['src/lib/prisma.ts', { default: {
    project: { findMany: async ({ where }) => {
      assert.equal(where.ownerId, 6)
      return [{ id: 7, title: 'Visible' }]
    } },
    label: { findMany: async (args) => {
      state.labelQueries.push(args)
      assert.deepEqual(args.where.projectId.in, [7])
      return query(state.labels, args)
    } },
    user: { findMany: async (args) => {
      state.peopleQueries.push(args)
      const scope = args.where.AND?.[0] ?? args.where
      state.peopleScope = scope.OR[0].members?.some.projectId ?? scope.OR[0].tasks.some.projectId.in
      state.recentScope = scope.OR[0].tasks?.some.createdAt
      return query(state.people, args)
    } },
  } }],
])
mocks.get('src/lib/flags.ts').HTPR_6370_SEARCH_CHIPS_FLAG = 'htpr-6370-search-chips'
mocks.get('src/lib/flags.ts').isFeatureEnabled = async (key) => key !== 'htpr-6370-search-chips' && state.flag
for (const [file, exports] of mocks) {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false, interopDefault: true })
const handler = jiti(path.join(root, 'src/pages/api/search/values.ts')).default
const person = (id, name) => ({ id, displayName: name, email: `${id}@example.com`, members: [{ projectId: 7 }], tasks: [], assignees: [] })
async function lookup(operator, value, overrides = {}) {
  state = { session: { userId: 6 }, flag: true, people: [], labels: [], labelQueries: [], peopleQueries: [], ...overrides }
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  await handler({ method: 'GET', headers: {}, query: { operator, value, ...(overrides.noBoard ? {} : { boardId: '7' }) } }, res)
  return { res, state }
}
test('lookup filters before capping 100 visible labels and people', async () => {
  const people = Array.from({ length: 150 }, (_, i) => person(i + 1, `Alice ${String(i).padStart(3, '0')}`))
  people.push(person(999, 'Zoe'))
  const labels = Array.from({ length: 150 }, (_, i) => ({ id: `a-${i}`, value: `Alpha ${i}`, projectId: 7 }))
  labels.push({ id: 'zebra', value: 'Zebra', projectId: 7 })
  const assignee = await lookup('assignee', 'zoe', { people })
  assert.deepEqual(assignee.res.body.candidates, [{ id: 999, name: 'Zoe' }])
  assert.equal(assignee.state.peopleScope, 7)
  assert.equal(assignee.state.peopleQueries[0].take, 100)
  assert.equal(assignee.state.peopleQueries[1].take, 99)
  assert.ok(assignee.state.peopleQueries[0].orderBy)
  const label = await lookup('label', 'zebra', { labels })
  assert.deepEqual(label.res.body.candidates, [{ id: 'zebra', name: 'Zebra' }])
  assert.equal(label.state.labelQueries[0].take, 100)
  assert.ok(label.state.labelQueries[0].orderBy)
  const contains = await lookup('label', 'zebra', { labels: [
    ...labels.slice(0, -1), { id: 'mid-zebra', value: 'Needs Zebra', projectId: 7 },
  ] })
  assert.deepEqual(contains.res.body.candidates, [{ id: 'mid-zebra', name: 'Needs Zebra' }])
  assert.equal(contains.state.labelQueries[1].where.AND[0].value.contains, 'zebra')
})
test('empty assignee lookup includes people past the unordered first 100', async () => {
  const people = Array.from({ length: 150 }, (_, i) => person(i + 1, `Zoe ${String(i).padStart(3, '0')}`))
  const { res, state: snapshot } = await lookup('assignee', '', { people })
  assert.equal(res.body.candidates.length, 10)
  assert.equal(snapshot.peopleQueries.length, 1)
  assert.equal(snapshot.peopleQueries[0].where.AND[1].OR[0].displayName.startsWith, '')
})
test('prefixes rank ahead of contains matches and email fallback works', async () => {
  const { res, state: snapshot } = await lookup('from', 'kam', { noBoard: true, people: [
    person(2, 'Kamil'), person(3, 'Akamil'),
    { ...person(4, null), email: 'kamila@example.com' },
  ] })
  assert.ok(snapshot.recentScope.gte instanceof Date)
  assert.deepEqual(res.body.candidates.map((item) => item.id), [2, 4, 3])
})
test('lookup requires authorization and feature flag', async () => {
  assert.equal((await lookup('from', 'a', { session: null })).res.statusCode, 401)
  assert.equal((await lookup('from', 'a', { flag: false })).res.statusCode, 404)
})
