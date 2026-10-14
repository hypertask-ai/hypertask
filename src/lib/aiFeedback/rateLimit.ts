import { randomUUID } from 'node:crypto'
import { getRedis } from '@/lib/redis'

export const FEEDBACK_ATTEMPT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
return count
`

export async function reserveFeedbackAttempt(userId?: number): Promise<boolean> {
  const redis = await getRedis()
  return Number(await redis.eval(FEEDBACK_ATTEMPT_SCRIPT, 1, `ai-feedback:attempt:${userId ?? 'anonymous'}`)) <= 60
}

// Sliding windows, atomically shared by Vercel instances. Denied calls consume no slot.
export const FEEDBACK_QUOTA_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1] - 3600000)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
redis.call('PEXPIRE', KEYS[1], 3600000)
return 1
`

export async function reserveFeedbackQuota(userId: number | undefined, deduped: boolean) {
  const redis = await getRedis()
  const bucket = userId === undefined ? 'anonymous' : `${userId}:${deduped ? 'bump' : 'new'}`
  const key = `ai-feedback:quota:${bucket}`
  const token = randomUUID()
  const limit = userId === undefined ? 20 : deduped ? 30 : 10
  // Core creation can commit before a later side effect fails, so never refund a reservation.
  return Number(await redis.eval(FEEDBACK_QUOTA_SCRIPT, 1, key, Date.now(), limit, token)) === 1
}
