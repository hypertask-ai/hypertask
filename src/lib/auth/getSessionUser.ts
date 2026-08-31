import { parseCookies } from 'better-auth/cookies'

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

  // HTPR-5453: whenever a valid signed ht_session exists, the full lookup
  // below always resolves to legacySession.id anyway — if Better Auth agrees,
  // same id; if it disagrees, the account-switch guard three lines down
  // already prefers legacy; if Better Auth is absent or invalid, the fallback
  // at the bottom of this function returns legacy too. So the DB round trip
  // is provably redundant here and can be skipped without changing userId.
  //
  // Kill switch: default off. Flip AUTH_LEGACY_FAST_PATH=1 in Vercel env to
  // enable post-deploy, unset to roll back — no code deploy either way.
  //
  // ponytail: this reports source:'legacy'/needsBridge:true even when Better
  // Auth would have agreed and reported source:'better-auth'. Confirmed via
  // repo-wide grep that nothing reads SessionUser.source or .needsBridge
  // today, so this is inert. Revisit before enabling if that ever changes.
  if (process.env.AUTH_LEGACY_FAST_PATH === '1' && legacySession) {
    return { userId: legacySession.id, source: 'legacy', needsBridge: true }
  }

  if (process.env.BETTER_AUTH_ENABLED === '1') {
    // Lazy import: keeps Better Auth's module-scope construction (8 plugins)
    // off the cold-start path for every request the fast path above already
    // resolved. Same pattern PR #2785 used, never implicated in its revert
    // (that was the cookie-name heuristic, not this).
    let session: Awaited<ReturnType<typeof import('@/lib/auth/betterAuth').auth.api.getSession>> | null
    try {
      const { auth } = await import('@/lib/auth/betterAuth')
      session = await auth.api.getSession({ headers })
    } catch {
      // An adapter outage (or the import itself failing) must fail closed
      // rather than crash the request or let an unverified identity through.
      session = null
    }
    if (session && session.user && typeof session.user === 'object') {
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
