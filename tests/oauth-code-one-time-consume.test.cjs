const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')
process.env.JWT_SECRET = 'oauth-code-race-test-secret-32-characters'
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

const verifier = 'oauth-race-code-verifier-with-sufficient-length'
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
const owner = {
  id: 6,
  email: 'owner@example.test',
  uid: 'firebase-owner',
}
const baseAuthCode = {
  code: 'one-time-race-code',
  client_id: 'client-1',
  redirect_uri: 'https://client.example.test/callback',
  code_challenge: challenge,
  expires_at: new Date(Date.now() + 60_000),
  used: false,
  agent_id: null,
  firebase_uid: owner.uid,
  user: owner,
}

const calls = {
  readSnapshots: [],
  consumeAttempts: [],
  ownerClaims: [],
  mintAttempts: [],
  mintedTokens: [],
}
let authCode = baseAuthCode
let client = { client_id: baseAuthCode.client_id }
let consumed = false
let ownerId = null
let consumeError = null
let mintError = null
let readBarrier = null
let transactionTail = Promise.resolve()

function resetState(overrides = {}) {
  authCode = {
    ...baseAuthCode,
    ...overrides,
    user: { ...owner, ...(overrides.user ?? {}) },
  }
  client = overrides.client === undefined
    ? { client_id: authCode.client_id }
    : overrides.client
  consumed = Boolean(overrides.used)
  ownerId = overrides.ownerId ?? null
  consumeError = null
  mintError = null
  readBarrier = null
  transactionTail = Promise.resolve()
  calls.readSnapshots.length = 0
  calls.consumeAttempts.length = 0
  calls.ownerClaims.length = 0
  calls.mintAttempts.length = 0
  calls.mintedTokens.length = 0
}

function holdUntilConcurrentReads(expectedReads = 2) {
  let reads = 0
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  readBarrier = async () => {
    reads += 1
    if (reads === expectedReads) release()
    await gate
  }
}

stubModule('src/lib/prisma.ts', {
  default: {
    $transaction: async (callback) => {
      const precedingTransaction = transactionTail
      let releaseTransaction
      transactionTail = new Promise((resolve) => {
        releaseTransaction = resolve
      })
      await precedingTransaction

      let transactionConsumed = consumed
      let transactionOwnerId = ownerId
      const tx = {
        oAuthClient: {
          updateMany: async (args) => {
            calls.ownerClaims.push(args)
            if (
              args.where.client_id === authCode.client_id &&
              args.where.owner_id === null &&
              transactionOwnerId === null
            ) {
              transactionOwnerId = args.data.owner_id
              return { count: 1 }
            }
            return { count: 0 }
          },
        },
        oAuthAuthorizationCode: {
          updateMany: async (args) => {
            calls.consumeAttempts.push(args)
            if (consumeError) throw consumeError
            if (
              args.where.code === authCode.code &&
              args.where.used === false &&
              transactionConsumed === false
            ) {
              transactionConsumed = true
              return { count: 1 }
            }
            return { count: 0 }
          },
        },
      }

      try {
        const result = await callback(tx)
        consumed = transactionConsumed
        ownerId = transactionOwnerId
        return result
      } finally {
        releaseTransaction()
      }
    },
    oAuthAuthorizationCode: {
      findUnique: async () => {
        const snapshot = { ...authCode, used: consumed }
        calls.readSnapshots.push(snapshot.used)
        if (readBarrier) await readBarrier()
        return snapshot
      },
    },
    oAuthClient: {
      findUnique: async () => client,
    },
    agent: {
      findFirst: async () => null,
    },
  },
})

stubModule('src/lib/mcp/auth.ts', {
  createOAuthToken: (...args) => {
    calls.mintAttempts.push(args)
    if (mintError) throw mintError
    const token = `access-token-${calls.mintedTokens.length + 1}`
    calls.mintedTokens.push({ token, args })
    return token
  },
  storedAgentTokenGeneration: () => null,
})

const jiti = require('jiti')(
  path.join(root, 'tests/oauth-code-one-time-consume-entry.cjs'),
  {
    interopDefault: true,
    alias: { '@': path.join(root, 'src') },
    cache: false,
  }
)
const { POST } = jiti(path.join(root, 'src/app/oauth/token/route.ts'))

function tokenRequest(overrides = {}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: authCode.code,
    redirect_uri: authCode.redirect_uri,
    client_id: authCode.client_id,
    code_verifier: verifier,
    ...overrides,
  })
  return new NextRequest('https://app.hypertask.ai/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
}

