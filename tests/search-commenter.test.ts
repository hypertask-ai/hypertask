import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createJiti } from 'jiti'
import { NextRequest } from 'next/server'
import * as keys from '../src/lib/flags/keys'
import { parseSearchQuery, parseSearchTokens } from '../src/lib/search/operators'
import { candidateQuery, searchChipText, splitSearchChips } from '../src/lib/search/chips'
import { operatorSuggestions, searchCompletion, SEARCH_TIPS, searchFilterType } from '../src/lib/search/autocomplete'

const require = createRequire(import.meta.url)
const root = path.resolve(__dirname, '..')
const flag = keys.HTPR_6880_SEARCH_COMMENTER_FLAG
const fuzzyFlag = keys.HTPR_6881_SEARCH_FUZZY_PERSON_FLAG
let state: any
const people: any[] = [
  { id: 1, displayName: 'Hicham', email: 'one@example.test', board: 7 },
  { id: 2, displayName: 'HÍCHAM Other', email: 'two@example.test', board: 7 },
  { id: 3, displayName: 'Other', email: 'other@example.test', board: 7 },
  { id: 99, displayName: 'Hicham Private', email: 'private@example.test', board: 999 },
].map((person) => ({ ...person, members: [{ projectId: person.board }], tasks: [], assignees: [] }))
const tasks: any[] = [7, 7, 7, 7, 7, 999, 7].map((projectId, i) => ({
  id: 101 + i, projectId, title: 'Needle in the title', status: i === 6 ? 'Deleted' : 'Normal',
  userId: 3, ticketNumber: `TEST-${i + 1}`, uniqueIndex: i + 1, section: 'Todo',
  project: { id: projectId, title: projectId === 7 ? 'Visible' : 'Private' },
  description: 'Needle in the description', description_: { content: 'Needle in the description' },
  createdAt: new Date('2026-10-01'), updatedAt: new Date(`2026-10-0${7 - i}`), comments: [],
}))
const comment = (id: number, taskId: number, creatorId: number, commentText: string, day: number, activity: any = null) => ({
  id, taskId, creatorId, commentText, activity, createdAt: new Date(`2026-10-${String(day).padStart(2, '0')}`),
  creator: people.find((person) => person.id === creatorId), task: tasks.find((task) => task.id === taskId),
})
const comments = [
  comment(1, 101, 1, 'Old needle comment', 1),
  comment(2, 101, 1, 'Newest NEEDLE <img src=x onerror=alert(1)>', 5),
  comment(3, 101, 3, 'Other author wrote needle much later', 9),
  comment(4, 102, 1, 'No text match here', 6),
  comment(5, 102, 3, 'Only another author wrote needle', 8),
  comment(6, 103, 2, 'needle by the similar name', 7),
  comment(7, 104, 1, 'needle system activity', 10, { action: 'updated' }),
  comment(8, 104, 3, 'needle by somebody else', 3),
  comment(9, 106, 1, 'needle on inaccessible board', 11),
  comment(10, 107, 1, 'needle on deleted ticket', 12),
]
for (const task of tasks) task.comments = comments.filter((row) => row.taskId === task.id)
people[2].tasks = tasks
function matches(row: any, where: any): boolean {
  if (where.AND && !(Array.isArray(where.AND) ? where.AND : [where.AND]).every((part: any) => matches(row, part))) return false
  if (where.OR && !where.OR.some((part: any) => matches(row, part))) return false
  if (where.NOT && matches(row, where.NOT)) return false
  for (const [key, condition] of Object.entries(where) as [string, any][]) {
    if (['AND', 'OR', 'NOT'].includes(key) || condition === undefined) continue
    const value = row?.[key]
    if (condition === null || typeof condition !== 'object') { if (value !== condition) return false; continue }
    if (key === 'activity') { if (value !== null) return false; continue }
    if (condition.some) { if (!value?.some((item: any) => matches(item, condition.some))) return false; continue }
    if (condition.in) { if (!condition.in.includes(value)) return false; continue }
    if (condition instanceof Date) { if (value?.getTime() !== condition.getTime()) return false; continue }
    if (condition.gt !== undefined) { if (!(value > condition.gt)) return false; continue }
    if (condition.lt !== undefined) { if (!(value < condition.lt)) return false; continue }
    if (condition.equals instanceof Date) { if (value?.getTime() !== condition.equals.getTime()) return false; continue }
    if (condition.gte) { if (!(value >= condition.gte)) return false; continue }
    const text = String(value ?? '').toLowerCase()
    if (condition.equals !== undefined) { if (text !== String(condition.equals).toLowerCase()) return false; continue }
    if (condition.startsWith !== undefined) { if (!text.startsWith(condition.startsWith.toLowerCase())) return false; continue }
    if (condition.contains !== undefined) { if (!text.includes(condition.contains.toLowerCase())) return false; continue }
    if (!matches(value, condition)) return false
  }
  return true
}
function pageRows(rows: any[], args: any) {
  const sorted = rows.toSorted((a, b) => {
    for (const order of Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : []) {
      const [key, direction] = Object.entries(order)[0]
      if (a[key] < b[key]) return direction === 'asc' ? -1 : 1
      if (a[key] > b[key]) return direction === 'asc' ? 1 : -1
    }
    return 0
  })
  const start = (args.cursor ? sorted.findIndex((row) => row.id === args.cursor.id) : 0) + (args.skip ?? 0)
  return sorted.slice(start, args.take === undefined ? undefined : start + args.take)
}
const db = {
  project: { findMany: async ({ where }: any) => [{ id: 7, title: 'Visible', status: 'Normal', ownerId: 42 }].filter((row) => matches(row, where)) },
  user: { findMany: async (args: any) => { state.peopleQueries.push(args); return people.filter((row) => matches(row, args.where)).slice(0, args.take) } },
  assignees: { findMany: async () => [] },
  task: {
    findMany: async (args: any) => { state.taskQueries.push(args); return pageRows(tasks.filter((row) => matches(row, args.where)), args) },
    count: async (args: any) => { state.countQueries.push(args); return tasks.filter((row) => matches(row, args.where)).length },
  },
  comment: {
    findFirst: async (args: any) => {
      if (args.select.commentText) state.detailQueries.push(args)
      else state.anchorQueries.push(args)
      assert.equal(typeof args.where.taskId, 'number')
      assert.deepEqual(args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }])
      return pageRows(comments.filter((row) => !state.deleted.includes(row.id) && matches(row, args.where)), args)[0] ?? null
    },
    groupBy: async (args: any) => {
      state.commentQueries.push(args)
      assert.deepEqual(args.by, ['taskId'])
      assert.deepEqual(args._max, { createdAt: true })
      assert.deepEqual(args.orderBy, [{ _max: { createdAt: 'desc' } }, { taskId: 'desc' }])
      assert.ok(args.take > 0)
      assert.equal(args.select, undefined)
      const groups = new Map<number, Date>()
      for (const row of comments.filter((row) => !state.deleted.includes(row.id) && matches(row, args.where))) {
        if (!groups.has(row.taskId) || groups.get(row.taskId)! < row.createdAt) groups.set(row.taskId, row.createdAt)
      }
      const having = (row: any, filter: any): boolean => !filter || filter.OR.some((part: any) =>
        matches(row, { ...(part.taskId ? { taskId: part.taskId } : {}), createdAt: part.createdAt._max }))
      return [...groups].map(([taskId, createdAt]) => ({ taskId, createdAt, _max: { createdAt } }))
        .filter((row) => having(row, args.having))
        .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.taskId - a.taskId)
        .slice(0, args.take)
    },
  },
}
for (const [file, exports] of [
  ['src/lib/prisma.ts', { default: db }],
  ['src/lib/auth/getSessionUser.ts', { getSessionUser: async () => state.session }],
  ['src/lib/mcp/auth.ts', { validateMcpAuth: async () => state.session ? { user: { id: 42 }, agentId: null } : null, checkMcpRateLimit: async () => null }],
  ['src/lib/flags.ts', { ...keys, isFeatureEnabled: async (key: string, userId: number) => { assert.equal(userId, 42); state.flagCalls.push(key); return state.flags[key] ?? false } }],
  ['src/utils/controllers/projects/getAllIncludes.ts', { getProjectWhere: (userId: number) => ({ ownerId: userId }), projectContentAccessWhere: (userId: number) => ({ ownerId: userId }) }],
  ['src/lib/mcp/agents.ts', { mcpVisibleAgentSelect: () => ({}), mapVisibleMcpAgent: () => null }],
  ['src/utils/controllers/search/document.ts', { turbopufferGetDocuments: async (query: string) => ({ status: 200, legacyQuery: query }), turbopufferSearchTaskIds: async () => [] }],
  ['src/utils/controllers/turbopuffer/turbopufferHelper.ts', {
    searchPreviewText: (text: string) => text,
    convertToPlain: (text: string) => text,
    searchTasks: async () => { state.indexCalls++; return state.indexComments.length ? [] : tasks.map((row) => ({ id: row.id, descriptionText: row.description })) },
    searchComments: async () => { state.indexCalls++; return state.indexComments },
  }],
] as const) {
  const filename = path.join(root, file)
  require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule
}
const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false })
const { parseSearchWithNames, parseSearchWithChipNames } = jiti(path.join(root, 'src/lib/search/serverOperators.ts')) as any
const { searchFilterWhere } = jiti(path.join(root, 'src/lib/search/filters.ts')) as any
const { rankedSearchWhere } = jiti(path.join(root, 'src/lib/search/rankedWhere.ts')) as any
const documentHandler = jiti(path.join(root, 'src/pages/api/search/document.ts')).default as any
const valuesHandler = jiti(path.join(root, 'src/pages/api/search/values.ts')).default as any
const { GET } = jiti(path.join(root, 'src/app/api/mcp/tasks/search/route.ts')) as any
function reset(overrides: any = {}) {
  state = { session: { userId: 42 }, flags: { [flag]: true, [fuzzyFlag]: true,
    [keys.HTPR_6369_SEARCH_OPERATORS_FLAG]: true, [keys.HTPR_6370_SEARCH_CHIPS_FLAG]: true,
    [keys.HTPR_6530_MCP_LIST_QUERY_FLAG]: true, [keys.HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG]: true, [keys.HTPR_6865_SEARCH_LAYOUT_FLAG]: true },
    indexComments: [], countQueries: [], anchorQueries: [], peopleQueries: [], taskQueries: [], commentQueries: [], detailQueries: [], flagCalls: [], deleted: [], indexCalls: 0, ...overrides }
}
const response = () => ({ code: 0, body: undefined as any, status(code: number) { this.code = code; return this }, json(body: any) { this.body = body; return this } })
async function search(query: string, projectIds = [7]) {
  const res = response()
  await documentHandler({ method: 'POST', headers: {}, body: { searchQuery: query, projectIds, archive: 'Normal' } }, res)
  return res
}
async function rank(query: string, fuzzy = true) {
  const parsed = await parseSearchWithChipNames(query, [7], fuzzy, [7], true)
  return rankedSearchWhere(parsed, [7], 'Normal')
}

