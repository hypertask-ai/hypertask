import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createJiti } from 'jiti'
import { candidateQuery } from '../src/lib/search/chips'
import { parseSearchQuery } from '../src/lib/search/operators'

const require = createRequire(import.meta.url)
const root = path.resolve(__dirname, '..')
const flag = 'htpr-6878-search-label-scope'
const layoutFlag = 'htpr-6865-search-layout'
type Label = { id: string; value: string; projectId: number }
type Link = { labelId: string; task: { projectId: number; status: string } }
let state: { flags: Record<string, boolean>; labels: Label[]; links: Link[]; labelQueries: any[]; countQueries: any[]; searchWhere?: any; session: { userId: number } | null }
const defaults = { 'htpr-6369-search-operators': true, 'htpr-6370-search-chips': true, 'htpr-6688-search-autocomplete': true, [layoutFlag]: true, [flag]: true }
const matches = (row: Label, where: any): boolean => {
  if (where.projectId && !where.projectId.in.includes(row.projectId)) return false
  if (where.AND && !where.AND.every((part: any) => matches(row, part))) return false
  if (where.OR && !where.OR.some((part: any) => matches(row, part))) return false
  if (where.NOT && matches(row, where.NOT)) return false
  if (where.id !== undefined && row.id !== where.id) return false
  if (where.value) {
    const [kind, value] = Object.entries(where.value).find(([key]) => key !== 'mode') as [string, string]
    const text = row.value.toLowerCase()
    if (!(kind === 'equals' ? text === value.toLowerCase() : kind === 'startsWith' ? text.startsWith(value) : text.includes(value))) return false
  }
  return true
}
for (const [file, exports] of [
  ['src/lib/auth/getSessionUser.ts', { getSessionUser: async () => state.session }],
  ['src/lib/flags.ts', {
    HTPR_6369_SEARCH_OPERATORS_FLAG: 'htpr-6369-search-operators', HTPR_6370_SEARCH_CHIPS_FLAG: 'htpr-6370-search-chips',
    HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG: 'htpr-6688-search-autocomplete', HTPR_6865_SEARCH_LAYOUT_FLAG: layoutFlag,
    HTPR_6878_SEARCH_LABEL_SCOPE_FLAG: flag, isFeatureEnabled: async (key: string, userId: number) => { assert.equal(userId, 6); return state.flags[key] ?? false },
  }],
  ['src/utils/controllers/projects/getAllIncludes.ts', { getProjectWhere: (userId: number) => ({ ownerId: userId }), projectContentAccessWhere: (userId: number) => ({ ownerId: userId }) }],
  ['src/lib/search/serverOperators.ts', { parseSearchWithChipNames: async (query: string) => parseSearchQuery(query), parseSearchWithNames: async (query: string) => parseSearchQuery(query) }],
  ['src/lib/search/rankedWhere.ts', { rankedSearchWhere: async (parsed: any, ids: number[], status: any) => {
    const { searchFilterWhere } = jiti(path.join(root, 'src/lib/search/filters.ts')) as any
    state.searchWhere = await searchFilterWhere(parsed, ids, status)
    return { where: state.searchWhere, rankedIds: [], descriptionById: new Map(), partial: false }
  } }],
  ['src/utils/controllers/turbopuffer/turbopufferHelper.ts', { searchPreviewText: (text: string) => text }],
  ['src/utils/controllers/search/document.ts', { turbopufferGetDocuments: async () => ({ status: 200 }) }],
  ['src/lib/prisma.ts', { default: {
    project: { findMany: async ({ where }: any) => { assert.equal(where.ownerId, 6); return [{ id: 7, title: 'One' }, { id: 8, title: 'Two' }] } },
    label: { findMany: async (args: any) => {
      state.labelQueries.push(args)
      return state.labels.filter((row) => matches(row, args.where))
        .sort((a, b) => a.value.localeCompare(b.value) || a.id.localeCompare(b.id)).slice(0, args.take)
    } },
    task: { findMany: async () => [] },
    taskLabel: { groupBy: async (args: any) => {
      state.countQueries.push(args)
      assert.deepEqual(args.by, ['labelId'])
      assert.deepEqual(args._count, { _all: true })
      assert.equal(args.where.task.status, 'Normal')
      assert.ok(args.where.task.projectId.in.every((id: number) => [7, 8].includes(id)))
      const counts = new Map<string, number>()
      for (const link of state.links) {
        if (!args.where.labelId.in.includes(link.labelId) || link.task.status !== args.where.task.status || !args.where.task.projectId.in.includes(link.task.projectId)) continue
        counts.set(link.labelId, (counts.get(link.labelId) ?? 0) + 1)
      }
      return [...counts].map(([labelId, count]) => ({ labelId, _count: { _all: count } }))
    } },
  } }],
] as const) {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule
}
const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false })
const handler = jiti(path.join(root, 'src/pages/api/search/values.ts')).default as any
async function lookup(query: Record<string, string> = {}, overrides: Partial<typeof state> = {}) {
  state = { flags: { ...defaults }, session: { userId: 6 }, labels: [], links: [], labelQueries: [], countQueries: [], ...overrides }
  const response = { code: 0, body: undefined as any, status(code: number) { this.code = code; return this }, json(body: any) { this.body = body; return this } }
  await handler({ method: 'GET', headers: {}, query: { operator: 'label', value: '', ...query } }, response)
  return { ...response, ...state }
}
const labels = [{ id: 'one', value: 'Bug', projectId: 7 }, { id: 'two', value: 'bug', projectId: 8 }, { id: 'private', value: 'Private', projectId: 999 }]
const link = (labelId: string, projectId = 7, status = 'Normal'): Link => ({ labelId, task: { projectId, status } })

