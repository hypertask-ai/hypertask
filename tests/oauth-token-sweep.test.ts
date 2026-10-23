import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { classifyOAuthToken, decodeOAuthToken, encodeOAuthToken, OAUTH_TOKEN_FIELDS, OAUTH_TOKEN_PREFIX } from '../src/lib/auth/oauthTokenCipher'
import { sweepOAuthTokens, verifyOAuthTokens } from '../src/lib/auth/oauthTokenSweep'
import { oauthTokenPrisma } from './helpers/oauth-token-prisma'

let original: string | undefined
beforeEach(() => { original = process.env.BYOK_CIPHER_SECRET; process.env.BYOK_CIPHER_SECRET = 'synthetic-cipher-root-aaaaaaaaaaaa' })
afterEach(() => { if (original === undefined) delete process.env.BYOK_CIPHER_SECRET; else process.env.BYOK_CIPHER_SECRET = original })
const tokens = { accessToken: 'synthetic-access-token-42c69dbb', refreshToken: 'synthetic-refresh-token-aaaaaaaa', idToken: 'synthetic-id-token-61440815' }
function fixture() {
  const h = oauthTokenPrisma()
  const stable = encodeOAuthToken('accessToken', tokens.accessToken)
  h.tables.BetterAuthAccount.push(
    { id: 1, updatedAt: new Date(1000), ...tokens, scope: 'openid' },
    { id: 2, updatedAt: new Date(2000), accessToken: stable, refreshToken: null, idToken: '' },
    { id: 3, updatedAt: new Date(3000), accessToken: stable, refreshToken: tokens.refreshToken, idToken: null },
  )
  return { ...h, stable }
}

test('still allowed: dry-run counts/authenticates synthetic data and performs no writes', async () => {
  const h = fixture()
  const snapshot = structuredClone(h.tables)
  assert.deepEqual(await sweepOAuthTokens(h.db, 'dry-run'), { scanned: 2, encrypted: 0, conflicts: 0, invalid: 0, remaining: 2 })
  assert.deepEqual(await verifyOAuthTokens(h.db), { total: 6, encrypted: 2, plaintextLeft: 4, failures: 0 })
  assert.deepEqual(h.tables, snapshot)
  assert.equal(h.calls.some(call => call.operation.startsWith('update')), false)
})

test('still allowed: apply encrypts legacy rows, keeps encrypted bytes unchanged and reruns idempotently', async () => {
  const h = fixture()
  assert.deepEqual(await sweepOAuthTokens(h.db), { scanned: 2, encrypted: 2, conflicts: 0, invalid: 0, remaining: 0 })
  for (const field of OAUTH_TOKEN_FIELDS) assert.equal(decodeOAuthToken(field, h.tables.BetterAuthAccount[0][field]), tokens[field])
  assert.equal(h.tables.BetterAuthAccount[1].accessToken, h.stable)
  assert.equal(h.tables.BetterAuthAccount[2].accessToken, h.stable)
  assert.equal(h.tables.BetterAuthAccount[2].idToken, null)
  assert.equal(h.tables.BetterAuthAccount[0].scope, 'openid')
  const writes = h.calls.filter(call => call.operation === 'updateMany')
  assert.deepEqual(Object.keys(writes[0].args.where).sort(), ['accessToken', 'id', 'idToken', 'refreshToken', 'updatedAt'])
  assert.deepEqual(writes[1].args.where, { id: 3, updatedAt: new Date(3000), accessToken: h.stable, refreshToken: tokens.refreshToken, idToken: null })
  assert.deepEqual(Object.keys(writes[1].args.data), ['refreshToken'])
  const snapshot = structuredClone(h.tables)
  assert.deepEqual(await sweepOAuthTokens(h.db), { scanned: 0, encrypted: 0, conflicts: 0, invalid: 0, remaining: 0 })
  assert.deepEqual(h.tables, snapshot)
  assert.deepEqual(await verifyOAuthTokens(h.db), { total: 6, encrypted: 6, plaintextLeft: 0, failures: 0 })
})

