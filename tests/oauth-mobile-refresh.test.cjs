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

stubModule('src/lib/prisma.ts', {
  default: {
    $transaction: async (callback) => callback(transactionClient()),
    oAuthAuthorizationCode: {
      findUnique: async () => ({ ...authCode, used: authorizationCodeUsed }),
    },
    oAuthClient: {
      findUnique: async () => ({
        client_id: clientId,
        grant_types: ['authorization_code', 'refresh_token'],
      }),
    },
    oAuthRefreshToken: {
      findUnique: async ({ where }) => refreshRows.get(where.tokenHash) ?? null,
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
  const initialAccess = jwt.verify(initial.access_token, process.env.JWT_SECRET, {
    issuer: process.env.JWT_ISSUER,
    audience: process.env.JWT_OAUTH_AUDIENCE,
  })

  assert.equal(initial.expires_in, 60 * 60)
  assert.match(initial.refresh_token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(typeof initialAccess.jti, 'string')
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
  assert.notEqual(refreshedAccess.jti, initialAccess.jti)
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
