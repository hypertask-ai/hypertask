import { createHash } from 'node:crypto'
import type { JwtPayload } from 'jsonwebtoken'
import { getRedis } from '@/lib/redis'

export async function consumeEmailLinkToken(decoded: JwtPayload): Promise<boolean> {
  if (typeof decoded.jti !== 'string' || !decoded.jti.trim() ||
      typeof decoded.exp !== 'number' || !Number.isSafeInteger(decoded.exp)) {
    return false
  }

  const remainingSeconds = Math.ceil(decoded.exp - Date.now() / 1000)
  if (remainingSeconds <= 0) return false

  const redis = await getRedis()
  const key = `auth:email-link:consumed:${createHash('sha256').update(decoded.jti).digest('hex')}`
  const result = await redis.set(key, '1', 'EX', remainingSeconds + 60, 'NX')
  return result === 'OK'
}
