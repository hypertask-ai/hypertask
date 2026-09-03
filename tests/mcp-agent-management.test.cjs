const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

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
        return (
          state.agents.find(
            (agent) =>
              agent.id === args.where.id && agent.userId === args.where.userId
          ) ?? null
        )
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
    // Must match Prisma's generated client key (OAuth → oAuth…), not oauth…
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
      boards: [{ id: 15, name: 'Hypertask Product' }],
    },
  ])
  assert.doesNotMatch(JSON.stringify(result), /mcpToken|token|expires/i)
  assert.equal('mcpToken' in calls.findMany[0].select, false)
  assert.equal('mcpTokenExpiresAt' in calls.findMany[0].select, false)
})

test('collapsed agent rows do not mount token-bearing connection panels', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/components/Modals/Agent/manage.modal.tsx'),
    'utf8'
  )
  const rowPanel = source.slice(
    source.indexOf('{isExpanded && ('),
    source.indexOf('</li>', source.indexOf('{isExpanded && ('))
  )

  assert.match(
    rowPanel,
    /\{isExpanded && \([\s\S]*?<AgentConnectPanel[\s\S]*?agent=\{a\}/
  )
  assert.doesNotMatch(
    source,
    /max-h-0 opacity-0[\s\S]*?<AgentConnectPanel[\s\S]*?agent=\{a\}/
  )
  assert.match(rowPanel, /token=\{agentToken\}/)
  assert.match(rowPanel, /isLoading=\{generatingAgentIds\.has\(a\.id\)\}/)
  assert.match(rowPanel, /onGenerate=\{\(\) => generateAgentToken\(a\.id\)\}/)
  assert.match(rowPanel, /onTokenChange=\{\(token\) =>/)
  assert.match(source, /tokenRequestsInFlightRef\.current\.has\(agentId\)/)
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

  const route = fs.readFileSync(
    path.join(root, 'src/lib/mcp/agents/delete.ts'),
    'utf8'
  )
  assert.match(route, /!deletedAgent[\s\S]*?'Agent not found'[\s\S]*?status: 404/)
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

test('list_agents has a strict empty schema and is registered in MCP_TOOLS', () => {
  assert.deepEqual(ListAgentsInputSchema.parse({}), {})
  assert.equal(ListAgentsInputSchema.safeParse({ include_tokens: true }).success, false)
  assert.ok(
    MCP_TOOLS.some((tool) => tool.name === 'hypertask_list_agents')
  )
})

test('token rotation reactivates a revoked agent owned by the caller', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/lib/mcp/agents/rotateToken.ts'),
    'utf8'
  )

  assert.match(
    source,
    /where:\s*\{\s*id: agentId,\s*userId: ctx\.user\.id,[\s\S]*?runtimeType: 'EXTERNAL',\s*\}/
  )
  assert.doesNotMatch(
    source,
    /findFirst\([\s\S]*?where:\s*\{[\s\S]*?revokedAt: null[\s\S]*?select:/
  )
  assert.match(
    source,
    /data:\s*\{[\s\S]*?agentTokenCredentialFields\(token\),[\s\S]*?revokedAt: null/
  )
})

test('creating a duplicate live agent name returns 409 with recovery details', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/lib/mcp/agents/create.ts'),
    'utf8'
  )
  const guard = source.slice(
    source.indexOf('const existingAgent ='),
    source.indexOf('if (\n    body.role')
  )

  assert.match(
    guard,
    /prisma\.agent\.findFirst\(\{[\s\S]*?userId: user\.id,[\s\S]*?displayName,[\s\S]*?revokedAt: null,[\s\S]*?select: \{ id: true \}/
  )
  assert.match(guard, /if \(existingAgent\)[\s\S]*?status: 409/)
  assert.match(
    guard,
    /An agent named "\$\{displayName\}" already exists \(id \$\{existingAgent\.id\}\)/
  )
  assert.match(guard, /POST \/api\/mcp\/admin\/agents\/\$\{existingAgent\.id\}\/token/)
})

test('creating an agent can reuse a revoked display name', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/lib/mcp/agents/create.ts'),
    'utf8'
  )
  const lookup = source.slice(
    source.indexOf('const existingAgent ='),
    source.indexOf('if (existingAgent)')
  )
  const afterGuard = source.slice(source.indexOf('if (existingAgent)'))

  assert.match(lookup, /revokedAt: null/)
  assert.doesNotMatch(lookup, /revokedAt:\s*\{\s*not:/)
  assert.match(afterGuard, /const result = await prisma\.\$transaction/)
})
