import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, test } from 'node:test'
import path from 'node:path'
import { createJiti } from 'jiti'
import { NextRequest, NextResponse } from 'next/server'
import type { McpAuthContext } from '../src/lib/mcp/auth/types'
import { encodeOAuthToken, OAUTH_TOKEN_PREFIX } from '../src/lib/auth/oauthTokenCipher'
import { oauthTokenPrisma } from './helpers/oauth-token-prisma'

const root = path.resolve(__dirname, '..')
const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false })
const h = oauthTokenPrisma()
let context: McpAuthContext | null = null
let authCalls = 0
let action: string | undefined
let limited = false
const stubs = {
  'src/lib/prisma.ts': { default: h.db },
  'src/lib/mcp/auth.ts': {
    checkMcpRateLimit: async () => limited ? NextResponse.json({ error: 'limit' }, { status: 429 }) : null,
    extractBearerToken: (header: string | null) => header?.startsWith('Bearer ') ? header.slice(7) : null,
    isManagementKeyToken: (bearer: string) => bearer.startsWith('htmk_'),
    validateManagementOrSessionAuth: async (_request: unknown, required: string) => { authCalls++; action = required; return context },
  },
}
const originals = new Map<string, NodeJS.Module | undefined>()
for (const [file, exports] of Object.entries(stubs)) {
  const filename = path.join(root, file)
  originals.set(filename, require.cache[filename])
  require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module
}
after(() => {
  for (const [filename, original] of originals) { if (original) require.cache[filename] = original; else delete require.cache[filename] }
})
const { POST } = jiti(path.join(root, 'src/app/api/admin/better-auth-oauth-tokens/route.ts')) as any
const { GET } = jiti(path.join(root, 'src/app/api/cron/oauth-token-sweep/route.ts')) as any
let oldRoot: string | undefined
let oldCron: string | undefined
beforeEach(() => {
  oldRoot = process.env.BYOK_CIPHER_SECRET; oldCron = process.env.CRON_SECRET
  process.env.BYOK_CIPHER_SECRET = 'synthetic-cipher-root-aaaaaaaaaaaa'
  process.env.CRON_SECRET = 'synthetic-cron-secret-aaaaaaaa'
  context = { user: { id: 6, email: 'valentin.yeo@gmail.com' }, agentId: null, teamScope: null, management: { keyId: 'synthetic-key-id', permissions: { management: ['write'] } } }
  authCalls = 0; limited = false; action = undefined; h.calls.length = 0; h.setFailure()
  h.tables.BetterAuthAccount.splice(0, h.tables.BetterAuthAccount.length,
    { id: 1, updatedAt: new Date(), accessToken: 'synthetic-access-token-40f19497', refreshToken: null, idToken: '' },
    { id: 2, updatedAt: new Date(), accessToken: encodeOAuthToken('accessToken', 'synthetic-access-token-c32da9c6'), refreshToken: null, idToken: `${OAUTH_TOKEN_PREFIX}synthetic-invalid-envelope` },
  )
})
afterEach(() => {
  if (oldRoot === undefined) delete process.env.BYOK_CIPHER_SECRET; else process.env.BYOK_CIPHER_SECRET = oldRoot
  if (oldCron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldCron
})
const managementBearer = 'Bearer htmk_synthetic-management-key-9bd113b7'
function admin(body: unknown = {}, authorization: string | null = managementBearer) {
  return POST(new NextRequest('https://app.example.invalid/api/admin/better-auth-oauth-tokens', {
    method: 'POST', headers: { ...(authorization ? { authorization } : {}), cookie: 'synthetic-cookie-session=synthetic-session-8201d2bf', 'content-type': 'application/json' }, body: JSON.stringify(body),
  })) as Promise<Response>
}
function cron(authorization?: string) {
  return GET(new NextRequest('https://app.example.invalid/api/cron/oauth-token-sweep', { headers: authorization ? { authorization } : {} })) as Promise<Response>
}

for (const authorization of [null, 'Bearer synthetic-agent-token-5df78863', 'Bearer synthetic-session-jwt-cd5a187a']) {
  test(`now refused: admin rejects ${authorization === null ? 'cookie-only/no bearer' : authorization.includes('agent') ? 'agent bearer' : 'non-management bearer'} before account reads`, async () => {
    const response = await admin({}, authorization)
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(authCalls, 0)
    assert.equal(h.calls.length, 0)
    assert.deepEqual(await response.json(), { error: 'unauthorized' })
  })
}

for (const denied of ['invalid', 'agent-context', 'session-context', 'team-scoped', 'wrong-id', 'wrong-email']) {
  test(`now refused: admin rejects ${denied} management context with zero account reads`, async () => {
    if (denied === 'invalid') context = null
    else if (denied === 'agent-context') context!.agentId = 'synthetic-agent'
    else if (denied === 'session-context') delete context!.management
    else if (denied === 'team-scoped') context!.management!.teamId = 'synthetic-team'
    else if (denied === 'wrong-id') context!.user.id = 42
    else context!.user.email = 'non-admin@example.invalid'
    const response = await admin()
    assert.equal(response.status, denied === 'invalid' ? 401 : 403)
    assert.equal(h.calls.length, 0)
    assert.equal(action, 'write')
    assert.deepEqual(Object.keys(await response.json()), ['error'])
  })
}

for (const body of [{}, { mode: 'dry-run' }, { mode: 'verify' }]) {
  test(`still allowed: platform admin ${JSON.stringify(body)} receives authenticated field counts only with no writes`, async () => {
    const response = await admin(body)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const result = await response.json()
    assert.deepEqual(Object.keys(result).sort(), ['encrypted', 'failures', 'plaintextLeft', 'total'])
    assert.deepEqual(result, { total: 3, encrypted: 1, plaintextLeft: 1, failures: 1 })
    assert.equal(action, 'write')
    assert.equal(h.calls.some(call => call.operation === 'updateMany'), false)
  })
}

test('now refused: admin rejects apply, unknown keys and invalid JSON shapes before account reads', async () => {
  for (const body of [{ mode: 'apply' }, { mode: 'verify', cursor: 1 }, { mode: null }, null, []]) {
    const response = await admin(body)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'invalid_request' })
  }
  assert.equal(h.calls.length, 0)
})

