import type { getRedis } from "@/lib/redis";

export async function isOnboardingQaArmed(
  email: string,
  redis: Pick<Awaited<ReturnType<typeof getRedis>>, "get">,
): Promise<boolean> {
  return Boolean(await redis.get(`onboarding:qa-armed:${email.trim().toLowerCase()}`));
}
