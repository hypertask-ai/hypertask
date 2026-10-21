import { cookies } from 'next/headers'

import { isValidUser } from '@/utils/edgeHelpers'
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'

export const apiKeySelect = {
  id: true,
  name: true,
  keyPrefix: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
  expiresAt: true,
} as const

export async function getApiKeyOwnerFromCookies() {
  const cookieStore = await cookies()
  const { isValid, user } = isValidUser(cookieStore.get('nookies_user')?.value)
  if (!isValid || !user?.id) return null

  const session = verifySession(cookieStore.get(SESSION_COOKIE)?.value)
  if (!session || String(session.id) !== String(user.id)) return null

  return user
}
