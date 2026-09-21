import { toNextJsHandler } from 'better-auth/next-js'

import { auth } from '@/lib/auth/betterAuth'

const betterAuthHandler = toNextJsHandler(auth)

type BetterAuthMethod = keyof typeof betterAuthHandler

const gatedHandler = (method: BetterAuthMethod) => (request: Request) => {
  if (process.env.BETTER_AUTH_ENABLED !== '1') {
    return Promise.resolve(new Response(null, { status: 404 }))
  }

  return betterAuthHandler[method](request)
}

export const GET = gatedHandler('GET')
export const POST = gatedHandler('POST')
export const PATCH = gatedHandler('PATCH')
export const PUT = gatedHandler('PUT')
export const DELETE = gatedHandler('DELETE')
