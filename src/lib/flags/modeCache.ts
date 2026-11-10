import type { FeatureFlagMode } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

export type RawFlagMode = { key: string; mode: FeatureFlagMode };
export const FLAG_MODE_CACHE_KEY = "flags:raw-modes:7042";
export const FLAG_MODE_GENERATION_KEY = `${FLAG_MODE_CACHE_KEY}:generation`;
export const FLAG_MODE_WRITERS_KEY = `${FLAG_MODE_CACHE_KEY}:writers`;
export const flagModeScope = new AsyncLocalStorage<{ modes?: Promise<RawFlagMode[] | null> }>();

const PROCESS_FLAG_CACHE_MS = Number(process.env.FLAG_PROCESS_CACHE_MS ?? 15_000);
let processFlagCache: { expiresAt: number; rows: RawFlagMode[] } | undefined;

export function readProcessFlagCache(): RawFlagMode[] | undefined {
  return processFlagCache && processFlagCache.expiresAt > Date.now() ? processFlagCache.rows : undefined;
}

export function storeProcessFlagCache(rows: RawFlagMode[]): void {
  if (!(PROCESS_FLAG_CACHE_MS > 0)) return;
  processFlagCache = { expiresAt: Date.now() + PROCESS_FLAG_CACHE_MS, rows };
}

export function clearProcessFlagCache(): void {
  processFlagCache = undefined;
}

export function withFeatureFlagSnapshot<T>(run: () => T): T {
  return flagModeScope.run({}, run);
}

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
  clearProcessFlagCache();
  const scope = flagModeScope.getStore();
  if (scope) scope.modes = undefined;
  if (process.env.REDIS_URL) {
    try {
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
