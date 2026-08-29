// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/app/api/mcp/agents/rotate-token/rotate-token.test.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.JWT_SECRET =
    'rotate-agent-test-jwt-secret-at-least-32-characters'
  process.env.JWT_ISSUER = 'rotate-agent-test'
  process.env.SESSION_SECRET =
    'rotate-agent-session-secret-at-least-32-characters'

  const [
    { default: prisma },
    { auth },
    { agentTokenCredentialFields, hashAgentToken, createMcpToken, validateMcpAuth },
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
    new NextRequest(
      'http://localhost/api/mcp/agents/rotate-token',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )

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
    assert.equal(agentBody.error, 'Agents cannot rotate agent tokens')

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
      'Management key does not have permission to rotate agent tokens'
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
      runtimeType: 'EXTERNAL',
    })

    let managementOwnershipQuery: Record<string, any> | undefined
    let managementUpdate: Record<string, any> | undefined
    prismaMock.agent.findFirst = async (args: Record<string, any>) => {
      managementOwnershipQuery = args
      return { id: 'owned-agent' }
    }
    prismaMock.agent.update = async (args: Record<string, any>) => {
      managementUpdate = args
      return { id: args.where.id }
    }
    const managementResponse = await POST(
      request({ agent_id: 'owned-agent' }, 'htmk_management-test')
    )
    const managementBody = await json(managementResponse)
    assert.equal(managementResponse.status, 200)
    assert.equal(typeof managementBody.token, 'string')
    assert.deepEqual(managementOwnershipQuery?.where, {
      id: 'owned-agent',
      userId: user.id,
      runtimeType: 'EXTERNAL',
    })
    assert.deepEqual(managementUpdate?.where, { id: 'owned-agent' })
    assert.equal(managementUpdate?.data.mcpTokenExpiresAt, null)
    assert.equal(managementUpdate?.data.revokedAt, null)

    // The row keeps only the digest now, so the test tracks what was written
    // rather than a plaintext it could read back.
    let stored: { mcpTokenHash: string; mcpTokenJti: string } | null =
      null as { mcpTokenHash: string; mcpTokenJti: string } | null
    let updateNumber = 0
    prismaMock.agent.findFirst = async (args: Record<string, any>) => {
      if (args.select?.mcpTokenJti) {
        return stored ? { id: 'owned-agent', ...stored } : null
      }
      return { id: 'owned-agent' }
    }
    prismaMock.agent.update = async (args: Record<string, any>) => {
      updateNumber += 1
      const thisUpdate = updateNumber
      if (thisUpdate === 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      stored = {
        mcpTokenHash: args.data.mcpTokenHash,
        mcpTokenJti: args.data.mcpTokenJti,
      }
      assert.equal(args.data.mcpTokenExpiresAt, null)
      return { id: args.where.id }
    }

    const [firstResponse, secondResponse] = await Promise.all([
      POST(request({ agent_id: 'owned-agent' })),
      POST(request({ agent_id: 'owned-agent' })),
    ])
    const firstBody = await json(firstResponse)
    const secondBody = await json(secondResponse)
    assert.equal(firstResponse.status, 200)
    assert.equal(secondResponse.status, 200)
    assert.notEqual(firstBody.token, secondBody.token)
    assert.ok(stored)

    const storedCredential = stored as {
      mcpTokenHash: string
      mcpTokenJti: string
    }
    const storedToken =
      hashAgentToken(firstBody.token) === storedCredential.mcpTokenHash
        ? firstBody.token
        : secondBody.token
    const storedResult = await validateMcpAuth(request({}, storedToken))
    const staleToken =
      firstBody.token === storedToken ? secondBody.token : firstBody.token
    const staleResult = await validateMcpAuth(request({}, staleToken))
    assert.equal(storedResult?.agentId, 'owned-agent')
    assert.equal(
      staleResult,
      null,
      'only the token from the last completed write remains valid'
    )
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

  console.log('rotate-token.test.ts: all assertions passed')
}

demo().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
