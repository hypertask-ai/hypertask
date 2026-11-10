import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { getRedis } from "@/lib/redis";
import { isProbeRecipientEmail } from "@/lib/funnelProbe/inbox";

const HOUR_MS = 60 * 60 * 1000;
const HOURLY_KEY_PREFIX = "funnel-probe:signup-hour:";
const HOURLY_KEY_TTL_SECONDS = 2 * 60 * 60;

const defaultHourlyLimit = 24;

export function probeSignupHourlyLimit(): number {
  const parsed = Number(process.env.FUNNEL_PROBE_SIGNUPS_PER_HOUR);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return defaultHourlyLimit;
}

function currentHourBucket(): number {
  return Math.floor(Date.now() / HOUR_MS);
}

export async function tryConsumeProbeSignupSlot(): Promise<{ allowed: boolean }> {
  const limit = probeSignupHourlyLimit();
  const key = `${HOURLY_KEY_PREFIX}${currentHourBucket()}`;
  const redis = await getRedis();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, HOURLY_KEY_TTL_SECONDS);
  }
  if (count > limit) {
    await redis.decr(key);
    return { allowed: false };
  }
  return { allowed: true };
}

export type ProbeSignupGateResult =
  | { ok: true }
  | { ok: false; status: 403 | 429; code: string; error: string };

export async function gateProbeInstantSignup(
  authorizationHeader: string | null | undefined,
  email: string,
  cronSecret: string | undefined,
): Promise<ProbeSignupGateResult> {
  if (!isProbeRecipientEmail(email)) return { ok: true };
  if (!hasValidCronAuthorization(authorizationHeader, cronSecret)) {
    return {
      ok: false,
      status: 403,
      code: "PROBE_SIGNUP_FORBIDDEN",
      error: "Forbidden",
    };
  }
  const slot = await tryConsumeProbeSignupSlot();
  if (!slot.allowed) {
    return {
      ok: false,
      status: 429,
      code: "PROBE_SIGNUP_HOURLY_LIMIT",
      error: "Probe signup hourly limit reached",
    };
  }
  return { ok: true };
}
