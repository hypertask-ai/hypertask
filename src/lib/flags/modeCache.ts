import type { FeatureFlagMode } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

export type RawFlagMode = { key: string; mode: FeatureFlagMode };
export const FLAG_MODE_CACHE_KEY = "flags:raw-modes:7042";
export const FLAG_MODE_GENERATION_KEY = `${FLAG_MODE_CACHE_KEY}:generation`;
export const FLAG_MODE_WRITERS_KEY = `${FLAG_MODE_CACHE_KEY}:writers`;
export const flagModeScope = new AsyncLocalStorage<{ modes?: Promise<RawFlagMode[] | null> }>();

export function withFeatureFlagSnapshot<T>(run: () => T): T {
  return flagModeScope.run({}, run);
}

// Do not wait through Redis reconnect retries on an otherwise optional read cache.
export async function flagCacheCommand<T>(operation: Promise<T>, timeoutMs = 100): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Flag cache unavailable")), timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withFlagModeInvalidation<T>(write: () => Promise<T>): Promise<T> {
  const result = await write();
  const scope = flagModeScope.getStore();
  if (scope) scope.modes = undefined;
  if (process.env.REDIS_URL) {
    try {
      // Commit the emergency Off switch first; Redis can only delay the response by 500 ms.
      await flagCacheCommand((async () => {
        const { getRedis } = await import("@/lib/redis");
        const redis = await getRedis();
        await redis.eval(`
          redis.call('SET', KEYS[1], '1', 'EX', 5)
          redis.call('INCR', KEYS[2])
          return redis.call('DEL', KEYS[3])
        `, 3, FLAG_MODE_WRITERS_KEY, FLAG_MODE_GENERATION_KEY, FLAG_MODE_CACHE_KEY);
      })(), 500);
    } catch (error) {
      console.warn("[feature-flags] cache invalidation failed", error);
    }
  }
  return result;
}
