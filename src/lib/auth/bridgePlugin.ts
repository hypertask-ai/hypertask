import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'

import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'

export function bridgeSessionPlugin() {
  return {
    id: 'bridge-session',
    endpoints: {
      bridgeSession: createAuthEndpoint(
        '/bridge-session',
        {
          method: 'POST',
          requireHeaders: true,
          disableBody: true,
        },
        async (ctx) => {
          const legacySession = verifySession(ctx.getCookie(SESSION_COOKIE) ?? undefined)
          if (!legacySession) {
            throw APIError.fromStatus('UNAUTHORIZED', {
              message: 'Invalid legacy session',
            })
          }

          // Better Auth's public adapter types assume string IDs, while this
          // installation maps IDs directly to the existing integer User.id.
          const userId = legacySession.id as unknown as string
          const user = await ctx.context.internalAdapter.findUserById(userId)
          if (!user) {
            throw APIError.fromStatus('UNAUTHORIZED', {
              message: 'Invalid legacy session',
            })
          }

          const currentSession = await getSessionFromCtx(ctx)
          if (currentSession && Number(currentSession.user.id) === legacySession.id) {
            return ctx.json({ ok: true })
          }

          const session = await ctx.context.internalAdapter.createSession(userId, false)
          if (!session) {
            throw APIError.fromStatus('INTERNAL_SERVER_ERROR', {
              message: 'Failed to create session',
            })
          }

          await setSessionCookie(ctx, { session, user })

          return ctx.json({ ok: true })
        }
      ),
    },
  } satisfies BetterAuthPlugin
}
