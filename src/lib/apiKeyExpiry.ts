/**
 * Pure REST API key lifecycle rules. Deliberately free of Node imports: this
 * module is pulled in by the Prisma client singleton, which nearly every route
 * imports, so it must stay safe to bundle anywhere.
 *
 * Key generation and hashing (which do need `crypto`) live in `@/lib/apiKeys`.
 */

/**
 * Scope granted by a REST API key. Keys are full-account credentials today;
 * per-endpoint scoping is tracked separately (HTPR-4501 defers it).
 */
export const API_KEY_SCOPE_LABEL = 'Full account access'

export const API_KEY_MAX_EXPIRY_DAYS = 365

/** Expiry choices offered when creating or rotating a REST API key. */
export const API_KEY_EXPIRY_DAY_OPTIONS = [30, 90, 365] as const

/**
 * Turns a requested lifetime in days into an absolute expiry.
 *
 * `undefined`/`null` means "never expires", which is what every key issued
 * before expiry support had. Anything else must be a whole number of days
 * between 1 and 365, so a typo cannot mint a key that outlives the account.
 */
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

/**
 * A key authenticates requests only while it is neither revoked nor expired.
 * An expiry exactly at `now` counts as expired: the key is dead the instant it
 * reaches its stated lifetime.
 */
export function isApiKeyUsable(
  key: { revokedAt?: Date | null; expiresAt?: Date | null },
  now: Date = new Date()
): boolean {
  if (key.revokedAt) return false
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return false
  return true
}

/**
 * Prisma `where` fragment matching only keys that still authenticate. Shared by
 * lookup paths so expiry cannot be enforced in one place and forgotten in
 * another.
 */
export function activeApiKeyWhere(now: Date = new Date()) {
  return {
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }
}

/** Prisma operations that can resolve a secret to an account. */
export const API_KEY_AUTH_LOOKUP_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
])

/**
 * True when a query looks up an ApiKey *by its secret hash*, which only ever
 * happens while authenticating a request. Management screens list keys by
 * `userId` and must keep seeing expired ones, so they are deliberately excluded.
 */
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

/**
 * True when a `where` clause constrains `keyHash` anywhere, including nested
 * under `AND`/`OR`/`NOT`. A top-level-only check would let a composed
 * authentication query slip past the guard and resolve an expired key.
 */
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

/**
 * Adds the expiry guard to an authentication `where` clause without disturbing
 * what the caller already asked for. `AND` is used rather than merging into a
 * top-level `OR`, so a caller's own `OR` cannot accidentally widen the guard
 * into "expired OR whatever the caller wanted".
 */
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
