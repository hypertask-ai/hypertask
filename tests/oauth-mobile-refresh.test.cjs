const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const path = require('node:path')
const jwt = require('jsonwebtoken')
const { NextRequest } = require('next/server')

const root = path.resolve(__dirname, '..')
process.env.JWT_SECRET = 'oauth-mobile-refresh-test-secret-32-chars'
process.env.JWT_ISSUER = 'https://app.hypertask.ai'
process.env.JWT_OAUTH_AUDIENCE = 'hypertask-native-test'
process.env.SESSION_SECRET = 'oauth-mobile-refresh-session-test-secret'

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath)
  require.cache[filename] = { id: filename, filename, loaded: true, exports }
}

const verifier = 'mobile-refresh-code-verifier-with-sufficient-length'
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
const owner = {
  id: 6,
  email: 'owner@example.test',
  uid: 'firebase-owner',
  mcpTokensRevokedAt: null,
}
const clientId = 'android-client'
const refreshRows = new Map()
const revokedAccessTokens = []
let authorizationCodeUsed = false
let claimedOwnerId = null
const clientLocks = []
// Runs once after a refresh-row read is snapshotted, to race another request in.
let afterNextRefreshRead = null

const authCode = {
  code: 'android-one-time-code',
  client_id: clientId,
  redirect_uri: 'hypertask-native://oauth/callback',
  code_challenge: challenge,
  expires_at: null,
  used: false,
  agent_id: null,
  firebase_uid: owner.uid,
  user: owner,
}

function transactionClient() {
  return {
    $queryRaw: async (strings, ...values) => {
      clientLocks.push({ sql: strings.join('?'), values })
      return [{ client_id: clientId }]
    },
    oAuthClient: {
      updateMany: async ({ where, data }) => {
        if (
          where.client_id !== clientId ||
          where.owner_id !== null ||
          claimedOwnerId !== null
        ) {
          return { count: 0 }
        }
        claimedOwnerId = data.owner_id
        return { count: 1 }
      },
    },
    oAuthAuthorizationCode: {
      updateMany: async () => {
        if (authorizationCodeUsed) return { count: 0 }
        authorizationCodeUsed = true
        return { count: 1 }
      },
    },
    oAuthRefreshToken: {
      create: async ({ data }) => {
        const row = {
          id: `refresh-${refreshRows.size + 1}`,
          ...data,
          user: owner,
          revokedAt: null,
          replacedByHash: null,
          createdAt: new Date(),
        }
        refreshRows.set(data.tokenHash, row)
        return row
      },
      findMany: async ({ where }) => [...refreshRows.values()].filter((row) =>
        row.familyId === where.familyId &&
        (!Object.hasOwn(where, 'clientId') || row.clientId === where.clientId) &&
        row.revokedAt === null
      ),
      updateMany: async ({ where, data }) => {
        if (where.familyId) {
          let count = 0
          for (const row of refreshRows.values()) {
            if (
              row.familyId === where.familyId &&
              (!Object.hasOwn(where, 'clientId') || row.clientId === where.clientId) &&
              row.revokedAt === null
            ) {
              Object.assign(row, data)
              count += 1
            }
          }
          return { count }
        }
        const row = [...refreshRows.values()].find((candidate) => candidate.id === where.id)
        if (
          !row ||
          row.revokedAt ||
          row.clientId !== where.clientId ||
          (where.expiresAt && row.expiresAt <= where.expiresAt.gt)
        ) {
          return { count: 0 }
        }
        Object.assign(row, data)
        return { count: 1 }
      },
    },
    revokedToken: {
      upsert: async ({ create }) => {
        revokedAccessTokens.push(create)
        return create
      },
    },
    user: {
      findUnique: async ({ where }) => {
        const row = [...refreshRows.values()].find((candidate) => candidate.user.id === where.id)
        return row ? { mcpTokensRevokedAt: row.user.mcpTokensRevokedAt } : null
      },
    },
  }
}

let requestCookies = {}
let approvedGrant = null
const nextHeaders = require('next/headers')
nextHeaders.cookies = async () => ({
  get: (name) => requestCookies[name] === undefined
    ? undefined
    : { name, value: requestCookies[name] },
})
stubModule('src/lib/telemetry/activationOccurrences.ts', {
  recordAgentConnection: () => {},
  recordAuthenticatedConnection: () => {},
})

