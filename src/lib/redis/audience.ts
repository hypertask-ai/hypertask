import { AsyncLocalStorage } from "node:async_hooks";
import { HTPR_8978_UPSTASH_AUDIENCE_FLAG } from "@/lib/flags/definitions/htpr-8978-upstash-audience";

export type RedisAudience = "human" | "agent" | "job";

const audienceStore = new AsyncLocalStorage<RedisAudience>();
let routingEnabled: boolean | undefined;
let routingExpiresAt = 0;

export function currentRedisAudience(): RedisAudience {
  return audienceStore.getStore() ?? "human";
}

export function withRedisAudience<T>(audience: RedisAudience, run: () => T): T {
  return audienceStore.run(audience, run);
}

export function upstashAudienceRoutingCached(): boolean {
  return routingEnabled === true;
}

export async function isUpstashAudienceRoutingEnabled(): Promise<boolean> {
  if (routingEnabled !== undefined && routingExpiresAt > Date.now()) return routingEnabled;
  const { isFeatureEnabled, FEATURE_FLAG_OWNER_USER_ID } = await import("@/lib/flags");
  routingEnabled = await isFeatureEnabled(HTPR_8978_UPSTASH_AUDIENCE_FLAG, FEATURE_FLAG_OWNER_USER_ID);
  routingExpiresAt = Date.now() + 30_000;
  return routingEnabled;
}
