const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const jwt = require('jsonwebtoken')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')
process.env.JWT_SECRET = 'oauth-agent-route-test-secret-32-characters'
process.env.JWT_ISSUER = 'hypertask'

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath)
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  }
}

const agentId = 'a9ced00e-1c88-4c9d-a5a4-497b5c494759'
const owner = {
  id: 6,
  email: 'owner@example.test',
  uid: 'firebase-owner',
}
const verifier = 'oauth-route-code-verifier-with-sufficient-length'
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
const calls = { agentLookups: [], ownerUpdates: [], usedUpdates: [] }
let currentAgent = null

const authCode = {
  code: 'one-time-code',
  client_id: 'client-1',
  redirect_uri: 'https://client.example.test/callback',
  code_challenge: challenge,
  expires_at: new Date(0),
  used: false,
  agent_id: agentId,
  firebase_uid: owner.uid,
  user: owner,
}

stubModule('src/lib/prisma.ts', {
  default: {
    $transaction: async (callback) => callback({
      oAuthClient: {
        updateMany: async (args) => {
          calls.ownerUpdates.push(args)
          return { count: 1 }
        },
      },
      oAuthAuthorizationCode: {
        updateMany: async (args) => {
          calls.usedUpdates.push(args)
          return { count: 1 }
        },
      },
    }),
    oAuthAuthorizationCode: {
      findUnique: async () => authCode,
    },
    oAuthClient: {
      findUnique: async () => ({ client_id: authCode.client_id }),
    },
    agent: {
      findFirst: async (args) => {
        calls.agentLookups.push(args)
        return currentAgent ? { id: agentId, ...currentAgent } : null
      },
    },
    user: {
      findUnique: async () => ({
        ...owner,
        displayName: 'Owner',
        mcpTokensRevokedAt: null,
      }),
    },
    revokedToken: {
      findFirst: async () => null,
    },
    logs: {
      create: async () => ({ id: 1 }),
    },
  },
})

const jiti = require('jiti')(
  path.join(root, 'tests/oauth-agent-token-route-entry.cjs'),
  {
    interopDefault: true,
    alias: { '@': path.join(root, 'src') },
    cache: false,
  }
)
const { POST } = jiti(path.join(root, 'src/app/oauth/token/route.ts'))
const {
  agentTokenCredentialFields,
  presentedAgentTokenGeneration,
  storedAgentTokenGeneration,
  validateMcpAuth,
} = jiti(path.join(root, 'src/lib/mcp/auth.ts'))

function managedToken(
  overrides = {},
  signingSecret = process.env.JWT_SECRET,
  signOptions = {}
) {
  return jwt.sign(
    {
      sub: owner.email,
      userId: owner.id,
      agentId,
      jti: 'managed-generation-7',
      ...overrides,
    },
    signingSecret,
    { issuer: 'hypertask', audience: 'mcp-api', ...signOptions }
  )
}

/** The row shape a stored credential leaves behind (HTPR-4671: no plaintext). */
function storedCredential(token) {
  return agentTokenCredentialFields(token)
}

function tokenRequest() {
  // Keep the authorization-code fixture live relative to each assertion. On
  // loaded self-hosted runners, this test file can wait over a minute to run.
  authCode.expires_at = new Date(Date.now() + 60_000)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: authCode.code,
    redirect_uri: authCode.redirect_uri,
    client_id: authCode.client_id,
    code_verifier: verifier,
  })
  return new NextRequest('https://app.hypertask.ai/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
}

async function expectInvalidAgentGrant(agent) {
  currentAgent = agent
  const tokenMaterial = agent?.mcpTokenJti
  calls.agentLookups.length = 0
  calls.ownerUpdates.length = 0
  calls.usedUpdates.length = 0

  const response = await POST(tokenRequest())
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.deepEqual(body, {
    error: 'invalid_grant',
    error_description: 'The selected agent does not have an active token.',
  })
  assert.equal(calls.ownerUpdates.length, 0)
  assert.equal(calls.usedUpdates.length, 0)
  assert.equal(JSON.stringify(body).includes('managed-generation'), false)
  if (tokenMaterial) {
    assert.equal(JSON.stringify(body).includes(tokenMaterial), false)
  }
  return calls.agentLookups[0]
}

