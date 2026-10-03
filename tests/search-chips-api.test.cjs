const assert = require('node:assert/strict')
const path = require('node:path')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const { Prisma } = require('@prisma/client')
const root = path.resolve(__dirname, '..')
test('chip server reuses the operators name resolver instead of duplicating database lookups', () => {
  const source = readFileSync(path.join(root, 'src/lib/search/serverOperators.ts'), 'utf8')
  assert.equal((source.match(/export async function parseSearchWithNames\(/g) ?? []).length, 1)
  assert.match(source, /await parseSearchWithNames\(/)
})
let state
function eligible(row, where) {
  if (where.projectId && !(where.projectId.in ?? [where.projectId]).includes(row.projectId)) return false
  if (where.id?.in && !where.id.in.includes(row.id)) return false
  if (where.status && !(where.status.in ?? [where.status]).includes(row.status)) return false
  if (where.section && where.section !== row.section) return false
  if (where.user && !eligible(row.user, where.user)) return false
  if (where.assignees?.some && !row.assignees?.some((assignee) => eligible(assignee, where.assignees.some))) return false
  if (where.userId && where.userId !== row.userId) return false
  if (where.displayName?.equals && row.displayName?.toLowerCase() !== where.displayName.equals.toLowerCase()) return false
  if (where.email?.equals && row.email?.toLowerCase() !== where.email.equals.toLowerCase()) return false
  if (where.AND && !where.AND.every((group) => eligible(row, group))) return false
  if (where.OR && !where.OR.some((group) => eligible(row, group))) return false
  if (where.NOT && eligible(row, where.NOT)) return false
  if (where.comments?.some && !row.comments?.some((comment) => eligible(comment, where.comments.some))) return false
  if (where.activity?.equals === Prisma.DbNull && row.activity !== null) return false
  if (where.taskLabels && !where.taskLabels.some.label.OR.some((label) =>
    label.id === row.label || label.value?.equals?.toLowerCase() === row.label)) return false
  if (where.project && row.project.title.toLowerCase() !== where.project.title.equals.toLowerCase()) return false
  return true
}
const db = {
  project: { findMany: async ({ select }) => select.title
    ? [{ title: 'Visible board' }] : state.boards.map((id) => ({ id })) },
  label: { findMany: async ({ where }) => { state.labelQueries++; return [{ value: 'bug' }, { value: 'needs design' }].filter(({ value }) => value.startsWith(where.value.startsWith.toLowerCase())) } },
  user: { findMany: async () => [{ displayName: 'Kamil Grzegorzewicz' }] },
  section: { findMany: async ({ where }) => (state.sections ?? [{ projectId: 7, section_title: 'Done', isDone: true }])
    .filter((section) => where.deleted !== false || !section.deleted) },
  task: { findMany: async ({ where, select, take }) => {
    state.where = where
    const rows = state.rows.filter((row) => eligible(row, where))
    return (take ? rows.slice(0, take) : rows).map((row) => select.id && Object.keys(select).length === 1 ? { id: row.id } : row)
  } },
}
const mocks = new Map([
  ['src/lib/auth/getSessionUser.ts', { getSessionUser: async () => state.session }],
  ['src/lib/prisma.ts', { default: db }],
  ['src/lib/flags.ts', {
    HTPR_6881_SEARCH_FUZZY_PERSON_FLAG: 'htpr-6881-search-fuzzy-person',
    HTPR_6369_SEARCH_OPERATORS_FLAG: 'htpr-6369-search-operators',
    HTPR_6370_SEARCH_CHIPS_FLAG: 'htpr-6370-search-chips',
    HTPR_6372_SEARCH_RANKING_FLAG: 'htpr-6372-search-ranking',
    HTPR_6878_SEARCH_LABEL_SCOPE_FLAG: 'htpr-6878-search-label-scope',
    isFeatureEnabled: async (key) => ['htpr-6878-search-label-scope', 'htpr-6881-search-fuzzy-person'].includes(key) ? false : key === 'htpr-6370-search-chips' ? state.chipsFlag ?? state.flag : state.flag,
  }],
  ['src/utils/controllers/projects/getAllIncludes.ts', {
    projectContentAccessWhere: (userId) => ({ ownerId: userId }),
  }],
  ['src/utils/controllers/turbopuffer/turbopufferHelper.ts', {
    convertToPlain: (text) => text,
    searchTasks: async ({ topK }) => { state.windows.push(topK); return state.taskHits.slice(0, topK) },
    searchComments: async ({ limit }) => { state.commentWindows.push(limit); return state.commentHits.slice(0, limit) },
  }],
  ['src/utils/controllers/search/document.ts', {
    turbopufferGetDocuments: async () => { state.legacyCalls++; return { status: 200 } },
  }],
])
for (const [file, exports] of mocks) {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false, interopDefault: true })
const handler = jiti(path.join(root, 'src/pages/api/search/document.ts')).default
function response() {
  return { statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}
function row(id, projectId = 7, label = 'bug') {
  return { id, projectId, label, title: 'Cleanup', description: '', description_: { content: 'zebra-quark' },
    comments: [{ creatorId: 6, activity: null }],
    userId: 6, user: { displayName: 'Kamil Grzegorzewicz' },
    assignees: [{ userId: 6, user: { displayName: 'Kamil Grzegorzewicz' } }], section: 'Done',
    status: 'Normal', ticketNumber: `HTPR-${id}`, uniqueIndex: id,
    project: { title: projectId === 7 ? 'Visible board' : 'Private' }, updatedAt: new Date('2026-09-01') }
}
async function search(searchQuery, overrides = {}) {
  state = { flag: true, session: { userId: 6 }, boards: [7], rows: [row(123), row(8, 8)],
    taskHits: [], commentHits: [], windows: [], commentWindows: [], legacyCalls: 0, labelQueries: 0, ...overrides }
  const res = response()
  await handler({ method: 'POST', headers: {}, body: {
    searchQuery, projectIds: overrides.requested ?? [7], archive: null,
  } }, res)
  return { res, state }
}

for (const [operator, value, fragment] of [
  ['from', '6', 'userId'], ['assignee', '@Kamil Grzegorzewicz', 'assignees'],
  ['in', 'Visible board', 'project'], ['in', '#Visible board', 'project'], ['board', '7', 'projectId'],
  ['label', 'needs design', 'taskLabels'], ['is', 'done', 'Done'],
  ['before', '2026-09-02', 'createdAt'], ['after', '2026-09-01', 'createdAt'],
  ['on', 'updated:2026-09-01', 'updatedAt'],
  ['has', 'attachment', 'attachments'], ['has', 'comment', 'comments'],
  ['has', 'due', 'dueDate'],
]) {
  test(`${operator}:${value} narrows a scoped API query`, async () => {
    const { res, state } = await search(`${operator}:"${value}"`,
      operator === 'label' ? { rows: [row(123, 7, 'needs design'), row(8, 8)] } : {})
    assert.equal(res.statusCode, 200)
    assert.deepEqual(state.where.projectId, { in: [7] })
    assert.match(JSON.stringify(state.where.AND), new RegExp(fragment))
    assert.deepEqual(state.windows, [])
    assert.deepEqual(res.body.processedData.All.map((task) => task.taskId), [123])
  })
}

test('has:comment excludes activity-only tickets, including automatic entries attributed to users or agents', async () => {
  const activity = { creatorId: null, activity: { type: 'TaskMove', data: { fromUserId: 6 } } }
  const rows = [
    row(123),
    { ...row(6616), comments: [activity] },
    { ...row(124), comments: [{ ...activity, creatorId: 6 }] },
    { ...row(125), comments: [{ ...activity, agentId: 'bot', activity: { type: 'TaskPullRequest' } }] },
    { ...row(126), comments: [], agentRuns: [{ activities: [{ type: 'ACTION', text: 'search progress' }] }] },
    { ...row(127), comments: [activity, { creatorId: 6, activity: null }] },
    { ...row(128), comments: [{ creatorId: 6, agentId: 'bot', activity: null }] },
    row(129, 8),
  ]
  for (const query of ['has:comment', 'has:comment search', '-has:comment search']) {
    const { res, state } = await search(query, {
      rows, taskHits: rows.map(({ id }) => ({ id: String(id), descriptionText: 'search' })),
    })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body.processedData.All.map((task) => task.taskId),
      query.startsWith('-') ? [6616, 124, 125, 126] : [123, 127, 128], query)
    const predicate = query.startsWith('-') ? state.where.AND[0].NOT : state.where.AND[0].OR[0]
    assert.deepEqual(predicate, { comments: { some: { activity: { equals: Prisma.DbNull } } } })
  }
  const off = await search('has:comment search', { rows, flag: false })
  assert.equal(off.state.legacyCalls, 1)
  assert.equal(off.state.where, undefined)
})

test('from and assignee match the email shown for a user without a display name', async () => {
  const person = { displayName: null, email: 'kamila@example.com' }
  const task = { ...row(123), userId: 4, user: person, assignees: [{ userId: 4, user: person }] }
  for (const operator of ['from', 'assignee']) {
    const { res } = await search(`${operator}:kamila@example.com`, { rows: [task] })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body.processedData.All.map((item) => item.taskId), [123])
  }
})

