const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')
const calls = { tasks: 0, comments: 0, taskWhere: [] }
const mocks = new Map([
  ['src/lib/prisma.ts', { default: {
    section: { findMany: async () => [] },
    task: { findMany: async (args) => { calls.taskWhere.push(args.where); return [{ id: 1 }, { id: 2 }] } },
  } }],
  ['src/utils/controllers/turbopuffer/turbopufferHelper.ts', {
    searchPreviewText: (text) => text,
    searchTasks: async () => { calls.tasks++; return [{ id: '1', descriptionText: '' }] },
    searchComments: async () => { calls.comments++; return [{ id: 'c', taskId: '2', commentText: 'hi', creatorName: 'A' }] },
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
  const where = await searchFilterWhere(parse('"login page" -oauth priority:High type:comment'), [7], 'Normal')
  const groups = where.AND
  const text = JSON.stringify(groups)
  assert.ok(text.includes('"Priority_Value":{"equals":"high","mode":"insensitive"}'))
  assert.ok(text.includes('"contains":"login page"'))
  assert.ok(groups.some((group) => group.NOT && JSON.stringify(group.NOT).includes('"contains":"oauth"')))
  assert.ok(text.includes('"comments":{"some"'))
  const none = JSON.stringify((await searchFilterWhere(parse('priority:none'), [7], null)).AND)
  assert.ok(none.includes('"is":null') && none.includes('No Priority'))
  assert.deepEqual((await searchFilterWhere(parse('priority:bogus'), [7], null)).AND, [{ OR: [{ id: -1 }] }])
  assert.deepEqual((await searchFilterWhere(parse('type:bogus'), [7], null)).AND, [{ OR: [{ id: -1 }] }])
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