test('parser recognizes commenter only when enabled, including names, quotes and negation', () => {
  const raw = 'needle commenter:"@Hicham Other" -commenter:3'
  assert.equal(JSON.stringify(parseSearchQuery(raw)), '{"text":"needle commenter:\\"@Hicham Other\\" -commenter:3","filters":{}}')
  assert.deepEqual(parseSearchQuery(raw, {}, true), { text: 'needle', filters: { commenter: [{ value: '@Hicham Other', negated: false }, { value: '3', negated: true }] } })
  assert.equal(parseSearchTokens(raw).length, 0)
  assert.equal(parseSearchTokens(raw, {}, true).length, 2)
  assert.deepEqual(operatorSuggestions('comm'), [])
  assert.deepEqual(operatorSuggestions('comm', true), ['commenter'])
  assert.equal(searchCompletion('commenter:hi'), null)
  assert.equal(searchCompletion('commenter:hi', {}, true)?.kind, 'value')
  assert.equal(candidateQuery('commenter', 'Hicham Other'), 'commenter:"@Hicham Other"')
  assert.equal(candidateQuery('commenter', 'Hicham', 1), 'commenter:1')
  assert.equal(splitSearchChips('commenter:1').chips.length, 0)
  assert.equal(splitSearchChips('commenter:1', false, {}, false, true).chips.length, 1)
  assert.equal(searchFilterType('commenter'), searchFilterType('from'))
  assert.deepEqual(SEARCH_TIPS.commenter, { example: 'commenter:@Hicham', meaning: 'Commented by this person' })
})

