// HTPR-4814: a CLI session whose saved token had been revoked got the same
// "Unauthorized. Invalid or missing authentication token." as a typo, so the
// user could not tell a dead session from a bad request and `--token` with a
// live JWT looked like the only thing that worked.
//
// The clients already read `reason` and `message` out of the 401 body. These
// tests drive the real classifier and the real response builder, so a
// rejection the auth layer already understands reaches the caller by name.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const jwt = require('jsonwebtoken')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')

// Signing material is never checked in. Take whatever the environment
// provides, otherwise mint a throwaway key for this process only.
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
} = jiti(path.join(root, 'src/lib/mcp/auth.ts'))

const USER = { id: 6, email: 'valentin@hypertask.ai' }

function requestWithToken(token) {
  return new NextRequest('https://app.hypertask.ai/api/mcp/tasks', {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

// Stands in for the columns the classifier reads. `revokedJtis` is the set the
// real RevokedToken table would match, including the namespaced form an
// administrative revocation writes.
function lookup({
  revokedJtis = [],
  mcpTokensRevokedAt = null,
  user = USER,
  agent = null,
} = {}) {
  const calls = { revokedLookups: 0, agentLookups: 0 }
  const record = user ? { id: user.id, mcpTokensRevokedAt } : null
  return {
    calls,
    db: {
      user: {
        findUnique: async () => record,
        findFirst: async () => record,
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
          // Mirrors the real scoping: an agent is only visible to its owner.
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
  // The administrative surface stores `user:<id>:<jti>` so one account cannot
  // reserve another account's identifier; the classifier must match both forms.
  const { db } = lookup({ revokedJtis: [`user:${USER.id}:${jtiOf(token)}`] })

  const reason = await classifyMcpAuthFailure(requestWithToken(token), db)

  assert.equal(reason, 'token_revoked')
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
  // Expiry is readable from the token the caller already holds, so it must not
  // cost a database round trip.
  assert.equal(calls.revokedLookups, 0)
})

test('a missing Authorization header is named as missing, not invalid', async () => {
  const { db } = lookup()

  const reason = await classifyMcpAuthFailure(requestWithToken(null), db)

  assert.equal(reason, 'missing_token')
})

test('a forged token cannot probe whether a jti has been revoked', async () => {
  // Same claims, wrong signing key. Revocation state is private, so the lookup
  // must not run and the answer must stay generic.
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
  // The CLI falls back to `error`, and older clients match on it, so the
  // existing string has to survive unchanged.
  assert.equal(
    body.error,
    'Unauthorized. Invalid or missing authentication token.'
  )
})

test('the routes the ticket names answer through the shared helper', () => {
  // `hypertask tasks get`, `tasks move` and `comment add` are the three calls
  // that failed in the report. Each must hand its rejection to the helper
  // instead of hand-rolling a 401 with no reason.
  const routes = [
    'src/app/api/mcp/tasks/route.ts',
    'src/app/api/mcp/tasks/move/route.ts',
    'src/app/api/mcp/comments/route.ts',
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

// A managed agent's live token. Its jti is the generation the server stores;
// presenting an older generation means a newer token replaced this one.
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
  // The agent is live; the caller is holding the previous generation, so the
  // fix is to reconnect, not to ask for a new agent.
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
  // The key works; it just cannot reach task data. Widening its scope is a
  // different fix from replacing it, so it must not read as a bad token.
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
  // No decoding, no revocation probe: the key is opaque.
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
