// HTPR-4146: reverse of bridgePlugin.ts — mints legacy ht_session/nookies_user cookies after a native Better Auth login, so the 140+ files that still read those cookies directly keep working.
import type { BetterAuthPlugin } from 'better-auth'
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api'

import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSession,
} from '@/lib/auth/session'
import { slimUserForCookie } from '@/lib/auth/slimUserCookie'
import { getThemeCookieOptions } from '@/lib/auth/themeCookie'
import authConfig from '@/lib/configs/auth.config'
import { themeCookieSeedValue } from '@/lib/themePreferences'
import prisma from '@/lib/prisma'
import { adoptGuestBoards } from '@/utils/controllers/demo/adoptGuestBoards'

type LegacyCookieCtx = {
  setCookie: (name: string, value: string, options: Record<string, unknown>) => void
  getCookie?: (name: string) => string | undefined | null
}

async function setLegacyCookiesForUser(ctx: LegacyCookieCtx, userId: number) {
  const userData = await prisma.user.findUnique({
    where: { id: userId },
    include: { UserSetting: true, userPicture: true },
  })
  if (!userData) {
    return null
  }

  ctx.setCookie('nookies_user', JSON.stringify(slimUserForCookie(userData)), {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 2592000, // 30 days, matches the Better Auth session lifetime
    path: '/',
  })
  ctx.setCookie(
    SESSION_COOKIE,
    signSession({ id: userData.id, email: userData.email }, SESSION_TTL_SECONDS),
    sessionCookieOptions(SESSION_TTL_SECONDS)
  )
  // Default only: an existing choice (e.g. the guest flow's amoled) wins.
  const existingTheme = ctx.getCookie?.(authConfig.cookies.theme) ?? undefined
  const themeToSeed = themeCookieSeedValue(existingTheme)
  if (themeToSeed) {
    ctx.setCookie(
      authConfig.cookies.theme,
      themeToSeed,
      getThemeCookieOptions()
    )
  }
  ctx.setCookie('signup_source', 'better_auth', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 604800,
    path: '/',
  })

  // previousBoard drives the middleware's post-login board restoration. It is
  // normally maintained client-side as the user switches boards, but a fresh
  // login (new browser, cleared cookies, first passkey/Google sign-in) has none,
  // and then / and /project both fall through to the crashing/empty bare
  // /project. Seed it with the user's own primary board, but ONLY when absent so
  // we never overwrite their real last board.
  //
  // Prefer a board the user OWNS (their primary workspace). An arbitrary
  // membership board can be an old board owned by someone else and broken on
  // load (black screen), so owned boards come first; membership-only is the
  // fallback for users who own nothing.
  if (!ctx.getCookie?.('previousBoard')) {
    // Prefer the user's most active OWNED board (their primary workspace) — a
    // user owns their real board even without a Member row. Only seed it if it
    // has tasks, so an abandoned-onboarding husk (owned, 0 tasks) still routes
    // to onboarding instead of a crash. Fall back to a membership board for
    // users who own nothing.
    // status: 'Normal' — never seed an archived/deleted board. An archived
    // board has no normal view to render and black-screens on load (this is
    // exactly how a stale membership on old board 21 crashed the app).
    const owned = await prisma.project.findFirst({
      where: { ownerId: userId, status: 'Normal' },
      orderBy: { tasks: { _count: 'desc' } },
      select: { id: true, _count: { select: { tasks: true } } },
    })
    const board =
      owned && owned._count.tasks > 0
        ? { id: owned.id }
        : await prisma.project.findFirst({
            where: {
              status: 'Normal',
              members: { some: { userId, agentId: null } },
            },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          })
    if (board) {
      ctx.setCookie('previousBoard', `project-${board.id}|&|`, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 604800,
        path: '/',
      })
    }
  }

  return userData
}

export function legacyCookiePlugin() {
  return {
    id: 'legacy-cookie-bridge',
    endpoints: {
      bridgeLegacySession: createAuthEndpoint(
        '/bridge-legacy-session',
        {
          method: 'POST',
          requireHeaders: true,
          disableBody: true,
        },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx)
          if (!session) {
            throw APIError.fromStatus('UNAUTHORIZED', {
              message: 'No active session',
            })
          }

          const userId = Number(session.user.id)
          if (!Number.isFinite(userId)) {
            throw APIError.fromStatus('UNAUTHORIZED', {
              message: 'No active session',
            })
          }

          const userData = await setLegacyCookiesForUser(ctx, userId)
          if (!userData) {
            throw APIError.fromStatus('UNAUTHORIZED', {
              message: 'No active session',
            })
          }

          // Membership only: the app can only land on boards through Member
          // rows. Counting ownerId too made aborted-onboarding husk projects
          // (owned, no membership, e.g. user 985 / project 2069) report
          // hasProjects=true and routed their owner to a black /project page.
          const hasProjects = Boolean(
            await prisma.project.findFirst({
              where: {
                members: { some: { userId, agentId: null } },
              },
              select: { id: true },
            })
          )

          // ponytail: skip previousBoard, first page load fetches projects fresh
          return ctx.json({ ok: true, hasProjects })
        }
      ),
    },
    hooks: {
      after: [
        {
          // HTPR-4171: any request that CREATED a Better Auth session (Google
          // callback, magic-link verify, ...) must also carry the legacy
          // cookies for that user in the same response. Relying on the client
          // reverse bridge left stale cookies for the PREVIOUS user in place
          // when switching accounts, so the app rendered the wrong identity.
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            const newSession = ctx.context.newSession
            if (!newSession) return

            const userId = Number(newSession.user.id)
            if (!Number.isFinite(userId)) return

            // HTPR-4893: Google and passkey sign-ins land here, and the request
            // still carries the guest's ht_session when one was signed in from the
            // demo board. Adopt BEFORE minting the new cookies, so previousBoard is
            // seeded from a board list that already includes the adopted board.
            await adoptGuestBoards(ctx.getCookie?.(SESSION_COOKIE), userId)

            await setLegacyCookiesForUser(ctx, userId)
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin
}
