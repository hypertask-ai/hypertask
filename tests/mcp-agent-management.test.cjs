const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { load } = require('./task-route-loader.cjs')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(
  path.join(root, 'tests/mcp-agent-management-entry.cjs'),
  {
    interopDefault: true,
    alias: { '@': path.join(root, 'src') },
    cache: false,
  }
)

const { deleteOwnedAgent, listOwnedAgents } = jiti(
  path.join(root, 'src/lib/mcp/agents/ownedAgents.ts')
)
const { ListAgentsInputSchema } = jiti(
  path.join(root, 'src/lib/mcp-server/validations/agent.validation.ts')
)
const {
  ArchiveAgentInputSchema,
  DeleteAgentInputSchema,
} = jiti(path.join(root, 'src/lib/mcp-server/validations/management.validation.ts'))
const { ManagementService } = jiti(
  path.join(root, 'src/lib/mcp-server/lib/services/management.service.ts')
)
const { MCP_TOOLS } = jiti(
  path.join(root, 'src/lib/mcp-server/tools/index.ts')
)

function createDatabase({
  agents,
  assignments = [],
  memberships = [],
  comments = [],
}) {
  const state = {
    agents: agents.map((agent) => ({ ...agent })),
    assignments: assignments.map((assignment) => ({ ...assignment })),
    memberships: memberships.map((membership) => ({ ...membership })),
    comments: comments.map((comment) => ({ ...comment })),
  }
  const calls = {
    findMany: [],
    findFirst: [],
    assignmentDeletes: [],
    assignmentUpdates: [],
    membershipDeletes: [],
    agentDeletes: [],
    commentUpdates: [],
    transactionOptions: [],
  }

  const transaction = {
    agent: {
      findMany: async (args) => {
        calls.findMany.push(args)
        return state.agents.filter(
          (agent) =>
            agent.userId === args.where.userId &&
            (args.where.archivedAt === undefined ||
              agent.archivedAt === args.where.archivedAt)
        )
      },
      findFirst: async (args) => {
        calls.findFirst.push(args)
        const found = state.agents.find(
          (agent) =>
            agent.id === args.where.id && agent.userId === args.where.userId
        )
        return found ? { ...found } : null
      },
      updateMany: async (args) => {
        const matchingAgent = state.agents.find(
          (agent) =>
            agent.id === args.where.id && agent.userId === args.where.userId
        )
        if (!matchingAgent) return { count: 0 }
        matchingAgent.runtimeGeneration += args.data.runtimeGeneration.increment
        return { count: 1 }
      },
      delete: async (args) => {
        calls.agentDeletes.push(args)
        state.agents = state.agents.filter(
          (agent) => agent.id !== args.where.id
        )
      },
    },
    assignees: {
      deleteMany: async (args) => {
        calls.assignmentDeletes.push(args)
        const before = state.assignments.length
        state.assignments = state.assignments.filter(
          (assignment) => assignment.agentId !== args.where.agentId
        )
        return { count: before - state.assignments.length }
      },
      updateMany: async (args) => {
        calls.assignmentUpdates.push(args)
        let count = 0
        state.assignments = state.assignments.map((assignment) => {
          if (assignment.agentAssignerId !== args.where.agentAssignerId) {
            return assignment
          }
          count += 1
          return { ...assignment, ...args.data }
        })
        return { count }
      },
    },
    member: {
      deleteMany: async (args) => {
        calls.membershipDeletes.push(args)
        const before = state.memberships.length
        state.memberships = state.memberships.filter(
          (membership) => membership.agentId !== args.where.agentId
        )
        return { count: before - state.memberships.length }
      },
    },
    comment: {
      updateMany: async (args) => {
        calls.commentUpdates.push(args)
        let count = 0
        state.comments = state.comments.map((comment) => {
          if (comment.agentId !== args.where.agentId) return comment
          count += 1
          return { ...comment, ...args.data }
        })
        return { count }
      },
    },
  }

  const cleanupModels = [
    ['follower', 'deleteMany'],
    ['taskLease', 'deleteMany'],
    ['section', 'updateMany'],
    ['task', 'updateMany'],
    ['page', 'updateMany'],
    ['report', 'updateMany'],
    ['taskEvidence', 'updateMany'],
    ['taskSession', 'updateMany'],
    ['decisionRequest', 'updateMany'],
    ['description', 'updateMany'],
    ['priority', 'updateMany'],
    ['estimate', 'updateMany'],
    ['notification', 'updateMany'],
    ['webhookSubscription', 'updateMany'],
    ['oAuthAuthorizationCode', 'updateMany'],
    ['chatSession', 'updateMany'],
  ]
  for (const [model, operation] of cleanupModels) {
    const callName = `${model}${operation === 'deleteMany' ? 'Deletes' : 'Updates'}`
    calls[callName] = []
    transaction[model] = {
      [operation]: async (args) => {
        calls[callName].push(args)
        return { count: 0 }
      },
    }
  }

  return {
    database: {
      ...transaction,
      $transaction: async (callback, options) => {
        calls.transactionOptions.push(options)
        return callback(transaction)
      },
    },
    state,
    calls,
  }
}

