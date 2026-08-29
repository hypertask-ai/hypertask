import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

import { ipAddress } from '@vercel/functions'

import { getRedis } from '@/lib/redis'

export const EMAIL_CODE_ATTEMPT_WINDOW_SECONDS = 30 * 60
export const EMAIL_CODE_EMAIL_ATTEMPT_LIMIT = 5
export const EMAIL_CODE_IP_ATTEMPT_LIMIT = 50

export type EmailCodeAttemptDecision = {
  allowed: boolean
  emailAllowed: boolean
  ipAllowed: boolean
  emailCount: number
  ipCount: number
}

const hashRateLimitValue = (value: string) =>
  createHash('sha256').update(value).digest('hex')

const CLAIM_ATTEMPT_SCRIPT = `
local ip_count = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])

if ip_count > tonumber(ARGV[2]) then
  return {-1, ip_count}
end

local email_count = redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[1])
return {email_count, ip_count}
`

export function getEmailCodeClientIp(request: Request): string | null {
  const clientIp = ipAddress(request)?.trim()
  return clientIp && isIP(clientIp) ? clientIp : null
}

export function getEmailCodeAttemptKeys(
  email: string,
  clientIp: string,
  nowMs = Date.now()
) {
  const window = Math.floor(
    nowMs / 1000 / EMAIL_CODE_ATTEMPT_WINDOW_SECONDS
  )
  return {
    emailKey: `auth:email-code:email:${hashRateLimitValue(email)}:${window}`,
    ipKey: `auth:email-code:ip:${hashRateLimitValue(clientIp)}:${window}`,
  }
}

export function decideEmailCodeAttempt(
  emailCount: number,
  ipCount: number
): EmailCodeAttemptDecision {
  const countsAreValid =
    Number.isFinite(emailCount) &&
    emailCount > 0 &&
    Number.isFinite(ipCount) &&
    ipCount > 0

  const emailAllowed =
    countsAreValid && emailCount <= EMAIL_CODE_EMAIL_ATTEMPT_LIMIT
  const ipAllowed = countsAreValid && ipCount <= EMAIL_CODE_IP_ATTEMPT_LIMIT

  return {
    allowed: emailAllowed && ipAllowed,
    emailAllowed,
    ipAllowed,
    emailCount,
    ipCount,
  }
}

/**
 * Atomically reserves verification capacity before the code is compared.
 * Reserving first prevents a burst of parallel guesses from all reaching the
 * database while the counters still look unused.
 */
export async function claimEmailCodeAttempt(
  email: string,
  clientIp: string,
  nowMs = Date.now()
): Promise<EmailCodeAttemptDecision> {
  const redis = await getRedis()
  const { emailKey, ipKey } = getEmailCodeAttemptKeys(email, clientIp, nowMs)
  const results = (await redis.eval(
    CLAIM_ATTEMPT_SCRIPT,
    2,
    ipKey,
    emailKey,
    EMAIL_CODE_ATTEMPT_WINDOW_SECONDS,
    EMAIL_CODE_IP_ATTEMPT_LIMIT
  )) as [unknown, unknown]

  const emailCount = Number(results?.[0])
  const ipCount = Number(results?.[1])
  return decideEmailCodeAttempt(emailCount, ipCount)
}
