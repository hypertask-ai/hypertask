import { currentRedisAudience } from "@/lib/redis/audience";
import { createMemoryRedisClient } from "@/lib/redis/memoryClient";
import { instrumentRedisMetrics } from "@/lib/redis/metrics";

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

function logReconnectingConnectionError(error: NodeJS.ErrnoException) {
  console.warn("[redis] connection error, reconnecting:", error.code ?? "", error.message);
}

const globalForRedis = globalThis as unknown as {
  redis?: RedisClient;
  redisPromise?: Promise<RedisClient>;
  agentRedis?: ReturnType<typeof createMemoryRedisClient>;
};

async function connectProductionRedis(): Promise<RedisClient> {
  const { default: Redis } = await import("ioredis");
  const client = new Redis(getRedisUrl(), { protocol: 2 });
  client.on("error", logReconnectingConnectionError);
  const metrics = {
    incrby: (key: string, amount: number) => client.incrby(key, amount),
    hincrby: (key: string, field: string, amount: number) => client.hincrby(key, field, amount),
    expire: (key: string, seconds: number) => client.expire(key, seconds),
    get: (key: string) => client.get(key),
    hgetall: (key: string) => client.hgetall(key),
  };
  return instrumentRedisMetrics(client, metrics) as RedisClient;
}

export async function getRedis(): Promise<RedisClient> {
  if (currentRedisAudience() === "agent") {
    if (!globalForRedis.agentRedis) {
      globalForRedis.agentRedis = createMemoryRedisClient();
    }
    return globalForRedis.agentRedis as unknown as RedisClient;
  }

  if (globalForRedis.redis) return globalForRedis.redis;

  if (!globalForRedis.redisPromise) {
    globalForRedis.redisPromise = (async () => {
      if (process.env.NEXT_RUNTIME === "edge") {
        throw new Error("Redis TCP client is unavailable in the Edge runtime.");
      }
      const client = await connectProductionRedis();
      globalForRedis.redis = client;
      return client;
    })();
  }

  return globalForRedis.redisPromise;
}
