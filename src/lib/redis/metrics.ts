import { currentRedisAudience } from "@/lib/redis/audience";

const dailyKey = () => `upstash:metrics:daily:${new Date().toISOString().slice(0, 10)}`;
const splitKey = () => `upstash:metrics:split:${new Date().toISOString().slice(0, 10)}`;

type RedisClient = {
  incrby(key: string, amount: number): Promise<number>;
  hincrby(key: string, field: string, amount: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
};

export const UPSTASH_DAILY_REQUEST_ALARM = 300_000;

export function instrumentRedisMetrics<T extends object>(client: T, raw: RedisClient): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const name = String(property);
      if (name === "on" || name === "disconnect") return value;
      return (...args: unknown[]) => {
        const audience = currentRedisAudience();
        const result = Reflect.apply(value, target, args);
        if (result && typeof result.then === "function") {
          return result.then((resolved: unknown) => {
            void recordCommand(raw, audience);
            return resolved;
          });
        }
        void recordCommand(raw, audience);
        return result;
      };
    },
  });
}

let recordingMetrics = false;

async function recordCommand(client: RedisClient, audience: string) {
  if (recordingMetrics) return;
  recordingMetrics = true;
  try {
    const dayKey = dailyKey();
    await client.incrby(dayKey, 1);
    await client.expire(dayKey, 86_400 * 4);
    await client.hincrby(splitKey(), audience, 1);
    await client.expire(splitKey(), 86_400 * 4);
  } catch {
  } finally {
    recordingMetrics = false;
  }
}

export async function readUpstashDailyMetrics(client: RedisClient) {
  const total = Number(await client.get(dailyKey()) ?? 0);
  const split = await client.hgetall(splitKey());
  return {
    total: Number.isFinite(total) ? total : 0,
    human: Number(split.human ?? 0),
    agent: Number(split.agent ?? 0),
    job: Number(split.job ?? 0),
  };
}
