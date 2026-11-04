const test = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest } = require('next/server')
const { load } = require('./task-route-loader.cjs')
const path = require('node:path')
const jiti = require('jiti')(__filename, { interopDefault: true, alias: { '@': path.resolve(__dirname, '../src') } })
const { getProjectListingWhere } = jiti('../src/utils/controllers/projects/getAllIncludes.ts')

function matches(value, where) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'AND') return expected.every((part) => matches(value, part))
    if (key === 'OR') return expected.some((part) => matches(value, part))
    if (key === 'some') return value.some((item) => matches(item, expected))
    if (key === 'in') return expected.includes(value)
    if (key === 'not') return value !== expected
    if (key === 'equals') return expected === require('@prisma/client').Prisma.DbNull ? value === null : value === expected
    if (expected && typeof expected === 'object') return value != null && matches(value[key], expected)
    return value[key] === expected
  })
}

const questionTime = new Date('2026-01-01T00:00:00Z')
const later = new Date('2026-01-01T00:01:00Z')
function task(id, changes = {}) {
  return {
    id, uniqueIndex: id, ticketNumber: `QA-${id}`, title: 'Decision', section: 'Waiting', projectId: 15,
    waitingOnSetAt: questionTime, blockerCommentId: id, project: { title: 'QA', name: 'qa', teamId: 'team', ownerId: 6, members: [] }, priority: null,
    blockerComment: { id, taskId: id, text: '<p>Question: Ship?</p><p>My recommendation: Yes</p>', commentText: '', activity: null, createdAt: questionTime, reactions: [] },
    status: 'Normal', waitingOnUserId: 6, comments: [], ...changes,
  }
}
function fixture({ ctx = { user: { id: 6 }, agentId: null, teamScope: null }, enabled = true, rows = [] } = {}) {
  const queries = []
  const { GET } = load('src/lib/mcp/operations/inbox/blockers/operation.ts', {
    '@/lib/mcp/routeWrapper': { wrapMcpRoute: (fn) => fn, checkMcpRouteRateLimit: async () => null, validateMcpRouteAuth: async () => ctx },
    '@/lib/mcp/auth': { createUnauthorizedResponse: () => Response.json({ success: false }, { status: 401 }) },
    '@/lib/mcp/operationCrashReport': { reportMcpOperationCrash: () => {} },
    '@/lib/flags': { isFeatureEnabled: async () => enabled },
    '@/utils/controllers/projects/getAllIncludes': { getProjectListingWhere },
    '@/lib/prisma': { default: { task: { findMany: async (query) => { queries.push(query); return rows.filter((row) => matches(row, query.where)).map((row) => ({
      ...row,
      comments: row.comments.filter((comment) => matches(comment, query.select.comments.where)),
      blockerComment: row.blockerComment && { ...row.blockerComment, reactions: row.blockerComment.reactions.filter((reaction) => matches(reaction, query.select.blockerComment.select.reactions.where)) },
    })) } } } },
  })
  return { queries, get: (query = '') => GET(new NextRequest(`https://app.hypertask.ai/api/mcp/inbox/blockers${query}`)) }
}

test('classifies marked questions and parses their text', async () => {
  const f = fixture({ rows: [task(1), task(2, { comments: [{ createdAt: later, creatorId: 6, agentId: null, agentDisplayName: null, activity: null }] }), task(3, { blockerComment: null, blockerCommentId: null }), task(4, { blockerComment: { ...task(4).blockerComment, reactions: [{ createdAt: later, userId: 6, agentId: null, agentDisplayName: null, isDeleted: false }] } })] })
  const response = await f.get()
  const { blockers, total } = await response.json()
  assert.equal(total, 4)
  assert.deepEqual(Object.keys(blockers[0]), ['id', 'ticketNumber', 'url', 'title', 'projectId', 'boardTitle', 'section', 'priority', 'waitingSince', 'blockerCommentId', 'question', 'recommendation', 'state'])
  assert.equal(response.status, 200)
  assert.deepEqual(blockers.map((row) => row.state), ['waiting', 'answered', 'no-question', 'answered'])
  assert.equal(blockers[0].question, 'Ship?')
  assert.equal(blockers[0].recommendation, 'Yes')
  assert.equal(blockers[0].url, 'https://app.hypertask.ai/detail/project-15/1')
  assert.equal(blockers[2].question, null)
})

