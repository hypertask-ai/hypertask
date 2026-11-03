import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.JWT_SECRET =
    'list-agents-refusal-test-jwt-secret-at-least-32'
  process.env.JWT_ISSUER = 'list-agents-refusal-test'
  process.env.SESSION_SECRET =
    'list-agents-refusal-session-secret-at-least-32'

  const [
    { default: prisma },
    { agentTokenCredentialFields, createMcpToken },
    { handleListAgentsRequest },
  ] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/mcp/auth'),
    import('@/lib/mcp/agents/list'),
  ])

  const prismaMock = prisma as any
  const originalAgentFindFirst = prismaMock.agent.findFirst
  const originalUserFindUnique = prismaMock.user.findUnique
  const originalRevokedTokenFindFirst = prismaMock.revokedToken.findFirst
  const originalLogsCreate = prismaMock.logs.create
  const originalMemberFindMany = prismaMock.member.findMany
  const originalFeatureFlagFindUnique = prismaMock.featureFlag?.findUnique
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
    email: 'valentin.yeo@gmail.com',
    displayName: 'Valentin',
    mcpTokensRevokedAt: null,
  }
  const agentToken = createMcpToken(user.id, user.email, undefined, 'owned-agent')

  const request = (token: string) =>
    new NextRequest('http://localhost/api/mcp/admin/agents?teamId=15', {
      method: 'GET',
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
    prismaMock.member.findMany = async () => []
    prismaMock.featureFlag = prismaMock.featureFlag ?? {}
    prismaMock.featureFlag.findUnique = async () => null
    prismaMock.agent.findFirst = async ({ where }: Record<string, any>) => {
      if (where.id !== 'owned-agent') return null
      return {
        id: 'owned-agent',
        displayName: 'Runner 2',
        revokedAt: null,
        runtimeGeneration: 1,
        ...agentTokenCredentialFields(agentToken),
      }
    }

    const agentResponse = await handleListAgentsRequest(
      request(agentToken),
      'management'
    )
    const agentBody = await json(agentResponse)
    assert.equal(agentResponse.status, 403)
    assert.equal(agentBody.success, false)
    assert.match(agentBody.error, /Agents cannot list managed agent identities/)
    assert.match(agentBody.error, /hypertask projects members/)
    assert.match(agentBody.error, /hypertask task assign/)

    const badResponse = await handleListAgentsRequest(
      request('not-a-real-token'),
      'management'
    )
    const badBody = await json(badResponse)
    assert.equal(badResponse.status, 401)
    assert.equal(
      badBody.error,
      'Unauthorized. Invalid or missing authentication token.'
    )
  } finally {
    prismaMock.agent.findFirst = originalAgentFindFirst
    prismaMock.user.findUnique = originalUserFindUnique
    prismaMock.revokedToken.findFirst = originalRevokedTokenFindFirst
    prismaMock.logs.create = originalLogsCreate
    prismaMock.member.findMany = originalMemberFindMany
    if (prismaMock.featureFlag) {
      prismaMock.featureFlag.findUnique = originalFeatureFlagFindUnique
    }
    if (hadRedis) globalWithRedis.redis = originalRedis
    else delete globalWithRedis.redis
  }

  console.log('list.test.ts: all assertions passed')
}

demo().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
