// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/app/api/mcp/agents/[agentId]/rename.test.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.JWT_SECRET =
    'rename-agent-test-jwt-secret-at-least-32-characters'
  process.env.JWT_ISSUER = 'rename-agent-test'
  process.env.SESSION_SECRET =
    'rename-agent-session-secret-at-least-32-characters'

  const [
    { default: prisma },
    { auth },
    { createMcpToken },
    { PATCH },
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
  const row = {
    id: 'owned-agent',
    displayName: 'Old display name',
    photoURL: null,
    revokedAt: null,
    archivedAt: null,
    runtimeType: 'EXTERNAL',
    mcpTokenHash: 'a'.repeat(64),
    mcpTokenJti: 'agent-token-generation',
  }
  const request = (body: unknown, token = humanToken) =>
    new NextRequest('http://localhost/api/mcp/agents/owned-agent', {
      method: 'PATCH',
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

    let updateArgs: Record<string, any> | undefined
    prismaMock.agent.findFirst = async () => ({ ...row })
    prismaMock.agent.update = async (args: Record<string, any>) => {
      updateArgs = args
      return { ...row, displayName: args.data.displayName }
    }

    const renamedResponse = await PATCH(
      request({ display_name: '  Release Helper  ' }),
      { params: Promise.resolve({ agentId: 'owned-agent' }) }
    )
    const renamedBody = await json(renamedResponse)
    assert.equal(renamedResponse.status, 200)
    assert.equal(renamedBody.success, true)
    assert.equal(renamedBody.agent.display_name, 'Release Helper')
    assert.deepEqual(updateArgs?.where, { id: 'owned-agent' })
    assert.deepEqual(updateArgs?.data, { displayName: 'Release Helper' })

    const invalidResponse = await PATCH(
      request({ display_name: 42 }),
      { params: Promise.resolve({ agentId: 'owned-agent' }) }
    )
    const invalidBody = await json(invalidResponse)
    assert.equal(invalidResponse.status, 400)
    assert.equal(invalidBody.code, 'invalid_field')
    assert.equal(invalidBody.field, 'display_name')

    const blankResponse = await PATCH(
      request({ display_name: '   ' }),
      { params: Promise.resolve({ agentId: 'owned-agent' }) }
    )
    const blankBody = await json(blankResponse)
    assert.equal(blankResponse.status, 400)
    assert.equal(blankBody.field, 'display_name')

    prismaMock.agent.findFirst = async () => null
    const missingResponse = await PATCH(
      request({ display_name: 'Missing agent' }),
      { params: Promise.resolve({ agentId: 'missing-agent' }) }
    )
    const missingBody = await json(missingResponse)
    assert.equal(missingResponse.status, 404)
    assert.equal(missingBody.error, 'Agent not found')
  } finally {
    prismaMock.agent.findFirst = originalAgentFindFirst
    prismaMock.agent.update = originalAgentUpdate
    prismaMock.user.findUnique = originalUserFindUnique
    prismaMock.revokedToken.findFirst = originalRevokedTokenFindFirst
    prismaMock.logs.create = originalLogsCreate
    authApi.verifyApiKey = originalVerifyApiKey
    if (hadRedis) globalWithRedis.redis = originalRedis
    else delete globalWithRedis.redis
  }

  console.log('rename.test.ts: all assertions passed')
}

demo().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