function agent(overrides = {}) {
  return {
    id: 'owned-agent',
    userId: 6,
    displayName: 'Build Agent',
    revokedAt: null,
    archivedAt: null,
    runtimeGeneration: 1,
    createdAt: new Date('2026-08-06T10:00:00.000Z'),
    visibility: 'PRIVATE',
    mcpToken: 'must-never-leak',
    mcpTokenExpiresAt: new Date('2026-09-06T10:00:00.000Z'),
    members: [
      {
        project: {
          id: 15,
          name: 'project-15',
          title: 'Hypertask Product',
        },
      },
    ],
    ...overrides,
  }
}

test('agent list excludes all token material', async () => {
  const { database, calls } = createDatabase({ agents: [agent()] })

  const result = await listOwnedAgents(database, 6)

  assert.deepEqual(result, [
    {
      id: 'owned-agent',
      display_name: 'Build Agent',
      revoked: false,
      created_at: '2026-08-06T10:00:00.000Z',
      visibility: 'PRIVATE',
      boards: [{ id: 15, name: 'Hypertask Product' }],
    },
  ])
  assert.doesNotMatch(JSON.stringify(result), /mcpToken|token|expires/i)
  assert.equal('mcpToken' in calls.findMany[0].select, false)
  assert.equal('mcpTokenExpiresAt' in calls.findMany[0].select, false)
})

test('agent list says whether each agent is team-bound only when asked, without the team or binding', async () => {
  const { database, calls } = createDatabase({
    agents: [
      agent({ id: 'bound-agent', credentialTeamId: 'team-a', credentialTeamAccessBinding: 'owner:fixture:1' }),
      agent({ id: 'unbound-agent', credentialTeamId: null }),
    ],
  })

  const shown = await listOwnedAgents(database, 6, undefined, { teamBound: true })
  const hidden = await listOwnedAgents(database, 6)

  assert.deepEqual(shown.map(({ id, team_bound }) => [id, team_bound]), [['bound-agent', true], ['unbound-agent', false]])
  assert.equal(hidden.some((row) => 'team_bound' in row), false)
  assert.equal(calls.findMany[0].select.credentialTeamId, true)
  assert.equal('credentialTeamAccessBinding' in calls.findMany[0].select, false)
  assert.doesNotMatch(JSON.stringify(shown), /team-a|owner:fixture/)
})

test('agent list returns only agents owned by the authenticated user', async () => {
  const { database, calls } = createDatabase({
    agents: [
      agent(),
      agent({ id: 'other-agent', userId: 42, displayName: 'Not Owned' }),
    ],
  })

  const result = await listOwnedAgents(database, 6)

  assert.deepEqual(result.map(({ id }) => id), ['owned-agent'])
  assert.deepEqual(calls.findMany[0].where, { userId: 6, archivedAt: null })
})

test('team-scoped agent list applies the exact-team predicate', async () => {
  const { database, calls } = createDatabase({ agents: [agent()] })

  await listOwnedAgents(database, 6, 'team-a')

  assert.deepEqual(calls.findMany[0].where, {
    userId: 6,
    archivedAt: null,
    members: {
      some: { project: { teamId: 'team-a' } },
      none: {
        project: {
          OR: [{ teamId: null }, { teamId: { not: 'team-a' } }],
        },
      },
    },
  })
})

