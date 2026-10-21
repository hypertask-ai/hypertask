
export const API_KEY_SCOPE_LABEL = 'Full account access'

export const API_KEY_MAX_EXPIRY_DAYS = 365

export const API_KEY_EXPIRY_DAY_OPTIONS = [30, 90, 365] as const

export function resolveApiKeyExpiry(
  expiresInDays: unknown,
  now: Date = new Date()
): { ok: true; expiresAt: Date | null } | { ok: false; error: string } {
  if (expiresInDays === undefined || expiresInDays === null) {
    return { ok: true, expiresAt: null }
  }

  if (
    typeof expiresInDays !== 'number' ||
    !Number.isInteger(expiresInDays) ||
    expiresInDays < 1 ||
    expiresInDays > API_KEY_MAX_EXPIRY_DAYS
  ) {
    return {
      ok: false,
      error: `expiresInDays must be a whole number of days between 1 and ${API_KEY_MAX_EXPIRY_DAYS}`,
    }
  }

  return {
    ok: true,
    expiresAt: new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000),
  }
}

export function isApiKeyUsable(
  key: { revokedAt?: Date | null; expiresAt?: Date | null },
  now: Date = new Date()
): boolean {
  if (key.revokedAt) return false
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return false
  return true
}

export function activeApiKeyWhere(now: Date = new Date()) {
  return {
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }
}

export const API_KEY_AUTH_LOOKUP_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
])

export function isApiKeyAuthLookup(
  model: string | undefined,
  operation: string,
  args: unknown
): boolean {
  if (model !== 'ApiKey') return false
  if (!API_KEY_AUTH_LOOKUP_OPERATIONS.has(operation)) return false
  if (!args || typeof args !== 'object') return false

  const where = (args as { where?: Record<string, unknown> }).where
  return mentionsKeyHash(where)
}

function mentionsKeyHash(where: unknown, depth = 0): boolean {
  if (!where || typeof where !== 'object' || depth > 8) return false
  if (Array.isArray(where)) {
    return where.some((entry) => mentionsKeyHash(entry, depth + 1))
  }

  const clause = where as Record<string, unknown>
  if (clause.keyHash !== undefined) return true

  return ['AND', 'OR', 'NOT'].some((key) =>
    mentionsKeyHash(clause[key], depth + 1)
  )
}

export function withApiKeyExpiryGuard(
  where: Record<string, unknown>,
  now: Date = new Date()
): Record<string, unknown> {
  const guard = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
  const existingAnd = where.AND

  return {
    ...where,
    AND: Array.isArray(existingAnd)
      ? [...existingAnd, guard]
      : existingAnd
        ? [existingAnd, guard]
        : [guard],
  }
}
