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
process.env.JWT_OAUTH_AUDIENCE = 'fixture-oauth-api'

const { handleMcpTokenRefresh } = jiti(
  path.join(root, 'src/lib/mcp/token/refresh.ts')
)
const {
  MCP_AGENT_REVOKED_MESSAGE,
  MCP_AGENT_TOKEN_REFRESH_MESSAGE,
  MCP_AGENT_TOKEN_SUPERSEDED_MESSAGE,
  legacyTokenRevocationJti,
  verifyMcpJwtToken,
} = jiti(path.join(root, 'src/lib/mcp/auth.ts'))

const user = { id: 6, email: 'fixture@example.test' }
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
  claimRotation = async () => true,
}) {
  const calls = { created: [], claimed: [], logged: [], agentLookups: [] }

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
      claimRotation: async (...args) => {
        calls.claimed.push(args)
        return claimRotation(...args)
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

function signedUserToken({ jti, iat, exp, audience = 'mcp-api', clientId } = {}) {
  return jwt.sign(
    {
      sub: user.email,
      userId: user.id,
      ...(typeof iat === 'number' ? { iat } : {}),
      ...(typeof exp === 'number' ? { exp } : {}),
      ...(jti ? { jti } : {}),
      ...(clientId ? { client_id: clientId } : {}),
    },
    process.env.JWT_SECRET,
    {
      ...(typeof exp === 'number' ? {} : { expiresIn: '30d' }),
      issuer: audience === 'hypertasks-mcp' ? 'hypertasks' : 'hypertask',
      audience,
    }
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

test('a valid pre-cutoff legacy token migrates to a refreshable token', async () => {
  const legacyToken = signedUserToken({
    iat: Date.parse('2026-08-03T00:00:00.000Z') / 1000,
    exp: Date.parse('2100-01-01T00:00:00.000Z') / 1000,
  })
  const replacementToken = signedUserToken({ jti: 'new-token-jti' })
  const deps = dependencies({
    authContext: { user, agentId: null },
    replacementToken,
  })

  const response = await handleMcpTokenRefresh(
    requestWithToken(legacyToken),
    deps.value
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.success, true)
  assert.equal(body.token, replacementToken)
  assert.deepEqual(deps.calls.created, [[user.id, user.email, '30d']])
  assert.equal(deps.calls.claimed.length, 1)
  assert.equal(deps.calls.claimed[0][0], legacyTokenRevocationJti(legacyToken))
  assert.equal(deps.calls.claimed[0][1], user.id)
  assert.equal(
    deps.calls.claimed[0][2].toISOString(),
    new Date(jwt.decode(legacyToken).exp * 1000).toISOString()
  )
  assert.equal(deps.calls.logged.length, 1)
})

test('a legacy token issued after the migration cutoff is not refreshable', async () => {
  const legacyToken = signedUserToken({
    iat: Date.parse('2026-09-02T00:00:00.000Z') / 1000,
    exp: Date.parse('2100-01-01T00:00:00.000Z') / 1000,
  })
  const deps = dependencies({ authContext: { user, agentId: null } })

  const response = await handleMcpTokenRefresh(
    requestWithToken(legacyToken),
    deps.value
  )
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.reason, 'legacy_token')
  assert.deepEqual(deps.calls.created, [])
  assert.deepEqual(deps.calls.claimed, [])
})

test('a same-secret non-MCP token cannot use legacy migration', async () => {
  const nonMcpToken = signedUserToken({
    iat: Date.parse('2026-08-03T00:00:00.000Z') / 1000,
    exp: Date.parse('2100-01-01T00:00:00.000Z') / 1000,
    audience: 'email-link',
  })
  const deps = dependencies({ authContext: { user, agentId: null } })

  const response = await handleMcpTokenRefresh(
    requestWithToken(nonMcpToken),
    deps.value
  )
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.reason, 'legacy_token')
  assert.deepEqual(deps.calls.created, [])
  assert.deepEqual(deps.calls.claimed, [])
})

test('a valid token with jti refreshes through a unique revocation claim', async () => {
  const oldToken = signedUserToken({ jti: 'old-token-jti' })
  const replacementToken = signedUserToken({ jti: 'new-token-jti' })
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
  assert.equal(deps.calls.claimed.length, 1)
  assert.equal(deps.calls.claimed[0][0], 'old-token-jti')
  assert.equal(deps.calls.claimed[0][1], user.id)
  assert.equal(deps.calls.logged.length, 1)
})

test('concurrent legacy refreshes return exactly one replacement', async () => {
  const legacyToken = signedUserToken({
    iat: Date.parse('2026-08-03T00:00:00.000Z') / 1000,
    exp: Date.parse('2100-01-01T00:00:00.000Z') / 1000,
  })
  const replacementToken = signedUserToken({ jti: 'race-winner-jti' })
  let arrivals = 0
  let claimed = false
  let releaseClaims
  const bothArrived = new Promise((resolve) => {
    releaseClaims = resolve
  })
  const deps = dependencies({
    authContext: { user, agentId: null },
    replacementToken,
    claimRotation: async () => {
      arrivals += 1
      if (arrivals === 2) releaseClaims()
      await bothArrived
      if (claimed) return false
      claimed = true
      return true
    },
  })

  const responses = await Promise.all([
    handleMcpTokenRefresh(requestWithToken(legacyToken), deps.value),
    handleMcpTokenRefresh(requestWithToken(legacyToken), deps.value),
  ])
  const bodies = await Promise.all(responses.map((response) => response.json()))
  const winner = bodies.find((body) => body.success === true)
  const loser = bodies.find((body) => body.reason === 'token_revoked')

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401])
  assert.equal(winner.token, replacementToken)
  assert.equal('token' in loser, false)
  assert.equal(deps.calls.claimed.length, 2)
  assert.equal(deps.calls.logged.length, 1)
})

