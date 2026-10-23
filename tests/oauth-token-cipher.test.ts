import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { createDecipheriv, hkdfSync } from 'node:crypto'
import { classifyOAuthToken, decodeOAuthToken, encodeOAuthToken, OAUTH_TOKEN_FIELDS, OAUTH_TOKEN_PREFIX, preflightOAuthTokenKey } from '../src/lib/auth/oauthTokenCipher'
import { encryptSecret } from '../src/lib/crypto/byokCipher'

const rootSecret = 'synthetic-cipher-root-aaaaaaaaaaaa'
let original: string | undefined
beforeEach(() => { original = process.env.BYOK_CIPHER_SECRET; process.env.BYOK_CIPHER_SECRET = rootSecret })
afterEach(() => {
  if (original === undefined) delete process.env.BYOK_CIPHER_SECRET
  else process.env.BYOK_CIPHER_SECRET = original
})

for (const field of OAUTH_TOKEN_FIELDS) {
  test(`still allowed: ${field} round-trips using the frozen HKDF AES-GCM envelope`, () => {
    const raw = `synthetic-${field}-947d4a81-b338-46ce-9486-43a83be1e771`
    const stored = encodeOAuthToken(field, raw)
    assert.ok(stored.startsWith(OAUTH_TOKEN_PREFIX))
    assert.notEqual(stored, raw)
    assert.equal(decodeOAuthToken(field, stored), raw)
    assert.equal(classifyOAuthToken(field, stored), 'encrypted')
    const bytes = Buffer.from(stored.slice(OAUTH_TOKEN_PREFIX.length), 'base64')
    const derived = Buffer.from(hkdfSync('sha256', Buffer.from(rootSecret), 'hypertask-oauth-token-salt-v1', 'hypertask/better-auth-account-oauth/v1', 32))
    const cipher = createDecipheriv('aes-256-gcm', derived, bytes.subarray(0, 12))
    cipher.setAAD(Buffer.from(`BetterAuthAccount:${field}`))
    cipher.setAuthTag(bytes.subarray(12, 28))
    assert.equal(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(), raw)
    assert.notEqual(encodeOAuthToken(field, raw), stored)
  })

  test(`now refused: ${field} cannot authenticate BYOK ciphertext or another field`, () => {
    const raw = 'synthetic-access-token-65362057-a09a-45c1-ae42-f400625bff24'
    const foreign = OAUTH_TOKEN_PREFIX + encryptSecret(raw)
    assert.throws(() => decodeOAuthToken(field, foreign), /^Error: oauth_token_decode_failed$/)
    for (const other of OAUTH_TOKEN_FIELDS.filter(other => other !== field)) {
      assert.throws(() => decodeOAuthToken(other, encodeOAuthToken(field, raw)), /^Error: oauth_token_decode_failed$/)
    }
  })
}

test('still allowed: marker-looking plaintext is always encrypted and legacy hex stays readable', () => {
  const raw = `${OAUTH_TOKEN_PREFIX}synthetic-marker-looking-30e81870`
  const stored = encodeOAuthToken('accessToken', raw)
  assert.notEqual(stored, raw)
  assert.equal(decodeOAuthToken('accessToken', stored), raw)
  for (const legacy of ['deadbeef', 'synthetic-legacy-access-token-872f05c4']) {
    assert.equal(decodeOAuthToken('accessToken', legacy), legacy)
    assert.equal(classifyOAuthToken('accessToken', legacy), 'plaintext')
  }
  for (const empty of [null, undefined, '']) {
    assert.equal(encodeOAuthToken('accessToken', empty), empty)
    assert.equal(decodeOAuthToken('accessToken', empty), empty)
    assert.equal(classifyOAuthToken('accessToken', empty), 'empty')
  }
})

test('now refused: unknown versions, tampering, wrong root and malformed envelopes fail without reflecting input', () => {
  const stored = encodeOAuthToken('accessToken', 'synthetic-access-token-b81ec152')
  const bytes = Buffer.from(stored.slice(OAUTH_TOKEN_PREFIX.length), 'base64')
  bytes[28] ^= 1
  for (const invalid of [stored.replace(':v1:', ':v2:'), OAUTH_TOKEN_PREFIX + bytes.toString('base64'), `${OAUTH_TOKEN_PREFIX}synthetic-invalid-envelope`, stored + ' ']) {
    assert.throws(() => decodeOAuthToken('accessToken', invalid), error => error instanceof Error && error.message === 'oauth_token_decode_failed' && !error.cause)
    assert.equal(classifyOAuthToken('accessToken', invalid), 'invalid')
  }
  process.env.BYOK_CIPHER_SECRET = 'synthetic-other-root-secret-aaaaaaaa'
  assert.throws(() => decodeOAuthToken('accessToken', stored), /^Error: oauth_token_decode_failed$/)
})

test('now refused: missing or short root fails preflight and never writes plaintext', () => {
  for (const secret of [undefined, '', 'synthetic-short']) {
    if (secret === undefined) delete process.env.BYOK_CIPHER_SECRET
    else process.env.BYOK_CIPHER_SECRET = secret
    assert.throws(preflightOAuthTokenKey, /^Error: oauth_token_key_unavailable$/)
    assert.throws(() => encodeOAuthToken('accessToken', 'synthetic-access-token-8ea7395d'), /^Error: oauth_token_encode_failed$/)
  }
})
