import { createHash } from "node:crypto";

import { getQaLoginClientIp } from "@/lib/auth/qaLoginRateLimit";
import { getRedis } from "@/lib/redis";

export const TICKET_ACCOUNT_SWITCH_WINDOW_SECONDS = 15 * 60;
export const TICKET_ACCOUNT_SWITCH_IP_LIMIT = 60;
export const TICKET_ACCOUNT_SWITCH_USER_LIMIT = 30;

export type TicketAccountSwitchAttemptDecision = {
  allowed: boolean;
  userAllowed: boolean;
  ipAllowed: boolean;
  userCount: number;
  ipCount: number;
};

const CLAIM_ATTEMPT_SCRIPT = `
local ip_count = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[1])

if ip_count > tonumber(ARGV[2]) then
  return {-1, ip_count}
end

local user_count = redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[1])
return {user_count, ip_count}
`;

const hashRateLimitValue = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function getTicketAccountSwitchClientIp(request: Request): string | null {
  return getQaLoginClientIp(request);
}

export function getTicketAccountSwitchAttemptKeys(
  userId: number,
  clientIp: string,
  nowMs = Date.now(),
) {
  const window = Math.floor(nowMs / 1000 / TICKET_ACCOUNT_SWITCH_WINDOW_SECONDS);
  return {
    userKey: `auth:ticket-account-switch:user:${hashRateLimitValue(String(userId))}:${window}`,
    ipKey: `auth:ticket-account-switch:ip:${hashRateLimitValue(clientIp)}:${window}`,
  };
}

export function decideTicketAccountSwitchAttempt(
  userCount: number,
  ipCount: number,
): TicketAccountSwitchAttemptDecision {
  const countsAreValid =
    Number.isFinite(userCount) &&
    userCount > 0 &&
    Number.isFinite(ipCount) &&
    ipCount > 0;

  const userAllowed = countsAreValid && userCount <= TICKET_ACCOUNT_SWITCH_USER_LIMIT;
  const ipAllowed = countsAreValid && ipCount <= TICKET_ACCOUNT_SWITCH_IP_LIMIT;

  return {
    allowed: userAllowed && ipAllowed,
    userAllowed,
    ipAllowed,
    userCount,
    ipCount,
  };
}

const memoryCounts = new Map<string, number>();

function claimMemoryCount(key: string): number {
  const next = (memoryCounts.get(key) ?? 0) + 1;
  memoryCounts.set(key, next);
  return next;
}

export async function claimTicketAccountSwitchAttempt(
  userId: number,
  clientIp: string,
  nowMs = Date.now(),
): Promise<TicketAccountSwitchAttemptDecision> {
  const { userKey, ipKey } = getTicketAccountSwitchAttemptKeys(userId, clientIp, nowMs);

  try {
    const redis = await getRedis();
    const results = (await redis.eval(
      CLAIM_ATTEMPT_SCRIPT,
      2,
      ipKey,
      userKey,
      TICKET_ACCOUNT_SWITCH_WINDOW_SECONDS,
      TICKET_ACCOUNT_SWITCH_IP_LIMIT,
    )) as [unknown, unknown];
    return decideTicketAccountSwitchAttempt(Number(results?.[0]), Number(results?.[1]));
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
    return decideTicketAccountSwitchAttempt(
      claimMemoryCount(userKey),
      claimMemoryCount(ipKey),
    );
  }
}
