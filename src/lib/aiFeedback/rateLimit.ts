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
  return Number(await redis.eval(FEEDBACK_QUOTA_SCRIPT, 1, key, Date.now(), limit, token)) === 1
}

export const VALIDATION_REFUSAL_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1] - 86400000)
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
redis.call('PEXPIRE', KEYS[1], 86400000)
if redis.call('ZCARD', KEYS[1]) < 3 then return {} end
if not redis.call('SET', KEYS[2], ARGV[3], 'PX', 86400000, 'NX') then return {} end
return redis.call('ZRANGE', KEYS[1], 0, 9)
`

export const RELEASE_VALIDATION_REFUSAL_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`

export async function reserveValidationRefusal(fingerprint: string, reporter: string) {
  const redis = await getRedis()
  const key = `ai-feedback:validation-refusal:{${fingerprint}}`
  const token = randomUUID()
  const reporters = await redis.eval(VALIDATION_REFUSAL_SCRIPT, 2, `${key}:reporters`, `${key}:filed`, Date.now(), reporter, token) as string[]
  return reporters.length ? { token, reporters } : undefined
}

export async function releaseValidationRefusal(fingerprint: string, token: string) {
  const redis = await getRedis()
  await redis.eval(RELEASE_VALIDATION_REFUSAL_SCRIPT, 1, `ai-feedback:validation-refusal:{${fingerprint}}:filed`, token)
}