stubModule('src/utils/controllers/logs/createLog.ts', { default: async () => {} })
stubModule('src/lib/mcp/clientTelemetry.ts', { logMcpCliUsage: () => {} })

stubModule('src/lib/prisma.ts', {
  default: {
    $transaction: async (callback) => callback(transactionClient()),
    user: {
      findUnique: async ({ where }) => where.id === owner.id ? owner : null,
      findFirst: async () => {
        assert.fail('OAuth access tokens must resolve by signed userId, not sub or email')
      },
    },
    revokedToken: {
      findFirst: async ({ where }) => revokedAccessTokens.find((row) =>
        row.user_id === where.user_id && where.jti.in.includes(row.jti)
      ) ?? null,
    },
    oAuthAuthorizationCode: {
      create: async ({ data }) => {
        Object.assign(authCode, data)
        authorizationCodeUsed = false
        return authCode
      },
      findUnique: async ({ where }) => where.code === authCode.code
        ? { ...authCode, used: authorizationCodeUsed }
        : null,
    },
    oAuthClientGrant: {
      findUnique: async () => approvedGrant,
      upsert: async ({ create }) => {
        approvedGrant = create
        return create
      },
    },
    oAuthClient: {
      findUnique: async ({ where }) => where.client_id === clientId ? {
        client_id: clientId,
        redirect_uris: ['hypertask-native://oauth/callback', 'https://client.example.test/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
      } : null,
    },
    oAuthRefreshToken: {
      findUnique: async ({ where }) => {
        const row = refreshRows.get(where.tokenHash)
        if (!row || !afterNextRefreshRead) return row ?? null
        const snapshot = { ...row }
        const race = afterNextRefreshRead
        afterNextRefreshRead = null
        await race()
        return snapshot
      },
    },
    agent: { findFirst: async () => null },
  },
})

const jiti = require('jiti')(
  path.join(root, 'tests/oauth-mobile-refresh-entry.cjs'),
  { interopDefault: true, alias: { '@': path.join(root, 'src') }, cache: false },
)
const { POST: exchangeToken } = jiti(path.join(root, 'src/app/oauth/token/route.ts'))
const { POST: revokeToken } = jiti(path.join(root, 'src/app/oauth/revoke/route.ts'))
const { GET: authorizeGet, POST: authorizePost } = jiti(path.join(root, 'src/app/oauth/authorize/route.ts'))
const { signSession } = jiti(path.join(root, 'src/lib/auth/session.ts'))
const { validateMcpAuth } = jiti(path.join(root, 'src/lib/mcp/auth.ts'))

function formRequest(pathname, values) {
  return new NextRequest(`https://app.hypertask.ai${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  })
}

test('Android receives a hashed, rotating, revocable OAuth session', async () => {
  // Set the fixture when the exchange begins: top-level route imports can be
  // queued behind other test workers for longer than an OAuth code lifetime.
  authCode.expires_at = new Date(Date.now() + 10 * 60_000)
  const initialResponse = await exchangeToken(formRequest('/oauth/token', {
    grant_type: 'authorization_code',
    code: authCode.code,
    redirect_uri: authCode.redirect_uri,
    client_id: clientId,
    code_verifier: verifier,
  }))
  const initial = await initialResponse.json()

  assert.equal(initialResponse.status, 200, JSON.stringify(initial))
  assert.equal(clientLocks.length, 1)
  assert.match(clientLocks[0].sql, /WHERE "client_id" = \?\s+FOR UPDATE/)
  assert.deepEqual(clientLocks[0].values, [clientId])
  assert.equal(claimedOwnerId, owner.id)
  const initialAccess = jwt.verify(initial.access_token, process.env.JWT_SECRET, {
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_OAUTH_AUDIENCE,
  })

  assert.equal(initial.expires_in, 60 * 60)
  assert.match(initial.refresh_token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(typeof initialAccess.jti, 'string')
  assert.equal(initialAccess.client_id, clientId)
  const initialHash = crypto.createHash('sha256').update(initial.refresh_token).digest('hex')
  const initialRow = refreshRows.get(initialHash)
  assert.ok(initialRow)
  assert.equal(initialRow.accessTokenJti, initialAccess.jti)
  assert.equal(JSON.stringify(initialRow).includes(initial.refresh_token), false)

  const refreshResponse = await exchangeToken(formRequest('/oauth/token', {
    grant_type: 'refresh_token',
    refresh_token: initial.refresh_token,
    client_id: clientId,
  }))
  const refreshed = await refreshResponse.json()
  const refreshedAccess = jwt.decode(refreshed.access_token)

  assert.equal(refreshResponse.status, 200)
  assert.notEqual(refreshed.refresh_token, initial.refresh_token)
  assert.equal(refreshedAccess.client_id, clientId)
  assert.notEqual(refreshedAccess.jti, initialAccess.jti)
  assert.equal(clientLocks.length, 2)
  assert.deepEqual(clientLocks[1].values, [clientId])
  assert.equal(refreshRows.get(
    crypto.createHash('sha256').update(refreshed.refresh_token).digest('hex'),
  ).familyId, initialRow.familyId)
  assert.ok(initialRow.revokedAt instanceof Date)
  assert.equal(revokedAccessTokens[0].jti, initialAccess.jti)

  const replayResponse = await exchangeToken(formRequest('/oauth/token', {
    grant_type: 'refresh_token',
    refresh_token: initial.refresh_token,
    client_id: clientId,
  }))
  assert.equal(replayResponse.status, 400)
  assert.equal((await replayResponse.json()).error, 'invalid_grant')

  const refreshedHash = crypto.createHash('sha256').update(refreshed.refresh_token).digest('hex')
  assert.ok(refreshRows.get(refreshedHash).revokedAt instanceof Date)
  assert.equal(revokedAccessTokens.at(-1).jti, refreshedAccess.jti)

  const revokeResponse = await revokeToken(formRequest('/oauth/revoke', {
    token: refreshed.refresh_token,
    token_type_hint: 'refresh_token',
    client_id: clientId,
  }))
  assert.equal(revokeResponse.status, 200)
  assert.ok(refreshRows.get(refreshedHash).revokedAt instanceof Date)
  assert.equal(revokedAccessTokens.at(-1).jti, refreshedAccess.jti)
})

test('account-wide revocation blocks older native refresh sessions', async () => {
  const token = 'refresh-before-account-revocation'
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  const createdAt = new Date(Date.now() - 60_000)
  const revokedOwner = {
    ...owner,
    id: 7,
    mcpTokensRevokedAt: new Date(),
  }
  refreshRows.set(hash, {
    id: 'revoked-by-account',
    tokenHash: hash,
    clientId,
    userId: revokedOwner.id,
    firebaseUid: revokedOwner.uid,
    user: revokedOwner,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt,
  })

  const response = await exchangeToken(formRequest('/oauth/token', {
    grant_type: 'refresh_token',
    refresh_token: token,
    client_id: clientId,
  }))

  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'invalid_grant')
})

test('native revocation endpoint explicitly rejects access-token hints', async () => {
  const response = await revokeToken(formRequest('/oauth/revoke', {
    token: 'access-token',
    token_type_hint: 'access_token',
    client_id: clientId,
  }))

  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'unsupported_token_type')
})

test('a refresh token replayed concurrently still revokes the winning successor', async () => {
  const token = 'refresh-raced-by-attacker'
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  refreshRows.set(hash, {
    id: 'raced-refresh',
    tokenHash: hash,
    familyId: 'raced-family',
    clientId,
    userId: owner.id,
    firebaseUid: owner.uid,
    user: owner,
    accessTokenJti: 'raced-access-jti',
    accessTokenExpiresAt: new Date(Date.now() - 1_000),
    revokedAt: null,
    replacedByHash: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  })

  let winner
  // The loser reads the row while it is still active, then the winner rotates it.
  afterNextRefreshRead = async () => {
    const response = await exchangeToken(formRequest('/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: token,
      client_id: clientId,
    }))
    assert.equal(response.status, 200)
    winner = await response.json()
  }
  const loser = await exchangeToken(formRequest('/oauth/token', {
    grant_type: 'refresh_token',
    refresh_token: token,
    client_id: clientId,
  }))

  assert.equal(loser.status, 400)
  assert.equal((await loser.json()).error, 'invalid_grant')
  const winnerHash = crypto.createHash('sha256').update(winner.refresh_token).digest('hex')
  assert.ok(refreshRows.get(winnerHash).revokedAt instanceof Date)
  assert.equal(revokedAccessTokens.at(-1).jti, jwt.decode(winner.access_token).jti)
})

for (const uid of [null, '', 'firebase-owner']) {
  test(`signed-in user with uid ${JSON.stringify(uid)} authorizes, exchanges and authenticates MCP`, async (t) => {
    for (const redirectUri of ['https://client.example.test/callback', 'hypertask-native://oauth/callback']) {
      await t.test(redirectUri, async () => {
        owner.uid = uid
        owner.mcpTokensRevokedAt = null
        approvedGrant = null
        claimedOwnerId = null
        refreshRows.clear()
        revokedAccessTokens.length = 0
        requestCookies = {
          ht_session: signSession({ id: owner.id }),
          nookies_user: JSON.stringify({ id: 99, uid: 'firebase-victim' }),
        }
        const expectedSubject = uid || String(owner.id)
        const params = {
          response_type: 'code',
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 'identity-test-state',
        }
        const authorizeUrl = new URL('https://app.hypertask.ai/oauth/authorize')
        authorizeUrl.search = new URLSearchParams(params).toString()
        const consent = await authorizeGet(new NextRequest(authorizeUrl))
        assert.equal(consent.status, 307)
        const consentUrl = new URL(consent.headers.get('location'))
        assert.equal(consentUrl.pathname, '/oauth/consent')
        const approved = await authorizePost(formRequest('/oauth/authorize',
          Object.fromEntries(consentUrl.searchParams),
        ))
        assert.equal(approved.status, 303)
        const successUrl = new URL(approved.headers.get('location'))
        assert.equal(successUrl.pathname, '/oauth/success')
        const callback = new URL(successUrl.searchParams.get('redirect_uri'))
        assert.equal(callback.searchParams.get('state'), params.state)
        assert.equal(authCode.user_id, owner.id)
        assert.equal(authCode.firebase_uid, expectedSubject)

        const exchange = await exchangeToken(formRequest('/oauth/token', {
          grant_type: 'authorization_code',
          code: callback.searchParams.get('code'),
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: verifier,
        }))
        const initial = await exchange.json()
        assert.equal(exchange.status, 200, JSON.stringify(initial))
        assert.equal(jwt.decode(initial.access_token).sub, expectedSubject)
        assert.equal(jwt.decode(initial.access_token).userId, owner.id)
        const mcpRequest = (token) => new NextRequest('https://app.hypertask.ai/api/mcp/tasks', {
          headers: { Authorization: `Bearer ${token}` },
        })
        assert.equal((await validateMcpAuth(mcpRequest(initial.access_token)))?.user.id, owner.id)

        if (redirectUri.startsWith('hypertask-native:')) {
          const initialHash = crypto.createHash('sha256').update(initial.refresh_token).digest('hex')
          const initialRow = refreshRows.get(initialHash)
          assert.equal(initialRow.firebaseUid, expectedSubject)
          initialRow.firebaseUid = 'wrong-identity'
          const mismatch = await exchangeToken(formRequest('/oauth/token', {
            grant_type: 'refresh_token',
            refresh_token: initial.refresh_token,
            client_id: clientId,
          }))
          assert.equal(mismatch.status, 400)
          assert.equal((await mismatch.json()).error, 'invalid_grant')
          assert.equal(initialRow.revokedAt, null)
          initialRow.firebaseUid = expectedSubject

          const refresh = await exchangeToken(formRequest('/oauth/token', {
            grant_type: 'refresh_token',
            refresh_token: initial.refresh_token,
            client_id: clientId,
          }))
          const refreshed = await refresh.json()
          assert.equal(refresh.status, 200, JSON.stringify(refreshed))
          assert.equal(jwt.decode(refreshed.access_token).sub, expectedSubject)
          assert.equal(jwt.decode(refreshed.access_token).userId, owner.id)
          assert.notEqual(refreshed.refresh_token, initial.refresh_token)
          const refreshedHash = crypto.createHash('sha256').update(refreshed.refresh_token).digest('hex')
          assert.equal(refreshRows.get(refreshedHash).firebaseUid, expectedSubject)
          assert.equal((await validateMcpAuth(mcpRequest(refreshed.access_token)))?.user.id, owner.id)
          assert.equal(await validateMcpAuth(mcpRequest(initial.access_token)), null)
        } else {
          assert.equal(initial.refresh_token, undefined)
        }

        const reconnect = await authorizeGet(new NextRequest(authorizeUrl))
        assert.equal(new URL(reconnect.headers.get('location')).pathname, '/oauth/success')
        assert.equal(authCode.firebase_uid, expectedSubject)
      })
    }
  })
}
