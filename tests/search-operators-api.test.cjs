const assert = require('node:assert/strict')
const path = require('node:path')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
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
  if (where.taskLabels && !where.taskLabels.some.label.OR.some((label) =>
    label.id === row.label || label.value?.equals?.toLowerCase() === row.label ||
    row.taskLabels?.some((link) => label.id === link.label.id || label.value?.equals?.toLowerCase() === link.label.value.toLowerCase()))) return false
  if (where.project && row.project.title.toLowerCase() !== where.project.title.equals.toLowerCase()) return false
  return true
}
const db = {
  project: { findMany: async ({ select }) => select.title
    ? [{ title: 'Visible board' }] : state.boards.map((id) => ({ id })) },
  label: { findMany: async () => { state.labelQueries++; return state.labels ?? [{ value: 'bug' }] } },
  user: { findMany: async () => [{ displayName: 'Kamil Grzegorzewicz' }] },
  section: { findMany: async ({ where }) => (state.sections ?? [{ projectId: 7, section_title: 'Done', isDone: true }])
    .filter((section) => where.deleted !== false || !section.deleted) },
  task: { findMany: async ({ where, select, take }) => {
    state.where = where
    state.selects.push(select)
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
    HTPR_6372_SEARCH_RANKING_FLAG: 'htpr-6372-search-ranking',
    HTPR_6878_SEARCH_LABEL_SCOPE_FLAG: 'htpr-6878-search-label-scope',
    HTPR_6880_SEARCH_COMMENTER_FLAG: 'htpr-6880-search-commenter',
    HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG: 'htpr-6882-search-match-highlights',
    HTPR_6865_SEARCH_LAYOUT_FLAG: 'htpr-6865-search-layout',
    HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG: 'htpr-6688-search-autocomplete',
    HTPR_6370_SEARCH_CHIPS_FLAG: 'htpr-6370-search-chips',
    isFeatureEnabled: async (key) => key === 'htpr-6881-search-fuzzy-person' ? false
      : key === 'htpr-6878-search-label-scope' ? state.labelFlag ?? false
      : key === 'htpr-6882-search-match-highlights' ? state.matchFlag
      : key === state.disabledFlag ? false : state.flag,
  }],
  ['src/utils/controllers/projects/getAllIncludes.ts', {
    projectContentAccessWhere: (userId) => ({ ownerId: userId }),
  }],
  ['src/utils/controllers/turbopuffer/turbopufferHelper.ts', {
    searchPreviewText: (text) => text,
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
    userId: 6, user: { displayName: 'Kamil Grzegorzewicz' },
    assignees: [{ userId: 6, user: { displayName: 'Kamil Grzegorzewicz' } }], section: 'Done',
    status: 'Normal', ticketNumber: `HTPR-${id}`, uniqueIndex: id,
    project: { title: projectId === 7 ? 'Visible board' : 'Private' }, updatedAt: new Date('2026-09-01') }
}
async function search(searchQuery, overrides = {}) {
  state = { flag: true, session: { userId: 6 }, boards: [7], rows: [row(123), row(8, 8)],
    taskHits: [], commentHits: [], windows: [], commentWindows: [], legacyCalls: 0, labelQueries: 0, selects: [], matchFlag: false, ...overrides }
  const res = response()
  await handler({ method: 'POST', headers: {}, body: {
    searchQuery, projectIds: overrides.requested ?? [7], archive: null,
  } }, res)
  return { res, state }
}

for (const [operator, value, fragment] of [
  ['from', '6', 'userId'], ['assignee', '@Kamil Grzegorzewicz', 'assignees'],
  ['in', 'Visible board', 'project'], ['board', '7', 'projectId'],
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

test('from and assignee match the email shown for a user without a display name', async () => {
  const person = { displayName: null, email: 'kamila@example.com' }
  const task = { ...row(123), userId: 4, user: person, assignees: [{ userId: 4, user: person }] }
  for (const operator of ['from', 'assignee']) {
    const { res } = await search(`${operator}:kamila@example.com`, { rows: [task], matchFlag: true })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body.processedData.All.map((item) => item.taskId), [123])
    assert.deepEqual(res.body.processedData.All[0].searchMatch.people, ['kamila@example.com'])
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
    assert.match(source, new RegExp(`searchOperatorsEnabled\\s*\\? \\{ searchProjectIds: \\[\\], processedSearchTerm: ${term}, archive: defaultSearchArchiveStatus\\(showArchived\\) \\}\\s*: searchBoards\\(${term}, showArchived${term === 'searchTerm' ? ', searchProjects' : ''}\\)`))
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

test('match highlights fetch names in the existing query and show only positively matched people, labels and boards', async () => {
  const task = { ...row(123), taskLabels: [{ label: { id: 'bug-id', value: 'Bug' } }, { label: { id: 'other', value: 'Other' } }],
    assignees: [...row(123).assignees, { userId: 9, user: { displayName: 'Unmatched', email: 'other@example.test' } }] }
  for (const [query, expected] of [
    ['from:6', { people: ['Kamil Grzegorzewicz'], labels: [] }],
    ['assignee:6', { people: ['Kamil Grzegorzewicz'], labels: [] }],
    ['from:6 assignee:9', { people: ['Kamil Grzegorzewicz', 'Unmatched'], labels: [] }],
    ['assignee:"@Kamil Grzegorzewicz"', { people: ['Kamil Grzegorzewicz'], labels: [] }],
    ['label:bug-id', { people: [], labels: ['Bug'] }],
    ['label:bug', { people: [], labels: ['Bug'] }],
    ['in:7', { people: [], labels: [], board: 'Visible board' }],
    ['board:"Visible board"', { people: [], labels: [], board: 'Visible board' }],
    ['-from:9 -assignee:10 -label:nope -in:8', { people: [], labels: [] }],
  ]) {
    const { res, state } = await search(query, { rows: [task], matchFlag: true })
    assert.equal(res.statusCode, 200, query)
    assert.deepEqual(res.body.processedData.All[0].searchMatch, expected, query)
    assert.equal(state.selects.length, 1, 'no per-row query')
    assert.deepEqual(state.selects[0].assignees.select.user.select, { displayName: true, email: true })
  }
})

test('label scope and match highlights work independently in every flag combination', async () => {
  const labels = [{ id: 'padded-bug', value: ' Bug ' }, { id: 'plain-bug', value: 'Bug' }]
  const rows = labels.map((label, index) => ({ ...row(123 + index, 7, label.id), taskLabels: [{ label }] }))
  for (const labelFlag of [false, true]) {
    for (const matchFlag of [false, true]) {
      const { res } = await search('label:bug', { labels, rows, labelFlag, matchFlag })
      assert.equal(res.statusCode, 200)
      const results = res.body.processedData.All
      assert.deepEqual(results.map((task) => task.taskId), labelFlag ? [123, 124] : [124])
      assert.deepEqual(results.map((task) => task.searchMatch?.labels), matchFlag ? (labelFlag ? [[' Bug '], ['Bug']] : [['Bug']]) : results.map(() => undefined))
    }
  }
})

test('filtered comment-only matches preserve the actual comment author and snippet only when enabled', async () => {
  const commentHits = [{ id: '44', taskId: '123', commentText: 'webhook failed', creatorName: 'Comment Writer' }]
  const on = await search('webhook from:6', { commentHits, matchFlag: true })
  assert.equal(on.res.body.processedData.All[0].commentId, 44)
  assert.equal(on.res.body.processedData.All[0].commentText, 'webhook failed')
  assert.equal(on.res.body.processedData.All[0].searchMatch.commentAuthor, 'Comment Writer')
  const off = await search('webhook from:6', { commentHits })
  assert.equal(off.res.body.processedData.All[0].commentId, undefined)
})

test('match flag and every layout prerequisite off preserve legacy response bytes and do not select names', async () => {
  const baseline = JSON.stringify((await search('from:6')).res.body)
  for (const disabledFlag of ['htpr-6865-search-layout', 'htpr-6688-search-autocomplete', 'htpr-6370-search-chips']) {
    const { res, state } = await search('from:6', { matchFlag: true, disabledFlag })
    assert.equal(JSON.stringify(res.body), baseline)
    assert.equal(state.selects[0].user, undefined)
    assert.equal(state.selects[0].assignees, undefined)
    assert.equal(state.selects[0].taskLabels, undefined)
  }
})