test('now refused: rate limiting stops auth and scanning with no-store', async () => {
  limited = true
  const response = await admin()
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { error: 'rate_limited' })
  assert.equal(authCalls, 0)
  assert.equal(h.calls.length, 0)
})

test('now refused: cron rejects missing, wrong and unconfigured CRON_SECRET without account reads', async () => {
  for (const header of [undefined, 'Bearer synthetic-wrong-cron-secret']) {
    assert.equal((await cron(header)).status, 401)
  }
  delete process.env.CRON_SECRET
  assert.equal((await cron('Bearer synthetic-cron-secret-aaaaaaaa')).status, 401)
  assert.equal(h.calls.length, 0)
})

test('still allowed: authenticated cron applies one batch and returns exactly aggregate keys', async () => {
  const response = await cron('Bearer synthetic-cron-secret-aaaaaaaa')
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.deepEqual(Object.keys(result).sort(), ['conflicts', 'encrypted', 'invalid', 'remaining', 'scanned'])
  assert.deepEqual(result, { scanned: 1, encrypted: 1, conflicts: 0, invalid: 0, remaining: 0 })
  assert.ok(h.tables.BetterAuthAccount[0].accessToken.startsWith(OAUTH_TOKEN_PREFIX))
})

test('still allowed: cron logs one counts-only line with verify counts once nothing is pending', async t => {
  const logs: unknown[][] = []
  t.mock.method(console, 'log', (...args: unknown[]) => { logs.push(args) })
  await cron('Bearer synthetic-cron-secret-aaaaaaaa')
  assert.equal(logs.length, 1)
  assert.equal(logs[0][0], 'oauth_token_sweep')
  const line = JSON.parse(String(logs[0][1]))
  assert.deepEqual(line, { scanned: 1, encrypted: 1, conflicts: 0, invalid: 0, remaining: 0, verify: { total: 3, encrypted: 2, plaintextLeft: 0, failures: 1 } })
  for (const fragment of ['synthetic-access-token', OAUTH_TOKEN_PREFIX, 'valentin']) assert.equal(JSON.stringify(logs).includes(fragment), false)
})

test('route failures and captured logs contain categories only, never fixture tokens or database errors', async t => {
  const logs: unknown[] = []
  for (const method of ['log', 'warn', 'error', 'debug'] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(args) })
  const secret = 'synthetic-access-token-40f19497'
  await admin()
  await cron('Bearer synthetic-cron-secret-aaaaaaaa')
  h.setFailure(new Error(secret))
  const verify = await admin()
  assert.equal(verify.status, 500)
  assert.deepEqual(await verify.json(), { error: 'oauth_token_verification_failed' })
  const sweep = await cron('Bearer synthetic-cron-secret-aaaaaaaa')
  assert.equal(sweep.status, 500)
  assert.deepEqual(await sweep.json(), { error: 'oauth_token_sweep_failed' })
  assert.equal(JSON.stringify(logs).includes(secret), false)
})
