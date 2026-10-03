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
    return row[field] !== null && (kind === 'equals' ? text === needle.toLowerCase() : kind === 'startsWith' ? text.startsWith(needle) : text.includes(needle))
  }
  if (filter.id?.in) return filter.id.in.includes(row.id)
  if (filter.id !== undefined) return filter.id === row.id
  return true // Board visibility is asserted separately below.
}
const query = (rows, args) => rows.filter((row) => matches(row, args.where))
  .sort((a, b) => {
    for (const order of args.orderBy ?? []) {
      const field = Object.keys(order)[0]
      const comparison = (a[field] ?? '').toString().localeCompare((b[field] ?? '').toString())
      if (comparison) return order[field] === 'desc' ? -comparison : comparison
    }
    return 0
  }).slice(0, args.take)
const mocks = new Map([
  ['src/lib/auth/getSessionUser.ts', { getSessionUser: async () => state.session }],
  ['src/lib/flags.ts', { HTPR_6369_SEARCH_OPERATORS_FLAG: 'htpr-6369-search-operators', HTPR_6370_SEARCH_CHIPS_FLAG: 'htpr-6370-search-chips', HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG: 'htpr-6688-search-autocomplete', HTPR_6865_SEARCH_LAYOUT_FLAG: 'htpr-6865-search-layout', HTPR_6878_SEARCH_LABEL_SCOPE_FLAG: 'htpr-6878-search-label-scope', isFeatureEnabled: async (key) => key === 'htpr-6878-search-label-scope' ? false : key === 'htpr-6370-search-chips' ? state.chipsFlag : key === 'htpr-6865-search-layout' ? state.layoutFlag : key === 'htpr-6688-search-autocomplete' ? state.autocompleteFlag : state.flag }],
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
    task: { findMany: async (args) => {
      assert.deepEqual(args.where.projectId.in, [7])
      return (state.recentTasks ?? []).slice(0, args.take)
    } },
    assignees: { findMany: async (args) => {
      assert.deepEqual(args.where.task.projectId.in, [7])
      return (state.recentAssignees ?? []).slice(0, args.take)
    } },
    user: { findMany: async (args) => {
      state.peopleQueries.push(args)
      const scope = args.where.AND?.[0] ?? args.where
      state.peopleScope = scope.OR[0].members?.some.projectId ?? scope.OR[0].tasks.some.projectId.in
      state.recentScope = scope.OR[0].tasks?.some.createdAt
      return query(state.people, args)
    }, findFirst: async (args) => {
      state.peopleQueries.push(args)
      return query(state.people, { ...args, take: 1 })[0] ?? null
    } },
  } }],
])
for (const [file, exports] of mocks) {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false, interopDefault: true })
const handler = jiti(path.join(root, 'src/pages/api/search/values.ts')).default
const person = (id, name) => ({ id, displayName: name, email: `${id}@example.com`, members: [{ projectId: 7 }], tasks: [], assignees: [] })
async function lookup(operator, value, overrides = {}) {
  state = { session: { userId: 6 }, flag: true, chipsFlag: false, people: [], labels: [], labelQueries: [], peopleQueries: [], ...overrides }
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  await handler({ method: 'GET', headers: {}, query: { operator, value, ...(overrides.resolve ? { resolve: overrides.resolve } : {}), ...(overrides.noBoard ? {} : { boardId: '7' }) } }, res)
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
test('chip suggestions rank prefix, substring, then fuzzy across accessible boards', async () => {
  const { res } = await lookup('from', 'kml', { chipsFlag: true, people: [
    person(1, 'Kamil'), person(2, 'Kml Smith'), person(3, 'Akml Name'),
  ] })
  assert.deepEqual(res.body.candidates.map((row) => row.id), [2, 3, 1])
  assert.equal((await lookup('label', 'bug', { chipsFlag: true, labels: [
    { id: 'a', value: 'Bugs', projectId: 7 },
    { id: 'b', value: 'Debug', projectId: 7 },
    { id: 'c', value: 'Build good', projectId: 7 },
  ] })).res.body.candidates.map((row) => row.id).join(','), 'a,b,c')
})
test('raw-tail hydration resolves the longest accessible name beyond ten suggestions', async () => {
  const people = Array.from({ length: 12 }, (_, i) => person(i + 1, `Kamil ${String(i).padStart(2, '0')}`))
  people.push(person(99, 'Kamil Grzegorzewicz'))
  const { res, state: snapshot } = await lookup('from', 'Kamil', {
    chipsFlag: true, people, resolve: 'Kamil Grzegorzewicz login',
  })
  assert.equal(res.body.candidates.length, 10)
  assert.ok(!res.body.candidates.some((row) => row.id === 99))
  assert.equal(res.body.resolved, 'Kamil Grzegorzewicz')
  assert.equal(snapshot.peopleQueries.at(-1).where.AND[1].OR[0].displayName.equals, 'Kamil Grzegorzewicz login')
})
test('raw-tail hydration prefers the longest exact person even with duplicate short names', async () => {
  const people = [person(1, 'Kamil'), person(2, 'Kamil'), person(3, 'Kamil'), person(4, 'Kamil Grzegorzewicz')]
  const { res } = await lookup('from', 'Kamil', { chipsFlag: true, people, resolve: 'Kamil Grzegorzewicz login' })
  assert.equal(res.body.resolved, 'Kamil Grzegorzewicz')
})
test('hydration finds the longest accessible name beyond twelve duplicate short names', async () => {
  const people = [...Array.from({ length: 130 }, (_, i) => person(i + 1, 'Kamil')), person(99, 'Kamil Grzegorzewicz')]
  const { res } = await lookup('from', 'Kamil', { chipsFlag: true, people, resolve: 'Kamil Grzegorzewicz login' })
  assert.equal(res.body.resolved, 'Kamil Grzegorzewicz')
})
test('label hydration returns the selected ID only within visible boards', async () => {
  const { res } = await lookup('label', 'duplicate', {
    chipsFlag: true, labels: [{ id: 'label-7', value: 'Duplicate', projectId: 7 }], resolve: 'label-7 login',
  })
  assert.equal(res.body.resolved, 'Duplicate')
  assert.equal(res.body.resolvedId, 'label-7')
})
test('recent fuzzy people appear only once even when present in both sources', async () => {
  const { res } = await lookup('from', 'kml', { chipsFlag: true,
    people: [person(1, 'Kamil')], recentTasks: [{ userId: 1 }],
  })
  assert.deepEqual(res.body.candidates, [{ id: 1, name: 'Kamil' }])
})
test('person hydration uses one bounded exact-name query for a long tail', async () => {
  const { state: snapshot } = await lookup('from', 'Kamil', {
    chipsFlag: true, people: [person(1, 'Kamil')], resolve: `${'a '.repeat(49)}Kamil`,
  })
  const exact = snapshot.peopleQueries.filter((args) => JSON.stringify(args.where).includes('equals'))
  assert.equal(exact.length, 1)
  assert.ok(exact[0].where.AND[1].OR.length <= 20)
})
test('fuzzy labels filter query letters before the alphabetical cap', async () => {
  const labels = Array.from({ length: 500 }, (_, i) => ({ id: i, value: `A${String(i).padStart(3, '0')}`, projectId: 7 }))
  labels.push({ id: 501, value: 'Build good', projectId: 7 })
  const { res, state: snapshot } = await lookup('label', 'bug', { chipsFlag: true, labels })
  assert.deepEqual(res.body.candidates, [{ id: 501, name: 'Build good' }])
  assert.equal(snapshot.labelQueries.at(-1).where.AND.length, 3)
})
test('recent collaborator beats the alphabetical cap and fuzzy scans are name-filtered', async () => {
  const people = Array.from({ length: 130 }, (_, i) => person(i + 1, `Alice ${String(i).padStart(3, '0')}`))
  people.push({ ...person(999, 'Zack'), tasks: [{ createdAt: new Date() }] })
  const { res, state: snapshot } = await lookup('from', '', { chipsFlag: true, people, recentTasks: [{ userId: 999 }] })
  assert.equal(res.body.candidates[0].id, 999)
  assert.equal(snapshot.peopleQueries[0].where.AND[1].id.in[0], 999)
  const fuzzy = await lookup('from', 'zck', { chipsFlag: true, people, recentTasks: [{ userId: 999 }] })
  assert.equal(fuzzy.res.body.candidates[0].id, 999)
  assert.equal(fuzzy.state.peopleQueries.at(-1).where.AND[1].OR[0].displayName.contains, 'z')
})
test('lookup requires authorization and feature flag', async () => {
  assert.equal((await lookup('from', 'a', { session: null })).res.statusCode, 401)
  assert.equal((await lookup('from', 'a', { flag: false })).res.statusCode, 404)
})

test('layout people emails require every flag and retain session-scoped authorization', async () => {
  for (const operator of ['from', 'assignee']) {
    const { res } = await lookup(operator, 'mal', { chipsFlag: true, layoutFlag: true, autocompleteFlag: true, people: [person(77, 'Malcolm Stern')] })
    assert.deepEqual(res.body.candidates, [{ id: 77, name: 'Malcolm Stern', email: '77@example.com' }])
    for (const disabled of ['chipsFlag', 'layoutFlag', 'autocompleteFlag']) {
      const off = await lookup(operator, 'mal', { chipsFlag: true, layoutFlag: true, autocompleteFlag: true, [disabled]: false, people: [person(77, 'Malcolm Stern')] })
      assert.deepEqual(off.res.body.candidates, [{ id: 77, name: 'Malcolm Stern' }])
    }
  }
  for (const operator of ['label', 'in', 'board']) {
    const { res } = await lookup(operator, '', { chipsFlag: true, layoutFlag: true, autocompleteFlag: true, labels: [{ id: 'bug', value: 'Bug', projectId: 7 }] })
    assert.ok(res.body.candidates.every((row) => !('email' in row)))
  }
  assert.equal((await lookup('from', 'mal', { session: null, layoutFlag: true })).res.statusCode, 401)
  assert.equal((await lookup('from', 'mal', { flag: false, layoutFlag: true })).res.statusCode, 404)
})
