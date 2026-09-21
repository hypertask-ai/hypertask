import { env as appEnv } from "#env";
import { logger as htLogger } from "#logger";
// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/app/api/mcp/agents/[agentId]/get.test.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function demo() {
  appEnv.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  appEnv.JWT_SECRET =
    'get-agent-test-jwt-secret-at-least-32-characters'
  appEnv.JWT_ISSUER = 'get-agent-test'
  appEnv.SESSION_SECRET =
    'get-agent-session-secret-at-least-32-characters'

  const [
    { default: prisma },
    { agentTokenCredentialFields, createMcpToken },
    { GET },
  ] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/mcp/auth'),
    import('./route'),
  ])

  const prismaMock = prisma as any
  const originalAgentFindFirst = prismaMock.agent.findFirst
  const originalUserFindUnique = prismaMock.user.findUnique
  const originalRevokedTokenFindFirst = prismaMock.revokedToken.findFirst
  const originalLogsCreate = prismaMock.logs.create
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
    revokedAt: null,
    createdAt: new Date('2026-09-14T21:24:05.879Z'),
    visibility: 'PRIVATE',
    prompt: 'Finish the ticket you picked up.',
    members: [
      { project: { id: 15, name: 'hypertasks', title: 'Hypertask Product' } },
    ],
  }
  const request = (token = humanToken) =>
    new NextRequest('http://localhost/api/mcp/agents/owned-agent', {
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
    prismaMock.featureFlag = prismaMock.featureFlag ?? {}
    prismaMock.featureFlag.findUnique = async () => null
    prismaMock.agent.findFirst = async ({ where }: Record<string, any>) => {
      if (where.id !== 'owned-agent') return null
      if (where.userId && where.userId !== user.id) return null
      return { ...row, ...agentTokenCredentialFields(agentToken) }
    }

    const response = await GET(request(), {
      params: Promise.resolve({ agentId: 'owned-agent' }),
    })
    const body = await json(response)
    assert.equal(response.status, 200)
    assert.equal(body.success, true)
    assert.equal(body.agent.id, 'owned-agent')
    assert.equal(body.agent.display_name, 'Build Agent')
    assert.equal(body.agent.prompt, 'Finish the ticket you picked up.')
    assert.equal(body.agent.revoked, false)
    assert.equal(body.agent.created_at, '2026-09-14T21:24:05.879Z')
    assert.deepEqual(body.agent.boards, [{ id: 15, name: 'Hypertask Product' }])

    const missing = await GET(request(), {
      params: Promise.resolve({ agentId: 'missing-agent' }),
    })
    const missingBody = await json(missing)
    assert.equal(missing.status, 404)
    assert.equal(missingBody.error, 'Agent not found')

    const agentResponse = await GET(request(agentToken), {
      params: Promise.resolve({ agentId: 'owned-agent' }),
    })
    const agentBody = await json(agentResponse)
    assert.equal(agentResponse.status, 403)
    assert.equal(
      agentBody.error,
      'Agents cannot list managed agent identities'
    )

    prismaMock.featureFlag.findUnique = async () => ({ mode: 'OFF' })
    const flaggedOff = await GET(request(), {
      params: Promise.resolve({ agentId: 'owned-agent' }),
    })
    const flaggedOffBody = await json(flaggedOff)
    assert.equal(flaggedOff.status, 404)
    assert.equal(flaggedOffBody.error, 'Not found.')
  } finally {
    prismaMock.agent.findFirst = originalAgentFindFirst
    prismaMock.user.findUnique = originalUserFindUnique
    prismaMock.revokedToken.findFirst = originalRevokedTokenFindFirst
    prismaMock.logs.create = originalLogsCreate
    if (prismaMock.featureFlag) {
      prismaMock.featureFlag.findUnique = originalFeatureFlagFindUnique
    }
    if (hadRedis) globalWithRedis.redis = originalRedis
    else delete globalWithRedis.redis
  }

  htLogger.info('get.test.ts: all assertions passed')
}

demo().catch((error) => {
  htLogger.error(error)
  process.exitCode = 1
})
