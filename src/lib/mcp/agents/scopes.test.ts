// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/lib/mcp/agents/scopes.test.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.JWT_SECRET =
    'agent-scopes-test-jwt-secret-at-least-32-characters'
  process.env.JWT_ISSUER = 'agent-scopes-test'
  process.env.SESSION_SECRET =
    'agent-scopes-session-secret-at-least-32-characters'

  const [
    { default: prisma },
    { agentTokenCredentialFields, createMcpToken },
    { getAgentRole, requireRole },
    { executeTaskUpdate },
    { handleBatchBody },
    { POST: createBoard },
  ] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/mcp/auth'),
    import('@/lib/mcp/agents/scopes'),
    import('@/lib/mcp/tasks/updateTask'),
    import('@/lib/mcp/tasks/batchTasks'),
    import('@/app/api/mcp/teams/[teamId]/boards/route'),
  ])

  const prismaMock = prisma as any
  const originalAgentFindFirst = prismaMock.agent.findFirst
  const originalAgentFindUnique = prismaMock.agent.findUnique
  const originalTaskFindMany = prismaMock.task.findMany
  const originalUserFindUnique = prismaMock.user.findUnique
  const originalTeamFindUnique = prismaMock.team.findUnique
  const originalMemberTeamFindFirst =
    prismaMock.member_Team.findFirst
  const originalRevokedTokenFindFirst =
    prismaMock.revokedToken.findFirst
  const originalLogsCreate = prismaMock.logs.create
  const globalWithRedis = globalThis as typeof globalThis & {
    redis?: {
      incr(key: string): Promise<number>
      expire(key: string, seconds: number): Promise<number>
    }
  }
  const hadRedis = Object.prototype.hasOwnProperty.call(
    globalWithRedis,
    'redis'
  )
  const originalRedis = globalWithRedis.redis

  const user = {
    id: 6,
    email: 'valentin@example.com',
    displayName: 'Valentin',
    mcpTokensRevokedAt: null,
  }
  const humanCtx = { user, agentId: null }
  const readCtx = { user, agentId: 'read-agent' }
  const emptyCtx = { user, agentId: 'empty-agent' }
  const nullCtx = { user, agentId: 'null-agent' }
  const humanToken = createMcpToken(user.id, user.email)
  const agentTokens = new Map([
    [
      'read-agent',
      createMcpToken(user.id, user.email, undefined, 'read-agent'),
    ],
    [
      'write-agent',
      createMcpToken(user.id, user.email, undefined, 'write-agent'),
    ],
    [
      'admin-agent',
      createMcpToken(user.id, user.email, undefined, 'admin-agent'),
    ],
  ])
  const roles = new Map<string, 'read' | 'write' | 'admin'>([
    ['read-agent', 'read'],
    ['write-agent', 'write'],
    ['admin-agent', 'admin'],
  ])
  const updateRequest = new NextRequest(
    'http://localhost/api/mcp/tasks/update',
    { method: 'POST' }
  )

  try {
    let roleLookupCount = 0
    prismaMock.agent.findUnique = async ({
      where,
    }: Record<string, any>) => {
      roleLookupCount += 1
      if (where.id === 'empty-agent') return { permissions: {} }
      if (where.id === 'null-agent') return { permissions: null }
      return { permissions: { role: roles.get(where.id) } }
    }

    assert.equal(await getAgentRole(emptyCtx), 'write')
    assert.equal(await getAgentRole(nullCtx), 'write')
    assert.equal(await getAgentRole(readCtx), 'read')
    const lookupsBeforeHuman = roleLookupCount
    assert.equal(await getAgentRole(humanCtx), 'write')
    assert.equal(
      roleLookupCount,
      lookupsBeforeHuman,
      'human role resolution does not query Agent'
    )

    const readAdminError = await requireRole(readCtx, 'admin')
    assert.ok(readAdminError)
    assert.equal(readAdminError.status, 403)
    assert.deepEqual(await json(readAdminError), {
      success: false,
      error:
        "This agent's role ('read') does not permit this action; requires 'admin' or higher.",
      code: 'insufficient_scope',
    })

    const readUpdate = await executeTaskUpdate({
      request: updateRequest,
      ctx: readCtx,
      requestBody: {
        task_id: 1,
        title: 'Blocked update',
      },
    })
    assert.equal(readUpdate.response.status, 403)
    assert.equal(readUpdate.outcome, 'error')
    assert.equal(
      (await json(readUpdate.response)).code,
      'insufficient_scope'
    )

    const readBatch = await handleBatchBody(
      updateRequest,
      readCtx,
      {
        op: 'update',
        updates: [
          { task_id: 1, title: 'Blocked batch update' },
          { task_id: 2, title: 'Also blocked' },
        ],
      }
    )
    const readBatchBody = await json(readBatch)
    assert.equal(readBatch.status, 403)
    assert.equal(readBatchBody.code, 'insufficient_scope')
    assert.equal(
      readBatchBody.results,
      undefined,
      'the entire batch is rejected before workers start'
    )

    prismaMock.task.findMany = async () => []
    const humanUpdate = await executeTaskUpdate({
      request: updateRequest,
      ctx: humanCtx,
      requestBody: {
        task_id: 1,
        title: 'Human update',
      },
    })
    const humanUpdateBody = await json(humanUpdate.response)
    assert.equal(humanUpdate.response.status, 200)
    assert.equal(humanUpdate.outcome, 'not_found')
    assert.equal(humanUpdateBody.success, true)

    const humanBatch = await handleBatchBody(
      updateRequest,
      humanCtx,
      {
        op: 'update',
        updates: [null],
      }
    )
    const humanBatchBody = await json(humanBatch)
    assert.equal(humanBatch.status, 200)
    assert.equal(humanBatchBody.success, true)
    assert.equal(humanBatchBody.results[0].code, 'invalid_field')

    globalWithRedis.redis = {
      incr: async () => 1,
      expire: async () => 1,
    }
    prismaMock.user.findUnique = async () => ({
      ...user,
      accountId: 'account-one',
    })
    prismaMock.team.findUnique = async () => ({
      id: 'team-one',
      googleAccountId: 'account-one',
    })
    prismaMock.member_Team.findFirst = async () => ({ id: 1 })
    prismaMock.revokedToken.findFirst = async () => null
    prismaMock.logs.create = async () => ({ id: 1 })
    prismaMock.agent.findFirst = async ({
      where,
    }: Record<string, any>) => {
      const token = agentTokens.get(where.id)
      return token
        ? { id: where.id, ...agentTokenCredentialFields(token) }
        : null
    }

    const boardRequest = (token: string) =>
      new NextRequest(
        'http://localhost/api/mcp/teams/unused/boards',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: 'Scoped board',
            sections: [{ title: 'Todo' }],
          }),
        }
      )
    const teamParams = {
      params: Promise.resolve({ teamId: 'team-one' }),
    }

    for (const agentId of ['read-agent', 'write-agent'] as const) {
      const response = await createBoard(
        boardRequest(agentTokens.get(agentId)!),
        teamParams
      )
      const body = await json(response)
      assert.equal(response.status, 403)
      assert.equal(body.code, 'insufficient_scope')
    }

    let createBoardCallCount = 0
    const createBoardMock = async () => {
      createBoardCallCount += 1
      return {
        board: {
          id: 20,
          title: 'Scoped board',
          name: 'project-20',
          status: 'Normal' as const,
        },
        sections: [],
        labels: [],
        tasks: [],
      }
    }
    const adminResponse = await createBoard(
      boardRequest(agentTokens.get('admin-agent')!),
      teamParams,
      { createBoardFromManifest: createBoardMock }
    )
    const adminBody = await json(adminResponse)
    assert.equal(
      adminResponse.status,
      200,
      'admin agents pass the scope gate into normal board creation'
    )
    assert.equal(adminBody.success, true)

    const humanBoardResponse = await createBoard(
      boardRequest(humanToken),
      teamParams,
      { createBoardFromManifest: createBoardMock }
    )
    const humanBoardBody = await json(humanBoardResponse)
    assert.equal(
      humanBoardResponse.status,
      200,
      'human board creation remains on the normal creation path'
    )
    assert.equal(humanBoardBody.success, true)
    assert.equal(createBoardCallCount, 2)
  } finally {
    prismaMock.agent.findFirst = originalAgentFindFirst
    prismaMock.agent.findUnique = originalAgentFindUnique
    prismaMock.task.findMany = originalTaskFindMany
    prismaMock.user.findUnique = originalUserFindUnique
    prismaMock.team.findUnique = originalTeamFindUnique
    prismaMock.member_Team.findFirst =
      originalMemberTeamFindFirst
    prismaMock.revokedToken.findFirst =
      originalRevokedTokenFindFirst
    prismaMock.logs.create = originalLogsCreate
    if (hadRedis) globalWithRedis.redis = originalRedis
    else delete globalWithRedis.redis
  }

  console.log('scopes.test.ts: all assertions passed')
}

demo().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
