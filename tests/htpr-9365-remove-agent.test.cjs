const test = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest } = require('next/server')
const { loader } = require('./htpr-6927-fixtures.cjs')

const user = { id: 6, email: 'fixture@example.com', displayName: 'Fixture Person', photoURL: null }
let state
const events = () => state.events

const prisma = {
  featureFlag: { findUnique: async () => null },
  task: {
    findMany: async ({ where }) => {
      state.projectScopes.push(where.project)
      if (!state.accessible) return []
      const ids = where.OR ? where.OR[0].id.in : where.id.in
      return state.tasks.filter((task) => ids.includes(task.id))
        .map(({ id, sectionId, projectId, status }) => ({ id, sectionId, projectId, status }))
    },
    findUnique: async ({ where }) => state.tasks.find((task) => task.id === where.id),
    update: async ({ where, data }) => { Object.assign(state.tasks.find((task) => task.id === where.id), data) },
  },
  user: { findUnique: async () => user },
  section: { findUnique: async () => undefined },
  agent: {
    findUnique: async () => ({ id: 'agent-lead', displayName: 'HT Product Lead' }),
    findFirst: async ({ where }) => ({ id: where.id }),
  },
  assignees: {
    findMany: async ({ where }) => {
      if (where.agentId === null) return state.humanAssignees.map((userId) => ({ userId }))
      return state.agentAssignees.map((row) => ({
        userId: row.userId,
        agentId: row.agentId,
        agent: { id: row.agentId, displayName: row.displayName },
      }))
    },
  },
  $transaction: async (run) => run(prisma),
  $executeRaw: async () => 1,
  $queryRaw: async () => [],
}

const load = loader({
  '@/lib/prisma': { __esModule: true, default: prisma },
  '@/lib/mcp/auth': {
    checkMcpRateLimit: async () => null,
    validateMcpAuth: async () => state.ctx,
  },
  '@/utils/controllers/projects/getAllIncludes': {
    getProjectWhere: (...args) => { state.projectScopeCalls.push(args); return { fixtureScope: true } },
  },
  '@/utils/controllers/assignees/assign': {
    __esModule: true,
    default: async () => ({ status: 200, json: {} }),
    clearHumanAssignees: async () => ({ status: 200, json: {} }),
  },
  '@/lib/mcp/tasks/agentMutationFence': {
    assertAgentAssignmentChangeAllowed: async () => {},
  },
  '@/lib/agents/activityAttribution': { actingAgentSelect: { id: true, displayName: true } },
  '@/lib/agents/visibility': { boardAgentVisibilityWhere: (userId) => ({ ownerUserId: userId }) },
  '@/lib/auth/session': {
    SESSION_COOKIE: 'fixture_session',
    signSession: () => 'fixture-session-token',
  },
  '@/lib/mcp/tasks/mappers': {
    taskDetailInclude: () => ({}),
    mapTaskToDetail: (task) => task,
    mapTaskToMcpGetResponse: (task) => task,
  },
  '@/lib/mcp/tasks/broadcastTaskUpdates': { broadcastTaskUpdates: async () => {} },
  '@/lib/planLimits': {
    isPlanLimitReachedError: () => false,
    planLimitResponse: () => ({ status: 402, body: { error: 'plan' } }),
  },
})

const executor = load('src/lib/mcp/tasks/updateTask.ts').executeTaskUpdate

function reset(extra = {}) {
  state = {
    events: [],
    projectScopes: [],
    projectScopeCalls: [],
    accessible: true,
    tasks: [{ id: 101, projectId: 15, sectionId: 10, status: 'Normal' }],
    humanAssignees: [],
    agentAssignees: [
      { agentId: 'agent-design', userId: 6, displayName: 'Design Pass Runner' },
      { agentId: 'agent-lead', userId: 6, displayName: 'HT Product Lead' },
    ],
    ctx: { user, agentId: 'agent-lead', teamScope: null },
    ...extra,
  }
}