test('two requests that read the same unused code can mint only one token', async () => {
  resetState()
  holdUntilConcurrentReads()

  const responses = await Promise.all([
    POST(tokenRequest()),
    POST(tokenRequest()),
  ])
  const bodies = await Promise.all(responses.map((response) => response.json()))
  const success = responses.findIndex((response) => response.status === 200)
  const rejected = responses.findIndex((response) => response.status === 400)

  assert.deepEqual(calls.readSnapshots, [false, false])
  assert.notEqual(success, -1)
  assert.notEqual(rejected, -1)
  assert.deepEqual(bodies[success], {
    access_token: 'access-token-1',
    token_type: 'Bearer',
    expires_in: 90 * 24 * 60 * 60,
  })
  assert.deepEqual(bodies[rejected], {
    error: 'invalid_grant',
    error_description: 'Authorization code has already been used',
  })
  assert.equal(calls.mintedTokens.length, 1)
  assert.equal(calls.consumeAttempts.length, 2)
  assert.deepEqual(calls.ownerClaims, [{
    where: { client_id: baseAuthCode.client_id, owner_id: null },
    data: { owner_id: owner.id },
  }])
  assert.equal(ownerId, owner.id)
  for (const attempt of calls.consumeAttempts) {
    assert.deepEqual(attempt, {
      where: { code: baseAuthCode.code, used: false },
      data: { used: true },
    })
  }
})

test('PKCE, expiry, client, and redirect failures do not consume the code', async (t) => {
  const scenarios = [
    {
      name: 'PKCE verifier',
      request: { code_verifier: 'wrong-verifier' },
      error: 'invalid_grant',
      description: 'Invalid code_verifier',
    },
    {
      name: 'expiry',
      authCode: { expires_at: new Date(0) },
      error: 'invalid_grant',
      description: 'Authorization code has expired',
    },
    {
      name: 'client id',
      request: { client_id: 'other-client' },
      error: 'invalid_client',
      description: 'Invalid client_id',
    },
    {
      name: 'deleted client',
      authCode: { client: null },
      error: 'invalid_client',
      description: 'Client not found',
    },
    {
      name: 'redirect URI',
      request: { redirect_uri: 'https://client.example.test/other' },
      error: 'invalid_grant',
      description: 'redirect_uri does not match',
    },
  ]

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      resetState(scenario.authCode ?? {})
      if (scenario.name === 'deleted client') client = null
      const response = await POST(tokenRequest(scenario.request))
      assert.equal(response.status, 400)
      assert.deepEqual(await response.json(), {
        error: scenario.error,
        error_description: scenario.description,
      })
      assert.equal(calls.consumeAttempts.length, 0)
      assert.equal(calls.ownerClaims.length, 0)
      assert.equal(calls.mintedTokens.length, 0)
      assert.equal(consumed, false)
    })
  }
})

test('incomplete user data is rejected before the consume gate', async () => {
  resetState({ user: { email: null } })
  const response = await POST(tokenRequest())

  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), {
    error: 'server_error',
    error_description: 'User data incomplete',
  })
  assert.equal(calls.consumeAttempts.length, 0)
  assert.equal(calls.ownerClaims.length, 0)
  assert.equal(calls.mintedTokens.length, 0)
  assert.equal(consumed, false)
})

test('a consume write failure preserves the existing server error semantics', async () => {
  resetState()
  consumeError = new Error('isolated database failure')
  const originalConsoleError = console.error
  console.error = () => {}
  let response
  try {
    response = await POST(tokenRequest())
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), {
    error: 'server_error',
    error_description: 'Failed to process authorization code',
  })
  assert.equal(calls.ownerClaims.length, 0)
  assert.equal(calls.mintedTokens.length, 0)
})

test('a signing failure rolls back consumption and the code can be redeemed', async () => {
  resetState()
  mintError = new Error('isolated signing failure')
  const originalConsoleError = console.error
  console.error = () => {}
  let failedResponse
  try {
    failedResponse = await POST(tokenRequest())
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(failedResponse.status, 500)
  assert.deepEqual(await failedResponse.json(), {
    error: 'server_error',
    error_description: 'Internal server error',
  })
  assert.equal(calls.mintAttempts.length, 1)
  assert.equal(calls.mintedTokens.length, 0)
  assert.equal(calls.ownerClaims.length, 1)
  assert.equal(consumed, false)
  assert.equal(ownerId, null)

  mintError = null
  const retryResponse = await POST(tokenRequest())
  assert.equal(retryResponse.status, 200)
  assert.deepEqual(await retryResponse.json(), {
    access_token: 'access-token-1',
    token_type: 'Bearer',
    expires_in: 90 * 24 * 60 * 60,
  })
  assert.equal(calls.mintAttempts.length, 2)
  assert.equal(calls.mintedTokens.length, 1)
  assert.equal(calls.ownerClaims.length, 2)
  assert.equal(consumed, true)
  assert.equal(ownerId, owner.id)
})
