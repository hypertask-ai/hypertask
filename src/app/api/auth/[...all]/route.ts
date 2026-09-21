import { env as appEnv } from "#env";
import { withoutAuth } from "#with-auth";
import { toNextJsHandler } from 'better-auth/next-js'

import { auth } from '@/lib/auth/betterAuth'

const betterAuthHandler = toNextJsHandler(auth)

type BetterAuthMethod = keyof typeof betterAuthHandler

const gatedHandler = (method: BetterAuthMethod) => (request: Request) => {
  if (appEnv.BETTER_AUTH_ENABLED !== '1') {
    return Promise.resolve(new Response(null, { status: 404 }))
  }

  return betterAuthHandler[method](request)
}

export const GET = withoutAuth(gatedHandler('GET'))
export const POST = withoutAuth(gatedHandler('POST'))
export const PATCH = withoutAuth(gatedHandler('PATCH'))
export const PUT = withoutAuth(gatedHandler('PUT'))
export const DELETE = withoutAuth(gatedHandler('DELETE'))
