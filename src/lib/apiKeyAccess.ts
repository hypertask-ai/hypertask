import { cookies, headers } from 'next/headers'
import { getSessionUser } from '@/lib/auth/getSessionUser'
import prisma from '@/lib/prisma'

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
  if (!isValid || !user?.id) {
    const session = await getSessionUser(await headers())
    if (session?.source !== 'cli-bearer') return null
    return prisma.user.findUnique({ where: { id: session.userId } })
  }

  const session = verifySession(cookieStore.get(SESSION_COOKIE)?.value)
  if (!session || String(session.id) !== String(user.id)) return null

  return user
}
