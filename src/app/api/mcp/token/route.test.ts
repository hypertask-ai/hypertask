// Run with: npx tsx src/app/api/mcp/token/route.test.ts
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mock } from 'node:test'
import { NextRequest } from 'next/server'
import jwt from 'jsonwebtoken'

async function demo() {
  process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused'
  process.env.JWT_SECRET = 'page-token-test-jwt-secret-at-least-32-characters'
  process.env.JWT_ISSUER = 'hypertask-page-token-test'
  process.env.SESSION_SECRET = 'page-token-test-session-secret-at-least-32-characters'

  const require = createRequire(import.meta.url)
  const nextHeaders = require('next/headers')
  const originalCookies = nextHeaders.cookies
  const cookieValues: Record<string, string> = {}
  nextHeaders.cookies = async () => ({
    get: (name: string) => cookieValues[name] === undefined
      ? undefined
      : { name, value: cookieValues[name] },
  })

  const [
    { default: prisma },
    { signSession, SESSION_COOKIE },
    { createMcpToken, validateMcpAuth, classifyMcpAuthFailure },
    { POST },
    { POST: revokeAll },
  ] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/auth/session'),
    import('@/lib/mcp/auth'),
    import('./route'),
    import('@/app/api/connections/revoke-all/route'),
  ])

  const user = {
    id: 985,
    email: 'page-token@example.test',
    displayName: 'Local QA',
    mcpTokensRevokedAt: null as Date | null,
  }
  const prismaMock = prisma as any
  const originals = {
    findUnique: prismaMock.user.findUnique,
    update: prismaMock.user.update,
    revokedTokenFindFirst: prismaMock.revokedToken.findFirst,
    codeDeleteMany: prismaMock.oAuthAuthorizationCode.deleteMany,
    grantDeleteMany: prismaMock.oAuthClientGrant.deleteMany,
    logsCreate: prismaMock.logs.create,
  }
  const request = (path: string, method = 'POST', token?: string) =>
    new NextRequest(`http://localhost${path}`, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  const bearerRequest = (token: string) => request('/api/mcp/hello', 'GET', token)

  try {
    prismaMock.user.findUnique = async () => user
    prismaMock.user.update = async ({ data }: { data: Partial<typeof user> }) => {
      Object.assign(user, data)
      return user
    }
    prismaMock.revokedToken.findFirst = async () => null
    prismaMock.oAuthAuthorizationCode.deleteMany = async () => ({ count: 0 })
    prismaMock.oAuthClientGrant.deleteMany = async () => ({ count: 0 })
    prismaMock.logs.create = async () => ({ id: 1 })
    const start = Math.floor(Date.now() / 1000) * 1000 + 100
    mock.timers.enable({ apis: ['Date'], now: start })
    cookieValues.nookies_user = JSON.stringify(user)
    cookieValues[SESSION_COOKIE] = signSession(user)

    // The other context's old token has no per-token revocation row or cookie here.
    const oldToken = createMcpToken(user.id, user.email)
    assert.ok(await validateMcpAuth(bearerRequest(oldToken)))
    mock.timers.tick(100)
    const revoked = await revokeAll(request('/api/connections/revoke-all'))
    assert.equal(revoked.status, 200)
    const marker = user.mcpTokensRevokedAt
    assert.equal(marker?.getTime(), start + 100)
    assert.equal(await validateMcpAuth(bearerRequest(oldToken)), null)
    assert.equal(await classifyMcpAuthFailure(bearerRequest(oldToken)), 'token_revoked')

    mock.timers.tick(1)
    const minted = await POST(request('/api/mcp/token'))
    assert.equal(minted.status, 200)
    const { token: newToken } = await minted.json()
    assert.equal(typeof newToken, 'string')
    assert.equal(user.mcpTokensRevokedAt, marker, 'page-token minting must preserve revoke-all')
    assert.equal(await validateMcpAuth(bearerRequest(oldToken)), null)
    assert.equal(await classifyMcpAuthFailure(bearerRequest(oldToken)), 'token_revoked')
    assert.ok(await validateMcpAuth(bearerRequest(newToken)))
    const decoded = jwt.decode(newToken) as jwt.JwtPayload
    assert.equal(decoded.mcpIssuedAtMs, start + 101)
    assert.equal(decoded.iat, Math.floor(marker!.getTime() / 1000))
    assert.equal(minted.cookies.get('mcp_token')?.value, newToken)
    console.log('Page-token revoke-all regression passed')
  } finally {
    mock.timers.reset()
    nextHeaders.cookies = originalCookies
    prismaMock.user.findUnique = originals.findUnique
    prismaMock.user.update = originals.update
    prismaMock.revokedToken.findFirst = originals.revokedTokenFindFirst
    prismaMock.oAuthAuthorizationCode.deleteMany = originals.codeDeleteMany
    prismaMock.oAuthClientGrant.deleteMany = originals.grantDeleteMany
    prismaMock.logs.create = originals.logsCreate
  }
}

demo().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
