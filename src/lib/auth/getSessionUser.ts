import { parseCookies } from 'better-auth/cookies'

import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'
import { isSessionTokenRevoked } from '@/lib/auth/sessionRevocation'

export type SessionUser =
  | { userId: number; source: 'better-auth' }
  | { userId: number; source: 'legacy'; needsBridge: true }

export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const cookieHeader = headers.get('cookie')
  const token = cookieHeader
    ? parseCookies(cookieHeader).get(SESSION_COOKIE)
    : undefined
  const legacySession = verifySession(token)
  if (legacySession && await isSessionTokenRevoked(token, { failClosed: false })) {
    return null
  }

  if (process.env.AUTH_LEGACY_FAST_PATH === '1' && legacySession) {
    return { userId: legacySession.id, source: 'legacy', needsBridge: true }
  }

  if (process.env.BETTER_AUTH_ENABLED === '1') {
    let session: Awaited<ReturnType<typeof import('@/lib/auth/betterAuth').auth.api.getSession>> | null
    try {
      const { auth } = await import('@/lib/auth/betterAuth')
      session = await auth.api.getSession({ headers })
    } catch {
      session = null
    }
    if (session && session.user && typeof session.user === 'object') {
      const userId = Number(session.user.id)
      if (Number.isFinite(userId)) {
        if (legacySession && legacySession.id !== userId) {
          return { userId: legacySession.id, source: 'legacy', needsBridge: true }
        }
        return { userId, source: 'better-auth' }
      }
    }
  }

  if (!legacySession) {
    return null
  }

  return {
    userId: legacySession.id,
    source: 'legacy',
    needsBridge: true,
  }
}
