type RedisClient = InstanceType<(typeof import("ioredis"))["default"]>;

function getRedisUrl() {
  const redisUrl = process.env.REDIS_URL?.trim();
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
      if (process.env.NEXT_RUNTIME === "edge") {
        throw new Error("Redis TCP client is unavailable in the Edge runtime.");
      }

      const { default: Redis } = await import("ioredis");
      const client = new Redis(getRedisUrl());
      globalForRedis.redis = client;
      return client;
    })();
  }

  return globalForRedis.redisPromise;
}