test('agent list hides archived owned agents', async () => {
  const { database, calls } = createDatabase({
    agents: [
      agent(),
      agent({ id: 'archived-agent', archivedAt: new Date('2026-08-07T00:00:00.000Z') }),
    ],
  })

  const result = await listOwnedAgents(database, 6)

  assert.deepEqual(result.map(({ id }) => id), ['owned-agent'])
  assert.deepEqual(calls.findMany[0].where, { userId: 6, archivedAt: null })
})

test('delete refuses an unowned agent without changing related rows', async () => {
  const { database, calls } = createDatabase({
    agents: [agent({ userId: 42 })],
    assignments: [{ id: 1, agentId: 'owned-agent' }],
    memberships: [{ id: 1, agentId: 'owned-agent' }],
  })

  const result = await deleteOwnedAgent(database, 6, 'owned-agent')

  assert.equal(result, null)
  assert.deepEqual(calls.findFirst[0].where, {
    id: 'owned-agent',
    userId: 6,
  })
  assert.equal(calls.assignmentDeletes.length, 0)
  assert.equal(calls.membershipDeletes.length, 0)
  assert.equal(calls.agentDeletes.length, 0)
})

test('delete request refuses an unowned agent and a team-scoped management key', async () => {
  const deleted = []
  const deletion = async (...args) => {
    deleted.push(args)
    return null
  }
  const request = () =>
    new Request('http://localhost/api/mcp/agents/owned-agent', {
      method: 'DELETE',
    })

  const { handleDeleteAgentRequest } = load('src/lib/mcp/agents/delete.ts', {
    '@/lib/prisma': { default: {} },
    '@/lib/mcp/auth': {
      checkMcpRateLimit: async () => null,
      validateMcpAuth: async () => ({ user: { id: 6 }, agentId: null }),
    },
    '@/lib/mcp/managementPermissions': { hasManagementWritePermission: () => true },
    '@/lib/agents/runtimeState': { clearAgentRuntimeSnapshot: async () => {} },
    './ownedAgents': { deleteOwnedAgent: deletion },
  })
  const notFound = await handleDeleteAgentRequest(request(), 'owned-agent')

  assert.equal(notFound.status, 404)
  assert.equal((await notFound.json()).error, 'Agent not found')
  assert.deepEqual(deleted[0].slice(0, 3), [{}, 6, 'owned-agent'])

  const teamScoped = load('src/lib/mcp/agents/delete.ts', {
    '@/lib/prisma': { default: {} },
    '@/lib/mcp/auth': {
      checkMcpRateLimit: async () => null,
      validateMcpAuth: async () => ({
        user: { id: 6 },
        agentId: null,
        management: { teamId: 'team-a', permissions: { management: ['write'] } },
      }),
    },
    '@/lib/mcp/managementPermissions': { hasManagementWritePermission: () => true },
    '@/lib/agents/runtimeState': { clearAgentRuntimeSnapshot: async () => {} },
    './ownedAgents': { deleteOwnedAgent: deletion },
  })
  const forbidden = await teamScoped.handleDeleteAgentRequest(
    request(),
    'owned-agent'
  )

  assert.equal(forbidden.status, 403)
  assert.equal(
    (await forbidden.json()).error,
    'Team-scoped management keys cannot delete agents'
  )
  assert.equal(deleted.length, 1)
})

test('delete stays successful when post-commit runtime cleanup fails', async () => {
  const { database, state, calls } = createDatabase({ agents: [agent()] })
  const fenceCalls = []
  const originalWarn = console.warn
  console.warn = () => {}

  try {
    const result = await deleteOwnedAgent(
      database,
      6,
      'owned-agent',
      async (...args) => {
        fenceCalls.push(args)
        throw new Error('Redis unavailable')
      }
    )

    assert.equal(result.id, 'owned-agent')
    assert.deepEqual(fenceCalls, [['owned-agent', 2]])
    assert.deepEqual(state.agents, [])
    assert.equal(calls.agentDeletes.length, 1)
  } finally {
    console.warn = originalWarn
  }
})

