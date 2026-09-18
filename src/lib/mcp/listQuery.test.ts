// Run: npx tsx src/lib/mcp/listQuery.test.ts
import assert from 'node:assert/strict'
import {
  applyCollectionQuery,
  appendListQueryParams,
  FIELDS_DEFAULT_LIMIT,
  hasPrWhere,
  ListQueryParseError,
  normalizeTaskStatus,
  parseAssigneeFilter,
  parseListQueryFromArgs,
  parseListQueryFromSearchParams,
  parseSort,
  parseUpdatedSince,
  projectedListEnvelope,
  projectRows,
  resolveListLimit,
  taskUrlFromListItem,
  withTaskPresentation,
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
  assert.deepEqual(hasPrWhere('failing'), { pullRequests: { some: { checkState: 'failing' } } })
  assert.deepEqual(hasPrWhere('red'), {
    pullRequests: {
      some: { OR: [{ checkState: 'failing' }, { lifecycle: 'closed' }] },
    },
  })
  assert.deepEqual(hasPrWhere('checks_red'), hasPrWhere('red'))
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
  const payload = JSON.stringify(
    projectedListEnvelope(projected, {
      total: fatRows.length,
      limit: fatRows.length,
      nextCursor: null,
    }),
  )
  const envelope = JSON.parse(payload)
  assert.ok(
    Buffer.byteLength(payload) < 2048,
    `acceptance payload should stay under 2 KB, got ${Buffer.byteLength(payload)}`,
  )
  assert.equal('has_more' in envelope, false)
  assert.equal('offset' in envelope, false)
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

  const numeric = applyCollectionQuery(
    [
      { id: 1, ranking: 10 },
      { id: 2, ranking: 2 },
    ],
    parseListQueryFromArgs({ sort: 'ranking:asc' }),
  )
  assert.deepEqual(numeric.items.map((item) => item.ranking), [2, 10])

  assert.throws(
    () => parseListQueryFromSearchParams(new URLSearchParams({ filter: '{not-json' })),
    ListQueryParseError,
  )
  assert.throws(
    () => parseListQueryFromSearchParams(new URLSearchParams({ filter: 'invalid' })),
    ListQueryParseError,
  )
  assert.throws(
    () =>
      applyCollectionQuery(
        [{ id: 'a', name: 'Alpha' }],
        parseListQueryFromArgs({ cursor: 'missing' }),
      ),
    ListQueryParseError,
  )
  assert.throws(
    () => parseListQueryFromArgs({ filter: { has_pr: 'nope' } }),
    ListQueryParseError,
  )
  assert.throws(
    () => parseListQueryFromArgs({ filter: { assignee: 'nobody' } }),
    ListQueryParseError,
  )
  assert.throws(
    () => parseListQueryFromArgs({ filter: { updated_since: 'last-week' } }),
    ListQueryParseError,
  )
  assert.equal(parseAssigneeFilter('me').ok, true)
  assert.ok(parseUpdatedSince('2026-09-01T00:00:00.000Z'))
  assert.equal(parseUpdatedSince('last-week'), null)

  const presented = withTaskPresentation({
    title: 'Ticket',
    projectId: 15,
    ticketNumber: 'HTPR-4000',
    uniqueIndex: 4000,
  })
  assert.equal(presented.url, 'https://app.hypertask.ai/detail/project-15/4000')
  assert.equal(presented.link?.url, presented.url)
  const projectedLink = projectRows([presented], ['title', 'projectId', 'ticketNumber'])
  assert.deepEqual(Object.keys(projectedLink[0]).sort(), ['projectId', 'ticketNumber', 'title'])
  const onlyLink = projectRows([presented], ['link'])
  assert.equal((onlyLink[0].link as { url?: string }).url, presented.url)
}

demo()
console.log('listQuery tests passed')
