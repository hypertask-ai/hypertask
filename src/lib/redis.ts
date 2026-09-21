import { env as appEnv } from "#env";
type RedisClient = InstanceType<(typeof import("ioredis"))["default"]>;

function getRedisUrl() {
  const redisUrl = appEnv.REDIS_URL?.trim();
  if (!redisUrl) {
    throw new Error(
      "Missing REDIS_URL; QStash job scheduling requires Redis for message-id tracking and locks."
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch {
    throw new Error("Malformed REDIS_URL; expected a valid redis:// or rediss:// URL.");
  }

  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("Malformed REDIS_URL; expected protocol redis:// or rediss://.");
  }

  return redisUrl;
}

const globalForRedis = globalThis as unknown as {
  redis?: RedisClient;
  redisPromise?: Promise<RedisClient>;
};

export async function getRedis(): Promise<RedisClient> {
  if (globalForRedis.redis) return globalForRedis.redis;

  if (!globalForRedis.redisPromise) {
    globalForRedis.redisPromise = (async () => {
      if (appEnv.NEXT_RUNTIME === "edge") {
        throw new Error("Redis TCP client is unavailable in the Edge runtime.");
      }

      const { default: Redis } = await import("ioredis");
      // ioredis 6 opens every connection with HELLO 3. Upstash fronts Redis
      // with its own TCP proxy, and a proxy that rejects HELLO with anything
      // other than NOPROTO or an unknown-command error fails the connection
      // instead of downgrading. protocol: 2 keeps the wire protocol ioredis 5
      // spoke, and costs one less command per connection on a per-command bill.
      const client = new Redis(getRedisUrl(), { protocol: 2 });
      globalForRedis.redis = client;
      return client;
    })();
  }

  return globalForRedis.redisPromise;
}