test('commenter chips retain the person marker independently of the board hash flag', () => {
  for (const raw of ['commenter:1', 'commenter:@Hicham', '-commenter:1']) {
    const chip = splitSearchChips(raw, false, {}, false, true).chips[0]
    for (const omitBoardHash of [false, true]) {
      assert.equal(searchChipText(chip, 'Hicham', omitBoardHash), `${chip.negated ? '-' : ''}commenter:@Hicham`)
      assert.equal(searchChipText(chip, '@Hicham', omitBoardHash), `${chip.negated ? '-' : ''}commenter:@Hicham`)
    }
  }
})

test('where requires a real comment by the exact picked ID on accessible non-deleted tickets', async () => {
  reset()
  const parsed = parseSearchQuery('commenter:1', {}, true)
  const where = await searchFilterWhere(parsed, [7], 'Normal')
  assert.deepEqual(where.projectId, { in: [7] })
  assert.deepEqual(where.AND[0].OR[0].comments.some.OR, [{ creatorId: 1 }])
  assert.ok(where.AND[0].OR[0].comments.some.activity.equals)
  assert.deepEqual(tasks.filter((row) => matches(row, where)).map((row) => row.id), [101, 102])
  assert.equal(state.peopleQueries.length, 0)
})

test('typed names reuse fuzzy flag, accents and emails; picked numeric IDs remain exact', async () => {
  for (const chips of [false, true]) {
    for (const [value, fuzzy, ids] of [['hicham', true, [1, 2]], ['HÍCH', true, [1, 2]], ['two@example', true, [2]], ['hicham', false, undefined], ['1', true, undefined]] as const) {
      reset()
      const parsed = await (chips ? parseSearchWithChipNames : parseSearchWithNames)(`commenter:${value}`, [7], fuzzy, [7], true)
      assert.deepEqual(parsed.filters.commenter[0].userIds, ids)
      const where = await searchFilterWhere(parsed, [7], 'Normal')
      assert.deepEqual(tasks.filter((row) => matches(row, where)).map((row) => row.id), ids?.includes(2) ? ids.length === 1 ? [103] : [101, 102, 103] : [101, 102])
    }
  }
  reset()
  const parsed = await parseSearchWithNames('commenter:@HÍCHAM Other', [7], true, [7], true)
  assert.equal(parsed.text, '')
  assert.equal(parsed.filters.commenter[0].value, '@HÍCHAM Other')
  const privatePerson = await parseSearchWithNames('commenter:private@example.test', [7], true, [7], true)
  assert.deepEqual(privatePerson.filters.commenter[0].userIds, [])
})