test('scope intersects picked boards with access, including multiple and inaccessible boards', async () => {
  for (const [boards, expected] of [['7', ['one']], ['8', ['two']], ['7,8,999', ['one', 'two']], ['7,999', ['one']], ['999', []]] as const) {
    const result = await lookup({ boards }, { labels })
    assert.deepEqual(result.body.candidates.map((row: any) => row.id).sort(), [...expected].sort())
    assert.ok(result.labelQueries.every((query) => !query.where.projectId.in.includes(999)))
    assert.equal(result.countQueries.length, 1)
  }
})

test('scope without picked boards uses all accessible boards, not boardId context', async () => {
  const result = await lookup({ boardId: '7' }, { labels: [...labels, { id: 'two-only', value: 'Two only', projectId: 8 }] })
  assert.deepEqual(result.labelQueries[0].where.projectId.in, [7, 8])
  assert.ok(result.body.candidates.some((row: any) => row.name === 'Two only'))
  assert.ok(!result.body.candidates.some((row: any) => row.id === 'private'))
})

test('scope applies to exact ID hydration too', async () => {
  assert.equal((await lookup({ boards: '7', resolve: 'two login' }, { labels })).body.resolved, undefined)
  const result = await lookup({ boards: '8,999', resolve: 'two login' }, { labels })
  assert.equal(result.body.resolved, 'bug')
  assert.equal(result.body.resolvedId, 'two')
})

test('counts exclude archived, deleted and out-of-scope tasks using one grouped query', async () => {
  const result = await lookup({ boards: '7' }, { labels, links: [link('one'), link('one'), link('one', 7, 'Archive'), link('one', 7, 'Deleted'), link('one', 8), link('one', 999)] })
  assert.deepEqual(result.body.candidates, [{ id: 'one', name: 'Bug', count: 2 }])
  assert.equal(result.countQueries.length, 1)
  assert.deepEqual(result.countQueries[0].where.task, { status: 'Normal', projectId: { in: [7] } })
})