test('delete clears task assignments and board memberships before the agent', async () => {
  const { database, state, calls } = createDatabase({
    agents: [agent()],
    assignments: [
      { id: 1, agentId: 'owned-agent' },
      { id: 2, agentId: 'other-agent', agentAssignerId: 'owned-agent' },
      { id: 3, agentId: 'other-agent', agentAssignerId: 'other-agent' },
    ],
    memberships: [
      { id: 1, agentId: 'owned-agent' },
      { id: 2, agentId: 'other-agent' },
    ],
    comments: [
      { id: 1, agentId: 'owned-agent', agentDisplayName: null },
      { id: 2, agentId: 'other-agent', agentDisplayName: null },
    ],
  })

  const result = await deleteOwnedAgent(database, 6, 'owned-agent')

  assert.deepEqual(result, {
    id: 'owned-agent',
    deleted_board_memberships: 1,
    deleted_task_assignments: 1,
    comment_tombstones: 1,
  })
  assert.deepEqual(state.assignments, [
    { id: 2, agentId: 'other-agent', agentAssignerId: null },
    { id: 3, agentId: 'other-agent', agentAssignerId: 'other-agent' },
  ])
  assert.deepEqual(state.memberships, [{ id: 2, agentId: 'other-agent' }])
  assert.deepEqual(state.comments, [
    { id: 1, agentId: null, agentDisplayName: 'Build Agent' },
    { id: 2, agentId: 'other-agent', agentDisplayName: null },
  ])
  assert.deepEqual(state.agents, [])
  assert.deepEqual(calls.assignmentDeletes[0].where, {
    agentId: 'owned-agent',
  })
  assert.deepEqual(calls.assignmentUpdates[0], {
    where: { agentAssignerId: 'owned-agent' },
    data: { agentAssignerId: null },
  })
  assert.deepEqual(calls.commentUpdates[0], {
    where: { agentId: 'owned-agent' },
    data: { agentId: null, agentDisplayName: 'Build Agent' },
  })
  assert.deepEqual(calls.notificationUpdates, [
    { where: { agentId: 'owned-agent' }, data: { agentId: null } },
    { where: { fromAgentId: 'owned-agent' }, data: { fromAgentId: null } },
  ])
  assert.deepEqual(calls.transactionOptions[0], {
    isolationLevel: 'Serializable',
    timeout: 30_000,
  })
})

test('archive and delete schemas are strict and MCP tools call owned-agent routes', async () => {
  assert.deepEqual(ArchiveAgentInputSchema.parse({ agent_id: '  agent/1  ' }), {
    agent_id: 'agent/1',
  })
  assert.deepEqual(DeleteAgentInputSchema.parse({ agent_id: 'agent/1' }), {
    agent_id: 'agent/1',
  })
  assert.equal(
    ArchiveAgentInputSchema.safeParse({ agent_id: 'agent-1', extra: true })
      .success,
    false
  )
  assert.equal(
    DeleteAgentInputSchema.safeParse({ agent_id: 'agent-1', extra: true })
      .success,
    false
  )

  const requests = []
  const service = new ManagementService({
    makeRequest: async (...args) => {
      requests.push(args)
      return { success: true }
    },
  })
  await service.archiveAgent({ agent_id: ' agent/1 ' })
  await service.deleteAgent({ agent_id: ' agent/1 ' })

  assert.deepEqual(
    requests.map(([path, options]) => [path, options.method]),
    [
      ['/mcp/agents/agent%2F1/archive', 'POST'],
      ['/mcp/agents/agent%2F1', 'DELETE'],
    ]
  )
  assert.ok(MCP_TOOLS.some((tool) => tool.name === 'hypertask_archive_agent'))
  assert.ok(MCP_TOOLS.some((tool) => tool.name === 'hypertask_delete_agent'))
})

test('createAgent uses the personal-sign-in route only when asked (HTPR-7118)', async () => {
  const requests = []
  const service = new ManagementService({
    makeRequest: async (...args) => {
      requests.push(args)
      return { success: true }
    },
  })
  await service.createAgent({ display_name: 'Bot' })
  await service.createAgent({ display_name: 'Bot' }, { useBearerRoute: true })
  assert.deepEqual(
    requests.map(([path, options]) => [path, options.method]),
    [
      ['/mcp/admin/agents', 'POST'],
      ['/mcp/agents/create', 'POST'],
    ]
  )
})