test('newest matching comment supplies snippets and date, not the newest unrelated author or task update', async () => {
  reset()
  const res = await search('commenter:1')
  assert.equal(res.code, 200)
  assert.deepEqual(res.body.processedData.All.map((row: any) => [row.taskId, row.commentId]), [[102, 4], [101, 2]])
  const row = res.body.processedData.All[1]
  assert.equal(row.commentText, comments[1].commentText)
  assert.equal(row.updatedAt, '2026-10-05T00:00:00.000Z')
  assert.ok(state.flagCalls.includes(flag))
  assert.equal(state.indexCalls, 0)
})

test('commenter and match highlight flags independently select matching comment snippets and author metadata', async () => {
  for (const commenter of [false, true]) {
    for (const highlights of [false, true]) {
      reset()
      state.flags[flag] = commenter
      state.flags[keys.HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG] = highlights
      const res = await search('needle commenter:1')
      if (!commenter) {
        assert.equal(res.body.legacyQuery, 'needle commenter:1')
        assert.equal(state.commentQueries.length, 0)
        continue
      }
      assert.deepEqual(res.body.processedData.All.map((row: any) => row.taskId), [101])
      const row = res.body.processedData.All[0]
      assert.equal(row.commentId, 2)
      assert.equal(row.updatedAt, '2026-10-05T00:00:00.000Z')
      assert.equal(row.commentText, comments[1].commentText)
      assert.deepEqual(row.searchMatch, highlights ? { people: [], labels: [], commentAuthor: 'Hicham' } : undefined)
      assert.deepEqual(state.detailQueries[0].select.creator, { select: { displayName: true, email: true } })
      assert.equal(state.indexCalls, 0)
    }
  }
})

test('comment author pill falls back to email and highlight prerequisites do not disable commenter filtering', async () => {
  const displayName = people[0].displayName
  try {
    people[0].displayName = ''
    reset()
    state.flags[keys.HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG] = true
    assert.equal((await search('needle commenter:1')).body.processedData.All[0].searchMatch.commentAuthor, 'one@example.test')
    for (const prerequisite of [keys.HTPR_6370_SEARCH_CHIPS_FLAG, keys.HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG, keys.HTPR_6865_SEARCH_LAYOUT_FLAG]) {
      reset()
      state.flags[keys.HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG] = true
      state.flags[prerequisite] = false
      const row = (await search('needle commenter:1')).body.processedData.All[0]
      assert.equal(row.commentId, 2)
      assert.equal(row.searchMatch, undefined)
      assert.equal(row.commentText, comments[1].commentText)
    }
  } finally {
    people[0].displayName = displayName
  }
})

