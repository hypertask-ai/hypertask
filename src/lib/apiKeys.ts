import { createHash, randomBytes } from 'crypto'

// The pure lifecycle rules live in `@/lib/apiKeyExpiry` so the Prisma client
// singleton can import them without pulling `crypto` into every bundle that
// touches the database. Re-exported here so callers have one import site.
export {
  API_KEY_AUTH_LOOKUP_OPERATIONS,
  API_KEY_EXPIRY_DAY_OPTIONS,
  API_KEY_MAX_EXPIRY_DAYS,
  API_KEY_SCOPE_LABEL,
  activeApiKeyWhere,
  isApiKeyAuthLookup,
  isApiKeyUsable,
  resolveApiKeyExpiry,
  withApiKeyExpiryGuard,
} from '@/lib/apiKeyExpiry'

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function generateApiKey(): {
  key: string
  keyHash: string
  keyPrefix: string
} {
  const key = `htk_${randomBytes(32).toString('base64url')}`

  return {
    key,
    keyHash: hashApiKey(key),
    keyPrefix: key.slice(0, 12),
  }
}
