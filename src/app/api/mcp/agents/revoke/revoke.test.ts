// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/app/api/mcp/agents/revoke/revoke.test.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.JWT_SECRET =
    'revoke-agent-test-jwt-secret-at-least-32-characters'
  process.env.JWT_ISSUER = 'revoke-agent-test'
  process.env.SESSION_SECRET =
    'revoke-agent-session-secret-at-least-32-characters'

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
  const originalAgentUpdate = prismaMock.agent.update
  const originalUserFindUnique = prismaMock.user.findUnique
  const originalRevokedTokenFindFirst =
    prismaMock.revokedToken.findFirst
  const originalLogsCreate = prismaMock.logs.create
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
    'owned-agent'
  )
  const request = (body: unknown, token = humanToken) =>
    new NextRequest('http://localhost/api/mcp/agents/revoke', {
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

    prismaMock.agent.findFirst = async (args: Record<string, any>) =>
      args.select?.mcpTokenJti
        ? { id: 'owned-agent', ...agentTokenCredentialFields(agentToken) }
        : { id: 'owned-agent' }
    const agentResponse = await POST(
      request({ agent_id: 'owned-agent' }, agentToken)
    )
    const agentBody = await json(agentResponse)
    assert.equal(agentResponse.status, 403)
    assert.equal(agentBody.error, 'Agents cannot revoke agents')

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
    const noPermissionResponse = await POST(
      request(
        { agent_id: 'owned-agent' },
        'htmk_no-permission-test'
      )
    )
    const noPermissionBody = await json(noPermissionResponse)
    assert.equal(noPermissionResponse.status, 403)
    assert.equal(
      noPermissionBody.error,
      'Management key does not have permission to revoke agents'
    )

    let ownershipQuery: Record<string, any> | undefined
    prismaMock.agent.findFirst = async (args: Record<string, any>) => {
      ownershipQuery = args
      return null
    }
    const nonOwnerResponse = await POST(
      request({ agent_id: 'someone-elses-agent' })
    )
    const nonOwnerBody = await json(nonOwnerResponse)
    assert.equal(nonOwnerResponse.status, 404)
    assert.equal(nonOwnerBody.error, 'Agent not found')
    assert.deepEqual(ownershipQuery?.where, {
      id: 'someone-elses-agent',
      userId: user.id,
    })

    const alreadyRevokedAt = new Date('2026-08-17T12:00:00.000Z')
    prismaMock.agent.findFirst = async (args: Record<string, any>) => {
      ownershipQuery = args
      return args.where.revokedAt === undefined
        ? { id: 'revoked-agent', revokedAt: alreadyRevokedAt }
        : null
    }
    prismaMock.agent.update = async () => {
      throw new Error('already-revoked agents must not be updated')
    }
    const alreadyRevokedResponse = await POST(
      request({ agent_id: 'revoked-agent' }, 'htmk_management-test')
    )
    const alreadyRevokedBody = await json(alreadyRevokedResponse)
    assert.equal(alreadyRevokedResponse.status, 409)
    assert.equal(alreadyRevokedBody.error, 'Agent already revoked')
    assert.deepEqual(ownershipQuery?.select, { id: true, revokedAt: true })

    prismaMock.agent.findFirst = async (args: Record<string, any>) => {
      ownershipQuery = args
      return { id: 'owned-agent', revokedAt: null }
    }
    let revokeUpdate: Record<string, any> | undefined
    prismaMock.agent.update = async (args: Record<string, any>) => {
      revokeUpdate = args
      return { id: args.where.id }
    }
    const revokeResponse = await POST(
      request({ agent_id: 'owned-agent' }, 'htmk_management-test')
    )
    const revokeBody = await json(revokeResponse)
    assert.equal(revokeResponse.status, 200)
    assert.equal(revokeBody.success, true)
    assert.equal(revokeBody.agent.id, 'owned-agent')
    assert.equal(
      revokeBody.agent.revoked_at,
      revokeUpdate?.data.revokedAt.toISOString()
    )
    assert.deepEqual(
      {
        where: revokeUpdate?.where,
        mcpTokenHash: revokeUpdate?.data.mcpTokenHash,
        mcpTokenJti: revokeUpdate?.data.mcpTokenJti,
      },
      {
        where: { id: 'owned-agent' },
        mcpTokenHash: null,
        mcpTokenJti: null,
      }
    )
    assert.deepEqual(ownershipQuery?.where, {
      id: 'owned-agent',
      userId: user.id,
    })

    let authAgentQuery: Record<string, any> | undefined
    prismaMock.agent.findFirst = async (args: Record<string, any>) => {
      authAgentQuery = args
      return null
    }
    const revokedResult = await validateMcpAuth(
      request({}, agentToken)
    )
    assert.equal(revokedResult, null)
    assert.deepEqual(authAgentQuery?.where, {
      id: 'owned-agent',
      userId: user.id,
      revokedAt: null,
    })
  } finally {
    prismaMock.agent.findFirst = originalAgentFindFirst
    prismaMock.agent.update = originalAgentUpdate
    prismaMock.user.findUnique = originalUserFindUnique
    prismaMock.revokedToken.findFirst =
      originalRevokedTokenFindFirst
    prismaMock.logs.create = originalLogsCreate
    authApi.verifyApiKey = originalVerifyApiKey
    if (hadRedis) globalWithRedis.redis = originalRedis
    else delete globalWithRedis.redis
  }

  console.log('revoke.test.ts: all assertions passed')
}

demo().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
