import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { NextRequest } from 'next/server'

process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused'
process.env.JWT_SECRET = 'session-store-test-jwt-secret-at-least-32-characters'
process.env.JWT_ISSUER = 'hypertask-session-store-test'
process.env.SESSION_SECRET = 'session-store-test-session-secret-at-least-32-characters'

const globals = globalThis as typeof globalThis & {
  redis?: { get: (key: string) => Promise<string | null> }
}

test('the page token route reads the revocation store only when one is configured', async () => {
  const reads: string[] = []
  globals.redis = {
    get: async (key: string) => {
      reads.push(key)
      return '1'
    },
  }

  const require = createRequire(import.meta.url)
  const nextHeaders = require('next/headers')
  const originalCookies = nextHeaders.cookies
  const cookieValues: Record<string, string> = {}
  nextHeaders.cookies = async () => ({
    get: (name: string) =>
      cookieValues[name] === undefined
        ? undefined
        : { name, value: cookieValues[name] },
  })

  const [
    { default: prisma },
    { signSession, SESSION_COOKIE },
    { POST },
  ] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/auth/session'),
    import('../src/app/api/mcp/token/route'),
  ])

  const client = prisma as any
  const originalFindUnique = client.user.findUnique
  const previousRedisUrl = process.env.REDIS_URL
  const user = { id: 985, email: 'page-token@example.test', displayName: 'Local QA' }
  client.user.findUnique = async () => user
  cookieValues.nookies_user = JSON.stringify(user)
  cookieValues[SESSION_COOKIE] = signSession(user)
  const mint = () =>
    POST(new NextRequest('http://localhost/api/mcp/token', { method: 'POST' }))

  try {
    delete process.env.REDIS_URL
    reads.length = 0
    const withoutStore = await mint()
    assert.equal(withoutStore.status, 200)
    assert.equal(typeof (await withoutStore.json()).token, 'string')
    assert.deepEqual(reads, [])

    process.env.REDIS_URL = 'redis://127.0.0.1:6379'
    const revokedSession = await mint()
    assert.equal(revokedSession.status, 401)
    assert.ok(reads.length > 0)
  } finally {
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = previousRedisUrl
    delete globals.redis
    client.user.findUnique = originalFindUnique
    nextHeaders.cookies = originalCookies
  }
})