test('/mcp/agents/create is routed before the agent id route (HTPR-7118)', async () => {
  const hits = []
  const { executeMcpOperation } = load('src/lib/mcp/operations/index.ts', {
    './agents/create/operation': {
      POST: async () => {
        hits.push('create')
        return new Response(null, { status: 201 })
      },
    },
    './agents/[agentId]/operation': {
      POST: async () => {
        hits.push('by-id')
        return new Response(null, { status: 200 })
      },
    },
  })

  const response = await executeMcpOperation({
    nextUrl: { pathname: '/mcp/agents/create' },
    method: 'POST',
  })

  assert.equal(response.status, 201)
  assert.deepEqual(hits, ['create'])
})

test('creating an agent refuses a board the person cannot access (HTPR-7118)', async () => {
  const projectQueries = []
  let transactions = 0
  const tx = {
    project: { findFirst: async (args) => {
      projectQueries.push(args)
      return null
    } },
    agent: { create: async () => assert.fail('Denied admission must not create an agent') },
    member: { createMany: async () => assert.fail('Denied admission must not grant membership') },
  }
  const prisma = {
    agent: { findFirst: async () => null },
    $transaction: async (run, options) => {
      transactions += 1
      assert.deepEqual(options, { isolationLevel: 'Serializable' })
      return run(tx)
    },
  }
  const { createAgentForUser } = load('src/lib/mcp/agents/create.ts', {
    '@/lib/prisma': { default: prisma },
    '@/lib/agents/crossTeam': { crossTeamAgentsEnabled: async () => false },
    '@/lib/mcp/auth': {},
    '@/lib/mcp/agents/delegatedAccess': {},
    '@/utils/controllers/projects/getAllIncludes': {},
    '@/utils/controllers/agents/ensureDefaultTeamAgent': {},
  })
  const response = await createAgentForUser(
    new Request('http://localhost/api/mcp/agents/create', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'Bot', project_ids: [99] }),
    }),
    { id: 6, email: 'person@example.com' }
  )
  assert.equal(response.status, 403)
  assert.equal(
    (await response.json()).error,
    'You do not have access to project 99'
  )
  assert.deepEqual(projectQueries[0].where.OR, [
    { ownerId: 6 },
    { members: { some: { userId: 6, agentId: null } } },
  ])
  assert.equal(transactions, 1)
})

test('list_agents has a strict empty schema and is registered in MCP_TOOLS', () => {
  assert.deepEqual(ListAgentsInputSchema.parse({}), {})
  assert.equal(ListAgentsInputSchema.safeParse({ include_tokens: true }).success, false)
  assert.ok(
    MCP_TOOLS.some((tool) => tool.name === 'hypertask_list_agents')
  )
})

test('token rotation reactivates a revoked agent owned by the caller', async () => {
  const queries = []
  const updates = []
  const prisma = {
    agent: {
      findFirst: async (args) => {
        queries.push(args)
        return { id: 'owned-agent', runtimeGeneration: 3 }
      },
      updateMany: async (args) => {
        updates.push(args)
        return { count: 1 }
      },
    },
  }
  const { handleRotateAgentTokenRequest } = load(
    'src/lib/mcp/agents/rotateToken.ts',
    {
      '@/lib/prisma': { default: prisma },
      '@/lib/mcp/auth': {
        agentTokenCredentialFields: () => ({ mcpTokenHash: 'rotated-hash' }),
        checkMcpRateLimit: async () => null,
        createMcpToken: () => 'rotated-token',
        managementAgentTokenScope: () => null,
        validateMcpAuth: async () => ({
          user: { id: 6, email: 'person@example.com' },
          agentId: null,
        }),
      },
      '@/lib/mcp/managementKeyTeamScope': { agentWithinTeamWhere: () => ({}) },
    }
  )

  const response = await handleRotateAgentTokenRequest(
    new Request('http://localhost/api/mcp/admin/agents/owned-agent/token', {
      method: 'POST',
    }),
    'owned-agent'
  )

  assert.equal(response.status, 200)
  assert.deepEqual(queries[0].where, {
    id: 'owned-agent',
    userId: 6,
    runtimeType: 'EXTERNAL',
  })
  assert.deepEqual(updates[0].where, {
    id: 'owned-agent',
    userId: 6,
    runtimeType: 'EXTERNAL',
    runtimeGeneration: 3,
  })
  assert.deepEqual(updates[0].data, {
    mcpTokenHash: 'rotated-hash',
    mcpTokenExpiresAt: null,
    credentialTeamId: null,
    credentialTeamAccessBinding: null,
    revokedAt: null,
    runtimeGeneration: { increment: 1 },
  })
  assert.equal((await response.json()).token, 'rotated-token')
})

