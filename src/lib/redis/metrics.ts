import { currentRedisAudience } from "@/lib/redis/audience";

const splitKey = () => `upstash:metrics:split:${new Date().toISOString().slice(0, 10)}`;
const METRICS_KEY_PREFIX = "upstash:metrics:";

type RedisClient = {
  hincrby(key: string, field: string, amount: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
};

export const UPSTASH_DAILY_REQUEST_ALARM = 300_000;

function metricsKey(key: string): boolean {
  return key.startsWith(METRICS_KEY_PREFIX);
}

export function instrumentRedisMetrics<T extends object>(client: T, raw: RedisClient): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const name = String(property);
      if (name === "on" || name === "disconnect") return value;
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args);
        const maybeRecord = () => {
          if (name === "eval" || name === "multi" || name === "pipeline") return;
          const key = typeof args[0] === "string" ? args[0] : undefined;
          if (key && metricsKey(key)) return;
          void recordCommand(raw, currentRedisAudience());
        };
        if (result && typeof result.then === "function") {
          return result.then((resolved: unknown) => {
            maybeRecord();
            return resolved;
          });
        }
        maybeRecord();
        return result;
      };
    },
  });
}

async function recordCommand(client: RedisClient, audience: string) {
  try {
    const key = splitKey();
    await client.hincrby(key, audience, 1);
    await client.expire(key, 86_400 * 4);
  } catch {
  }
}

export async function readUpstashDailyMetrics(client: RedisClient) {
  const split = await client.hgetall(splitKey());
  const human = Number(split.human ?? 0);
  const agent = Number(split.agent ?? 0);
  const job = Number(split.job ?? 0);
  const total = human + agent + job;
  return { total: Number.isFinite(total) ? total : 0, human, agent, job };
}
