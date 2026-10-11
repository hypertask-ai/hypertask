const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const calls = { tasks: 0, comments: 0, taskWhere: [], groupBy: [], commentRows: null }
const mocks = new Map([
  ['src/lib/prisma.ts', { default: {
    section: { findMany: async () => [] },
    comment: { groupBy: async (args) => { calls.groupBy.push(args); return [{ taskId: 2 }] }, findFirst: async () => ({ id: 'c', taskId: 2, commentText: 'hi', text: null, createdAt: new Date(), creator: { displayName: 'A', email: 'a@x' } }) },
    task: { findMany: async (args) => { calls.taskWhere.push(args.where); return [{ id: 1 }, { id: 2 }] } },
  } }],
  ['src/utils/controllers/turbopuffer/turbopufferHelper.ts', {
    searchPreviewText: (text) => text,
    searchTasks: async () => { calls.tasks++; return [{ id: '1', descriptionText: '' }] },
    searchComments: async () => { calls.comments++; return calls.commentRows ?? [{ id: 'c', taskId: '2', commentText: 'hi', creatorName: 'A' }] },
  }],
])
for (const [file, exports] of mocks) {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') }, cache: false, interopDefault: true })
const { parseSearchQuery, SEARCH_OPERATORS, extractTextClauses, searchOperatorClauseCount } = jiti(path.join(root, 'src/lib/search/operators.ts'))
const { searchFilterWhere } = jiti(path.join(root, 'src/lib/search/filters.ts'))
const { rankedSearchWhere } = jiti(path.join(root, 'src/lib/search/rankedWhere.ts'))
const parse = (raw) => parseSearchQuery(raw, {}, false, true)

test('with the flag off nothing new is parsed', () => {
  for (const raw of ['type:comment priority:high', '"exact phrase" -word', 'bug -"a b"']) {
    const parsed = parseSearchQuery(raw)
    assert.equal(parsed.text, raw)
    assert.deepEqual(parsed.filters, {})
  }
})

test('type: and priority: are logic only and never join the visible operator list', () => {
  assert.ok(!SEARCH_OPERATORS.includes('type'))
  assert.ok(!SEARCH_OPERATORS.includes('priority'))
  assert.deepEqual(parse('login type:comment -priority:Low'), {
    text: 'login', filters: { type: [{ value: 'comment', negated: false }], priority: [{ value: 'Low', negated: true }] },
  })
  assert.deepEqual(parse('priority:"no priority"').filters.priority, [{ value: 'no priority', negated: false }])
  assert.equal(searchOperatorClauseCount('type:ticket priority:high'), 2)
})

test('exact phrases stay in the ranking text and become a clause', () => {
  assert.deepEqual(parse('fix "login page" now'), {
    text: 'fix login page now', filters: { phrase: [{ value: 'login page', negated: false }] },
  })
  assert.deepEqual(parse('"a b" label:bug').filters, {
    label: [{ value: 'bug', negated: false }], phrase: [{ value: 'a b', negated: false }],
  })
})

test('-word and -"phrase" exclude and leave the text', () => {
  assert.deepEqual(parse('login -oauth -"old page" fix'), {
    text: 'login fix', filters: { phrase: [{ value: 'oauth', negated: true }, { value: 'old page', negated: true }] },
  })
})

test('malformed input falls back to plain text', () => {
  assert.deepEqual(parse('half "open phrase'), { text: 'half "open phrase', filters: {} })
  assert.deepEqual(parse('well-known - -- -:x co-op'), { text: 'well-known - -- -:x co-op', filters: {} })
  assert.deepEqual(parse('foo"bar baz"'), { text: 'foo"bar baz"', filters: {} })
  assert.deepEqual(extractTextClauses('"" x'), { text: '"" x', clauses: [] })
  assert.equal(parse('unknown:thing').text, 'unknown:thing')
})

test('filters turn into server-side conditions', async () => {
  const where = await searchFilterWhere(parse('"login page" -oauth priority:High'), [7], 'Normal')
  const groups = where.AND
  const text = JSON.stringify(groups)
  assert.ok(text.includes('"Priority_Value":{"equals":"high","mode":"insensitive"}'))
  assert.ok(text.includes('"contains":"login page"'))
  assert.ok(groups.some((group) => group.NOT && JSON.stringify(group.NOT).includes('"contains":"oauth"')))
  const none = JSON.stringify((await searchFilterWhere(parse('priority:none'), [7], null)).AND)
  assert.ok(none.includes('"is":null') && none.includes('No Priority'))
  assert.deepEqual((await searchFilterWhere(parse('priority:bogus'), [7], null)).AND, [{ OR: [{ id: -1 }] }])
  assert.deepEqual((await searchFilterWhere(parse('type:bogus'), [7], null)).AND, [{ id: -1 }])
})

test('type: picks which candidates are ranked', async () => {
  for (const [query, tasks, comments] of [['login type:ticket', 1, 0], ['login type:comment', 0, 1], ['login -type:comment', 1, 0], ['login', 1, 1]]) {
    calls.tasks = 0
    calls.comments = 0
    const result = await rankedSearchWhere(parse(query), [7], 'Normal', 50, {}, undefined, true, false)
    assert.deepEqual([calls.tasks > 0 ? 1 : 0, calls.comments > 0 ? 1 : 0], [tasks, comments], query)
    assert.ok(Array.isArray(result.rankedIds))
  }
})

test('type: never becomes a ticket where-clause, positive or negated', async () => {
  for (const query of ['type:comment', '-type:ticket', '-type:comment', 'type:ticket']) {
    assert.deepEqual((await searchFilterWhere(parse(query), [7], 'Normal')).AND, [], query)
  }
  assert.deepEqual((await searchFilterWhere(parse('-type:ticket -type:comment'), [7], 'Normal')).AND, [{ id: -1 }])
})

test('every quoted phrase is required separately and exclusions stay separate', async () => {
  const and = (await searchFilterWhere(parse('"alpha one" "beta two" -"gamma" -delta'), [7], 'Normal')).AND
  assert.equal(and.length, 4)
  assert.ok(JSON.stringify(and[0]).includes('alpha one') && !JSON.stringify(and[0]).includes('beta two'))
  assert.ok(JSON.stringify(and[1]).includes('beta two') && !and[1].NOT)
  assert.ok(and[2].NOT && and[3].NOT)
})

test('type:ticket with commenter: does not return comment results', async () => {
  const commenterFilters = { commenter: [{ value: 'Ann', negated: false }] }
  for (const [filters, text, mode] of [
    [{ ...commenterFilters, type: [{ value: 'ticket', negated: false }] }, 'login', false],
    [{ ...commenterFilters, type: [{ value: 'ticket', negated: false }] }, '', false],
    [{ ...commenterFilters, type: [{ value: 'comment', negated: false }] }, '', true],
    [commenterFilters, '', true],
  ]) {
    calls.comments = 0
    const result = await rankedSearchWhere({ text, filters }, [7], 'Normal', 50, {}, undefined, true, true)
    assert.equal(result.commentMode, mode)
    if (!mode) assert.equal(calls.comments, 0)
  }
})

test('type:comment without text still takes the comment payload path', async () => {
  const result = await rankedSearchWhere(parse('type:comment'), [7], 'Normal', 50, {}, undefined, true, false)
  assert.equal(result.commentMode, true)
  const text = await rankedSearchWhere(parse('login type:comment'), [7], 'Normal', 50, {}, undefined, true, false)
  assert.equal(text.commentById.get(2).createdAt === undefined, true)
  assert.equal(text.commentById.get(2).commentText, 'hi')
})

test('comment-only enumeration requires a matching comment in the task where, page and count', async () => {
  calls.groupBy = []
  const result = await rankedSearchWhere(parse('type:comment'), [7], 'Normal', 50, {}, undefined, true, false)
  const needs = (where) => where.AND.some((part) => part.comments?.some?.activity)
  assert.ok(needs(result.where), 'returned where (used for MCP total and paging) requires a comment')
  assert.ok(needs(calls.groupBy[0].where.task.AND[0]), 'page query requires a comment')
  const sorted = await rankedSearchWhere(parse('type:comment'), [7], 'Normal', 50, {}, undefined, true, false, [{ updatedAt: 'desc' }])
  assert.ok(needs(sorted.where))
  const ticketOnly = await rankedSearchWhere(parse('type:ticket'), [7], 'Normal', 50, {}, undefined, true, false)
  assert.ok(!needs(ticketOnly.where))
})

test('phrases apply to the returned item: the comment for comments, title and description for tickets', async () => {
  const commentWhere = await searchFilterWhere(parse('type:comment "login page"'), [7], 'Normal')
  assert.deepEqual(commentWhere.AND, [])
  const ticketWhere = JSON.stringify((await searchFilterWhere(parse('type:ticket "login page"'), [7], 'Normal')).AND)
  assert.ok(ticketWhere.includes('"title"') && !ticketWhere.includes('"comments"'))
  const anyWhere = JSON.stringify((await searchFilterWhere(parse('"login page"'), [7], 'Normal')).AND)
  assert.ok(anyWhere.includes('"comments"'))
  calls.groupBy = []
  await rankedSearchWhere(parseSearchQuery('commenter:6 "login page"', {}, true, true), [7], 'Normal', 50, {}, undefined, true, true)
  assert.ok(JSON.stringify(calls.groupBy[0].where).includes('login page'), 'comment predicate carries the phrase')
  calls.commentRows = [
    { id: 'a', taskId: '2', commentText: 'page login broken', creatorName: 'A' },
    { id: 'b', taskId: '3', commentText: 'the Login Page is broken', creatorName: 'A' },
  ]
  try {
    const result = await rankedSearchWhere(parse('login page type:comment "login page"'), [7], 'Normal', 50, {}, undefined, true, false)
    assert.deepEqual([...result.commentById.keys()], [3])
  } finally { calls.commentRows = null }
})