test('is:open ignores soft-deleted done columns with the same title as a live open column', async () => {
  const sections = [
    { projectId: 7, section_title: 'shipped', isDone: false, deleted: false },
    { projectId: 7, section_title: 'shipped', isDone: null, deleted: true },
  ]
  const { res, state } = await search('is:open', { rows: [{ ...row(123), section: 'shipped' }], sections })
  assert.equal(res.statusCode, 200, JSON.stringify(state.where))
  assert.deepEqual(res.body.processedData.All.map((task) => task.taskId), [123])
})

test('label:bug login leaves login as text and matches only visible labelled tasks', async () => {
  const { res, state } = await search('label:bug login', {
    taskHits: [{ id: '8', descriptionText: '' }, { id: '123', descriptionText: 'login details' }],
  })
  assert.deepEqual(state.windows, [100])
  assert.deepEqual(res.body.processedData.All.map((task) => task.taskId), [123])
  assert.equal(res.body.processedData.All[0].descriptionText, 'login details')
})

test('description match beyond first 200 engine hits is returned, not inferred from SQL text', async () => {
  const taskHits = Array.from({ length: 240 }, (_, i) => ({ id: String(1000 + i), descriptionText: 'zebra-quark' }))
  taskHits.push({ id: '123', descriptionText: 'zebra-quark' })
  const { res, state } = await search('zebra-quark label:bug', { taskHits })
  assert.deepEqual(state.windows, [100, 200, 400])
  assert.deepEqual(res.body.processedData.All.map((task) => task.taskId), [123])
  assert.equal(res.body.processedData.All[0].descriptionText, 'zebra-quark')
})