test('counts put zero last while retaining prefix, contains and fuzzy ranking, not count magnitude', async () => {
  const rows = [
    { id: 'zero-prefix', value: 'Bug A', projectId: 7 }, { id: 'prefix', value: 'Bug B', projectId: 7 },
    { id: 'contains', value: 'Debug', projectId: 7 }, { id: 'fuzzy', value: 'Build good', projectId: 7 },
    { id: 'zero-contains', value: 'Z debug', projectId: 7 },
  ]
  const result = await lookup({ boards: '7', value: 'bug' }, { labels: rows, links: [link('prefix'), ...Array.from({ length: 5 }, () => link('contains')), link('fuzzy')] })
  assert.deepEqual(result.body.candidates.map((row: any) => row.id), ['prefix', 'contains', 'fuzzy', 'zero-prefix', 'zero-contains'])
  assert.deepEqual(result.body.candidates.map((row: any) => row.count), [1, 5, 1, 0, 0])
})

test('dedupe trims case-insensitive names, sums counts and preserves all duplicates beyond the old cap', async () => {
  const rows = Array.from({ length: 110 }, (_, index) => ({ id: `bug-${index}`, value: index % 2 ? ' bug ' : 'Bug', projectId: index % 2 ? 8 : 7 }))
  const result = await lookup({}, { labels: rows, links: rows.map((row) => link(row.id, row.projectId)) })
  assert.equal(result.body.candidates.length, 1)
  assert.equal(result.body.candidates[0].count, 110)
  assert.equal(result.body.candidates[0].name.trim().toLowerCase(), 'bug')
  assert.equal(result.body.candidates[0].byName, true)
  const selection = candidateQuery('label', result.body.candidates[0].name)
  assert.equal(parseSearchQuery(selection).filters.label?.[0].value.toLowerCase(), 'bug')
  assert.equal(result.countQueries.length, 1)
})

test('dedupe name selection searches all case and whitespace variants through the real exact-name filters', async () => {
  const documentHandler = jiti(path.join(root, 'src/pages/api/search/document.ts')).default as any
  const rows = [...labels, { id: 'padded', value: ' Bug ', projectId: 8 }]
  for (const disabled of [null, flag, layoutFlag]) {
    await lookup({}, { labels: rows, flags: { ...defaults, ...(disabled ? { [disabled]: false } : {}) } })
    state.labelQueries = []
    const response = { status(code: number) { assert.equal(code, 204); return this }, json() { return this } }
    await documentHandler({ method: 'POST', headers: {}, body: { searchQuery: 'label:Bug', projectIds: [7, 8], archive: 'Normal' } }, response)
    const alternatives = state.searchWhere.AND[0].OR.map((part: any) => part.taskLabels.some.label.OR[0].id)
    assert.deepEqual(alternatives.sort(), disabled ? ['Bug'] : ['one', 'padded', 'two'])
    assert.equal(state.labelQueries.length, disabled ? 0 : 1)
  }
})

test('dedupe does not merge IDs after a board is explicitly picked', async () => {
  const result = await lookup({ boards: '7,8' }, { labels })
  assert.deepEqual(result.body.candidates.map((row: any) => row.id).sort(), ['one', 'two'])
  assert.ok(result.body.candidates.every((row: any) => row.byName === undefined))
})

test('flag off preserves legacy response bytes, ignores boards and never queries counts', async () => {
  for (const disabled of [flag, layoutFlag, 'htpr-6370-search-chips', 'htpr-6688-search-autocomplete']) {
    const result = await lookup({ boards: '7', boardId: '7', value: 'bu' }, { labels, flags: { ...defaults, [disabled]: false } })
    assert.equal(JSON.stringify(result.body), JSON.stringify({ candidates: disabled === 'htpr-6370-search-chips' ? [{ id: 'one', name: 'Bug' }] : [{ id: 'one', name: 'Bug' }, { id: 'two', name: 'bug' }] }))
    assert.equal(result.countQueries.length, 0)
  }
})

test('scope still requires a session and the operators flag', async () => {
  assert.equal((await lookup({}, { session: null })).code, 401)
  assert.equal((await lookup({}, { flags: { ...defaults, 'htpr-6369-search-operators': false } })).code, 404)
})