test('now refused: stale CAS never overwrites rotated tokens even when updatedAt has the same precision', async () => {
  const h = fixture()
  const replacement = encodeOAuthToken('refreshToken', 'synthetic-rotated-refresh-token-aaaaaaaa')
  h.setBeforeUpdate(() => {
    h.setBeforeUpdate()
    h.tables.BetterAuthAccount[0].refreshToken = replacement
  })
  assert.deepEqual(await sweepOAuthTokens(h.db), { scanned: 2, encrypted: 1, conflicts: 1, invalid: 0, remaining: 1 })
  assert.equal(h.tables.BetterAuthAccount[0].refreshToken, replacement)
  assert.equal(h.tables.BetterAuthAccount[0].accessToken, tokens.accessToken)
  await sweepOAuthTokens(h.db)
  assert.equal(h.tables.BetterAuthAccount[0].refreshToken, replacement)
  assert.equal(classifyOAuthToken('accessToken', h.tables.BetterAuthAccount[0].accessToken), 'encrypted')
})

test('now refused: an invalid value stops the current batch before any encrypted writes', async () => {
  const h = fixture()
  h.tables.BetterAuthAccount[2].idToken = `${OAUTH_TOKEN_PREFIX}synthetic-invalid-envelope`
  assert.deepEqual(await sweepOAuthTokens(h.db), { scanned: 2, encrypted: 0, conflicts: 0, invalid: 1, remaining: 2 })
  assert.equal(h.calls.some(call => call.operation === 'updateMany'), false)
  assert.equal(h.tables.BetterAuthAccount[0].accessToken, tokens.accessToken)
  assert.deepEqual(await verifyOAuthTokens(h.db), { total: 7, encrypted: 2, plaintextLeft: 4, failures: 1 })
})

test('verify authenticates encrypted-only rows and rejects unknown versions without writing', async () => {
  const h = fixture()
  await sweepOAuthTokens(h.db)
  h.calls.length = 0
  h.tables.BetterAuthAccount[1].accessToken = h.stable.replace(':v1:', ':v9:')
  h.tables.BetterAuthAccount[2].accessToken = `${OAUTH_TOKEN_PREFIX}synthetic-invalid-envelope`
  assert.deepEqual(await verifyOAuthTokens(h.db), { total: 6, encrypted: 4, plaintextLeft: 0, failures: 2 })
  assert.equal(h.calls.some(call => call.operation === 'updateMany'), false)
})

test('sweep processes one ascending batch of 100 and respects the write deadline', async () => {
  const h = oauthTokenPrisma()
  for (let id = 205; id >= 1; id--) h.tables.BetterAuthAccount.push({ id, updatedAt: new Date(id), ...tokens })
  const first = await sweepOAuthTokens(h.db)
  assert.equal(first.scanned, 100)
  assert.equal(first.encrypted, 100)
  assert.equal(first.remaining, 105)
  const writes = h.calls.filter(call => call.operation === 'updateMany')
  assert.deepEqual(writes.map(call => call.args.where.id), Array.from({ length: 100 }, (_, index) => index + 1))
  const expired = await sweepOAuthTokens(h.db, 'apply', 0)
  assert.equal(expired.encrypted, 0)
  assert.equal(expired.remaining, 105)
  assert.deepEqual(await verifyOAuthTokens(h.db), { total: 615, encrypted: 300, plaintextLeft: 315, failures: 0 })
  await assert.rejects(verifyOAuthTokens(h.db, 0), /^Error: oauth_token_verification_incomplete$/)
})

test('success and injected failure logs/errors contain no token or ciphertext data', async t => {
  const h = fixture()
  const logs: unknown[] = []
  for (const method of ['log', 'warn', 'error', 'debug'] as const) t.mock.method(console, method, (...args) => { logs.push(args) })
  await sweepOAuthTokens(h.db)
  h.setFailure(new Error(tokens.accessToken + h.stable))
  await assert.rejects(sweepOAuthTokens(h.db), error => error instanceof Error && error.message === 'oauth_token_sweep_failed' && !error.cause)
  await assert.rejects(verifyOAuthTokens(h.db), error => error instanceof Error && error.message === 'oauth_token_verification_failed' && !error.cause)
  for (const raw of [...Object.values(tokens), h.stable]) assert.equal(JSON.stringify(logs).includes(raw), false)
})

test('overlapping sweeps converge through CAS without rewriting already-encrypted fields', async () => {
  const h = fixture()
  const results = await Promise.all([sweepOAuthTokens(h.db), sweepOAuthTokens(h.db)])
  assert.equal(results.reduce((sum, result) => sum + result.encrypted, 0), 2)
  assert.equal(results.reduce((sum, result) => sum + result.conflicts, 0), 2)
  assert.equal(h.tables.BetterAuthAccount[2].accessToken, h.stable)
  assert.deepEqual(await verifyOAuthTokens(h.db), { total: 6, encrypted: 6, plaintextLeft: 0, failures: 0 })
})