test('creating a duplicate live agent name returns 409 with recovery details', async () => {
  const agents = [agent()]
  const prisma = {
    agent: {
      findFirst: async ({ where }) =>
        agents.find((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value)
        ) ?? null,
      create: async () => assert.fail('A refused duplicate must not create an agent'),
    },
    $transaction: async () => assert.fail('A refused duplicate must not open a transaction'),
  }
  const { createAgentForUser } = load('src/lib/mcp/agents/create.ts', {
    '@/lib/prisma': { default: prisma },
    '@/lib/agents/crossTeam': { crossTeamAgentsEnabled: async () => false },
    '@/lib/mcp/auth': {
      createMcpToken: () => assert.fail('A refused duplicate must not mint a token'),
      agentTokenCredentialFields: () => ({}),
    },
    '@/utils/controllers/agents/boardMembers': {},
    '@/utils/controllers/agents/ensureDefaultTeamAgent': {},
  })
  const response = await createAgentForUser(
    new Request('http://localhost/api/mcp/agents/create', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'Build Agent' }),
    }),
    { id: 6, email: 'person@example.com' }
  )

  assert.equal(response.status, 409)
  const { success, error } = await response.json()

  assert.equal(success, false)
  assert.match(error, /An agent named "Build Agent" already exists \(id owned-agent\)/)
  assert.match(error, /POST \/api\/mcp\/admin\/agents\/owned-agent\/token/)
})

test('creating an agent can reuse a revoked display name', async () => {
  const revoked = agent({ revokedAt: new Date('2026-10-27T00:00:00Z') })
  const agents = [revoked]
  const prisma = {
    agent: {
      findFirst: async ({ where }) => agents.find((row) =>
        Object.entries(where).every(([key, value]) => row[key] === value)
      ) ?? null,
      create: async ({ data }) => {
        const created = { id: 'new-agent', photoURL: null, revokedAt: null, ...data }
        agents.push(created)
        return created
      },
      update: async ({ where, data }) => {
        const row = agents.find((row) => row.id === where.id)
        Object.assign(row, data)
        return row
      },
    },
    $transaction: async (run, options) => {
      assert.deepEqual(options, { isolationLevel: 'Serializable' })
      return run(prisma)
    },
  }
  const { createAgentForUser } = load('src/lib/mcp/agents/create.ts', {
    '@/lib/prisma': { default: prisma },
    '@/lib/agents/crossTeam': { crossTeamAgentsEnabled: async () => false },
    '@/lib/mcp/auth': {
      createMcpToken: () => 'new-agent-token',
      agentTokenCredentialFields: () => ({ mcpTokenHash: 'new-token-hash' }),
    },
    '@/utils/controllers/agents/boardMembers': {},
    '@/utils/controllers/agents/ensureDefaultTeamAgent': {},
  })
  const response = await createAgentForUser(
    new Request('http://localhost/api/mcp/agents/create', {
      method: 'POST',
      body: JSON.stringify({ display_name: revoked.displayName }),
    }),
    { id: revoked.userId, email: 'person@example.com' }
  )
  assert.equal(response.status, 201)
  const body = await response.json()
  assert.equal(body.agent.id, 'new-agent')
  assert.equal(body.agent.display_name, revoked.displayName)
  assert.equal(body.token, 'new-agent-token')
  assert.equal(agents.length, 2)
  assert.equal(agents[0], revoked)
  assert.ok(agents[0].revokedAt instanceof Date)
  assert.equal(agents[1].revokedAt, null)
  assert.equal(agents[1].mcpTokenHash, 'new-token-hash')
})