test('text and commenter match the same comment, never the title, description or another person', async () => {
  reset()
  const res = await search('needle commenter:1')
  assert.deepEqual(res.body.processedData.All.map((row: any) => [row.taskId, row.commentId]), [[101, 2]])
  assert.equal(state.commentQueries[0].where.AND[0].commentText.contains, 'needle')
  assert.equal(state.commentQueries[0].where.AND[0].commentText.mode, 'insensitive')
  assert.deepEqual((await rank('needle commenter:1 commenter:2')).rankedIds, [103, 101])
  assert.deepEqual((await rank('missing commenter:1')).rankedIds, [])
  assert.equal(state.indexCalls, 0)
})

test('negation excludes all comments by a person regardless of free text; activities do not exclude', async () => {
  reset()
  const parsed = await parseSearchWithNames('needle -commenter:1', [7], true, [7], true)
  const where = await searchFilterWhere(parsed, [7], 'Normal')
  assert.equal(where.AND[0].NOT.comments.some.commentText, undefined)
  assert.deepEqual(tasks.filter((row) => matches(row, where)).map((row) => row.id), [103, 104, 105])
  assert.deepEqual((await rank('commenter:hicham -commenter:1')).rankedIds, [103])
  assert.deepEqual((await rank('commenter:nobody')).rankedIds, [])
})

test('deleted comments disappear, including stale index hits, while activities and inaccessible tasks never appear', async () => {
  reset({ deleted: [1, 2] })
  assert.deepEqual((await rank('needle commenter:1')).rankedIds, [])
  assert.equal(state.indexCalls, 0)
  reset()
  assert.equal((await search('commenter:1', [7, 999])).code, 403)
  assert.equal(state.peopleQueries.length, 0)
  assert.equal(state.commentQueries.length, 0)
})

test('values uses the same scoped people/email picker and rejects commenter when its flag is off', async () => {
  reset()
  const lookup = async (operator: string) => {
    const res = response()
    await valuesHandler({ method: 'GET', headers: {}, query: { operator, value: 'hi', boardId: '7' } }, res)
    return res
  }
  const from = await lookup('from')
  const commenter = await lookup('commenter')
  assert.equal(commenter.code, 200)
  assert.equal(JSON.stringify(commenter.body), JSON.stringify(from.body))
  assert.deepEqual(commenter.body.candidates.map((row: any) => row.id), [1])
  assert.equal(commenter.body.candidates[0].email, 'one@example.test')
  assert.ok(state.peopleQueries.every((args: any) => !JSON.stringify(args.where).includes('999')))
  state.flags[flag] = false
  state.peopleQueries = []
  assert.equal((await lookup('commenter')).code, 400)
  assert.equal(state.peopleQueries.length, 0)
})

test('API flag-off output is byte-identical to legacy search and performs no commenter lookups', async () => {
  reset()
  state.flags[flag] = false
  const res = await search('commenter:1')
  assert.equal(JSON.stringify(res.body), '{"status":200,"legacyQuery":"commenter:1"}')
  assert.equal(state.commentQueries.length, 0)
  assert.equal(state.peopleQueries.length, 0)
  for (const chips of [false, true]) {
    const parsed = await (chips ? parseSearchWithChipNames : parseSearchWithNames)('commenter:1 from:3', [7], true, [7], false)
    assert.equal(JSON.stringify(parsed), '{"text":"commenter:1","filters":{"from":[{"value":"3","negated":false}]}}')
  }
})

test('MCP shares authorization, parser, comment snippets and newest-comment pagination', async () => {
  reset()
  const request = (query: string, suffix = '') => GET(new NextRequest(`http://localhost/api/mcp/tasks/search?q=${encodeURIComponent(query)}&board_id=7${suffix}`))
  const res = await request('needle commenter:hicham')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(body.tasks.map((row: any) => [row.id, row.commentId]), [[103, 6], [101, 2]])
  assert.equal(body.tasks[1].commentText, comments[1].commentText)
  assert.equal(body.tasks[1].commentCreatedAt, '2026-10-05T00:00:00.000Z')
  const first = await (await request('commenter:1', '&limit=1')).json()
  assert.equal(first.tasks[0].id, 102)
  const second = await (await request('commenter:1', '&limit=1&cursor=102')).json()
  assert.equal(second.tasks[0].id, 101)
  assert.ok(state.flagCalls.includes(flag))
  const denied = await GET(new NextRequest('http://localhost/api/mcp/tasks/search?q=commenter:1&board_id=999'))
  assert.equal(denied.status, 403)
})


