// Run: npx tsx src/lib/mcp/listQuery.test.ts
import assert from 'node:assert/strict'
import {
  applyCollectionQuery,
  appendListQueryParams,
  FIELDS_DEFAULT_LIMIT,
  hasPrWhere,
  normalizeTaskStatus,
  parseListQueryFromArgs,
  parseListQueryFromSearchParams,
  parseSort,
  projectRows,
  resolveListLimit,
  taskUrlFromListItem,
} from './listQuery'

function demo() {
  const params = new URLSearchParams({
    query: 'review',
    filter: JSON.stringify({ section: 'AI Review', has_pr: 'red' }),
    fields: 'title,url',
    sort: 'updatedAt:desc',
    limit: '20',
  })
  const parsed = parseListQueryFromSearchParams(params)
  assert.equal(parsed.query, 'review')
  assert.equal(parsed.filter.section, 'AI Review')
  assert.equal(parsed.filter.has_pr, 'red')
  assert.deepEqual(parsed.fields, ['title', 'url'])
  assert.equal(parsed.sortBy, 'updatedAt')
  assert.equal(parsed.sortOrder, 'desc')
  assert.equal(parsed.limit, 20)

  const dotted = parseListQueryFromSearchParams(
    new URLSearchParams([
      ['filter.section', 'AI Review'],
      ['filter.has_pr', 'red'],
      ['fields', 'title'],
      ['fields', 'url'],
    ]),
  )
  assert.equal(dotted.filter.section, 'AI Review')
  assert.equal(dotted.filter.has_pr, 'red')
  assert.deepEqual(dotted.fields, ['title', 'url'])

  const fromArgs = parseListQueryFromArgs({
    query: 'open tickets',
    filter: { section: 'AI Review', has_pr: 'red', status: 'open', label: ['hard'] },
    fields: ['title', 'url'],
    sort: '-updatedAt',
    limit: 10,
  })
  assert.equal(fromArgs.filter.section, 'AI Review')
  assert.equal(fromArgs.filter.status, 'Normal')
  assert.equal(fromArgs.filter.label, 'hard')
  assert.equal(fromArgs.sortOrder, 'desc')
  assert.equal(fromArgs.sortBy, 'updatedAt')

  assert.equal(normalizeTaskStatus('open'), 'Normal')
  assert.equal(normalizeTaskStatus('Active'), 'Normal')
  assert.equal(normalizeTaskStatus('archived'), 'Archive')
  assert.equal(normalizeTaskStatus('nope'), null)
  assert.equal(resolveListLimit(fromArgs, 50), 10)
  assert.equal(
    resolveListLimit(parseListQueryFromArgs({ fields: ['title', 'url'] }), 50),
    FIELDS_DEFAULT_LIMIT,
  )

  assert.deepEqual(parseSort('title'), { sortBy: 'title', sortOrder: 'asc' })
  assert.deepEqual(hasPrWhere('red'), { pullRequests: { some: { checkState: 'failing' } } })
  assert.deepEqual(hasPrWhere('false'), { pullRequests: { none: {} } })
  assert.equal(hasPrWhere('unknown'), null)

  const fatRows = Array.from({ length: 12 }, (_, index) => ({
    id: 4000 + index,
    title: `Ticket ${index}`,
    ticketNumber: `HTPR-${4000 + index}`,
    projectId: 15,
    description: 'x'.repeat(4000),
    section: 'AI Review',
    assignees: [{ id: 6, displayName: 'Valentin Yeo', email: 'valentin.yeo@gmail.com' }],
    sub_tasks: [{ id: 1, title: 'child', uniqueIndex: 1 }],
    url: taskUrlFromListItem({
      ticketNumber: `HTPR-${4000 + index}`,
      projectId: 15,
    }),
  }))
  const projected = projectRows(fatRows, ['title', 'url'])
  const payload = JSON.stringify({
    success: true,
    tasks: projected,
    total: fatRows.length,
    limit: fatRows.length,
    offset: 0,
    nextCursor: null,
  })
  assert.ok(
    Buffer.byteLength(payload) < 2048,
    `acceptance payload should stay under 2 KB, got ${Buffer.byteLength(payload)}`,
  )
  assert.deepEqual(Object.keys(projected[0]), ['title', 'url'])
  assert.ok(!payload.includes('metadata'))
  assert.ok(!payload.includes('description'))

  const queryParams = new URLSearchParams()
  appendListQueryParams(queryParams, {
    query: 'review',
    filter: { section: 'AI Review', has_pr: 'red' },
    fields: ['title', 'url'],
    sort: 'updatedAt:desc',
    limit: 20,
  })
  assert.equal(queryParams.get('query'), 'review')
  assert.equal(queryParams.get('fields'), 'title,url')
  assert.match(queryParams.get('filter') ?? '', /AI Review/)

  const paged = applyCollectionQuery(
    [
      { id: 'a', name: 'Alpha', status: 'Normal' },
      { id: 'b', name: 'Beta review', status: 'Normal' },
      { id: 'c', name: 'Gamma', status: 'Archive' },
    ],
    parseListQueryFromArgs({ query: 'review', fields: ['name'], limit: 1 }),
    { searchFields: ['name'] },
  )
  assert.equal(paged.total, 1)
  assert.deepEqual(paged.items, [{ name: 'Beta review' }])
}

demo()
console.log('listQuery tests passed')
