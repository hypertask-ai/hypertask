import { randomUUID } from "node:crypto";
import { getRedis } from "@/lib/redis";

const SLIDING_WINDOW_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now - window)
if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[3]) then
  local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  return math.max(1, math.ceil((tonumber(oldest[2]) + window - now) / 1000))
end
redis.call("ZADD", KEYS[1], now, ARGV[4])
redis.call("PEXPIRE", KEYS[1], window)
return 0
`;

export async function consumeDemoWindow(key: string, limit: number, now = Date.now()) {
  const redis = await getRedis();
  const retryAfter = await redis.eval(
    SLIDING_WINDOW_SCRIPT, 1, key, String(now), String(60 * 60 * 1000), String(limit), randomUUID(),
  );
  if (typeof retryAfter !== "number" || !Number.isSafeInteger(retryAfter) || retryAfter < 0) throw new Error("Invalid demo rate limit response");
  return { allowed: retryAfter === 0, retryAfter };
}