test('API and MCP honor both person and commenter flags independently in both chip modes', async () => {
  for (const chips of [false, true]) {
    for (const fuzzy of [false, true]) {
      for (const surface of ['API', 'MCP']) {
        reset()
        state.flags[keys.HTPR_6370_SEARCH_CHIPS_FLAG] = chips
        state.flags[fuzzyFlag] = fuzzy
        const ids = surface === 'API'
          ? (await search('commenter:hicham')).body.processedData.All.map((row: any) => row.taskId)
          : (await (await GET(new NextRequest('http://localhost/api/mcp/tasks/search?q=commenter:hicham&board_id=7'))).json()).tasks.map((row: any) => row.id)
        assert.deepEqual(ids, fuzzy ? [103, 102, 101] : [102, 101])
        assert.ok(state.flagCalls.includes(flag))
        assert.ok(state.flagCalls.includes(fuzzyFlag))
      }
    }
  }
  reset()
  state.flags[flag] = false
  const res = await GET(new NextRequest('http://localhost/api/mcp/tasks/search?q=commenter:1&board_id=7'))
  assert.equal(res.status, 200)
  assert.equal(JSON.stringify(await res.json()), '{"success":true,"tasks":[],"total":0,"boardId":7,"nextCursor":null}')
  assert.equal(state.commentQueries.length, 0)
  assert.equal(state.peopleQueries.length, 0)
})

test('commenter values still require session authentication and the operators flag', async () => {
  for (const [session, enabled, code] of [[null, true, 401], [{ userId: 42 }, false, 404]] as const) {
    reset({ session })
    state.flags[keys.HTPR_6369_SEARCH_OPERATORS_FLAG] = enabled
    const res = response()
    await valuesHandler({ method: 'GET', headers: {}, query: { operator: 'commenter', value: 'hi' } }, res)
    assert.equal(res.code, code)
    assert.equal(state.peopleQueries.length, 0)
  }
})


test('review flag-off preserves ordinary indexed comment metadata and production timestamps', async () => {
  for (const enabled of [false, true]) {
    reset()
    state.flags[flag] = enabled
    state.flags[keys.HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG] = true
    const hit = { id: '2', taskId: 101, commentText: comments[1].commentText, creatorName: 'Hicham', createdAt: '2026-10-05T00:00:00.000Z' }
    state.indexComments = [hit]
    const parsed = await parseSearchWithNames('needle from:3', [7], false, [7], enabled)
    const ranked = await rankedSearchWhere(parsed, [7], 'Normal', 50, {}, null, false, enabled)
    if (!enabled) assert.equal(JSON.stringify(ranked.commentById.get(101)), JSON.stringify(hit))
    const api = await search('needle from:3')
    const row = api.body.processedData.All[0]
    assert.equal(row.updatedAt, enabled ? hit.createdAt : tasks[0].updatedAt.toISOString())
    assert.equal(row.commentId, 2)
    assert.equal(row.commentText, hit.commentText)
    const mcp = await (await GET(new NextRequest('http://localhost/api/mcp/tasks/search?q=needle%20from:3&board_id=7'))).json()
    const legacyItem = {
      id: 101, ticketNumber: 'TEST-1', title: tasks[0].title, description: tasks[0].description,
      boardId: 7, boardTitle: 'Visible', projectId: 7, section: 'Todo', createdAt: tasks[0].createdAt.toISOString(),
    }
    // Disable presentation additions to compare the legacy serialized item independently.
    reset()
    state.flags[flag] = enabled
    state.flags[keys.HTPR_6530_MCP_LIST_QUERY_FLAG] = false
    state.indexComments = [hit]
    const raw = await (await GET(new NextRequest('http://localhost/api/mcp/tasks/search?q=needle%20from:3&board_id=7'))).json()
    assert.equal(JSON.stringify(raw.tasks[0]), JSON.stringify({ ...legacyItem, ...(enabled ? { commentId: 2, commentText: hit.commentText, commentCreatedAt: hit.createdAt } : {}) }))
    assert.equal(mcp.tasks[0].commentCreatedAt, enabled ? hit.createdAt : undefined)
  }
})

