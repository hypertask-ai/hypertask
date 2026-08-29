import { cookies } from 'next/headers'

import { isValidUser } from '@/utils/edgeHelpers'
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'

/** Fields safe to return for a REST API key. Never includes the hash. */
export const apiKeySelect = {
  id: true,
  name: true,
  keyPrefix: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
  expiresAt: true,
} as const

/**
 * Resolves the signed-in user for API key management.
 *
 * `nookies_user` is unsigned JSON that any client can write, so it identifies
 * the account but cannot authenticate it. The signed `ht_session` cookie is
 * what proves the caller, and both must name the same user before we mint,
 * rotate, or revoke a full-account credential.
 */
export async function getApiKeyOwnerFromCookies() {
  const cookieStore = await cookies()
  const { isValid, user } = isValidUser(cookieStore.get('nookies_user')?.value)
  if (!isValid || !user?.id) return null

  const session = verifySession(cookieStore.get(SESSION_COOKIE)?.value)
  if (!session || String(session.id) !== String(user.id)) return null

  return user
}
