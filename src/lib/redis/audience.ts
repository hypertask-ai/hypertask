import { AsyncLocalStorage } from "node:async_hooks";

export type RedisAudience = "human" | "agent" | "job";

const audienceStore = new AsyncLocalStorage<RedisAudience>();

export function currentRedisAudience(): RedisAudience {
  return audienceStore.getStore() ?? "human";
}

export function withRedisAudience<T>(audience: RedisAudience, run: () => T): T {
  return audienceStore.run(audience, run);
}

export function markRedisAudienceAgent(): void {
  const prior = audienceStore.getStore();
  if (prior !== "agent") audienceStore.enterWith("agent");
}