test('queries only target human comments and reactions, excluding preserved agent identities', async () => {
  const f = fixture()
  await f.get('?user=8&projectId=15&project=16&state=waiting')
  const q = f.queries[0]
  assert.equal(q.where.waitingOnUserId, 8)
  assert.deepEqual(q.where.projectId, { in: [15, 16] })
  assert.equal(q.select.comments.where.creatorId, 8)
  assert.equal(q.select.comments.where.agentId, null)
  assert.equal(q.select.comments.where.agentDisplayName, null)
  assert.deepEqual(q.select.blockerComment.select.reactions.where, { userId: 8, agentId: null, agentDisplayName: null, isDeleted: false })
})

test('filters state and excludes replies at or before the question', async () => {
  const f = fixture({ rows: [task(1, { comments: [{ createdAt: questionTime, creatorId: 6, agentId: null, agentDisplayName: null, activity: null }] }), task(2, { comments: [{ createdAt: later, creatorId: 6, agentId: null, agentDisplayName: null, activity: null }] })] })
  const { blockers } = await (await f.get('?state=waiting')).json()
  assert.deepEqual(blockers.map((row) => row.id), [1])
})

test('enforces real human and team-bound agent board access', async () => {
  const agent = { userId: 6, revokedAt: null }
  const member = { agentId: 'agent', status: 'Accepted', agent }
  const board = (id, project) => task(id, { projectId: id, project: { title: 'QA', name: 'qa', ownerId: 99, teamId: 'team', members: [], ...project } })
  const rows = [board(1, { ownerId: 6 }), board(2, { members: [member] }), board(3, { members: [member], teamId: 'other' }), board(4, {})]
  const human = fixture({ rows })
  assert.deepEqual((await (await human.get()).json()).blockers.map((row) => row.id), [1])
  assert.deepEqual((await (await human.get('?project=4')).json()).blockers, [])
  const scoped = fixture({ rows, ctx: { user: { id: 6 }, agentId: 'agent', teamScope: { teamId: 'team', accessBinding: 'binding' } } })
  assert.deepEqual((await (await scoped.get()).json()).blockers.map((row) => row.id), [2])
  for (const id of [1, 3, 4]) assert.deepEqual((await (await scoped.get(`?project=${id}`)).json()).blockers, [])
})

test('ignores unrelated reactions and agent activity sharing the human user ID', async () => {
  const humanReaction = { userId: 6, agentId: null, agentDisplayName: null, isDeleted: false, createdAt: later }
  const humanComment = { creatorId: 6, agentId: null, agentDisplayName: null, activity: null, createdAt: later }
  const marked = task(1).blockerComment
  const f = fixture({ rows: [
    task(1, { reactions: [{ ...humanReaction, commentId: 99 }, { ...humanReaction, descriptionId: 'description' }] }),
    task(2, { comments: [{ ...humanComment, agentId: 'agent' }, { ...humanComment, agentDisplayName: 'Former agent' }] }),
    task(3, { blockerComment: { ...marked, id: 3, taskId: 3, reactions: [{ ...humanReaction, agentId: 'agent' }, { ...humanReaction, agentDisplayName: 'Former agent' }, { ...humanReaction, isDeleted: true }] } }),
    task(4, { blockerComment: { ...marked, id: 4, taskId: 4, reactions: [humanReaction] } }),
    task(5, { comments: [humanComment] }),
  ] })
  assert.deepEqual((await (await f.get()).json()).blockers.map((row) => row.state), ['waiting', 'waiting', 'waiting', 'answered', 'answered'])
})

test('returns an empty envelope and filtered totals', async () => {
  assert.deepEqual(await (await fixture().get()).json(), { success: true, blockers: [], total: 0 })
  const f = fixture({ rows: [task(1), task(2, { blockerComment: null })] })
  const result = await (await f.get('?state=waiting')).json()
  assert.equal(result.total, 1)
  assert.deepEqual(result.blockers.map((row) => row.id), [1])
})

test('rejects unauthenticated, management, disabled and invalid requests before querying', async () => {
  for (const [options, query, status] of [
    [{ ctx: null }, '', 401],
    [{ ctx: { user: { id: 6 }, management: {}, agentId: null, teamScope: null } }, '', 403],
    [{ enabled: false }, '', 404],
    [{}, '?user=0', 400], [{}, '?project=1,2', 400], [{}, '?state=other', 400], [{}, '?user=me&user=6', 400], [{}, '?project=', 400], [{}, '?user=', 400], [{}, '?state=', 400], [{}, '?state=waiting&state=answered', 400], [{}, '?projectId=2147483648', 400],
  ]) {
    const f = fixture(options)
    assert.equal((await f.get(query)).status, status)
    assert.equal(f.queries.length, 0)
  }
})
