// Assert-based demo because this repository has no Vitest setup.
// Run after installing dependencies: npx tsx src/app/api/mcp/projects/[projectId]/route.test.ts
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>
}

async function demo() {
  process.env.DATABASE_URL =
    'postgresql://unused:unused@localhost:5432/unused'
  process.env.JWT_SECRET =
    'project-update-test-jwt-secret-at-least-32-characters'
  process.env.JWT_ISSUER = 'project-update-test'
  process.env.SESSION_SECRET =
    'project-update-session-secret-at-least-32-characters'

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
  const originalProjectUpdateMany = prismaMock.project.updateMany
  const originalFeatureFlagFindUnique = prismaMock.featureFlag.findUnique
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
  const hadRedis = Object.prototype.hasOwnProperty.call(globalWithRedis, 'redis')
  const originalRedis = globalWithRedis.redis

  const user = {
    id: 6,
    email: 'valentin.yeo@gmail.com',
    displayName: 'Valentin',
    mcpTokensRevokedAt: null,
  }
  const token = createMcpToken(user.id, user.email)
  const request = (body: unknown) =>
    new NextRequest('http://localhost/api/mcp/projects/5500', {
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
    prismaMock.featureFlag.findUnique = async () => null

    let updateArgs: Record<string, any> | undefined
    prismaMock.project.updateMany = async (args: Record<string, any>) => {
      updateArgs = args
      return { count: 1 }
    }

    const renamedResponse = await PATCH(
      request({ title: 'Agent Toolkit' }),
      { params: Promise.resolve({ projectId: '5500' }) },
    )
    const renamedBody = await json(renamedResponse)
    assert.equal(renamedResponse.status, 200)
    assert.deepEqual(renamedBody, {
      success: true,
      project: { id: 5500, title: 'Agent Toolkit' },
    })
    assert.deepEqual(updateArgs?.data, { title: 'Agent Toolkit' })
    assert.equal(updateArgs?.where.id, 5500)
    assert.equal(updateArgs?.where.status, 'Normal')
    assert.deepEqual(updateArgs?.where.OR, [
      { ownerId: 6 },
      { members: { some: { userId: 6, agentId: null } } },
    ])

    const blankResponse = await PATCH(
      request({ title: '   ' }),
      { params: Promise.resolve({ projectId: '5500' }) },
    )
    assert.equal(blankResponse.status, 400)

    prismaMock.project.updateMany = async () => ({ count: 0 })
    const missingResponse = await PATCH(
      request({ title: 'Missing' }),
      { params: Promise.resolve({ projectId: '5501' }) },
    )
    assert.equal(missingResponse.status, 404)
  } finally {
    prismaMock.project.updateMany = originalProjectUpdateMany
    prismaMock.featureFlag.findUnique = originalFeatureFlagFindUnique
    prismaMock.user.findUnique = originalUserFindUnique
    prismaMock.revokedToken.findFirst = originalRevokedTokenFindFirst
    prismaMock.logs.create = originalLogsCreate
    authApi.verifyApiKey = originalVerifyApiKey
    if (hadRedis) globalWithRedis.redis = originalRedis
    else delete globalWithRedis.redis
  }

  console.log('route.test.ts: all assertions passed')
}

demo().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
