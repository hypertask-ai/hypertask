import { NextResponse } from 'next/server'
import { getRedis } from '@/lib/redis'

const WINDOW_SECONDS = 60
const LIMITS = { read: 120, write: 60 } as const

const CLAIM = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  local expires = redis.call('EXPIRE', KEYS[1], ARGV[1])
  if expires ~= 1 then return -1 end
end
if redis.call('TTL', KEYS[1]) < 0 then return -1 end
return count
`

export async function checkRestRateLimit(
  userId: number,
  bucket: keyof typeof LIMITS,
): Promise<NextResponse | null> {
  const seconds = Math.floor(Date.now() / 1000)
  const windowStart = Math.floor(seconds / WINDOW_SECONDS) * WINDOW_SECONDS
  const retryAfter = windowStart + WINDOW_SECONDS - seconds
  try {
    const redis = await getRedis()
    const count = await redis.eval(
      CLAIM, 1, `rest:htpr-6924:${userId}:${bucket}:${windowStart}`, retryAfter,
    )
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) {
      throw new Error('Invalid REST rate-limit counter or expiry')
    }
    if (count > LIMITS[bucket]) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again shortly.' },
        { status: 429, headers: {
          'Retry-After': String(Math.max(1, windowStart + WINDOW_SECONDS - Math.floor(Date.now() / 1000))),
        } },
      )
    }
  } catch {
    // This availability budget must not replace security-domain fail-closed policies.
    console.warn('[rest-rate-limit] Counter unavailable; allowing request')
  }
  return null
}