test('comment-only text hit beyond first 200 comments is returned', async () => {
  const commentHits = Array.from({ length: 240 }, (_, i) => ({ taskId: String(1000 + i) }))
  commentHits.push({ taskId: '123' })
  const { res, state } = await search('webhook label:bug', { commentHits })
  assert.deepEqual(state.commentWindows, [100, 200, 400])
  assert.deepEqual(res.body.processedData.All.map((task) => task.taskId), [123])
})

test('rare filters stop after bounded windows and expose a partial result', async () => {
  const taskHits = Array.from({ length: 5000 }, (_, i) => ({ id: String(1000 + i), descriptionText: '' }))
  const { res, state } = await search('zebra label:bug', { taskHits, rows: [] })
  assert.equal(res.statusCode, 204)
  assert.equal(res.body.partial, true)
  assert.deepEqual(state.windows, [100, 200, 400, 800])
})

test('repeated prefixes are looked up once; oversized flagged queries are rejected', async () => {
  const repeated = await search('label:BUG label:bug label:BUG')
  assert.equal(repeated.state.labelQueries, 1)
  const clauses = await search('label:bug '.repeat(13))
  assert.equal(clauses.res.statusCode, 400)
  assert.equal(clauses.state.labelQueries, 0)
  assert.equal((await search('a'.repeat(201))).res.statusCode, 400)
  const flagOff = await search('a'.repeat(201), { flag: false })
  assert.equal(flagOff.state.legacyCalls, 1)
})