test('OAuth exchange binds a unique credential to the stored managed generation', async () => {
  currentAgent = storedCredential(managedToken())
  calls.agentLookups.length = 0
  calls.ownerUpdates.length = 0
  calls.usedUpdates.length = 0

  const response = await POST(tokenRequest())
  const body = await response.json()
  const decoded = jwt.verify(body.access_token, process.env.JWT_SECRET, {
    issuer: 'hypertask',
    audience: 'http://localhost:3001',
  })

  assert.equal(response.status, 200)
  assert.equal(decoded.agentId, agentId)
  assert.equal(decoded.agentTokenGeneration, 'managed-generation-7')
  assert.notEqual(decoded.jti, 'managed-generation-7')
  assert.equal(decoded.exp, undefined)
  assert.deepEqual(calls.agentLookups[0], {
    where: { id: agentId, userId: owner.id, revokedAt: null },
    select: { mcpTokenJti: true },
  })
  assert.deepEqual(calls.ownerUpdates, [{
    where: { client_id: authCode.client_id, owner_id: null },
    data: { owner_id: owner.id },
  }])
  assert.equal(calls.usedUpdates.length, 1)
})

test('OAuth exchange rejects an agent row carrying no generation', async (t) => {
  // HTPR-4671. The row used to hold a JWT this route re-verified. It now holds
  // a generation, so "unusable credential" means empty rather than malformed.
  for (const stored of [
    { mcpTokenJti: null },
    { mcpTokenJti: '' },
    storedCredential(null),
  ]) {
    await t.test(JSON.stringify(stored), async () => {
      assert.equal(storedAgentTokenGeneration(stored), null)
      await expectInvalidAgentGrant(stored)
    })
  }
})

test('OAuth exchange never reads a generation belonging to another owner', async (t) => {
  // This is what replaced re-verifying the stored plaintext: the lookup is
  // scoped to this owner and a live agent, so a foreign or switched-off agent
  // returns nothing and there is no generation to donate.
  for (const state of ['revoked', 'cross-owner', 'no-token']) {
    await t.test(state, async () => {
      const lookup = await expectInvalidAgentGrant(
        state === 'no-token' ? storedCredential(null) : null
      )
      assert.deepEqual(lookup.where, {
        id: agentId,
        userId: owner.id,
        revokedAt: null,
      })
      assert.deepEqual(lookup.select, { mcpTokenJti: true })
    })
  }
})

test('rotation invalidates an existing OAuth generation without leaking token material', async () => {
  currentAgent = storedCredential(managedToken())
  const response = await POST(tokenRequest())
  const body = await response.json()
  const oauthClaims = jwt.decode(body.access_token)
  const rotatedManagedToken = managedToken({ jti: 'managed-generation-8' })
  const rotatedStored = storedCredential(rotatedManagedToken)
  const rotatedGeneration = storedAgentTokenGeneration(rotatedStored)

  assert.equal(presentedAgentTokenGeneration(oauthClaims), 'managed-generation-7')
  assert.equal(rotatedGeneration, 'managed-generation-8')
  assert.notEqual(presentedAgentTokenGeneration(oauthClaims), rotatedGeneration)
  assert.equal(JSON.stringify(body).includes(rotatedManagedToken), false)

  const authenticatedRequest = () => new NextRequest(
    'https://app.hypertask.ai/api/mcp/user/context',
    { headers: { Authorization: `Bearer ${body.access_token}` } }
  )
  assert.equal((await validateMcpAuth(authenticatedRequest())).agentId, agentId)

  currentAgent = rotatedStored
  assert.equal(await validateMcpAuth(authenticatedRequest()), null)

  currentAgent = null
  assert.equal(await validateMcpAuth(authenticatedRequest()), null)
})
