import type { GenericEndpointContext } from '@better-auth/core'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'

import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'
import { isSessionTokenRevoked } from '@/lib/auth/sessionRevocation'
import { getAppShellBootstrap } from '@/lib/appShellBootstrap/server'

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
        async (ctx: GenericEndpointContext) => {
          const token = ctx.getCookie(SESSION_COOKIE) ?? undefined
          const legacySession = verifySession(token)
          if (!legacySession || await isSessionTokenRevoked(token, { failClosed: true })) {
            throw APIError.fromStatus('UNAUTHORIZED', {
              message: 'Invalid legacy session',
            })
          }

          if (legacySession.agentId) {
            throw APIError.fromStatus('FORBIDDEN', {
              message: 'Agent cookies cannot create human sessions',
              code: 'AGENT_COOKIE_ROUTE',
            })
          }

          ctx.setHeader('cache-control', 'private, no-store')
          ctx.setHeader('pragma', 'no-cache')
          const bootstrapPromise = getAppShellBootstrap(legacySession.id).catch(
            () => null,
          )

          const userId = legacySession.id as unknown as string
          const user = await ctx.context.internalAdapter.findUserById(userId)
          if (!user) {
            throw APIError.fromStatus('UNAUTHORIZED', {
              message: 'Invalid legacy session',
            })
          }

          const currentSession = await getSessionFromCtx(ctx)
          if (currentSession && Number(currentSession.user.id) === legacySession.id) {
            return ctx.json({ ok: true, bootstrap: await bootstrapPromise })
          }

          const session = await ctx.context.internalAdapter.createSession(userId, false)
          if (!session) {
            throw APIError.fromStatus('INTERNAL_SERVER_ERROR', {
              message: 'Failed to create session',
            })
          }

          await setSessionCookie(ctx, { session, user })

          return ctx.json({ ok: true, bootstrap: await bootstrapPromise })
        }
      ),
    },
  } satisfies BetterAuthPlugin
}
