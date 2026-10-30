const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const jwt = require('jsonwebtoken')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')

const crypto = require('node:crypto')
const testSigningKey =
  process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex')
const otherSigningKey = crypto.randomBytes(32).toString('hex')

process.env.JWT_SECRET = testSigningKey
process.env.JWT_ISSUER = 'hypertask'

const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
  cache: false,
})

const {
  classifyMcpAuthFailure,
  mcpUnauthorizedResponse,
  createMcpToken,
  createOAuthToken,
  legacyTokenRevocationJti,
} = jiti(path.join(root, 'src/lib/mcp/auth.ts'))
const { oauthLegacyRevocationJti } = jiti(
  path.join(root, 'src/lib/mcp/oauthTokenContract.ts')
)

const USER = { id: 6, email: 'valentin@hypertask.ai' }

function requestWithToken(token) {
  return new NextRequest('https://app.hypertask.ai/api/mcp/tasks', {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

function lookup({
  revokedJtis = [],
  mcpTokensRevokedAt = null,
  oauthClientExists = true,
  user = USER,
  agent = null,
} = {}) {
  const calls = { revokedLookups: 0, agentLookups: 0, oauthClientLookups: 0 }
  const record = user ? { id: user.id, mcpTokensRevokedAt } : null
  return {
    calls,
    db: {
      user: {
        findUnique: async () => record,
        findFirst: async () => record,
      },
      oAuthClient: {
        findUnique: async ({ where }) => {
          calls.oauthClientLookups += 1
          return oauthClientExists ? { client_id: where.client_id } : null
        },
      },
      revokedToken: {
        findFirst: async (args) => {
          calls.revokedLookups += 1
          const wanted = args?.where?.jti?.in ?? []
          const hit = wanted.find((jti) => revokedJtis.includes(jti))
          return hit ? { jti: hit } : null
        },
      },
      agent: {
        findFirst: async (args) => {
          calls.agentLookups += 1
          if (!agent) return null
          if (args?.where?.id !== agent.id) return null
          if (args?.where?.userId !== agent.userId) return null
          return {
            id: agent.id,
            mcpTokenJti: agent.mcpTokenJti ?? null,
            revokedAt: agent.revokedAt ?? null,
          }
        },
      },
    },
  }
}

function jtiOf(token) {
  return jwt.decode(token).jti
}

test('a token revoked by its own jti is named as revoked, not as a bad request', async () => {
  const token = createMcpToken(USER.id, USER.email, '30d')
  const { db } = lookup({ revokedJtis: [jtiOf(token)] })

  const reason = await classifyMcpAuthFailure(requestWithToken(token), db)

  assert.equal(reason, 'token_revoked')
})

test('a token revoked through the administrative namespaced jti is still named as revoked', async () => {
  const token = createMcpToken(USER.id, USER.email, '30d')
  const { db } = lookup({ revokedJtis: [`user:${USER.id}:${jtiOf(token)}`] })

  const reason = await classifyMcpAuthFailure(requestWithToken(token), db)

  assert.equal(reason, 'token_revoked')
})

test('a removed OAuth client is named as revoked', async () => {
  const token = createOAuthToken(
    'firebase-owner',
    USER.id,
    USER.email,
    'removed-client',
  )
  const { db, calls } = lookup({ oauthClientExists: false })

  assert.equal(
    await classifyMcpAuthFailure(requestWithToken(token), db),
    'token_revoked'
  )
  assert.equal(calls.oauthClientLookups, 1)
})

test('the legacy OAuth cutoff is named as revoked without a client lookup', async () => {
  const token = jwt.sign(
    { sub: 'firebase-owner', userId: USER.id, jti: 'legacy-oauth' },
    testSigningKey,
    {
      issuer: process.env.JWT_ISSUER,
      audience: 'http://localhost:3001',
      expiresIn: '30d',
    }
  )
  const { db, calls } = lookup({
    revokedJtis: [oauthLegacyRevocationJti(USER.id)],
  })

  assert.equal(
    await classifyMcpAuthFailure(requestWithToken(token), db),
    'token_revoked'
  )
  assert.equal(calls.oauthClientLookups, 0)
})

test('legacy revocation identifies one exact bearer without affecting another user token', async () => {
  const first = jwt.sign(
    { sub: USER.email, userId: USER.id, marker: 'first' },
    testSigningKey,
    { issuer: 'hypertask', audience: 'mcp-api', expiresIn: '30d' }
  )
  const second = jwt.sign(
    { sub: USER.email, userId: USER.id, marker: 'second' },
    testSigningKey,
    { issuer: 'hypertask', audience: 'mcp-api', expiresIn: '30d' }
  )
  const revokedJti = legacyTokenRevocationJti(first)
  const { db } = lookup({ revokedJtis: [revokedJti] })

  assert.equal(
    await classifyMcpAuthFailure(requestWithToken(first), db),
    'token_revoked'
  )
  assert.equal(
    await classifyMcpAuthFailure(requestWithToken(second), db),
    'invalid_token'
  )
  assert.notEqual(legacyTokenRevocationJti(second), revokedJti)
})

test('a token minted before the owner revoked every token is named as revoked', async () => {
  const token = createMcpToken(USER.id, USER.email, '30d')
  const { db } = lookup({ mcpTokensRevokedAt: new Date(Date.now() + 60_000) })

  const reason = await classifyMcpAuthFailure(requestWithToken(token), db)

  assert.equal(reason, 'token_revoked')
})

test('a still-valid token minted after that revocation is not called revoked', async () => {
  const token = createMcpToken(USER.id, USER.email, '30d')
  const { db } = lookup({ mcpTokensRevokedAt: new Date(Date.now() - 60_000) })

  const reason = await classifyMcpAuthFailure(requestWithToken(token), db)

  assert.equal(reason, 'invalid_token')
})

test('an expired token is named as expired', async () => {
  const token = jwt.sign(
    { sub: USER.email, userId: USER.id, jti: 'expired-jti' },
    testSigningKey,
    { issuer: 'hypertask', audience: 'mcp-api', expiresIn: -60 }
  )
  const { db, calls } = lookup()

  const reason = await classifyMcpAuthFailure(requestWithToken(token), db)

  assert.equal(reason, 'token_expired')
  assert.equal(calls.revokedLookups, 0)
})

test('a missing Authorization header is named as missing, not invalid', async () => {
  const { db } = lookup()

  const reason = await classifyMcpAuthFailure(requestWithToken(null), db)

  assert.equal(reason, 'missing_token')
})

test('a forged token cannot probe whether a jti has been revoked', async () => {
  const forged = jwt.sign(
    { sub: USER.email, userId: USER.id, jti: 'someone-elses-jti' },
    otherSigningKey,
    { issuer: 'hypertask', audience: 'mcp-api', expiresIn: '30d' }
  )
  const { db, calls } = lookup({ revokedJtis: ['someone-elses-jti'] })

  const reason = await classifyMcpAuthFailure(requestWithToken(forged), db)

  assert.equal(reason, 'invalid_token')
  assert.equal(calls.revokedLookups, 0)
})

test('an opaque API key is rejected without disclosing whether it exists', async () => {
  const { db, calls } = lookup()
  db.verifyManagementKey = async () => null

  for (const key of ['htk_live_abc123', 'htmk_live_abc123']) {
    const reason = await classifyMcpAuthFailure(requestWithToken(key), db)
    assert.equal(reason, 'invalid_token')
  }
  assert.equal(calls.revokedLookups, 0)
})

test('the 401 body carries the reason and message the CLI prints, and keeps the old error string', async () => {
  const token = createMcpToken(USER.id, USER.email, '30d')
  const { db } = lookup({ revokedJtis: [jtiOf(token)] })

  const response = await mcpUnauthorizedResponse(requestWithToken(token), db)
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.reason, 'token_revoked')
  assert.match(body.message, /revoked/i)
  assert.equal(
    body.error,
    'Unauthorized. Invalid or missing authentication token.'
  )
})

test('the routes the ticket names answer through the shared helper', () => {
  const routes = [
    'src/lib/mcp/operations/tasks/operation.ts',
    'src/lib/mcp/operations/tasks/move/operation.ts',
    'src/lib/mcp/operations/comments/operation.ts',
  ]

  for (const route of routes) {
    const source = fs.readFileSync(path.join(root, route), 'utf8')
    assert.match(
      source,
      /if \(!ctx\) \{\s*\n\s*return await mcpUnauthorizedResponse\(request\)/,
      `${route} should reject through mcpUnauthorizedResponse`
    )
    assert.doesNotMatch(
      source,
      /error: ['"]Unauthorized\. Invalid or missing authentication token\.['"]/,
      `${route} should no longer hand-roll a reasonless 401`
    )
  }
})

const AGENT_ID = 'c7227fc2-5ef5-40c6-866d-356d6455d2ee'

function agentToken(generation) {
  return jwt.sign(
    { sub: USER.email, userId: USER.id, agentId: AGENT_ID, jti: generation },
    testSigningKey,
    { issuer: 'hypertask', audience: 'mcp-api' }
  )
}

test('a revoked agent is named as revoked, not as a bad request', async () => {
  const token = agentToken('generation-1')
  const { db } = lookup({
    agent: {
      id: AGENT_ID,
      userId: USER.id,
      mcpTokenJti: jtiOf(token),
      revokedAt: new Date(),
    },
  })

  const reason = await classifyMcpAuthFailure(requestWithToken(token), db)

  assert.equal(reason, 'agent_revoked')
})

test('an agent token replaced by a newer one is named as superseded', async () => {
  const stale = agentToken('generation-1')
  const current = agentToken('generation-2')
  const { db } = lookup({
    agent: { id: AGENT_ID, userId: USER.id, mcpTokenJti: jtiOf(current) },
  })

  const reason = await classifyMcpAuthFailure(requestWithToken(stale), db)

  assert.equal(reason, 'agent_token_superseded')
})

test('an agent belonging to another account is indistinguishable from one that does not exist', async () => {
  const token = agentToken('generation-1')
  const { db } = lookup({
    agent: { id: AGENT_ID, userId: 999, mcpTokenJti: jtiOf(token) },
  })

  const reason = await classifyMcpAuthFailure(requestWithToken(token), db)

  assert.equal(reason, 'invalid_token')
})

test('a plain user token never triggers an agent lookup', async () => {
  const token = createMcpToken(USER.id, USER.email, '30d')
  const { db, calls } = lookup()

  await classifyMcpAuthFailure(requestWithToken(token), db)

  assert.equal(calls.agentLookups, 0)
})

test('a management key that verifies but lacks data permission is named as under-scoped', async () => {
  const { db, calls } = lookup()
  db.verifyManagementKey = async () => ({
    user: USER,
    agentId: null,
    management: { keyId: 'key-1', permissions: { agents: ['read'] } },
  })

  const reason = await classifyMcpAuthFailure(
    requestWithToken('htmk_live_abc123'),
    db
  )

  assert.equal(reason, 'insufficient_scope')
  assert.equal(calls.revokedLookups, 0)
})

test('a management key that does not verify stays a generic rejection', async () => {
  const { db } = lookup()
  db.verifyManagementKey = async () => null

  const reason = await classifyMcpAuthFailure(
    requestWithToken('htmk_live_abc123'),
    db
  )

  assert.equal(reason, 'invalid_token')
})