test('an audit-log failure does not strand a successfully claimed refresh', async () => {
  const oldToken = signedUserToken({ jti: 'old-token-jti' })
  const replacementToken = signedUserToken({ jti: 'new-token-jti' })
  const deps = dependencies({
    authContext: { user, agentId: null },
    replacementToken,
  })
  deps.value.createAuditLog = async () => {
    throw new Error('audit unavailable')
  }
  const originalError = console.error
  console.error = () => {}

  try {
    const response = await handleMcpTokenRefresh(
      requestWithToken(oldToken),
      deps.value
    )
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.token, replacementToken)
  } finally {
    console.error = originalError
  }
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
  assert.deepEqual(deps.calls.claimed, [])
})

test('OAuth access tokens cannot refresh into account MCP tokens', async () => {
  for (const audience of [
    'fixture-oauth-api',
    'http://localhost:3001',
    ['mcp-api', 'fixture-oauth-api'],
    ['mcp-api', 'http://localhost:3001'],
  ]) {
    for (const jti of ['fixture-oauth-jti', undefined]) {
      const token = signedUserToken({
        audience,
        jti,
        clientId: jti ? 'fixture-client' : undefined,
        iat: Date.parse('2026-08-03T00:00:00.000Z') / 1000,
        exp: Date.parse('2100-01-01T00:00:00.000Z') / 1000,
      })
      const deps = dependencies({ authContext: { user, agentId: null } })
      const response = await handleMcpTokenRefresh(requestWithToken(token), deps.value)
      const body = await response.json()
      assert.equal(response.status, 401)
      assert.equal(body.reason, 'invalid_token')
      assert.equal('token' in body, false)
      assert.deepEqual(deps.calls.created, [])
      assert.deepEqual(deps.calls.claimed, [])
      assert.deepEqual(deps.calls.logged, [])
    }
  }
})

test('MCP refresh keeps current and legacy account token behavior', async () => {
  for (const audience of ['mcp-api', 'hypertasks-mcp']) {
    for (const jti of ['fixture-account-jti', undefined]) {
      const token = signedUserToken({
        audience,
        jti,
        iat: Date.parse('2026-08-03T00:00:00.000Z') / 1000,
        exp: Date.parse('2100-01-01T00:00:00.000Z') / 1000,
      })
      const replacementToken = signedUserToken({ jti: 'fixture-replacement-jti' })
      let claimed = false
      const deps = dependencies({
        authContext: { user, agentId: null },
        replacementToken,
        claimRotation: async () => {
          if (claimed) return false
          claimed = true
          return true
        },
      })
      const response = await handleMcpTokenRefresh(requestWithToken(token), deps.value)
      assert.equal(response.status, 200)
      assert.equal((await response.json()).token, replacementToken)
      assert.deepEqual(deps.calls.created, [[user.id, user.email, '30d']])
      assert.equal(deps.calls.claimed[0][0], jti ?? legacyTokenRevocationJti(token))
      assert.equal(deps.calls.logged.length, 1)
      const replay = await handleMcpTokenRefresh(requestWithToken(token), deps.value)
      assert.equal(replay.status, 401)
      assert.equal((await replay.json()).reason, 'token_revoked')
      assert.equal(deps.calls.logged.length, 1)
    }
  }
})

test('concurrent MCP account refreshes return exactly one replacement', async () => {
  const token = signedUserToken({ jti: 'fixture-concurrent-account-jti' })
  const replacementToken = signedUserToken({ jti: 'fixture-concurrent-replacement-jti' })
  let claimed = false
  const deps = dependencies({
    authContext: { user, agentId: null },
    replacementToken,
    claimRotation: async () => {
      if (claimed) return false
      claimed = true
      return true
    },
  })
  const responses = await Promise.all([
    handleMcpTokenRefresh(requestWithToken(token), deps.value),
    handleMcpTokenRefresh(requestWithToken(token), deps.value),
  ])
  const bodies = await Promise.all(responses.map((response) => response.json()))
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401])
  assert.equal(bodies.find((body) => body.success).token, replacementToken)
  assert.equal('token' in bodies.find((body) => body.reason === 'token_revoked'), false)
  assert.equal(deps.calls.claimed.length, 2)
  assert.equal(deps.calls.logged.length, 1)
})