test('review comment-only authors appear only in bounded accessible commenter resolver and picker pools', async () => {
  const added = [
    { id: 40, displayName: 'Comment Only', email: 'comment@example.test', members: [], tasks: [], assignees: [], comments: [comment(40, 101, 40, 'Needle apart WORD', 13)] },
    { id: 41, displayName: 'Comment Private', email: 'private-comment@example.test', members: [], tasks: [], assignees: [], comments: [comment(41, 106, 41, 'needle', 13)] },
    { id: 42, displayName: 'Comment Activity', email: 'activity@example.test', members: [], tasks: [], assignees: [], comments: [comment(42, 101, 42, 'needle', 13, { action: 'changed' })] },
    { id: 43, displayName: 'Comment Deleted', email: 'deleted@example.test', members: [], tasks: [], assignees: [], comments: [comment(43, 107, 43, 'needle', 13)] },
    { id: 44, displayName: 'Comment Elsewhere', email: 'elsewhere@example.test', members: [], tasks: [], assignees: [], comments: [{ ...comment(44, 101, 44, 'needle', 13), task: { ...tasks[0], projectId: 8 } }] },
  ]
  people.push(...added)
  try {
    for (const chips of [false, true]) {
      reset()
      const parser = chips ? parseSearchWithChipNames : parseSearchWithNames
      const parsed = await parser('commenter:comment from:comment assignee:comment', [7], true, [7], true)
      assert.deepEqual(parsed.filters.commenter[0].userIds, [40])
      assert.deepEqual(parsed.filters.from[0].userIds, [])
      assert.deepEqual(parsed.filters.assignee[0].userIds, [])
      const full = await parser('commenter:@Comment Only', [7], false, [7], true)
      assert.equal(full.filters.commenter[0].value, '@Comment Only')
      assert.equal(full.text, '')
      // Resolver must match before limiting, so it never caps the people pool (review on PR 977).
      assert.ok(state.peopleQueries.filter((args: any) => JSON.stringify(args.where).includes('comments')).every((args: any) => args.take === undefined))
      state.flags[keys.HTPR_6370_SEARCH_CHIPS_FLAG] = chips
      const pickerStart = state.peopleQueries.length
      for (const operator of ['commenter', 'from', 'assignee']) {
        const res = response()
        await valuesHandler({ method: 'GET', headers: {}, query: { operator, value: 'comment', boardId: '7' } }, res)
        assert.deepEqual(res.body.candidates.map((row: any) => row.id), operator === 'commenter' ? [40] : [])
      }
      assert.ok(state.peopleQueries.slice(pickerStart).filter((args: any) => JSON.stringify(args.where).includes('comments')).every((args: any) => args.take <= 1000))
      const resolved = response()
      await valuesHandler({ method: 'GET', headers: {}, query: { operator: 'commenter', resolve: 'Comment Only trailing text', boardId: '7' } }, resolved)
      assert.equal(resolved.body.resolved, chips ? 'Comment Only' : undefined)
      assert.deepEqual((await parser('commenter:comment@example', [7], true, [7], true)).filters.commenter[0].userIds, [40])
      assert.deepEqual((await parser('commenter:comment', [7, 8], true, [7], true)).filters.commenter[0].userIds, [40])
      assert.deepEqual((await parser('commenter:comment', [7, 8], true, [8], true)).filters.commenter[0].userIds, [44])
      const scoped = await parser('commenter:comment', [7], true, [], true)
      assert.deepEqual(scoped.filters.commenter[0].userIds, [])
    }
  } finally { people.splice(-added.length) }
})

test('review multi-word text matches non-adjacent case-insensitive words in the same author comment', async () => {
  reset()
  assert.deepEqual((await rank('NEEDLE newest commenter:1')).rankedIds, [101])
  assert.deepEqual((await rank('needle later commenter:1')).rankedIds, [])
  assert.deepEqual((await rank('needle old newest commenter:1')).rankedIds, [])
  const api = await search('NEEDLE newest commenter:1')
  assert.deepEqual(api.body.processedData.All.map((row: any) => row.commentId), [2])
  const body = await (await GET(new NextRequest('http://localhost/api/mcp/tasks/search?q=NEEDLE%20newest%20commenter:1&board_id=7'))).json()
  assert.deepEqual(body.tasks.map((row: any) => row.commentId), [2])
})

