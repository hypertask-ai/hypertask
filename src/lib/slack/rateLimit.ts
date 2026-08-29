import { getRedis } from "@/lib/redis";

export const SLACK_ACTION_RATE_LIMIT = 20;
export const SLACK_ACTION_RATE_WINDOW_SECONDS = 60;

export function isSlackActionRateLimited(
  count: number,
  limit = SLACK_ACTION_RATE_LIMIT,
): boolean {
  return !Number.isFinite(count) || count > limit;
}

export async function claimSlackActionCapacity(
  slackTeamId: string,
  slackUserId: string,
  nowMs = Date.now(),
): Promise<boolean> {
  try {
    const redis = await getRedis();
    const nowSeconds = Math.floor(nowMs / 1000);
    const windowStart =
      Math.floor(nowSeconds / SLACK_ACTION_RATE_WINDOW_SECONDS) *
      SLACK_ACTION_RATE_WINDOW_SECONDS;
    const key = `slack:rate:${slackTeamId}:${slackUserId}:${windowStart}`;
    const results = await redis
      .multi()
      .incr(key)
      .expire(key, SLACK_ACTION_RATE_WINDOW_SECONDS)
      .exec();
    const count = Number(results?.[0]?.[1]);
    return !isSlackActionRateLimited(count);
  } catch (error) {
    console.error("Slack rate-limit check failed", error);
    return false;
  }
}