test('unquoted board names with # resolve to the accessible board', async () => {
  const { res } = await search('in:#Visible board')
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.processedData.All.map((task) => task.taskId), [123])
})
test('chip parsing retains resolved unquoted people and labels instead of searching their trailing words', async () => {
  for (const query of ['from:Kamil Grzegorzewicz', 'assignee:@Kamil Grzegorzewicz', 'label:needs design']) {
    const { res, state } = await search(query, { rows: [row(123, 7, 'needs design')] })
    assert.equal(res.statusCode, 200, query)
    assert.deepEqual(res.body.processedData.All.map((task) => task.taskId), [123], query)
    assert.deepEqual(state.windows, [], `${query} must not search the rest of the name as text`)
  }
})
test('hash board marker is inert on the server while the chips flag is off', async () => {
  const off = await search('in:#Visible board', { chipsFlag: false })
  assert.equal(off.res.statusCode, 204)
  const on = await search('in:#Visible board', { chipsFlag: true })
  assert.equal(on.res.statusCode, 200)
})
test('in:8 never widens the accessible-board scope even with a private row in the DB', async () => {
  const { res } = await search('in:8')
  assert.equal(res.statusCode, 204)
  assert.deepEqual(res.body.processedData.All, [])
  assert.equal((await search('in:8', { requested: [7, 8] })).res.statusCode, 403)
})

test('flag off preserves legacy behavior and rejects operator-only query', async () => {
  const { res, state } = await search('label:bug', { flag: false })
  assert.equal(res.statusCode, 200)
  assert.equal(state.legacyCalls, 1)
  assert.equal((await search('', { flag: false })).res.statusCode, 400)
})

test('web posts the untouched input in both search flows only when operators are enabled', () => {
  const source = readFileSync(path.join(root, 'src/hooks/Search/useSearch.ts'), 'utf8')
  assert.match(source, /useFlag\(HTPR_6369_SEARCH_OPERATORS_FLAG\)/)
  for (const term of ['_searchTerm', 'searchTerm']) {
    assert.match(source, new RegExp(`searchOperatorsEnabled\\s*\\? \\{ searchProjectIds: \\[\\], processedSearchTerm: ${term}, archive: defaultSearchArchiveStatus\\(showArchived\\) \\}\\s*: searchBoards\\(${term}, showArchived\\)`))
  }
  assert.equal(source.match(/searchQuery: processedSearchTerm/g)?.length, 2)
})

test('local fixture times filtered query against flag-off search path', async () => {
  const taskHits = [...Array.from({ length: 240 }, (_, i) => ({ id: String(i + 1000), descriptionText: 'zebra-quark' })),
    { id: '123', descriptionText: 'zebra-quark' }]
  const samples = { filtered: [], unfiltered: [] }
  for (let i = 0; i < 20; i++) {
    for (const kind of ['filtered', 'unfiltered']) {
      const start = performance.now()
      const { res } = await search(kind === 'filtered' ? 'zebra-quark label:bug' : 'zebra-quark',
        kind === 'filtered' ? { taskHits } : { flag: false })
      assert.equal(res.statusCode, 200)
      samples[kind].push(performance.now() - start)
    }
  }
  for (const kind of ['filtered', 'unfiltered']) {
    samples[kind].sort((a, b) => a - b)
    console.log(`search fixture ${kind} median of 20: ${samples[kind][10].toFixed(2)} ms`)
  }
})

test('unknown operators stay free text', async () => {
  const { state } = await search('foo:bar label:bug', { taskHits: [{ id: '123', descriptionText: '' }] })
  assert.equal(state.windows.length, 1)
})