test('review paging uses bounded comment DB pages and separate full totals for cursors and explicit sorts', async () => {
  const request = async (suffix = '') => (await GET(new NextRequest(`http://localhost/api/mcp/tasks/search?q=commenter:1&board_id=7&limit=1${suffix}`)))
  reset()
  const first = await (await request()).json()
  assert.deepEqual([first.tasks[0].id, first.total, first.nextCursor], [102, 2, '102'])
  assert.equal(state.commentQueries[0].take, 1)
  assert.equal(state.commentQueries[0].having, undefined)
  assert.equal(state.detailQueries[0].where.taskId, 102)
  assert.equal(state.detailQueries.length, 1)
  assert.equal(state.countQueries[0].where.id, undefined)
  const second = await (await request('&cursor=102')).json()
  assert.deepEqual([second.tasks[0].id, second.total, second.nextCursor], [101, 2, '101'])
  assert.equal(state.commentQueries[1].take, 1)
  assert.deepEqual(state.commentQueries[1].having, { OR: [
    { createdAt: { _max: { lt: comments[3].createdAt } } },
    { createdAt: { _max: { equals: comments[3].createdAt } }, taskId: { lt: 102 } },
  ] })
  assert.deepEqual(state.anchorQueries[0].select, { createdAt: true })
  const last = await (await request('&cursor=101')).json()
  assert.equal(last.total, 2)
  assert.deepEqual(last.tasks, [])
  assert.equal((await request('&cursor=105')).status, 400)
  reset()
  const sortedFirst = await (await request('&sort=createdAt:asc')).json()
  assert.equal(sortedFirst.total, 2)
  assert.equal(sortedFirst.tasks[0].id, 101)
  const sortedSecond = await (await request('&sort=createdAt:asc&cursor=101')).json()
  assert.equal(sortedSecond.tasks[0].id, 102)
  assert.equal(sortedSecond.total, 2)
  assert.equal(state.commentQueries.length, 0)
  assert.deepEqual(state.detailQueries.map((args: any) => args.where.taskId), [101, 102])
  assert.ok(state.taskQueries.filter((args: any) => args.take !== undefined).every((args: any) => args.take === 1))
})

test('review flag-off ordinary comment output is byte-identical with either highlight mode', async () => {
  for (const highlights of [false, true]) {
    reset()
    state.flags[flag] = false
    state.flags[keys.HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG] = highlights
    const hit = { id: '2', taskId: 101, commentText: comments[1].commentText, creatorName: 'Hicham', createdAt: '2026-10-05T00:00:00.000Z' }
    state.indexComments = [hit]
    const row = {
      taskId: 101, projectId: 7, ticketNumber: 'TEST-1', taskTitle: tasks[0].title,
      descriptionText: tasks[0].description, projectTitle: 'Visible', status: 'Normal',
      updatedAt: tasks[0].updatedAt.toISOString(), uniqueIndex: 1, highlight: {},
      ...(highlights ? { searchMatch: { people: [], labels: [], commentAuthor: 'Hicham' }, commentId: 2, commentText: hit.commentText } : {}),
    }
    const expected = { processedData: { All: [row], Visible: [row] }, tabs: ['All', 'Visible'], contextProjectId: null, status: 200 }
    assert.equal(JSON.stringify((await search('needle from:3')).body), JSON.stringify(expected))
    assert.equal(state.commentQueries.length, 0)
    assert.equal(state.detailQueries.length, 0)
  }
})

test('review scanAll pages latest-per-task comment timestamps with ties and many older comments', async () => {
  const added = [
    ...Array.from({ length: 500 }, (_, i) => comment(2000 + i, 101, 1, 'older comment', 2)),
    comment(1000, 101, 1, 'latest comment at the same timestamp as task 102', 6),
  ]
  comments.push(...added)
  try {
    reset()
    const request = async (suffix = '') => (await GET(new NextRequest(`http://localhost/api/mcp/tasks/search?q=commenter:1&board_id=7&limit=1${suffix}`))).json()
    const first = await request()
    assert.deepEqual([first.tasks[0].id, first.total, first.tasks[0].commentId], [102, 2, 4])
    const second = await request('&cursor=102')
    assert.deepEqual([second.tasks[0].id, second.total, second.tasks[0].commentId], [101, 2, 1000])
    const last = await request('&cursor=101')
    assert.deepEqual(last.tasks, [])
    assert.equal(last.total, 2)
    assert.equal(state.detailQueries.length, 2)
    assert.ok(state.commentQueries.every((args: any) => args.take === 1 && args.select === undefined))
    assert.ok(state.countQueries.every((args: any) => args.where.id === undefined))
  } finally { comments.splice(-added.length) }
})
