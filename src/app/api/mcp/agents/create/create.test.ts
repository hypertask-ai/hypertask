// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/app/api/mcp/agents/create/create.test.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.JWT_SECRET =
    'create-agent-test-jwt-secret-at-least-32-characters'
  process.env.JWT_ISSUER = 'create-agent-test'
  process.env.SESSION_SECRET =
    'create-agent-session-secret-at-least-32-characters'

  const [
    { default: prisma },
    { auth },
    { agentTokenCredentialFields, createMcpToken, validateMcpAuth },
    { POST },
  ] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/auth/betterAuth'),
    import('@/lib/mcp/auth'),
    import('./route'),
  ])

  const prismaMock = prisma as any
  const authApi = auth.api as any
  const originalAgentFindFirst = prismaMock.agent.findFirst
  const originalProjectFindFirst = prismaMock.project.findFirst
  const originalUserFindUnique = prismaMock.user.findUnique
  const originalRevokedTokenFindFirst =
    prismaMock.revokedToken.findFirst
  const originalLogsCreate = prismaMock.logs.create
  const originalTransaction = prismaMock.$transaction
  const originalVerifyApiKey = authApi.verifyApiKey
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
  const humanToken = createMcpToken(user.id, user.email)
  const agentToken = createMcpToken(
    user.id,
    user.email,
    undefined,
    'agent-caller'
  )
  const request = (token: string, body: unknown) =>
    new NextRequest('http://localhost/api/mcp/agents/create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

  try {
    globalWithRedis.redis = {
      incr: async () => 1,
      expire: async () => 1,
    }
    prismaMock.user.findUnique = async () => user
    prismaMock.revokedToken.findFirst = async () => null
    prismaMock.logs.create = async () => ({ id: 1 })
    prismaMock.agent.findFirst = async ({ where }: Record<string, any>) =>
      where.id === 'agent-caller'
        ? { id: 'agent-caller', ...agentTokenCredentialFields(agentToken) }
        : null

    const agentResponse = await POST(
      request(agentToken, { display_name: 'Nested agent' })
    )
    const agentBody = await json(agentResponse)
    assert.equal(agentResponse.status, 403)
    assert.equal(agentBody.error, 'Agents cannot create other agents')

    authApi.verifyApiKey = async ({ body }: Record<string, any>) => ({
      valid: true,
      key: {
        id: 'management-key',
        referenceId: String(user.id),
        permissions:
          body.key === 'htmk_management-test'
            ? { management: ['read', 'write'] }
            : {},
      },
    })

    const defaultManagementAuth = await validateMcpAuth(
      request('htmk_management-test', {})
    )
    assert.equal(
      defaultManagementAuth,
      null,
      'management-only keys stay blocked from ordinary MCP data routes'
    )

    const noPermissionResponse = await POST(
      request('htmk_no-permission-test', {
        display_name: 'Unauthorized management agent',
      })
    )
    const noPermissionBody = await json(noPermissionResponse)
    assert.equal(noPermissionResponse.status, 403)
    assert.equal(
      noPermissionBody.error,
      'Management key does not have permission to create agents'
    )

    prismaMock.project.findFirst = async ({
      where,
    }: Record<string, any>) => ({
      id: where.id,
      name: `project-${where.id}`,
      ownerId: user.id,
      teamId: where.id === 1 ? 'team-one' : 'team-two',
      title: `Board ${where.id}`,
    })
    const crossTeamResponse = await POST(
      request(humanToken, {
        display_name: 'Cross-team agent',
        project_ids: [1, 2],
      })
    )
    const crossTeamBody = await json(crossTeamResponse)
    assert.equal(crossTeamResponse.status, 400)
    assert.equal(crossTeamBody.code, 'invalid_field')
    assert.equal(crossTeamBody.field, 'project_ids')
    assert.equal(
      crossTeamBody.error,
      'Agents can only belong to boards in one team'
    )

    let createManyData: Array<Record<string, unknown>> | undefined
    let projectAccessQuery: Record<string, any> | undefined
    const agentCreateData: Array<Record<string, unknown>> = []
    prismaMock.project.findFirst = async (args: Record<string, any>) => {
      projectAccessQuery = args
      return {
        id: args.where.id,
        name: `project-${args.where.id}`,
        ownerId: user.id,
        teamId: 'team-one',
        title: `Board ${args.where.id}`,
      }
    }
    prismaMock.$transaction = async (callback: (tx: any) => unknown) =>
      callback({
        agent: {
          create: async (args: Record<string, any>) => {
            agentCreateData.push(args.data)
            return {
              id: 'created-agent',
              displayName: args.data.displayName,
              photoURL: 'https://files.example.com/default-agent.png',
            }
          },
          update: async (args: Record<string, any>) => {
            assert.equal(args.where.id, 'created-agent')
            assert.equal(args.data.mcpTokenExpiresAt, null)
            assert.equal(typeof args.data.mcpTokenHash, 'string')
            assert.equal(args.data.mcpTokenHash.length, 64)
            assert.equal(typeof args.data.mcpTokenJti, 'string')
            return { id: 'created-agent' }
          },
        },
        member: {
          createMany: async (args: Record<string, any>) => {
            createManyData = args.data
            return { count: args.data.length }
          },
        },
      })

    const managementResponse = await POST(
      request('htmk_management-test', {
        display_name: 'Management-created agent',
        project_ids: [1],
      })
    )
    const managementBody = await json(managementResponse)
    assert.equal(managementResponse.status, 201)
    assert.equal(managementBody.agent.display_name, 'Management-created agent')
    assert.deepEqual(agentCreateData[0], {
      displayName: 'Management-created agent',
      userId: user.id,
      permissions: { role: 'write' },
    })
    assert.deepEqual(projectAccessQuery?.where.OR, [
      { ownerId: user.id },
      {
        members: {
          some: {
            userId: user.id,
            agentId: null,
          },
        },
      },
    ])

    const successResponse = await POST(
      request(humanToken, {
        display_name: '  Build bot  ',
        project_ids: [1, 1],
      })
    )
    const successBody = await json(successResponse)
    assert.equal(successResponse.status, 201)
    assert.deepEqual(successBody.agent, {
      id: 'created-agent',
      display_name: 'Build bot',
      photo_url: 'https://files.example.com/default-agent.png',
    })
    assert.equal(typeof successBody.token, 'string')
    assert.deepEqual(agentCreateData[1], {
      displayName: 'Build bot',
      userId: user.id,
      permissions: { role: 'write' },
    })
    assert.equal(
      successBody.message,
      'Store this token securely. It will not be shown again.'
    )
    assert.deepEqual(createManyData, [
      {
        projectId: 1,
        userId: user.id,
        agentId: 'created-agent',
      },
    ])
  } finally {
    prismaMock.agent.findFirst = originalAgentFindFirst
    prismaMock.project.findFirst = originalProjectFindFirst
    prismaMock.user.findUnique = originalUserFindUnique
    prismaMock.revokedToken.findFirst =
      originalRevokedTokenFindFirst
    prismaMock.logs.create = originalLogsCreate
    prismaMock.$transaction = originalTransaction
    authApi.verifyApiKey = originalVerifyApiKey
    if (hadRedis) globalWithRedis.redis = originalRedis
    else delete globalWithRedis.redis
  }

  console.log('create.test.ts: all assertions passed')
}

demo().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
