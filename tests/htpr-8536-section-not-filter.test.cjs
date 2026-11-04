const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./task-route-loader.cjs')

const listQuery = load('src/lib/mcp/listQuery.ts')
const PARKED = 'Valentin Review, UX needed,UX Sign-off, Agent Blocked'

const rows = [
  { id: 'a', section: 'Bugs', title: 'Pickable bug' },
  { id: 'b', section: 'Valentin Review', title: 'Waits on Valentin' },
  { id: 'c', section: 'UX needed', title: 'Waits on design' },
  { id: 'd', section: 'Agent Blocked (Infra)', title: 'Broken tool' },
  { id: 'e', section: 'Improvements', title: 'Pickable improvement' },
]

test('the dotted filter param reads a comma-separated list of column titles', () => {
  const parsed = listQuery.parseListQueryFromSearchParams(new URLSearchParams({
    'filter.section_not': PARKED,
  }))
  assert.deepEqual(parsed.filter.section_not, [
    'Valentin Review',
    'UX needed',
    'UX Sign-off',
    'Agent Blocked',
  ])
  assert.equal(parsed.filter.section, undefined)
})

test('the JSON filter object keeps its own order and drops repeats', () => {
  const parsed = listQuery.parseListQueryFromArgs({
    filter: { section_not: ['UX needed', 'Valentin Review', 'UX needed'] },
  })
  assert.deepEqual(parsed.filter.section_not, ['UX needed', 'Valentin Review'])
})

test('a repeated dotted param also collects into one list', () => {
  const params = new URLSearchParams()
  params.append('filter.section_not', 'Valentin Review')
  params.append('filter.section_not', 'UX needed')
  assert.deepEqual(listQuery.parseListQueryFromSearchParams(params).filter.section_not, [
    'Valentin Review',
    'UX needed',
  ])
})

test('naming one column and leaving it out at the same time is refused', () => {
  assert.throws(
    () => listQuery.parseListQueryFromSearchParams(new URLSearchParams({
      'filter.section': 'Bugs',
      'filter.section_not': 'UX needed',
    })),
    listQuery.ListQueryParseError,
  )
  assert.throws(
    () => listQuery.parseListQueryFromArgs({
      filter: { section: 'Bugs', section_not: 'UX needed' },
    }),
    listQuery.ListQueryParseError,
  )
})

test('a collection leaves out every named column and keeps the rest', () => {
  const query = listQuery.parseListQueryFromArgs({ filter: { section_not: PARKED } })
  const result = listQuery.applyCollectionQuery(rows, query)
  assert.deepEqual(result.items.map((item) => item.id), ['a', 'e'])
  assert.equal(result.total, 2)
})

test('a column title matches whatever its case', () => {
  const query = listQuery.parseListQueryFromArgs({ filter: { section_not: 'valentin REVIEW' } })
  const result = listQuery.applyCollectionQuery(rows, query)
  assert.deepEqual(result.items.map((item) => item.id), ['a', 'c', 'd', 'e'])
})

test('the exclusion survives the round trip back into query params', () => {
  const params = new URLSearchParams()
  listQuery.appendListQueryParams(params, { filter: { section_not: ['UX needed'] } })
  assert.deepEqual(JSON.parse(params.get('filter') ?? '{}').section_not, ['UX needed'])
})

test('the dotted param name is declared, or the read would ignore it', () => {
  assert.ok(listQuery.LIST_FILTER_KEYS.includes('section_not'))
})
