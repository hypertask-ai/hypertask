import { HTPR_8978_UPSTASH_AUDIENCE_FLAG } from "@/lib/flags/definitions/htpr-8978-upstash-audience";

let routingEnabled: boolean | undefined;
let routingExpiresAt = 0;

export async function isUpstashAudienceRoutingEnabled(): Promise<boolean> {
  if (routingEnabled !== undefined && routingExpiresAt > Date.now()) return routingEnabled;
  const { isFeatureEnabled, FEATURE_FLAG_OWNER_USER_ID } = await import("@/lib/flags");
  routingEnabled = await isFeatureEnabled(HTPR_8978_UPSTASH_AUDIENCE_FLAG, FEATURE_FLAG_OWNER_USER_ID);
  routingExpiresAt = Date.now() + 30_000;
  return routingEnabled;
}
