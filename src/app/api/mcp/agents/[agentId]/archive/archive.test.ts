// Assert-based regression test for the exact managed-agent archive endpoint.
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.JWT_SECRET =
    'archive-agent-test-jwt-secret-at-least-32-characters'
  process.env.JWT_ISSUER = 'archive-agent-test'
  process.env.SESSION_SECRET =
    'archive-agent-session-secret-at-least-32-characters'

  const [
    { default: prisma },
    { auth },
    { agentTokenCredentialFields, createMcpToken },
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
  const originalRevokedTokenFindFirst = prismaMock.revokedToken.findFirst
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
  const row = {
    id: 'owned-agent',
    displayName: 'Build Agent',
    photoURL: null,
    revokedAt: null,
    archivedAt: null,
    runtimeType: 'EXTERNAL',
    ...agentTokenCredentialFields(agentToken),
  }
  const request = (token = humanToken) =>
    new NextRequest('http://localhost/api/mcp/agents/owned-agent/archive', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

  try {
    globalWithRedis.redis = {
      incr: async () => 1,
      expire: async () => 1,
    }
    prismaMock.user.findUnique = async () => user
    prismaMock.revokedToken.findFirst = async () => null
    prismaMock.logs.create = async () => ({ id: 1 })

    const findQueries: Record<string, any>[] = []
    let updateArgs: Record<string, any> | undefined
    prismaMock.agent.findFirst = async (args: Record<string, any>) => {
      findQueries.push(args)
      return { ...row }
    }
    prismaMock.agent.update = async (args: Record<string, any>) => {
      updateArgs = args
      return { ...row, archivedAt: args.data.archivedAt }
    }

    const response = await POST(
      request(),
      { params: Promise.resolve({ agentId: 'owned-agent' }) }
    )
    const body = await json(response)
    assert.equal(response.status, 200)
    assert.equal(body.success, true)
    assert.equal(body.agent.id, 'owned-agent')
    assert.equal(body.agent.archived, true)
    assert.equal(typeof body.agent.archived_at, 'string')
    assert.equal(body.agent.revoked, false)
    assert.equal(body.agent.has_token, true)
    assert.deepEqual(updateArgs?.where, { id: 'owned-agent' })
    assert.equal(updateArgs?.data.archivedAt instanceof Date, true)
    assert.deepEqual(findQueries[0].where, {
      id: 'owned-agent',
      userId: user.id,
    })

    prismaMock.agent.findFirst = async (args: Record<string, any>) =>
      args.where.id === 'owned-agent' ? { ...row } : null
    const missing = await POST(
      request(),
      { params: Promise.resolve({ agentId: 'missing-agent' }) }
    )
    const missingBody = await json(missing)
    assert.equal(missing.status, 404)
    assert.equal(missingBody.error, 'Agent not found')

    prismaMock.agent.findFirst = async () => ({ ...row })
    prismaMock.agent.update = async () => {
      throw new Error('database unavailable')
    }
    const originalError = console.error
    console.error = () => {}
    let failed: Response
    try {
      failed = await POST(
        request(),
        { params: Promise.resolve({ agentId: 'owned-agent' }) }
      )
    } finally {
      console.error = originalError
    }
    const failedBody = await json(failed)
    assert.equal(failed.status, 500)
    assert.equal(failedBody.error, 'Internal server error')

    const agentResponse = await POST(
      request(agentToken),
      { params: Promise.resolve({ agentId: 'owned-agent' }) }
    )
    const agentBody = await json(agentResponse)
    assert.equal(agentResponse.status, 403)
    assert.equal(agentBody.error, 'Agents cannot manage agents')
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

  console.log('archive.test.ts: all assertions passed')
}

demo().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
