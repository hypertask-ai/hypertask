import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

export const OAUTH_TOKEN_MARKER = 'ht-ba-oauth:'
export const OAUTH_TOKEN_PREFIX = `${OAUTH_TOKEN_MARKER}v1:`
export const OAUTH_TOKEN_FIELDS = ['accessToken', 'refreshToken', 'idToken'] as const
export type OAuthTokenField = typeof OAUTH_TOKEN_FIELDS[number]
type TokenValue = string | null | undefined

function key() {
  const secret = process.env.BYOK_CIPHER_SECRET
  if (!secret || secret.length < 16) throw new Error('oauth_token_key_unavailable')
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), 'hypertask-oauth-token-salt-v1', 'hypertask/better-auth-account-oauth/v1', 32))
}

export function preflightOAuthTokenKey() {
  key()
}

export function encodeOAuthToken<T extends TokenValue>(field: OAuthTokenField, raw: T): T {
  if (raw == null || raw === '') return raw
  try {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key(), iv)
    cipher.setAAD(Buffer.from(`BetterAuthAccount:${field}`, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
    return (OAUTH_TOKEN_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')) as T
  } catch {
    throw new Error('oauth_token_encode_failed')
  }
}

export function decodeOAuthToken<T extends TokenValue>(field: OAuthTokenField, raw: T): T {
  if (raw == null || !raw.startsWith(OAUTH_TOKEN_MARKER)) return raw
  try {
    if (!raw.startsWith(OAUTH_TOKEN_PREFIX)) throw new Error()
    const payload = raw.slice(OAUTH_TOKEN_PREFIX.length)
    const bytes = Buffer.from(payload, 'base64')
    if (bytes.length < 29 || bytes.toString('base64') !== payload) throw new Error()
    const decipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12))
    decipher.setAAD(Buffer.from(`BetterAuthAccount:${field}`, 'utf8'))
    decipher.setAuthTag(bytes.subarray(12, 28))
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8') as T
  } catch {
    throw new Error('oauth_token_decode_failed')
  }
}

export function classifyOAuthToken(field: OAuthTokenField, raw: TokenValue): 'empty' | 'plaintext' | 'encrypted' | 'invalid' {
  if (raw == null || raw === '') return 'empty'
  if (!raw.startsWith(OAUTH_TOKEN_MARKER)) return 'plaintext'
  try {
    decodeOAuthToken(field, raw)
    return 'encrypted'
  } catch {
    return 'invalid'
  }
}
