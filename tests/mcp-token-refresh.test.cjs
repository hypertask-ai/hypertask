const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const jwt = require('jsonwebtoken')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')
const jiti = require('jiti')(
  path.join(root, 'tests/mcp-token-refresh-entry.cjs'),
  {
    interopDefault: true,
    alias: { '@': path.join(root, 'src') },
    cache: false,
  }
)

process.env.JWT_SECRET = 'mcp-token-refresh-test-secret-32-chars'
process.env.JWT_ISSUER = 'hypertask'

const { handleMcpTokenRefresh } = jiti(
  path.join(root, 'src/lib/mcp/token/refresh.ts')
)
const {
  MCP_AGENT_REVOKED_MESSAGE,
  MCP_AGENT_TOKEN_REFRESH_MESSAGE,
  MCP_AGENT_TOKEN_SUPERSEDED_MESSAGE,
  verifyMcpJwtToken,
} = jiti(path.join(root, 'src/lib/mcp/auth.ts'))

const user = { id: 6, email: 'valentin@hypertask.ai' }
const signingSecret = 'refresh-route-test-secret'
const agentId = 'a9ced00e-1c88-4c9d-a5a4-497b5c494759'

function requestWithToken(token) {
  return new NextRequest('https://app.hypertask.ai/api/mcp/token/refresh', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

function dependencies({
  authContext,
  replacementToken,
  agent = null,
  verifyToken = verifyMcpJwtToken,
}) {
  const calls = { created: [], revoked: [], logged: [], agentLookups: [] }

  return {
    calls,
    value: {
      validateAuth: async () => authContext,
      verifyToken,
      findAgent: async (requestedAgentId) => {
        calls.agentLookups.push(requestedAgentId)
        return agent
      },
      createToken: (...args) => {
        calls.created.push(args)
        return replacementToken
      },
      revokeToken: async (...args) => {
        calls.revoked.push(args)
      },
      createAuditLog: async (...args) => {
        calls.logged.push(args)
      },
    },
  }
}

function signedAgentToken(jti, secret = process.env.JWT_SECRET) {
  return jwt.sign(
    { sub: user.email, userId: user.id, agentId, jti },
    secret,
    { issuer: 'hypertask', audience: 'mcp-api' }
  )
}

test('a superseded agent token returns agent_token_superseded', async () => {
  const presentedToken = signedAgentToken('presented-jti')
  const storedToken = signedAgentToken('stored-jti')
  const deps = dependencies({
    authContext: null,
    // HTPR-4671: the row keeps the credential's generation, not the token.
    agent: { revokedAt: null, mcpTokenJti: 'stored-jti' },
  })

  const response = await handleMcpTokenRefresh(
    requestWithToken(presentedToken),
    deps.value
  )
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.reason, 'agent_token_superseded')
  assert.equal(body.error, MCP_AGENT_TOKEN_SUPERSEDED_MESSAGE)
  assert.equal(body.message, MCP_AGENT_TOKEN_SUPERSEDED_MESSAGE)
  assert.deepEqual(deps.calls.agentLookups, [agentId])
})

test('a revoked agent token returns agent_revoked', async () => {
  const presentedToken = signedAgentToken('revoked-jti')
  const deps = dependencies({
    authContext: null,
    agent: {
      revokedAt: new Date('2026-08-07T09:00:00.000Z'),
      mcpTokenJti: 'revoked-jti',
    },
  })

  const response = await handleMcpTokenRefresh(
    requestWithToken(presentedToken),
    deps.value
  )
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.reason, 'agent_revoked')
  assert.equal(body.error, MCP_AGENT_REVOKED_MESSAGE)
  assert.equal(body.message, MCP_AGENT_REVOKED_MESSAGE)
})

test('an agent token with a bad signature does not disclose agent state', async () => {
  const forgedToken = signedAgentToken('forged-jti', signingSecret)
  const deps = dependencies({
    authContext: null,
    agent: {
      revokedAt: new Date('2026-08-07T09:00:00.000Z'),
      mcpTokenJti: null,
    },
  })

  const response = await handleMcpTokenRefresh(
    requestWithToken(forgedToken),
    deps.value
  )
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.reason, 'invalid_token')
  assert.equal(body.message, 'Authentication required. Please check your token and try again.')
  assert.deepEqual(deps.calls.agentLookups, [])
})

test('a valid agent token points to owner-authorized token rotation', async () => {
  const deps = dependencies({ authContext: { user, agentId } })

  const response = await handleMcpTokenRefresh(
    requestWithToken(signedAgentToken('current-jti')),
    deps.value
  )
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.equal(body.error, MCP_AGENT_TOKEN_REFRESH_MESSAGE)
})

test('a valid legacy token without jti names login and gets a distinct reason', async () => {
  const legacyToken = jwt.sign(
    { sub: user.email, userId: user.id },
    signingSecret,
    { expiresIn: '30d', issuer: 'hypertask', audience: 'mcp-api' }
  )
  const deps = dependencies({ authContext: { user, agentId: null } })

  const response = await handleMcpTokenRefresh(
    requestWithToken(legacyToken),
    deps.value
  )
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.reason, 'legacy_token')
  assert.match(body.message, /hypertask login/)
  assert.match(body.message, /predates refresh support/)
  assert.deepEqual(deps.calls.created, [])
  assert.deepEqual(deps.calls.revoked, [])
})

test('a valid token with jti still refreshes and revokes the old token', async () => {
  const oldToken = jwt.sign(
    { sub: user.email, userId: user.id, jti: 'old-token-jti' },
    signingSecret,
    { expiresIn: '30d', issuer: 'hypertask', audience: 'mcp-api' }
  )
  const replacementToken = jwt.sign(
    { sub: user.email, userId: user.id, jti: 'new-token-jti' },
    signingSecret,
    { expiresIn: '30d', issuer: 'hypertask', audience: 'mcp-api' }
  )
  const deps = dependencies({
    authContext: { user, agentId: null },
    replacementToken,
  })

  const response = await handleMcpTokenRefresh(
    requestWithToken(oldToken),
    deps.value
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.success, true)
  assert.equal(body.token, replacementToken)
  assert.deepEqual(deps.calls.created, [[user.id, user.email, '30d']])
  assert.equal(deps.calls.revoked.length, 1)
  assert.equal(deps.calls.revoked[0][0], 'old-token-jti')
  assert.equal(deps.calls.revoked[0][1], user.id)
  assert.equal(deps.calls.logged.length, 1)
})

test('an invalid token keeps the generic invalid_token response', async () => {
  const deps = dependencies({ authContext: null })

  const response = await handleMcpTokenRefresh(
    requestWithToken('not-a-valid-token'),
    deps.value
  )
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.reason, 'invalid_token')
  assert.equal(body.message, 'Authentication required. Please check your token and try again.')
  assert.deepEqual(deps.calls.created, [])
  assert.deepEqual(deps.calls.revoked, [])
})