function request(body) {
  return new NextRequest('http://localhost/api/mcp/tasks/update', {
    method: 'POST',
    headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function execute(body, extra = {}) {
  reset(extra)
  const input = structuredClone(body)
  const previous = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname
    events().push([path, JSON.parse(options.body)])
    return Response.json({ success: true, assignees: [] })
  }
  try {
    const result = await executor({ request: request(input), ctx: state.ctx, requestBody: input })
    return { status: result.response.status, body: await result.response.json(), writes: eventWrites() }
  } finally {
    globalThis.fetch = previous
  }
}

const eventWrites = () => events().filter(([kind]) => kind === '/api/mcp/assignees/assign')

test('a lead removes one named agent and no other assignee', async () => {
  const after = await execute({ task_id: 101, remove_agents: ['Design Pass Runner'] })
  assert.equal(after.status, 200, JSON.stringify(after.body))
  assert.deepEqual(after.writes.map(([, body]) => body), [
    { task_id: 101, agent_id: 'agent-design', intent: 'unassign' },
  ])
})

test('removal keeps human assignees untouched', async () => {
  const after = await execute(
    { task_id: 101, remove_agents: ['HT Product Lead'] },
    { humanAssignees: [985, 2547] }
  )
  assert.equal(after.status, 200, JSON.stringify(after.body))
  assert.deepEqual(after.writes.map(([, body]) => body), [
    { task_id: 101, agent_id: 'agent-lead', intent: 'unassign' },
  ])
  assert.equal(after.writes.some(([, body]) => body.user_ids !== undefined), false)
})

test('an agent id removes the same row as its display name', async () => {
  const after = await execute({ task_id: 101, remove_agents: ['agent-design'] })
  assert.equal(after.status, 200, JSON.stringify(after.body))
  assert.deepEqual(after.writes.map(([, body]) => body), [
    { task_id: 101, agent_id: 'agent-design', intent: 'unassign' },
  ])
})

test('an unassigned name removes nothing and still succeeds', async () => {
  const after = await execute({ task_id: 101, remove_agents: ['Gone Runner'] })
  assert.equal(after.status, 200, JSON.stringify(after.body))
  assert.deepEqual(after.writes, [])
})

test('two assigned agents with one name ask for the agent id', async () => {
  const after = await execute(
    { task_id: 101, remove_agents: ['Runner 6'] },
    {
      agentAssignees: [
        { agentId: 'agent-a', userId: 6, displayName: 'Runner 6' },
        { agentId: 'agent-b', userId: 6, displayName: 'Runner 6' },
      ],
    }
  )
  assert.equal(after.status, 400, JSON.stringify(after.body))
  assert.equal(after.body.field, 'remove_agents')
  assert.match(after.body.error, /agent-a/)
  assert.deepEqual(after.writes, [])
})

test('a board the agent cannot write refuses before any assignee write', async () => {
  const after = await execute({ task_id: 101, remove_agents: ['Design Pass Runner'] }, { accessible: false })
  assert.equal(after.status, 404, JSON.stringify(after.body))
  assert.equal(after.writes.length, 0)
  assert.deepEqual(state.projectScopeCalls[0], [6, 'agent-lead', null])
})

test('remove_agents is refused on an archived ticket like other assignee writes', async () => {
  const after = await execute(
    { task_id: 101, remove_agents: ['Design Pass Runner'] },
    { tasks: [{ id: 101, projectId: 15, sectionId: 10, status: 'Archive' }] }
  )
  assert.equal(after.status, 409, JSON.stringify(after.body))
  assert.deepEqual(after.writes, [])
})

test('remove_agents must be a list of agent ids or display names', async () => {
  for (const value of [[], [''], 'Design Pass Runner', [6], [true]]) {
    const after = await execute({ task_id: 101, remove_agents: value })
    assert.equal(after.status, 400, `${JSON.stringify(value)} ${JSON.stringify(after.body)}`)
    assert.equal(after.body.field, 'remove_agents')
  }
})

test('clear and remove in one call drops the agents and keeps the named people', async () => {
  const after = await execute({ task_id: 101, assignee: [985], remove_agents: ['Design Pass Runner'] }, { humanAssignees: [2547] })
  assert.equal(after.status, 200, JSON.stringify(after.body))
  assert.deepEqual(after.writes.map(([, body]) => body), [
    { task_id: 101, user_ids: [2547], mode: 'multiple', intent: 'unassign' },
    { task_id: 101, user_ids: [985], mode: 'multiple', intent: 'assign' },
    { task_id: 101, agent_id: 'agent-design', intent: 'unassign' },
  ])
})
