import { env as appEnv } from "#env";
import { createHash } from "node:crypto";

import { getEmailCodeClientIp } from "@/lib/auth/emailCodeRateLimit";
import { getRedis } from "@/lib/redis";

export const QA_LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60;
export const QA_LOGIN_IP_ATTEMPT_LIMIT = 20;
export const QA_LOGIN_EMAIL_ATTEMPT_LIMIT = 8;

export type QaLoginAttemptDecision = {
  allowed: boolean;
  emailAllowed: boolean;
  ipAllowed: boolean;
  emailCount: number;
  ipCount: number;
};

const CLAIM_ATTEMPT_SCRIPT = `
local ip_count = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])

if ip_count > tonumber(ARGV[2]) then
  return {-1, ip_count}
end

local email_count = redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[1])
return {email_count, ip_count}
`;

const hashRateLimitValue = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function getQaLoginClientIp(request: Request): string | null {
  return (
    getEmailCodeClientIp(request) ??
    (appEnv.NODE_ENV === "production" ? null : "127.0.0.1")
  );
}

export function getQaLoginAttemptKeys(
  email: string,
  clientIp: string,
  nowMs = Date.now(),
) {
  const window = Math.floor(nowMs / 1000 / QA_LOGIN_ATTEMPT_WINDOW_SECONDS);
  return {
    emailKey: `auth:qa-login:email:${hashRateLimitValue(email)}:${window}`,
    ipKey: `auth:qa-login:ip:${hashRateLimitValue(clientIp)}:${window}`,
  };
}

export function decideQaLoginAttempt(
  emailCount: number,
  ipCount: number,
): QaLoginAttemptDecision {
  const countsAreValid =
    Number.isFinite(emailCount) &&
    emailCount > 0 &&
    Number.isFinite(ipCount) &&
    ipCount > 0;

  const emailAllowed =
    countsAreValid && emailCount <= QA_LOGIN_EMAIL_ATTEMPT_LIMIT;
  const ipAllowed = countsAreValid && ipCount <= QA_LOGIN_IP_ATTEMPT_LIMIT;

  return {
    allowed: emailAllowed && ipAllowed,
    emailAllowed,
    ipAllowed,
    emailCount,
    ipCount,
  };
}

const memoryCounts = new Map<string, number>();

function claimMemoryCount(key: string): number {
  const next = (memoryCounts.get(key) ?? 0) + 1;
  memoryCounts.set(key, next);
  return next;
}

export async function claimQaLoginAttempt(
  email: string,
  clientIp: string,
  nowMs = Date.now(),
): Promise<QaLoginAttemptDecision> {
  const { emailKey, ipKey } = getQaLoginAttemptKeys(email, clientIp, nowMs);

  try {
    const redis = await getRedis();
    const results = (await redis.eval(
      CLAIM_ATTEMPT_SCRIPT,
      2,
      ipKey,
      emailKey,
      QA_LOGIN_ATTEMPT_WINDOW_SECONDS,
      QA_LOGIN_IP_ATTEMPT_LIMIT,
    )) as [unknown, unknown];
    return decideQaLoginAttempt(Number(results?.[0]), Number(results?.[1]));
  } catch (error) {
    if (appEnv.NODE_ENV === "production") throw error;
    return decideQaLoginAttempt(
      claimMemoryCount(emailKey),
      claimMemoryCount(ipKey),
    );
  }
}
