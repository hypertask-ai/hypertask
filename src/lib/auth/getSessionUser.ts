import { parseCookies } from 'better-auth/cookies'

import { auth } from '@/lib/auth/betterAuth'
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'

export type SessionUser =
  | { userId: number; source: 'better-auth' }
  | { userId: number; source: 'legacy'; needsBridge: true }

// Resolves the enabled Better Auth session first, then falls back to ht_session.
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const cookieHeader = headers.get('cookie')
  const token = cookieHeader
    ? parseCookies(cookieHeader).get(SESSION_COOKIE)
    : undefined
  const legacySession = verifySession(token)

  if (process.env.BETTER_AUTH_ENABLED === '1') {
    const session = await auth.api.getSession({ headers })
    if (session) {
      const userId = Number(session.user.id)
      if (Number.isFinite(userId)) {
        // A legacy session for a DIFFERENT user means the person logged in
        // again (legacy login flows replace ht_session but cannot clear the
        // httpOnly Better Auth cookie), so the BA session is stale — trusting
        // it renders the previous user's account (HTPR-4170 black screen).
        // The bridge re-mints the BA session on the next client mount.
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
